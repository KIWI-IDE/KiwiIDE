const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { discoverJavaProjectModel } = require("./java-project-model.cjs");
const { terminateProcessTree } = require("./process-utils.cjs");
const { compareVersions } = require("./update-service.cjs");
const {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require("vscode-jsonrpc/node");

const LANGUAGE_WORKSPACE_SCHEMA_VERSION = 2;
const MAX_LANGUAGE_WORKSPACE_BACKUPS = 5;
const INITIAL_DIAGNOSTIC_SETTLE_MS = 800;
const JDT_INITIALIZE_TIMEOUT_MS = 60_000;
const JDT_SERVICE_READY_TIMEOUT_MS = 45_000;
const JDT_CLASSPATH_REQUEST_TIMEOUT_MS = 10_000;
const JDT_DECORATION_REQUEST_TIMEOUT_MS = 15_000;
const JDT_INTERACTIVE_REQUEST_TIMEOUT_MS = 30_000;
const JDT_PROJECT_REQUEST_TIMEOUT_MS = 90_000;
const JDT_MUTATING_REQUEST_TIMEOUT_MS = 180_000;
const JDT_TIMEOUT_CODE = "KIWI_JDT_TIMEOUT";

const decorationRequests = new Set([
  "textDocument/inlayHint",
  "textDocument/semanticTokens/full",
]);
const projectRequests = new Set([
  "textDocument/references",
  "textDocument/implementation",
  "textDocument/typeDefinition",
  "workspace/symbol",
  "textDocument/prepareCallHierarchy",
  "callHierarchy/incomingCalls",
  "callHierarchy/outgoingCalls",
  "textDocument/prepareTypeHierarchy",
  "typeHierarchy/supertypes",
  "typeHierarchy/subtypes",
]);
const mutatingRequests = new Set([
  "textDocument/rename",
  "workspace/executeCommand",
]);

const allowedRequests = new Set([
  "textDocument/completion",
  "completionItem/resolve",
  "textDocument/hover",
  "textDocument/definition",
  "textDocument/references",
  "textDocument/rename",
  "textDocument/prepareRename",
  "textDocument/formatting",
  "textDocument/rangeFormatting",
  "textDocument/codeAction",
  "codeAction/resolve",
  "textDocument/documentSymbol",
  "textDocument/signatureHelp",
  "textDocument/implementation",
  "textDocument/typeDefinition",
  "workspace/symbol",
  "workspace/executeCommand",
  "textDocument/prepareCallHierarchy",
  "callHierarchy/incomingCalls",
  "callHierarchy/outgoingCalls",
  "textDocument/prepareTypeHierarchy",
  "textDocument/semanticTokens/full",
  "textDocument/inlayHint",
  "typeHierarchy/supertypes",
  "typeHierarchy/subtypes",
  // JDT's own: hands back the source behind a `jdt://` address — the
  // attached one where a library ships sources, a decompiled one where it
  // does not. Without it here a jump into a jar resolves and then cannot
  // be read.
  "java/classFileContents",
]);

async function raceWithTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function rejectAfterTimeout(promise, timeoutMs, stage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${stage} hat nach ${timeoutMs} ms nicht geantwortet.`);
      error.code = JDT_TIMEOUT_CODE;
      error.stage = stage;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function isJdtTimeout(error) {
  return error?.code === JDT_TIMEOUT_CODE;
}

function isConnectionDisposedError(error) {
  return /(?:connection|response).*(?:closed|disposed)|pending response rejected since connection got disposed/i
    .test(String(error?.message || error));
}

function isInsidePath(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * JDT's invisible project only needs a restart when a Java file introduces a
 * genuinely new source root. New compilation units below an already indexed
 * source root are ordinary watched-file creates. Restarting for every new
 * class disposed unrelated completion/hover requests and could create a
 * stop/start storm while Maven or Gradle was importing at the same time.
 */
function belongsToKnownSourceRoot(root, file, projectModel) {
  const belongsToConfiguredRoot = (projectModel?.sourcePaths || []).some((sourcePath) => {
    const absolute = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(root, sourcePath);
    return isInsidePath(file, absolute);
  });
  if (belongsToConfiguredRoot) return true;

  // Mixed/legacy layouts can contain default-package files in `src` next to a
  // more specific `src/main/java` source root. The model intentionally keeps
  // the specific root to avoid assigning packaged files to the wrong package,
  // but a new sibling of an already indexed compilation unit is still not a
  // new source root and must not tear down the whole JDT session.
  const directory = path.dirname(path.resolve(file));
  return (projectModel?.javaFiles || []).some((knownFile) =>
    path.dirname(path.resolve(knownFile)) === directory);
}

function requestTimeoutForMethod(method) {
  if (mutatingRequests.has(method)) return JDT_MUTATING_REQUEST_TIMEOUT_MS;
  if (projectRequests.has(method)) return JDT_PROJECT_REQUEST_TIMEOUT_MS;
  if (decorationRequests.has(method)) return JDT_DECORATION_REQUEST_TIMEOUT_MS;
  return JDT_INTERACTIVE_REQUEST_TIMEOUT_MS;
}

async function sendRequestWithTimeout(connection, method, params, timeoutMs, register = null) {
  const cancellation = new CancellationTokenSource();
  // Handed out so a caller can cancel this before it answers. Typing past a
  // completion used to leave the old request running to completion inside JDT
  // LS, which is the work that made the next one wait.
  const unregister = register ? register(() => cancellation.cancel()) : null;
  try {
    return await rejectAfterTimeout(
      connection.sendRequest(method, params, cancellation.token),
      timeoutMs,
      `JDT-LS-Anfrage ${method}`,
    );
  } catch (error) {
    if (isJdtTimeout(error)) {
      error.method = method;
      error.timeoutMs = timeoutMs;
      cancellation.cancel();
    }
    throw error;
  } finally {
    unregister?.();
    cancellation.dispose();
  }
}

class LanguageSession {
  constructor(
    pathGuard,
    projects,
    toolchainRoot,
    userDataPath,
    send,
    cacheRecovery = null,
    requestTimeout = requestTimeoutForMethod,
    readEditorFormat = null,
  ) {
    this.pathGuard = pathGuard;
    this.projects = projects;
    this.toolchainRoot = toolchainRoot;
    this.userDataPath = userDataPath;
    this.send = send;
    this.cacheRecovery = cacheRecovery;
    // The formatter has to indent the way the editor does; without this it
    // falls back to Eclipse's tabs and re-indents a space-based project.
    this.readEditorFormat = readEditorFormat;
    this.process = null;
    this.connection = null;
    this.root = "";
    this.documents = new Map();
    this.javaSettings = null;
    this.projectModel = null;
    this.classpath = null;
    this.toolingJdk = null;
    this.capabilities = null;
    this.index = null;
    this.ready = false;
    this.startPromise = null;
    this.stopPromise = null;
    this.restartPromise = null;
    this.restartRoot = "";
    this.startingRoot = "";
    this.dataPath = "";
    this.cachedIndex = null;
    this.requestTimeout = requestTimeout;
    /**
     * How to cancel a request that has not answered yet, by the id its caller
     * gave it. A completion the user has typed past is work JDT LS is still
     * doing, and it is the work the next completion waits behind.
     */
    this.cancellers = new Map();
  }

  /** Cancels a request the renderer has moved on from. */
  cancel(requestId) {
    const cancel = this.cancellers.get(String(requestId || ""));
    if (!cancel) return false;
    this.cancellers.delete(String(requestId));
    try {
      cancel();
      return true;
    } catch {
      return false;
    }
  }

  async start(root) {
    root = this.pathGuard.assertWorkspace(root);
    if (this.ready && this.connection && this.root === root) {
      return {
        available: true,
        status: "ready",
        capabilities: this.capabilities,
        jdk: this.toolingJdk,
        project: this.projectModel,
        classpath: this.classpath,
        index: this.index || this.cachedIndex,
      };
    }
    if (this.startPromise && this.startingRoot === root) return this.startPromise;
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    this.startingRoot = root;
    const operation = this.startInternal(root);
    this.startPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.startPromise === operation) {
        this.startPromise = null;
        this.startingRoot = "";
      }
    }
  }

  async startInternal(root) {
    try {
      return await this.launch(root);
    } catch (firstError) {
      let finalError = firstError;
      const failedDataPath = this.dataPath;
      const shouldRecover = this.cacheRecovery
        ? await this.cacheRecovery.jdtFailureLooksRecoverable(failedDataPath, firstError).catch(() => false)
        : false;
      if (shouldRecover) {
        this.send("language:status", {
          status: "indexing",
          detail: "Beschädigter JDT-Cache wird sicher wiederhergestellt …",
        });
        await this.stop().catch(() => undefined);
        const recovery = await this.cacheRecovery.recoverJdt(root, failedDataPath, firstError).catch((error) => ({
          recovered: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
        if (recovery.recovered) {
          this.dataPath = "";
          this.cachedIndex = null;
          this.send("language:log", {
            text: `JDT-Cache wurde in ${recovery.backupRoot} gesichert und wird neu aufgebaut.\n`,
          });
          try {
            return await this.launch(root);
          } catch (retryError) {
            finalError = retryError;
          }
        }
      }
      const error = finalError;
      // Every caller treats a rejected start as a hard failure; reporting the
      // reason keeps the status bar honest instead of stuck on "wird gestartet".
      const reason = error instanceof Error ? error.message : String(error);
      this.send("language:status", { status: "error", reason });
      await this.stop().catch(() => undefined);
      return { available: false, status: "error", reason };
    }
  }

  async launch(root) {
    await this.stop();
    this.dataPath = "";
    this.cachedIndex = null;
    const jdtls = path.join(this.toolchainRoot, "jdtls");
    if (!fsSync.existsSync(jdtls)) {
      return { available: false, status: "missing", reason: "Eclipse JDT Language Server ist nicht gebündelt." };
    }
    const projectJdk = await this.projects.detectJdk(root);
    const fallbackJdk = projectJdk.major >= 21 ? projectJdk : await this.projects.detectJdk("");
    const jdk = fallbackJdk.major >= 21 ? fallbackJdk : projectJdk;
    if (!jdk.available || jdk.major < 21) {
      return { available: false, status: "jdk-required", reason: "JDT LS benötigt ein separates JDK 21 oder neuer.", jdk };
    }
    this.toolingJdk = jdk;
    const projectSettings = await this.projects.readProjectSettings(root);
    const projectModel = await discoverJavaProjectModel(root);
    if (await repairLegacyManagedMetadata(root, projectModel)) {
      this.send("language:log", {
        text: "Veraltete Kiwi/JDT-Ressourcenfilter wurden aus .project entfernt.\n",
      });
    }
    projectModel.declaredDependencies = await declaredDependencyCount(root, projectModel);
    const javaSettings = createJavaSettings({
      projectSettings,
      projectModel,
      projectJdk: projectJdk.available ? projectJdk : jdk,
      toolchainRoot: this.toolchainRoot,
      formatterUrl: await writeFormatterProfile(this.userDataPath, this.readEditorFormat?.() || {}),
    });
    this.javaSettings = javaSettings;
    this.projectModel = projectModel;
    const plugins = path.join(jdtls, "plugins");
    const launcher = (await fs.readdir(plugins))
      .filter((name) => /^org\.eclipse\.equinox\.launcher_.+\.jar$/.test(name))
      .sort()
      .at(-1);
    if (!launcher) throw new Error("Der JDT-LS-Launcher wurde nicht gefunden.");
    const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 20);
    const data = path.join(this.userDataPath, "jdtls-workspaces", hash);
    const preparedWorkspace = await prepareLanguageWorkspace(
      data,
      path.join(this.userDataPath, "jdtls-workspace-backups"),
      hash,
    );
    this.dataPath = data;
    this.cachedIndex = preparedWorkspace.cachedIndex;
    if (preparedWorkspace.migrated) {
      this.send("language:status", {
        status: "indexing",
        detail: "Veralteter Java-Index wird einmalig sicher neu aufgebaut …",
      });
    }
    const configurationName = process.platform === "win32" ? "config_win"
      : process.platform === "darwin" ? "config_mac" : "config_linux";
    const arm = process.platform !== "win32" && (jdk.arch || process.arch) === "arm64";
    const sharedConfiguration = path.join(jdtls, configurationName + (arm ? "_arm" : ""));
    const writableConfiguration = process.platform !== "win32";
    const configuration = writableConfiguration
      ? path.join(this.userDataPath, "jdtls-configurations", launcher, hash)
      : sharedConfiguration;
    const lombokAgent = await detectLombokAgent(root, projectModel, projectSettings.lombokSupport);
    const args = [
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Dlog.level=WARNING",
      "-Djava.import.generatesMetadataFilesAtProjectRoot=false",
      ...(writableConfiguration ? [
        "-Dosgi.checkConfiguration=true",
        `-Dosgi.sharedConfiguration.area=${sharedConfiguration}`,
        "-Dosgi.sharedConfiguration.area.readOnly=true",
        "-Dosgi.configuration.cascaded=true",
      ] : []),
      ...(lombokAgent ? [`-javaagent:${lombokAgent}`] : []),
      "-Xmx1G",
      "--add-modules=ALL-SYSTEM",
      "--add-opens", "java.base/java.util=ALL-UNNAMED",
      "--add-opens", "java.base/java.lang=ALL-UNNAMED",
      "-jar", path.join(plugins, launcher),
      "-configuration", configuration,
      "-data", data,
    ];
    this.send("language:status", { status: "starting" });
    this.process = spawn(jdk.java, args, { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    // A JDT LS that dies during startup leaves every request on the connection
    // pending forever, which used to freeze the whole language start with no
    // way out. Losing the process is turned into a rejection instead, so the
    // startup path fails fast and the reason reaches the status bar.
    let reportExit = () => undefined;
    const exited = new Promise((_, reject) => {
      reportExit = reject;
    });
    exited.catch(() => undefined);
    let lastError = "";
    // Once the JVM is gone its pipes are destroyed, and the JSON-RPC writer
    // still has frames in flight. Without listeners those surface as unhandled
    // stream errors in the main process.
    for (const stream of [this.process.stdin, this.process.stdout, this.process.stderr]) {
      stream?.on("error", () => undefined);
    }
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      lastError = text.trim().split(/\r?\n/).filter(Boolean).at(-1) || lastError;
      this.send("language:log", { text });
    });
    this.process.on("error", (error) => {
      this.send("language:status", { status: "error", reason: error.message });
      reportExit(new Error(`Der Java-Sprachserver konnte nicht gestartet werden: ${error.message}`));
    });
    this.process.on("close", (code) => {
      const connection = this.connection;
      this.send("language:status", { status: "stopped", code: code ?? 0 });
      this.process = null;
      this.connection = null;
      this.ready = false;
      reportExit(new Error(
        `Der Java-Sprachserver wurde unerwartet beendet (Code ${code ?? 0}).${lastError ? ` ${lastError}` : ""}`,
      ));
      // Rejects everything still waiting on a response from the dead process.
      try { connection?.dispose(); } catch { /* already torn down */ }
    });

    // Wait for the JVM to really exist before opening the JSON-RPC channel.
    // Writing "initialize" into the pipes of a process that never launched
    // fails deep inside vscode-jsonrpc, where the rejection cannot be caught.
    await Promise.race([exited, new Promise((resolve) => this.process.once("spawn", resolve))]);

    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout),
      new StreamMessageWriter(this.process.stdin),
    );
    this.connection.onError(([error]) => {
      this.send("language:log", { text: `JDT LS: ${error?.message || error}\n` });
    });
    this.connection.onClose(() => reportExit(new Error("Die Verbindung zum Java-Sprachserver wurde geschlossen.")));
    let resolveServiceReady;
    const serviceReady = new Promise((resolve) => {
      resolveServiceReady = resolve;
    });
    this.connection.onNotification("textDocument/publishDiagnostics", (params) => {
      this.send("language:diagnostics", params);
    });
    this.connection.onNotification("language/status", (params) => {
      if (params?.message === "ServiceReady") resolveServiceReady(true);
      this.send("language:status", {
        status: params?.message === "ServiceReady" ? "indexing" : "starting",
        detail: params?.message || params?.type || "",
      });
    });
    this.connection.onNotification("language/progressReport", (params) => {
      this.send("language:status", { status: "indexing", detail: params?.status || params?.task || "" });
    });
    this.connection.onRequest("workspace/configuration", (params) => {
      const configuration = { java: javaSettings };
      return (params?.items?.length ? params.items : [{}]).map((item) =>
        item.section
          ? item.section.split(".").reduce((value, key) => value?.[key], configuration)
          : configuration,
      );
    });
    this.connection.onRequest("workspace/applyEdit", (params) => {
      this.send("language:applyEdit", params.edit);
      return { applied: true };
    });
    this.connection.onRequest("window/showMessageRequest", (params) => {
      this.send("language:message", params);
      return null;
    });
    this.connection.onNotification("window/showMessage", (params) => this.send("language:message", params));
    this.connection.onNotification("window/logMessage", (params) => this.send("language:log", params));
    this.connection.listen();
    this.root = root;
    const rootUri = pathToFileURL(root).toString();
    const initialize = await rejectAfterTimeout(Promise.race([exited, this.connection.sendRequest("initialize", {
      processId: process.pid,
      rootPath: root,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
      capabilities: clientCapabilities(),
      initializationOptions: {
        bundles: [],
        workspaceFolders: [rootUri],
        /*
         * Without this, a jump into a jar goes nowhere.
         *
         * JDT LS answers textDocument/definition for a class inside a
         * library with a `jdt://` address — but only to a client that says
         * it can open one. To a client that stays silent it drops the
         * location and answers with an empty list, which is indis-
         * tinguishable from "this type has no definition".
         */
        extendedClientCapabilities: {
          classFileContentsSupport: true,
        },
        // JDT LS only creates its invisible Java project for unmanaged folders
        // when at least one Java trigger file is supplied during initialization.
        triggerFiles: projectModel.javaFiles
          .slice(0, 100)
          .map((file) => pathToFileURL(file).toString()),
        settings: { java: javaSettings },
      },
    })]), JDT_INITIALIZE_TIMEOUT_MS, "JDT-LS-Initialisierung");
    this.connection.sendNotification("initialized", {});
    this.connection.sendNotification("workspace/didChangeConfiguration", { settings: { java: javaSettings } });
    this.send("language:status", {
      status: "indexing",
      detail: this.cachedIndex
        ? `Persistenter Index wird aktualisiert · ${this.cachedIndex.detail || "Classpath wird geprüft"}`
        : "Java-Projekt und Abhängigkeiten werden importiert…",
    });
    await rejectAfterTimeout(
      Promise.race([exited, serviceReady]),
      JDT_SERVICE_READY_TIMEOUT_MS,
      "JDT-LS ServiceReady",
    );
    const expectsDependencies = await projectDeclaresDependencies(root, projectModel);
    // A failed classpath probe is survivable, a dead server is not: re-check
    // afterwards so a crash here is never reported as a ready language service.
    this.classpath = await this.waitForClasspath(expectsDependencies).catch((error) => {
      this.send("language:log", { text: `Classpath-Analyse: ${error.message}\n` });
      if (isJdtTimeout(error)) throw error;
      return null;
    });
    if (!this.process) await exited;
    if (projectModel.managedByBuildTool) {
      // JDT LS reports ServiceReady and build-job completion before its initial
      // workspace-diagnostics conversion is fully quiescent. Opening the first
      // editor buffer in that short window can make JDT compare marker ranges
      // against a newer document and log BadLocationException. Keep the visible
      // indexing state until this one-off diagnostics window has settled.
      this.send("language:status", {
        status: "indexing",
        detail: "Initiale Java-Diagnosen werden stabilisiert …",
      });
      await new Promise((resolve) => setTimeout(resolve, INITIAL_DIAGNOSTIC_SETTLE_MS));
    }
    const index = {
      ...indexSummary(projectModel, this.classpath, projectSettings, lombokAgent),
      persistent: true,
      restored: Boolean(this.cachedIndex),
      updatedAt: new Date().toISOString(),
    };
    await this.persistIndex(index).catch((error) => this.send("language:log", {
      text: `Persistenter Java-Index konnte nicht gespeichert werden: ${error.message}\n`,
    }));
    this.capabilities = initialize.capabilities;
    this.index = index;
    this.send("language:status", {
      status: "ready",
      detail: index.detail,
      capabilities: initialize.capabilities,
      project: projectModel,
      classpath: this.classpath,
      index,
    });
    this.ready = true;
    return {
      available: true,
      status: "ready",
      capabilities: initialize.capabilities,
      jdk,
      project: projectModel,
      classpath: this.classpath,
      index,
    };
  }

  async inspectClasspath(anchorFile = "") {
    if (!this.connection || !this.root) return null;
    const anchor = anchorFile || this.projectModel?.javaFiles?.[0] || this.root;
    return rejectAfterTimeout(this.connection.sendRequest("workspace/executeCommand", {
      command: "java.project.getClasspaths",
      // JDT LS 1.60 still expects this custom-command model as a serialized
      // JSON argument. Passing a plain object is converted to null internally.
      arguments: [pathToFileURL(anchor).toString(), JSON.stringify({ scope: "runtime" })],
    }), JDT_CLASSPATH_REQUEST_TIMEOUT_MS, "JDT-LS Classpath-Abfrage");
  }

  async waitForClasspath(expectsDependencies = false) {
    const timeoutAt = Date.now() + (expectsDependencies ? 2_500 : 1_000);
    let classpath = null;
    do {
      classpath = await this.inspectClasspath();
      if (!expectsDependencies || countClasspathEntries(classpath) > 0) return classpath;
      this.send("language:status", {
        status: "indexing",
        detail: "Maven-/Gradle-Abhängigkeiten werden in den Java-Index übernommen …",
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < timeoutAt);
    return classpath;
  }

  async refresh(root, changedFile = "") {
    root = this.pathGuard.assertWorkspace(root);
    if (changedFile) this.pathGuard.assertAllowed(changedFile, root);
    // stopInternal marks the session unavailable immediately. A second watcher
    // event arriving during a source-root restart must therefore join here,
    // before the ordinary availability guard would incorrectly return false.
    if (this.restartPromise && this.restartRoot === root) return this.restartPromise;
    if (!this.ready || !this.connection || this.root !== root) return false;
    const connection = this.connection;
    if (changedFile) {
      const normalizedChanged = path.resolve(changedFile);
      const isNewUnmanagedJavaFile = /\.java$/i.test(changedFile)
        && !this.projectModel?.managedByBuildTool
        && !this.projectModel?.javaFiles?.some((file) => path.resolve(file) === normalizedChanged);
      if (isNewUnmanagedJavaFile && !belongsToKnownSourceRoot(root, normalizedChanged, this.projectModel)) {
        // A new source root also needs a new initialization trigger so JDT LS
        // can attach the file to its invisible Java project. Keep this restart
        // explicit so requests disposed by it can wait for and retry against
        // the replacement connection instead of escaping as IPC errors.
        const restart = (async () => {
          await this.stop();
          return Boolean((await this.start(root)).available);
        })();
        this.restartRoot = root;
        this.restartPromise = restart;
        try {
          return await restart;
        } finally {
          if (this.restartPromise === restart) {
            this.restartPromise = null;
            this.restartRoot = "";
          }
        }
      }
      try {
        connection.sendNotification("workspace/didChangeWatchedFiles", {
          // JDT distinguishes a newly created compilation unit from a content
          // update. Reporting it as changed made the first reconciliation
          // unreliable on slower machines.
          changes: [{ uri: pathToFileURL(changedFile).toString(), type: isNewUnmanagedJavaFile ? 1 : 2 }],
        });
      } catch {
        return false;
      }
      if (isNewUnmanagedJavaFile) {
        this.projectModel = {
          ...this.projectModel,
          javaFiles: [...(this.projectModel?.javaFiles || []), normalizedChanged],
        };
      }
    }
    const shouldImport = !changedFile || isClasspathFile(changedFile);
    if (shouldImport) {
      this.projectModel = await discoverJavaProjectModel(root);
      this.projectModel.declaredDependencies = await declaredDependencyCount(root, this.projectModel);
      const projectJdk = await this.projects.detectJdk(root);
      const projectSettings = await this.projects.readProjectSettings(root);
      this.javaSettings = createJavaSettings({
        projectSettings,
        projectModel: this.projectModel,
        projectJdk: projectJdk.available ? projectJdk : this.toolingJdk,
        toolchainRoot: this.toolchainRoot,
        formatterUrl: await writeFormatterProfile(this.userDataPath, this.readEditorFormat?.() || {}),
      });
      if (!this.ready || this.connection !== connection || this.root !== root) return false;
      try {
        connection.sendNotification("workspace/didChangeConfiguration", { settings: { java: this.javaSettings } });
      } catch {
        return false;
      }
      this.send("language:status", { status: "indexing", detail: "Classpath wird aktualisiert…" });
      try {
        await connection.sendRequest("workspace/executeCommand", {
          command: "java.project.import",
          arguments: [],
        });
      } catch (error) {
        // A settings change or a newly discovered source root can replace the
        // connection while an import is pending. That is an expected lifecycle
        // cancellation, not a user-facing classpath error, and this stale
        // refresh must not publish a misleading "ready" state afterwards.
        if (connection !== this.connection || !this.ready || this.stopPromise || isConnectionDisposedError(error)) {
          return false;
        }
        this.send("language:log", { text: `Classpath-Aktualisierung: ${error.message}\n` });
      }
      if (!this.ready || this.connection !== connection || this.root !== root) return false;
      const expectsDependencies = await projectDeclaresDependencies(root, this.projectModel);
      this.classpath = await this.waitForClasspath(expectsDependencies).catch(() => null);
      const lombokAgent = await detectLombokAgent(root, this.projectModel, projectSettings.lombokSupport);
      const index = {
        ...indexSummary(this.projectModel, this.classpath, projectSettings, lombokAgent),
        persistent: true,
        restored: true,
        updatedAt: new Date().toISOString(),
      };
      await this.persistIndex(index).catch((error) => this.send("language:log", {
        text: `Persistenter Java-Index konnte nicht gespeichert werden: ${error.message}\n`,
      }));
      this.send("language:status", {
        status: "ready",
        detail: index.detail,
        project: this.projectModel,
        classpath: this.classpath,
        index,
      });
    }
    return true;
  }

  async persistIndex(index) {
    if (!this.dataPath) return;
    const persistedIndex = {
      ...index,
      workspaceSchemaVersion: LANGUAGE_WORKSPACE_SCHEMA_VERSION,
    };
    this.cachedIndex = persistedIndex;
    const target = path.join(this.dataPath, "kiwi-index.json");
    const temporary = `${target}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(persistedIndex, null, 2)}\n`, "utf8");
      await fs.rename(temporary, target).catch(async () => {
        const previous = `${target}.previous`;
        await fs.rm(previous, { force: true }).catch(() => undefined);
        await fs.rename(target, previous).catch(() => undefined);
        try {
          await fs.rename(temporary, target);
        } catch (error) {
          await fs.rename(previous, target).catch(() => undefined);
          throw error;
        }
        await fs.rm(previous, { force: true }).catch(() => undefined);
      });
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async request(root, method, params, requestId = "") {
    this.pathGuard.assertWorkspace(root);
    if (!allowedRequests.has(method)) throw new Error(`Nicht erlaubte Language-Server-Methode: ${method}`);
    if (!this.ready || !this.connection || this.root !== root) {
      const started = await this.start(root);
      if (!started.available) throw new Error(started.reason);
    }
    const connection = this.connection;
    const registerCancel = requestId
      ? (cancel) => {
        this.cancellers.set(String(requestId), cancel);
        return () => this.cancellers.delete(String(requestId));
      }
      : null;
    try {
      return await sendRequestWithTimeout(connection, method, params, this.requestTimeout(method), registerCancel);
    } catch (error) {
      if (isJdtTimeout(error)) {
        this.send("language:log", {
          text: `${error.message} Die Anfrage wurde abgebrochen; der Sprachserver bleibt verfügbar.\n`,
        });
        throw error;
      }
      if (!/closed|disposed/i.test(String(error?.message || error))) throw error;
      // The replacement can become ready between the rejection and this catch
      // handler. In that small window restartPromise has already settled, but
      // the captured connection still proves that this request belongs to the
      // retired server and is safe to replay once.
      if (connection !== this.connection && this.ready && this.connection && this.root === root) {
        return sendRequestWithTimeout(this.connection, method, params, this.requestTimeout(method));
      }
      // An internal refresh restart is different from closing a project. Wait
      // for the replacement JDT connection and replay the request once, so an
      // in-flight hover/completion does not leak a disposed-connection error
      // through Electron IPC.
      if (this.restartPromise && this.restartRoot === root) {
        const restarted = await this.restartPromise.catch(() => false);
        if (restarted && this.ready && this.connection && this.root === root) {
          return sendRequestWithTimeout(this.connection, method, params, this.requestTimeout(method));
        }
      }
      // The connection is also disposed while the session is shutting down.
      // Restarting JDT LS there would fight the teardown and stall closing the
      // project, so only a live session gets a second attempt.
      if (this.stopPromise || !this.root) throw error;
      const restarted = await this.start(root);
      if (!restarted.available || !this.connection) throw error;
      return sendRequestWithTimeout(this.connection, method, params, this.requestTimeout(method));
    }
  }

  async open(root, file, text, languageId = "java") {
    this.pathGuard.assertAllowed(file, root);
    if (!this.ready || !this.connection || this.root !== root) {
      const started = await this.start(root);
      if (!started.available) return started;
    }
    const uri = pathToFileURL(file).toString();
    const current = this.documents.get(file);
    if (current) {
      if (current.text === text) return { available: true };
      const version = current.version + 1;
      this.documents.set(file, { version, text });
      try {
        this.connection.sendNotification("textDocument/didChange", {
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
      } catch (error) {
        this.documents.delete(file);
        if (!/closed|disposed/i.test(String(error?.message || error))) throw error;
        await this.start(root);
        return this.open(root, file, text, languageId);
      }
    } else {
      this.documents.set(file, { version: 1, text });
      try {
        this.connection.sendNotification("textDocument/didOpen", {
          textDocument: { uri, languageId, version: 1, text },
        });
      } catch (error) {
        this.documents.delete(file);
        if (!/closed|disposed/i.test(String(error?.message || error))) throw error;
        await this.start(root);
        return this.open(root, file, text, languageId);
      }
    }
    return { available: true };
  }

  async change(root, file, text) {
    this.pathGuard.assertAllowed(file, root);
    if (!this.ready || !this.connection || this.root !== root) {
      const started = await this.start(root);
      if (!started.available) return false;
    }
    if (!this.documents.has(file)) return this.open(root, file, text, "java");
    const current = this.documents.get(file);
    if (current.text === text) return true;
    const version = current.version + 1;
    this.documents.set(file, { version, text });
    try {
      this.connection.sendNotification("textDocument/didChange", {
        textDocument: { uri: pathToFileURL(file).toString(), version },
        contentChanges: [{ text }],
      });
    } catch (error) {
      this.documents.delete(file);
      if (!/closed|disposed/i.test(String(error?.message || error))) throw error;
      await this.start(root);
      return this.open(root, file, text, "java");
    }
    return true;
  }

  save(root, file, text) {
    this.pathGuard.assertAllowed(file, root);
    if (!this.connection || this.root !== root) return false;
    try {
      this.connection.sendNotification("textDocument/didSave", {
        textDocument: { uri: pathToFileURL(file).toString() },
        text,
      });
    } catch {
      return false;
    }
    return true;
  }

  close(root, file) {
    this.pathGuard.assertAllowed(file, root);
    if (!this.connection || this.root !== root) return false;
    try {
      this.connection.sendNotification("textDocument/didClose", {
        textDocument: { uri: pathToFileURL(file).toString() },
      });
    } catch {
      this.documents.delete(file);
      return false;
    }
    this.documents.delete(file);
    return true;
  }

  /**
   * Writes the formatter profile again and hands the server the new settings.
   *
   * Only the formatter part changes, so the classpath and the project model
   * are left exactly as they are: this must not restart an import.
   */
  async reapplyFormatterProfile() {
    if (!this.connection || !this.ready || !this.javaSettings) return false;
    const formatterUrl = await writeFormatterProfile(this.userDataPath, this.readEditorFormat?.() || {});
    if (!formatterUrl) return false;
    this.javaSettings = {
      ...this.javaSettings,
      format: { ...this.javaSettings.format, settings: { url: formatterUrl, profile: "Kiwi" } },
    };
    try {
      this.connection.sendNotification("workspace/didChangeConfiguration", { settings: { java: this.javaSettings } });
      return true;
    } catch {
      return false;
    }
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    const operation = this.stopInternal();
    this.stopPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.stopPromise === operation) this.stopPromise = null;
    }
  }

  async stopInternal() {
    const child = this.process;
    const connection = this.connection;
    this.ready = false;
    this.connection = null;
    const closed = child && child.exitCode === null
      ? new Promise((resolve) => child.once("close", resolve))
      : Promise.resolve();
    // Every request still waiting is abandoned before anything is torn down.
    // A cancellation that fires later writes $/cancelRequest to a connection
    // that may already be disposed, over a pipe whose process may already be
    // gone — and writing to that is native code, which does not fail politely.
    for (const cancel of [...this.cancellers.values()]) {
      try { cancel(); } catch {}
    }
    this.cancellers.clear();
    if (connection) {
      for (const file of this.documents.keys()) {
        try {
          connection.sendNotification("textDocument/didClose", {
            textDocument: { uri: pathToFileURL(file).toString() },
          });
        } catch {}
      }
      this.documents.clear();
      try {
        await raceWithTimeout(connection.sendRequest("shutdown"), 1200);
      } catch {}
      try { connection.sendNotification("exit"); } catch {}
    }
    // The connection is disposed only once nothing is being written over it
    // any more. Disposing it first left the shutdown request — which the race
    // above stops waiting for but does not cancel — writing into a stream that
    // had been taken apart, while the process behind it was being killed.
    await raceWithTimeout(closed, 600);
    if (child && child.exitCode === null) await terminateProcessTree(child);
    await raceWithTimeout(closed, 1200);
    if (connection) {
      try { connection.dispose(); } catch {}
    }
    this.connection = null;
    this.process = null;
    this.root = "";
    this.ready = false;
    this.documents.clear();
    this.javaSettings = null;
    this.projectModel = null;
    this.classpath = null;
    this.toolingJdk = null;
    this.capabilities = null;
    this.index = null;
    return true;
  }
}

class LanguageService {
  constructor(pathGuard, projects, toolchainRoot, userDataPath, send, maxSessions = 3, cacheRecovery = null, readEditorFormat = null) {
    this.pathGuard = pathGuard;
    this.projects = projects;
    this.toolchainRoot = toolchainRoot;
    this.userDataPath = userDataPath;
    this.send = send;
    this.maxSessions = maxSessions;
    this.cacheRecovery = cacheRecovery;
    this.readEditorFormat = readEditorFormat;
    this.sessions = new Map();
    this.lastUsed = new Map();
  }

  /**
   * Tells every running server that the editor indents differently now.
   *
   * The formatter profile is written when a session starts, so changing the
   * tab width or switching to tabs left the formatter on the old one until the
   * project was reopened. Format on save then re-indented the file the way it
   * used to be set — indentation that "resets itself" a moment after it was
   * chosen.
   */
  async applyEditorFormat() {
    await Promise.all([...this.sessions.values()].map((session) =>
      session.reapplyFormatterProfile().catch(() => false)));
  }

  getSession(root, create = true) {
    root = this.pathGuard.assertWorkspace(root);
    let session = this.sessions.get(root);
    if (!session && create) {
      session = new LanguageSession(
        this.pathGuard,
        this.projects,
        this.toolchainRoot,
        this.userDataPath,
        (channel, payload) => this.send(channel, { ...payload, projectRoot: root }),
        this.cacheRecovery,
        requestTimeoutForMethod,
        this.readEditorFormat,
      );
      this.sessions.set(root, session);
    }
    if (session) this.lastUsed.set(root, Date.now());
    return session;
  }

  async ensureCapacity(activeRoot) {
    while (this.sessions.size > this.maxSessions) {
      const candidates = [...this.sessions.entries()]
        .filter(([root]) => root !== activeRoot)
        .sort(([leftRoot, left], [rightRoot, right]) => {
          const leftOpen = left.documents.size > 0 ? 1 : 0;
          const rightOpen = right.documents.size > 0 ? 1 : 0;
          return leftOpen - rightOpen || (this.lastUsed.get(leftRoot) || 0) - (this.lastUsed.get(rightRoot) || 0);
        });
      const victim = candidates[0];
      if (!victim) break;
      await victim[1].stop();
      this.sessions.delete(victim[0]);
      this.lastUsed.delete(victim[0]);
    }
  }

  async start(root) {
    const session = this.getSession(root);
    await this.ensureCapacity(root);
    const result = await session.start(root);
    return result;
  }

  async request(root, method, params, requestId = "") {
    const session = this.getSession(root);
    await this.ensureCapacity(root);
    const result = await session.request(root, method, params, requestId);
    return result;
  }

  /** Cancels a request the renderer has moved on from, wherever it is running. */
  cancel(requestId) {
    for (const session of this.sessions.values()) {
      if (session.cancel(requestId)) return true;
    }
    return false;
  }

  async runtimeClasspath(root, sourceFile = "") {
    const session = this.getSession(root, false);
    if (!session?.ready) return null;
    return session.inspectClasspath(sourceFile);
  }

  async open(root, file, text, languageId) {
    const session = this.getSession(root);
    await this.ensureCapacity(root);
    const result = await session.open(root, file, text, languageId);
    return result;
  }

  async change(root, file, text) {
    const session = this.getSession(root);
    await this.ensureCapacity(root);
    return session?.change(root, file, text) || false;
  }

  save(root, file, text) {
    return this.getSession(root, false)?.save(root, file, text) || false;
  }

  close(root, file) {
    return this.getSession(root, false)?.close(root, file) || false;
  }

  async stop(root) {
    if (root) {
      const session = this.sessions.get(root);
      if (!session) return true;
      await session.stop();
      this.sessions.delete(root);
      this.lastUsed.delete(root);
      return true;
    }
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    this.sessions.clear();
    this.lastUsed.clear();
    return true;
  }

  async refresh(root, changedFile) {
    const session = this.getSession(root, false);
    if (!session) return false;
    const result = await session.refresh(root, changedFile);
    await this.ensureCapacity(root);
    return result;
  }

  health() {
    return {
      sessions: this.sessions.size,
      maxSessions: this.maxSessions,
      processes: [...this.sessions.entries()].map(([root, session]) => ({
        root,
        pid: session.process?.pid || 0,
        documents: session.documents.size,
        ready: Boolean(session.ready),
      })),
    };
  }
}

/**
 * The formatter profile Kiwi hands to JDT LS.
 *
 * Everything a profile leaves out keeps Eclipse's default, and three of those
 * defaults quietly rewrite what somebody typed:
 *
 *   - indent_empty_lines is off, so a blank line between two statements is
 *     emptied completely and typing on it afterwards starts at column one;
 *   - number_of_empty_lines_to_preserve is zero, so blank lines are deleted
 *     outright rather than kept;
 *   - tabulation.char is "tab", regardless of what the editor inserts, so a
 *     project written with spaces was re-indented with tabs on every save.
 *
 * With "format on save" and "auto save" both on, that ran about a second after
 * typing stopped — which is what "after a few seconds it deletes my tabs,
 * spaces and line breaks" describes.
 *
 * So the profile names the indentation the editor itself uses and says that
 * blank lines are the author's business. Everything else is still Eclipse's,
 * which is what somebody who switched formatting on asked for.
 */
function formatterProfile({ tabSize = 4, insertSpaces = true } = {}) {
  const width = Number.isFinite(Number(tabSize)) && Number(tabSize) > 0
    ? Math.min(16, Math.round(Number(tabSize)))
    : 4;
  const setting = (id, value) =>
    `    <setting id="org.eclipse.jdt.core.formatter.${id}" value="${value}"/>`;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<profiles version="21">',
    '  <profile kind="CodeFormatterProfile" name="Kiwi" version="21">',
    setting("tabulation.char", insertSpaces === false ? "tab" : "space"),
    setting("tabulation.size", width),
    setting("indentation.size", width),
    setting("indent_empty_lines", "true"),
    // Eclipse counts consecutive blank lines and throws away the rest. Nobody
    // asked for their paragraph breaks to be counted, so the limit is put far
    // above anything anyone writes on purpose.
    setting("number_of_empty_lines_to_preserve", 32),
    '  </profile>',
    '</profiles>',
    '',
  ].join("\n");
}

/**
 * Writes the profile out and answers with the URL JDT LS reads it from.
 *
 * Answers with "" when it cannot be written: the formatter then behaves as it
 * did before, which is worse than this but far better than no formatter.
 */
async function writeFormatterProfile(userDataPath, format = {}) {
  if (!userDataPath) return "";
  // The file name carries a hash of what is in it, because JDT LS remembers a
  // profile by the URL it came from. Rewriting the same path left it formatting
  // with the settings the project was opened with, however often the profile
  // was written again.
  const profile = formatterProfile(format);
  const stamp = crypto.createHash("sha256").update(profile).digest("hex").slice(0, 12);
  const target = path.join(userDataPath, `java-formatter-${stamp}.xml`);
  try {
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(target, profile, "utf8");
    return pathToFileURL(target).toString();
  } catch {
    return "";
  }
}

function createJavaSettings({ projectSettings, projectModel, projectJdk, toolchainRoot, formatterUrl = "" }) {
  const runtimePath = projectJdk?.path || "";
  const languageLevel = String(projectSettings.languageLevel || projectJdk?.major || "21");
  const runtimeMajor = Number(projectJdk?.major || languageLevel) || Number(languageLevel);
  const gradleHome = path.join(toolchainRoot, "gradle");
  const excludedPaths = (projectSettings.excludedPaths || [])
    .map((value) => String(value || "").trim().replace(/\\/g, "/"))
    .filter(Boolean);
  const excludedLibraries = new Set(
    (projectSettings.excludedLibraries || []).map((value) => String(value || "").trim().replace(/\\/g, "/").toLocaleLowerCase()),
  );
  const project = {
    importOnFirstTimeStartup: "automatic",
    importHint: false,
    // Maven/m2e and Gradle/Buildship must be able to create and link their
    // output folders. Filtering target/build makes those resources
    // inaccessible during import and leaves the project only half indexed.
    resourceFilters: [
      "node_modules",
      "\\.git",
      ...(!projectModel.managedByBuildTool ? ["\\.gradle", "target", "build", "out"] : []),
      ...excludedPaths,
    ],
    encoding: projectSettings.encoding || "UTF-8",
  };
  if (!projectModel.managedByBuildTool) {
    project.outputPath = projectModel.outputPath;
    project.referencedLibraries = projectModel.referencedLibraries.length
      ? projectModel.referencedLibraries.filter((library) => !excludedLibraries.has(library.replace(/\\/g, "/").toLocaleLowerCase()))
      : ["lib/**/*.jar", "libs/**/*.jar", "**/lib/**/*.jar", "**/libs/**/*.jar"];
    if (projectModel.sourcePaths.length) project.sourcePaths = projectModel.sourcePaths;
  }

  return {
    home: runtimePath,
    autobuild: { enabled: true },
    maxConcurrentBuilds: 2,
    errors: { incompleteClasspath: { severity: "warning" } },
    compiler: {
      problem: {
        unusedImport: projectSettings.unusedAnalysis === false ? "ignore" : "warning",
        unusedLocal: projectSettings.unusedAnalysis === false ? "ignore" : "warning",
        unusedPrivateMember: projectSettings.unusedAnalysis === false ? "ignore" : "warning",
        unusedParameter: projectSettings.unusedAnalysis === false ? "ignore" : "warning",
        deadCode: projectSettings.unusedAnalysis === false ? "ignore" : "warning",
        unreachableCode: "error",
      },
    },
    configuration: {
      updateBuildConfiguration: "automatic",
      runtimes: runtimePath ? [{
        // Eclipse requires the execution-environment name to describe the
        // installed JDK at this path, not the project's --release target.
        name: `JavaSE-${runtimeMajor === 8 ? "1.8" : runtimeMajor}`,
        path: runtimePath,
        default: true,
      }] : [],
    },
    completion: {
      enabled: true,
      maxResults: 0,
      guessMethodArguments: "insertBestGuessedArguments",
      lazyResolveTextEdit: { enabled: false },
      chain: { enabled: true },
      postfix: { enabled: true },
      matchCase: "off",
      collapseCompletionItems: false,
      favoriteStaticMembers: [
        "org.junit.jupiter.api.Assertions.*",
        "org.mockito.Mockito.*",
        "java.util.Objects.requireNonNull",
        "java.util.stream.Collectors.*",
      ],
      filteredTypes: ["com.sun.*", "sun.*", "jdk.internal.*"],
      importOrder: ["#", "java", "javax", "org", "com"],
    },
    import: {
      maven: {
        enabled: true,
        offline: { enabled: Boolean(projectSettings.mavenOffline) },
        disableTestClasspathFlag: false,
      },
      gradle: {
        enabled: true,
        wrapper: { enabled: true },
        home: fsSync.existsSync(gradleHome) ? gradleHome : null,
        java: { home: runtimePath || null },
        offline: { enabled: Boolean(projectSettings.gradleOffline) },
        annotationProcessing: { enabled: projectSettings.annotationProcessing !== false },
      },
      exclusions: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.gradle/**",
        "**/target/**",
        "**/build/**",
        "**/out/**",
        ...excludedPaths.map((entry) => `**/${entry.replace(/^\/|\/$/g, "")}/**`),
      ],
      generatesMetadataFilesAtProjectRoot: false,
    },
    maven: { downloadSources: true, updateSnapshots: false },
    signatureHelp: { enabled: true, description: { enabled: true } },
    references: { includeAccessors: true, includeDecompiledSources: true },
    symbols: { includeSourceMethodDeclarations: true, includeGeneratedCode: true },
    format: {
      enabled: true,
      onType: { enabled: true },
      // Named so JDT LS picks this profile out of the file rather than
      // the first one it happens to find.
      settings: formatterUrl ? { url: formatterUrl, profile: "Kiwi" } : undefined,
    },
    inlayHints: { parameterNames: { enabled: "all" } },
    edit: { validateAllOpenBuffersOnChanges: true },
    project,
  };
}

/** True only for the runnable Lombok artifact, never a classifier variant. */
function isLombokAgentJar(name) {
  return /^lombok(?:-\d[\w.+-]*)?\.jar$/i.test(String(name))
    && !/-(?:sources|javadoc|tests?)\.jar$/i.test(String(name));
}

async function detectLombokAgent(root, projectModel, enabled) {
  if (!enabled) return "";
  const projectJar = (projectModel.jarFiles || []).find((file) => isLombokAgentJar(path.basename(file)));
  if (projectJar) return projectJar;

  let requestedVersion = "";
  try {
    const pom = await fs.readFile(path.join(root, "pom.xml"), "utf8");
    requestedVersion = pom.match(
      /<dependency>[\s\S]*?<groupId>\s*org\.projectlombok\s*<\/groupId>[\s\S]*?<artifactId>\s*lombok\s*<\/artifactId>[\s\S]*?<version>\s*([^<]+)\s*<\/version>/i,
    )?.[1]?.trim() || "";
  } catch {}
  if (requestedVersion) {
    const mavenJar = path.join(
      os.homedir(),
      ".m2",
      "repository",
      "org",
      "projectlombok",
      "lombok",
      requestedVersion,
      `lombok-${requestedVersion}.jar`,
    );
    if (fsSync.existsSync(mavenJar)) return mavenJar;
  }

  const gradleRoot = path.join(
    os.homedir(),
    ".gradle",
    "caches",
    "modules-2",
    "files-2.1",
    "org.projectlombok",
    "lombok",
  );
  try {
    // Newest first, compared as versions rather than as text. Sorted as text,
    // "1.18.9" stands above "1.18.30" — so the cache handed JDT LS a Lombok
    // agent years older than the one the project builds with, and every
    // generated getter went missing from the editor.
    const versions = (await fs.readdir(gradleRoot)).sort((left, right) => compareVersions(right, left));
    for (const version of versions.slice(0, 8)) {
      const versionRoot = path.join(gradleRoot, version);
      const hashes = await fs.readdir(versionRoot);
      for (const hash of hashes.slice(0, 8)) {
        const directory = path.join(versionRoot, hash);
        // Only the plain artifact carries the Premain-Class manifest entry.
        // Handing the JVM a -sources or -javadoc jar as -javaagent aborts the
        // launch outright, which killed JDT LS before it said a word.
        const jar = (await fs.readdir(directory)).find((name) => isLombokAgentJar(name));
        if (jar) return path.join(directory, jar);
      }
    }
  } catch {}
  return "";
}

function isClasspathFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/").toLowerCase();
  const name = path.basename(normalized);
  return normalized.endsWith(".jar")
    || name === "pom.xml"
    || name === "build.gradle"
    || name === "build.gradle.kts"
    || name === "settings.gradle"
    || name === "settings.gradle.kts"
    || name === ".classpath"
    || name === ".project"
    || normalized.endsWith("/.kiwi/modules.json")
    || normalized.endsWith("/.kiwi/project.json");
}

function clientCapabilities() {
  return {
    workspace: {
      applyEdit: true,
      workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] },
      configuration: true,
      workspaceFolders: true,
      symbol: { dynamicRegistration: false },
    },
    textDocument: {
      synchronization: { dynamicRegistration: false, willSave: false, didSave: true },
      completion: {
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          deprecatedSupport: true,
          preselectSupport: true,
          insertReplaceSupport: true,
          labelDetailsSupport: true,
          tagSupport: { valueSet: [1] },
          insertTextModeSupport: { valueSet: [1, 2] },
          documentationFormat: ["markdown", "plaintext"],
          resolveSupport: {
            properties: [
              "documentation",
              "detail",
              "labelDetails",
              "tags",
              "commitCharacters",
              "additionalTextEdits",
              "textEdit",
              "insertText",
              "command",
            ],
          },
        },
        contextSupport: true,
      },
      hover: { contentFormat: ["markdown", "plaintext"] },
      signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"], parameterInformation: { labelOffsetSupport: true } } },
      definition: { linkSupport: true },
      references: {},
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      formatting: {},
      rangeFormatting: {},
      rename: { prepareSupport: true },
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: { valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports"] },
        },
        resolveSupport: { properties: ["edit"] },
      },
      publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, versionSupport: true },
      callHierarchy: {},
      typeHierarchy: {},
      // Without these the server answers neither request, which is why the
      // "inlay hints" setting had nothing to show and every name had to be
      // coloured by guessing from Java's naming conventions.
      inlayHint: { dynamicRegistration: false, resolveSupport: { properties: [] } },
      semanticTokens: {
        dynamicRegistration: false,
        requests: { full: true, range: false },
        formats: ["relative"],
        tokenTypes: [
          "namespace", "type", "class", "enum", "interface", "struct", "typeParameter",
          "parameter", "variable", "property", "enumMember", "event", "function",
          "method", "macro", "keyword", "modifier", "comment", "string", "number",
          "regexp", "operator", "decorator",
        ],
        tokenModifiers: [
          "declaration", "definition", "readonly", "static", "deprecated",
          "abstract", "async", "modification", "documentation", "defaultLibrary",
        ],
        overlappingTokenSupport: false,
        multilineTokenSupport: false,
      },
    },
    window: { workDoneProgress: true, showMessage: { messageActionItem: { additionalPropertiesSupport: true } } },
  };
}

function indexSummary(projectModel, classpath, projectSettings, lombokAgent) {
  const classpathEntries = collectClasspathEntries(classpath);
  const generatedSources = (projectModel?.javaFiles || []).filter((file) =>
    /[\\/](?:generated|generated-sources|generatedSources)[\\/]/i.test(file),
  ).length;
  const sourceFiles = projectModel?.javaFiles?.length || 0;
  const localJars = projectModel?.jarFiles?.length || 0;
  const declaredDependencies = projectModel?.declaredDependencies || 0;
  const dependencyCount = Math.max(localJars, classpathEntries.length, declaredDependencies);
  const annotationProcessing = projectSettings.annotationProcessing !== false;
  const lombok = Boolean(lombokAgent);
  return {
    sourceFiles,
    generatedSources,
    dependencies: dependencyCount,
    annotationProcessing,
    lombok,
    detail: [
      `${sourceFiles} Java-Dateien`,
      `${dependencyCount} Abhängigkeiten`,
      generatedSources ? `${generatedSources} generierte Sources` : "generierte Sources aktiv",
      annotationProcessing ? "Annotation Processors aktiv" : "Annotation Processors aus",
      lombok ? "Lombok indexiert" : "",
    ].filter(Boolean).join(" · "),
  };
}

function collectClasspathEntries(value, result = new Set()) {
  if (typeof value === "string") {
    for (const entry of value.split(path.delimiter)) {
      const normalized = entry.trim().replace(/^file:\/+/, "");
      if (/\.jar$/i.test(normalized)) result.add(normalized);
    }
    return [...result];
  }
  if (Array.isArray(value)) {
    for (const item of value) collectClasspathEntries(item, result);
    return [...result];
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectClasspathEntries(item, result);
  }
  return [...result];
}

function countClasspathEntries(value) {
  return collectClasspathEntries(value).length;
}

async function projectDeclaresDependencies(root, projectModel) {
  return (await declaredDependencyCount(root, projectModel)) > 0;
}

async function declaredDependencyCount(root, projectModel) {
  try {
    if (projectModel?.buildSystem === "Maven") {
      const source = await fs.readFile(path.join(root, "pom.xml"), "utf8");
      return [...source.matchAll(/<dependency\b/g)].length;
    }
    if (projectModel?.buildSystem === "Gradle") {
      const buildFile = ["build.gradle.kts", "build.gradle"]
        .map((name) => path.join(root, name))
        .find(fsSync.existsSync);
      const source = buildFile ? await fs.readFile(buildFile, "utf8") : "";
      return [...source.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|annotationProcessor|testImplementation)\s*[\(\s]/g)].length;
    }
  } catch {}
  return 0;
}

async function repairLegacyManagedMetadata(root, projectModel) {
  if (!projectModel?.managedByBuildTool) return false;
  const projectFile = path.join(root, ".project");
  let source;
  try {
    source = await fs.readFile(projectFile, "utf8");
  } catch {
    return false;
  }
  // Only migrate the resource filter generated by JDT LS. User-authored
  // Eclipse filters that do not carry this marker remain untouched.
  if (!source.includes("__CREATED_BY_JAVA_LANGUAGE_SERVER__")) return false;
  const obsolete = new Set(["\\.gradle", "target", "build", "out"]);
  const updated = source.replace(
    /(<arguments>)([^<]*__CREATED_BY_JAVA_LANGUAGE_SERVER__[^<]*)(<\/arguments>)/g,
    (_match, start, value, end) => {
      const filters = String(value).split("|").filter((entry) => !obsolete.has(entry));
      return `${start}${filters.join("|")}${end}`;
    },
  );
  if (updated === source) return false;
  const temporary = `${projectFile}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, updated, "utf8");
    await fs.rename(temporary, projectFile);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
  return true;
}

async function prepareLanguageWorkspace(dataPath, backupRoot, hash) {
  let cachedIndex = null;
  const indexPath = path.join(dataPath, "kiwi-index.json");
  const indexExists = fsSync.existsSync(indexPath);
  try {
    cachedIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch {}
  const exists = fsSync.existsSync(dataPath);
  // The summary file is only an optimization. A crash between its atomic
  // replacement steps must not throw away Eclipse's otherwise healthy index.
  if (indexExists && !cachedIndex) await fs.rm(indexPath, { force: true }).catch(() => undefined);
  if (exists && cachedIndex && cachedIndex.workspaceSchemaVersion !== LANGUAGE_WORKSPACE_SCHEMA_VERSION) {
    await fs.mkdir(backupRoot, { recursive: true });
    const backupPath = path.join(
      backupRoot,
      `${hash}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    );
    await fs.rename(dataPath, backupPath);
    await fs.mkdir(dataPath, { recursive: true });
    const backups = (await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${hash}-`))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    await Promise.all(backups.slice(MAX_LANGUAGE_WORKSPACE_BACKUPS).map((name) =>
      fs.rm(path.join(backupRoot, name), { recursive: true, force: true }),
    ));
    return { cachedIndex: null, migrated: true, backupPath };
  }
  await fs.mkdir(dataPath, { recursive: true });
  return { cachedIndex, migrated: false, backupPath: "" };
}

module.exports = {
  LanguageService,
  formatterProfile,
  LanguageSession,
  allowedRequests,
  createJavaSettings,
  isClasspathFile,
  isLombokAgentJar,
  detectLombokAgent,
  countClasspathEntries,
  projectDeclaresDependencies,
  declaredDependencyCount,
  repairLegacyManagedMetadata,
  prepareLanguageWorkspace,
  rejectAfterTimeout,
  requestTimeoutForMethod,
  sendRequestWithTimeout,
  isJdtTimeout,
  LANGUAGE_WORKSPACE_SCHEMA_VERSION,
  INITIAL_DIAGNOSTIC_SETTLE_MS,
  JDT_INITIALIZE_TIMEOUT_MS,
  JDT_SERVICE_READY_TIMEOUT_MS,
  JDT_CLASSPATH_REQUEST_TIMEOUT_MS,
  JDT_DECORATION_REQUEST_TIMEOUT_MS,
  JDT_INTERACTIVE_REQUEST_TIMEOUT_MS,
  JDT_PROJECT_REQUEST_TIMEOUT_MS,
  JDT_MUTATING_REQUEST_TIMEOUT_MS,
  JDT_TIMEOUT_CODE,
};
