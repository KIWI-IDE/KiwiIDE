const { contextBridge, ipcRenderer, webUtils } = require("electron");

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
// Electron prefixes every rejected call with the channel it came from:
// "Error invoking remote method 'file:read': Error: …". The workbench puts that
// message straight in front of the user, so the plumbing goes and the sentence
// stays. An error without the prefix is passed through untouched.
const remoteMethodPrefix = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?([\s\S]+)$/;
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload).catch((error) => {
  const message = typeof error?.message === "string" ? error.message : String(error);
  const stripped = remoteMethodPrefix.exec(message)?.[1];
  throw stripped ? new Error(stripped) : error;
});

// The main process waits for every Kiwi renderer before it starts the silent
// installer. Dispatching beforeunload runs the workbench's existing synchronous
// session writers (open tabs, dirty buffers, cursor and dock layout) without
// exposing an IPC primitive that arbitrary renderer code could use to approve
// an executable. The dedicated event is available for future window-specific
// flushers; the acknowledgement always remains internal to this preload.
ipcRenderer.on("app:updatePrepare", (_event, payload) => {
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  if (!requestId) return;
  const failures = [];
  try {
    // Event listeners cannot throw through dispatchEvent. A mutable failure
    // list gives the trusted renderer a synchronous, verifiable way to refuse
    // shutdown when localStorage is full or a dirty draft cannot be persisted.
    document.documentElement?.removeAttribute("data-kiwi-update-prepare-error");
    window.dispatchEvent(new CustomEvent("kiwi:update-prepare", {
      detail: { ...payload, failures },
    }));
    const rendererFailure = document.documentElement?.getAttribute("data-kiwi-update-prepare-error");
    if (rendererFailure) failures.push(rendererFailure);
    window.dispatchEvent(new Event("beforeunload"));
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error || "Sitzung konnte nicht gespeichert werden."));
  }
  const reason = failures.map((value) => String(value || "").trim()).filter(Boolean).join(" ").slice(0, 1_000);
  queueMicrotask(() => ipcRenderer.send("app:updatePrepared", {
    requestId,
    ok: !reason,
    reason,
  }));
});

contextBridge.exposeInMainWorld("kiwi", {
  platform: process.platform,
  workspace: {
    open: () => invoke("workspace:open"),
    register: (root) => invoke("workspace:register", root),
    restore: () => invoke("workspace:restore"),
    openMany: () => invoke("workspace:openMany"),
    add: (roots) => invoke("workspace:add", roots),
    list: () => invoke("workspace:list"),
    saveSession: (root, session) => invoke("session:save", { root, session }),
    loadSession: (root) => invoke("session:load", root),
    clearSession: (root) => invoke("session:clear", root),
    /**
     * Where each file of a project was last left.
     *
     * Apart from the session, which is what is open. A file that was
     * closed keeps its place here, and reopening it lands there again.
     */
    saveEditorStates: (root, states) => invoke("editorStates:save", { root, states }),
    loadEditorStates: (root) => invoke("editorStates:load", root),
    recoverRecent: (roots) => invoke("workspace:recoverRecent", roots),
    activate: (root) => invoke("workspace:activate", root),
    remove: (root) => invoke("workspace:remove", root),
    restoreState: () => invoke("workspace:restoreState"),
    closeAll: () => invoke("workspace:closeAll"),
    setPinned: (root, pinned) => invoke("workspace:setPinned", { root, pinned }),
    rename: (root, name) => invoke("workspace:rename", { root, name }),
    saveProfile: (name) => invoke("workspace:saveProfile", name),
    openProfile: (id) => invoke("workspace:openProfile", id),
    deleteProfile: (id) => invoke("workspace:deleteProfile", id),
    tree: (root) => invoke("workspace:tree", root),
    children: (root, directory) => invoke("workspace:children", { root, directory }),
    search: (root, query, options) => invoke("workspace:search", { root, query, options }),
    taskComments: (root) => invoke("workspace:taskComments", { root }),
    validateProject: (root) => invoke("workspace:validateProject", { root }),
    validateBuffer: (root, file, content) => invoke("workspace:validateBuffer", { root, file, content }),
    replacePreview: (root, query, replacement, options) => invoke("workspace:replacePreview", { root, query, replacement, options }),
    replaceAll: (root, query, replacement, paths, options) => invoke("workspace:replaceAll", { root, query, replacement, paths, options }),
    watch: (root) => invoke("workspace:watch", root),
    history: (root, file) => invoke("workspace:history", { root, file }),
    undo: (root, id) => invoke("workspace:undo", { root, id }),
    beginOperation: (root, label, paths) => invoke("workspace:beginOperation", { root, label, paths }),
    endOperation: (root) => invoke("workspace:endOperation", root),
    onChanged: (callback) => subscribe("workspace:changed", callback),
    onHistory: (callback) => subscribe("workspace:history", callback),
  },
  file: {
    read: (path) => invoke("file:read", path),
    write: (path, content) => invoke("file:write", { path, content }),
    create: (parent, name, directory = false) => invoke("file:create", { parent, name, directory }),
    rename: (path, name) => invoke("file:rename", { path, name }),
    delete: (path) => invoke("file:delete", path),
    transfer: (source, targetDirectory, move = false) => invoke("file:transfer", { source, targetDirectory, move }),
    authorizeDrop: (file) => {
      const droppedPath = webUtils.getPathForFile(file);
      return droppedPath ? invoke("file:authorizeDrop", droppedPath) : Promise.resolve(null);
    },
    importDropped: (tokens, targetDirectory) => invoke("file:importDropped", { tokens, targetDirectory }),
    startDrag: (paths) => ipcRenderer.send("file:startDrag", paths),
    duplicate: (path) => invoke("file:duplicate", path),
    reveal: (path) => invoke("file:reveal", path),
  },
  project: {
    chooseLocation: () => invoke("project:chooseLocation"),
    create: (spec) => invoke("project:create", spec),
    detect: (root) => invoke("project:detect", root),
    /**
     * Prepares a project without building it.
     *
     * Reads the project, its modules and its task list, and keeps the
     * answers — so opening it afterwards finds them already there.
     */
    prepare: (root) => invoke("project:prepare", root),
    frameworkInfo: (root) => invoke("project:frameworkInfo", root),
    getSettings: (root) => invoke("project:getSettings", root),
    updateSettings: (root, patch) => invoke("project:updateSettings", { root, patch }),
    repair: (root) => invoke("project:repair", root),
    createSourceElement: (root, parent, kind, name, options) =>
      invoke("project:createSourceElement", { root, parent, kind, name, options }),
    tasks: (root, refresh = false) => invoke("project:tasks", { root, refresh }),
    dependencies: (root) => invoke("project:dependencies", root),
    searchDependencies: (query, limit) => invoke("dependencies:search", { query, limit }),
    dependencyVersions: (groupId, artifactId) => invoke("dependencies:versions", { groupId, artifactId }),
    listDependencies: (root) => invoke("dependencies:list", root),
    addDependency: (root, coordinates, scope, options) => invoke("dependencies:add", { root, coordinates, scope, options }),
    removeDependency: (root, selector) => invoke("dependencies:remove", { root, selector }),
    updateDependency: (root, selector, version) => invoke("dependencies:update", { root, selector, version }),
    updateVersionCatalog: (root, catalogPath, key, version) => invoke("dependencies:updateCatalog", { root, catalogPath, key, version }),
    dependencyTree: (root, projectPath = "") => invoke("project:dependencyTree", { root, projectPath }),
    auditDependencies: (root) => invoke("project:auditDependencies", root),
    selectJdk: () => invoke("project:selectJdk"),
    listJdks: () => invoke("project:listJdks"),
    onSettingsChanged: (callback) => subscribe("project:settingsChanged", callback),
  },
  modules: {
    list: (root) => invoke("modules:list", root),
    previewCreate: (root, spec) => invoke("modules:previewCreate", { root, spec }),
    previewRemove: (root, moduleId) => invoke("modules:previewRemove", { root, moduleId }),
    applyPlan: (root, planId) => invoke("modules:applyPlan", { root, planId }),
    updateSettings: (root, moduleId, patch) => invoke("modules:updateSettings", { root, moduleId, patch }),
  },
  settings: {
    get: () => invoke("settings:get"),
    listSystemFonts: () => invoke("settings:listSystemFonts"),
    update: (patch) => invoke("settings:update", patch),
    reset: () => invoke("settings:reset"),
    chooseCertificate: () => invoke("settings:chooseCertificate"),
    exportBundle: (text) => invoke("settings:exportBundle", text),
    importBundle: () => invoke("settings:importBundle"),
    exportTheme: (fileName, text) => invoke("settings:exportTheme", { fileName, text }),
    importTheme: () => invoke("settings:importTheme"),
    selectBackgroundImage: () => invoke("settings:selectBackgroundImage"),
    backgroundImageData: (path) => invoke("settings:backgroundImageData", path),
    onChanged: (callback) => subscribe("settings:changed", callback),
  },
  runConfigurations: {
    list: (root) => invoke("runConfigurations:list", root),
    save: (root, configuration) => invoke("runConfigurations:save", { root, configuration }),
    delete: (root, id) => invoke("runConfigurations:delete", { root, id }),
  },
  workflow: {
    get: (root) => invoke("workflow:get", root),
    update: (root, patch) => invoke("workflow:update", { root, patch }),
    rememberFile: (root, file) => invoke("workflow:rememberFile", { root, file }),
    createScratch: (root, name) => invoke("workflow:createScratch", { root, name }),
  },
  refactor: {
    previewMove: (root, request) => invoke("refactor:previewMove", { root, ...request }),
    prepareChangeSignature: (root, file, position) => invoke("refactor:prepareChangeSignature", { root, file, position }),
    previewChangeSignature: (root, request) => invoke("refactor:previewChangeSignature", { root, ...request }),
    previewWorkspaceEdit: (root, title, edit, context) => invoke("refactor:previewWorkspaceEdit", { root, title, edit, context }),
    apply: (root, planId) => invoke("refactor:apply", { root, planId }),
    unusedPrivate: (root, options) => invoke("refactor:unusedPrivate", { root, options }),
  },
  java: {
    execute: (payload) => invoke("java:execute", payload),
    stop: (root) => invoke("java:stop", root),
    detect: (root) => invoke("java:detect", root),
    onOutput: (callback) => subscribe("java:output", callback),
    onExit: (callback) => subscribe("java:exit", callback),
  },
  // A detached tool window draws what the workbench publishes and sends its
  // clicks back. Publishing is accepted from the workbench only, and requests
  // only from a detached window; the main process enforces both.
  panel: {
    openWindow: (root) => invoke("panel:openWindow", root),
    closeWindow: () => invoke("panel:closeWindow"),
    windowState: () => invoke("panel:windowState"),
    windowContext: () => invoke("panel:windowContext"),
    publish: (snapshot) => ipcRenderer.send("panel:state", snapshot),
    onState: (callback) => subscribe("panel:state", callback),
    request: (command) => ipcRenderer.send("panel:request", command),
    onRequest: (callback) => subscribe("panel:request", callback),
    onWindowState: (callback) => subscribe("panel:windowState", callback),
  },
  terminal: {
    start: (root, sessionId, size) => invoke("terminal:start", { root, sessionId, size }),
    list: (root) => invoke("terminal:list", root),
    snapshot: (root, sessionId) => invoke("terminal:snapshot", { root, sessionId }),
    input: (root, text, sessionId) => invoke("terminal:input", { root, text, sessionId }),
    resize: (root, columns, rows, sessionId) => invoke("terminal:resize", { root, columns, rows, sessionId }),
    execute: (payload) => invoke("terminal:execute", payload),
    stop: (root, sessionId) => invoke("terminal:stop", { root, sessionId }),
    openWindow: (root, sessionId) => invoke("terminal:openWindow", { root, sessionId }),
    closeWindow: (root, sessionId) => invoke("terminal:closeWindow", { root, sessionId }),
    windowContext: () => invoke("terminal:windowContext"),
    windowState: (root) => invoke("terminal:windowState", root),
    onOutput: (callback) => subscribe("terminal:output", callback),
    onExit: (callback) => subscribe("terminal:exit", callback),
    onWindowState: (callback) => subscribe("terminal:windowState", callback),
  },
  tailer: {
    choose: (defaultPath) => invoke("tailer:choose", { defaultPath }),
    open: (path, options) => invoke("tailer:open", { path, ...(options || {}) }),
    close: () => invoke("tailer:close"),
    onLines: (callback) => subscribe("tailer:lines", callback),
    onReset: (callback) => subscribe("tailer:reset", callback),
    onStatus: (callback) => subscribe("tailer:status", callback),
    onError: (callback) => subscribe("tailer:error", callback),
  },
  git: {
    clone: (url, directory, name) => invoke("git:clone", { url, directory, name }),
    chooseCloneDirectory: () => invoke("git:chooseCloneDirectory"),
    status: (root) => invoke("git:status", root),
    init: (root) => invoke("git:init", root),
    diff: (root, file, staged = false) => invoke("git:diff", { root, file, staged }),
    hunks: (root, file, staged = false) => invoke("git:hunks", { root, file, staged }),
    applyHunk: (root, file, index, reverse = false) => invoke("git:applyHunk", { root, file, index, reverse }),
    applyLines: (root, file, index, changeIds) => invoke("git:applyLines", { root, file, index, changeIds }),
    stage: (root, paths) => invoke("git:stage", { root, paths }),
    unstage: (root, paths) => invoke("git:unstage", { root, paths }),
    commit: (root, message, options) => invoke("git:commit", { root, message, ...(options || {}) }),
    branches: (root) => invoke("git:branches", root),
    createBranch: (root, name, checkout = true) => invoke("git:createBranch", { root, name, checkout }),
    checkout: (root, name) => invoke("git:checkout", { root, name }),
    log: (root, limit = 50) => invoke("git:log", { root, limit }),
    pull: (root) => invoke("git:pull", root),
    push: (root, setUpstream = false) => invoke("git:push", { root, setUpstream }),
    compare: (root, base, head = "HEAD") => invoke("git:compare", { root, base, head }),
    previewPull: (root) => invoke("git:previewPull", root),
    stashes: (root) => invoke("git:stashes", root),
    stashSave: (root, message, includeUntracked = true) => invoke("git:stashSave", { root, message, includeUntracked }),
    stashApply: (root, ref, pop = false) => invoke("git:stashApply", { root, ref, pop }),
    stashDrop: (root, ref) => invoke("git:stashDrop", { root, ref }),
    fetch: (root, prune = true) => invoke("git:fetch", { root, prune }),
    merge: (root, name, options) => invoke("git:merge", { root, name, options }),
    mergeAbort: (root) => invoke("git:mergeAbort", root),
    discard: (root, paths) => invoke("git:discard", { root, paths }),
    deleteBranch: (root, name, force) => invoke("git:deleteBranch", { root, name, force }),
    renameBranch: (root, name, nextName) => invoke("git:renameBranch", { root, name, nextName }),
    revertCommit: (root, hash) => invoke("git:revertCommit", { root, hash }),
    cherryPick: (root, hash) => invoke("git:cherryPick", { root, hash }),
    resetTo: (root, hash, mode) => invoke("git:resetTo", { root, hash, mode }),
    tags: (root) => invoke("git:tags", root),
    createTag: (root, name, options) => invoke("git:createTag", { root, name, options }),
    deleteTag: (root, name) => invoke("git:deleteTag", { root, name }),
    fileHistory: (root, file, limit = 100) => invoke("git:fileHistory", { root, file, limit }),
    blame: (root, file) => invoke("git:blame", { root, file }),
    conflict: (root, file) => invoke("git:conflict", { root, file }),
    mergeModel: (root, file) => invoke("git:mergeModel", { root, file }),
    resolveMerge: (root, file, snapshot, resolutions) => invoke("git:resolveMerge", { root, file, snapshot, resolutions }),
    resolveConflict: (root, file, content) => invoke("git:resolveConflict", { root, file, content }),
    commitChecks: (root) => invoke("git:commitChecks", root),
    updateCommitChecks: (root, patch) => invoke("git:updateCommitChecks", { root, patch }),
    commitCheckPlan: (root) => invoke("git:commitCheckPlan", root),
    runCommitChecks: (root) => invoke("git:runCommitChecks", root),
    rebasePlan: (root, upstream) => invoke("git:rebasePlan", { root, upstream }),
    rebaseState: (root) => invoke("git:rebaseState", root),
    rebaseInteractive: (root, upstream, plan) => invoke("git:rebaseInteractive", { root, upstream, plan }),
    rebase: (root, action, upstream) => invoke("git:rebase", { root, action, upstream }),
    pullRequests: (root, state = "open") => invoke("git:pullRequests", { root, state }),
    pullRequest: (root, number) => invoke("git:pullRequest", { root, number }),
    createPullRequest: (root, input) => invoke("git:createPullRequest", { root, input }),
    githubStatus: () => invoke("github:status"),
    githubSignIn: (token) => invoke("github:signIn", token),
    githubSignOut: () => invoke("github:signOut"),
    githubBeginDeviceFlow: () => invoke("github:beginDeviceFlow"),
    githubPollDeviceFlow: () => invoke("github:pollDeviceFlow"),
  },
  tests: {
    discover: (root) => invoke("tests:discover", root),
    run: (root, target) => invoke("tests:run", { root, target }),
    results: (root) => invoke("tests:results", root),
    history: (root) => invoke("tests:history", root),
    coverage: (root) => invoke("tests:coverage", root),
    coverageResults: (root) => invoke("tests:coverageResults", root),
  },
  http: {
    send: (request, options) => invoke("http:send", { request, ...(options || {}) }),
    cancel: (id) => invoke("http:cancel", id),
  },
  // CodeToGetter. The guest side deliberately has no file API of its own: every
  // question it can ask goes to the host, which is the only side with a disk.
  collab: {
    host: (root, publicAccess = false, relay = "", hostOnly = false) =>
      invoke("collab:host", { root, publicAccess, relay, hostOnly }),
    stopHosting: () => invoke("collab:stopHosting"),
    hostState: () => invoke("collab:hostState"),
    localEdit: (root, path, edit, baseVersion) => invoke("collab:localEdit", { root, path, edit, baseVersion }),
    localSnapshot: (root, path) => invoke("collab:localSnapshot", { root, path }),
    localSave: (root, path) => invoke("collab:localSave", { root, path }),
    localReplace: (root, path, text) => invoke("collab:localReplace", { root, path, text }),
    join: (code, name) => invoke("collab:join", { code, name }),
    leave: () => invoke("collab:leave"),
    setPeerRole: (root, peerId, role) => invoke("collab:setPeerRole", { root, peerId, role }),
    setPeerPermissions: (root, peerId, permissions) => invoke("collab:setPeerPermissions", { root, peerId, permissions }),
    disconnectPeer: (root, peerId) => invoke("collab:disconnectPeer", { root, peerId }),
    blockPeer: (root, peerId) => invoke("collab:blockPeer", { root, peerId }),
    unblock: (root, address) => invoke("collab:unblock", { root, address }),
    onRemoved: (callback) => subscribe("collab:removed", callback),
    setDefaultRole: (root, role) => invoke("collab:setDefaultRole", { root, role }),
    setHostOnly: (root, hostOnly) => invoke("collab:setHostOnly", { root, hostOnly }),
    onRole: (callback) => subscribe("collab:role", callback),
    request: (type, payload) => invoke("collab:request", { type, payload }),
    onPeers: (callback) => subscribe("collab:peers", callback),
    onEdit: (callback) => subscribe("collab:edit", callback),
    onReset: (callback) => subscribe("collab:reset", callback),
    onSaved: (callback) => subscribe("collab:saved", callback),
    onDisconnected: (callback) => subscribe("collab:disconnected", callback),
    onCursor: (callback) => subscribe("collab:cursor", callback),
    onTreeChanged: (callback) => subscribe("collab:treeChanged", callback),
    onOutput: (callback) => subscribe("collab:output", callback),
    onRunRequest: (callback) => subscribe("collab:runRequest", callback),
  },
  jdk: {
    available: () => invoke("jdk:available"),
    describe: (feature) => invoke("jdk:describe", feature),
    install: (feature) => invoke("jdk:install", feature),
    installRoot: () => invoke("jdk:installRoot"),
    chooseInstallRoot: () => invoke("jdk:chooseInstallRoot"),
    resetInstallRoot: () => invoke("jdk:resetInstallRoot"),
    onProgress: (callback) => subscribe("jdk:progress", callback),
  },
  bytecode: {
    disassemble: (root, binaryName, sourceFile) =>
      invoke("bytecode:disassemble", { root, binaryName, sourceFile }),
  },
  projectIndex: {
    load: (root) => invoke("index:load", root),
    build: (root) => invoke("index:build", root),
    clear: (root) => invoke("index:clear", root),
  },
  templates: {
    read: (root) => invoke("templates:read", root),
    write: (root, text) => invoke("templates:write", { root, text }),
    onChanged: (callback) => subscribe("templates:changed", callback),
  },
  debug: {
    start: (payload) => invoke("debug:start", payload),
    attach: (payload) => invoke("debug:attach", payload),
    command: (command, argument) => invoke("debug:command", { command, argument }),
    stop: () => invoke("debug:stop"),
    listBreakpoints: (root) => invoke("debug:listBreakpoints", root),
    saveBreakpoints: (root, breakpoints) => invoke("debug:saveBreakpoints", { root, breakpoints }),
    onOutput: (callback) => subscribe("debug:output", callback),
    onState: (callback) => subscribe("debug:state", callback),
    onVariables: (callback) => subscribe("debug:variables", callback),
    onStack: (callback) => subscribe("debug:stack", callback),
    onThreads: (callback) => subscribe("debug:threads", callback),
    onWatch: (callback) => subscribe("debug:watch", callback),
    onHotReplace: (callback) => subscribe("debug:hotReplace", callback),
    onBreakpoint: (callback) => subscribe("debug:breakpoint", callback),
    onFieldHit: (callback) => subscribe("debug:fieldHit", callback),
    onMethodExit: (callback) => subscribe("debug:methodExit", callback),
  },
  language: {
    start: (root) => invoke("language:start", root),
    request: (root, method, params, requestId) => invoke("language:request", { root, method, params, requestId }),
    cancel: (requestId) => invoke("language:cancel", requestId),
    open: (payload) => invoke("language:open", payload),
    change: (payload) => invoke("language:change", payload),
    save: (payload) => invoke("language:save", payload),
    close: (payload) => invoke("language:close", payload),
    refresh: (root, file) => invoke("language:refresh", { root, file }),
    stop: (root) => invoke("language:stop", root),
    onDiagnostics: (callback) => subscribe("language:diagnostics", callback),
    onStatus: (callback) => subscribe("language:status", callback),
    onLog: (callback) => subscribe("language:log", callback),
    onMessage: (callback) => subscribe("language:message", callback),
    onApplyEdit: (callback) => subscribe("language:applyEdit", callback),
  },
  // What Discord is told about this session. One way out and nothing to read
  // back: the card is not state the workbench needs, and the main process
  // decides from the settings how much of this is used at all.
  presence: {
    update: (payload) => invoke("presence:update", payload),
    preview: () => invoke("presence:preview"),
  },
  polyglot: {
    status: (root) => invoke("polyglot:status", root),
    open: (payload) => invoke("polyglot:open", payload),
    change: (payload) => invoke("polyglot:change", payload),
    save: (payload) => invoke("polyglot:save", payload),
    close: (payload) => invoke("polyglot:close", payload),
    request: (payload) => invoke("polyglot:request", payload),
    cancel: (requestId) => invoke("polyglot:cancel", requestId),
    stop: (root) => invoke("polyglot:stop", root),
    install: (languageId) => invoke("polyglot:install", languageId),
    installAll: () => invoke("polyglot:installAll"),
    plan: (payload) => invoke("polyglot:plan", payload),
    execute: (payload) => invoke("polyglot:execute", payload),
    stopRun: (root) => invoke("polyglot:stopRun", root),
    onDiagnostics: (callback) => subscribe("polyglot:diagnostics", callback),
    onStatus: (callback) => subscribe("polyglot:status", callback),
    onLog: (callback) => subscribe("polyglot:log", callback),
    onOutput: (callback) => subscribe("polyglot:output", callback),
    onExit: (callback) => subscribe("polyglot:exit", callback),
  },
  // Known advisories for what the project declares.
  security: {
    scan: (root, force) => invoke("dependencies:scan", { root, force }),
  },
  // The built artefact onto the machine it runs on.
  deploy: {
    load: (root) => invoke("deploy:load", root),
    save: (root, target) => invoke("deploy:save", { root, target }),
    check: (root) => invoke("deploy:check", root),
    run: (root) => invoke("deploy:run", root),
    onLine: (callback) => subscribe("deploy:line", callback),
  },
  database: {
    find: (root) => invoke("database:find", root),
    schema: (dbPath) => invoke("database:schema", dbPath),
    query: (dbPath, sql) => invoke("database:query", { dbPath, sql }),
  },
  docker: {
    check: () => invoke("docker:check"),
    containers: (all = true) => invoke("docker:containers", all),
    images: () => invoke("docker:images"),
    containerAction: (id, action) => invoke("docker:containerAction", { id, action }),
    composeAction: (root, action) => invoke("docker:composeAction", { root, action }),
  },
  app: {
    openEditor: (root) => invoke("app:openEditor", root),
    showWelcome: () => invoke("app:showWelcome"),
    openSettings: (root) => invoke("app:openSettings", root),
    openStructure: (root) => invoke("app:openStructure", root),
    openNewProject: (initialLocation) => invoke("app:openNewProject", initialLocation),
    onSettingsContext: (callback) => subscribe("settings:context", callback),
    onWizardContext: (callback) => subscribe("wizard:context", callback),
    checkForUpdates: () => invoke("app:checkForUpdates"),
    updateState: () => invoke("app:updateState"),
    onUpdateState: (callback) => subscribe("app:updateState", callback),
    health: () => invoke("app:health"),
    openUpdate: (url) => invoke("app:openUpdate", url),
    openExternal: (url) => invoke("app:openExternal", url),
    openArtifactPage: (url) => invoke("app:openArtifactPage", url),
    downloadUpdate: (update) => invoke("app:downloadUpdate", update),
    installUpdate: (update) => invoke("app:installUpdate", update),
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
});
