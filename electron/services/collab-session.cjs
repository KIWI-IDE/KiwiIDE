const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const { attachSecureChannel } = require("./collab-secure-channel.cjs");
const { relayGreeting, roomForToken } = require("./collab-relay-service.cjs");

const {
  MAX_MESSAGE_BYTES,
  MAX_SHARED_FILE_BYTES,
  SharedDocument,
  createInviteCode,
  createToken,
  isSharedAction,
  mayDo,
  mayEdit,
  normalizePermissions,
  normalizeRole,
  parseInviteCode,
  permissionForAction,
  reachableAddresses,
  readSharedTree,
  resolveShared,
  readSharedText,
  resolveSharedExisting,
  shareRelative,
  sharedTextHash,
  tokensMatch,
} = require("./collab-service.cjs");

const MAX_PEER_REQUESTS = 32;

/**
 * The two ends of a CodeToGetter session.
 *
 * The rules live next door in collab-service.cjs and are plain functions, so
 * they can be tested without a socket. What is here is the part that cannot be:
 * who is connected, what they are allowed to ask for, and what happens to an
 * answer on the way back.
 */

/**
 * The host: the developer who has the project on disk.
 *
 * Every path a guest sends is project-relative and goes through
 * resolveSharedExisting(), which is the whole of what stands between a shared folder
 * and the rest of the disk. A guest is never told an absolute path and cannot
 * name one.
 */
class CollabHost {
  constructor({
    root,
    send = () => undefined,
    token = createToken(),
    projectName = "",
    maxPeers = 8,
    defaultRole = "lesen",
    hostOnly = false,
    writeFile = fs.writeFile,
  }) {
    if (!root) throw new Error("Ohne Projektordner lässt sich nichts teilen.");
    this.root = path.resolve(root);
    this.projectName = projectName || path.basename(this.root);
    this.token = token;
    this.send = send;
    this.server = null;
    this.port = 0;
    this.addresses = [];
    this.invite = "";
    this.publicAddress = "";
    this.publicPort = 0;
    this.peers = new Map();
    this.documents = new Map();
    this.documentLoads = new Map();
    this.saveQueues = new Map();
    this.documentEpoch = 0;
    this.nextPeerId = 1;
    this.maxPeers = Math.max(1, Math.min(Number(maxPeers) || 8, 32));
    // What a guest may do until the host says otherwise. Reading, so that
    // forgetting to decide cannot hand somebody write access to a project.
    this.defaultRole = normalizeRole(defaultRole);
    /**
     * Whether guests may keep a copy of this project on their own disk.
     *
     * A guest normally gets a working copy in a temporary folder, because
     * that is what makes the language server, the build and the debugger work
     * for them. For a codebase that may not leave this machine, the trade goes
     * the other way: nothing is written down, and the guest reads and edits
     * through the connection alone.
     *
     * Decided by the host, sent in the welcome, and enforced on both ends —
     * the host refuses to hand out a bundle, so a guest that ignores the flag
     * still gets nothing.
     */
    this.hostOnly = Boolean(hostOnly);
    this.connections = new Set();
    /** Set while this session is reached through a relay rather than directly. */
    this.relayControl = null;
    this.relay = null;
    /** Addresses refused for the rest of this session. */
    this.blocked = new Set();
    this.realRoot = fs.realpath(this.root);
    this.writeFile = writeFile;
    this.stopping = false;
    this.lifecycleGeneration = 0;
    this.stopPromise = null;
  }

  /** Starts listening. Port 0 lets the operating system pick a free one. */
  start(port = 0, host = "0.0.0.0") {
    if (this.server) return Promise.reject(new Error("Die Sitzung läuft bereits."));
    if (this.stopPromise) return Promise.reject(new Error("Die vorherige Sitzung wird noch beendet."));
    this.stopping = false;
    const generation = this.lifecycleGeneration + 1;
    this.lifecycleGeneration = generation;
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.acceptConnection(socket));
      // Register before listen(): stop() must be able to find and cancel a
      // server whose listening callback has not fired yet.
      this.server = server;
      server.on("error", (error) => {
        if (this.server === server) this.server = null;
        reject(new Error(`Die Sitzung konnte nicht gestartet werden: ${error.message}`));
      });
      server.listen(port, host, () => {
        if (generation !== this.lifecycleGeneration || this.stopping || this.server !== server) {
          reject(new Error("Der Sitzungsstart wurde abgebrochen."));
          return;
        }
        this.port = server.address().port;
        this.addresses = reachableAddresses();
        this.invite = createInviteCode({
          host: this.addresses[0] || "127.0.0.1",
          port: this.port,
          token: this.token,
          project: this.projectName,
        });
        resolve({
          port: this.port,
          token: this.token,
          addresses: this.addresses,
          project: this.projectName,
          invite: this.invite,
        });
      });
    });
  }

  /**
   * Points the invite at the address the rest of the internet can reach.
   *
   * Only called once the router has actually granted the forwarding: an invite
   * carrying a public address that leads nowhere is worse than one that only
   * works on the local network, because the guest cannot tell which of the two
   * they were handed.
   */
  setPublicAddress(address, externalPort) {
    const host = String(address || "").trim();
    const port = Number(externalPort) || this.port;
    if (!host || this.relay || !this.server?.listening) return this.invite;
    this.publicAddress = host;
    this.publicPort = port;
    this.invite = createInviteCode({
      host,
      port,
      token: this.token,
      project: this.projectName,
    });
    return this.invite;
  }

  /**
   * Hosts through a relay instead of listening for connections.
   *
   * Nothing here waits to be dialled. The host keeps one connection open to the
   * relay, is told when a guest arrives, and dials the relay again for that
   * guest — three outgoing connections and not one incoming, which is exactly
   * why no router has to be persuaded of anything.
   *
   * The sockets that come back go through the same acceptConnection() as a
   * direct one. Nothing above this line knows or needs to know which it is.
   */
  startViaRelay(relayHost, relayPort, options = {}) {
    if (this.server || this.relayControl) return Promise.reject(new Error("Die Sitzung läuft bereits."));
    const connect = options.createConnection || net.createConnection;
    const room = roomForToken(this.token);
    this.stopping = false;
    const generation = this.lifecycleGeneration + 1;
    this.lifecycleGeneration = generation;
    return new Promise((resolve, reject) => {
      const control = connect({ host: relayHost, port: relayPort }, () => {
        control.write(relayGreeting("host", room));
      });
      this.relayControl = control;
      let buffer = "";
      let welcomed = false;
      const fail = (error) => {
        if (this.relayControl === control) this.relayControl = null;
        control.destroy();
        reject(error);
      };
      control.setEncoding("utf8");
      control.on("error", (error) => fail(new Error(`Das Relay ist nicht erreichbar: ${error.message}`)));
      control.on("close", () => {
        if (this.relayControl === control) this.relayControl = null;
        if (!welcomed) fail(new Error("Das Relay hat die Verbindung beendet."));
      });
      control.on("data", (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message?.type === "error") {
            fail(new Error(String(message.message || "Das Relay hat die Sitzung abgelehnt.")));
            return;
          }
          if (message?.ok && !welcomed) {
            welcomed = true;
            if (generation !== this.lifecycleGeneration || this.stopping) {
              fail(new Error("Der Sitzungsstart wurde abgebrochen."));
              return;
            }
            this.relay = { host: relayHost, port: Number(relayPort) };
            this.addresses = [relayHost];
            this.port = Number(relayPort);
            this.invite = createInviteCode({
              host: relayHost,
              port: Number(relayPort),
              token: this.token,
              project: this.projectName,
              relay: true,
            });
            resolve({
              port: this.port,
              token: this.token,
              addresses: this.addresses,
              project: this.projectName,
              invite: this.invite,
              relay: this.relay,
            });
            continue;
          }
          if (message?.type === "connect" && message.id) {
            // One more outgoing connection, and the guest on the other side of
            // it is indistinguishable from one that dialled us directly.
            const data = connect({ host: relayHost, port: relayPort }, () => {
              data.write(relayGreeting("host-data", room, String(message.id)));
              this.acceptConnection(data);
            });
            data.on("error", () => data.destroy());
          }
        }
      });
    });
  }

  /** Renderer-safe state: the secret only occurs inside the copyable invite. */
  state() {
    return {
      hosting: Boolean(this.server?.listening) || Boolean(this.relayControl),
      relay: this.relay,
      port: this.port,
      addresses: [...this.addresses],
      root: this.root,
      project: this.projectName,
      invite: this.invite,
      peers: this.peerList(),
      defaultRole: this.defaultRole,
      hostOnly: this.hostOnly,
      publicAddress: this.publicAddress,
      publicPort: this.publicPort,
    };
  }

  /** Ends the session and disconnects every guest. */
  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.lifecycleGeneration += 1;
    this.documentEpoch += 1;
    // The relay holds the room for as long as the control connection lives.
    // Leaving it open would keep the next session out of its own room.
    this.relayControl?.destroy();
    this.relayControl = null;
    this.relay = null;
    const server = this.server;
    this.server = null;
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    this.peers.clear();
    this.documents.clear();
    this.port = 0;
    this.addresses = [];
    this.invite = "";
    this.publicAddress = "";
    this.publicPort = 0;
    const closeServer = new Promise((resolve) => {
      if (!server) { resolve(); return; }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        server.removeListener("listening", closeListeningServer);
        server.removeListener("error", finish);
        resolve();
      };
      const closeListeningServer = () => {
        if (!server.listening) { finish(); return; }
        server.close(finish);
      };
      server.once("error", finish);
      if (server.listening) closeListeningServer();
      else server.once("listening", closeListeningServer);
    });
    // The map stores the tail for each document, so awaiting its values drains
    // every earlier queued save as well. Loads are captured before their map is
    // cleared for the same reason.
    const pending = [closeServer, ...this.documentLoads.values(), ...this.saveQueues.values()];
    this.stopPromise = Promise.allSettled(pending).then(() => {
      this.documentLoads.clear();
      this.saveQueues.clear();
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  acceptConnection(socket) {
    if (this.stopping) { socket.destroy(); return; }
    // Registered before any refusal below: stop() closes what is in here, and
    // a socket turned away without being tracked left the server waiting for a
    // connection nothing would ever close.
    this.connections.add(socket);
    socket.once("close", () => this.connections.delete(socket));
    if (this.connections.size >= this.maxPeers + 4) {
      socket.end(`${JSON.stringify({ type: "error", message: "Die CodeToGetter-Sitzung nimmt keine weiteren Verbindungen an." })}
`);
      socket.destroy();
      return;
    }
    const peer = {
      id: 0,
      name: "",
      socket,
      authenticated: false,
      authTimer: null,
      inFlight: 0,
      role: this.defaultRole,
      address: socket.remoteAddress || "",
      since: Date.now(),
    };
    if (this.blocked.has(peer.address)) {
      socket.end(`${JSON.stringify({ type: "error", message: "Der Gastgeber hat dich für diese Sitzung gesperrt." })}
`);
      return;
    }
    // No encoding: the greeting is two lines of ASCII and everything after it
    // is sealed bytes, so the socket must stay binary.
    // Hanging up is the whole of what a host can say here. The greeting has
    // already gone out, so the guest is reading sealed frames by now and a
    // plaintext refusal would be taken for a frame header — the guest then
    // reported an overlong frame instead of a wrong key. What can be said is
    // said on the guest's side, where a handshake ending in a closed socket
    // has exactly one likely cause.
    const fail = () => socket.destroy();
    peer.channel = attachSecureChannel(socket, {
      token: this.token,
      isHost: true,
      maxFrameBytes: MAX_MESSAGE_BYTES,
      onError: fail,
      onMessage: (message) => {
        if (peer.inFlight >= MAX_PEER_REQUESTS) {
          peer.channel.send({
            type: "answer",
            id: message?.id,
            ok: false,
            message: "Zu viele gleichzeitige CodeToGetter-Anfragen.",
          });
          return;
        }
        peer.inFlight += 1;
        this.handleMessage(peer, message)
          .catch((error) => {
            peer.channel.send({ type: "answer", id: message?.id, ok: false, message: error.message });
          })
          .finally(() => { peer.inFlight = Math.max(0, peer.inFlight - 1); });
      },
    });
    socket.on("error", () => this.dropPeer(peer));
    socket.on("close", () => {
      clearTimeout(peer.authTimer);
      this.connections.delete(socket);
      this.dropPeer(peer);
    });
    // A connection that never authenticates is not a guest, and leaving it
    // open is an invitation to hold the socket forever.
    peer.authTimer = setTimeout(() => {
      if (!peer.authenticated) fail(new Error("Zeitüberschreitung bei der Anmeldung."));
    }, 10_000);
    peer.authTimer.unref?.();
  }

  dropPeer(peer) {
    if (!peer.id || !this.peers.has(peer.id)) return;
    const name = peer.name;
    this.peers.delete(peer.id);
    this.publish("collab:peers", { peers: this.peerList(), left: name });
    this.broadcast({ type: "peers", peers: this.peerList() });
  }

  peerList() {
    return [...this.peers.values()].map((peer) => ({
      id: peer.id,
      name: peer.name,
      role: peer.role,
      permissions: normalizePermissions(peer.permissions, peer.role),
      address: peer.address,
      since: peer.since,
    }));
  }

  /**
   * Changes what one guest may do, while they are connected.
   *
   * The guest is told directly rather than left to infer it from a refusal:
   * an editor that silently stops accepting what is typed into it is worse
   * than one that says it is now read-only.
   */
  setPeerRole(peerId, role) {
    const peer = this.peers.get(Number(peerId));
    if (!peer) throw new Error("Dieser Gast ist nicht mehr verbunden.");
    peer.role = normalizeRole(role, peer.role);
    // The role keeps meaning what it meant, so granting it hands over the two
    // permissions it always stood for and takes back everything else.
    peer.permissions = normalizePermissions(undefined, peer.role);
    peer.channel.send({ type: "role", role: peer.role, permissions: peer.permissions });
    this.publish("collab:peers", { peers: this.peerList() });
    this.broadcast({ type: "peers", peers: this.peerList() });
    return { id: peer.id, name: peer.name, role: peer.role, permissions: peer.permissions };
  }

  /**
   * Grants a guest exactly the things they are named for.
   *
   * Separate from the role because these are separately dangerous: a build runs
   * the project's own scripts on this machine, a terminal is a shell on it, and
   * Git can push. Somebody who should be able to type in a file needs none of
   * them, and the role could not express that.
   */
  setPeerPermissions(peerId, permissions) {
    const peer = this.peers.get(Number(peerId));
    if (!peer) throw new Error("Dieser Gast ist nicht mehr verbunden.");
    peer.permissions = normalizePermissions(permissions, peer.role);
    // The role follows the permissions rather than the other way round, so an
    // interface that only understands roles is never told something untrue.
    peer.role = peer.permissions.includes("bearbeiten") ? "bearbeiten" : "lesen";
    peer.channel.send({ type: "role", role: peer.role, permissions: peer.permissions });
    this.publish("collab:peers", { peers: this.peerList() });
    this.broadcast({ type: "peers", peers: this.peerList() });
    return { id: peer.id, name: peer.name, role: peer.role, permissions: peer.permissions };
  }

  /**
   * Sends one guest away, telling them why.
   *
   * A connection that simply drops is indistinguishable from a network that
   * failed, and somebody who thinks their connection broke will reconnect
   * immediately — which is the opposite of what the host just asked for.
   */
  disconnectPeer(peerId, reason = "Der Gastgeber hat die Sitzung für dich beendet.") {
    const peer = this.peers.get(Number(peerId));
    if (!peer) throw new Error("Dieser Gast ist nicht mehr verbunden.");
    peer.channel.send({ type: "removed", message: reason });
    // A moment for the message to leave before the socket goes, otherwise the
    // guest is told nothing and the point of saying it is lost.
    const timer = setTimeout(() => peer.socket.destroy(), 50);
    timer.unref?.();
    return { id: peer.id, name: peer.name };
  }

  /**
   * Sends a guest away and refuses them if they come back.
   *
   * Held against the address, because that is the only thing about a guest this
   * side did not let them choose: the name comes from their own settings, and
   * the invite is a secret several people may hold by the time a host wants one
   * of them gone.
   */
  blockPeer(peerId) {
    const peer = this.peers.get(Number(peerId));
    if (!peer) throw new Error("Dieser Gast ist nicht mehr verbunden.");
    if (peer.address) this.blocked.add(peer.address);
    const removed = this.disconnectPeer(peerId, "Der Gastgeber hat dich für diese Sitzung gesperrt.");
    this.publish("collab:peers", { peers: this.peerList(), blocked: [...this.blocked] });
    return { ...removed, address: peer.address };
  }

  /** Lets a blocked address back in. */
  unblock(address) {
    this.blocked.delete(String(address || ""));
    this.publish("collab:peers", { peers: this.peerList(), blocked: [...this.blocked] });
    return [...this.blocked];
  }

  /** What guests joining from now on may do. */
  /**
   * Turns the strict mode on or off for guests joining from now on.
   *
   * Not retroactive on purpose: a guest that already built a working copy has
   * the files, and pretending otherwise by flipping a flag would be a promise
   * the host cannot keep. Whoever needs it kept has to end the session.
   */
  setHostOnly(hostOnly) {
    this.hostOnly = Boolean(hostOnly);
    this.publish("collab:peers", { peers: this.peerList(), hostOnly: this.hostOnly });
    return this.hostOnly;
  }

  setDefaultRole(role) {
    this.defaultRole = normalizeRole(role, this.defaultRole);
    this.publish("collab:peers", { peers: this.peerList(), defaultRole: this.defaultRole });
    return this.defaultRole;
  }

  publish(channel, payload) {
    this.send(channel, { ...payload, session: "host" });
  }

  /** Sends to every authenticated guest, optionally skipping one. */
  broadcast(message, exceptId = 0) {
    for (const peer of this.peers.values()) {
      if (peer.id === exceptId) continue;
      peer.channel.send(message);
    }
  }

  /** The document for a path, read from disk the first time it is asked for. */
  /**
   * Creates, renames, moves or deletes a file in the shared project.
   *
   * Every path goes through resolveShared, which is what keeps a guest inside
   * the folder that was shared — a name like "../../.ssh" is a request, not a
   * fact. A rename or move is one operation to the filesystem and has to be one
   * here too, or a half-finished move leaves the project without the file.
   */
  async mutateTree(message) {
    if (this.stopping) throw new Error("Die CodeToGetter-Sitzung wird beendet.");
    const kind = String(message.type);
    if (kind === "createEntry") {
      const target = resolveShared(this.root, String(message.path || ""));
      if (await fs.stat(target).then(() => true).catch(() => false)) {
        throw new Error("Es gibt dort bereits eine Datei oder einen Ordner.");
      }
      if (message.directory) {
        await fs.mkdir(target, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, String(message.text || ""), "utf8");
      }
      return { created: true, path: shareRelative(await this.realRoot, target) };
    }
    if (kind === "deleteEntry") {
      const target = await resolveSharedExisting(this.root, String(message.path || ""));
      await fs.rm(target, { recursive: true, force: true });
      this.forgetDocument(String(message.path || ""));
      return { deleted: true };
    }
    // Rename and move differ only in whether the folder changes, so one path
    // handles both and the caller's wording decides nothing.
    const from = await resolveSharedExisting(this.root, String(message.path || ""));
    const to = resolveShared(this.root, String(message.target || ""));
    if (await fs.stat(to).then(() => true).catch(() => false)) {
      throw new Error("Am Ziel gibt es bereits eine Datei oder einen Ordner.");
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    this.forgetDocument(String(message.path || ""));
    return { moved: true, path: shareRelative(await this.realRoot, to) };
  }

  /** Drops a cached document whose file is no longer where it was. */
  forgetDocument(relativePath) {
    const key = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    for (const candidate of [...this.documents.keys()]) {
      if (candidate === key || candidate.startsWith(`${key}/`) || candidate.startsWith(`${key}\\`)) {
        this.documents.delete(candidate);
      }
    }
  }

  async document(relativePath) {
    if (this.stopping) throw new Error("Die CodeToGetter-Sitzung wird beendet.");
    const absolute = await resolveSharedExisting(this.root, relativePath);
    const canonicalPath = shareRelative(await this.realRoot, absolute);
    const key = process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath;
    const existing = this.documents.get(key);
    if (existing) return existing;
    const pending = this.documentLoads.get(key);
    if (pending) return pending;
    const epoch = this.documentEpoch;
    const load = (async () => {
      const { text } = await readSharedText(this.root, canonicalPath);
      const document = new SharedDocument(canonicalPath, text, sharedTextHash(text));
      if (this.documentEpoch === epoch) this.documents.set(key, document);
      return document;
    })();
    this.documentLoads.set(key, load);
    try {
      return await load;
    } finally {
      if (this.documentLoads.get(key) === load) this.documentLoads.delete(key);
    }
  }

  /**
   * Serializes disk writes for one canonical document.
   *
   * Two guests can press save close enough together for both handlers to be
   * alive at once. Without this queue, the older write may finish last and its
   * hash may describe a different order than the bytes on disk.
   */
  async saveDocument(document) {
    if (this.stopping) throw new Error("Die CodeToGetter-Sitzung wird beendet.");
    const key = process.platform === "win32" ? document.path.toLowerCase() : document.path;
    const previous = this.saveQueues.get(key) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const { absolute, text: diskText } = await readSharedText(this.root, document.path);
      const diskHash = sharedTextHash(diskText);
      if (diskHash !== document.diskHash) {
        document.text = diskText;
        document.diskHash = diskHash;
        document.version += 1;
        document.history.clear();
        document.lengths.clear();
        document.lengths.set(document.version, document.text.length);
        document.dirty = false;
        return {
          response: { saved: false, conflict: true, text: document.text, version: document.version },
          reset: { type: "reset", path: document.path, text: document.text, version: document.version },
        };
      }

      // The editor can continue changing while the asynchronous disk write is
      // in flight. The baseline must describe the exact bytes written, not
      // whichever text happens to be current when writeFile resolves.
      const snapshotText = document.text;
      const snapshotVersion = document.version;
      const snapshotHash = sharedTextHash(snapshotText);
      await this.writeFile(absolute, snapshotText, "utf8");
      document.diskHash = snapshotHash;
      document.dirty = sharedTextHash(document.text) !== snapshotHash;
      return {
        response: {
          saved: true,
          version: snapshotVersion,
          currentVersion: document.version,
          dirty: document.dirty,
        },
      };
    });
    this.saveQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.saveQueues.get(key) === operation) this.saveQueues.delete(key);
    }
  }

  async handleMessage(peer, message) {
    const answer = (payload) => peer.channel.send({ type: "answer", id: message?.id, ok: true, ...payload });
    if (message?.type === "hello") {
      if (peer.authenticated) throw new Error("Die Verbindung ist bereits angemeldet.");
      if (!tokensMatch(this.token, message.token)) {
        peer.channel.send({ type: "error", message: "Der Einladungsschlüssel stimmt nicht." });
        peer.socket.destroy();
        return;
      }
      if (this.peers.size >= this.maxPeers) {
        peer.channel.send({ type: "error", message: "Die CodeToGetter-Sitzung ist voll." });
        peer.socket.destroy();
        return;
      }
      clearTimeout(peer.authTimer);
      peer.authenticated = true;
      peer.id = this.nextPeerId;
      this.nextPeerId += 1;
      peer.name = String(message.name || "Gast").slice(0, 40);
      this.peers.set(peer.id, peer);
      answer({
        project: this.projectName,
        peerId: peer.id,
        peers: this.peerList(),
        role: peer.role,
        // The permissions, not only the role they used to stand for: a guest
        // cannot offer a button for something it does not know it may do.
        permissions: normalizePermissions(peer.permissions, peer.role),
        hostOnly: this.hostOnly,
      });
      this.publish("collab:peers", { peers: this.peerList(), joined: peer.name });
      this.broadcast({ type: "peers", peers: this.peerList() }, peer.id);
      return;
    }
    // Nothing but hello is answered before the token has been checked.
    if (!peer.authenticated) {
      peer.socket.destroy();
      return;
    }
    // Read-only is enforced here and nowhere else. A guest is a program on
    // another machine: whatever its interface allows, this is the side that
    // owns the disk, so this is the side that decides.
    if (message?.type === "edit" && !mayDo(peer, "bearbeiten")) {
      throw new Error("Du darfst in dieser Sitzung nur lesen.");
    }
    // Saving is its own grant: somebody may be allowed to try something in a
    // buffer without being allowed to put it on the host's disk.
    if (message?.type === "save" && !mayDo(peer, "speichern")) {
      // Which of the two it is matters to whoever reads it: somebody who may
      // not edit either is simply reading, while somebody who may edit but not
      // save has been given one of the two on purpose.
      throw new Error(mayDo(peer, "bearbeiten")
        ? "Du darfst in dieser Sitzung nicht speichern."
        : "Du darfst in dieser Sitzung nur lesen.");
    }
    // A guest asking the host's machine to build, test, run or debug. The
    // permission is checked here and nowhere else: whatever a guest's
    // interface allows, this is the side that owns the processes.
    if (message?.type === "run") {
      if (!isSharedAction(message.action)) throw new Error("Unbekannte Aktion.");
      const permission = permissionForAction(message.action);
      if (!mayDo(peer, permission)) {
        throw new Error(permission === "debug"
          ? "Du darfst in dieser Sitzung nicht debuggen."
          : "Du darfst in dieser Sitzung nichts bauen oder ausführen.");
      }
      // The session does not own the build; it says what was asked for and by
      // whom, and the window that owns the project runs it. One code path for
      // running means guests see exactly the output the host sees.
      this.publish("collab:runRequest", {
        projectRoot: this.root,
        action: String(message.action).trim().toLowerCase(),
        by: peer.id,
        name: peer.name,
      });
      answer({ started: true });
      return;
    }
    if (message?.type === "tree") {
      answer(await readSharedTree(this.root));
      return;
    }
    if (message?.type === "bundle" && this.hostOnly) {
      // The flag told the guest not to write anything down; this is what makes
      // that true for a guest that did not listen.
      throw new Error("Der Gastgeber erlaubt keine lokale Kopie des Projekts.");
    }
    if (message?.type === "bundle") {
      // Many files in one answer, for a guest building its working copy. Asked
      // for one at a time this is hundreds of round trips before the project is
      // usable, and on anything but a local network that is the whole of what
      // joining feels like.
      //
      // Read straight from disk rather than through document(): that cache is
      // for files somebody has open, and filling it with an entire project
      // would keep every one of them in the host's memory for the session.
      const wanted = Array.isArray(message.paths) ? message.paths.slice(0, 400) : [];
      const files = [];
      let bytes = 0;
      for (const requested of wanted) {
        if (bytes >= MAX_MESSAGE_BYTES / 2) break;
        const relative = String(requested || "");
        try {
          const absolute = await resolveSharedExisting(this.root, relative);
          const { text } = await readSharedText(this.root, shareRelative(await this.realRoot, absolute));
          files.push({ path: relative, text });
          bytes += text.length;
        } catch (error) {
          // Named rather than dropped: a guest whose copy is missing a file
          // should be able to see which one and why.
          files.push({ path: relative, error: error.message });
        }
      }
      answer({ files, remaining: Math.max(0, wanted.length - files.length) });
      return;
    }
    if (message?.type === "open") {
      const document = await this.document(String(message.path || ""));
      answer({ path: document.path, text: document.text, version: document.version });
      return;
    }
    if (message?.type === "edit") {
      const document = await this.document(String(message.path || ""));
      const result = document.apply(message.edit, Number(message.baseVersion));
      if (!result.ok) {
        // The guest gets the whole text back rather than a refusal it cannot
        // act on: an editor that is out of step has to be put back in step.
        answer({ applied: false, reason: result.reason, text: result.text, version: result.version });
        return;
      }
      answer({ applied: true, version: result.version, edit: result.edit });
      this.broadcast({ type: "edit", path: document.path, edit: result.edit, version: result.version, by: peer.id }, peer.id);
      // The host's own editor is showing the file the guest is typing in.
      this.publish("collab:edit", { path: document.path, edit: result.edit, version: result.version, by: peer.name });
      return;
    }
    if (message?.type === "save") {
      const document = await this.document(String(message.path || ""));
      const saved = await this.saveDocument(document);
      answer(saved.response);
      if (saved.reset) {
        this.broadcast(saved.reset, peer.id);
        this.publish("collab:reset", saved.reset);
        return;
      }
      this.publish("collab:saved", {
        path: document.path,
        by: peer.name,
        version: saved.response.version,
        currentVersion: saved.response.currentVersion,
        dirty: saved.response.dirty,
      });
      this.broadcast({
        type: "saved",
        path: document.path,
        by: peer.id,
        version: saved.response.version,
        currentVersion: saved.response.currentVersion,
        dirty: saved.response.dirty,
      }, peer.id);
      return;
    }
    if (message?.type === "cursor") {
      // A selection rather than a point: where somebody is looking is most of
      // what makes following them useful, and a caret alone does not show it.
      // The host is told as well as the other guests, because the host's editor
      // is where the marks are drawn.
      const place = {
        type: "cursor",
        path: String(message.path || ""),
        offset: Number(message.offset) || 0,
        anchor: Number.isFinite(Number(message.anchor)) ? Number(message.anchor) : Number(message.offset) || 0,
        by: peer.id,
        name: peer.name,
      };
      this.broadcast(place, peer.id);
      this.send("collab:cursor", { projectRoot: this.root, ...place });
      answer({ sent: true });
      return;
    }
    if (message?.type === "createEntry" || message?.type === "renameEntry" || message?.type === "moveEntry"
      || message?.type === "deleteEntry") {
      if (!mayDo(peer, "bearbeiten")) throw new Error("Für diese Aktion fehlt die Berechtigung.");
      const result = await this.mutateTree(message);
      // Everybody sees the project change, not only whoever asked for it.
      const listing = await readSharedTree(this.root);
      this.broadcast({ type: "tree", entries: listing.entries });
      this.send("collab:treeChanged", { projectRoot: this.root });
      answer(result);
      return;
    }
    throw new Error(`Unbekannte Anfrage: ${String(message?.type || "")}`);
  }

  /**
   * An edit the host made in its own editor, passed on to the guests.
   *
   * The host writes its own disk, so nothing is applied here beyond keeping the
   * shared copy in step and telling the guests what changed.
   */
  async localEdit(relativePath, edit, baseVersion) {
    const document = await this.document(relativePath);
    const revision = Number.isInteger(baseVersion) ? baseVersion : document.version;
    const result = document.apply(edit, revision);
    if (!result.ok) return result;
    this.broadcast({ type: "edit", path: document.path, edit: result.edit, version: result.version, by: 0 });
    return result;
  }

  async localSnapshot(relativePath) {
    const document = await this.document(relativePath);
    return { path: document.path, text: document.text, version: document.version, dirty: document.dirty };
  }

  /** Persists the host editor through the same queue used by guest saves. */
  async localSave(relativePath) {
    const document = await this.document(relativePath);
    const saved = await this.saveDocument(document);
    if (saved.reset) {
      this.broadcast(saved.reset);
      this.publish("collab:reset", saved.reset);
      return saved.response;
    }
    const event = {
      type: "saved",
      path: document.path,
      by: 0,
      version: saved.response.version,
      currentVersion: saved.response.currentVersion,
      dirty: saved.response.dirty,
    };
    this.broadcast(event);
    this.publish("collab:saved", event);
    return saved.response;
  }

  /** Replaces a document wholesale, for a file the host reloaded from disk. */
  async localReplace(relativePath, text) {
    const document = await this.document(relativePath);
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_SHARED_FILE_BYTES) {
      throw new Error(`Die gemeinsame Datei darf höchstens ${Math.floor(MAX_SHARED_FILE_BYTES / 1024 / 1024)} MiB groß sein.`);
    }
    document.text = text;
    document.version += 1;
    document.history.clear();
    document.lengths.clear();
    document.lengths.set(document.version, document.text.length);
    const replacementHash = sharedTextHash(text);
    // localReplace is also used for an unsaved Monaco buffer. Do not move the
    // disk baseline to that buffer unless those bytes really are on disk: a
    // guest save must be allowed to persist the shared buffer over the known
    // baseline, while a genuinely independent disk change must still win as a
    // conflict.
    try {
      const currentDisk = await readSharedText(this.root, document.path);
      if (sharedTextHash(currentDisk.text) === replacementHash) document.diskHash = replacementHash;
    } catch {
      // Preserve the last verified baseline. The subsequent save will report
      // the missing/unreadable file rather than silently inventing one.
    }
    document.dirty = document.diskHash !== replacementHash;
    this.broadcast({ type: "reset", path: document.path, text, version: document.version });
    return { version: document.version };
  }
}

/**
 * The guest: the developer who does not have the project.
 *
 * It holds no files and writes nothing to disk. Everything it shows came from
 * the host, and everything it changes goes back there to be applied. When the
 * session ends, nothing of the project is left behind.
 */
class CollabGuest {
  constructor({
    send = () => undefined,
    name = "Gast",
    createConnection = net.createConnection,
    requestTimeoutMs = 20_000,
  } = {}) {
    this.send = send;
    this.name = name;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.peerId = 0;
    this.project = "";
    this.role = "lesen";
    this.permissions = [];
    this.createConnection = createConnection;
    this.connectionGeneration = 0;
    this.connecting = null;
    this.requestTimeoutMs = Math.max(10, Math.min(Number(requestTimeoutMs) || 20_000, 120_000));
  }

  connect(code) {
    const invite = parseInviteCode(code);
    const generation = this.connectionGeneration + 1;
    this.connectionGeneration = generation;
    return new Promise((resolve, reject) => {
      let settled = false;
      let welcomed = false;
      const rejectConnect = (error) => {
        if (settled) return;
        settled = true;
        if (this.connecting?.generation === generation) this.connecting = null;
        reject(error);
      };
      const resolveConnect = (welcome) => {
        if (settled) return;
        settled = true;
        if (this.connecting?.generation === generation) this.connecting = null;
        resolve(welcome);
      };
      const isCurrent = () => this.connectionGeneration === generation && this.socket === socket;
      const socket = this.createConnection({ host: invite.host, port: invite.port }, () => {
        if (!isCurrent()) {
          socket.destroy();
          rejectConnect(new Error("Die Verbindungsanfrage wurde durch eine neuere Sitzung ersetzt."));
          return;
        }
        socket.setTimeout(0);
        this.request("hello", { token: invite.token, name: this.name })
          .then((welcome) => {
            if (!isCurrent()) throw new Error("Die Verbindungsanfrage wurde durch eine neuere Sitzung ersetzt.");
            welcomed = true;
            this.peerId = welcome.peerId;
            this.project = welcome.project;
            // What this guest may do is decided by the host and only reported
            // here. Assuming anything else would mean an editor that accepts
            // typing the other side will refuse.
            this.role = normalizeRole(welcome.role);
            this.permissions = normalizePermissions(welcome.permissions, this.role);

            resolveConnect({
              project: welcome.project,
              peerId: welcome.peerId,
              peers: welcome.peers,
              role: this.role,
              permissions: this.permissions,
              // Whether a working copy may be written on this machine. Dropped
              // here once, and the strict mode then wrote the copy anyway:
              // enabled in the interface, doing nothing.
              hostOnly: Boolean(welcome.hostOnly),
            });
          })
          .catch((error) => {
            rejectConnect(error);
            if (!isCurrent()) return;
            this.connectionGeneration += 1;
            this.socket = null;
            this.peerId = 0;
            this.project = "";
            this.role = "lesen";
            this.permissions = [];
            this.failPending(error);
            socket.destroy();
          });
      });
      // Store the socket while it is still connecting. Otherwise disconnect()
      // cannot cancel a superseded join and it may authenticate later as a
      // ghost participant.
      this.socket = socket;
      this.connecting = { generation, socket, reject: rejectConnect };
      // No encoding: after the two greeting lines the socket carries sealed
      // bytes, and reading those as text would corrupt them.
      // Through a relay, the first line on this socket belongs to the relay:
      // it has to know which room to put this connection in before it will
      // carry anything. Written before the channel attaches, so the order on
      // the wire is the order both sides expect.
      if (invite.relay) socket.write(relayGreeting("guest", roomForToken(invite.token)));
      const channel = attachSecureChannel(socket, {
        token: invite.token,
        isHost: false,
        onMessage: (message) => { if (isCurrent()) this.handleMessage(message); },
        onError: (error) => {
          // A frame that will not open means the invite is wrong or something
          // on the way changed the bytes. Either way this is not a connection
          // to keep talking on.
          if (isCurrent()) this.failPending(error);
          rejectConnect(error);
          socket.destroy();
        },
      });
      this.channel = channel;
      socket.setTimeout(10_000, () => {
        const error = new Error("Zeitüberschreitung beim Verbinden mit dem Gastgeber.");
        rejectConnect(error);
        if (isCurrent()) this.failPending(error);
        socket.destroy();
      });
      socket.on("error", (error) => {
        rejectConnect(new Error(`Die Verbindung zum Gastgeber ist fehlgeschlagen: ${error.message}`));
        if (isCurrent()) this.failPending(error);
      });
      socket.on("close", () => {
        const wasCurrent = isCurrent();
        if (this.socket === socket) this.socket = null;
        // A socket that closes before the welcome is a host that hung up
        // during the handshake, and the handshake fails only one way: the
        // keys come from the invite, so the invite does not match. Saying
        // "the connection ended" sends people to look at their network.
        const error = welcomed
          ? new Error("Die Verbindung zum Gastgeber wurde beendet.")
          : new Error("Der Gastgeber hat die Verbindung abgelehnt — vermutlich stimmt der Einladungsschlüssel nicht.");
        rejectConnect(error);
        if (wasCurrent) {
          this.failPending(error);
          if (welcomed) this.publish("collab:disconnected", {});
        }
      });
    });
  }

  failPending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  handleMessage(message) {
    if (message?.type === "output") {
      // What the host's build, tests and debugger printed. The guest has no
      // toolchain of its own, so this is the only way it learns whether the
      // thing both of them are editing actually compiles.
      this.publish("collab:output", {
        channel: String(message.channel || ""),
        payload: message.payload,
      });
      return;
    }
    if (message?.type === "removed") {
      // Said before the socket closes, so this is not read as a network that
      // failed — somebody who believes that reconnects straight away, which
      // is the opposite of what the host just asked for.
      this.publish("collab:removed", { message: String(message.message || "") });
      return;
    }
    if (message?.type === "role") {
      this.role = normalizeRole(message.role);
      this.permissions = normalizePermissions(message.permissions, this.role);
      this.publish("collab:role", { role: this.role, permissions: this.permissions });
      return;
    }
    if (message?.type === "answer") {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok === false) entry.reject(new Error(message.message || "Der Gastgeber hat die Anfrage abgelehnt."));
      else entry.resolve(message);
      return;
    }
    if (message?.type === "error") {
      this.failPending(new Error(message.message || "Der Gastgeber hat die Verbindung abgelehnt."));
      return;
    }
    // Everything else happened on the host and is something to show: another
    // edit, another cursor, somebody arriving or leaving.
    this.publish(`collab:${String(message?.type || "unbekannt")}`, message);
  }

  publish(channel, payload) {
    this.send(channel, { ...payload, session: "guest" });
  }

  request(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error("Es besteht keine Verbindung zu einem Gastgeber."));
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`Der Gastgeber hat auf "${type}" nicht geantwortet.`));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.channel.send({ id, type, ...payload });
    });
  }

  disconnect() {
    this.connectionGeneration += 1;
    const socket = this.socket;
    this.socket = null;
    this.peerId = 0;
    this.project = "";
    const connecting = this.connecting;
    this.connecting = null;
    connecting?.reject(new Error("Die Sitzung wurde beendet."));
    socket?.destroy();
    this.failPending(new Error("Die Sitzung wurde beendet."));
  }
}

module.exports = { CollabGuest, CollabHost };
