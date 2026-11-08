const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PathGuard } = require("./services/path-guard.cjs");
const { DiscordPresenceService } = require("./services/discord-presence-service.cjs");
const { VulnerabilityService } = require("./services/vulnerability-service.cjs");
const { DeployService } = require("./services/deploy-service.cjs");
const { assertExternalLinkUrl } = require("./services/external-link-service.cjs");
const { PolyglotLanguageService } = require("./services/polyglot-language-service.cjs");
const { PolyglotProjectService } = require("./services/polyglot-project-service.cjs");
const { installManagedLanguageServer, installAllLanguageServers } = require("./services/language-server-installer.cjs");
const { ARTWORK_GROUND, ARTWORK_DRIFT, artworkCss, artworkMarkup } = require("./services/brand-artwork.cjs");
const { DropTokenService } = require("./services/drop-token-service.cjs");
const { SettingsService, startupWindowKind } = require("./services/settings-service.cjs");
const { WorkspaceStateService } = require("./services/workspace-state-service.cjs");
const { SessionStoreService } = require("./services/session-store-service.cjs");
const { WorkspaceService } = require("./services/workspace-service.cjs");
const { ProjectService } = require("./services/project-service.cjs");
const { ModuleService } = require("./services/module-service.cjs");
const { RunConfigService } = require("./services/run-config-service.cjs");
const { BuildService } = require("./services/build-service.cjs");
const { BuildTaskCache } = require("./services/build-task-cache.cjs");
const { CacheRecoveryService } = require("./services/cache-recovery-service.cjs");
const artifactCaches = require("./services/artifact-cache-service.cjs");
const jdkDownloads = require("./services/jdk-download-service.cjs");
const { CollabGuest, CollabHost } = require("./services/collab-session.cjs");
const portMapping = require("./services/port-mapping-service.cjs");
const collabMirror = require("./services/collab-mirror-service.cjs");
/** The one session of each kind this workbench may take part in. */
let collabHost = null;
let collabGuest = null;
let collabHostGeneration = 0;
let collabJoinGeneration = 0;

/** Renews the router mapping while a public session runs. */
let collabMappingRenewal = null;

/** Clear the global reference before waiting, so no late IPC can reuse it. */
async function stopCollabHosting() {
  collabHostGeneration += 1;
  // The mapping is for this session. Leaving it open would keep a port on
  // somebody's router pointed at a machine that is no longer listening.
  collabMappingRenewal?.stop();
  collabMappingRenewal = null;
  const host = collabHost;
  collabHost = null;
  await host?.stop();
}

/**
 * What the teardown needs, handed to it rather than reached for.
 *
 * stopCollabGuest() runs at module level and the PathGuard lives inside the
 * registration function, so unregistering from there threw a ReferenceError
 * — but only once a guest with a working copy left, which is a path no test
 * of the workbench itself walks.
 */
let unregisterMirrorRoot = () => undefined;

/** The working copy of the running session, so it can always be removed. */
let collabMirrorRoot = "";
/** Keeps the working copy in step; module scope, so teardown can reach it. */
let collabRefresher = null;

function stopCollabGuest() {
  collabJoinGeneration += 1;
  const guest = collabGuest;
  collabGuest = null;
  guest?.disconnect();
  // The copy goes with the session, whatever ended it — leaving, the host
  // hanging up, the project hub being opened, the window closing. A copy of
  // somebody else's project left behind on this disk is the one outcome this
  // whole feature must not produce.
  collabRefresher?.stop();
  const root = guest?.mirrorRoot || collabMirrorRoot;
  collabMirrorRoot = "";
  if (!root) return;
  try {
    unregisterMirrorRoot(root);
  } catch { /* it was never registered */ }
  void collabMirror.removeMirror(app.getPath("temp"), root);
}
const { GitService } = require("./services/git-service.cjs");
const { TestService } = require("./services/test-service.cjs");
const { TerminalService } = require("./services/terminal-service.cjs");
const { TailerService } = require("./services/tailer-service.cjs");
const { DebugService } = require("./services/debug-service.cjs");
const { HttpClientService } = require("./services/http-client-service.cjs");
const { BreakpointService } = require("./services/breakpoint-service.cjs");
const { TemplateService } = require("./services/template-service.cjs");
const { IndexService } = require("./services/index-service.cjs");
const { BytecodeService } = require("./services/bytecode-service.cjs");
const { LanguageService } = require("./services/language-service.cjs");
const { WorkflowService } = require("./services/workflow-service.cjs");
const { JavaRefactorService } = require("./services/java-refactor-service.cjs");
const { DependencyService } = require("./services/dependency-service.cjs");
const { SystemFontService } = require("./services/system-font-service.cjs");
const {
  UpdateService,
  assertUpdateDownloadUrl,
  compareVersions,
  nsisUpdateArguments,
  createUpdatePrepareState,
  acknowledgeUpdatePrepare,
  updatePrepareComplete,
} = require("./services/update-service.cjs");
const {
  applyRendererUpdate,
  discardRendererUpdate,
  mainProcessHash,
  pruneRendererUpdates,
  readCurrentRenderer,
  resolveRendererRoot,
} = require("./services/renderer-update-service.cjs");
const {
  discardPortableStage,
  portableHelperArguments,
  setupHelperArguments,
  stagePortableUpdate,
} = require("./services/portable-update-service.cjs");
const { GitHubAuthService } = require("./services/github-auth-service.cjs");
const { DatabaseService } = require("./services/database-service.cjs");
const { DockerService } = require("./services/docker-service.cjs");

const DEV_URL = "http://127.0.0.1:5173";
// Updating loaded Electron/asar/native files is only safe when one Kiwi
// process owns userData and the installation. A second launch focuses the
// existing workbench instead of starting another set of JDT/terminal/debug
// processes that an updater could not flush or stop.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const UPDATED_LAUNCH = process.argv.includes("--updated");
const UPDATE_FAILED_LAUNCH = process.argv.includes("--update-failed");
const APP_ROOT = path.join(__dirname, "..");
const BUNDLED_RENDERER = path.join(APP_ROOT, "dist");
// Fingerprint of this main process. Only a renderer built against exactly this
// code may be loaded in its place, which is what allows an update to be
// applied to the running application instead of through the installer.
const MAIN_PROCESS_HASH = (() => {
  try {
    return mainProcessHash(APP_ROOT, {
      electronVersion: process.versions.electron || "",
      dependencies: require("../package.json").dependencies,
    });
  } catch {
    // Without a fingerprint no renderer update is ever accepted; the packaged
    // renderer keeps working.
    return "";
  }
})();
/** Renderer the windows load: an applied update, or the packaged one. */
let rendererRoot = { directory: BUNDLED_RENDERER, version: app.getVersion(), hot: false };

function refreshRendererRoot() {
  try {
    rendererRoot = resolveRendererRoot(app.getPath("userData"), BUNDLED_RENDERER, {
      mainHash: MAIN_PROCESS_HASH,
      appVersion: app.getVersion(),
      compareVersions,
    });
  } catch {
    rendererRoot = { directory: BUNDLED_RENDERER, version: app.getVersion(), hot: false };
  }
  return rendererRoot;
}

/** The version Kiwi actually shows and updates from. */
function effectiveVersion() {
  return rendererRoot.hot ? rendererRoot.version : app.getVersion();
}
let editorWindow;
let welcomeWindow;
let settingsWindow;
let splashWindow;
let splashStartedAt = 0;
/**
 * How long the splash stays up, and what it does with the time.
 *
 * Not a pause: the work below is work the first minutes of a session
 * would otherwise spend anyway — probing JDKs, reading the project, asking
 * Gradle what tasks exist. Doing it here means the workbench opens onto a
 * build tool window that is already filled rather than one that spends
 * those seconds saying it has no tasks.
 *
 * KIWI_SPLASH_MINIMUM_MS overrides it. The end-to-end gate sets it low:
 * three runs waiting fifteen seconds each on a splash they do not examine
 * is three quarters of a minute spent proving nothing. The preload itself
 * still runs there, so a step that throws is still caught.
 */
const SPLASH_MINIMUM_MS = (() => {
  // An empty variable is not a zero: Number("") is 0 and would silently
  // switch the splash off for anybody who exported the name and no value.
  const configured = String(process.env.KIWI_SPLASH_MINIMUM_MS || "").trim();
  const parsed = Number(configured);
  return configured && Number.isFinite(parsed) ? Math.max(0, parsed) : 15_000;
})();
/**
 * And the point at which it stops waiting for that work.
 *
 * A Gradle build that cannot configure, a wrapper downloading itself over
 * a slow line: the preload has its own bound so a build nobody can fix
 * from the splash cannot keep the IDE from opening at all.
 */
const SPLASH_PRELOAD_LIMIT_MS = 90_000;
/**
 * Whether the startup preload runs at all.
 *
 * Off in the gates. Its steps spawn processes — a `java -version` per JDK
 * candidate, a Gradle configuration phase, the language server — and doing
 * that while a smoke run is driving the workbench made the runs less
 * reliable than they were: the end-to-end gate failed twice in two
 * different places, and the layout gate once, against runs that had been
 * green. A gate that fails at random is worse than one that covers a
 * little less, and this is measured in the running IDE instead.
 */
const STARTUP_PRELOAD = String(process.env.KIWI_STARTUP_PRELOAD || "").trim() !== "0";
let splashPreload = Promise.resolve();
let splashPreloadStarted = false;
let services;
let shutdownStarted = false;
let shutdownComplete = false;
/**
 * Set while a workspace is being closed.
 *
 * Closing the workspace is asked for by the very window that then goes away,
 * and the request to open the project hub afterwards travels through that same
 * window. When it does not arrive — the renderer's context is torn down mid
 * call — Windows is left with no window at all, and "window-all-closed" ends
 * the program. From the outside Kiwi simply vanishes on closing a project.
 *
 * Cleared as soon as the hub is actually being opened, so closing the hub
 * itself still quits.
 */
let reopeningHub = false;
let pendingUpdateLaunch = null;
let updateInstallPromise = null;
let updateRuntimeState = {
  status: UPDATE_FAILED_LAUNCH ? "error" : UPDATED_LAUNCH ? "installed" : "idle",
  currentVersion: app.getVersion(),
  version: UPDATED_LAUNCH ? app.getVersion() : undefined,
  ...(UPDATE_FAILED_LAUNCH ? {
    operation: "install",
    reason: "Das Update konnte nicht installiert werden. Die bisherige Kiwi-Version und der Workspace wurden automatisch wieder geöffnet.",
  } : {}),
  updatedAt: new Date().toISOString(),
};
const approvedBackgroundImages = new Set();

/**
 * Every picture the settings currently name.
 *
 * The single image, and each entry of the playlist. A project's own picture is
 * approved where it is chosen rather than here, because the project settings
 * live per project and this side holds one set for the whole app.
 */
/**
 * Pictures a project named for itself.
 *
 * Project settings live per project and this side holds one set for the whole
 * app, so they are collected as they are read rather than looked up here.
 */
const projectBackgroundPaths = new Set();

function rememberProjectBackground(projectSettings) {
  const image = String(projectSettings?.backgroundImage || "");
  if (image) projectBackgroundPaths.add(path.resolve(image));
  return projectSettings;
}

function projectBackgroundImages() {
  return [...projectBackgroundPaths];
}

function configuredBackgroundImages(current) {
  const list = [
    current?.backgroundImage,
    ...(Array.isArray(current?.backgroundPlaylist) ? current.backgroundPlaylist : []),
  ];
  return list.filter(Boolean).map((entry) => path.resolve(String(entry)));
}
const approvedDroppedFiles = new DropTokenService();

async function recordCrash(kind, details) {
  if (!services?.settings.get().crashReporting) return;
  try {
    const directory = path.join(app.getPath("userData"), "crash-reports");
    await fsp.mkdir(directory, { recursive: true });
    const error = details instanceof Error ? details : null;
    const report = {
      version: app.getVersion(),
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      kind,
      message: error?.message || String(details?.reason || details || "Unbekannter Fehler"),
      stack: error?.stack || "",
      details: error ? undefined : details,
    };
    const filename = `${Date.now()}-${String(kind).replace(/[^A-Za-z0-9_-]/g, "-")}.json`;
    await fsp.writeFile(path.join(directory, filename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    // Crash reporting must never make the original failure worse.
  }
}

/**
 * Channels a guest in a CodeToGetter session is shown as well.
 *
 * What a build printed, what the tests said, what the debugger is doing: two
 * people working on one project were watching the same file and different
 * output, so only one of them ever knew whether it had compiled. The host runs
 * all of it — the toolchain is on the host's machine — so the host is where
 * this has to be passed on from.
 *
 * Deliberately output only. Nothing here lets a guest start any of it; that is
 * what the build, debug and terminal permissions are for.
 */
const SHARED_OUTPUT_CHANNELS = new Set(["java:output", "java:exit", "debug:output", "debug:state"]);

function send(channel, payload) {
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send(channel, payload);
  if (SHARED_OUTPUT_CHANNELS.has(channel)) shareOutputWithGuests(channel, payload);
}

/**
 * Passes one line of output on to everybody in the session.
 *
 * Wrapped rather than broadcast directly so a session that is not running, or
 * a host that has just stopped one, costs nothing and throws nothing on a path
 * that every line of build output goes through.
 */
function shareOutputWithGuests(channel, payload) {
  const host = collabHost;
  if (!host?.peers?.size) return;
  try {
    host.broadcast({ type: "output", channel, payload });
  } catch {
    // A session ending mid-build must not take the build's output with it.
  }
}

function broadcast(channel, payload, excludedWebContents) {
  const windows = new Set([editorWindow, welcomeWindow, settingsWindow, ...openWindows.values()]);
  for (const browserWindow of windows) {
    if (!browserWindow || browserWindow.isDestroyed() || browserWindow.webContents === excludedWebContents) continue;
    browserWindow.webContents.send(channel, payload);
  }
}

function publishUpdateState(status, details = {}) {
  updateRuntimeState = {
    status,
    currentVersion: effectiveVersion(),
    updatedAt: new Date().toISOString(),
    ...details,
  };
  broadcast("app:updateState", updateRuntimeState);
  return updateRuntimeState;
}

/**
 * Applies a renderer update to the running application.
 *
 * The windows are reloaded from the new renderer instead of the process being
 * replaced: terminals, the language server, the debugger and every background
 * task keep running, and the renderer restores its own tabs from the snapshot
 * it just flushed. If the new renderer cannot even load, the applied bundle is
 * dropped and the packaged one comes back — which is why the failure path
 * reloads rather than leaving a blank window behind.
 */
async function applyRendererUpdateInPlace(downloaded, expectedMainHash) {
  const previous = rendererRoot;
  const applied = await applyRendererUpdate({
    bundlePath: downloaded.path,
    userDataPath: app.getPath("userData"),
    mainHash: expectedMainHash || MAIN_PROCESS_HASH,
    version: downloaded.version,
  });
  refreshRendererRoot();
  if (!rendererRoot.hot) {
    await discardRendererUpdate(app.getPath("userData")).catch(() => undefined);
    rendererRoot = previous;
    throw new Error("Das Renderer-Update wurde nach der Installation nicht akzeptiert.");
  }
  // Reloading throws away the debugger's frames, variables and watches, which
  // only live in the renderer. A paused breakpoint is worth more than a few
  // minutes of newer interface: the update stays installed and the next start
  // picks it up.
  const debugging = Boolean(services?.debug?.health?.().active);
  const windows = debugging ? [] : [...new Set([editorWindow, welcomeWindow, settingsWindow, ...openWindows.values()])]
    .filter((browserWindow) => browserWindow && !browserWindow.isDestroyed() && browserWindow.kiwiLoad);
  for (const browserWindow of windows) {
    const { kind, context } = browserWindow.kiwiLoad;
    loadWindow(browserWindow, kind, context);
  }
  // The running version changed without the executable changing, so the next
  // check has to compare against the applied renderer.
  if (services?.updates) services.updates.currentVersion = effectiveVersion();
  void pruneRendererUpdates(app.getPath("userData"), readCurrentRenderer(app.getPath("userData"))?.directory || "")
    .catch(() => undefined);
  return { ...applied, reloaded: !debugging };
}

/** Returns to the packaged renderer after a broken update. */
async function revertRendererUpdate(reason) {
  if (!rendererRoot.hot) return false;
  await discardRendererUpdate(app.getPath("userData")).catch(() => undefined);
  refreshRendererRoot();
  for (const browserWindow of [...new Set([editorWindow, welcomeWindow, settingsWindow, ...openWindows.values()])]) {
    if (!browserWindow || browserWindow.isDestroyed() || !browserWindow.kiwiLoad) continue;
    loadWindow(browserWindow, browserWindow.kiwiLoad.kind, browserWindow.kiwiLoad.context);
  }
  publishUpdateState("error", {
    operation: "install",
    reason: `Das Update wurde zurückgenommen: ${reason}`,
  });
  return true;
}

function updateErrorMessage(error, fallback = "Update fehlgeschlagen.") {
  return error instanceof Error && error.message ? error.message : String(error || fallback);
}

function portableUpdateHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "update-helper", "portable-update.ps1")
    : path.join(__dirname, "..", "resources", "update-helper", "portable-update.ps1");
}

function setupUpdateHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "update-helper", "setup-update.ps1")
    : path.join(__dirname, "..", "resources", "update-helper", "setup-update.ps1");
}

/** Terminal output is shared by the workbench and every popped-out session. */
function sendTerminal(channel, payload) {
  const windows = new Set([editorWindow]);
  for (const [key, browserWindow] of openWindows) {
    if (String(key).startsWith("terminal:")) windows.add(browserWindow);
  }
  for (const browserWindow of windows) {
    if (!browserWindow || browserWindow.isDestroyed()) continue;
    browserWindow.webContents.send(channel, payload);
  }
}

async function moveRepairData(source, target) {
  try {
    await fsp.rename(source, target);
    return "rename";
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    // Project caches can live on another drive than Electron's userData folder.
    // Copy first and remove the source only after the copy is verifiably present.
    await fsp.cp(source, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
    await fsp.stat(target);
    await fsp.rm(source, { recursive: true, force: false });
    return "copy";
  }
}

function loadWindow(browserWindow, kind, context = {}) {
  const query = { window: kind, ...context };
  // Remembered so an applied renderer update can reload this window exactly as
  // it was opened, instead of guessing its kind and context afterwards.
  browserWindow.kiwiLoad = { kind, context };
  if (!app.isPackaged && process.env.KIWI_LOAD_DIST !== "1") {
    browserWindow.loadURL(`${DEV_URL}/?${new URLSearchParams(query).toString()}`);
  } else {
    browserWindow.loadFile(path.join(rendererRoot.directory, "index.html"), { query });
  }
}

function createStartupSplash() {
  const iconPath = path.join(__dirname, "..", "assets", "icons", "kiwi-256.png");
  const iconData = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).toDataURL() : "";
  splashStartedAt = Date.now();
  splashWindow = new BrowserWindow({
    // A splash is a card that says what is starting, not a stand-in for the
    // window behind it: at the workbench's own size it read as an app that
    // had already opened and then replaced itself.
    width: 700,
    height: 400,
    show: true,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#091419",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const markImage = iconData ? `<img src="${iconData}" alt="">` : "";
  const html = `<!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
        <style>
          * { box-sizing: border-box; }
          html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
          body {
            color: #e8f0f2;
            background: #06100f;
            font-family: "Segoe UI", Arial, sans-serif;
            user-select: none;
          }
          main {
            width: 100%;
            height: 100%;
            display: grid;
            /* Name on the left, artwork on the right, and the progress line
               across the foot of both. Each has a cell of its own: the bar used
               to float over the card and hid the maker line behind it. */
            grid-template-columns: 1fr 258px;
            grid-template-rows: 1fr auto;
            overflow: hidden;
            border: 1px solid #1d3a34;
            background: #06100f;
          }
          .card { display: grid; align-content: space-between; padding: 42px 38px 34px; }
          h1 {
            margin: 0;
            /* Three short lines rather than one long one, so the name stays
               large enough to read across a desk. */
            max-width: 8ch;
            font-size: 44px;
            font-weight: 300;
            line-height: 1.06;
            letter-spacing: -.5px;
            animation: rise .4s cubic-bezier(.2,.9,.3,1) both;
          }
          h1 em { display: block; font-style: normal; font-weight: 600; }
          h1 span { display: block; color: #8fd96a; font-size: 30px; font-weight: 300; }
          .maker { display: flex; align-items: center; gap: 10px; animation: rise .4s cubic-bezier(.2,.9,.3,1) both; }
          .maker img { width: 28px; height: 28px; object-fit: contain; }
          .maker b { font-size: 13px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; }
          /* The name is set in caps, the category is not: uppercasing it too
             turned "IDEs" into "IDES", which reads as a different word. */
          .maker b i { color: #8fd96a; font-style: normal; text-transform: none; }
          .art { position: relative; overflow: hidden; background: ${ARTWORK_GROUND}; }
          /* Bands of colour that run off every edge, the way cover art does.
             Drawn from gradients, so the splash waits for no image to load, and
             written down once in brand-artwork.cjs: the installer's panel is
             built from the same numbers rather than a copy of them. */
${artworkCss(".art", "drift")}
          .loading { grid-column: 1 / -1; background: #06100f; }
          .track { position: relative; height: 3px; overflow: hidden; background: #10241f; }
          /* A real measure rather than a sweep: the splash now knows how much
             of the preload is done, and a bar that only slides says nothing. */
          .track b {
            position: absolute; inset: 0 auto 0 0; display: block; width: 0;
            background: linear-gradient(90deg, #3f9e2a, #71cc3e 60%, #d6f36e);
            transition: width .4s cubic-bezier(.4,0,.2,1);
          }
          .track b::after {
            position: absolute; inset: 0 0 0 auto; display: block; width: 46px; content: "";
            background: linear-gradient(90deg, transparent, #ffffff59);
            animation: shimmer 1.4s ease-in-out infinite;
          }
          .caption {
            display: flex; justify-content: space-between;
            padding: 10px 38px 12px;
            color: #6d8781; font-size: 11px;
          }
          .caption strong { color: #9ab3ad; font-weight: 600; }
          @keyframes drift { ${ARTWORK_DRIFT} }
          @keyframes shimmer { 50% { opacity: .35; } }
          @keyframes rise { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
          /* Respect the OS setting: keep the artwork, drop the motion. */
          @media (prefers-reduced-motion: reduce) {
            .art i, h1, .maker, .track b::after { animation: none; }
            .track b { transition: none; }
          }
        </style>
      </head>
      <body>
        <main role="status" aria-label="Kiwi IDE wird gestartet">
          <div class="card">
            <h1>Kiwi<em>IDE</em><span>${effectiveVersion()}</span></h1>
            <div class="maker">
              ${markImage}
              <b>Kiwi&nbsp;<i>IDEs</i></b>
            </div>
          </div>
          <div class="art">${artworkMarkup()}</div>
          <div class="loading">
            <div class="track"><b id="balken"></b></div>
            <div class="caption"><strong id="schritt">Workspace wird vorbereitet</strong><span id="anteil">Java-Entwicklungsumgebung</span></div>
          </div>
        </main>
      </body>
    </html>`;
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWindow.on("closed", () => {
    splashWindow = undefined;
  });
}

/**
 * Tells the splash where it is, and lets the bar creep while a step runs.
 *
 * The bar is driven to the *next* step's share over that step's expected
 * duration rather than being parked at the current one: asking Gradle takes
 * seven seconds, and a bar that does not move for seven seconds reads as a
 * program that has stopped. Overshooting is impossible — the target is where
 * the next step begins — and a step that finishes early simply restarts the
 * animation from wherever it had got to.
 *
 * Driven through executeJavaScript rather than a channel: the splash has no
 * preload script, and giving it one to move a bar would be the larger change.
 * A destroyed window is not an error here — the splash going away first is the
 * normal ending.
 */
function reportToSplash(step, index, total, expectedMs = 600) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const text = JSON.stringify(String(step));
  const from = (Math.max(0, Math.min(index, total)) / Math.max(1, total)) * 100;
  const to = (Math.max(0, Math.min(index + 1, total)) / Math.max(1, total)) * 100;
  const counter = JSON.stringify(index >= total ? "fertig" : `Schritt ${index + 1} von ${total}`);
  void splashWindow.webContents.executeJavaScript(`(() => {
    const step = document.getElementById("schritt");
    const bar = document.getElementById("balken");
    const share = document.getElementById("anteil");
    if (step) step.textContent = ${text};
    if (share) share.textContent = ${counter};
    if (!bar) return;
    const current = bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width * 100;
    bar.style.transition = "none";
    bar.style.width = Math.max(${from}, current || 0) + "%";
    // Read back, so the browser treats the two widths as separate states and
    // animates between them rather than jumping straight to the second.
    void bar.offsetWidth;
    bar.style.transition = "width ${Math.max(200, expectedMs)}ms linear";
    bar.style.width = "${to}%";
  })()`).catch(() => undefined);
}

/** What is left of the time the splash is up for regardless. */
function splashTimeLeft() {
  return Math.max(0, SPLASH_MINIMUM_MS - (Date.now() - splashStartedAt));
}

/**
 * The work the first minutes of a session would do anyway, done up front.
 *
 * Every step here is something the workbench asks for as soon as it opens, and
 * each is slow for its own reason: probing a JDK runs `java -version`, reading
 * a project walks its build files, and asking Gradle for its task list costs a
 * full configuration phase — seven seconds on a build of five empty modules,
 * far more on a real one. Doing that while the splash is up trades a wait
 * nobody can see for one somebody is already watching, and the answers are
 * kept, so the workbench opens onto a build tool window that is already
 * filled rather than one that spends those seconds saying it has no tasks.
 *
 * A step marked `untilSplashEnds` is started but waited for only as long as
 * the splash is up anyway. The language server and the symbol index are both:
 * either can take a minute on a large project, and holding the workbench for
 * them would turn a head start into a delay. They keep running, and the
 * renderer's own calls join the run in progress rather than beginning a
 * second one.
 *
 * The durations are for the bar alone. They are guesses, they are allowed to
 * be wrong, and nothing waits on them.
 *
 * Nothing here may throw: a step that fails costs its own speed-up and nothing
 * else, because everything it does is also done on demand later.
 */
async function prewarmStartup() {
  const state = services.workspaceState.snapshot();
  const active = state.activeRoot && fs.existsSync(state.activeRoot) ? state.activeRoot : "";
  if (active) services.guard.register(active);
  const activeInfo = active ? await services.projects.detect(active).catch(() => null) : null;
  const javaProject = !activeInfo?.language || activeInfo.language === "java";
  const steps = [
    { label: "Java-Installationen werden gesucht", expected: 900, run: () => services.projects.listJdks() },
    { label: "Schriftarten werden gelesen", expected: 400, run: () => services.systemFonts.list() },
    ...(active ? [
      {
        label: "Projekt wird gelesen",
        expected: 300,
        run: async () => {
          services.guard.register(active);
          return services.projects.detect(active);
        },
      },
      { label: "Module werden bestimmt", expected: 300, run: () => services.modules.list(active) },
      { label: "Build-Tasks werden geladen", expected: 9_000, run: () => javaProject ? services.builds.listTasks(active) : services.polyglotProjects.plan({ root: active, action: "build", language: activeInfo.language }) },
      { label: "Tests werden gesucht", expected: 400, run: () => javaProject ? services.tests.discover(active) : Promise.resolve([]) },
      {
        label: "Sprachserver wird gestartet",
        expected: 5_000,
        untilSplashEnds: true,
        run: () => javaProject ? services.language.start(active) : services.polyglot.status(active),
      },
      {
        label: "Symbole werden indiziert",
        expected: 6_000,
        untilSplashEnds: true,
        run: () => services.projectIndex.build(active),
      },
    ] : []),
  ];

  for (const [index, step] of steps.entries()) {
    reportToSplash(step.label, index, steps.length, step.expected);
    const started = Date.now();
    const work = Promise.resolve()
      .then(step.run)
      .catch((error) => {
        // Said out loud rather than swallowed: a step that always fails is a
        // step that always costs its time and never buys anything.
        console.error("[Start] " + step.label + " fehlgeschlagen:", error?.message || error);
      });
    if (step.untilSplashEnds) {
      await Promise.race([work, new Promise((resolve) => setTimeout(resolve, splashTimeLeft()))]);
    } else {
      await work;
    }
    console.log("[Start] " + step.label + ": " + (Date.now() - started) + " ms");
  }
  reportToSplash("Bereit", steps.length, steps.length, 300);
}

function showWindowAfterSplash(browserWindow) {
  const finish = () => {
    if (!browserWindow.isDestroyed()) browserWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  };
  if (!splashWindow || splashWindow.isDestroyed()) {
    finish();
    return;
  }
  /*
   * The preload starts here, once the window is built.
   *
   * Started beside the window instead, it competed with it: probing JDKs
   * spawns a `java -version` for each candidate, and doing that while the
   * renderer is still loading made the workbench arrive slower and less
   * reliably than before any of this existed — the end-to-end gate failed
   * twice, in two different places, against a run that had been green.
   * Nothing is lost by waiting: the splash is up for fifteen seconds either
   * way, and the window needs about three of them.
   */
  // Once. Two windows built while the splash is still up would otherwise
  // each start their own run of it.
  if (STARTUP_PRELOAD && !splashPreloadStarted) {
    splashPreloadStarted = true;
    splashPreload = prewarmStartup().catch(() => undefined);
  }
  /*
   * The splash stays for its minimum and for as long as the preload runs.
   *
   * Both, not either: finishing early would cut short a splash somebody was
   * told to expect, and waiting only on the clock would hand over a workbench
   * whose build tool window is still empty. The preload carries its own limit,
   * so a Gradle build that cannot configure delays the workbench by that much
   * and no more.
   */
  const held = Promise.race([
    splashPreload,
    new Promise((resolve) => setTimeout(resolve, SPLASH_PRELOAD_LIMIT_MS)),
  ]);
  void held.then(() => {
    const remaining = Math.max(0, SPLASH_MINIMUM_MS - (Date.now() - splashStartedAt));
    if (remaining === 0) finish();
    else setTimeout(finish, remaining);
  });
}

/**
 * Size, title and identity of each window kind.
 *
 * A map rather than a chain of ternaries: a new window used to mean touching
 * six conditions, and missing one of them is the kind of mistake nothing fails
 * loudly for.
 */
const windowKinds = {
  editor: { width: 1510, height: 960, minWidth: 980, minHeight: 640, title: "Kiwi IDE" },
  welcome: { width: 1120, height: 720, minWidth: 820, minHeight: 560, title: "Willkommen bei Kiwi" },
  settings: { width: 1080, height: 760, minWidth: 760, minHeight: 560, title: "Kiwi Einstellungen" },
  structure: { width: 1080, height: 780, minWidth: 820, minHeight: 580, title: "Projektstruktur" },
  terminal: { width: 760, height: 440, minWidth: 480, minHeight: 260, title: "Kiwi Terminal" },
  panel: { width: 980, height: 520, minWidth: 520, minHeight: 300, title: "Kiwi Werkzeugfenster" },
  wizard: { width: 1100, height: 760, minWidth: 860, minHeight: 580, title: "Neues Projekt" },
};

const openWindows = new Map();
const terminalWindowContexts = new Map();
// Detached tool windows. The workbench owns the panel data and publishes
// snapshots; these windows draw them and send their clicks back, so a second
// monitor shows the same tool window without a second workbench behind it.
const panelWindows = new Set();

function panelWindowContext() {
  return { projectRoot: services?.workspaceState?.snapshot?.().activeRoot || "" };
}

function broadcastToPanelWindows(channel, payload) {
  for (const browserWindow of panelWindows) {
    if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) continue;
    browserWindow.webContents.send(channel, payload);
  }
}

function notifyPanelWindowState() {
  if (!editorWindow || editorWindow.isDestroyed()) return;
  editorWindow.webContents.send("panel:windowState", { open: panelWindows.size > 0 });
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    const current = editorWindow || welcomeWindow || settingsWindow;
    if (!current || current.isDestroyed()) return;
    if (current.isMinimized()) current.restore();
    current.show();
    current.focus();
  });
}

async function prepareRenderersForUpdate(version, timeoutMs = 7_500) {
  const targets = [...new Set(openWindows.values())]
    .filter((browserWindow) => browserWindow
      && !browserWindow.isDestroyed()
      && !browserWindow.webContents.isDestroyed());
  let state = createUpdatePrepareState(targets.map((browserWindow) => browserWindow.webContents.id));
  if (updatePrepareComplete(state)) return state;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      ipcMain.removeListener("app:updatePrepared", onPrepared);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(state);
    };
    const onPrepared = (event, acknowledgement) => {
      state = acknowledgeUpdatePrepare(state, event.sender.id, acknowledgement);
      if (!updatePrepareComplete(state)) return;
      if (state.failures.length) {
        finish(new Error(state.failures.map((failure) => failure.reason).join(" ")));
      } else {
        finish();
      }
    };
    const timer = setTimeout(() => {
      finish(new Error(`Die Sitzung konnte nicht sicher gespeichert werden (Fenster ${state.pending.join(", ")} antwortet nicht).`));
    }, timeoutMs);

    ipcMain.on("app:updatePrepared", onPrepared);
    for (const browserWindow of targets) {
      browserWindow.webContents.send("app:updatePrepare", {
        requestId: state.requestId,
        version,
      });
    }
  });
}

function terminalWindowKey(projectRoot, sessionId = "1") {
  const normalizedRoot = path.resolve(String(projectRoot || "")).toLocaleLowerCase();
  const rootHash = crypto.createHash("sha256").update(normalizedRoot).digest("hex").slice(0, 20);
  return `terminal:${rootHash}:${String(sessionId || "1")}`;
}

function closeTerminalWindows(projectRoot = "") {
  const normalizedRoot = projectRoot ? path.resolve(projectRoot).toLocaleLowerCase() : "";
  for (const [key, browserWindow] of [...openWindows]) {
    if (!String(key).startsWith("terminal:")) continue;
    const context = terminalWindowContexts.get(browserWindow.webContents.id);
    if (normalizedRoot && path.resolve(context?.projectRoot || "").toLocaleLowerCase() !== normalizedRoot) continue;
    if (!browserWindow.isDestroyed()) browserWindow.close();
  }
}

function createWindow(kind, replaceOther = false, context = {}) {
  // Any window at all ends the gap that closing a workspace opens, so a later
  // quit is a quit again rather than a trip back to the hub.
  reopeningHub = false;
  const isTerminal = kind === "terminal";
  const identity = isTerminal ? terminalWindowKey(context.projectRoot, context.sessionId) : kind;
  const current = openWindows.get(identity);
  if (current && !current.isDestroyed()) {
    current.show();
    current.focus();
    if (kind === "settings" || kind === "structure") {
      current.webContents.send("settings:context", { projectRoot: context.projectRoot || "" });
    }
    if (kind === "wizard") {
      current.webContents.send("wizard:context", { initialLocation: context.initialLocation || "" });
    }
    if (replaceOther) {
      const other = kind === "editor" ? welcomeWindow : editorWindow;
      if (other && !other.isDestroyed()) other.close();
    }
    return current;
  }

  const icon = path.join(__dirname, "..", "assets", "icons", "kiwi-256.png");
  const isEditor = kind === "editor";
  const isSettings = kind === "settings";
  const terminalContext = isTerminal ? {
    projectRoot: context.projectRoot,
    sessionId: String(context.sessionId || "1"),
  } : null;
  const shape = windowKinds[kind] || windowKinds.welcome;
  const browserWindow = new BrowserWindow({
    width: shape.width,
    height: shape.height,
    minWidth: shape.minWidth,
    minHeight: shape.minHeight,
    show: false,
    frame: false,
    backgroundColor: "#091216",
    title: shape.title,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const browserContentsId = browserWindow.webContents.id;
  // The developer tools came with the default menu that is now gone. They stay
  // reachable on the chord everyone expects, and nothing else does.
  browserWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift || input.alt) return;
    if (String(input.key).toLowerCase() !== "i") return;
    if (browserWindow.webContents.isDevToolsOpened()) browserWindow.webContents.closeDevTools();
    else browserWindow.webContents.openDevTools({ mode: "detach" });
  });

  openWindows.set(identity, browserWindow);
  if (isEditor) editorWindow = browserWindow;
  else if (isSettings) settingsWindow = browserWindow;
  else if (kind === "welcome") welcomeWindow = browserWindow;
  if (isTerminal) {
    terminalWindowContexts.set(browserContentsId, terminalContext);
  }

  browserWindow.on("closed", () => {
    if (panelWindows.delete(browserWindow)) notifyPanelWindowState();
    if (openWindows.get(identity) === browserWindow) openWindows.delete(identity);
    if (isEditor && editorWindow === browserWindow) editorWindow = undefined;
    if (isSettings && settingsWindow === browserWindow) settingsWindow = undefined;
    if (kind === "welcome" && welcomeWindow === browserWindow) welcomeWindow = undefined;
    if (isTerminal) {
      terminalWindowContexts.delete(browserContentsId);
      if (terminalContext && editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send("terminal:windowState", { ...terminalContext, open: false });
      }
    }
    // Settings are scoped to the workbench and its project. Leaving the window
    // behind would keep editing a project that is no longer open.
    if (isEditor) {
      void stopCollabHosting();
      stopCollabGuest();
      closeSettingsWindow();
      const structure = openWindows.get("structure");
      if (structure && !structure.isDestroyed()) structure.close();
      closeTerminalWindows();
    }
  });
  // Chromium keeps its own zoom level per window, separate from Kiwi's UI
  // scale, and it survives a restart. Someone who zoomed out with Ctrl+- was
  // stuck: the app's own scale could not undo a shrink that belonged to the
  // browser. The renderer handles those keys itself now, so this level stays
  // neutral and there is only one place that changes the size.
  browserWindow.webContents.on("did-finish-load", () => {
    browserWindow.webContents.setZoomLevel(0);
    void browserWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
    browserWindow.webContents.send("app:updateState", updateRuntimeState);
  });
  browserWindow.webContents.on("render-process-gone", (_event, details) => {
    void recordCrash("renderer", details);
  });
  // An applied renderer that cannot even be loaded must not leave a blank
  // workbench behind: drop it and come back on the packaged one.
  browserWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    void recordCrash("renderer-load", { errorCode, errorDescription });
    if (rendererRoot.hot) void revertRendererUpdate(errorDescription || `Fehlercode ${errorCode}`);
  });
  // Dropping a file next to a drop zone makes Chromium navigate the window to
  // that file, which replaces the entire workbench and looks like a crash.
  // Kiwi never navigates its top-level frame, so every attempt is refused.
  browserWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== browserWindow.webContents.getURL()) event.preventDefault();
  });
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.once("ready-to-show", () => {
    if (browserWindow.isDestroyed()) return;
    showWindowAfterSplash(browserWindow);
    if (!replaceOther) return;
    const other = isEditor ? welcomeWindow : editorWindow;
    if (other && other !== browserWindow && !other.isDestroyed()) other.close();
  });
  loadWindow(browserWindow, kind, context);
  return browserWindow;
}

function closeSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
}

function ownerWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) || editorWindow || settingsWindow || welcomeWindow;
}

async function createServices() {
  const userData = app.getPath("userData");
  const toolchainRoot = app.isPackaged
    ? path.join(process.resourcesPath, "toolchain")
    : path.join(__dirname, "..", "resources", "toolchain");
  const guard = new PathGuard();
  unregisterMirrorRoot = (root) => guard.unregister(root);
  const settings = new SettingsService(userData);
  await settings.load();
  /**
   * Puts the account settings where they take effect.
   *
   * The proxy is set on the session rather than per request, so everything
   * that leaves Kiwi goes the same way. An empty value hands it back to the
   * system settings, which is the default and what most networks want.
   *
   * Extra certificates are trusted by their fingerprint: the verifier is asked
   * about a chain Chromium has already rejected, and answering "trusted" for
   * anything at all would switch verification off entirely.
   */
  const applyNetworkSettings = async () => {
    const current = settings.get();
    try {
      await session.defaultSession.setProxy(current.proxyUrl
        ? { proxyRules: current.proxyUrl, proxyBypassRules: current.proxyBypass || "" }
        : { mode: "system" });
    } catch (error) {
      console.error("[Netzwerk] Proxy konnte nicht gesetzt werden:", error?.message || error);
    }
    const trusted = new Set();
    for (const file of current.extraCertificates || []) {
      try {
        const pem = await fsp.readFile(file, "utf8");
        for (const block of pem.split(/(?=-----BEGIN CERTIFICATE-----)/g)) {
          const body = block.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
          if (body) trusted.add(crypto.createHash("sha256").update(Buffer.from(body, "base64")).digest("hex"));
        }
      } catch (error) {
        console.error("[Netzwerk] Zertifikat konnte nicht gelesen werden:", file, error?.message || error);
      }
    }
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      // 0 accepts, -3 hands the decision back to Chromium. Only a certificate
      // whose fingerprint was named is accepted over Chromium's objection.
      if (request.errorCode === 0) return callback(0);
      const fingerprint = crypto.createHash("sha256")
        .update(request.certificate?.data ? Buffer.from(String(request.certificate.data)
          .replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64") : Buffer.alloc(0))
        .digest("hex");
      return callback(trusted.has(fingerprint) ? 0 : -3);
    });
  };
  await applyNetworkSettings();
  // Everything already configured is approved again at startup. The playlist
  // is part of that: a picture chosen yesterday must still be shown today
  // without asking for it through the dialog a second time.
  for (const configured of configuredBackgroundImages(settings.get())) {
    approvedBackgroundImages.add(configured);
  }
  const workspaceState = new WorkspaceStateService(userData, settings);
  /*
   * The open tabs and their drafts, on disk rather than in local storage.
   *
   * Chromium flushes local storage on its own schedule, so a killed process
   * loses whatever had not been written — which is exactly the case a crash
   * recovery exists for.
   */
  const sessionStore = new SessionStoreService(userData, guard);
  /*
   * Where each file was left, kept apart from the session.
   *
   * The session is what is open; this is where every file that has ever
   * been open was left. Closing a tab means the file is not open, not that
   * the place somebody was working in it is worth forgetting.
   */
  const editorStates = new SessionStoreService(userData, guard, "editor-states");
  await workspaceState.load();
  const workspace = new WorkspaceService(guard, shell, send, settings);
  const downloadedJdkRoot = path.join(userData, "jdks");
  const projects = new ProjectService(guard, settings, toolchainRoot, downloadedJdkRoot);
  const modules = new ModuleService(guard, projects);
  const runConfigurations = new RunConfigService(guard);
  const cacheRecovery = new CacheRecoveryService(userData, send);
  /*
   * The task list survives a restart, so the first Gradle project of a session
   * opens onto a filled tool window instead of paying seven seconds for the
   * same answer again.
   *
   * The fingerprint covers what the file timestamps cannot see: a Kiwi that
   * reads the task list differently, and a different bundled toolchain. An
   * entry that does not match is discarded unread.
   */
  const taskCache = new BuildTaskCache({
    directory: path.join(userData, "build-tasks"),
    fingerprint: [app.getVersion(), toolchainRoot].join("|"),
  });
  const builds = new BuildService(guard, workspace, projects, modules, send, cacheRecovery, taskCache);
  const githubAuth = new GitHubAuthService(userData, safeStorage, undefined, {
    clientId: () => settings.get().githubClientId,
  });
  await githubAuth.load();
  const git = new GitService(guard, githubAuth, {
    resolveBuildTool: (root, type) => builds.resolveBuildTool(root, type, true),
  });
  const tests = new TestService(guard, workspace, projects, builds);
  const terminal = new TerminalService(guard, sendTerminal);
  const tailer = new TailerService(guard, send);
  const managedLanguageServers = path.join(userData, "language-servers");
  if (!process.env.KIWI_E2E_USER_DATA && !app.commandLine.hasSwitch("remote-debugging-port")) {
    setTimeout(() => {
      for (const lang of ["typescript", "python", "php"]) {
        installManagedLanguageServer(lang, managedLanguageServers, { skipIfInstalled: true }).catch(() => undefined);
      }
    }, 3_000);
  }
  const polyglot = new PolyglotLanguageService(guard, () => settings.get(), send, { managedRoot: managedLanguageServers });
  const polyglotProjects = new PolyglotProjectService(guard, { send, settings, toolchainRoot });
  const breakpoints = new BreakpointService(guard);
  const templates = new TemplateService(guard);
  const projectIndex = new IndexService(guard, workspace);
  const language = new LanguageService(guard, projects, toolchainRoot, userData, send, 3, cacheRecovery,
    // The Java formatter indents the way the editor does. Left to itself it
    // uses Eclipse's tabs, so saving a space-indented project re-indented
    // every line of it.
    () => ({ tabSize: settings.get().tabSize, insertSpaces: settings.get().insertSpaces }));
  const debug = new DebugService(
    guard,
    workspace,
    projects,
    builds,
    send,
    (root, sourceFile) => language.runtimeClasspath(root, sourceFile),
  );
  const bytecode = new BytecodeService(guard, projects, language);
  const javaRefactor = new JavaRefactorService(guard, workspace, modules, language);
  const workflow = new WorkflowService(guard);
  const dependencies = new DependencyService(guard, projects);
  const systemFonts = new SystemFontService();
  // An applied renderer update is the version Kiwi is actually running, so it
  // is also the version the next check compares against — otherwise the same
  // update would be offered again forever.
  const updates = new UpdateService(settings, effectiveVersion(), userData, globalThis.fetch, {
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE || "",
    mainHash: MAIN_PROCESS_HASH,
    // The public halves of the release signing keys, shipped with the build.
    // A build without the file updates as it always did and says its updates
    // are unsigned.
    trustedKeyFile: app.isPackaged
      ? path.join(process.resourcesPath, "update-keys.pem")
      : path.join(__dirname, "..", "resources", "update-keys.pem"),
  });
  const httpClient = new HttpClientService();
  // Known advisories for the coordinates the dependency editor already reads.
  const vulnerabilities = new VulnerabilityService();
  // Built artefact onto the machine it runs on, over the system's own ssh.
  const deployments = new DeployService(guard);
  const database = new DatabaseService(guard);
  const docker = new DockerService(guard);
  /**
   * What Discord shows while Kiwi is open.
   *
   * Constructed whatever the setting says: it does nothing at all until
   * `configure` is handed an application id, and building it here means the
   * switch in the settings takes effect without a restart.
   */
  const discord = new DiscordPresenceService({
    log: (message, error) => console.log(message, error?.message || error || ""),
  });
  discord.setState({ version: effectiveVersion() });
  discord.configure({
    enabled: settings.get().discordRichPresence,
    applicationId: settings.get().discordApplicationId,
    publicKey: settings.get().discordPublicKey,
    showProject: settings.get().discordShowProject,
    showFile: settings.get().discordShowFile,
    showElapsed: settings.get().discordShowElapsed,
    state: settings.get().discordState,
    details: settings.get().discordDetails,
    largeImageKey: settings.get().discordLargeImageKey,
    largeImageText: settings.get().discordLargeImageText,
    smallImageKey: settings.get().discordSmallImageKey,
    smallImageText: settings.get().discordSmallImageText,
    partyId: settings.get().discordPartyId,
    partySize: settings.get().discordPartySize,
    partyMax: settings.get().discordPartyMax,
    joinSecret: settings.get().discordJoinSecret,
  });
  app.setAccessibilitySupportEnabled(Boolean(settings.get().screenReaderMode));
  return { guard, settings, workspaceState, sessionStore, editorStates, workspace, projects, modules, runConfigurations, builds, cacheRecovery, git, githubAuth, tests, terminal, tailer, debug, breakpoints, templates, projectIndex, bytecode, language, polyglot, polyglotProjects, managedLanguageServers, javaRefactor, workflow, dependencies, systemFonts, updates, httpClient, discord, vulnerabilities, deployments, downloadedJdkRoot };
}

/** The settings the Discord card is built from. */
const DISCORD_SETTINGS = [
  "discordRichPresence",
  "discordApplicationId",
  "discordPublicKey",
  "discordShowProject",
  "discordShowFile",
  "discordShowElapsed",
  "discordState",
  "discordDetails",
  "discordLargeImageKey",
  "discordLargeImageText",
  "discordSmallImageKey",
  "discordSmallImageText",
  "discordPartyId",
  "discordPartySize",
  "discordPartyMax",
  "discordJoinSecret",
];

function registerIpc() {
  const {
    downloadedJdkRoot,
    guard, settings, workspaceState, sessionStore, editorStates, workspace, projects, modules, runConfigurations, builds,
    git, githubAuth, tests, terminal, tailer, debug, breakpoints, templates, projectIndex, bytecode, language, javaRefactor, workflow, dependencies, systemFonts, updates,
    httpClient, discord, vulnerabilities, deployments, polyglot, polyglotProjects, managedLanguageServers,
  } = services;

  const readProjectTasks = async (root, options) => {
    const project = await projects.detect(root);
    if (!project.language || project.language === "java") return builds.listTasks(root, options);
    return { type: project.type, tasks: [
      { name: "build", group: "build", description: "Projekt bauen" },
      { name: "run", group: "application", description: "Anwendung ausführen" },
      { name: "test", group: "verification", description: "Tests ausführen" },
    ], modules: [], reason: "" };
  };
  const readProjectModules = async (root) => {
    const project = await projects.detect(root);
    return project.language && project.language !== "java" ? [] : modules.list(root);
  };

  ipcMain.handle("workspace:open", async (event) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Java-Projekt öffnen",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    const root = guard.register(result.filePaths[0]);
    await workspaceState.add([root], true);
    workspace.watch(root);
    return root;
  });
  ipcMain.handle("workspace:register", async (_event, root) => {
    if (!root || !fs.existsSync(root)) return null;
    const registered = guard.register(root);
    await workspaceState.add([registered], true);
    workspace.watch(registered);
    return registered;
  });
  ipcMain.handle("workspace:restore", async () => {
    const state = workspaceState.snapshot();
    const root = state.activeRoot && fs.existsSync(state.activeRoot)
      ? state.activeRoot
      : state.projects.find((project) => project.exists)?.root;
    if (!root) return null;
    for (const project of state.projects.filter((item) => item.exists)) {
      guard.register(project.root);
      workspace.watch(project.root);
    }
    await workspaceState.activate(root);
    return root;
  });
  ipcMain.handle("workspace:openMany", async (event) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Java-Projekte zum Workspace hinzufügen",
      properties: ["openDirectory", "createDirectory", "multiSelections"],
    });
    if (result.canceled) return workspaceState.snapshot();
    const roots = result.filePaths.filter((candidate) => fs.existsSync(candidate)).map((candidate) => guard.register(candidate));
    for (const root of roots) workspace.watch(root);
    return workspaceState.add(roots, true);
  });
  ipcMain.handle("workspace:add", async (_event, roots) => {
    const registered = (Array.isArray(roots) ? roots : [roots])
      .filter((candidate) => candidate && fs.existsSync(candidate))
      .map((candidate) => guard.register(candidate));
    for (const root of registered) workspace.watch(root);
    return workspaceState.add(registered, true);
  });
  ipcMain.handle("workspace:list", () => workspaceState.snapshot());
  // Awaited by the renderer: "saved" has to mean the bytes reached the disk.
  ipcMain.handle("session:save", (_event, payload) => sessionStore.save(payload?.root, payload?.session || {}));
  ipcMain.handle("session:load", (_event, root) => sessionStore.load(root));
  ipcMain.handle("session:clear", (_event, root) => sessionStore.clear(root));
  ipcMain.handle("editorStates:save", (_event, payload) =>
    editorStates.save(payload?.root, { states: Array.isArray(payload?.states) ? payload.states : [] }));
  ipcMain.handle("editorStates:load", async (_event, root) => {
    const stored = await editorStates.load(root);
    return Array.isArray(stored?.states) ? stored.states : [];
  });
  ipcMain.handle("workspace:recoverRecent", (_event, roots) => workspaceState.recoverRecent(roots));
  ipcMain.handle("workspace:restoreState", async () => {
    const state = workspaceState.snapshot();
    for (const project of state.projects.filter((item) => item.exists)) {
      guard.register(project.root);
      workspace.watch(project.root);
    }
    return state;
  });
  ipcMain.handle("workspace:activate", async (_event, root) => {
    const state = await workspaceState.activate(root);
    const activeRoot = guard.register(state.activeRoot || root);
    workspace.watch(activeRoot);
    for (const browserWindow of [settingsWindow, openWindows.get("structure")]) {
      if (!browserWindow || browserWindow.isDestroyed()) continue;
      browserWindow.webContents.send("settings:context", { projectRoot: activeRoot });
    }
    return state;
  });
  ipcMain.handle("workspace:remove", async (_event, root) => {
    closeTerminalWindows(root);
    workspace.unwatch(root);
    await language.stop(root);
    await polyglot.stop(root);
    polyglotProjects.stop(root);
    terminal.stop(root);
    guard.unregister(root);
    return workspaceState.remove(root);
  });
  ipcMain.handle("workspace:closeAll", async () => {
    reopeningHub = true;
    const state = workspaceState.snapshot();
    // Closing a workspace tears down a watcher, a shell and a language server
    // per project, and the process has been seen to die with an access
    // violation somewhere in here. A crash leaves no stack, so the last line
    // printed is the only evidence of which step it was in.
    const step = (name) => console.log(`[Teardown] ${name}`);
    step("start");
    closeTerminalWindows();
    step("terminal windows closed");
    for (const project of state.projects) {
      workspace.unwatch(project.root);
      step(`unwatched ${path.basename(project.root)}`);
      terminal.stop(project.root);
      step(`terminals stopped ${path.basename(project.root)}`);
      guard.unregister(project.root);
    }
    step("projects released");
    // The terminals are asked to leave above; this waits until they have.
    //
    // It is not what stopped the access violation, and the comment that used to
    // stand here saying it was is wrong: the crash was node-pty's kill closing
    // the pseudoconsole under ConPTY, and it happens with no language server
    // and no file watcher anywhere near it. What this still does is keep the
    // rest of the shutdown from piling onto ptys that are mid-teardown. It is
    // bounded, and it does time out — a shell takes about 2.7 seconds to report
    // that it has gone.
    await terminal.drain();
    step("terminals gone");
    await language.stop();
    await polyglot.stop();
    polyglotProjects.stop();
    step("language stopped");
    closeSettingsWindow();
    step("done");
    return workspaceState.closeAll();
  });
  ipcMain.handle("workspace:setPinned", (_event, payload) => workspaceState.setPinned(payload.root, payload.pinned));
  ipcMain.handle("workspace:rename", (_event, payload) => workspaceState.rename(payload.root, payload.name));
  ipcMain.handle("workspace:saveProfile", (_event, name) => workspaceState.saveProfile(name));
  ipcMain.handle("workspace:deleteProfile", (_event, id) => workspaceState.deleteProfile(id));
  ipcMain.handle("workspace:openProfile", async (_event, id) => {
    const previous = workspaceState.snapshot();
    closeTerminalWindows();
    for (const project of previous.projects) {
      workspace.unwatch(project.root);
      guard.unregister(project.root);
      terminal.stop(project.root);
    }
    await language.stop();
    const state = await workspaceState.openProfile(id);
    await polyglot.stop();
    await polyglotProjects.stop();
    for (const project of state.projects.filter((item) => item.exists)) {
      guard.register(project.root);
      workspace.watch(project.root);
    }
    return state;
  });
  ipcMain.handle("workspace:tree", (_event, root) => workspace.readTree(root));
  ipcMain.handle("workspace:children", (_event, payload) => workspace.readChildren(payload.root, payload.directory));
  ipcMain.handle("workspace:search", (_event, payload) => workspace.search(payload.root, payload.query, payload.options));
  ipcMain.handle("workspace:taskComments", (_event, payload) => workspace.taskComments(payload.root));
  ipcMain.handle("workspace:validateProject", (_event, payload) => workspace.validateProject(payload.root));
  ipcMain.handle("workspace:validateBuffer", (_event, payload) => workspace.validateBuffer(payload.root, payload.file, payload.content));
  ipcMain.handle("workspace:replacePreview", (_event, payload) => workspace.replacePreview(payload.root, payload.query, payload.replacement, payload.options));
  ipcMain.handle("workspace:replaceAll", (_event, payload) => workspace.replaceAll(payload.root, payload.query, payload.replacement, payload.paths, payload.options));
  ipcMain.handle("workspace:watch", (_event, root) => workspace.watch(root));
  ipcMain.handle("workspace:history", (_event, payload) => workspace.history(payload.root, payload.file));
  ipcMain.handle("workspace:undo", (_event, payload) => workspace.undo(payload.root, payload.id));
  ipcMain.handle("workspace:beginOperation", (_event, payload) => workspace.beginOperation(payload.root, payload.label, payload.paths));
  ipcMain.handle("workspace:endOperation", (_event, root) => workspace.endOperation(root));

  /**
   * Saving a file of the working copy: to this disk, and to the host's.
   *
   * The local write is what the language server and the build read, so it
   * happens first and is what the editor is told about. The push is what makes
   * the session mean anything; if it fails, the save is reported as failed even
   * though the bytes are on this disk, because a guest who believes their change
   * reached the project and is wrong is worse off than one who sees an error.
   */
  const writeMirrorAndPush = async (file, content) => {
    const result = await workspace.writeFile(file, content);
    const guest = collabGuest;
    const root = guest?.mirrorRoot || collabMirrorRoot;
    const relative = root ? collabMirror.relativeFromMirror(root, file) : "";
    if (!guest || !relative) return result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const opened = await guest.request("open", { path: relative });
      if (opened.text === content) return { ...result, pushed: true };
      const applied = await guest.request("edit", {
        path: relative,
        edit: { start: 0, end: opened.text.length, text: content },
        baseVersion: opened.version,
      });
      if (applied.applied) {
        await guest.request("save", { path: relative });
        return { ...result, pushed: true };
      }
    }
    throw new Error("Gespeichert, aber der Gastgeber hat die Datei inzwischen geändert. Bitte erneut speichern.");
  };

  ipcMain.handle("file:read", (_event, file) => workspace.readFile(file));
  ipcMain.handle("file:write", (_event, payload) => (collabMirror.isMirrorPath(app.getPath("temp"), payload.path)
    ? writeMirrorAndPush(payload.path, payload.content)
    : workspace.writeFile(payload.path, payload.content)));
  ipcMain.handle("file:create", (_event, payload) => workspace.create(payload.parent, payload.name, payload.directory));
  ipcMain.handle("file:rename", (_event, payload) => workspace.rename(payload.path, payload.name));
  ipcMain.handle("file:delete", (_event, file) => workspace.delete(file));
  ipcMain.handle("file:transfer", (_event, payload) => workspace.transfer(payload.source, payload.targetDirectory, payload.move));
  ipcMain.handle("file:authorizeDrop", (event, droppedPath) => {
    const source = path.resolve(String(droppedPath || ""));
    if (!source || !fs.existsSync(source)) return null;
    return approvedDroppedFiles.issue(source, event.sender.id);
  });
  ipcMain.handle("file:importDropped", async (event, payload) => {
    const targetDirectory = guard.assertAllowed(payload.targetDirectory);
    const targetRoot = guard.workspaceFor(targetDirectory);
    const approved = approvedDroppedFiles
      .consume(payload.tokens, event.sender.id, 100)
      .filter((source) => fs.existsSync(source));
    if (!approved.length) throw new Error("Die abgelegten Dateien konnten nicht gelesen werden.");
    const results = [];
    const external = [];
    for (const source of approved) {
      let sourceRoot = "";
      try {
        sourceRoot = guard.workspaceFor(source);
      } catch {}
      if (sourceRoot && sourceRoot.toLocaleLowerCase() === targetRoot.toLocaleLowerCase()
        && path.resolve(source).toLocaleLowerCase() !== path.resolve(targetRoot).toLocaleLowerCase()) {
        if (path.dirname(source).toLocaleLowerCase() === path.resolve(targetDirectory).toLocaleLowerCase()) continue;
        const target = await workspace.transfer(source, targetDirectory, true);
        results.push({ source, target, move: true });
      } else if (!external.includes(source)) {
        // importExternal deduplicates internally; keep this list identical so
        // the returned targets stay aligned with their sources below.
        external.push(source);
      }
    }
    const imported = external.length ? await workspace.importExternal(external, targetDirectory) : [];
    imported.forEach((target, index) => results.push({ source: external[index], target, move: false }));
    return results;
  });
  ipcMain.on("file:startDrag", (event, files) => {
    try {
      const targets = [...new Set((Array.isArray(files) ? files : [files]).map((file) => guard.assertAllowed(file)))]
        .filter((file) => fs.existsSync(file))
        .slice(0, 100);
      if (!targets.length) return;
      const iconPath = path.join(__dirname, "..", "assets", "icons", "kiwi-64.png");
      const icon = nativeImage.createFromPath(iconPath);
      event.sender.startDrag(targets.length === 1
        ? { file: targets[0], icon }
        : { files: targets, icon });
    } catch {
      // A failed native drag must not interfere with the internal HTML drag.
    }
  });
  ipcMain.handle("file:duplicate", (_event, file) => workspace.duplicate(file));
  ipcMain.handle("file:reveal", (_event, file) => workspace.reveal(file));

  ipcMain.handle("project:chooseLocation", async (event) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Speicherort für das neue Projekt",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : guard.register(result.filePaths[0]);
  });
  ipcMain.handle("project:create", async (_event, spec) => {
    const result = await projects.create(spec);
    const locationWasWorkspace = workspaceState.snapshot().projects.some((project) =>
      path.resolve(project.root).toLocaleLowerCase() === path.resolve(spec.location).toLocaleLowerCase(),
    );
    if (!locationWasWorkspace && guard.isRegistered(spec.location)) guard.unregister(spec.location);
    guard.register(result.root);
    workspace.watch(result.root);
    await workspaceState.add([result.root], true);
    return result;
  });
  ipcMain.handle("project:detect", (_event, root) => projects.detect(root));
  /*
   * Everything a project needs before a build can be started, prepared.
   *
   * No build is run. This reads the project, its modules and its task list
   * — the last of which costs a Gradle configuration phase and is what
   * makes opening a project feel slow — and keeps the answers, so opening
   * it afterwards finds them already there.
   *
   * Never throws. A project whose build file is broken, whose JDK is gone
   * or whose dependencies will not resolve reports what happened and stays
   * openable; refusing to list it would help nobody.
   */
  ipcMain.handle("project:prepare", async (_event, root) => {
    const started = Date.now();
    try {
      if (!root || !fs.existsSync(root)) return { root, state: "error", reason: "Der Projektordner ist nicht mehr da." };
      guard.register(root);
      const project = await projects.detect(root);
      const [moduleList, tasks] = await Promise.all([
        readProjectModules(root).catch(() => []),
        readProjectTasks(root),
      ]);
      return {
        root,
        state: tasks.reason ? "outdated" : "ready",
        type: project.type,
        modules: moduleList.length,
        tasks: tasks.tasks.length,
        jdk: project.jdkPath || "",
        wrapper: Boolean(project.preferWrapper),
        reason: tasks.reason || "",
        tookMs: Date.now() - started,
      };
    } catch (error) {
      return { root, state: "error", reason: error?.message || String(error), tookMs: Date.now() - started };
    }
  });
  ipcMain.handle("project:frameworkInfo", (_event, root) => projects.frameworkInfo(root));
  ipcMain.handle("project:getSettings", async (_event, root) =>
    rememberProjectBackground(await projects.readProjectSettings(guard.assertWorkspace(root))));
  ipcMain.handle("project:updateSettings", async (event, payload) => {
    const result = rememberProjectBackground(await projects.updateProjectSettings(payload.root, payload.patch));
    broadcast("project:settingsChanged", { root: payload.root, patch: payload.patch, settings: result }, event.sender);
    return result;
  });
  ipcMain.handle("project:repair", async (_event, root) => {
    root = guard.assertWorkspace(root);
    const project = await projects.detect(root);
    if (project.language && project.language !== "java") throw new Error("Diese Cache-Reparatur ist für Java-Projekte vorgesehen. Starte den Sprachserver in den Spracheinstellungen neu.");
    await language.stop(root);
    await polyglot.stop(root);
    await polyglotProjects.stop(root);
    builds.stop(root);
    terminal.stop(root);
    debug.stop();
    workspace.invalidate(root);
    const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 20);
    const userData = app.getPath("userData");
    const backupRoot = path.join(userData, "repair-backups", `${Date.now()}-${hash}`);
    const moved = [];
    const copiedAcrossDrives = [];
    for (const source of [
      path.join(userData, "jdtls-workspaces", hash),
      path.join(root, ".kiwi", "cache"),
      path.join(root, ".kiwi", "index"),
      path.join(root, ".kiwi", "build-model.json"),
      path.join(root, ".kiwi", "classpath-cache.json"),
      path.join(root, ".kiwi", "sync-state.json"),
    ]) {
      if (!fs.existsSync(source)) continue;
      const target = path.join(backupRoot, path.basename(source));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const method = await moveRepairData(source, target);
      moved.push(source);
      if (method === "copy") copiedAcrossDrives.push(source);
    }
    // The project's own caches are only half the story: a truncated jar in the
    // shared Maven or Gradle repository is used by every project on the machine
    // and outlives any number of local repairs. Only files that can be shown to
    // be damaged are moved, and they are moved rather than deleted.
    const shared = await artifactCaches.repairSharedCaches({
      quarantineRoot: path.join(backupRoot, "shared-cache"),
    }).catch((error) => ({ removed: 0, caches: [], error: error.message }));
    const build = await builds.listTasks(root)
      .then((result) => ({ ok: true, tasks: result.tasks.length, modules: result.modules.length }))
      .catch((error) => ({ ok: false, error: error.message }));
    const index = await language.start(root);
    return {
      repaired: true,
      backupRoot: moved.length || shared.removed ? backupRoot : "",
      moved,
      copiedAcrossDrives,
      shared,
      build,
      index: {
        available: index.available,
        status: index.status,
        reason: index.reason || "",
      },
    };
  });
  ipcMain.handle("project:createSourceElement", (_event, payload) =>
    projects.createSourceElement(payload.root, payload.parent, payload.kind, payload.name, payload.options),
  );
  ipcMain.handle("project:tasks", (_event, payload) => (typeof payload === "string"
    ? readProjectTasks(payload)
    : readProjectTasks(payload.root, { refresh: Boolean(payload.refresh) })));
  ipcMain.handle("project:dependencies", (_event, root) => builds.dependencies(root));
  ipcMain.handle("project:dependencyTree", (_event, payload) => (typeof payload === "string"
    ? builds.dependencyTree(payload)
    : builds.dependencyTree(payload.root, payload.projectPath)));
  ipcMain.handle("project:auditDependencies", (_event, root) => builds.auditDependencies(root));
  ipcMain.handle("project:selectJdk", async (event) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "JDK-Ordner auswählen",
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    const jdk = await projects.detectJdk("", result.filePaths[0]);
    if (!jdk.available) throw new Error("In diesem Ordner wurde kein gültiges JDK gefunden.");
    return jdk;
  });
  ipcMain.handle("project:listJdks", () => projects.listJdks());
  ipcMain.handle("jdk:available", () => jdkDownloads.listAvailableJdks());
  ipcMain.handle("jdk:describe", (_event, feature) => jdkDownloads.describeJdk(feature));
  /** The folder downloads land in: the chosen one, or Kiwi's own. */
  const jdkTargetRoot = () => settings.get().jdkInstallRoot || downloadedJdkRoot;
  ipcMain.handle("jdk:installRoot", () => ({
    root: jdkTargetRoot(),
    standard: downloadedJdkRoot,
    eigener: Boolean(settings.get().jdkInstallRoot),
  }));
  ipcMain.handle("jdk:chooseInstallRoot", async (event) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Ordner für heruntergeladene Java-Versionen",
      defaultPath: jdkTargetRoot(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    const chosen = guard.register(result.filePaths[0]);
    await settings.update({ jdkInstallRoot: chosen });
    // A JDK already sitting in the newly chosen folder should be offered at
    // once, and the probe cache still holds the answer from before it.
    projects.jdkProbeCache.clear();
    return { root: chosen, standard: downloadedJdkRoot, eigener: true };
  });
  ipcMain.handle("jdk:resetInstallRoot", async () => {
    await settings.update({ jdkInstallRoot: "" });
    projects.jdkProbeCache.clear();
    return { root: downloadedJdkRoot, standard: downloadedJdkRoot, eigener: false };
  });
  ipcMain.handle("jdk:install", async (event, feature) => {
    // Settings is a separate BrowserWindow. The old generic send() helper only
    // targets the editor, leaving this button at 0 % for the whole download.
    // Reply exclusively to the WebContents that initiated the installation;
    // this also prevents two open views from overwriting each other's state.
    const sender = event.sender;
    const progress = jdkDownloads.createProgressReporter(feature, (payload) => {
      if (!sender.isDestroyed()) sender.send("jdk:progress", payload);
    });
    const result = await jdkDownloads.installJdk(feature, jdkTargetRoot(), {
      onProgress: (value) => progress.downloading(value),
      onPhase: (phase) => {
        if (phase === "preparing") progress.preparing();
        else if (phase === "verifying") progress.verifying();
        else if (phase === "extracting") progress.extracting();
        else if (phase === "installing") progress.installing();
      },
    });
    // A freshly unpacked JDK is invisible until the probe cache lets go of its
    // answer from a minute ago.
    projects.jdkProbeCache.clear();
    progress.complete();
    return result;
  });

  // CodeToGetter: one machine has the project, the other joins it.
  //
  // Only one session of each kind at a time. Hosting two projects at once would
  // need a port and an invite each, and a workbench that is a guest in one
  // session and a host in another has two file trees both claiming to be the
  // project.
  /** Reads "host:port" into something to dial, or nothing at all. */
  const parseRelayAddress = (value) => {
    const text = String(value || "").trim().replace(/^\w+:\/\//, "");
    if (!text) return null;
    const match = text.match(/^([^:/\s]+)(?::(\d{1,5}))?$/);
    if (!match) throw new Error("Die Relay-Adresse konnte nicht gelesen werden.");
    const port = Number(match[2] || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Der Relay-Port ist ungültig.");
    return { host: match[1], port };
  };

  ipcMain.handle("collab:host", async (_event, payload) => {
    // The renderer used to pass the root alone. Both shapes are accepted so a
    // window that has not reloaded yet does not lose the ability to share.
    const root = typeof payload === "string" ? payload : payload?.root;
    const wantsPublic = typeof payload === "object" && Boolean(payload?.publicAccess);
    const projectRoot = guard.assertWorkspace(root);
    const generation = collabHostGeneration + 1;
    collabHostGeneration = generation;
    const previous = collabHost;
    collabHost = null;
    await previous?.stop();
    if (generation !== collabHostGeneration) throw new Error("Der Sitzungsstart wurde durch einen neueren ersetzt.");
    const host = new CollabHost({
      root: projectRoot,
      send: broadcast,
      projectName: path.basename(projectRoot),
      hostOnly: typeof payload === "object" && Boolean(payload?.hostOnly),
    });
    collabHost = host;
    try {
      // A relay address means nothing here has to be reachable: the host
      // dials out, the guest dials out, and the two are put together there.
      const relay = parseRelayAddress(payload?.relay);
      const result = relay
        ? await host.startViaRelay(relay.host, relay.port)
        : await host.start(0);
      if (generation !== collabHostGeneration || collabHost !== host) {
        await host.stop();
        throw new Error("Der Sitzungsstart wurde durch einen neueren ersetzt.");
      }
      // Through a relay there is no port to open: that is the point of it.
      if (relay || !wantsPublic) return { ...result, publicAccess: { requested: false, relay: Boolean(relay) } };
      // Only asked for when the host asked for it: opening a port on somebody's
      // router is not a thing to do because it might be convenient.
      const opened = await portMapping.openPublicPort(result.port).catch((error) => ({
        opened: false,
        reason: error.message,
        port: result.port,
      }));
      if (generation !== collabHostGeneration || collabHost !== host) {
        await host.stop();
        throw new Error("Der Sitzungsstart wurde durch einen neueren ersetzt.");
      }
      if (opened.opened) {
        // A router lease runs out, and a session that outlives it stops being
        // reachable mid-sentence with the invite still looking valid.
        collabMappingRenewal?.stop();
        collabMappingRenewal = portMapping.createMappingRenewal(result.port, {
          onResult: (renewed) => broadcast("collab:reachability", { ...renewed, renewed: true, session: "host" }),
        });
      }
      if (opened.opened && opened.address) {
        host.setPublicAddress(opened.address, opened.externalPort || result.port);
      }
      return { ...host.state(), token: result.token, publicAccess: { requested: true, ...opened } };
    } catch (error) {
      if (generation === collabHostGeneration && collabHost === host) collabHost = null;
      throw error;
    }
  });
  ipcMain.handle("collab:stopHosting", async () => {
    await stopCollabHosting();
    return { hosting: false };
  });
  ipcMain.handle("collab:hostState", () => (collabHost
    ? collabHost.state()
    : { hosting: false, peers: [] }));
  const collabHostFor = (root) => {
    if (!collabHost || !root) return null;
    const requestedRoot = guard.assertWorkspace(root);
    const normalize = (value) => (process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value));
    return normalize(requestedRoot) === normalize(collabHost.root) ? collabHost : null;
  };
  // Who may only read, and who may change the project. The host decides, and
  // the decision is enforced on the host — this only carries it there.
  ipcMain.handle("collab:setPeerRole", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return host.setPeerRole(payload.peerId, payload.role);
  });
  ipcMain.handle("collab:setPeerPermissions", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return host.setPeerPermissions(payload.peerId, payload.permissions);
  });
  ipcMain.handle("collab:setHostOnly", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return { hostOnly: host.setHostOnly(payload.hostOnly) };
  });
  ipcMain.handle("collab:setDefaultRole", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return { defaultRole: host.setDefaultRole(payload.role) };
  });
  // Managing who is in the session. Every one of these acts on the host, which
  // is the only side that can actually end somebody's access.
  ipcMain.handle("collab:disconnectPeer", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return host.disconnectPeer(payload.peerId);
  });
  ipcMain.handle("collab:blockPeer", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return host.blockPeer(payload.peerId);
  });
  ipcMain.handle("collab:unblock", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Für dieses Projekt läuft keine CodeToGetter-Sitzung.");
    return { blocked: host.unblock(payload.address) };
  });
  // An edit the host made in its own editor, so the guests see it.
  ipcMain.handle("collab:localEdit", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    return host
      ? host.localEdit(payload.path, payload.edit, payload.baseVersion)
      : { ok: false, reason: "keine Sitzung für dieses Projekt" };
  });
  ipcMain.handle("collab:localSnapshot", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Keine CodeToGetter-Sitzung für dieses Projekt.");
    return host.localSnapshot(payload.path);
  });
  ipcMain.handle("collab:localSave", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    if (!host) throw new Error("Keine CodeToGetter-Sitzung für dieses Projekt.");
    return host.localSave(payload.path);
  });
  ipcMain.handle("collab:localReplace", (_event, payload) => {
    const host = collabHostFor(payload?.root);
    return host
      ? host.localReplace(payload.path, payload.text)
      : { version: 0 };
  });

  /**
   * Builds the guest's working copy and hands back a real project root.
   *
   * The files are written to a folder of this session's own under the system's
   * temporary directory. That is what lets the language server, the build and
   * the debugger work at all — they open files, and until now the guest had
   * none. It is removed again when the guest leaves.
   */
  collabRefresher = collabMirror.createMirrorRefresher({
    guestOf: () => collabGuest,
    rootOf: () => collabGuest?.mirrorRoot || collabMirrorRoot,
    write: (root, relative, text) => collabMirror.writeMirrorFile(root, relative, text),
  });

  const buildCollabMirror = async (guest, welcome) => {
    // The host forbids a copy on this machine. Nothing is written down, and
    // the guest works through the connection alone — which costs the language
    // server, the build and the debugger, and is said in the interface rather
    // than discovered later.
    if (welcome?.hostOnly) return { root: "", written: 0, failed: [], hostOnly: true };
    const root = collabMirror.mirrorRootFor(app.getPath("temp"), welcome.project, String(Date.now()));
    // Anything an earlier run left behind goes now: a copy of somebody else's
    // project should not outlive the session by a reboot.
    await collabMirror.sweepStaleMirrors(app.getPath("temp"), root);
    const listing = await guest.request("tree");
    const plan = collabMirror.planMirror(listing.entries || []);
    await collabMirror.createMirrorDirectories(root, listing.entries || []);
    let written = 0;
    const failed = [];
    for (let index = 0; index < plan.files.length; index += 200) {
      const slice = plan.files.slice(index, index + 200);
      const bundle = await guest.request("bundle", { paths: slice });
      for (const file of bundle.files || []) {
        if (typeof file.text !== "string") {
          failed.push({ path: file.path, reason: file.error || "keine Antwort" });
          continue;
        }
        await collabMirror.writeMirrorFile(root, file.path, file.text).then(() => { written += 1; })
          .catch((error) => failed.push({ path: file.path, reason: error.message }));
      }
      broadcast("collab:mirror", { done: written, total: plan.files.length, session: "guest" });
    }
    guard.register(root);
    workspace.watch(root);
    guest.mirrorRoot = root;
    collabMirrorRoot = root;
    return {
      root,
      written,
      failed,
      skipped: plan.skipped,
    };
  };

  /** Removes the guest's working copy, whatever ended the session. */
  const clearCollabMirror = async (root) => {
    if (!root) return;
    workspace.unwatch?.(root);
    guard.unregister(root);
    await collabMirror.removeMirror(app.getPath("temp"), root);
  };

  ipcMain.handle("collab:join", async (_event, payload) => {
    stopCollabGuest();
    const generation = collabJoinGeneration;
    // Everything the host tells this guest passes through here on its way to
    // the renderer, which is the one place that sees every change to a file
    // and can keep the working copy honest.
    const guest = new CollabGuest({
      name: payload?.name || "Gast",
      send: (channel, message) => {
        if (channel === "collab:edit" || channel === "collab:reset" || channel === "collab:saved") {
          collabRefresher.changed(message?.path);
        }
        broadcast(channel, message);
      },
    });
    collabGuest = guest;
    try {
      const result = await guest.connect(payload?.code);
      if (generation !== collabJoinGeneration || collabGuest !== guest) {
        guest.disconnect();
        throw new Error("Die Verbindungsanfrage wurde durch eine neuere Sitzung ersetzt.");
      }
      const mirror = await buildCollabMirror(guest, result);
      if (generation !== collabJoinGeneration || collabGuest !== guest) {
        await clearCollabMirror(mirror.root);
        guest.disconnect();
        throw new Error("Die Verbindungsanfrage wurde durch eine neuere Sitzung ersetzt.");
      }
      return { ...result, workspaceRoot: mirror.root, mirror };
    } catch (error) {
      if (generation === collabJoinGeneration && collabGuest === guest) collabGuest = null;
      guest.disconnect();
      throw error;
    }
  });
  ipcMain.handle("collab:leave", () => {
    stopCollabGuest();
    return { joined: false };
  });
  // Everything a guest does goes through one door, because every one of these
  // is the same thing: a question only the host can answer.
  ipcMain.handle("collab:request", (_event, payload) => {
    if (!collabGuest) throw new Error("Es besteht keine Verbindung zu einem Gastgeber.");
    return collabGuest.request(payload?.type, payload?.payload || {});
  });
  ipcMain.handle("modules:list", (_event, root) => readProjectModules(root));
  ipcMain.handle("modules:previewCreate", (_event, payload) => modules.previewCreate(payload.root, payload.spec));
  ipcMain.handle("modules:previewRemove", (_event, payload) => modules.previewRemove(payload.root, payload.moduleId));
  ipcMain.handle("modules:applyPlan", async (_event, payload) => {
    const result = await modules.applyPlan(payload.root, payload.planId);
    await language.refresh(payload.root).catch(() => false);
    return result;
  });
  ipcMain.handle("modules:updateSettings", async (_event, payload) => {
    const result = await modules.updateSettings(payload.root, payload.moduleId, payload.patch);
    await language.refresh(payload.root).catch(() => false);
    return result;
  });

  ipcMain.handle("settings:get", () => settings.get());
  ipcMain.handle("settings:listSystemFonts", () => systemFonts.list());
  /**
   * What the workbench is doing, for the Discord card.
   *
   * Sent by the renderer because only it knows which document has focus. It
   * is deliberately one-way and lossy: the service coalesces, the setting
   * decides what of it is used, and nothing here waits on Discord.
   */
  ipcMain.handle("presence:update", (_event, payload) => {
    discord.setState({
      projectName: String(payload?.projectName || ""),
      fileName: String(payload?.fileName || ""),
      version: effectiveVersion(),
    });
    return true;
  });
  // What the settings page shows: the card itself, not a drawing of it.
  ipcMain.handle("presence:preview", () => discord.previewActivity());

  /**
   * Which dependencies are known to be vulnerable.
   *
   * The coordinates come from the same reader the dependency editor uses, so
   * what is scanned is exactly what is declared. `force` throws the cached
   * answers away, which is what the button beside the list does.
   */
  ipcMain.handle("dependencies:scan", async (_event, payload) => {
    const root = guard.assertWorkspace(String(payload?.root || ""));
    if (payload?.force) vulnerabilities.clear();
    const model = await dependencies.list(root);
    return vulnerabilities.scan(model.dependencies);
  });

  /**
   * The deployment target, and the act of using it.
   *
   * The output is streamed rather than returned: scp reports its progress as
   * it goes, and a dialog that showed nothing for a minute and then everything
   * at once would be worse than a terminal.
   */
  ipcMain.handle("deploy:load", (_event, root) => deployments.load(guard.assertWorkspace(String(root || ""))));
  ipcMain.handle("deploy:save", (_event, payload) =>
    deployments.save(guard.assertWorkspace(String(payload?.root || "")), payload?.target || {}));
  ipcMain.handle("deploy:check", (_event, root) => deployments.check(guard.assertWorkspace(String(root || ""))));
  ipcMain.handle("deploy:run", async (event, root) => {
    const project = guard.assertWorkspace(String(root || ""));
    const sender = event.sender;
    return deployments.deploy(project, (line, kind) => {
      if (sender.isDestroyed()) return;
      sender.send("deploy:line", { root: project, line, kind });
    });
  });

  ipcMain.handle("settings:update", async (event, patch) => {
    const next = await settings.update(patch);
    if ("languageServers" in patch) await polyglot.stop();
    app.setAccessibilitySupportEnabled(Boolean(next.screenReaderMode));
    workspace.invalidate();
    // Every window, including the one that asked: settings are global state,
    // and the editor applies them only through this event. Excluding the
    // sender meant a change made in its own settings document never arrived.
    broadcast("settings:changed", { settings: next, patch });
    // The Java formatter reads its indentation from a profile written on disk.
    // Without this it kept the one from when the project was opened, so "format
    // on save" put the old indentation back over the newly chosen one.
    if ("tabSize" in patch || "insertSpaces" in patch) void language.applyEditorFormat();
    if ("proxyUrl" in patch || "proxyBypass" in patch || "extraCertificates" in patch) void applyNetworkSettings();
    // Switching the card on, off, or changing what it says takes effect now
    // rather than at the next start. `configure` does nothing when nothing it
    // cares about actually changed.
    if (DISCORD_SETTINGS.some((key) => key in patch)) {
      discord.configure({
        enabled: next.discordRichPresence,
        applicationId: next.discordApplicationId,
        publicKey: next.discordPublicKey,
        showProject: next.discordShowProject,
        showFile: next.discordShowFile,
        showElapsed: next.discordShowElapsed,
        state: next.discordState,
        details: next.discordDetails,
        largeImageKey: next.discordLargeImageKey,
        largeImageText: next.discordLargeImageText,
        smallImageKey: next.smallImageKey,
        smallImageText: next.smallImageText,
        partyId: next.discordPartyId,
        partySize: next.discordPartySize,
        partyMax: next.discordPartyMax,
        joinSecret: next.discordJoinSecret,
      });
    }
    return next;
  });
  // Settings, keymaps and layouts as one file. Reading and writing it are the
  // main process's job because only it may touch a path the user picked.
  ipcMain.handle("settings:exportBundle", async (event, text) => {
    const chosen = await dialog.showSaveDialog(ownerWindow(event), {
      title: "Einstellungen exportieren",
      defaultPath: "kiwi-einstellungen.json",
      filters: [{ name: "Kiwi-Einstellungen", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePath) return "";
    await fsp.writeFile(chosen.filePath, String(text ?? ""), "utf8");
    return chosen.filePath;
  });
  // A theme is its own file, not the whole settings bundle: sending somebody
  // your colours should not send them your JDK path and your proxy.
  ipcMain.handle("settings:exportTheme", async (event, payload) => {
    const chosen = await dialog.showSaveDialog(ownerWindow(event), {
      title: "Theme exportieren",
      defaultPath: String(payload?.fileName || "kiwi-theme.kiwi-theme.json"),
      filters: [{ name: "Kiwi-Theme", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePath) return "";
    await fsp.writeFile(chosen.filePath, String(payload?.text ?? ""), "utf8");
    return chosen.filePath;
  });
  ipcMain.handle("settings:importTheme", async (event) => {
    const chosen = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Theme importieren",
      properties: ["openFile"],
      filters: [{ name: "Kiwi-Theme", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return "";
    return fsp.readFile(chosen.filePaths[0], "utf8");
  });
  ipcMain.handle("settings:importBundle", async (event) => {
    const chosen = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Einstellungen importieren",
      properties: ["openFile"],
      filters: [{ name: "Kiwi-Einstellungen", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return "";
    return fsp.readFile(chosen.filePaths[0], "utf8");
  });
  ipcMain.handle("settings:chooseCertificate", async (event) => {
    const chosen = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Stammzertifikat auswählen",
      properties: ["openFile"],
      filters: [{ name: "Zertifikate", extensions: ["pem", "crt", "cer"] }],
    });
    return chosen.canceled ? "" : chosen.filePaths[0] || "";
  });
  ipcMain.handle("settings:reset", async (event) => {
    const next = await settings.reset();
    app.setAccessibilitySupportEnabled(Boolean(next.screenReaderMode));
    workspace.invalidate();
    broadcast("settings:changed", { settings: next, patch: next });
    void language.applyEditorFormat();
    return next;
  });
  ipcMain.handle("settings:selectBackgroundImage", async (event) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "IDE-Hintergrund auswählen",
      properties: ["openFile"],
      filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (result.canceled) return null;
    const selected = path.resolve(result.filePaths[0]);
    approvedBackgroundImages.add(selected);
    return selected;
  });
  ipcMain.handle("settings:backgroundImageData", async (_event, requestedPath) => {
    const requested = path.resolve(String(requestedPath || ""));
    // Two things have to hold: the path is one the settings actually name, and
    // it was chosen through the dialog rather than written in from anywhere
    // else. Checking only the first would turn a settings write into a way to
    // read any file on the disk.
    const configured = configuredBackgroundImages(settings.get());
    const named = configured.includes(requested) || projectBackgroundImages().includes(requested);
    if (!requested || !named || !approvedBackgroundImages.has(requested)) {
      throw new Error("Der Hintergrundpfad ist nicht freigegeben.");
    }
    const extension = path.extname(requested).toLowerCase();
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
    }[extension];
    if (!mime) throw new Error("Dieses Bildformat wird nicht unterstützt.");
    const stat = await fsp.stat(requested);
    if (!stat.isFile() || stat.size > 30 * 1024 * 1024) throw new Error("Das Hintergrundbild ist ungültig oder größer als 30 MB.");
    return `data:${mime};base64,${(await fsp.readFile(requested)).toString("base64")}`;
  });

  ipcMain.handle("runConfigurations:list", (_event, root) => runConfigurations.list(root));
  ipcMain.handle("runConfigurations:save", (_event, payload) => runConfigurations.save(payload.root, payload.configuration));
  ipcMain.handle("runConfigurations:delete", (_event, payload) => runConfigurations.delete(payload.root, payload.id));

  ipcMain.handle("workflow:get", (_event, root) => workflow.get(root));
  ipcMain.handle("workflow:update", (_event, payload) => workflow.update(payload.root, payload.patch));
  ipcMain.handle("workflow:rememberFile", (_event, payload) => workflow.rememberFile(payload.root, payload.file));
  ipcMain.handle("workflow:createScratch", (_event, payload) => workflow.createScratch(payload.root, payload.name));
  ipcMain.handle("refactor:previewMove", (_event, payload) => javaRefactor.previewMove(payload.root, payload));
  ipcMain.handle("refactor:prepareChangeSignature", (_event, payload) =>
    javaRefactor.prepareChangeSignature(payload.root, payload.file, payload.position));
  ipcMain.handle("refactor:previewChangeSignature", (_event, payload) => javaRefactor.previewChangeSignature(payload.root, payload));
  ipcMain.handle("refactor:previewWorkspaceEdit", (_event, payload) =>
    javaRefactor.previewWorkspaceEdit(payload.root, payload.title, payload.edit, payload.context || {}));
  ipcMain.handle("refactor:apply", (_event, payload) => javaRefactor.applyPlan(payload.root, payload.planId));
  ipcMain.handle("refactor:unusedPrivate", (_event, payload) => javaRefactor.analyzeUnusedPrivate(payload.root, payload.options));

  ipcMain.handle("java:detect", (_event, root) => projects.detect(root));
  ipcMain.handle("java:execute", async (_event, payload) => {
    const project = await projects.detect(payload.root);
    if (project.language && project.language !== "java") {
      return { ...await polyglotProjects.execute({ ...payload, language: project.language }), project };
    }
    return builds.execute(payload);
  });
  ipcMain.handle("java:stop", async (_event, root) => {
    const javaStopped = builds.stop(root);
    const otherStopped = await polyglotProjects.stop(root);
    return javaStopped || otherStopped;
  });

  ipcMain.handle("terminal:start", (_event, payload) => terminal.start(payload?.root ?? payload, payload?.sessionId, payload?.size));
  ipcMain.handle("terminal:list", (_event, root) => terminal.list(guard.assertWorkspace(root)));
  ipcMain.handle("terminal:snapshot", (_event, payload) => terminal.snapshot(payload.root, payload.sessionId));
  ipcMain.handle("terminal:input", (_event, payload) => terminal.input(payload.root, payload.text, payload.sessionId));
  ipcMain.handle("terminal:resize", (_event, payload) => terminal.resize(payload.root, payload.columns, payload.rows, payload.sessionId));
  ipcMain.handle("terminal:execute", (_event, payload) => terminal.execute(payload.root, payload.command, payload.sessionId));
  ipcMain.handle("terminal:stop", (_event, payload) => terminal.stop(payload?.root ?? payload, payload?.sessionId));
  // A log file is followed one at a time. Choosing registers the file with the
  // guard, so a path the renderer sends afterwards is one the user picked or
  // one inside an open project — never an arbitrary disk path.
  ipcMain.handle("tailer:choose", async (event, payload) => {
    const result = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Logdatei verfolgen",
      defaultPath: payload?.defaultPath || undefined,
      properties: ["openFile"],
      filters: [
        { name: "Logs", extensions: ["log", "txt", "out", "err"] },
        { name: "Alle Dateien", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return guard.register(result.filePaths[0]);
  });
  ipcMain.handle("tailer:open", (_event, payload) => tailer.open(payload?.path ?? payload, { lastLines: payload?.lastLines }));
  ipcMain.handle("tailer:close", () => tailer.stop());
  ipcMain.handle("panel:openWindow", (_event, root) => {
    const projectRoot = root ? guard.assertWorkspace(root) : "";
    // Asking twice must not leave two windows drawing the same tool window.
    // The button guarded against that on its own; dropping a tool window in
    // the middle of the workbench asks from a second place.
    for (const existing of panelWindows) {
      if (existing.isDestroyed()) continue;
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return true;
    }
    const panelWindow = createWindow("panel", false, { projectRoot });
    panelWindows.add(panelWindow);
    notifyPanelWindowState();
    return true;
  });
  ipcMain.handle("panel:closeWindow", () => {
    for (const browserWindow of [...panelWindows]) {
      if (!browserWindow.isDestroyed()) browserWindow.close();
    }
    return true;
  });
  ipcMain.handle("panel:windowState", () => ({ open: panelWindows.size > 0 }));
  ipcMain.handle("panel:windowContext", () => panelWindowContext());
  // Only the workbench may publish, and only a detached window may ask for
  // something: one direction each keeps a stray window from driving the
  // other one.
  ipcMain.on("panel:state", (event, snapshot) => {
    if (!editorWindow || editorWindow.isDestroyed() || event.sender !== editorWindow.webContents) return;
    broadcastToPanelWindows("panel:state", snapshot);
  });
  ipcMain.on("panel:request", (event, command) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!sender || !panelWindows.has(sender)) return;
    if (!editorWindow || editorWindow.isDestroyed()) return;
    editorWindow.webContents.send("panel:request", command);
  });
  ipcMain.handle("terminal:openWindow", (_event, payload) => {
    const projectRoot = guard.assertWorkspace(payload?.root);
    const sessionId = String(payload?.sessionId || "1");
    terminal.start(projectRoot, sessionId);
    createWindow("terminal", false, { projectRoot, sessionId });
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send("terminal:windowState", { projectRoot, sessionId, open: true });
    }
    return { projectRoot, sessionId, open: true };
  });
  ipcMain.handle("terminal:closeWindow", (_event, payload) => {
    const projectRoot = guard.assertWorkspace(payload?.root);
    const sessionId = String(payload?.sessionId || "1");
    const terminalWindow = openWindows.get(terminalWindowKey(projectRoot, sessionId));
    if (!terminalWindow || terminalWindow.isDestroyed()) return false;
    terminalWindow.close();
    return true;
  });
  ipcMain.handle("terminal:windowContext", (event) => terminalWindowContexts.get(event.sender.id) || null);
  ipcMain.handle("terminal:windowState", (_event, root) => {
    const normalizedRoot = root ? path.resolve(guard.assertWorkspace(root)).toLocaleLowerCase() : "";
    return [...terminalWindowContexts.values()].filter((context) =>
      !normalizedRoot || path.resolve(context.projectRoot).toLocaleLowerCase() === normalizedRoot,
    );
  });

  ipcMain.handle("git:status", (_event, root) => git.status(root));
  // Cloning happens before there is a workspace, so it takes a parent folder
  // and registers what it created — otherwise the very next call about it is
  // refused by the path guard.
  ipcMain.handle("git:clone", async (_event, payload) => {
    const result = await git.clone(payload.url, payload.directory, payload.name);
    guard.register(result.path);
    return result;
  });
  ipcMain.handle("git:chooseCloneDirectory", async (event) => {
    const chosen = await dialog.showOpenDialog(ownerWindow(event), {
      title: "Zielordner für das Klonen wählen",
      properties: ["openDirectory", "createDirectory"],
    });
    return chosen.canceled ? "" : chosen.filePaths[0] || "";
  });
  ipcMain.handle("git:init", (_event, root) => git.init(root));
  ipcMain.handle("git:diff", (_event, payload) => git.diff(payload.root, payload.file, payload.staged));
  ipcMain.handle("git:hunks", (_event, payload) => git.hunks(payload.root, payload.file, payload.staged));
  ipcMain.handle("git:applyHunk", (_event, payload) => git.applyHunk(payload.root, payload.file, payload.index, payload.reverse));
  ipcMain.handle("git:applyLines", (_event, payload) => git.applyLines(payload.root, payload.file, payload.index, payload.changeIds));
  ipcMain.handle("git:stage", (_event, payload) => git.stage(payload.root, payload.paths));
  ipcMain.handle("git:unstage", (_event, payload) => git.unstage(payload.root, payload.paths));
  ipcMain.handle("git:commit", (_event, payload) => git.commit(payload.root, payload.message, {
    stageAll: Boolean(payload.stageAll),
    amend: Boolean(payload.amend),
  }));
  ipcMain.handle("dependencies:search", (_event, payload) => dependencies.search(payload.query, payload.limit));
  ipcMain.handle("dependencies:versions", (_event, payload) => dependencies.versions(payload.groupId, payload.artifactId));
  ipcMain.handle("dependencies:list", (_event, root) => dependencies.list(root));
  ipcMain.handle("dependencies:add", (_event, payload) => dependencies.add(payload.root, payload.coordinates, payload.scope, payload.options));
  ipcMain.handle("dependencies:remove", (_event, payload) => dependencies.remove(payload.root, payload.selector));
  ipcMain.handle("dependencies:update", (_event, payload) => dependencies.update(payload.root, payload.selector, payload.version));
  ipcMain.handle("dependencies:updateCatalog", (_event, payload) => dependencies.updateCatalog(payload.root, payload.catalogPath, payload.key, payload.version));
  ipcMain.handle("git:branches", (_event, root) => git.branches(root));
  ipcMain.handle("git:createBranch", (_event, payload) => git.createBranch(payload.root, payload.name, payload.checkout));
  ipcMain.handle("git:checkout", (_event, payload) => git.checkout(payload.root, payload.name));
  ipcMain.handle("git:log", (_event, payload) => git.log(payload.root, payload.limit));
  ipcMain.handle("git:pull", (_event, root) => git.pull(root));
  ipcMain.handle("git:push", (_event, payload) => git.push(payload.root, payload.setUpstream));
  ipcMain.handle("git:compare", (_event, payload) => git.compare(payload.root, payload.base, payload.head));
  ipcMain.handle("git:previewPull", (_event, root) => git.previewPull(root));
  ipcMain.handle("git:stashes", (_event, root) => git.stashes(root));
  ipcMain.handle("git:stashSave", (_event, payload) => git.stashSave(payload.root, payload.message, payload.includeUntracked));
  ipcMain.handle("git:stashApply", (_event, payload) => git.stashApply(payload.root, payload.ref, payload.pop));
  ipcMain.handle("git:stashDrop", (_event, payload) => git.stashDrop(payload.root, payload.ref));
  ipcMain.handle("git:fileHistory", (_event, payload) => git.fileHistory(payload.root, payload.file, payload.limit));
  ipcMain.handle("git:blame", (_event, payload) => git.blame(payload.root, payload.file));
  ipcMain.handle("git:conflict", (_event, payload) => git.conflict(payload.root, payload.file));
  ipcMain.handle("git:mergeModel", (_event, payload) => git.mergeModel(payload.root, payload.file));
  ipcMain.handle("git:resolveMerge", (_event, payload) => git.resolveMerge(payload.root, payload.file, payload.snapshot, payload.resolutions));
  ipcMain.handle("git:resolveConflict", (_event, payload) => git.resolveConflict(payload.root, payload.file, payload.content));
  ipcMain.handle("git:commitChecks", (_event, root) => git.commitChecks(root));
  ipcMain.handle("git:updateCommitChecks", (_event, payload) => git.updateCommitChecks(payload.root, payload.patch));
  ipcMain.handle("git:commitCheckPlan", (_event, root) => git.commitCheckPlan(root));
  ipcMain.handle("git:runCommitChecks", (_event, root) => git.runCommitChecks(root));
  ipcMain.handle("git:fetch", (_event, payload) => git.fetch(payload.root, payload.prune));
  ipcMain.handle("git:merge", (_event, payload) => git.merge(payload.root, payload.name, payload.options));
  ipcMain.handle("git:mergeAbort", (_event, root) => git.mergeAbort(root));
  ipcMain.handle("git:discard", (_event, payload) => git.discard(payload.root, payload.paths));
  ipcMain.handle("git:deleteBranch", (_event, payload) => git.deleteBranch(payload.root, payload.name, payload.force));
  ipcMain.handle("git:renameBranch", (_event, payload) => git.renameBranch(payload.root, payload.name, payload.nextName));
  ipcMain.handle("git:revertCommit", (_event, payload) => git.revertCommit(payload.root, payload.hash));
  ipcMain.handle("git:cherryPick", (_event, payload) => git.cherryPick(payload.root, payload.hash));
  ipcMain.handle("git:resetTo", (_event, payload) => git.resetTo(payload.root, payload.hash, payload.mode));
  ipcMain.handle("git:tags", (_event, root) => git.tags(root));
  ipcMain.handle("git:createTag", (_event, payload) => git.createTag(payload.root, payload.name, payload.options));
  ipcMain.handle("git:deleteTag", (_event, payload) => git.deleteTag(payload.root, payload.name));
  ipcMain.handle("git:rebasePlan", (_event, payload) => git.rebasePlan(payload.root, payload.upstream));
  ipcMain.handle("git:rebaseState", (_event, root) => git.rebaseState(root));
  ipcMain.handle("git:rebaseInteractive", (_event, payload) => git.startInteractiveRebase(payload.root, payload.upstream, payload.plan));
  ipcMain.handle("git:pullRequests", (_event, payload) => git.pullRequests(payload.root, payload.state));
  ipcMain.handle("git:pullRequest", (_event, payload) => git.pullRequest(payload.root, payload.number));
  ipcMain.handle("git:createPullRequest", (_event, payload) => git.createPullRequest(payload.root, payload.input));
  ipcMain.handle("github:status", () => githubAuth.status());
  ipcMain.handle("github:signIn", (_event, token) => githubAuth.signIn(token));
  ipcMain.handle("github:signOut", () => githubAuth.signOut());
  ipcMain.handle("github:beginDeviceFlow", () => githubAuth.beginDeviceFlow());
  ipcMain.handle("github:pollDeviceFlow", () => githubAuth.pollDeviceFlow());

  ipcMain.handle("git:rebase", (_event, payload) => git.rebase(payload.root, payload.action, payload.upstream));

  ipcMain.handle("tests:discover", async (_event, root) => {
    const project = await projects.detect(root);
    return project.language && project.language !== "java" ? [] : tests.discover(root);
  });
  ipcMain.handle("tests:run", (_event, payload) => tests.run(payload.root, payload.target));
  ipcMain.handle("tests:results", (_event, root) => tests.results(root));
  ipcMain.handle("tests:history", (_event, root) => tests.history(root));
  ipcMain.handle("tests:coverage", (_event, root) => tests.coverage(root));
  ipcMain.handle("tests:coverageResults", (_event, root) => tests.coverageResults(root));

  ipcMain.handle("debug:start", (_event, payload) => debug.start(payload));
  ipcMain.handle("debug:attach", (_event, payload) => debug.attach(payload));
  ipcMain.handle("debug:command", (_event, payload) => debug.command(payload.command, payload.argument));
  ipcMain.handle("debug:stop", () => debug.stop());
  ipcMain.handle("debug:listBreakpoints", (_event, root) => breakpoints.list(root));
  ipcMain.handle("debug:saveBreakpoints", (_event, payload) => breakpoints.save(payload.root, payload.breakpoints));
  ipcMain.handle("bytecode:disassemble", (_event, payload) =>
    bytecode.disassemble(payload.root, payload.binaryName, payload.sourceFile));
  ipcMain.handle("index:load", (_event, root) => projectIndex.load(root));
  ipcMain.handle("index:build", (_event, root) => projectIndex.build(root));
  ipcMain.handle("index:clear", (_event, root) => projectIndex.clear(root));
  ipcMain.handle("templates:read", (_event, root) => templates.read(root));
  ipcMain.handle("templates:write", async (_event, payload) => {
    const written = await templates.write(payload.root, payload.text);
    // The settings window is a window of its own. Without this the workbench
    // kept offering the templates from when the project was opened.
    broadcast("templates:changed", { root: payload.root });
    return written;
  });

  ipcMain.handle("http:send", (_event, payload) => httpClient.send(payload?.request, {
    id: payload?.id,
    timeoutMs: payload?.timeoutMs,
  }));
  ipcMain.handle("http:cancel", (_event, id) => httpClient.cancel(id));

  ipcMain.handle("language:start", (_event, root) => language.start(root));
  ipcMain.handle("polyglot:status", (_event, root) => polyglot.status(root));
  ipcMain.handle("polyglot:open", (_event, payload) => polyglot.open(payload));
  ipcMain.handle("polyglot:change", (_event, payload) => polyglot.change(payload));
  ipcMain.handle("polyglot:save", (_event, payload) => polyglot.save(payload));
  ipcMain.handle("polyglot:close", (_event, payload) => polyglot.close(payload));
  ipcMain.handle("polyglot:request", (_event, payload) => polyglot.request(payload));
  ipcMain.handle("polyglot:cancel", (_event, requestId) => polyglot.cancel(requestId));
  ipcMain.handle("polyglot:stop", (_event, root) => polyglot.stop(root));
  ipcMain.handle("polyglot:install", async (_event, languageId) => {
    const result = await installManagedLanguageServer(languageId, managedLanguageServers);
    if (result.installed) await polyglot.stop();
    return result;
  });
  ipcMain.handle("polyglot:installAll", async () => {
    const result = await installAllLanguageServers(managedLanguageServers);
    if (result.installed > 0) await polyglot.stop();
    return result;
  });
  ipcMain.handle("polyglot:plan", (_event, payload) => polyglotProjects.plan(payload));
  ipcMain.handle("polyglot:execute", (_event, payload) => polyglotProjects.execute(payload));
  ipcMain.handle("polyglot:stopRun", (_event, root) => polyglotProjects.stop(root));

  ipcMain.handle("database:find", (_event, root) => database.findDatabases(root));
  ipcMain.handle("database:schema", (_event, dbPath) => database.getSchema(dbPath));
  ipcMain.handle("database:query", (_event, payload) => database.executeQuery(payload.dbPath, payload.sql));

  ipcMain.handle("docker:check", () => docker.checkInstalled());
  ipcMain.handle("docker:containers", (_event, all) => docker.listContainers(all));
  ipcMain.handle("docker:images", () => docker.listImages());
  ipcMain.handle("docker:containerAction", (_event, payload) => docker.containerAction(payload.id, payload.action));
  ipcMain.handle("docker:composeAction", (_event, payload) => docker.composeAction(payload.root, payload.action));
  ipcMain.handle("language:request", (_event, payload) => language.request(payload.root, payload.method, payload.params, payload.requestId));
  // Typing past a completion should stop the work, not merely ignore it.
  ipcMain.handle("language:cancel", (_event, requestId) => language.cancel(requestId));
  ipcMain.handle("language:open", (_event, payload) => language.open(payload.root, payload.file, payload.text, payload.languageId));
  ipcMain.handle("language:change", (_event, payload) => language.change(payload.root, payload.file, payload.text));
  ipcMain.handle("language:save", (_event, payload) => language.save(payload.root, payload.file, payload.text));
  ipcMain.handle("language:close", (_event, payload) => language.close(payload.root, payload.file));
  ipcMain.handle("language:refresh", (_event, payload) => language.refresh(payload.root, payload.file));
  ipcMain.handle("language:stop", (_event, root) => language.stop(root));

  ipcMain.handle("app:openEditor", async (_event, root) => {
    if (!root || !fs.existsSync(root)) throw new Error("Das Projekt ist nicht mehr verfügbar.");
    const registered = guard.register(root);
    await workspaceState.add([registered], true);
    workspace.watch(registered);
    createWindow("editor", true);
    return true;
  });
  ipcMain.handle("app:showWelcome", async () => {
    // Neither side of a CodeToGetter session belongs to the project hub. In
    // particular, cancel a guest that is still in its TCP/hello handshake so
    // it cannot appear as a ghost participant after the editor has gone.
    stopCollabGuest();
    await stopCollabHosting();
    closeSettingsWindow();
    createWindow("welcome", true);
    return true;
  });
  ipcMain.handle("app:openSettings", (_event, root) => {
    let projectRoot = "";
    if (typeof root === "string" && root && fs.existsSync(root)) {
      try {
        projectRoot = guard.assertWorkspace(root);
      } catch {
        projectRoot = "";
      }
    }
    createWindow("settings", false, { projectRoot });
    return true;
  });
  ipcMain.handle("app:openStructure", (_event, root) => {
    let projectRoot = "";
    if (typeof root === "string" && root && fs.existsSync(root)) {
      try {
        projectRoot = guard.assertWorkspace(root);
      } catch {
        projectRoot = "";
      }
    }
    createWindow("structure", false, { projectRoot });
    return true;
  });
  ipcMain.handle("app:openNewProject", (_event, initialLocation) => {
    let loc = "";
    if (typeof initialLocation === "string" && initialLocation && fs.existsSync(initialLocation)) {
      loc = initialLocation;
    }
    createWindow("wizard", false, { initialLocation: loc });
    return true;
  });
  ipcMain.handle("app:updateState", () => ({ ...updateRuntimeState }));
  ipcMain.handle("app:checkForUpdates", async () => {
    if (process.platform !== "win32") {
      return {
        configured: false,
        available: false,
        currentVersion: effectiveVersion(),
        reason: "Install updates using the package for your platform.",
      };
    }
    publishUpdateState("checking");
    try {
      const result = await updates.check();
      publishUpdateState(result.available ? "available" : "idle", {
        version: result.version,
        reason: result.reason,
      });
      return result;
    } catch (error) {
      publishUpdateState("error", { operation: "check", reason: updateErrorMessage(error, "Update-Prüfung fehlgeschlagen.") });
      throw error;
    }
  });
  ipcMain.handle("app:health", () => ({
    sampledAt: new Date().toISOString(),
    main: {
      heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    },
    language: language.health(),
    terminal: terminal.health(),
    debug: debug.health(),
    // Which renderer this session runs, and whether a restart-free update is
    // possible at all: without a fingerprint no bundle is ever accepted.
    renderer: {
      version: effectiveVersion(),
      hot: Boolean(rendererRoot.hot),
      mainHash: MAIN_PROCESS_HASH.slice(0, 12),
    },
    // What a bug report needs and nobody can read off the window: the version
    // that is installed, as opposed to the renderer that is running, and the
    // runtime underneath both.
    build: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
  }));
  // Opening a page is the one thing mvnrepository.com can do for a program:
  // it answers a machine with a bot challenge, so nothing is ever read from
  // it, but it is the page people mean by "look this dependency up". The host
  // is fixed here rather than passed in, so a renderer cannot turn this into a
  // way to open anything at all.
  ipcMain.handle("app:openArtifactPage", async (_event, url) => {
    let parsed;
    try {
      parsed = new URL(String(url || ""));
    } catch {
      throw new Error("Keine gültige Adresse.");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "mvnrepository.com") {
      throw new Error("Es wird ausschließlich mvnrepository.com geöffnet.");
    }
    await shell.openExternal(parsed.toString());
    return true;
  });
  ipcMain.handle("app:openUpdate", async (_event, url) => {
    await shell.openExternal(assertUpdateDownloadUrl(url));
    return true;
  });
  ipcMain.handle("app:openExternal", async (_event, url) => {
    await shell.openExternal(assertExternalLinkUrl(url));
    return true;
  });
  ipcMain.handle("app:downloadUpdate", async (_event, update) => {
    if (process.platform !== "win32") throw new Error("Install updates using the package for your platform.");
    publishUpdateState("downloading", { version: update?.version });
    try {
      const downloaded = await updates.download(update);
      publishUpdateState("ready", { version: downloaded.version, bytes: downloaded.bytes });
      return downloaded;
    } catch (error) {
      publishUpdateState("error", { operation: "download", version: update?.version, reason: updateErrorMessage(error, "Update-Download fehlgeschlagen.") });
      throw error;
    }
  });
  ipcMain.handle("app:installUpdate", (_event, update) => {
    if (process.platform !== "win32") throw new Error("Install updates using the package for your platform.");
    if (updateInstallPromise) return updateInstallPromise;
    updateInstallPromise = (async () => {
      let portableStage = null;
      try {
        if (shutdownStarted) throw new Error("Kiwi wird bereits beendet; das Update wurde nicht gestartet.");
        publishUpdateState("downloading", { version: update?.version });
        const downloaded = await updates.download(update);
        if (!fs.existsSync(downloaded.path)) throw new Error("Das verifizierte Update-Paket wurde nicht gefunden.");

        // A release that only changed the renderer is applied to the running
        // application: the session is flushed, the windows reload, and nothing
        // is restarted. Everything else goes through the installer below.
        if (downloaded.artifactKind === "renderer") {
          publishUpdateState("preparing", { version: downloaded.version });
          await prepareRenderersForUpdate(downloaded.version);
          if (shutdownStarted) throw new Error("Kiwi wird bereits beendet; das Update wurde nicht gestartet.");
          publishUpdateState("installing", { version: downloaded.version });
          const applied = await applyRendererUpdateInPlace(downloaded, update?.mainHash);
          publishUpdateState("installed", {
            version: applied.version,
            reason: applied.reloaded
              ? `Kiwi ${applied.version} wurde ohne Neustart aktualisiert.`
              : `Kiwi ${applied.version} ist installiert und wird nach der laufenden Debug-Sitzung aktiv.`,
          });
          updateInstallPromise = null;
          return { ...downloaded, relaunching: false, restartFree: true, reloaded: applied.reloaded };
        }

        if (downloaded.artifactKind === "portable") {
          const targetPath = String(process.env.PORTABLE_EXECUTABLE_FILE || "");
          const helperPath = portableUpdateHelperPath();
          if (!fs.existsSync(helperPath)) throw new Error("Der portable Kiwi-Updatehelfer wurde nicht gefunden.");
          portableStage = await stagePortableUpdate(downloaded, targetPath);
        } else if (!fs.existsSync(setupUpdateHelperPath())) {
          throw new Error("Der Kiwi-Setup-Updatehelfer wurde nicht gefunden.");
        }

        publishUpdateState("preparing", { version: downloaded.version });
        await prepareRenderersForUpdate(downloaded.version);
        if (shutdownStarted) throw new Error("Kiwi wird bereits beendet; das Update wurde nicht gestartet.");

        publishUpdateState("installing", { version: downloaded.version });
        pendingUpdateLaunch = portableStage
          ? {
            kind: "portable",
            command: "powershell.exe",
            args: portableHelperArguments(
              portableUpdateHelperPath(),
              portableStage,
              path.join(app.getPath("userData"), "updates", "portable-update.log"),
            ),
            cwd: path.dirname(portableStage.targetPath),
            version: downloaded.version,
            portableStage,
          }
          : {
            kind: "setup",
            command: "powershell.exe",
            args: setupHelperArguments(
              setupUpdateHelperPath(),
              downloaded.path,
              process.execPath,
              path.join(app.getPath("userData"), "updates", "setup-update.log"),
              nsisUpdateArguments(),
              { sha256: downloaded.sha256, bytes: downloaded.bytes },
            ),
            cwd: path.dirname(downloaded.path),
            version: downloaded.version,
          };
        publishUpdateState("restarting", {
          version: downloaded.version,
          reason: "Das Update wird still installiert; Kiwi startet danach automatisch wieder.",
        });
        // Let the invoking renderer receive the successful IPC result and the
        // final state event before Electron begins its normal shutdown path.
        setTimeout(() => app.quit(), 125);
        return { ...downloaded, relaunching: true };
      } catch (error) {
        await discardPortableStage(portableStage);
        pendingUpdateLaunch = null;
        updateInstallPromise = null;
        publishUpdateState("error", {
          operation: "install",
          version: update?.version,
          reason: updateErrorMessage(error, "Update-Installation fehlgeschlagen."),
        });
        throw error;
      }
    })();
    return updateInstallPromise;
  });

  ipcMain.on("window:minimize", (event) => ownerWindow(event)?.minimize());
  ipcMain.on("window:maximize", (event) => {
    const browserWindow = ownerWindow(event);
    if (!browserWindow) return;
    browserWindow.isMaximized() ? browserWindow.unmaximize() : browserWindow.maximize();
  });
  ipcMain.on("window:close", (event) => {
    const window = ownerWindow(event);
    if (!window) return;
    // Closing the Hub or the editor means closing Kiwi. Secondary tool
    // windows must not keep an invisible main process (and its JDT/terminal
    // children) alive after the last primary window disappeared.
    if (window === editorWindow || window === welcomeWindow) {
      app.quit();
      return;
    }
    window.close();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  // Kiwi draws its own menu bar, but Electron still installed the default one
  // behind the frameless window — invisible and fully armed. Its accelerators
  // fired on keys the workbench never claimed: Ctrl+W closed the IDE, Ctrl+R
  // reloaded the renderer and threw the session away, Ctrl+M minimised it and
  // Ctrl+0/+/- drove Chromium's zoom against Kiwi's own scale. Removing it
  // leaves every shortcut to the catalogue in the settings.
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: "quit" }] }]));
    // Finder launches do not inherit the PATH set in the user's shell.
    const entries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    process.env.PATH = [...new Set([...entries, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(path.delimiter);
  } else {
    Menu.setApplicationMenu(null);
  }
  // Decide once, before anything is shown, which renderer this session runs:
  // an update applied earlier, or the one inside the package.
  refreshRendererRoot();
  void pruneRendererUpdates(app.getPath("userData"), readCurrentRenderer(app.getPath("userData"))?.directory || "")
    .catch(() => undefined);
  createStartupSplash();
  try {
    services = await createServices();
    registerIpc();
    const state = services.workspaceState.snapshot();
    const activeProject = state.activeRoot && fs.existsSync(state.activeRoot);
    // "hub" always starts on the project list. The setting existed and was
    // stored but nothing ever read it, so the choice had no effect at all.
    // An updater relaunch must return to the active workbench even when the
    // normal preference says to show the Hub. The renderer then restores the
    // session snapshot that was flushed before NSIS started.
    createWindow((UPDATED_LAUNCH || UPDATE_FAILED_LAUNCH) && activeProject
      ? "editor"
      : startupWindowKind(activeProject, services.settings.get()));
  } catch (error) {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    throw error;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    const currentState = services.workspaceState.snapshot();
    const hasActiveProject = currentState.activeRoot && fs.existsSync(currentState.activeRoot);
    createWindow(startupWindowKind(hasActiveProject, services.settings.get()));
  });
});

app.on("before-quit", (event) => {
  if (shutdownComplete || !services) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  closeSettingsWindow();
  void (async () => {
    services.workspace.dispose();
    services.builds.stop();
    services.terminal.stop();
    services.tailer.stop();
    services.polyglotProjects.stop();
    services.debug.stop();
    services.discord.stop();
    stopCollabGuest();
    await Promise.allSettled([
      services.language.stop(),
      services.polyglot.stop(),
      services.builds.shutdown(),
      stopCollabHosting(),
    ]);
  })().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

// Launch only after Electron has closed every BrowserWindow and the
// before-quit cleanup has stopped terminals, builds, JDT and the debugger.
// Starting the installer earlier races NSIS against files and child processes
// that Kiwi still owns. `--force-run` performs the relaunch for the user.
app.on("will-quit", () => {
  const update = pendingUpdateLaunch;
  if (!update) return;
  pendingUpdateLaunch = null;
  try {
    const installer = spawn(update.command, update.args, {
      cwd: update.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    installer.once("error", (error) => void recordCrash("update-installer", error));
    installer.unref();
  } catch (error) {
    void recordCrash("update-installer", error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  // A workspace that was just closed belongs in the project hub. Quitting here
  // instead is what made Kiwi disappear when the call that should have opened
  // the hub died with the window that made it.
  if (reopeningHub && !shutdownStarted && !shutdownComplete && services) {
    reopeningHub = false;
    const currentState = services.workspaceState.snapshot();
    const hasActiveProject = currentState.activeRoot && fs.existsSync(currentState.activeRoot);
    createWindow(startupWindowKind(hasActiveProject, services.settings.get()));
    return;
  }
  app.quit();
});

process.on("uncaughtExceptionMonitor", (error) => {
  void recordCrash("main", error);
});
