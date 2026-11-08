const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const {
  CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter,
} = require("vscode-jsonrpc/node");
const { prepareCommand, terminateProcessTree } = require("./process-utils.cjs");
const { SERVER_CATALOG, serverForLanguage } = require("./polyglot-server-catalog.cjs");

const ALLOWED_REQUESTS = new Set([
  "textDocument/completion", "completionItem/resolve", "textDocument/hover",
  "textDocument/signatureHelp", "textDocument/definition", "textDocument/declaration",
  "textDocument/typeDefinition", "textDocument/implementation", "textDocument/references",
  "textDocument/documentSymbol", "textDocument/formatting", "textDocument/rangeFormatting",
  "textDocument/rename", "textDocument/prepareRename", "textDocument/codeAction", "workspace/symbol",
]);

function normaliseConfiguration(settings, languageId) {
  const server = serverForLanguage(languageId);
  if (!server) throw new Error(`Für ${languageId} ist kein Sprachserver registriert.`);
  const override = settings?.languageServers?.[languageId] || {};
  const command = typeof override.command === "string" && override.command.trim() ? override.command.trim() : server.command;
  return {
    server, command,
    enabled: override.enabled !== false,
    args: Array.isArray(override.args) ? override.args.filter((arg) => typeof arg === "string") : [...server.args],
    custom: command !== server.command,
  };
}

async function isFile(candidate) {
  try { return (await fs.stat(candidate)).isFile(); } catch { return false; }
}

/** Resolve a command without invoking a shell or executing a project-local script. */
async function findExecutable(command, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const extensions = platform === "win32"
    ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [];
  const names = [command];
  if (platform === "win32" && !path.extname(command)) names.push(...extensions.map((extension) => command + extension.toLowerCase()));
  if (path.isAbsolute(command) || /[\\/]/.test(command)) {
    for (const name of names) if (await isFile(name)) return path.resolve(name);
    return "";
  }
  const directories = [...(options.searchPaths || []), ...(env.PATH || env.Path || "").split(path.delimiter)].filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory.replace(/^"|"$/g, ""), name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return "";
}

function positionAt(text, offset) {
  const before = text.slice(0, offset);
  const newline = before.lastIndexOf("\n");
  return { line: before.split("\n").length - 1, character: offset - newline - 1 };
}

/** UTF-16 offsets, as negotiated in initialize. Keep incremental-only servers in sync. */
function incrementalChange(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let previousEnd = before.length;
  let nextEnd = after.length;
  while (previousEnd > start && nextEnd > start && before[previousEnd - 1] === after[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return { range: { start: positionAt(before, start), end: positionAt(before, previousEnd) }, rangeLength: previousEnd - start, text: after.slice(start, nextEnd) };
}

function timed(promise, timeoutMs, message, onTimeout = () => undefined) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error(message)); }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function clientCapabilities() {
  return {
    general: { positionEncodings: ["utf-16"] },
    workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
    textDocument: {
      synchronization: { dynamicRegistration: false, didSave: true, willSave: false, willSaveWaitUntil: false },
      completion: { dynamicRegistration: false, completionItem: {
        snippetSupport: true, commitCharactersSupport: true, deprecatedSupport: true,
        preselectSupport: true, insertReplaceSupport: true, documentationFormat: ["markdown", "plaintext"],
        resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
      } },
      hover: { contentFormat: ["markdown", "plaintext"] },
      signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"], parameterInformation: { labelOffsetSupport: true } } },
      definition: { linkSupport: true }, declaration: { linkSupport: true },
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      publishDiagnostics: { relatedInformation: true, versionSupport: true },
      rename: { prepareSupport: true },
    },
  };
}

class PolyglotSession {
  constructor(owner, root, languageId, configuration) {
    this.owner = owner;
    this.root = root;
    this.languageId = languageId;
    this.configuration = configuration;
    this.documents = new Map();
    this.requests = new Map();
    this.process = null;
    this.connection = null;
    this.startPromise = null;
    this.status = "stopped";
    this.reason = "";
    this.capabilities = null;
    this.generation = 0;
    this.syncQueue = Promise.resolve();
  }

  result() {
    return { available: this.status === "ready", status: this.status, reason: this.reason, capabilities: this.capabilities };
  }

  report(status, reason = "") {
    this.status = status;
    this.reason = reason;
    const languages = new Set([this.languageId, ...[...this.documents.values()].map((document) => document.languageId)]);
    for (const languageId of languages) {
      this.owner.send("polyglot:status", { root: this.root, languageId, serverId: this.configuration.server.id, ...this.result() });
    }
  }

  start() {
    if (this.status === "ready") return Promise.resolve(this.result());
    if (this.startPromise) return this.startPromise;
    const generation = ++this.generation;
    this.startPromise = this._start(generation).catch(async (error) => {
      if (generation === this.generation) {
        await this.disposeProcess();
        this.report("error", error instanceof Error ? error.message : String(error));
      }
      return this.result();
    }).finally(() => { if (generation === this.generation) this.startPromise = null; });
    return this.startPromise;
  }

  async _start(generation) {
    if (!this.configuration.enabled) {
      this.report("disabled", "Der Sprachserver ist in den Einstellungen deaktiviert.");
      return this.result();
    }
    const launch = await this.owner.resolveLaunch(this.configuration, this.root);
    if (generation !== this.generation) return this.result();
    if (!launch) {
      this.report("missing", `${this.configuration.server.name} wurde nicht gefunden. ${this.configuration.server.installHint}`);
      return this.result();
    }
    this.report("starting");
    const prepared = prepareCommand(launch.command, launch.args);
    const child = this.owner.spawnImpl(prepared.command, prepared.args, {
      cwd: this.root, env: { ...this.owner.env, ...(launch.env || {}) }, shell: false,
      windowsHide: true, windowsVerbatimArguments: prepared.verbatim, stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    let rejectExit;
    const exited = new Promise((_, reject) => { rejectExit = reject; });
    exited.catch(() => undefined);
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on("error", () => undefined);
    child.stderr?.on("data", (chunk) => this.owner.send("polyglot:log", { root: this.root, languageId: this.languageId, text: chunk.toString() }));
    child.once("error", (error) => rejectExit(error));
    child.once("close", (code, signal) => {
      rejectExit(new Error(`${this.configuration.server.name} wurde beendet (${signal || code || 0}).`));
      if (generation !== this.generation) return;
      this.connection?.dispose();
      this.connection = null;
      this.process = null;
      for (const document of this.documents.values()) document.opened = false;
      this.report("error", `${this.configuration.server.name} wurde beendet (${signal || code || 0}).`);
    });
    await Promise.race([exited, new Promise((resolve) => child.once("spawn", resolve))]);
    if (generation !== this.generation) return this.result();
    const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
    this.connection = connection;
    connection.onError(([error]) => this.owner.send("polyglot:log", { root: this.root, languageId: this.languageId, text: `${error?.message || error}\n` }));
    connection.onClose(() => rejectExit(new Error("Die Verbindung zum Sprachserver wurde geschlossen.")));
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      let languageId = this.languageId;
      let document = this.documents.get(params?.uri);
      if (!document && typeof params?.uri === "string") {
        try { document = this.owner.documents.get(this.owner.documentKey(this.root, fileURLToPath(params.uri))); } catch { /* non-file diagnostics retain their URI */ }
      }
      if (document) languageId = document.languageId;
      this.owner.send("polyglot:diagnostics", { ...params, ...(document ? { uri: document.uri } : {}), root: this.root, languageId });
    });
    const serverSettings = this.configuration.server.id === "python"
      ? { python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, typeCheckingMode: "standard" } } }
      : {};
    const initializationOptions = { ...serverSettings };
    if (this.configuration.server.id === "php") {
      const storage = path.join(this.owner.managedRoot || path.join(os.tmpdir(), "kiwi-language-servers"), "storage", "php");
      const projectId = crypto.createHash("sha256").update(this.root).digest("hex").slice(0, 16);
      initializationOptions.storagePath = path.join(storage, projectId);
      initializationOptions.globalStoragePath = path.join(storage, "global");
      await fs.mkdir(initializationOptions.storagePath, { recursive: true });
      await fs.mkdir(initializationOptions.globalStoragePath, { recursive: true });
    }
    connection.onRequest("workspace/configuration", (params) => (params?.items || []).map((item) =>
      item.section ? item.section.split(".").reduce((value, key) => value?.[key], serverSettings) ?? null : serverSettings));
    connection.onRequest("workspace/workspaceFolders", () => [{ uri: pathToFileURL(this.root).toString(), name: path.basename(this.root) }]);
    connection.onRequest("workspace/applyEdit", () => ({ applied: false, failureReason: "Dieser Client übernimmt Änderungen über explizite Editor-Aktionen." }));
    connection.onRequest("client/registerCapability", () => null);
    connection.onRequest("client/unregisterCapability", () => null);
    connection.onRequest("window/workDoneProgress/create", () => null);
    connection.onRequest("window/showMessageRequest", () => null);
    for (const method of ["window/logMessage", "window/showMessage", "$/logTrace"]) {
      connection.onNotification(method, (params) => this.owner.send("polyglot:log", { root: this.root, languageId: this.languageId, text: `${params?.message || ""}\n` }));
    }
    connection.listen();
    const rootUri = pathToFileURL(this.root).toString();
    const initialized = await timed(Promise.race([exited, connection.sendRequest("initialize", {
      processId: process.pid, clientInfo: { name: "Kiwi IDE" }, rootPath: this.root, rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: clientCapabilities(), initializationOptions,
    })]), this.owner.initializeTimeoutMs, `${this.configuration.server.name} antwortet nicht auf initialize.`);
    if (generation !== this.generation) return this.result();
    if (initialized?.capabilities?.positionEncoding && initialized.capabilities.positionEncoding !== "utf-16") {
      throw new Error("Der Sprachserver unterstützt die angeforderte UTF-16-Positionierung nicht.");
    }
    this.capabilities = initialized?.capabilities || {};
    await connection.sendNotification("initialized", {});
    await connection.sendNotification("workspace/didChangeConfiguration", { settings: serverSettings });
    this.report("ready");
    return this.result();
  }

  enqueue(action) {
    const next = this.syncQueue.catch(() => undefined).then(action);
    this.syncQueue = next;
    return next;
  }

  synchronize(document) {
    return this.enqueue(async () => {
      if (document.closed || this.documents.get(document.uri) !== document || this.status !== "ready" || !this.connection) return false;
      const text = document.text;
      const version = document.version;
      if (!document.opened) {
        await this.connection.sendNotification("textDocument/didOpen", { textDocument: { uri: document.uri, languageId: document.languageId, version, text } });
        document.opened = true;
      } else if (document.sentVersion !== version) {
        const sync = this.capabilities?.textDocumentSync;
        const kind = typeof sync === "number" ? sync : sync?.change;
        if (kind !== 0) {
          await this.connection.sendNotification("textDocument/didChange", {
            textDocument: { uri: document.uri, version },
            contentChanges: [kind === 2 ? incrementalChange(document.sentText, text) : { text }],
          });
        }
      }
      document.sentText = text;
      document.sentVersion = version;
      return true;
    });
  }

  async request(method, params, requestId) {
    const source = new CancellationTokenSource();
    if (requestId) this.requests.set(requestId, source);
    try {
      return await timed(this.connection.sendRequest(method, params, source.token), this.owner.requestTimeoutMs,
        `${this.configuration.server.name}: Zeitüberschreitung bei ${method}.`, () => source.cancel());
    } finally {
      if (requestId && this.requests.get(requestId) === source) this.requests.delete(requestId);
      source.dispose();
    }
  }

  async disposeProcess() {
    const child = this.process;
    this.process = null;
    const connection = this.connection;
    this.connection = null;
    try { connection?.dispose(); } catch { /* already closed */ }
    // taskkill may finish before Node has released the child's working
    // directory. Shutdown is complete only after the child's handles close.
    const closed = child && child.exitCode === null
      ? new Promise((resolve) => child.once("close", resolve))
      : Promise.resolve();
    await this.owner.terminateImpl(child);
    await timed(closed, 2_000, "Sprachserver-Prozess beendet seine Handles nicht.").catch(() => undefined);
  }

  async stop() {
    ++this.generation;
    this.startPromise = null;
    this.report("stopped");
    for (const source of this.requests.values()) source.cancel();
    this.requests.clear();
    for (const document of this.documents.values()) document.opened = false;
    if (this.connection) {
      const connection = this.connection;
      try {
        await timed(connection.sendRequest("shutdown"), this.owner.shutdownTimeoutMs, "Sprachserver reagiert nicht auf shutdown.");
        await connection.sendNotification("exit");
      } catch { /* a stopped or unresponsive server is terminated below */ }
    }
    await this.disposeProcess();
    return true;
  }
}

class PolyglotLanguageService {
  constructor(guard, readSettings, send, options = {}) {
    this.guard = guard;
    this.readSettings = readSettings;
    this.send = send;
    this.env = options.env || process.env;
    this.managedRoot = options.managedRoot || "";
    this.searchPaths = options.searchPaths || [];
    this.spawnImpl = options.spawnImpl || spawn;
    this.terminateImpl = options.terminateImpl || terminateProcessTree;
    this.findExecutable = options.findExecutable || findExecutable;
    this.initializeTimeoutMs = options.initializeTimeoutMs || 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs || 15_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs || 1_500;
    this.sessions = new Map();
    this.documents = new Map();
  }

  configuration(languageId) { return normaliseConfiguration(this.readSettings?.() || {}, languageId); }

  sessionKey(root, configuration) {
    return JSON.stringify([root, configuration.server.id, configuration.command, configuration.args, configuration.enabled]);
  }

  documentKey(root, file) {
    const key = `${root}\n${file}`;
    return process.platform === "win32" ? key.toLowerCase() : key;
  }

  validate(payload) {
    const root = this.guard.assertWorkspace(payload?.root);
    const file = this.guard.assertAllowed(payload?.file, root);
    return { root, file, key: this.documentKey(root, file), uri: pathToFileURL(file).toString() };
  }

  async resolveLaunch(configuration, root = "") {
    const args = [...configuration.args];
    if (root && !configuration.custom && configuration.server.id === "clangd"
      && !args.some((arg) => arg === "--compile-commands-dir" || arg.startsWith("--compile-commands-dir="))) {
      const compileDirectory = path.join(root, ".kiwi", "build", "cmake");
      if (await isFile(path.join(compileDirectory, "compile_commands.json"))) args.push(`--compile-commands-dir=${compileDirectory}`);
    }
    if (this.managedRoot && !configuration.custom && configuration.server.npmPackage) {
      const packageRoot = path.join(this.managedRoot, "node_modules", configuration.server.npmPackage);
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
        const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[configuration.command];
        if (bin) {
          const script = path.resolve(packageRoot, bin);
          const relative = path.relative(packageRoot, script);
          if (relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && await isFile(script)) {
            return { command: process.execPath, args: [script, ...args], env: { ELECTRON_RUN_AS_NODE: "1" } };
          }
        }
      } catch { /* not installed locally; PATH remains a valid source */ }
    }
    const command = await this.findExecutable(configuration.command, {
      env: this.env,
      searchPaths: [...this.searchPaths, ...(this.managedRoot ? [path.join(this.managedRoot, "node_modules", ".bin")] : [])],
    });
    return command ? { command, args } : null;
  }

  async status(root) {
    const selectedRoot = root ? this.guard.assertWorkspace(root) : "";
    const rows = [];
    for (const server of SERVER_CATALOG) {
      for (const language of server.languages) {
        const configuration = this.configuration(language.id);
        const session = selectedRoot ? this.sessions.get(this.sessionKey(selectedRoot, configuration)) : null;
        const launch = configuration.enabled ? await this.resolveLaunch(configuration) : null;
        const status = session?.status || (!configuration.enabled ? "disabled" : launch ? "installed" : "missing");
        rows.push({
          languageId: language.id, name: language.name, serverId: server.id, serverName: server.name,
          command: configuration.command, args: configuration.args, enabled: configuration.enabled,
          available: Boolean(launch), status, reason: session?.reason || (!configuration.enabled ? "Deaktiviert" : launch ? "" : server.installHint),
          docsUrl: server.docsUrl, installHint: server.installHint, npmPackage: server.npmPackage || "",
          ...(selectedRoot ? { root: selectedRoot } : {}), capabilities: session?.capabilities || null,
        });
      }
    }
    return rows;
  }

  async open(payload) {
    const { root, file, key, uri } = this.validate(payload);
    const languageId = String(payload.languageId || "");
    const configuration = this.configuration(languageId);
    const sessionKey = this.sessionKey(root, configuration);
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = new PolyglotSession(this, root, languageId, configuration);
      this.sessions.set(sessionKey, session);
    }
    let document = this.documents.get(key);
    if (document && document.session !== session) await this.close({ root, file });
    document = this.documents.get(key);
    if (!document) {
      document = { root, file, uri, languageId, text: String(payload.text || ""), version: 1, sentVersion: 0, sentText: "", opened: false, closed: false, session };
      this.documents.set(key, document);
      session.documents.set(uri, document);
    } else if (document.text !== payload.text) {
      document.text = String(payload.text || "");
      document.version += 1;
    }
    const result = await session.start();
    if (document.closed || this.documents.get(key) !== document) return { available: false, status: "closed", reason: "Die Datei wurde geschlossen." };
    if (result.available) await session.synchronize(document);
    return result;
  }

  async change(payload) {
    const { key } = this.validate(payload);
    const document = this.documents.get(key);
    if (!document) return false;
    const text = String(payload.text || "");
    if (document.text !== text) { document.text = text; document.version += 1; }
    if (document.session.status === "ready") await document.session.synchronize(document);
    return true;
  }

  async save(payload) {
    const { key } = this.validate(payload);
    const document = this.documents.get(key);
    if (!document) return false;
    if (typeof payload.text === "string") await this.change(payload);
    const session = document.session;
    if (session.status !== "ready") return false;
    await session.synchronize(document);
    return session.enqueue(async () => {
      if (document.closed || !session.connection) return false;
      const save = session.capabilities?.textDocumentSync?.save;
      if (save !== false) await session.connection.sendNotification("textDocument/didSave", {
        textDocument: { uri: document.uri }, ...(save?.includeText ? { text: document.text } : {}),
      });
      return true;
    });
  }

  async close(payload) {
    const { key } = this.validate(payload);
    const document = this.documents.get(key);
    if (!document) return false;
    this.documents.delete(key);
    document.closed = true;
    const session = document.session;
    session.documents.delete(document.uri);
    return session.enqueue(async () => {
      if (document.opened && session.status === "ready" && session.connection) {
        await session.connection.sendNotification("textDocument/didClose", { textDocument: { uri: document.uri } });
        this.send("polyglot:diagnostics", { root: document.root, languageId: document.languageId, uri: document.uri, diagnostics: [] });
      }
      return true;
    });
  }

  async request(payload) {
    if (!ALLOWED_REQUESTS.has(payload?.method)) throw new Error("Diese Sprachserver-Anfrage ist nicht erlaubt.");
    const { root, key, uri } = this.validate(payload);
    const document = this.documents.get(key);
    if (!document || document.closed) return null;
    const configuration = this.configuration(payload.languageId || document.languageId);
    if (this.sessionKey(root, configuration) !== this.sessionKey(root, document.session.configuration)) return null;
    const session = document.session;
    const result = await session.start();
    if (!result.available || document.closed) return null;
    await session.synchronize(document);
    if (document.closed || !session.connection) return null;
    let params = payload.params;
    if (params?.textDocument) params = { ...params, textDocument: { ...params.textDocument, uri } };
    return session.request(payload.method, params, String(payload.requestId || ""));
  }

  cancel(requestId) {
    for (const session of this.sessions.values()) {
      const request = session.requests.get(requestId);
      if (request) { request.cancel(); return true; }
    }
    return false;
  }

  async stop(root) {
    const selectedRoot = root ? this.guard.assertWorkspace(root) : "";
    const sessions = [...this.sessions.entries()].filter(([, session]) => !selectedRoot || session.root === selectedRoot);
    for (const [key, document] of this.documents) {
      if (!selectedRoot || document.root === selectedRoot) { document.closed = true; this.documents.delete(key); }
    }
    await Promise.all(sessions.map(async ([key, session]) => { await session.stop(); this.sessions.delete(key); }));
    return true;
  }
}

module.exports = { PolyglotLanguageService, SERVER_CATALOG, findExecutable, incrementalChange, normaliseConfiguration };
