const dgram = require("node:dgram");
const http = require("node:http");
const os = require("node:os");
const { execFile } = require("node:child_process");

/**
 * Asking the router to let a CodeToGetter guest in from outside.
 *
 * Two people on the same network find each other with nothing but an address.
 * Two people on different networks do not: the host sits behind a router that
 * has no reason to forward anything to it, and the address the host sees on its
 * own machine means nothing on the other side of that router.
 *
 * So the host asks. Both protocols here are the router's own — nothing is
 * routed through anybody else's server, which is the same reason there is no
 * relay. NAT-PMP is three packets and is tried first; UPnP-IGD is older, more
 * talkative, and supported by far more consumer routers, so it is the fallback.
 *
 * When both fail there is still an answer worth giving: the exact port to
 * forward by hand. A feature that cannot say which port it wanted is a feature
 * that leaves people guessing at a router configuration page.
 */

/** How long a mapping is asked for. Renewed while a session runs. */
const MAPPING_SECONDS = 3600;

/** Anything on the network gets this long before it is treated as absent. */
const PROBE_TIMEOUT_MS = 1500;

/**
 * The router's address on this network.
 *
 * Read from the routing table rather than guessed at, because the convention
 * that a gateway ends in .1 is only a convention and the guess fails silently
 * on the networks that do not follow it.
 */
function parseGateway(routingOutput, platform = process.platform) {
  const text = String(routingOutput || "");
  if (platform === "win32") {
    // "0.0.0.0  0.0.0.0  192.168.0.1  192.168.0.23  25"
    const match = text.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/);
    return match?.[1] || "";
  }
  const viaDefault = text.match(/default\s+via\s+(\d+\.\d+\.\d+\.\d+)/)
    || text.match(/^default\s+(\d+\.\d+\.\d+\.\d+)/m)
    || text.match(/^0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m);
  return viaDefault?.[1] || "";
}

/** Runs the platform's routing-table command and reads the gateway out of it. */
function findGateway(options = {}) {
  const platform = options.platform || process.platform;
  const run = options.run || ((command, args) => new Promise((resolve) => {
    execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => resolve(error ? "" : stdout));
  }));
  const [command, args] = platform === "win32"
    ? ["route", ["print", "0.0.0.0"]]
    : platform === "darwin" ? ["netstat", ["-rn"]] : ["ip", ["route"]];
  return Promise.resolve(run(command, args)).then((output) => parseGateway(output, platform));
}

/** The address this machine has on the local network, to map a port to. */
function localAddressFor(gateway, interfaces = os.networkInterfaces()) {
  const prefix = String(gateway || "").split(".").slice(0, 3).join(".");
  let fallback = "";
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      if ((entry.family !== "IPv4" && entry.family !== 4) || entry.internal) continue;
      if (prefix && entry.address.startsWith(`${prefix}.`)) return entry.address;
      fallback = fallback || entry.address;
    }
  }
  return fallback;
}

/** One NAT-PMP request for a TCP mapping. */
function natpmpRequest(internalPort, externalPort, seconds = MAPPING_SECONDS) {
  const message = Buffer.alloc(12);
  message.writeUInt8(0, 0); // version
  message.writeUInt8(2, 1); // opcode 2: map TCP
  message.writeUInt16BE(0, 2); // reserved
  message.writeUInt16BE(internalPort, 4);
  message.writeUInt16BE(externalPort, 6);
  message.writeUInt32BE(seconds, 8);
  return message;
}

/**
 * Reads a NAT-PMP answer, or says why it is not one.
 *
 * A result code other than zero is the router refusing, and it refuses for
 * reasons worth passing on — most often that the feature is switched off.
 */
function parseNatpmpResponse(message) {
  if (!Buffer.isBuffer(message) || message.length < 16) return { ok: false, reason: "unvollständige Antwort" };
  if (message.readUInt8(1) !== 130) return { ok: false, reason: "unerwartete Antwort" };
  const result = message.readUInt16BE(2);
  if (result !== 0) return { ok: false, reason: `Router-Fehlercode ${result}` };
  return {
    ok: true,
    internalPort: message.readUInt16BE(8),
    externalPort: message.readUInt16BE(10),
    seconds: message.readUInt32BE(12),
  };
}

/** Sends one UDP request and waits briefly for the first answer. */
function askOnce(address, port, payload, timeout = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);
    timer.unref?.();
    socket.on("message", (message) => finish(message));
    socket.on("error", () => finish(null));
    socket.send(payload, port, address, (error) => { if (error) finish(null); });
  });
}

/** Asks the router for a mapping the NAT-PMP way. */
async function mapWithNatpmp(gateway, internalPort, options = {}) {
  const ask = options.ask || askOnce;
  const answer = await ask(gateway, 5351, natpmpRequest(internalPort, internalPort), options.timeout);
  const parsed = parseNatpmpResponse(answer);
  if (!parsed.ok) return { mapped: false, protocol: "NAT-PMP", reason: parsed.reason };
  return { mapped: true, protocol: "NAT-PMP", externalPort: parsed.externalPort, seconds: parsed.seconds };
}

/** The control URL out of an SSDP answer's location document. */
function parseControlUrl(description, location) {
  const service = String(description || "").match(
    /<serviceType>urn:schemas-upnp-org:service:WANIPConnection:\d<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/,
  ) || String(description || "").match(
    /<serviceType>urn:schemas-upnp-org:service:WANPPPConnection:\d<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/,
  );
  if (!service) return "";
  const control = service[1].trim();
  if (/^https?:\/\//i.test(control)) return control;
  try {
    return new URL(control, location).toString();
  } catch {
    return "";
  }
}

/** The LOCATION header of an SSDP answer. */
function parseSsdpLocation(message) {
  return String(message || "").match(/^location:\s*(\S+)/im)?.[1] || "";
}

/** The SOAP body that asks for a port to be forwarded. */
function addPortMappingBody(externalPort, internalPort, internalClient, description = "Kiwi CodeToGetter") {
  return "<?xml version=\"1.0\"?>"
    + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
    + " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
    + "<u:AddPortMapping xmlns:u=\"urn:schemas-upnp-org:service:WANIPConnection:1\">"
    + "<NewRemoteHost></NewRemoteHost>"
    + `<NewExternalPort>${externalPort}</NewExternalPort>`
    + "<NewProtocol>TCP</NewProtocol>"
    + `<NewInternalPort>${internalPort}</NewInternalPort>`
    + `<NewInternalClient>${internalClient}</NewInternalClient>`
    + "<NewEnabled>1</NewEnabled>"
    + `<NewPortMappingDescription>${description}</NewPortMappingDescription>`
    + `<NewLeaseDuration>${MAPPING_SECONDS}</NewLeaseDuration>`
    + "</u:AddPortMapping></s:Body></s:Envelope>";
}

/** The external address out of a GetExternalIPAddress answer. */
function parseExternalAddress(soap) {
  return String(soap || "").match(/<NewExternalIPAddress>\s*([\d.]+)\s*<\/NewExternalIPAddress>/)?.[1] || "";
}

/** Finds a router that speaks UPnP and returns the URL its port service listens on. */
function discoverUpnpControlUrl(options = {}) {
  const timeout = Number(options.timeout) || 2500;
  const fetchText = options.fetchText || httpText;
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(""), timeout);
    timer.unref?.();
    socket.on("error", () => finish(""));
    socket.on("message", async (message) => {
      const location = parseSsdpLocation(message.toString("utf8"));
      if (!location) return;
      const description = await fetchText(location).catch(() => "");
      const control = parseControlUrl(description, location);
      if (control) finish(control);
    });
    const search = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      "MAN: \"ssdp:discover\"",
      "MX: 2",
      "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
      "", "",
    ].join("\r\n");
    socket.send(Buffer.from(search, "utf8"), 1900, "239.255.255.250", (error) => { if (error) finish(""); });
  });
}

/** A plain GET, used for the router's own description document. */
function httpText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method || "GET", headers: options.headers || {} }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.setTimeout(4000, () => { request.destroy(new Error("Der Router hat nicht geantwortet.")); });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

/** One SOAP call against the router's port-forwarding service. */
function soapCall(controlUrl, action, body, fetchText = httpText) {
  return fetchText(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=\"utf-8\"",
      SOAPAction: `"urn:schemas-upnp-org:service:WANIPConnection:1#${action}"`,
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
}

/** Asks the router for a mapping the UPnP way. */
async function mapWithUpnp(controlUrl, internalPort, internalClient, options = {}) {
  const fetchText = options.fetchText || httpText;
  const body = addPortMappingBody(internalPort, internalPort, internalClient);
  const answer = await soapCall(controlUrl, "AddPortMapping", body, fetchText).catch((error) => `FEHLER ${error.message}`);
  if (/AddPortMappingResponse/.test(answer)) {
    return { mapped: true, protocol: "UPnP", externalPort: internalPort };
  }
  // The router's own words are more use than "it did not work": they say
  // whether the feature is off, or the port is already taken by something else.
  const reason = String(answer).match(/<errorDescription>([^<]+)<\/errorDescription>/)?.[1]
    || "Der Router hat die Freigabe abgelehnt.";
  return { mapped: false, protocol: "UPnP", reason };
}

/** The address the rest of the internet sees this router as. */
async function externalAddressViaUpnp(controlUrl, options = {}) {
  const fetchText = options.fetchText || httpText;
  const body = "<?xml version=\"1.0\"?>"
    + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
    + " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
    + "<u:GetExternalIPAddress xmlns:u=\"urn:schemas-upnp-org:service:WANIPConnection:1\" />"
    + "</s:Body></s:Envelope>";
  const answer = await soapCall(controlUrl, "GetExternalIPAddress", body, fetchText).catch(() => "");
  return parseExternalAddress(answer);
}

/**
 * Opens the session's port to the outside, and says plainly what happened.
 *
 * Every branch ends with something the host can act on. A router that refuses
 * is not a dead end — the port number and the local address are exactly what a
 * forwarding rule needs, and saying them is the difference between "it did not
 * work" and five minutes on the router's configuration page.
 */
async function openPublicPort(port, options = {}) {
  // `??`, not `||`: a caller that says the gateway is empty is saying there
  // is none, and treating that as "not specified" sent this looking for a
  // router — and then talking to the real one from a test.
  const gateway = options.gateway ?? await findGateway(options);
  const localAddress = options.localAddress ?? localAddressFor(gateway, options.interfaces);
  const manual = { port, localAddress, gateway };
  if (!gateway || !localAddress) {
    return { ...manual, opened: false, reason: "Der Router war auf diesem Netz nicht zu finden." };
  }
  const viaNatpmp = await (options.mapWithNatpmp || mapWithNatpmp)(gateway, port, options);
  const controlUrl = options.controlUrl ?? await (options.discoverUpnpControlUrl || discoverUpnpControlUrl)(options);
  if (viaNatpmp.mapped) {
    // NAT-PMP maps but does not tell us the public address, and the address is
    // half of what a guest needs.
    const address = controlUrl ? await externalAddressViaUpnp(controlUrl, options) : "";
    return { ...manual, opened: true, protocol: viaNatpmp.protocol, externalPort: viaNatpmp.externalPort, address };
  }
  if (!controlUrl) {
    return { ...manual, opened: false, reason: viaNatpmp.reason || "Der Router bietet keine automatische Freigabe an." };
  }
  const viaUpnp = await (options.mapWithUpnp || mapWithUpnp)(controlUrl, port, localAddress, options);
  if (!viaUpnp.mapped) return { ...manual, opened: false, reason: viaUpnp.reason };
  const address = await externalAddressViaUpnp(controlUrl, options);
  return { ...manual, opened: true, protocol: viaUpnp.protocol, externalPort: viaUpnp.externalPort, address };
}

/**
 * Keeps a mapping alive for as long as the session runs.
 *
 * Routers hand out port mappings on a lease, and this one asks for an hour.
 * Without renewal a session that runs longer simply stops being reachable —
 * mid-sentence, with nothing on either side saying why, and with the invite
 * still looking valid. Renewing at two thirds of the lease leaves room for a
 * failed attempt before the mapping is actually gone.
 */
function createMappingRenewal(port, options = {}) {
  const seconds = Number(options.seconds) > 0 ? Number(options.seconds) : MAPPING_SECONDS;
  const open = options.openPublicPort || openPublicPort;
  const onResult = typeof options.onResult === "function" ? options.onResult : () => undefined;
  const schedule = options.schedule || ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return timer;
  });
  const cancel = options.cancel || ((timer) => clearTimeout(timer));
  let timer = null;
  let stopped = false;
  const again = () => {
    if (stopped) return;
    timer = schedule(() => {
      if (stopped) return;
      void Promise.resolve(open(port, options))
        .then((result) => { if (!stopped) onResult(result); })
        .catch((error) => { if (!stopped) onResult({ opened: false, reason: error.message, port }); })
        .then(() => { if (!stopped) again(); });
    }, Math.max(30_000, Math.floor(seconds * 1000 * 2 / 3)));
  };
  again();
  return {
    stop() {
      stopped = true;
      if (timer) cancel(timer);
      timer = null;
    },
    get running() {
      return !stopped;
    },
  };
}

module.exports = {
  MAPPING_SECONDS,
  addPortMappingBody,
  createMappingRenewal,
  askOnce,
  findGateway,
  localAddressFor,
  mapWithNatpmp,
  natpmpRequest,
  discoverUpnpControlUrl,
  externalAddressViaUpnp,
  httpText,
  mapWithUpnp,
  openPublicPort,
  soapCall,
  parseControlUrl,
  parseExternalAddress,
  parseGateway,
  parseNatpmpResponse,
  parseSsdpLocation,
};
