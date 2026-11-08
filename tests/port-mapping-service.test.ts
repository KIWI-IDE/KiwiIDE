import { describe, expect, it } from "vitest";

const {
  MAPPING_SECONDS,
  addPortMappingBody,
  createMappingRenewal,
  findGateway,
  localAddressFor,
  mapWithNatpmp,
  natpmpRequest,
  openPublicPort,
  parseControlUrl,
  parseExternalAddress,
  parseGateway,
  parseNatpmpResponse,
  parseSsdpLocation,
} = require("../electron/services/port-mapping-service.cjs");

/** A NAT-PMP answer the way a router sends one. */
function natpmpAnswer({ result = 0, internal = 7000, external = 7000, seconds = 3600 } = {}) {
  const message = Buffer.alloc(16);
  message.writeUInt8(0, 0);
  message.writeUInt8(130, 1);
  message.writeUInt16BE(result, 2);
  message.writeUInt32BE(1234, 4);
  message.writeUInt16BE(internal, 8);
  message.writeUInt16BE(external, 10);
  message.writeUInt32BE(seconds, 12);
  return message;
}

describe("finding the router", () => {
  it("reads the gateway out of what Windows prints", () => {
    // Guessing that a gateway ends in .1 is a convention, and the guess fails
    // silently on every network that does not follow it.
    const output = [
      "IPv4-Routentabelle",
      "Netzwerkziel    Netzwerkmaske          Gateway    Schnittstelle Metrik",
      "0.0.0.0          0.0.0.0      192.168.178.1  192.168.178.42     25",
    ].join("\n");
    expect(parseGateway(output, "win32")).toBe("192.168.178.1");
  });

  it("reads it out of what Linux and macOS print", () => {
    expect(parseGateway("default via 10.0.0.1 dev wlan0 proto dhcp", "linux")).toBe("10.0.0.1");
    expect(parseGateway("default            10.5.0.1           UGScg          en0", "darwin")).toBe("10.5.0.1");
  });

  it("answers with nothing rather than a wrong address", () => {
    expect(parseGateway("", "win32")).toBe("");
    expect(parseGateway("Keine Route", "linux")).toBe("");
  });

  it("asks the right command for the platform", async () => {
    const asked: string[] = [];
    const run = (command: string, args: string[]) => {
      asked.push(`${command} ${args.join(" ")}`);
      return "default via 10.0.0.1 dev eth0";
    };
    await findGateway({ platform: "linux", run });
    await findGateway({ platform: "win32", run });
    expect(asked).toEqual(["ip route", "route print 0.0.0.0"]);
  });

  it("picks the address on the router's own network", () => {
    // A machine with a VPN or a virtual switch has several, and mapping a port
    // to the wrong one produces a rule that forwards to nothing.
    const interfaces = {
      VirtualBox: [{ family: "IPv4", internal: false, address: "10.55.0.1" }],
      WLAN: [{ family: "IPv4", internal: false, address: "192.168.178.42" }],
      Loopback: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    };
    expect(localAddressFor("192.168.178.1", interfaces)).toBe("192.168.178.42");
    expect(localAddressFor("", interfaces)).toBe("10.55.0.1");
  });
});

describe("NAT-PMP", () => {
  it("builds the request the protocol describes", () => {
    const message = natpmpRequest(7000, 7000);
    expect(message).toHaveLength(12);
    expect(message.readUInt8(0)).toBe(0);
    expect(message.readUInt8(1)).toBe(2);
    expect(message.readUInt16BE(4)).toBe(7000);
    expect(message.readUInt32BE(8)).toBe(MAPPING_SECONDS);
  });

  it("reads a mapping out of the answer", () => {
    expect(parseNatpmpResponse(natpmpAnswer({ external: 7001 })))
      .toMatchObject({ ok: true, externalPort: 7001, seconds: 3600 });
  });

  it("passes on the router's refusal instead of only failing", async () => {
    // A router refuses for reasons worth repeating — most often that the
    // feature is switched off, which is something the host can go and change.
    expect(parseNatpmpResponse(natpmpAnswer({ result: 2 }))).toMatchObject({ ok: false, reason: /Fehlercode 2/ as never });
    const refused = await mapWithNatpmp("192.168.0.1", 7000, { ask: async () => natpmpAnswer({ result: 2 }) });
    expect(refused).toMatchObject({ mapped: false, protocol: "NAT-PMP" });
    expect(refused.reason).toMatch(/Fehlercode 2/);
  });

  it("treats silence as absence rather than waiting for ever", async () => {
    const quiet = await mapWithNatpmp("192.168.0.1", 7000, { ask: async () => null });
    expect(quiet).toMatchObject({ mapped: false });
  });

  it("reports a mapping when the router grants one", async () => {
    const granted = await mapWithNatpmp("192.168.0.1", 7000, { ask: async () => natpmpAnswer({ external: 7000 }) });
    expect(granted).toMatchObject({ mapped: true, externalPort: 7000 });
  });
});

describe("UPnP", () => {
  const description = `<?xml version="1.0"?><root><device><serviceList><service>
    <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
    <controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`;

  it("finds the service address, relative to where the description came from", () => {
    expect(parseControlUrl(description, "http://192.168.178.1:49000/desc.xml"))
      .toBe("http://192.168.178.1:49000/ctl/IPConn");
  });

  it("takes an absolute control address as it is", () => {
    const absolute = description.replace("/ctl/IPConn", "http://192.168.178.1:5000/ctl");
    expect(parseControlUrl(absolute, "http://192.168.178.1:49000/desc.xml"))
      .toBe("http://192.168.178.1:5000/ctl");
  });

  it("also accepts the PPP flavour some routers offer instead", () => {
    const ppp = description.replace("WANIPConnection", "WANPPPConnection");
    expect(parseControlUrl(ppp, "http://10.0.0.1/d.xml")).toBe("http://10.0.0.1/ctl/IPConn");
  });

  it("answers with nothing when the device has no such service", () => {
    expect(parseControlUrl("<root><device/></root>", "http://10.0.0.1/d.xml")).toBe("");
  });

  it("reads the location a router answered SSDP with", () => {
    const answer = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://10.0.0.1:5000/desc.xml\r\n\r\n";
    expect(parseSsdpLocation(answer)).toBe("http://10.0.0.1:5000/desc.xml");
    expect(parseSsdpLocation("HTTP/1.1 200 OK\r\n\r\n")).toBe("");
  });

  it("asks for exactly the port the session is listening on", () => {
    const body = addPortMappingBody(7000, 7000, "192.168.178.42");
    expect(body).toContain("<NewExternalPort>7000</NewExternalPort>");
    expect(body).toContain("<NewInternalPort>7000</NewInternalPort>");
    expect(body).toContain("<NewInternalClient>192.168.178.42</NewInternalClient>");
    expect(body).toContain("<NewProtocol>TCP</NewProtocol>");
  });

  it("reads the public address out of the answer", () => {
    expect(parseExternalAddress("<NewExternalIPAddress>82.1.2.3</NewExternalIPAddress>")).toBe("82.1.2.3");
    expect(parseExternalAddress("<NewExternalIPAddress></NewExternalIPAddress>")).toBe("");
  });
});

describe("opening the port for a session", () => {
  const base = {
    gateway: "192.168.178.1",
    localAddress: "192.168.178.42",
    discoverUpnpControlUrl: async () => "",
  };

  it("uses NAT-PMP when the router answers it", async () => {
    const result = await openPublicPort(7000, {
      ...base,
      mapWithNatpmp: async () => ({ mapped: true, protocol: "NAT-PMP", externalPort: 7000 }),
    });
    expect(result).toMatchObject({ opened: true, protocol: "NAT-PMP", externalPort: 7000 });
  });

  it("falls back to UPnP, which far more routers speak", async () => {
    const result = await openPublicPort(7000, {
      ...base,
      controlUrl: "http://192.168.178.1/ctl",
      mapWithNatpmp: async () => ({ mapped: false, reason: "keine Antwort" }),
      mapWithUpnp: async () => ({ mapped: true, protocol: "UPnP", externalPort: 7000 }),
      fetchText: async () => "<NewExternalIPAddress>82.1.2.3</NewExternalIPAddress>",
    });
    expect(result).toMatchObject({ opened: true, protocol: "UPnP", address: "82.1.2.3" });
  });

  it("hands back what a manual forwarding rule needs when both refuse", async () => {
    // The point of this branch: a router that will not do it automatically is
    // not a dead end, and the port and address are exactly what the router's
    // own configuration page asks for.
    const result = await openPublicPort(7000, {
      ...base,
      controlUrl: "http://192.168.178.1/ctl",
      mapWithNatpmp: async () => ({ mapped: false, reason: "keine Antwort" }),
      mapWithUpnp: async () => ({ mapped: false, reason: "Freigabe ist deaktiviert" }),
    });
    expect(result).toMatchObject({
      opened: false,
      reason: "Freigabe ist deaktiviert",
      port: 7000,
      localAddress: "192.168.178.42",
      gateway: "192.168.178.1",
    });
  });

  it("says the router was not found rather than trying to map onto nothing", async () => {
    const result = await openPublicPort(7000, { gateway: "", localAddress: "", discoverUpnpControlUrl: async () => "" });
    expect(result).toMatchObject({ opened: false });
    expect(result.reason).toMatch(/nicht zu finden/);
  });
});

describe("keeping the mapping alive", () => {
  /** A renewal driven by a clock the test owns. */
  function renewalOver(results: Array<Record<string, unknown>>) {
    const fired: Array<() => void> = [];
    const delays: number[] = [];
    const seen: Array<Record<string, unknown>> = [];
    let call = 0;
    const renewal = createMappingRenewal(7000, {
      seconds: 3600,
      openPublicPort: async () => results[Math.min(call++, results.length - 1)],
      onResult: (result: Record<string, unknown>) => seen.push(result),
      schedule: (callback: () => void, delay: number) => {
        delays.push(delay);
        fired.push(callback);
        return fired.length;
      },
      cancel: () => undefined,
    });
    return { renewal, fired, delays, seen };
  }

  it("renews well before the lease runs out", () => {
    // A session that outlives its lease simply stops being reachable, with
    // nothing on either side saying why and the invite still looking valid.
    const { delays } = renewalOver([{ opened: true }]);
    expect(delays[0]).toBe(2_400_000);
    expect(delays[0]).toBeLessThan(3_600_000);
  });

  it("asks again, and keeps asking", async () => {
    const { fired, seen } = renewalOver([{ opened: true, protocol: "UPnP" }]);
    fired[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([{ opened: true, protocol: "UPnP" }]);
    expect(fired).toHaveLength(2);
  });

  it("reports a renewal the router refused rather than going quiet", async () => {
    // The host can then say so while the session still works, instead of the
    // guests dropping out an hour later for no stated reason.
    const { fired, seen } = renewalOver([{ opened: false, reason: "Freigabe ist deaktiviert" }]);
    fired[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen[0]).toMatchObject({ opened: false, reason: "Freigabe ist deaktiviert" });
  });

  it("stops when the session does, and answers nothing afterwards", async () => {
    const { renewal, fired, seen } = renewalOver([{ opened: true }]);
    renewal.stop();
    fired[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([]);
    expect(renewal.running).toBe(false);
  });

  it("never renews faster than every half minute, whatever it is told", () => {
    const delays: number[] = [];
    createMappingRenewal(7000, {
      seconds: 1,
      openPublicPort: async () => ({ opened: true }),
      schedule: (_callback: () => void, delay: number) => { delays.push(delay); return 1; },
      cancel: () => undefined,
    });
    expect(delays[0]).toBe(30_000);
  });
});
