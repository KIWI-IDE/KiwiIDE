const fs = require("node:fs/promises");
const path = require("node:path");

const CURRENT_SETTINGS_VERSION = 7;

/**
 * The languages the workbench has a dictionary for.
 *
 * The renderer keeps the same list in src/i18n.ts, and the two processes
 * cannot import from each other. A language missing here is quietly reset
 * to German on its way through settings, which looks from the outside
 * exactly like a missing translation — so a test compares the two lists.
 */
const LOCALES = ["de", "en", "fr", "es", "it", "nl", "pl", "pt", "hu", "tr", "ru"];

const defaults = {
  languageServers: {},
  schemaVersion: CURRENT_SETTINGS_VERSION,
  jdkPath: "",
  /** Where downloads land. Empty means Kiwi's own folder under the profile. */
  jdkInstallRoot: "",
  theme: "kiwi-new-dark",
  fontSize: 14,
  fontFamily: "JetBrains Mono, Cascadia Code, Consolas",
  lineHeight: 1.55,
  tabSize: 4,
  insertSpaces: true,
  minimap: true,
  wordWrap: false,
  autoSave: false,
  formatOnSave: false,
  organizeImportsOnSave: true,
  /** Format on save corrects the code but leaves the author's whitespace. */
  formatKeepsWhitespace: true,
  /**
   * Which characters accept the highlighted suggestion.
   *
   * A completion that commits on "." finishes a name as a method chain is
   * typed; one that commits on "(" does it as a call is opened. Which of
   * those is wanted is a matter of habit, and typing a character that commits
   * when it was not meant to is the most irritating way for a list to be
   * wrong — so it is a setting rather than a decision.
   */
  completionCommitCharacters: "(.;",
  /** Whether Enter accepts, or only Tab. */
  completionCommitOnEnter: true,
  /** Which modifier turns a click into "go to definition": "ctrl" or "alt". */
  gotoDefinitionModifier: "ctrl",
  stickyScroll: true,
  highlightActiveLine: true,
  bracketPairColorization: true,
  genericBracketColorization: true,
  inlayHints: true,
  /** The documentation bubble on hovering a name. Errors show either way. */
  hoverDocumentation: false,
  completionMode: "smart",
  terminalFontSize: 12,
  restoreSession: true,
  compactMode: true,
  uiScale: 1,
  uiDensity: "compact",
  uiRoundness: 100,
  themeShade: 0,
  themeTint: 0,
  themeContrast: 0,
  accentIntensity: 100,
  themeColorOverrides: {},
  customThemes: [],
  // Off, so nothing changes a theme somebody chose without being asked.
  themeSchedule: "off",
  themeDay: "kiwi-light",
  themeNight: "kiwi-new-dark",
  themeDayStart: 7 * 60,
  themeNightStart: 19 * 60,
  borderStrength: 100,
  shadowStrength: 100,
  uiFont: "",
  accentColor: "#7ad83b",
  backgroundImage: "",
  backgroundOpacity: 18,
  backgroundPlaylist: [],
  backgroundRotateSeconds: 0,
  // -1 follows the overall strength: one slider, not four kept in step by hand.
  backgroundEditorOpacity: -1,
  backgroundExplorerOpacity: -1,
  backgroundTerminalOpacity: -1,
  backgroundAnchor: "center",
  backgroundFit: "contain",
  backgroundScale: 100,
  backgroundBlur: 0,
  backgroundTint: 0,
  backgroundParallax: 0,
  backgroundFocusStrength: 100,
  // Off, because a video behind an editor costs battery for as long as it runs.
  backgroundAllowAnimation: false,
  reducedMotion: false,
  explorerIconSize: 15,
  explorerIndent: 13,
  fontLigatures: true,
  lineNumbers: true,
  renderWhitespace: "selection",
  breadcrumbs: true,
  javaTabSize: 4,
  xmlTabSize: 2,
  gradleTabSize: 4,
  startupBehavior: "restore",
  completionAutoPopup: true,
  completionDelay: 45,
  completionCaseSensitive: false,
  completionInsertImports: true,
  completionShowDocumentation: true,
  completionPrioritizeRecent: true,
  completionLiveTemplates: true,
  completionPostfixTemplates: true,
  completionFinishStatements: true,
  completionLocalMembers: true,
  completionShowMethods: true,
  completionShowFields: true,
  completionShowTypes: true,
  completionShowSnippets: true,
  explorerView: "folders",
  compactPackages: true,
  explorerHideBuild: false,
  explorerHideDotDirectories: true,
  explorerHideGenerated: true,
  explorerExcludedPatterns: [],
  locale: "de",
  editorColorScheme: "theme",
  editorTokenColors: {},
  explorerCollapseModulesWithProject: true,
  explorerHideFileExtensions: false,
  /** Edge the output panel is docked to: bottom, left or right. */
  panelDock: "bottom",
  /** Edge per tool window, so each tab can sit where it is useful. */
  panelViewDocks: {},
  explorerOpenMode: "single",
  /** false opens a file as a normal tab straight away, with no preview slot. */
  explorerPreviewTabs: true,
  restoreExplorerState: true,
  openConsoleOnRun: true,
  inlineDebugValues: true,
  hotSwapOnSave: true,
  breakOnExceptions: "uncaught",
  runEnvironmentTemplate: "",
  preserveConsoleOutput: false,
  rerunFailedTests: false,
  keymap: "kiwi",
  customKeybindings: {
    commandPalette: "Ctrl+Shift+P",
    searchEverywhere: "Ctrl+P",
    recentFiles: "Ctrl+E",
    classes: "Ctrl+N",
    files: "Ctrl+Shift+N",
    symbols: "Ctrl+Shift+O",
    focusMode: "Ctrl+Shift+F11",
    quickFix: "Alt+Enter",
    generate: "Alt+Insert",
    rename: "Shift+F6",
    explorerCut: "Ctrl+X",
    explorerCopy: "Ctrl+C",
    explorerPaste: "Ctrl+V",
  },
  toolbarActions: ["run", "debug", "stop", "search"],
  // New installations stay current by default. Existing users keep an
  // explicitly stored choice because migrateSettings overlays saved values.
  automaticUpdates: true,
  updateChannel: "stable",
  // Deployments may bake this into their process/service environment. Users
  // can still override it from the settings window.
  updateManifestUrl: String(process.env.KIWI_UPDATE_MANIFEST_URL || ""),
  /** Client id of a GitHub OAuth app; enables signing in through the browser. */
  githubClientId: String(process.env.KIWI_GITHUB_CLIENT_ID || ""),
  /**
   * What the accounts view manages.
   *
   * The proxy is applied to the whole session rather than to single requests,
   * so downloads, the language server and Git all go the same way. An empty
   * value means the system settings, which is what most people want and what
   * Electron does on its own.
   */
  proxyUrl: "",
  /** Hosts that go direct, in Chromium's bypass-list form. */
  proxyBypass: "",
  /** Extra CA certificates to trust, as absolute paths to PEM files. */
  extraCertificates: [],
  /** The name a CodeToGetter guest or host is shown under. */
  collabDisplayName: "",
  /**
   * What Discord is told about this session.
   *
   * Off by default, and off for good when the application id is empty: a
   * project name and a file name are the two things somebody might not want
   * on a card their whole friend list can read, so switching it on is a
   * deliberate act and each line has its own switch.
   */
  discordRichPresence: true,
  discordApplicationId: "1565832167433445486",
  discordPublicKey: "274b823814095d52c69bb51d0f7abac55457ae209a0c271ed82b22fb27d038bf",
  discordShowProject: false,
  discordShowFile: false,
  discordShowElapsed: true,
  discordState: "",
  discordDetails: "",
  discordLargeImageKey: "kiwi",
  discordLargeImageText: "Kiwi IDE",
  discordSmallImageKey: "kiwi",
  discordSmallImageText: "Kiwi IDE",
  discordPartyId: "",
  discordPartySize: 1,
  discordPartyMax: 5,
  discordJoinSecret: "",
  /**
   * Which entries the activity bar shows, and in what order.
   *
   * An empty order means the built-in one, so a new entry in a later version
   * appears for everybody who never rearranged anything. Only what somebody
   * actually moved or hid is stored.
   */
  activityOrder: [],
  activityHidden: [],
  /** How the editor itself looks, beyond the theme. */
  cursorStyle: "line",
  cursorBlinking: "blink",
  cursorBlinkMs: 1000,
  cursorAnimation: true,
  smoothScrolling: true,
  revealMotion: "smooth",
  lineHighlight: "all",
  commentFont: "",
  inlayFont: "",
  inlayFontScale: 90,
  ligatures: "on",
  fontFallbacks: "",
  minimapOpacity: 100,
  focusMaxWidth: 0,
  stickyEmphasis: 100,
  breadcrumbEmphasis: 100,
  indentGuides: true,
  /** Which side the Explorer and its neighbours sit on. */
  sidebarPosition: "left",
  /** Which tool windows the right rail offers, and in what order. */
  rightRailOrder: [],
  rightRailHidden: [],
  crashReporting: false,
  screenReaderMode: false,
  enhancedFocus: true,
  recentProjects: [],
  lastWorkspace: "",
  workspaceHistoryMigrated: false,
};

function migrateSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const migrated = { ...source };
  if (!Number.isFinite(Number(migrated.schemaVersion)) || Number(migrated.schemaVersion) < 1) {
    if (migrated.theme === "dark") migrated.theme = "kiwi-new-dark";
    if (migrated.theme === "light") migrated.theme = "kiwi-light";
    if (typeof migrated.compactMode === "boolean" && !migrated.uiDensity) {
      migrated.uiDensity = migrated.compactMode ? "compact" : "normal";
    }
  }
  if (Number(migrated.schemaVersion || 0) < 3) {
    // Build outputs used to be hidden by default, which made successful builds
    // look as if no target/build directory had been created.
    migrated.explorerHideBuild = false;
    migrated.explorerHideDotDirectories = true;
  }
  if (Number(migrated.schemaVersion || 0) < 4) {
    // The active project used to be stored only by the renderer. Keep this
    // false until that legacy history has been merged into the main state.
    migrated.workspaceHistoryMigrated = false;
  }
  if (Number(migrated.schemaVersion || 0) < 5) {
    migrated.backgroundImage = "";
    migrated.backgroundOpacity = 18;
  }
  if (Number(migrated.schemaVersion || 0) < 6) {
    const legacyKeybindings = migrated.customKeybindings && typeof migrated.customKeybindings === "object"
      ? migrated.customKeybindings
      : {};
    migrated.customKeybindings = {
      ...legacyKeybindings,
      quickFix: legacyKeybindings.quickFix || defaults.customKeybindings.quickFix,
      generate: legacyKeybindings.generate || defaults.customKeybindings.generate,
      rename: legacyKeybindings.rename || defaults.customKeybindings.rename,
      explorerCut: legacyKeybindings.explorerCut || defaults.customKeybindings.explorerCut,
      explorerCopy: legacyKeybindings.explorerCopy || defaults.customKeybindings.explorerCopy,
      explorerPaste: legacyKeybindings.explorerPaste || defaults.customKeybindings.explorerPaste,
    };
  }
  if (Number(migrated.schemaVersion || 0) < 7) {
    migrated.themeContrast = 0;
    migrated.accentIntensity = 100;
    migrated.themeColorOverrides = {};
  }
  if (migrated.discordState === "Playing Solo") migrated.discordState = "";
  if (migrated.discordDetails === "Competitive") migrated.discordDetails = "";
  if (migrated.discordLargeImageText === "Numbani") migrated.discordLargeImageText = "Kiwi IDE";
  if (migrated.discordSmallImageText === "Rogue - Level 100") migrated.discordSmallImageText = "Kiwi IDE";
  if (migrated.discordPartyId === "ae488379-351d-4a4f-ad32-2b9b01c91657") migrated.discordPartyId = "";
  if (migrated.discordJoinSecret === "MTI4NzM0OjFpMmhuZToxMjMxMjM=") migrated.discordJoinSecret = "";
  if (!migrated.discordSmallImageKey || migrated.discordSmallImageKey === "Keine") migrated.discordSmallImageKey = "kiwi";
  const allowed = Object.fromEntries(
    Object.entries(migrated).filter(([key]) => Object.hasOwn(defaults, key)),
  );
  return {
    ...defaults,
    ...allowed,
    schemaVersion: CURRENT_SETTINGS_VERSION,
    languageServers: Object.fromEntries(
      Object.entries(allowed.languageServers && typeof allowed.languageServers === "object" ? allowed.languageServers : {})
        .filter(([key, value]) => /^[a-z][a-z+-]{0,31}$/.test(key) && value && typeof value === "object")
        .map(([key, value]) => [key, {
          enabled: value.enabled !== false,
          command: typeof value.command === "string" ? value.command.trim().slice(0, 4096) : "",
          args: Array.isArray(value.args) ? value.args.filter((arg) => typeof arg === "string").slice(0, 64) : [],
        }]),
    ),
    // The renderer owns the command catalogue and fills in defaults for
    // anything unbound, so unknown ids are kept rather than dropped. Only the
    // shape is enforced here: a shortcut is a short string, "" means off.
    customKeybindings: Object.fromEntries(
      Object.entries({
        ...defaults.customKeybindings,
        ...(allowed.customKeybindings && typeof allowed.customKeybindings === "object"
          ? allowed.customKeybindings
          : {}),
      })
        .filter(([key, value]) => /^[A-Za-z][\w.]{0,63}$/.test(String(key)) && typeof value === "string")
        .map(([key, value]) => [key, String(value).trim().slice(0, 48)]),
    ),
    recentProjects: Array.isArray(allowed.recentProjects)
      ? allowed.recentProjects.map(String).filter(Boolean).slice(0, 12)
      : [],
    toolbarActions: Array.isArray(allowed.toolbarActions)
      ? allowed.toolbarActions.map(String).filter((item) => ["run", "debug", "stop", "search"].includes(item))
      : [...defaults.toolbarActions],
    jdkInstallRoot: typeof allowed.jdkInstallRoot === "string" ? allowed.jdkInstallRoot : "",
    backgroundImage: typeof allowed.backgroundImage === "string" ? allowed.backgroundImage : "",
    backgroundOpacity: Math.max(0, Math.min(100, Number(allowed.backgroundOpacity ?? defaults.backgroundOpacity) || 0)),
    // A share of the designed corner radii. Nonsense from a hand-edited file
    // would otherwise reach the stylesheet as a calc() nobody can read.
    uiRoundness: Math.max(0, Math.min(250, Number(allowed.uiRoundness ?? defaults.uiRoundness) || 0)),
    themeShade: Math.max(-40, Math.min(40, Number(allowed.themeShade ?? defaults.themeShade) || 0)),
    themeTint: Math.max(0, Math.min(30, Number(allowed.themeTint ?? defaults.themeTint) || 0)),
    themeContrast: Math.max(0, Math.min(30, Number(allowed.themeContrast ?? defaults.themeContrast) || 0)),
    accentIntensity: Math.max(0, Math.min(200, Number(allowed.accentIntensity ?? defaults.accentIntensity) || 0)),
    borderStrength: Math.max(0, Math.min(160, Number(allowed.borderStrength ?? defaults.borderStrength) || 0)),
    shadowStrength: Math.max(0, Math.min(200, Number(allowed.shadowStrength ?? defaults.shadowStrength) || 0)),
    uiFont: typeof allowed.uiFont === "string" ? allowed.uiFont.slice(0, 120) : "",
    updateChannel: ["stable", "beta", "canary"].includes(allowed.updateChannel) ? allowed.updateChannel : "stable",
    locale: LOCALES.includes(allowed.locale) ? allowed.locale : "de",
    editorColorScheme: String(allowed.editorColorScheme || "theme"),
    // Only hex values reach Monaco; anything else is dropped rather than
    // handed to defineTheme, which throws on a malformed colour.
    // Keys used to be "<themeId>.<token>"; those are discarded because the
    // colours no longer depend on the workbench theme.
    editorTokenColors: Object.fromEntries(
      Object.entries(allowed.editorTokenColors && typeof allowed.editorTokenColors === "object" ? allowed.editorTokenColors : {})
        .filter(([key, value]) => !String(key).includes(".") && /^#?[0-9a-fA-F]{6}$/.test(String(value)))
        .map(([key, value]) => [String(key), String(value).replace(/^#/, "").toUpperCase()]),
    ),
    themeColorOverrides: Object.fromEntries(
      Object.entries(allowed.themeColorOverrides && typeof allowed.themeColorOverrides === "object" ? allowed.themeColorOverrides : {})
        .filter(([key, value]) => [
          "chromeBackground", "chromeForeground", "panelBackground", "panelForeground",
          "selection", "warning", "danger", "emphasis", "editorBackground", "editorForeground",
          "editorCursor", "editorSelection", "editorLineHighlight", "editorLineNumber",
          "editorLineNumberActive", "editorWidgetBackground", "editorWidgetBorder", "editorSuggestSelected",
        ].includes(String(key)) && /^#?[0-9a-fA-F]{6}$/.test(String(value)))
        .map(([key, value]) => [String(key), String(value).replace(/^#/, "").toUpperCase()]),
    ),
  };
}

class SettingsService {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, "settings.json");
    this.state = { ...defaults };
    this.persistQueue = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.state = migrateSettings(parsed);
      if (Number(parsed.schemaVersion || 0) !== CURRENT_SETTINGS_VERSION) await this.persist();
    } catch {
      this.state = { ...defaults };
    }
    return this.state;
  }

  get() {
    return structuredClone(this.state);
  }

  async update(patch) {
    const allowed = Object.fromEntries(
      Object.entries(patch || {}).filter(([key]) => Object.hasOwn(defaults, key)),
    );
    this.state = migrateSettings({ ...this.state, ...allowed });
    await this.persist();
    return this.get();
  }

  async reset() {
    const preserved = {
      recentProjects: this.state.recentProjects,
      lastWorkspace: this.state.lastWorkspace,
      workspaceHistoryMigrated: this.state.workspaceHistoryMigrated,
    };
    this.state = migrateSettings({ ...defaults, ...preserved });
    await this.persist();
    return this.get();
  }

  async persist() {
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    this.persistQueue = this.persistQueue.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.writeFile(temporary, serialized, "utf8");
        await fs.rename(temporary, this.file);
      } finally {
        await fs.unlink(temporary).catch(() => undefined);
      }
    });
    return this.persistQueue;
  }

  async rememberWorkspace(root) {
    const recentProjects = [
      root,
      ...this.state.recentProjects.filter((item) => item !== root),
    ].slice(0, 12);
    return this.update({ lastWorkspace: root, recentProjects });
  }

  async forgetWorkspace(root) {
    const normalized = path.resolve(String(root || ""));
    const samePath = (candidate) => process.platform === "win32"
      ? path.resolve(candidate).toLocaleLowerCase() === normalized.toLocaleLowerCase()
      : path.resolve(candidate) === normalized;
    return this.update({
      recentProjects: this.state.recentProjects.filter((candidate) => !samePath(candidate)),
      lastWorkspace: this.state.lastWorkspace && samePath(this.state.lastWorkspace) ? "" : this.state.lastWorkspace,
    });
  }
}

/**
 * Which window a start should open.
 *
 * The rule lives here rather than inline in main so it can be tested: the
 * setting was stored and never read, and nothing would have noticed.
 */
function startupWindowKind(hasActiveProject, settings = {}) {
  if (!hasActiveProject) return "welcome";
  return settings.startupBehavior === "hub" ? "welcome" : "editor";
}

module.exports = {
  startupWindowKind, SettingsService, defaults, migrateSettings, CURRENT_SETTINGS_VERSION };
