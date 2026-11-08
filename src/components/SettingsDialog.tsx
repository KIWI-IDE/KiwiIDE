import { AlertTriangle, Braces, Bug, CircleCheck, Code2, Copy, Download, Files, FolderOpen, Hammer, Image as ImageIcon, Keyboard, Languages, Monitor, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, SquareTerminal, Upload, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GitHubSession, IdeSettings, JdkInfo, ProjectInfo, ProjectSettings, UpdateCheckResult } from "../types";
import { AccountsView } from "./AccountsView";
import { GitHubSignInDialog } from "./GitHubSignInDialog";
import { JdkDownloader } from "./JdkDownloader";
import {
  colorSchemes,
  findTheme,
  resolveTokenColors,
  resolveWorkbenchColors,
  themes,
  tokenGroups,
  tokenLabels,
  workbenchColorGroups,
  type TokenId,
  type WorkbenchColorId,
} from "../themes";
import { checkContrast, readableAgainst } from "../theme-contrast";
import { animationWarning } from "../workspace-background";
import { describeLineHighlight } from "../editor-feel";
import {
  duplicateName,
  formatTimeOfDay,
  parseThemeFile,
  parseTimeOfDay,
  settingsFromThemeFile,
  themeFileFrom,
  themeFileName,
} from "../theme-file";
import { isJavaKeywordTokenId, javaKeywordGroups, javaKeywordTokenId } from "../language/java-keywords";
import { hideableExtensions, jdkChoiceLabel } from "../utils";
import { versionReport, versionSummary, type KiwiBuildInfo } from "../version-info";
import { findShortcutConflicts, keybindingCatalogue, resolveKeybindings, shortcutFromEvent } from "../keybindings";
import { locales, t } from "../i18n";
import {
  StandaloneDocumentHeader,
  StandaloneWindowFooter,
  StandaloneWindowNavigation,
} from "./StandaloneWindowLayout";
import { JAVA_LANGUAGE_LEVELS } from "../language-levels";
import { parseCustomTemplates, templateFileExample } from "../language/custom-templates";
import { LanguageServersSettings } from "./LanguageServersSettings";

type Category = "java" | "languages" | "editor" | "autocomplete" | "appearance" | "build" | "explorer" | "runDebug" | "terminal" | "accounts" | "system";

/**
 * Produces the minimal Apply payload.
 *
 * The settings window can stay open while the workbench changes a
 * project-specific layout. Sending the complete snapshot from when the window
 * opened would overwrite that newer state even though the user only changed,
 * for example, the font size.
 */
export function changedSettingsPatch<T extends object>(current: T, saved: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(current) as Array<keyof T>) {
    if (JSON.stringify(current[key]) === JSON.stringify(saved[key])) continue;
    patch[key] = current[key];
  }
  return patch;
}

export function SettingsDialog({
  settings: initialSettings,
  project,
  workspaceRoot,
  onClose,
  onGlobalChange: saveGlobalSettings,
  onProjectChange: saveProjectSettings,
  onSelectGlobalJdk,
  onSelectProjectJdk,
  onResetGlobal,
  onExportSettings,
  onImportSettings,
  onCheckUpdates,
  onOpenUpdate,
  embedded = false,
}: {
  settings: IdeSettings;
  project: ProjectInfo;
  workspaceRoot: string;
  onClose: () => void;
  onGlobalChange: (patch: Partial<IdeSettings>) => void | IdeSettings | Promise<void | IdeSettings>;
  onProjectChange: (patch: Partial<ProjectSettings>) => void | ProjectSettings | Promise<void | ProjectSettings>;
  onSelectGlobalJdk: () => Promise<JdkInfo | null>;
  onSelectProjectJdk: () => Promise<JdkInfo | null>;
  onResetGlobal: () => Promise<IdeSettings>;
  onExportSettings?: () => Promise<void>;
  onImportSettings?: () => Promise<IdeSettings | null>;
  onCheckUpdates: () => Promise<UpdateCheckResult>;
  onOpenUpdate: (url: string) => void | Promise<void>;
  embedded?: boolean;
}) {
  const [category, setCategory] = useState<Category>("java");
  const [query, setQuery] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const updateReleaseUrl = updateResult?.releaseUrl;
  const manualUpdate = updateResult?.artifactKind === "appimage" || updateResult?.artifactKind === "dmg";
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  /** Why an imported file was not a theme. Cleared as soon as one is. */
  const [themeImportProblem, setThemeImportProblem] = useState("");
  const [jdks, setJdks] = useState<JdkInfo[]>([]);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [buildInfo, setBuildInfo] = useState<KiwiBuildInfo | null>(null);
  const [versionCopied, setVersionCopied] = useState(false);
  const [fontsLoading, setFontsLoading] = useState(true);
  const [fontsError, setFontsError] = useState("");
  const initialProjectSettings = useMemo<ProjectSettings>(() => project.projectSettings || {
    jdkPath: project.projectJdkPath || "",
    languageLevel: project.languageLevel || "21",
    encoding: project.encoding || "UTF-8",
    compilerArgs: project.compilerArgs || "",
    mavenOffline: Boolean(project.mavenOffline),
    gradleOffline: Boolean(project.gradleOffline),
    annotationProcessing: true,
    generatedSources: true,
    lombokSupport: true,
    unusedAnalysis: true,
    previewFeatures: false,
    autoSyncBuild: true,
    preferWrapper: true,
    parallelBuilds: true,
    cleanBeforeTest: true,
    excludedPaths: [],
    excludedLibraries: [],
    buildProfiles: [],
    backgroundImage: "",
    fontFamily: "",
    fontFallbacks: "",
  }, [project]);
  const [settings, setSettings] = useState(initialSettings);
  const [projectSettings, setProjectSettings] = useState(initialProjectSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [savedProjectSettings, setSavedProjectSettings] = useState(initialProjectSettings);
  const globalDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const projectDirty = workspaceRoot
    ? JSON.stringify(projectSettings) !== JSON.stringify(savedProjectSettings)
    : false;
  const dirty = globalDirty || projectDirty;
  const onGlobalChange = (patch: Partial<IdeSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  };
  const onProjectChange = (patch: Partial<ProjectSettings>) => {
    setProjectSettings((current) => ({ ...current, ...patch }));
  };
  const loadJdks = async () => {
    try {
      setJdks(await window.kiwi?.project.listJdks() || []);
    } catch {
      setJdks([]);
    }
  };

  useEffect(() => {
    void loadJdks();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFontsLoading(true);
    setFontsError("");
    if (!window.kiwi?.settings.listSystemFonts) {
      setFontsLoading(false);
      setFontsError("Die Liste installierter Schriften ist nicht verfügbar.");
      return () => { cancelled = true; };
    }
    void window.kiwi.settings.listSystemFonts()
      .then((fonts) => {
        if (!cancelled) setSystemFonts([...new Set(fonts)].sort((a, b) => a.localeCompare(b)));
      })
      .catch((error) => {
        if (!cancelled) setFontsError(error instanceof Error ? error.message : "Installierte Schriften konnten nicht gelesen werden.");
      })
      .finally(() => {
        if (!cancelled) setFontsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Read once, when the settings are opened: nothing here changes while they
  // are on screen, and a restart-free renderer update reopens the window.
  useEffect(() => {
    let cancelled = false;
    void window.kiwi?.app.health()
      .then((health) => { if (!cancelled) setBuildInfo(health); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (globalDirty || applying) return;
    setSettings(initialSettings);
    setSavedSettings(initialSettings);
  }, [applying, globalDirty, initialSettings]);

  useEffect(() => {
    if (projectDirty || applying) return;
    setProjectSettings(initialProjectSettings);
    setSavedProjectSettings(initialProjectSettings);
  }, [applying, initialProjectSettings, projectDirty]);

  const applySettings = async () => {
    if (!dirty || applying) return;
    setApplying(true);
    setApplyError("");
    try {
      const appliedGlobal = globalDirty
        ? await saveGlobalSettings(changedSettingsPatch(settings, savedSettings))
        : settings;
      const appliedProject = projectDirty ? await saveProjectSettings(projectSettings) : projectSettings;
      const nextSettings = appliedGlobal || settings;
      const nextProjectSettings = appliedProject || projectSettings;
      setSettings(nextSettings);
      setProjectSettings(nextProjectSettings);
      setSavedSettings(nextSettings);
      setSavedProjectSettings(nextProjectSettings);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Einstellungen konnten nicht gespeichert werden.");
    } finally {
      setApplying(false);
    }
  };

  const categories: Array<[Category, string, React.ReactNode]> = [
    ["java", "Java & SDKs", <Braces size={16} />],
    ["languages", "Sprachen & Sprachserver", <Languages size={16} />],
    ["editor", "Editor", <Code2 size={16} />],
    ["autocomplete", "Autocomplete", <WandSparkles size={16} />],
    ["appearance", "Darstellung", <Monitor size={16} />],
    ["build", "Build Tools", <Hammer size={16} />],
    ["explorer", "Explorer", <Files size={16} />],
    ["runDebug", "Run & Debug", <Bug size={16} />],
    ["terminal", "Terminal & Keymap", <SquareTerminal size={16} />],
    ["accounts", "Konten", <CircleCheck size={16} />],
    ["system", "Updates & Datenschutz", <ShieldCheck size={16} />],
  ];
  const categorySearch: Record<Category, string> = {
    java: "java sdk jdk language level lombok annotation processor generated sources",
    languages: "sprachen sprachserver language server lsp python rust go c c++ php gdscript perl lua lsp formatieren analyse linter",
    editor: "editor completion autocomplete imports format save schrift minimap inlay hover dokumentation javadoc tooltip tests definition strg alt klick sprung",
    autocomplete: "autocomplete completion delay imports documentation templates postfix methoden felder snippets semikolon anweisungen arraylist projekt-templates eigene templates live postfix kiwi templates.json",
    appearance: "darstellung theme toolbar fokus session kompakt",
    build: "build maven gradle dependency offline wrapper parallel sync exclusions",
    explorer: "explorer packages ordner build generated filter klick icons einrückung",
    runDebug: "run debug konsole exceptions inline umgebung ausgabe",
    terminal: "terminal keymap tastenkürzel shortcuts",
    accounts: "konten account github anmeldung anmelden token identität zertifikat zertifikate netzwerk vertrauen proxy codetogetter discord rich presence status aktivität spielt profil",
    system: "version über about build updates veröffentlichung datenschutz crash barrierefreiheit screenreader fokus",
  };
  /*
   * The GitHub session, read here rather than handed in.
   *
   * Settings is its own window and has no workbench state to borrow from, so
   * this page asks the bridge the same three questions the workbench used to
   * ask on its behalf: who is signed in, sign out, and add a certificate.
   */
  const [githubSession, setGithubSession] = useState<GitHubSession | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void window.kiwi?.git.githubStatus()
      .then((session) => {
        if (!cancelled) setGithubSession(session);
      })
      .catch(() => {
        if (!cancelled) setGithubSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [recordingKeybinding, setRecordingKeybinding] = useState("");
  const [keybindingQuery, setKeybindingQuery] = useState("");
  const activeKeybindings = useMemo(
    () => resolveKeybindings(settings.customKeybindings),
    [settings.customKeybindings],
  );
  const conflicts = useMemo(() => findShortcutConflicts(activeKeybindings), [activeKeybindings]);
  const visibleKeybindings = useMemo(() => {
    const needle = keybindingQuery.trim().toLocaleLowerCase();
    const grouped = new Map<string, typeof keybindingCatalogue>();
    for (const entry of keybindingCatalogue) {
      const haystack = `${entry.label} ${entry.category} ${activeKeybindings[entry.id]}`.toLocaleLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      grouped.set(entry.category, [...(grouped.get(entry.category) || []), entry]);
    }
    return [...grouped.entries()];
  }, [activeKeybindings, keybindingQuery]);

  // Resolved once per render: every swatch shows the colour the editor would
  // actually use, whether it comes from the theme, the preset or an override.
  const activeTokenColors = useMemo(
    () => resolveTokenColors(findTheme(settings.theme), settings.editorTokenColors, settings.editorColorScheme),
    [settings.editorColorScheme, settings.editorTokenColors, settings.theme],
  );
  /**
   * What to say about a moving picture.
   *
   * A laptop on battery redrawing a video behind an editor is a real cost, and
   * somebody who wants it anyway should be told once rather than stopped.
   */
  const backgroundAnimationWarning = useMemo(
    () => animationWarning(settings.backgroundImage, settings.backgroundAllowAnimation),
    [settings.backgroundAllowAnimation, settings.backgroundImage],
  );

  const activeWorkbenchColors = useMemo(
    () => resolveWorkbenchColors(findTheme(settings.theme), settings.themeColorOverrides),
    [settings.theme, settings.themeColorOverrides],
  );

  /**
   * The colour of the surface everything in the editor is drawn on.
   *
   * Every syntax token is measured against this one value, because that is
   * what it is actually read on — measuring a token against the panel colour
   * would warn about a pair nobody ever sees.
   */
  const editorBackgroundHex = activeWorkbenchColors.editorBackground;

  const contrastFindings = useMemo(() => checkContrast([
    ...tokenLabels.map(({ id, label }) => ({
      id,
      label: t(label),
      foreground: activeTokenColors[id],
      background: editorBackgroundHex,
    })),
    {
      id: "explorerForeground",
      label: t("Explorer-Text"),
      foreground: activeWorkbenchColors.explorerForeground,
      background: activeWorkbenchColors.explorerBackground,
    },
    {
      id: "terminalForeground",
      label: t("Terminal-Text"),
      foreground: activeWorkbenchColors.terminalForeground,
      background: activeWorkbenchColors.terminalBackground,
    },
    {
      id: "panelForeground",
      label: t("Text in Panels & Dialogen"),
      foreground: activeWorkbenchColors.panelForeground,
      background: activeWorkbenchColors.panelBackground,
    },
  ]), [activeTokenColors, activeWorkbenchColors, editorBackgroundHex]);
  const currentFontParts = settings.fontFamily.split(",").map((font) => font.trim()).filter(Boolean);
  const currentPrimaryFont = currentFontParts[0]?.replace(/^['"]|['"]$/g, "") || "Consolas";
  const fontOptions = systemFonts.includes(currentPrimaryFont)
    ? systemFonts
    : [currentPrimaryFont, ...systemFonts];

  const setPrimaryFont = (font: string) => {
    const remaining = currentFontParts
      .map((part) => part.replace(/^['"]|['"]$/g, ""))
      .filter((part) => part && part.toLocaleLowerCase() !== font.toLocaleLowerCase());
    const fallbacks = remaining.length ? remaining : ["Cascadia Code", "Consolas", "monospace"];
    onGlobalChange({ fontFamily: [font, ...fallbacks].join(", ") });
  };

  const renderTokenColorRow = (id: TokenId) => {
    const entry = tokenLabels.find((item) => item.id === id);
    if (!entry) return null;
    const value = `#${activeTokenColors[id]}`;
    const custom = Boolean(settings.editorTokenColors[id]);
    return (
      <label key={id} className={`token-color-row ${custom ? "customised" : ""}`}>
        <input
          type="color"
          value={value}
          aria-label={`${entry.label}: ${value}`}
          onChange={(event) => onGlobalChange({
            editorTokenColors: {
              ...settings.editorTokenColors,
              [id]: event.target.value.replace(/^#/, "").toUpperCase(),
            },
          })}
        />
        <span>{t(entry.label)}</span>
        <code style={{ color: value }}>{entry.sample}</code>
        {custom && (
          <button
            type="button"
            title={t("Diese Farbe wieder vom Theme übernehmen")}
            onClick={(event) => {
              event.preventDefault();
              const { [id]: _removed, ...rest } = settings.editorTokenColors;
              onGlobalChange({ editorTokenColors: rest });
            }}
          ><RotateCcw size={12} /></button>
        )}
      </label>
    );
  };

  const installedVersion = useMemo(
    () => versionSummary(buildInfo, __APP_VERSION__),
    [buildInfo],
  );

  const visibleCategories = categories.filter(([id, label]) =>
    !query.trim() || `${label} ${categorySearch[id]}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className={embedded ? "settings-document standalone-window-document" : "overlay settings-overlay"} onMouseDown={embedded ? undefined : onClose}>
      <div className="settings-modal settings-modal-expanded" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="settings-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <StandaloneDocumentHeader
          id="settings-dialog-title"
          icon={<Settings size={19} />}
          title={t("Einstellungen")}
          description={t("Kiwi IDE und aktuelles Projekt")}
          actions={(
            <>
            {/* One file holds the settings, the keymap and the saved layouts.
                Nothing that belongs to this machine goes into it. */}
            <button onClick={() => void onExportSettings?.()} title={t("Einstellungen exportieren")} aria-label={t("Einstellungen exportieren")}><Upload size={16} /></button>
            <button onClick={() => void onImportSettings?.().then((next) => {
              if (next) {
                setSettings(next);
                setSavedSettings(next);
              }
            })} title={t("Einstellungen importieren")} aria-label={t("Einstellungen importieren")}><Download size={16} /></button>
            <button onClick={() => void onResetGlobal().then((next) => {
              setSettings(next);
              setSavedSettings(next);
            })} title={t("Globale Einstellungen zurücksetzen")} aria-label={t("Globale Einstellungen zurücksetzen")}><RotateCcw size={16} /></button>
            <button onClick={onClose} aria-label={t("Einstellungen schließen")}><X size={17} /></button>
            </>
          )}
        />
        <div className="settings-layout">
          <StandaloneWindowNavigation label="Einstellungskategorien">
            <label className="settings-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  const first = categories.find(([id, label]) =>
                    !value.trim() || `${label} ${categorySearch[id]}`.toLowerCase().includes(value.trim().toLowerCase()),
                  );
                  if (first) setCategory(first[0]);
                }}
                placeholder={t("Einstellungen suchen")}
              />
            </label>
            {visibleCategories.map(([id, label, icon]) => (
              <button key={id} className={category === id ? "active" : ""} title={t(label)} onClick={() => setCategory(id)}>
                {icon}<span>{t(label)}</span>
              </button>
            ))}
          </StandaloneWindowNavigation>
          <div className="settings-content">
            {category === "java" && (
              <section>
                <SettingsSection title="Globale Java-Laufzeit" description="Wird verwendet, wenn ein Projekt kein eigenes SDK festlegt.">
                  <div className="settings-sdk-picker">
                    <select value={settings.jdkPath} onChange={(event) => onGlobalChange({ jdkPath: event.target.value })}>
                      <option value="">{t("Automatisch über JAVA_HOME oder PATH")}</option>
                      {settings.jdkPath && !jdks.some((jdk) => jdk.path === settings.jdkPath) && <option value={settings.jdkPath}>{settings.jdkPath}</option>}
                      {jdks.map((jdk) => <option key={jdk.path} value={jdk.path}>{jdkChoiceLabel(jdk)}</option>)}
                    </select>
                    <button className="settings-sdk-add" onClick={() => void onSelectGlobalJdk().then((selected) => {
                      if (!selected) return;
                      onGlobalChange({ jdkPath: selected.path });
                      setJdks((current) => current.some((jdk) => jdk.path === selected.path) ? current : [...current, selected]);
                    })}><FolderOpen size={14} /> {t("JDK hinzufügen…")}</button>
                    <button className="settings-sdk-refresh" onClick={loadJdks} title={t("Installierte JDKs neu erkennen")} aria-label={t("Installierte JDKs neu erkennen")}><RefreshCw size={14} /></button>
                  </div>
                  <JdkDownloader onInstalled={async (result) => {
                    await loadJdks();
                    // "Herunterladen und einrichten" must actually make the
                    // downloaded runtime the selected global SDK. It remains
                    // part of this page's draft and is persisted by Apply,
                    // which is why the downloader says so afterwards.
                    onGlobalChange({ jdkPath: result.path });
                  }} />
                </SettingsSection>
                <SettingsSection title="Project SDK" description={workspaceRoot ? t("Dieses JDK gilt ausschließlich für das geöffnete Projekt.") : t("Öffne ein Projekt, um ein Project SDK festzulegen.")}>
                  <div className="settings-sdk-picker">
                    <select value={projectSettings.jdkPath} disabled={!workspaceRoot} onChange={(event) => onProjectChange({ jdkPath: event.target.value })}>
                      <option value="">{t("Globales SDK verwenden")}</option>
                      {projectSettings.jdkPath && !jdks.some((jdk) => jdk.path === projectSettings.jdkPath) && <option value={projectSettings.jdkPath}>{projectSettings.jdkPath}</option>}
                      {jdks.map((jdk) => <option key={jdk.path} value={jdk.path}>{jdkChoiceLabel(jdk)}</option>)}
                    </select>
                    <button className="settings-sdk-add" disabled={!workspaceRoot} onClick={() => void onSelectProjectJdk().then((selected) => {
                      if (!selected) return;
                      onProjectChange({ jdkPath: selected.path });
                      setJdks((current) => current.some((jdk) => jdk.path === selected.path) ? current : [...current, selected]);
                    })}><FolderOpen size={14} /> {t("JDK hinzufügen…")}</button>
                  </div>
                  <small className="settings-sdk-effective">{t("Effektiv")}: {projectSettings.jdkPath || project.jdkPath || settings.jdkPath || "JAVA_HOME / PATH"}</small>
                </SettingsSection>
                <SettingsRow title="Java Language Level" description="Steuert --release, Maven Compiler und die Gradle Toolchain.">
                  <select value={projectSettings.languageLevel} disabled={!workspaceRoot} onChange={(event) => void onProjectChange({ languageLevel: event.target.value })}>
                    {JAVA_LANGUAGE_LEVELS.map((version) => <option key={version} value={version}>Java {version}</option>)}
                  </select>
                </SettingsRow>
                <SettingsRow title="Quelltext-Encoding" description="Encoding für Javac und neue Projektdateien.">
                  <select value={projectSettings.encoding} disabled={!workspaceRoot} onChange={(event) => void onProjectChange({ encoding: event.target.value })}>
                    <option value="UTF-8">{t("UTF-8")}</option>
                    <option value="ISO-8859-1">{t("ISO-8859-1")}</option>
                    <option value="windows-1252">{t("Windows-1252")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Zusätzliche Compiler-Argumente" description="Werden beim Plain-Java-Build an Javac übergeben.">
                  <input className="settings-wide-input" value={projectSettings.compilerArgs} disabled={!workspaceRoot} onChange={(event) => void onProjectChange({ compilerArgs: event.target.value })} placeholder={t("-Xlint:all -parameters")} />
                </SettingsRow>
                <ToggleRow title="Annotation Processing" description="Aktiviert generierten Code aus MapStruct, Dagger und weiteren Prozessoren." checked={projectSettings.annotationProcessing} disabled={!workspaceRoot} onChange={(annotationProcessing) => void onProjectChange({ annotationProcessing })} />
                <ToggleRow title="Lombok-Unterstützung" description="Startet JDT LS automatisch mit einem lokal gefundenen Lombok-Agenten." checked={projectSettings.lombokSupport} disabled={!workspaceRoot} onChange={(lombokSupport) => void onProjectChange({ lombokSupport })} />
                <ToggleRow title="Generierte Sources indexieren" description="Bezieht vom Build-Werkzeug registrierte generierte Quellordner in Navigation und Completion ein." checked={projectSettings.generatedSources} disabled={!workspaceRoot} onChange={(generatedSources) => void onProjectChange({ generatedSources })} />
                <ToggleRow title="Unused-Code-Analyse" description="Zeigt unbenutzte Imports, private Member und Abhängigkeiten als Hinweise." checked={projectSettings.unusedAnalysis} disabled={!workspaceRoot} onChange={(unusedAnalysis) => void onProjectChange({ unusedAnalysis })} />
                <div className="settings-runtime-card"><Braces size={18} /><span><strong>{project.jdkMajor ? `JDK ${project.jdkMajor}` : t("Kein JDK erkannt")}</strong><small>{project.javaVersion || t("JDK 21 oder neuer für JDT LS erforderlich")}</small></span></div>
              </section>
            )}

            {category === "languages" && (
              <LanguageServersSettings
                root={workspaceRoot}
                configuration={settings.languageServers || {}}
                onChange={(languageServers) => void onGlobalChange({ languageServers })}
              />
            )}

            {category === "editor" && (
              <section>
                <SettingsRow title="Schriftgröße" description="Schriftgröße des Code-Editors.">
                  <NumberControl value={settings.fontSize} min={10} max={28} suffix="px" onChange={(fontSize) => void onGlobalChange({ fontSize })} />
                </SettingsRow>
                <SettingsRow title="Schriftart" description="Installierte Schrift auswählen; vorhandene Fallbacks bleiben erhalten.">
                  <div className="settings-font-picker">
                    <select
                      className="settings-wide-input"
                      value={currentPrimaryFont}
                      disabled={fontsLoading && fontOptions.length === 0}
                      onChange={(event) => setPrimaryFont(event.target.value)}
                    >
                      {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
                      {fontsLoading && <option value="" disabled>Installierte Schriften werden geladen …</option>}
                    </select>
                    <small className={fontsError ? "error" : ""}>
                      {fontsError || (fontsLoading
                        ? "Windows-Schriften werden geladen …"
                        : `Fallbacks: ${currentFontParts.slice(1).join(", ") || "Cascadia Code, Consolas, monospace"}`)}
                    </small>
                  </div>
                </SettingsRow>
                <SettingsRow title="Zeilenhöhe" description="Abstand zwischen Codezeilen.">
                  <select value={settings.lineHeight} onChange={(event) => void onGlobalChange({ lineHeight: Number(event.target.value) })}>
                    <option value="1.35">{t("Kompakt")}</option><option value="1.55">{t("Normal")}</option><option value="1.75">{t("Großzügig")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Tabulatorgröße" description="Einrückung neuer Zeilen.">
                  <select value={settings.tabSize} onChange={(event) => void onGlobalChange({ tabSize: Number(event.target.value) })}>
                    <option value="2">{t("2 Spaces")}</option><option value="4">{t("4 Spaces")}</option><option value="8">{t("8 Spaces")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Tabs nach Dateityp" description="Java, XML und Gradle können unterschiedliche Einrückungen verwenden.">
                  <div className="settings-inline-controls">
                    <label>{t("Java")} <input type="number" min="2" max="8" value={settings.javaTabSize} onChange={(event) => void onGlobalChange({ javaTabSize: Number(event.target.value) })} /></label>
                    <label>{t("XML")} <input type="number" min="2" max="8" value={settings.xmlTabSize} onChange={(event) => void onGlobalChange({ xmlTabSize: Number(event.target.value) })} /></label>
                    <label>{t("Gradle")} <input type="number" min="2" max="8" value={settings.gradleTabSize} onChange={(event) => void onGlobalChange({ gradleTabSize: Number(event.target.value) })} /></label>
                  </div>
                </SettingsRow>
                <ToggleRow title="Font-Ligaturen" description="Programmier-Ligaturen der gewählten Schriftart verwenden." checked={settings.fontLigatures} onChange={(fontLigatures) => void onGlobalChange({ fontLigatures })} />
                <ToggleRow title="Zeilennummern" description="Zeilennummern am linken Editor-Rand anzeigen." checked={settings.lineNumbers} onChange={(lineNumbers) => void onGlobalChange({ lineNumbers })} />
                <SettingsRow title="Whitespace" description="Leerzeichen und Tabulatoren im Editor sichtbar machen.">
                  <select value={settings.renderWhitespace} onChange={(event) => void onGlobalChange({ renderWhitespace: event.target.value as IdeSettings["renderWhitespace"] })}>
                    <option value="none">{t("Aus")}</option><option value="selection">{t("Nur Auswahl")}</option><option value="all">{t("Immer")}</option>
                  </select>
                </SettingsRow>
                <ToggleRow title="Minimap" description="Code-Vorschau am rechten Rand." checked={settings.minimap} onChange={(minimap) => void onGlobalChange({ minimap })} />
                <ToggleRow title="Zeilenumbruch" description="Lange Zeilen an der Editorbreite umbrechen." checked={settings.wordWrap} onChange={(wordWrap) => void onGlobalChange({ wordWrap })} />
                <ToggleRow title="Sticky Scroll" description="Aktuellen Klassen- und Methodenkontext oben halten." checked={settings.stickyScroll} onChange={(stickyScroll) => void onGlobalChange({ stickyScroll })} />
                <ToggleRow title="Aktuelle Zeile hervorheben" description="Die Zeile, in der der Cursor steht, einfärben." checked={settings.highlightActiveLine !== false} onChange={(highlightActiveLine) => void onGlobalChange({ highlightActiveLine })} />
                <ToggleRow title="Breadcrumbs" description="Projekt, Modul, Package, Klasse und Methode über dem Editor anzeigen." checked={settings.breadcrumbs} onChange={(breadcrumbs) => void onGlobalChange({ breadcrumbs })} />
                <ToggleRow title="Bracket Pair Colorization" description="Zusammengehörige Klammern farblich markieren." checked={settings.bracketPairColorization} onChange={(bracketPairColorization) => void onGlobalChange({ bracketPairColorization })} />
                <ToggleRow title="Format on Save" description="Dateien beim Speichern automatisch formatieren (Java, TypeScript, JavaScript, JSON, CSS, Python etc.)." checked={settings.formatOnSave} onChange={(formatOnSave) => void onGlobalChange({ formatOnSave })} />
                {settings.formatOnSave && (
                  <ToggleRow
                    title="Eigenen Whitespace behalten"
                    description="Der Formatierer korrigiert den Code, aber Einrückung, Leerzeilen und Leerzeichen am Zeilenende bleiben so, wie sie geschrieben wurden."
                    checked={settings.formatKeepsWhitespace !== false}
                    onChange={(formatKeepsWhitespace) => void onGlobalChange({ formatKeepsWhitespace })}
                  />
                )}
                <SettingsRow
                  title="Gehe zu Definition mit"
                  description="Welche Taste aus einem Klick einen Sprung zur Definition macht. Die jeweils andere setzt einen zusätzlichen Cursor."
                >
                  <select
                    value={settings.gotoDefinitionModifier || "ctrl"}
                    onChange={(event) => void onGlobalChange({ gotoDefinitionModifier: event.target.value as "ctrl" | "alt" })}
                  >
                    <option value="ctrl">{t("Strg + Klick")}</option>
                    <option value="alt">{t("Alt + Klick")}</option>
                  </select>
                </SettingsRow>
                <ToggleRow title="Organize Imports on Save" description="Entfernt unbenutzte Imports und übernimmt die JDT-Importreihenfolge." checked={settings.organizeImportsOnSave} onChange={(organizeImportsOnSave) => void onGlobalChange({ organizeImportsOnSave })} />
                <ToggleRow title="Auto Save" description="Änderungen nach kurzer Verzögerung speichern." checked={settings.autoSave} onChange={(autoSave) => void onGlobalChange({ autoSave })} />
                <ToggleRow title="Fehlgeschlagene Tests erneut ausführen" description="Bietet nach einem Testlauf einen direkten Rerun der fehlgeschlagenen Tests an." checked={settings.rerunFailedTests} onChange={(rerunFailedTests) => void onGlobalChange({ rerunFailedTests })} />
              </section>
            )}

            {category === "autocomplete" && (
              <section>
                <ToggleRow title="Completion automatisch öffnen" description="Vorschläge beim Tippen und an Trigger-Zeichen anzeigen." checked={settings.completionAutoPopup} onChange={(completionAutoPopup) => void onGlobalChange({ completionAutoPopup })} />
                <SettingsRow title="Öffnungsverzögerung" description="Wartezeit vor automatischen Vorschlägen. Strg+Leertaste öffnet immer sofort.">
                  <NumberControl value={settings.completionDelay} min={0} max={1000} suffix="ms" onChange={(completionDelay) => void onGlobalChange({ completionDelay })} />
                </SettingsRow>
                <ToggleRow title="Groß-/Kleinschreibung beachten" description="Completion-Treffer strikt nach Schreibweise filtern." checked={settings.completionCaseSensitive} onChange={(completionCaseSensitive) => void onGlobalChange({ completionCaseSensitive })} />
                <ToggleRow title="Auto-Imports übernehmen" description="Von JDT LS gelieferte Imports mit dem Completion-Treffer anwenden." checked={settings.completionInsertImports} onChange={(completionInsertImports) => void onGlobalChange({ completionInsertImports })} />
                <ToggleRow title="Dokumentation anzeigen" description="Javadoc und Signaturen im Vorschlagsfenster einblenden." checked={settings.completionShowDocumentation} onChange={(completionShowDocumentation) => void onGlobalChange({ completionShowDocumentation })} />
                <ToggleRow title="Häufig gewählte Vorschläge priorisieren" description="Lokal gewählte Treffer beim nächsten Mal höher sortieren." checked={settings.completionPrioritizeRecent} onChange={(completionPrioritizeRecent) => void onGlobalChange({ completionPrioritizeRecent })} />
                <ToggleRow title="Live Templates" description="Vorlagen wie psvm, sout, iter und try anbieten." checked={settings.completionLiveTemplates} onChange={(completionLiveTemplates) => void onGlobalChange({ completionLiveTemplates })} />
                <ToggleRow title="Postfix Templates" description="Ausdrücke mit .if, .not, .for, .return oder .sout umformen." checked={settings.completionPostfixTemplates} onChange={(completionPostfixTemplates) => void onGlobalChange({ completionPostfixTemplates })} />
                <ToggleRow title="Anweisungen fertigstellen" description="new ArrayList wird zu new ArrayList<>(), und Enter setzt am Ende einer vollständigen Zeile das fehlende Semikolon." checked={settings.completionFinishStatements} onChange={(completionFinishStatements) => void onGlobalChange({ completionFinishStatements })} />
                <SettingsRow
                  title="Vorschlag übernehmen mit"
                  description="Zeichen, die den markierten Vorschlag annehmen. Leer lassen, damit nur Tab und Enter übernehmen."
                >
                  <input
                    value={settings.completionCommitCharacters ?? "(.;"}
                    placeholder="(.;"
                    spellCheck={false}
                    onChange={(event) => void onGlobalChange({ completionCommitCharacters: event.target.value })}
                  />
                </SettingsRow>
                <ToggleRow
                  title="Enter übernimmt einen Vorschlag"
                  description="Aus: Enter macht immer eine neue Zeile, und nur Tab übernimmt."
                  checked={settings.completionCommitOnEnter !== false}
                  onChange={(completionCommitOnEnter) => void onGlobalChange({ completionCommitOnEnter })}
                />
                <ToggleRow title="Methoden der offenen Datei" description="Methoden und Felder aus der Datei selbst vorschlagen, auch bevor der Sprachserver sie gesehen hat, und beim Schreiben einer Deklaration passende Methodennamen anbieten." checked={settings.completionLocalMembers} onChange={(completionLocalMembers) => void onGlobalChange({ completionLocalMembers })} />
                <SettingsRow title="Vorschlagsarten" description="Bestimme, welche Arten im Completion-Fenster erscheinen.">
                  <div className="toolbar-settings">
                    {([
                      ["completionShowMethods", "Methoden"],
                      ["completionShowFields", "Felder"],
                      ["completionShowTypes", "Klassen & Typen"],
                      ["completionShowSnippets", "Snippets"],
                    ] as Array<[keyof IdeSettings, string]>).map(([key, label]) => (
                      <label key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => void onGlobalChange({ [key]: event.target.checked })} />{label}</label>
                    ))}
                  </div>
                </SettingsRow>
                <ProjectTemplatesPanel workspaceRoot={workspaceRoot} />
              </section>
            )}

            {category === "appearance" && (
              <section>
                <SettingsRow title="Seitenleiste" description="Auf welcher Seite Explorer, Suche und die übrigen Toolfenster stehen.">
                  <select
                    value={settings.sidebarPosition || "left"}
                    onChange={(event) => void onGlobalChange({ sidebarPosition: event.target.value as "left" | "right" })}
                  >
                    <option value="left">{t("Links")}</option>
                    <option value="right">{t("Rechts")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Cursor" description="Form und Blinken der Schreibmarke.">
                  <select
                    value={settings.cursorStyle || "line"}
                    onChange={(event) => void onGlobalChange({ cursorStyle: event.target.value as never })}
                  >
                    <option value="line">{t("Strich")}</option>
                    <option value="block">{t("Block")}</option>
                    <option value="underline">{t("Unterstrich")}</option>
                  </select>
                  <select
                    value={settings.cursorBlinking || "blink"}
                    onChange={(event) => void onGlobalChange({ cursorBlinking: event.target.value as never })}
                  >
                    <option value="blink">{t("Blinkend")}</option>
                    <option value="smooth">{t("Weich")}</option>
                    <option value="phase">{t("Pulsierend")}</option>
                    <option value="expand">{t("Aufklappend")}</option>
                    <option value="solid">{t("Ruhig")}</option>
                  </select>
                </SettingsRow>
                <ToggleRow
                  title="Einrückungslinien"
                  description="Senkrechte Linien auf jeder Einrückungsebene."
                  checked={settings.indentGuides !== false}
                  onChange={(indentGuides) => void onGlobalChange({ indentGuides })}
                />
                <SettingsRow title="Theme" description="Färbt Workbench und Editor gemeinsam ein.">
                  <select value={settings.theme} onChange={(event) => void onGlobalChange({ theme: event.target.value })}>
                    {["Dunkel", "Hell"].map((group) => (
                      <optgroup key={group} label={group}>
                        {themes.filter((theme) => theme.group === group).map((theme) => (
                          <option key={theme.id} value={theme.id}>{theme.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </SettingsRow>
                {settings.customThemes.length > 0 && (
                  <SettingsRow
                    title="Eigene Themes"
                    description="Gespeicherte, importierte und duplizierte Themes. Anwenden setzt Basis und alle Farben."
                  >
                    <div className="custom-theme-list">
                      {settings.customThemes.map((entry) => (
                        <div className="custom-theme-row" key={entry.name}>
                          <span>{entry.name}</span>
                          <button
                            type="button"
                            onClick={() => void onGlobalChange(settingsFromThemeFile(entry))}
                          >{t("Anwenden")}</button>
                          <button
                            type="button"
                            onClick={() => void window.kiwi?.settings
                              .exportTheme(themeFileName(entry.name), JSON.stringify(entry, null, 2))
                              .catch(() => undefined)}
                          >{t("Exportieren")}</button>
                          <button
                            type="button"
                            aria-label={`${t("Löschen")}: ${entry.name}`}
                            onClick={() => void onGlobalChange({
                              customThemes: settings.customThemes.filter((item) => item.name !== entry.name),
                            })}
                          ><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                  </SettingsRow>
                )}
                <SettingsRow
                  title="Theme sichern und teilen"
                  description="Als .kiwi-theme.json speichern, eines übernehmen, oder eine Variante zum Ausprobieren anlegen."
                >
                  <div className="theme-file-actions">
                    <button
                      type="button"
                      onClick={() => {
                        // Duplicating keeps the original: trying a variant must
                        // not be a way to lose an evening's work.
                        const name = duplicateName(
                          findTheme(settings.theme).label,
                          settings.customThemes.map((entry) => entry.name),
                        );
                        void onGlobalChange({
                          customThemes: [...settings.customThemes, themeFileFrom(settings, name)],
                        });
                      }}
                    ><Copy size={13} /> {t("Duplizieren")}</button>
                    <button
                      type="button"
                      onClick={() => {
                        const file = themeFileFrom(settings, findTheme(settings.theme).label);
                        void window.kiwi?.settings
                          .exportTheme(themeFileName(file.name), JSON.stringify(file, null, 2))
                          .catch(() => undefined);
                      }}
                    ><Upload size={13} /> {t("Exportieren")}</button>
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        const text = await window.kiwi?.settings.importTheme().catch(() => "");
                        if (!text) return;
                        const file = parseThemeFile(text, themes.map((entry) => entry.id));
                        if (!file) {
                          setThemeImportProblem(t("Die Datei ist kein Kiwi-Theme."));
                          return;
                        }
                        setThemeImportProblem("");
                        // Applied and kept: somebody importing a theme wants to
                        // see it, and wants to find it again tomorrow.
                        void onGlobalChange({
                          ...settingsFromThemeFile(file),
                          customThemes: [
                            ...settings.customThemes.filter((entry) => entry.name !== file.name),
                            file,
                          ],
                        });
                      })()}
                    ><Download size={13} /> {t("Importieren")}</button>
                  </div>
                </SettingsRow>
                {themeImportProblem && <p className="settings-inline-error">{themeImportProblem}</p>}
                <SettingsRow
                  title="Theme automatisch wechseln"
                  description="Nach Windows-Modus oder nach Uhrzeit. Aus bedeutet: das gewählte Theme bleibt."
                >
                  <select
                    value={settings.themeSchedule}
                    onChange={(event) => void onGlobalChange({
                      themeSchedule: event.target.value as IdeSettings["themeSchedule"],
                    })}
                  >
                    <option value="off">{t("Aus")}</option>
                    <option value="system">{t("Nach Windows-Modus")}</option>
                    <option value="time">{t("Nach Uhrzeit")}</option>
                  </select>
                </SettingsRow>
                {settings.themeSchedule !== "off" && (
                  <div className="theme-schedule-grid">
                    <label>
                      <span>{t("Helles Theme")}</span>
                      <select
                        value={settings.themeDay}
                        onChange={(event) => void onGlobalChange({ themeDay: event.target.value })}
                      >
                        {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>{t("Dunkles Theme")}</span>
                      <select
                        value={settings.themeNight}
                        onChange={(event) => void onGlobalChange({ themeNight: event.target.value })}
                      >
                        {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                      </select>
                    </label>
                    {settings.themeSchedule === "time" && (
                      <>
                        <label>
                          <span>{t("Hell ab")}</span>
                          <input
                            type="time"
                            value={formatTimeOfDay(settings.themeDayStart)}
                            onChange={(event) => {
                              const minutes = parseTimeOfDay(event.target.value);
                              if (minutes >= 0) void onGlobalChange({ themeDayStart: minutes });
                            }}
                          />
                        </label>
                        <label>
                          <span>{t("Dunkel ab")}</span>
                          <input
                            type="time"
                            value={formatTimeOfDay(settings.themeNightStart)}
                            onChange={(event) => {
                              const minutes = parseTimeOfDay(event.target.value);
                              if (minutes >= 0) void onGlobalChange({ themeNightStart: minutes });
                            }}
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
                <details className="token-color-details theme-adjust-details">
                  <summary>
                    Theme nachjustieren
                    {(settings.themeShade !== 0 || settings.themeTint !== 0 || settings.themeContrast !== 0
                      || settings.accentIntensity !== 100 || Object.keys(settings.themeColorOverrides).length > 0) && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          onGlobalChange({
                            themeShade: 0,
                            themeTint: 0,
                            themeContrast: 0,
                            accentIntensity: 100,
                            themeColorOverrides: {},
                          });
                        }}
                      >{t("Zurücksetzen")}</button>
                    )}
                  </summary>
                  <p className="theme-adjust-description">Hebt oder senkt Helligkeit und Kontrast, steuert die Stärke aktiver Flächen und erlaubt gezielte Oberflächenfarben.</p>
                  <div className="theme-adjust-control">
                    <label>
                      <span>{t("Helligkeit")}</span>
                      <input
                        type="range"
                        min="-40"
                        max="40"
                        step="5"
                        value={settings.themeShade}
                        onChange={(event) => void onGlobalChange({ themeShade: Number(event.target.value) })}
                      />
                      <small>{settings.themeShade > 0 ? `+${settings.themeShade}` : settings.themeShade} %</small>
                    </label>
                    <label>
                      <span>{t("Tönung")}</span>
                      <input
                        type="range"
                        min="0"
                        max="30"
                        step="2"
                        value={settings.themeTint}
                        onChange={(event) => void onGlobalChange({ themeTint: Number(event.target.value) })}
                      />
                      <small>{settings.themeTint} %</small>
                    </label>
                    <label>
                      <span>{t("Kontrast")}</span>
                      <input
                        type="range"
                        min="0"
                        max="30"
                        step="2"
                        value={settings.themeContrast}
                        onChange={(event) => onGlobalChange({ themeContrast: Number(event.target.value) })}
                      />
                      <small>{settings.themeContrast} %</small>
                    </label>
                    <label>
                      <span>Akzentstärke</span>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        step="10"
                        value={settings.accentIntensity}
                        onChange={(event) => onGlobalChange({ accentIntensity: Number(event.target.value) })}
                      />
                      <small>{settings.accentIntensity} %</small>
                    </label>
                  </div>
                  {contrastFindings.length > 0 && (
                    /* The swatch shows a colour alone; what matters is the
                       pair. A warning beside the control that caused it, never
                       a refusal — the colour is theirs. */
                    <div className="contrast-findings">
                      <header>
                        <AlertTriangle size={13} />
                        {t("Schwer lesbare Kombinationen")}
                      </header>
                      {contrastFindings.slice(0, 6).map((finding) => (
                        <div key={finding.id} className={`contrast-finding ${finding.verdict}`}>
                          <span>{finding.message}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              const fixed = readableAgainst(
                                finding.id in activeWorkbenchColors
                                  ? activeWorkbenchColors[finding.id as WorkbenchColorId]
                                  : activeTokenColors[finding.id as TokenId],
                                editorBackgroundHex,
                              );
                              if (!fixed) return;
                              if (finding.id in activeWorkbenchColors) {
                                void onGlobalChange({
                                  themeColorOverrides: { ...settings.themeColorOverrides, [finding.id]: fixed },
                                });
                              } else {
                                void onGlobalChange({
                                  editorTokenColors: { ...settings.editorTokenColors, [finding.id]: fixed },
                                });
                              }
                            }}
                          >{t("Lesbar machen")}</button>
                        </div>
                      ))}
                      {contrastFindings.length > 6 && (
                        <small>{contrastFindings.length - 6} {t("weitere")}</small>
                      )}
                    </div>
                  )}
                  <div className="workbench-color-groups">
                    {workbenchColorGroups.map((group) => (
                      <details key={group.id} className="token-color-subdetails">
                        <summary>{t(group.label)}</summary>
                        <div className="token-color-grid">
                          {group.colors.map(({ id, label }) => {
                            const value = `#${activeWorkbenchColors[id]}`;
                            const custom = Boolean(settings.themeColorOverrides[id]);
                            return (
                              <label key={id} className={`token-color-row ${custom ? "customised" : ""}`}>
                                <input
                                  type="color"
                                  value={value}
                                  aria-label={`${label}: ${value}`}
                                  onChange={(event) => onGlobalChange({
                                    themeColorOverrides: {
                                      ...settings.themeColorOverrides,
                                      [id]: event.target.value.replace(/^#/, "").toUpperCase(),
                                    },
                                  })}
                                />
                                <span>{t(label)}</span>
                                <code style={{ color: value }}>{value.toUpperCase()}</code>
                                {custom && (
                                  <button
                                    type="button"
                                    title={t("Diese Farbe wieder vom Theme übernehmen")}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      const { [id]: _removed, ...rest } = settings.themeColorOverrides;
                                      onGlobalChange({ themeColorOverrides: rest });
                                    }}
                                  ><RotateCcw size={12} /></button>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
                <SettingsRow title="Sprache" description="Sprache der Oberfläche. Nicht übersetzte Texte bleiben auf Deutsch.">
                  <select value={settings.locale} onChange={(event) => void onGlobalChange({ locale: event.target.value as IdeSettings["locale"] })}>
                    {locales.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                </SettingsRow>
                <SettingsRow title="Editor-Farben" description="Syntaxfarben des Editors, unabhängig vom gewählten Theme. Einzelne Farben lassen sich darunter überschreiben.">
                  <select value={settings.editorColorScheme} onChange={(event) => void onGlobalChange({ editorColorScheme: event.target.value })}>
                    {colorSchemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.label}</option>)}
                  </select>
                </SettingsRow>
                <details className="token-color-details">
                  <summary>
                    Einzelne Farben anpassen
                    {Object.keys(settings.editorTokenColors).length > 0 && (
                      <button
                        onClick={(event) => {
                          event.preventDefault();
                          void onGlobalChange({ editorTokenColors: {} });
                        }}
                      >
                        Zurücksetzen
                      </button>
                    )}
                  </summary>
                  {tokenGroups.map((group) => {
                    const generalMembers = group.members.filter((member) => !isJavaKeywordTokenId(member));
                    const groupValue = `#${activeTokenColors[group.id]}`;
                    const groupCustom = Boolean(settings.editorTokenColors[group.id])
                      || group.members.some((member) => settings.editorTokenColors[member]);
                    const groupLabel = tokenLabels.find((entry) => entry.id === group.id)?.label || group.id;
                    // How many in this family were given a colour of their own,
                    // so it is visible that the family colour is not the whole
                    // story before somebody wonders why one of them differs.
                    const ownColourCount = group.members.filter((member) => settings.editorTokenColors[member]).length;
                    return (
                      <div className="token-color-group" key={group.id}>
                        <div className="token-color-group-head">
                          {/* Sets the family. Every colour below follows it
                              unless it was given one of its own — so colouring
                              the whole group no longer throws away the ones
                              somebody deliberately made different. */}
                          <label>
                            <input
                              type="color"
                              value={groupValue}
                              aria-label={`Ganze Gruppe ${t(groupLabel)} einfärben`}
                              onChange={(event) => onGlobalChange({
                                editorTokenColors: {
                                  ...settings.editorTokenColors,
                                  [group.id]: event.target.value.replace(/^#/, "").toUpperCase(),
                                },
                              })}
                            />
                            <strong>{t(groupLabel)}</strong>
                            <small>
                              {group.members.length + 1} Farben
                              {ownColourCount > 0 && ` · ${ownColourCount} ${t("eigene")}`}
                            </small>
                          </label>
                          {groupCustom && (
                            <button
                              type="button"
                              title={t("Diese Gruppe wieder vom Theme übernehmen")}
                              onClick={(event) => {
                                event.preventDefault();
                                const next = { ...settings.editorTokenColors };
                                delete next[group.id];
                                for (const member of group.members) delete next[member];
                                onGlobalChange({ editorTokenColors: next });
                              }}
                            ><RotateCcw size={12} /></button>
                          )}
                        </div>
                        <div className="token-color-grid">
                          {generalMembers.map(renderTokenColorRow)}
                        </div>
                        {group.id === "keyword" && (
                          <details className="token-color-subdetails java-keyword-color-details">
                            <summary>Java-Schlüsselwörter einzeln ({javaKeywordGroups.reduce((sum, item) => sum + item.words.length, 0)})</summary>
                            {javaKeywordGroups.map((keywordGroup) => (
                              <section key={keywordGroup.id} className="java-keyword-color-group">
                                <h4>{t(keywordGroup.label)}</h4>
                                <div className="token-color-grid">
                                  {keywordGroup.words.map((word) => renderTokenColorRow(javaKeywordTokenId(word)))}
                                </div>
                              </section>
                            ))}
                          </details>
                        )}
                      </div>
                    );
                  })}
                </details>
                <SettingsRow title="UI-Skalierung" description="Skaliert die gesamte Workbench unabhängig von der Editor-Schrift.">
                  <select value={settings.uiScale} onChange={(event) => void onGlobalChange({ uiScale: Number(event.target.value) })}>
                    {[0.85, 0.9, 1, 1.1, 1.25, 1.5].map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)} %</option>)}
                  </select>
                </SettingsRow>
                <SettingsRow title="Oberflächendichte" description="Abstände und Höhen für kleine oder große Displays.">
                  <select value={settings.uiDensity} onChange={(event) => void onGlobalChange({ uiDensity: event.target.value as IdeSettings["uiDensity"], compactMode: event.target.value === "compact" })}>
                    <option value="compact">{t("Kompakt")}</option><option value="normal">{t("Normal")}</option><option value="comfortable">{t("Komfort")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Ecken" description="Wie rund Fenster, Knöpfe und Felder sind. 0 % ist kantig, 200 % deutlich runder als die Vorgabe.">
                  <div className="settings-opacity-control">
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="10"
                      value={settings.uiRoundness}
                      aria-label={t("Rundung der Ecken")}
                      onChange={(event) => void onGlobalChange({ uiRoundness: Number(event.target.value) })}
                    />
                    <span>{settings.uiRoundness} %</span>
                  </div>
                </SettingsRow>
                <SettingsRow title="Trennlinien" description="Wie deutlich Panels, Felder und Menüs voneinander abgesetzt sind. 0 % zeichnet keine Linien, 160 % trennt streng.">
                  <div className="settings-opacity-control">
                    <input
                      type="range"
                      min="0"
                      max="160"
                      step="10"
                      value={settings.borderStrength}
                      aria-label="Stärke der Trennlinien"
                      onChange={(event) => void onGlobalChange({ borderStrength: Number(event.target.value) })}
                    />
                    <span>{settings.borderStrength} %</span>
                  </div>
                </SettingsRow>
                <SettingsRow title="Schatten" description="Tiefe der Schatten unter Menüs und Dialogen. 0 % legt sie flach auf die Oberfläche.">
                  <div className="settings-opacity-control">
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="10"
                      value={settings.shadowStrength}
                      aria-label="Tiefe der Schatten"
                      onChange={(event) => void onGlobalChange({ shadowStrength: Number(event.target.value) })}
                    />
                    <span>{settings.shadowStrength} %</span>
                  </div>
                </SettingsRow>
                <SettingsRow title="Oberflächenschrift" description="Schrift der Bedienoberfläche, unabhängig von der Editor-Schrift. Leer verwendet die mitgelieferte Schrift.">
                  <select value={settings.uiFont} onChange={(event) => void onGlobalChange({ uiFont: event.target.value })}>
                    <option value="">Kiwi (Inter)</option>
                    <option value="Segoe UI">Segoe UI</option>
                    <option value="system-ui">System</option>
                    <option value="Georgia">Georgia</option>
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Consolas">Consolas</option>
                  </select>
                </SettingsRow>
                <ToggleRow
                  title="Generics mitfärben"
                  description="Auch die spitzen Klammern verschachtelter Generics einfärben. Nur dort, wo sie sicher ein Typargument sind — ein Vergleich bleibt farblos."
                  checked={settings.genericBracketColorization}
                  onChange={(genericBracketColorization) => void onGlobalChange({ genericBracketColorization })}
                />
                <SettingsRow
                  title="Schreibmarke"
                  description="Wie schnell sie blinkt und ob sie zwischen Positionen gleitet. 0 ms lässt sie stehen."
                >
                  <div className="feel-grid">
                    <label>
                      <span>{t("Blinken")}</span>
                      <NumberControl
                        value={settings.cursorBlinkMs}
                        min={0}
                        max={2000}
                        suffix="ms"
                        onChange={(cursorBlinkMs) => void onGlobalChange({ cursorBlinkMs })}
                      />
                    </label>
                    <label className="feel-toggle">
                      <input
                        type="checkbox"
                        checked={settings.cursorAnimation}
                        onChange={(event) => void onGlobalChange({ cursorAnimation: event.target.checked })}
                      />
                      <span>{t("Weich bewegen")}</span>
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Scrollen und Springen"
                  description="Ob der Blick gleitet oder umschaltet. „Animationen reduzieren“ hat Vorrang."
                >
                  <div className="feel-grid">
                    <label className="feel-toggle">
                      <input
                        type="checkbox"
                        checked={settings.smoothScrolling}
                        onChange={(event) => void onGlobalChange({ smoothScrolling: event.target.checked })}
                      />
                      <span>{t("Weich scrollen")}</span>
                    </label>
                    <label>
                      <span>{t("Sprünge")}</span>
                      <select
                        value={settings.revealMotion}
                        onChange={(event) => void onGlobalChange({
                          revealMotion: event.target.value as IdeSettings["revealMotion"],
                        })}
                      >
                        <option value="smooth">{t("Hingleiten")}</option>
                        <option value="instant">{t("Sofort dort")}</option>
                      </select>
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Aktuelle Zeile"
                  description="Was die Zeile unter der Schreibmarke bekommt."
                >
                  <select
                    value={settings.lineHighlight}
                    onChange={(event) => void onGlobalChange({
                      lineHighlight: event.target.value as IdeSettings["lineHighlight"],
                    })}
                  >
                    {(["all", "line", "gutter", "none"] as const).map((value) => (
                      <option key={value} value={value}>{t(describeLineHighlight(value))}</option>
                    ))}
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Schriften im Editor"
                  description="Fließtext in einer Monospace-Schrift liest niemand gern. Leer folgt der Code-Schrift."
                >
                  <div className="feel-grid">
                    <label>
                      <span>{t("Kommentare")}</span>
                      <input
                        value={settings.commentFont}
                        placeholder={t("wie der Code")}
                        onChange={(event) => void onGlobalChange({ commentFont: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t("Inlay-Hints")}</span>
                      <input
                        value={settings.inlayFont}
                        placeholder={t("wie der Code")}
                        onChange={(event) => void onGlobalChange({ inlayFont: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t("Hint-Größe")}</span>
                      <NumberControl
                        value={settings.inlayFontScale}
                        min={40}
                        max={160}
                        suffix="%"
                        onChange={(inlayFontScale) => void onGlobalChange({ inlayFontScale })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Ligaturen und Ersatzschriften"
                  description="„on“, „off“ oder OpenType-Merkmale wie 'calt', 'ss01'. Ersatzschriften greifen, wenn ein Zeichen fehlt."
                >
                  <div className="feel-grid">
                    <label>
                      <span>{t("Ligaturen")}</span>
                      <input
                        value={settings.ligatures}
                        onChange={(event) => void onGlobalChange({ ligatures: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t("Ersatzschriften")}</span>
                      <input
                        value={settings.fontFallbacks}
                        placeholder="Noto Sans Mono, Symbola"
                        onChange={(event) => void onGlobalChange({ fontFallbacks: event.target.value })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Minimap, Sticky Scroll und Breadcrumbs"
                  description="Wie stark sich diese drei vom Code abheben."
                >
                  <div className="feel-grid">
                    <label>
                      <span>{t("Minimap")}</span>
                      <NumberControl
                        value={settings.minimapOpacity}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={(minimapOpacity) => void onGlobalChange({ minimapOpacity })}
                      />
                    </label>
                    <label>
                      <span>{t("Sticky Scroll")}</span>
                      <NumberControl
                        value={settings.stickyEmphasis}
                        min={0}
                        max={200}
                        suffix="%"
                        onChange={(stickyEmphasis) => void onGlobalChange({ stickyEmphasis })}
                      />
                    </label>
                    <label>
                      <span>{t("Breadcrumbs")}</span>
                      <NumberControl
                        value={settings.breadcrumbEmphasis}
                        min={0}
                        max={200}
                        suffix="%"
                        onChange={(breadcrumbEmphasis) => void onGlobalChange({ breadcrumbEmphasis })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Zeilenbreite im Fokusmodus"
                  description="In Zeichen. Text über die ganze Breite eines großen Bildschirms lässt das Auge die Zeile verlieren. 0 lässt ihn laufen."
                >
                  <NumberControl
                    value={settings.focusMaxWidth}
                    min={0}
                    max={200}
                    suffix={t("Zeichen")}
                    onChange={(focusMaxWidth) => void onGlobalChange({ focusMaxWidth })}
                  />
                </SettingsRow>
                <SettingsRow title="Akzentfarbe" description="Farbe für aktive Tabs, Fokus und primäre Aktionen.">
                  <input type="color" value={settings.accentColor} onChange={(event) => void onGlobalChange({ accentColor: event.target.value })} />
                </SettingsRow>
                <SettingsRow title="Hintergrundbild" description="Legt ein lokales Bild mittig als Layer hinter Editor und Toolfenster. Das Bild bleibt auf diesem PC.">
                  <div className="settings-background-picker">
                    <button type="button" onClick={() => void window.kiwi?.settings.selectBackgroundImage().then((selected) => {
                      if (selected) onGlobalChange({ backgroundImage: selected });
                    })}><ImageIcon size={14} /> {settings.backgroundImage ? "Bild ändern…" : "Bild auswählen…"}</button>
                    {settings.backgroundImage && <button type="button" className="quiet-button" onClick={() => onGlobalChange({ backgroundImage: "" })}>{t("Entfernen")}</button>}
                    <small title={settings.backgroundImage}>{settings.backgroundImage || "Kein Hintergrundbild"}</small>
                  </div>
                </SettingsRow>
                <SettingsRow title="Hintergrund-Sichtbarkeit" description="0 % blendet das Bild aus, 100 % zeigt es ohne zusätzliche Abschwächung.">
                  <div className="settings-opacity-control">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.backgroundOpacity}
                      disabled={!settings.backgroundImage}
                      onChange={(event) => onGlobalChange({ backgroundOpacity: Number(event.target.value) })}
                    />
                    <output>{settings.backgroundOpacity} %</output>
                  </div>
                </SettingsRow>
                {backgroundAnimationWarning && (
                  <p className="settings-inline-warning">{backgroundAnimationWarning}</p>
                )}
                <SettingsRow
                  title="Schrift für dieses Projekt"
                  description="Ein Projekt voller Rahmenzeichen oder mit eigener Schrift will eine Schrift, die der Rest der Arbeit nicht will. Leer folgt der allgemeinen."
                >
                  <div className="feel-grid">
                    <label>
                      <span>{t("Schrift")}</span>
                      <input
                        value={projectSettings.fontFamily}
                        disabled={!workspaceRoot}
                        placeholder={t("wie allgemein")}
                        onChange={(event) => onProjectChange({ fontFamily: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t("Ersatzschriften")}</span>
                      <input
                        value={projectSettings.fontFallbacks}
                        disabled={!workspaceRoot}
                        placeholder={t("wie allgemein")}
                        onChange={(event) => onProjectChange({ fontFallbacks: event.target.value })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Bild für dieses Projekt"
                  description="Überschreibt nur das Bild. Weichzeichnung, Position und Sichtbarkeit bleiben die allgemeinen."
                >
                  <div className="settings-background-picker">
                    <button
                      type="button"
                      disabled={!workspaceRoot}
                      onClick={() => void window.kiwi?.settings.selectBackgroundImage().then((selected) => {
                        if (selected) onProjectChange({ backgroundImage: selected });
                      })}
                    ><ImageIcon size={14} /> {projectSettings.backgroundImage ? t("Bild ändern…") : t("Bild auswählen…")}</button>
                    {projectSettings.backgroundImage && (
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => onProjectChange({ backgroundImage: "" })}
                      >{t("Entfernen")}</button>
                    )}
                    <small title={projectSettings.backgroundImage}>
                      {projectSettings.backgroundImage || t("Das allgemeine Bild")}
                    </small>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Weitere Bilder"
                  description="Mehrere Bilder werden der Reihe nach gezeigt. Ohne Wechselzeit bleibt das erste stehen."
                >
                  <div className="background-playlist">
                    {settings.backgroundPlaylist.map((entry) => (
                      <div className="background-playlist-row" key={entry}>
                        <small title={entry}>{entry.split(/[\\/]/).pop()}</small>
                        <button
                          type="button"
                          aria-label={`${t("Entfernen")}: ${entry}`}
                          onClick={() => void onGlobalChange({
                            backgroundPlaylist: settings.backgroundPlaylist.filter((item) => item !== entry),
                          })}
                        ><X size={12} /></button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => void window.kiwi?.settings.selectBackgroundImage().then((selected) => {
                        if (!selected || settings.backgroundPlaylist.includes(selected)) return;
                        void onGlobalChange({ backgroundPlaylist: [...settings.backgroundPlaylist, selected] });
                      })}
                    ><ImageIcon size={13} /> {t("Bild hinzufügen…")}</button>
                    <label className="background-rotate">
                      <span>{t("Wechsel alle")}</span>
                      <NumberControl
                        value={settings.backgroundRotateSeconds}
                        min={0}
                        max={3600}
                        suffix="s"
                        onChange={(backgroundRotateSeconds) => void onGlobalChange({ backgroundRotateSeconds })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Sichtbarkeit pro Bereich"
                  description="Was hinter Code gut lesbar ist, ist es hinter einem Dateibaum selten. Auto folgt der allgemeinen Sichtbarkeit."
                >
                  <div className="background-surface-grid">
                    {([
                      ["backgroundEditorOpacity", "Editor"],
                      ["backgroundExplorerOpacity", "Explorer"],
                      ["backgroundTerminalOpacity", "Terminal"],
                    ] as const).map(([key, label]) => (
                      <label key={key}>
                        <span>{t(label)}</span>
                        <input
                          type="range"
                          min="-1"
                          max="100"
                          value={settings[key]}
                          disabled={!settings.backgroundImage && !settings.backgroundPlaylist.length}
                          onChange={(event) => void onGlobalChange({ [key]: Number(event.target.value) })}
                        />
                        <output>{settings[key] < 0 ? t("Auto") : `${settings[key]} %`}</output>
                      </label>
                    ))}
                  </div>
                </SettingsRow>
                <SettingsRow title="Position und Größe" description="Wo das Bild sitzt und wie es skaliert wird.">
                  <div className="background-layout-grid">
                    <label>
                      <span>{t("Position")}</span>
                      <select
                        value={settings.backgroundAnchor}
                        onChange={(event) => void onGlobalChange({
                          backgroundAnchor: event.target.value as IdeSettings["backgroundAnchor"],
                        })}
                      >
                        <option value="center">{t("Mitte")}</option>
                        <option value="top">{t("Oben")}</option>
                        <option value="bottom">{t("Unten")}</option>
                        <option value="left">{t("Links")}</option>
                        <option value="right">{t("Rechts")}</option>
                        <option value="top-left">{t("Oben links")}</option>
                        <option value="top-right">{t("Oben rechts")}</option>
                        <option value="bottom-left">{t("Unten links")}</option>
                        <option value="bottom-right">{t("Unten rechts")}</option>
                      </select>
                    </label>
                    <label>
                      <span>{t("Skalierung")}</span>
                      <select
                        value={settings.backgroundFit}
                        onChange={(event) => void onGlobalChange({
                          backgroundFit: event.target.value as IdeSettings["backgroundFit"],
                        })}
                      >
                        <option value="contain">{t("Ganz sichtbar")}</option>
                        <option value="cover">{t("Fenster füllen")}</option>
                        <option value="stretch">{t("Verzerren")}</option>
                        <option value="tile">{t("Kacheln")}</option>
                        <option value="center">{t("Originalgröße")}</option>
                      </select>
                    </label>
                    <label>
                      <span>{t("Zoom")}</span>
                      <NumberControl
                        value={settings.backgroundScale}
                        min={10}
                        max={400}
                        suffix="%"
                        onChange={(backgroundScale) => void onGlobalChange({ backgroundScale })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Weichzeichnung und Tönung"
                  description="Code über einem scharfen Foto ist schwer zu lesen. Weichzeichnen behält die Bildwirkung und beruhigt den Text."
                >
                  <div className="background-layout-grid">
                    <label>
                      <span>{t("Weichzeichnen")}</span>
                      <NumberControl
                        value={settings.backgroundBlur}
                        min={0}
                        max={40}
                        suffix="px"
                        onChange={(backgroundBlur) => void onGlobalChange({ backgroundBlur })}
                      />
                    </label>
                    <label>
                      <span>{t("Tönung")}</span>
                      <NumberControl
                        value={settings.backgroundTint}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={(backgroundTint) => void onGlobalChange({ backgroundTint })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title="Bewegung"
                  description="Sehr langsames Mitwandern beim Scrollen, und wie stark das Bild im Fokusmodus ist."
                >
                  <div className="background-layout-grid">
                    <label>
                      <span>{t("Parallax")}</span>
                      <NumberControl
                        value={settings.backgroundParallax}
                        min={0}
                        max={100}
                        suffix="px/1000"
                        onChange={(backgroundParallax) => void onGlobalChange({ backgroundParallax })}
                      />
                    </label>
                    <label>
                      <span>{t("Im Fokusmodus")}</span>
                      <NumberControl
                        value={settings.backgroundFocusStrength}
                        min={0}
                        max={300}
                        suffix="%"
                        onChange={(backgroundFocusStrength) => void onGlobalChange({ backgroundFocusStrength })}
                      />
                    </label>
                  </div>
                </SettingsRow>
                <ToggleRow
                  title="Bewegte Hintergründe zulassen"
                  description="GIF, WebP und Video kosten dauerhaft Rechenzeit und Akku. Ohne das hier wird nur das erste Bild gezeigt."
                  checked={settings.backgroundAllowAnimation}
                  onChange={(backgroundAllowAnimation) => void onGlobalChange({ backgroundAllowAnimation })}
                />
                <SettingsRow title="Startverhalten" description="Welcome wird ausschließlich angezeigt, wenn kein Projekt aktiv ist.">
                  <span>{t("Aktives Projekt öffnen")}</span>
                </SettingsRow>
                <ToggleRow title="Animationen reduzieren" description="Deaktiviert Übergänge und laufende Dekorationen für eine ruhigere Oberfläche." checked={settings.reducedMotion} onChange={(reducedMotion) => void onGlobalChange({ reducedMotion })} />
                <ToggleRow title="Inlay Hints" description="Parameternamen und Typinformationen durch JDT LS anzeigen." checked={settings.inlayHints} onChange={(inlayHints) => void onGlobalChange({ inlayHints })} />
                <ToggleRow title="Hover-Dokumentation" description="Beim Zeigen auf einen Namen dessen Typ und Javadoc einblenden. Fehlermeldungen und Quick Fixes erscheinen unabhängig davon." checked={settings.hoverDocumentation} onChange={(hoverDocumentation) => void onGlobalChange({ hoverDocumentation })} />
                <ToggleRow title="Session wiederherstellen" description="Offene Dateien beim nächsten Start erneut öffnen." checked={settings.restoreSession} onChange={(restoreSession) => void onGlobalChange({ restoreSession })} />
                <SettingsRow title="Explorer-Icons" description="Größe der Datei- und Ordnersymbole.">
                  <NumberControl value={settings.explorerIconSize} min={12} max={22} suffix="px" onChange={(explorerIconSize) => void onGlobalChange({ explorerIconSize })} />
                </SettingsRow>
                <SettingsRow title="Explorer-Einrückung" description="Abstand zwischen den Ebenen des Projektbaums.">
                  <NumberControl value={settings.explorerIndent} min={8} max={24} suffix="px" onChange={(explorerIndent) => void onGlobalChange({ explorerIndent })} />
                </SettingsRow>
                <SettingsRow title="Haupttoolbar" description="Bestimme, welche Aktionen in der kompakten Toolbar sichtbar sind.">
                  <div className="toolbar-settings">
                    {[
                      ["run", "Run"],
                      ["debug", "Debug"],
                      ["stop", "Stop"],
                      ["search", "Search"],
                    ].map(([id, label]) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={settings.toolbarActions.includes(id)}
                          onChange={(event) => void onGlobalChange({
                            toolbarActions: event.target.checked
                              ? [...settings.toolbarActions, id]
                              : settings.toolbarActions.filter((item) => item !== id),
                          })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </SettingsRow>
              </section>
            )}

            {category === "build" && (
              <section>
                <div className="settings-build-card"><Hammer size={18} /><span><strong>{project.type}</strong><small>{project.hasWrapper ? "Projekt-Wrapper wird bevorzugt" : "Gebündeltes Build-Werkzeug wird verwendet"}</small></span></div>
                <ToggleRow title="Maven Offline" description="Nur Artefakte aus dem lokalen Maven-Cache verwenden." checked={projectSettings.mavenOffline} disabled={!workspaceRoot || project.type !== "Maven"} onChange={(mavenOffline) => void onProjectChange({ mavenOffline })} />
                <ToggleRow title="Gradle Offline" description="Keine Netzwerkzugriffe während Gradle-Builds." checked={projectSettings.gradleOffline} disabled={!workspaceRoot || project.type !== "Gradle"} onChange={(gradleOffline) => void onProjectChange({ gradleOffline })} />
                <ToggleRow title="Automatisch synchronisieren" description="Änderungen an pom.xml und Gradle-Dateien automatisch in JDT LS übernehmen." checked={projectSettings.autoSyncBuild} disabled={!workspaceRoot} onChange={(autoSyncBuild) => void onProjectChange({ autoSyncBuild })} />
                <ToggleRow title="Projekt-Wrapper bevorzugen" description="mvnw oder gradlew vor dem gebündelten Build-Werkzeug verwenden." checked={projectSettings.preferWrapper} disabled={!workspaceRoot || project.type === "Java"} onChange={(preferWrapper) => void onProjectChange({ preferWrapper })} />
                <ToggleRow title="Parallele Builds" description="Gradle --parallel beziehungsweise Maven -T 1C verwenden." checked={projectSettings.parallelBuilds} disabled={!workspaceRoot || project.type === "Java"} onChange={(parallelBuilds) => void onProjectChange({ parallelBuilds })} />
                <ToggleRow title="Vor Tests bereinigen" description="Entfernt bei Maven veraltete Testklassen, bevor die Tests neu kompiliert werden." checked={projectSettings.cleanBeforeTest} disabled={!workspaceRoot || project.type !== "Maven"} onChange={(cleanBeforeTest) => void onProjectChange({ cleanBeforeTest })} />
                <ToggleRow title="Java Preview Features" description="Kompilieren und starten mit --enable-preview." checked={projectSettings.previewFeatures} disabled={!workspaceRoot} onChange={(previewFeatures) => void onProjectChange({ previewFeatures })} />
                <SettingsRow title="Ausgeschlossene Projektpfade" description="Kommagetrennte Ordner werden nicht von JDT LS importiert.">
                  <input className="settings-wide-input" disabled={!workspaceRoot} value={projectSettings.excludedPaths.join(", ")} onChange={(event) => void onProjectChange({ excludedPaths: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder={t("generated-legacy, vendor")} />
                </SettingsRow>
                <SettingsRow title="Ausgeschlossene Libraries" description="Workspace-relative JAR-Pfade nicht indexieren.">
                  <input className="settings-wide-input" disabled={!workspaceRoot} value={projectSettings.excludedLibraries.join(", ")} onChange={(event) => void onProjectChange({ excludedLibraries: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder={t("libs/legacy.jar")} />
                </SettingsRow>
                <SettingsRow title="Build-Datei" description="Automatisch erkannte Projektdefinition."><code>{project.buildFile || "Plain Javac"}</code></SettingsRow>
              </section>
            )}

            {category === "explorer" && (
              <section>
                <SettingsRow title="Darstellung" description="Packages betont Java-Strukturen, Ordner zeigt den Dateibaum unverändert.">
                  <select value={settings.explorerView} onChange={(event) => void onGlobalChange({ explorerView: event.target.value as IdeSettings["explorerView"] })}>
                    <option value="folders">{t("Ordner")}</option><option value="packages">{t("Packages")}</option>
                  </select>
                </SettingsRow>
                <ToggleRow title="Leere Package-Pfade zusammenfassen" description="de › game › server kompakt als de.game.server darstellen." checked={settings.compactPackages} onChange={(compactPackages) => void onGlobalChange({ compactPackages })} />
                <ToggleRow title="Module mit dem Projekt zuklappen" description="Beim Zuklappen eines Projekts auch alle geöffneten Ordner und Module darin schließen." checked={settings.explorerCollapseModulesWithProject} onChange={(explorerCollapseModulesWithProject) => void onGlobalChange({ explorerCollapseModulesWithProject })} />
                <ToggleRow title="Dateiendungen ausblenden" description={`Bei ${hideableExtensions.join(", ")} nur den Namen anzeigen. Das Symbol zeigt den Typ weiterhin an.`} checked={settings.explorerHideFileExtensions} onChange={(explorerHideFileExtensions) => void onGlobalChange({ explorerHideFileExtensions })} />
                <ToggleRow title="Versteckte Ordner ausblenden" description="Punkt-Ordner wie .git, .kiwi, .gradle und .idea nicht im Explorer anzeigen." checked={settings.explorerHideDotDirectories} onChange={(explorerHideDotDirectories) => void onGlobalChange({ explorerHideDotDirectories })} />
                <ToggleRow title="Build-Ordner ausblenden" description="target, build und out im Explorer verbergen." checked={settings.explorerHideBuild} onChange={(explorerHideBuild) => void onGlobalChange({ explorerHideBuild })} />
                <ToggleRow title="Generierte Ordner ausblenden" description="generated-sources und ähnliche Verzeichnisse verbergen." checked={settings.explorerHideGenerated} onChange={(explorerHideGenerated) => void onGlobalChange({ explorerHideGenerated })} />
                <SettingsRow title="Eigene Ausschlüsse" description="Kommagetrennte Verzeichnisnamen im Explorer ausblenden.">
                  <input className="settings-wide-input" value={settings.explorerExcludedPatterns.join(", ")} onChange={(event) => void onGlobalChange({ explorerExcludedPatterns: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder={t("dist, legacy-cache")} />
                </SettingsRow>
                <SettingsRow title="Dateien öffnen" description="Einfacher oder doppelter Klick auf Dateien.">
                  <select value={settings.explorerOpenMode} onChange={(event) => void onGlobalChange({ explorerOpenMode: event.target.value as IdeSettings["explorerOpenMode"] })}>
                    <option value="single">{t("Ein Klick")}</option><option value="double">{t("Doppelklick")}</option>
                  </select>
                </SettingsRow>
                <ToggleRow title="Explorer-Zustand wiederherstellen" description="Geöffnete Ordner und Auswahl lokal merken." checked={settings.restoreExplorerState} onChange={(restoreExplorerState) => void onGlobalChange({ restoreExplorerState })} />
              </section>
            )}

            {category === "runDebug" && (
              <section>
                <ToggleRow title="Konsole automatisch öffnen" description="Run-, Test- und Debug-Ausgabe beim Start sichtbar machen." checked={settings.openConsoleOnRun} onChange={(openConsoleOnRun) => void onGlobalChange({ openConsoleOnRun })} />
                <ToggleRow title="Inline-Debug-Werte" description="Lokale Werte direkt neben der aktuellen Codezeile anzeigen." checked={settings.inlineDebugValues} onChange={(inlineDebugValues) => void onGlobalChange({ inlineDebugValues })} />
                <ToggleRow title="Smart HotSwap beim Speichern" description="Ersetzt normalen Methodencode sofort. Änderungen an bereits ausgeführtem Start- oder Initialisierungscode laden eine von Kiwi gestartete Anwendung automatisch neu; Breakpoints bleiben erhalten." checked={settings.hotSwapOnSave} onChange={(hotSwapOnSave) => void onGlobalChange({ hotSwapOnSave })} />
                <SettingsRow title="Break on Exception" description="Debugger bei geworfenen Exceptions anhalten.">
                  <select value={settings.breakOnExceptions} onChange={(event) => void onGlobalChange({ breakOnExceptions: event.target.value as IdeSettings["breakOnExceptions"] })}>
                    <option value="none">{t("Aus")}</option><option value="uncaught">{t("Nur unbehandelte")}</option><option value="all">{t("Alle Exceptions")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Umgebungsvariablen-Vorlage" description="Wird Run-Konfigurationen als Standard hinzugefügt; Format NAME=WERT;PORT=8080.">
                  <input className="settings-wide-input" value={settings.runEnvironmentTemplate} onChange={(event) => void onGlobalChange({ runEnvironmentTemplate: event.target.value })} placeholder={t("PROFILE=dev;PORT=8080")} />
                </SettingsRow>
                <ToggleRow title="Alte Konsolenausgaben behalten" description="Ausgabe bei einem neuen Lauf nicht automatisch leeren." checked={settings.preserveConsoleOutput} onChange={(preserveConsoleOutput) => void onGlobalChange({ preserveConsoleOutput })} />
                <SettingsRow title="Run-Konfigurationen" description="Konfigurationen können bereits gruppiert und als Favorit markiert werden.">
                  <span>{t("Im Run-Seitenpanel verwalten")}</span>
                </SettingsRow>
              </section>
            )}

            {category === "terminal" && (
              <section>
                <SettingsRow title="Keymap" description="Wählt vertraute zusätzliche Tastenkürzel; Kiwi-Kürzel bleiben als Fallback aktiv.">
                  <select value={settings.keymap} onChange={(event) => void onGlobalChange({ keymap: event.target.value as IdeSettings["keymap"] })}>
                    <option value="kiwi">{t("Kiwi")}</option>
                    <option value="intellij">{t("IntelliJ-kompatibel")}</option>
                    <option value="eclipse">{t("Eclipse-kompatibel")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Tastenkürzel"
                  description="Feld anklicken und die gewünschte Tastenkombination drücken. Entf löscht die Belegung, Esc bricht ab."
                >
                  <div className="keybinding-toolbar">
                    <input
                      value={keybindingQuery}
                      onChange={(event) => setKeybindingQuery(event.target.value)}
                      placeholder={t("Befehl oder Kürzel suchen")}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => void onGlobalChange({ customKeybindings: {} })}
                      disabled={Object.keys(settings.customKeybindings || {}).length === 0}
                    >
                      Alle zurücksetzen
                    </button>
                  </div>
                </SettingsRow>
                {conflicts.length > 0 && (
                  <p className="keybinding-conflicts">
                    Doppelt belegt: {conflicts.map((conflict) => `${conflict.shortcut} (${conflict.ids
                      .map((id) => keybindingCatalogue.find((entry) => entry.id === id)?.label || id)
                      .join(", ")})`).join(" · ")}
                  </p>
                )}
                {visibleKeybindings.map(([category, entries]) => (
                  <div className="keybinding-group" key={category}>
                    <h4>{t(category)}</h4>
                    <div className="keybinding-grid">
                      {entries.map((entry) => {
                        const value = activeKeybindings[entry.id];
                        const changed = (settings.customKeybindings || {})[entry.id] !== undefined
                          && (settings.customKeybindings || {})[entry.id] !== entry.fallback;
                        const conflicting = conflicts.some((conflict) => conflict.ids.includes(entry.id));
                        return (
                          <label key={entry.id} className={conflicting ? "conflicting" : ""}>
                            <span>{t(entry.label)}</span>
                            <button
                              type="button"
                              className={`keybinding-capture ${recordingKeybinding === entry.id ? "recording" : ""}`}
                              onClick={() => setRecordingKeybinding(entry.id)}
                              onBlur={() => setRecordingKeybinding((current) => (current === entry.id ? "" : current))}
                              onKeyDown={(event) => {
                                if (recordingKeybinding !== entry.id) return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (event.key === "Escape") {
                                  setRecordingKeybinding("");
                                  return;
                                }
                                if (event.key === "Delete" || event.key === "Backspace") {
                                  setRecordingKeybinding("");
                                  void onGlobalChange({
                                    customKeybindings: { ...(settings.customKeybindings || {}), [entry.id]: "" },
                                  });
                                  return;
                                }
                                const shortcut = shortcutFromEvent(event as unknown as KeyboardEvent);
                                if (!shortcut) return;
                                setRecordingKeybinding("");
                                void onGlobalChange({
                                  customKeybindings: { ...(settings.customKeybindings || {}), [entry.id]: shortcut },
                                });
                              }}
                            >
                              {recordingKeybinding === entry.id ? "Taste drücken …" : value || "Nicht belegt"}
                            </button>
                            {changed && (
                              <button
                                type="button"
                                className="keybinding-reset"
                                title={`Zurück auf ${entry.fallback}`}
                                onClick={() => {
                                  const { [entry.id]: _removed, ...rest } = settings.customKeybindings || {};
                                  void onGlobalChange({ customKeybindings: rest });
                                }}
                              >
                                <RotateCcw size={12} />
                              </button>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <SettingsRow title="Terminal-Schriftgröße" description="Schriftgröße des integrierten Terminals.">
                  <NumberControl value={settings.terminalFontSize} min={9} max={22} suffix="px" onChange={(terminalFontSize) => void onGlobalChange({ terminalFontSize })} />
                </SettingsRow>
                <SettingsRow title="Code Completion" description="JDT-Vorschläge jederzeit explizit öffnen.">
                  <kbd className="settings-key"><Keyboard size={13} /> {t("Strg + Leertaste")}</kbd>
                </SettingsRow>
                <SettingsRow title="Quick Fix" description="Verfügbare Korrekturen und Refactorings öffnen."><kbd className="settings-key">{t("Alt + Enter")}</kbd></SettingsRow>
                <SettingsRow title="Rename" description="Symbol projektweit umbenennen."><kbd className="settings-key">{t("F2")}</kbd></SettingsRow>
              </section>
            )}

            {category === "accounts" && (
              <section>
                {/* The page carries the settings' own section shape itself, so
                    no frame here — one that repeated the category's own name
                    was a heading nothing else in the settings has. */}
                <AccountsView
                  github={githubSession}
                  settings={settings}
                  onSignIn={() => setSignInOpen(true)}
                  onSignOut={() => void window.kiwi?.git.githubSignOut().then(setGithubSession).catch(() => undefined)}
                  onChange={(patch) => void window.kiwi?.settings.update(patch)}
                  onAddCertificate={() => void (async () => {
                    const chosen = await window.kiwi?.settings.chooseCertificate();
                    if (!chosen) return;
                    const current = settings.extraCertificates || [];
                    // Adding the same file twice would list it twice and trust
                    // it once, which reads as a bug in the list.
                    if (current.some((file) => file.toLocaleLowerCase() === chosen.toLocaleLowerCase())) return;
                    await window.kiwi?.settings.update({ extraCertificates: [...current, chosen] });
                  })()}
                />
              </section>
            )}

            {category === "system" && (
              <section>
                <SettingsRow
                  title="Version"
                  description="Welche Kiwi-Version läuft, worauf sie aufsetzt und was in einen Fehlerbericht gehört."
                >
                  <div className="settings-version">
                    <strong>Kiwi IDE {installedVersion.version || __APP_VERSION__}</strong>
                    {installedVersion.renderer && (
                      <span>{t("Oberfläche")} {installedVersion.renderer} · {t("ohne Neustart aktualisiert")}</span>
                    )}
                    {installedVersion.runtime && <span>{installedVersion.runtime}</span>}
                    {installedVersion.platform && <span>{installedVersion.platform}</span>}
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(versionReport(installedVersion))
                          .then(() => {
                            setVersionCopied(true);
                            // The label is a confirmation, not a state: leaving
                            // it on the button says the copy is still happening.
                            window.setTimeout(() => setVersionCopied(false), 2_000);
                          })
                          .catch(() => undefined);
                      }}
                    ><Copy size={13} /> {versionCopied ? t("Kopiert") : t("Versionsangaben kopieren")}</button>
                  </div>
                </SettingsRow>
                <ToggleRow title="Updates beim Start prüfen" description="Meldet neue GitHub-Releases beim Start. Ein eigenes Windows-Update-Manifest kann Updates automatisch installieren." checked={settings.automaticUpdates} onChange={(automaticUpdates) => void onGlobalChange({ automaticUpdates })} />
                <SettingsRow title="Beim Start" description="Zuletzt geöffnetes Projekt wiederherstellen oder immer mit der Projektliste beginnen.">
                  <select value={settings.startupBehavior} onChange={(event) => void onGlobalChange({ startupBehavior: event.target.value as IdeSettings["startupBehavior"] })}>
                    <option value="restore">{t("Letztes Projekt öffnen")}</option>
                    <option value="hub">{t("Projektliste zeigen")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Vervollständigung" description="Bewertung automatischer Vorschläge. Ctrl+Space und Ctrl+Shift+Space setzen sie jederzeit außer Kraft.">
                  <select value={settings.completionMode} onChange={(event) => void onGlobalChange({ completionMode: event.target.value as IdeSettings["completionMode"] })}>
                    <option value="smart">{t("Smart — passende Typen zuerst")}</option>
                    <option value="basic">{t("Basis — alphabetisch nach Präfix")}</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="GitHub OAuth Client-ID"
                  description="Schaltet die Browser-Anmeldung frei. Lege dazu unter github.com/settings/developers eine OAuth-App mit aktiviertem Device Flow an. Ohne Client-ID bleibt die Anmeldung per Token."
                >
                  <input
                    className="settings-wide-input"
                    type="text"
                    value={settings.githubClientId}
                    onChange={(event) => void onGlobalChange({ githubClientId: event.target.value.trim() })}
                    placeholder={t("Iv1.… oder Ov23…")}
                    spellCheck={false}
                  />
                </SettingsRow>
                <SettingsRow
                  title="Update-Kanal"
                  description="Stable erhält reguläre Versionen. Beta und Canary berücksichtigen auch GitHub-Vorabversionen."
                >
                  <select value={settings.updateChannel} onChange={(event) => void onGlobalChange({ updateChannel: event.target.value as IdeSettings["updateChannel"] })}>
                    <option value="stable">{t("Stable")}</option>
                    <option value="beta">{t("Beta")}</option>
                    <option value="canary">{t("Canary")}</option>
                  </select>
                </SettingsRow>
                {window.kiwi?.platform === "win32" && <SettingsRow title="Update-Manifest" description="Optionales HTTPS-Manifest für eigene Windows-Updates. Ohne eigene Adresse nutzt Kiwi GitHub Releases.">
                  <input className="settings-wide-input" type="url" value={settings.updateManifestUrl} onChange={(event) => void onGlobalChange({ updateManifestUrl: event.target.value })} placeholder={t("https://updates.example.org/kiwi.json")} />
                </SettingsRow>}
                <SettingsRow title="Jetzt prüfen" description="Kiwi sucht ein passendes Paket und prüft den Download per SHA-256.">
                  <div className="settings-update-actions">
                    <button
                      disabled={checkingUpdate}
                      onClick={() => {
                        setCheckingUpdate(true);
                        void onCheckUpdates().then(setUpdateResult).catch((error) => setUpdateResult({
                          configured: true,
                          available: false,
                          currentVersion: __APP_VERSION__,
                          reason: error instanceof Error ? error.message : t("Update-Prüfung fehlgeschlagen."),
                        })).finally(() => setCheckingUpdate(false));
                      }}
                    ><RefreshCw size={14} /> {checkingUpdate ? t("Bitte warten…") : t("Nach Updates suchen")}</button>
                    {updateResult?.available && updateResult.downloadUrl && (
                      <button className="primary-button" disabled={checkingUpdate} onClick={() => {
                        setCheckingUpdate(true);
                        void window.kiwi?.app.installUpdate(updateResult)
                          .then(() => {
                            if (manualUpdate) setUpdateResult({
                              ...updateResult,
                              reason: t("Update heruntergeladen. Das Paket wurde im Dateimanager angezeigt."),
                            });
                          })
                          .catch((error) => setUpdateResult({
                            ...updateResult,
                            reason: error instanceof Error ? error.message : t("Update konnte nicht installiert werden."),
                          }))
                          .finally(() => setCheckingUpdate(false));
                      }}>{manualUpdate ? t("Update herunterladen") : t("Update installieren")} ({updateResult.version})</button>
                    )}
                    {updateReleaseUrl && (
                      <button onClick={() => void onOpenUpdate(updateReleaseUrl)}>{t("GitHub Releases öffnen")}</button>
                    )}
                    {updateResult?.reason && updateResult.available && <small>{updateResult.reason}</small>}
                    {updateResult && !updateResult.available && <small>{updateResult.reason || `Kiwi ${updateResult.currentVersion} ist aktuell.`}</small>}
                  </div>
                </SettingsRow>
                <ToggleRow title="Lokale Crash-Berichte" description="Speichert Absturzdetails nur nach Zustimmung lokal im Kiwi-Benutzerdatenordner. Es erfolgt kein automatischer Upload." checked={settings.crashReporting} onChange={(crashReporting) => void onGlobalChange({ crashReporting })} />
                <ToggleRow title="Screenreader-Modus" description="Aktiviert Electrons Barrierefreiheitsbaum dauerhaft und verbessert semantische Statusmeldungen." checked={settings.screenReaderMode} onChange={(screenReaderMode) => void onGlobalChange({ screenReaderMode })} />
                <ToggleRow title="Deutliche Fokusmarkierungen" description="Hebt den Tastaturfokus in Menüs, Toolfenstern und Formularen stärker hervor." checked={settings.enhancedFocus} onChange={(enhancedFocus) => void onGlobalChange({ enhancedFocus })} />
              </section>
            )}
          </div>
        </div>
        <StandaloneWindowFooter
          status={applyError || (dirty
            ? `${globalDirty ? t("IDE") : ""}${globalDirty && projectDirty ? ` ${t("und")} ` : ""}${projectDirty ? t("Projekt") : ""}: ${t("Änderungen noch nicht angewendet")}`
            : t("Alle Einstellungen sind gespeichert"))}
          tone={applyError ? "error" : dirty ? "default" : "success"}
        >
            <button disabled={!dirty || applying} onClick={() => {
              setSettings(savedSettings);
              setProjectSettings(savedProjectSettings);
            }}>{t("Verwerfen")}</button>
            <button className="primary-button" disabled={!dirty || applying} onClick={() => void applySettings()}>
              {applying ? t("Wird angewendet…") : t("Übernehmen")}
            </button>
        </StandaloneWindowFooter>
      </div>
      {signInOpen && (
        <GitHubSignInDialog
          onSignedIn={(session) => {
            setGithubSession(session);
            setSignInOpen(false);
          }}
          onCancel={() => setSignInOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The templates the open project defines.
 *
 * Edited here rather than in the workbench because the settings window is a
 * window of its own and cannot open a file in the editor. What it shows while
 * being edited is the point of it: which templates the text currently defines,
 * and what is wrong with the ones it does not.
 */
function ProjectTemplatesPanel({ workspaceRoot }: { workspaceRoot: string }) {
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [state, setState] = useState<"laden" | "bereit" | "speichern" | "fehler">("laden");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let current = true;
    if (!workspaceRoot || !window.kiwi?.templates) {
      setState("bereit");
      setText("");
      setSavedText("");
      return;
    }
    setState("laden");
    window.kiwi.templates.read(workspaceRoot)
      .then((file) => {
        if (!current) return;
        setText(file.text);
        setSavedText(file.text);
        setState("bereit");
        setMessage("");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState("fehler");
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => { current = false; };
  }, [workspaceRoot]);

  const report = useMemo(() => parseCustomTemplates(text), [text]);
  const changed = text !== savedText;

  const save = async () => {
    if (!workspaceRoot || !window.kiwi?.templates) return;
    setState("speichern");
    try {
      const written = await window.kiwi.templates.write(workspaceRoot, text);
      setSavedText(written.text);
      setState("bereit");
      setMessage(t("Gespeichert."));
    } catch (error) {
      setState("fehler");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (!workspaceRoot) {
    return (
      <SettingsSection title="Templates dieses Projekts" description="Öffne ein Projekt, um seine eigenen Templates zu bearbeiten.">
        <p>{t("Kein Projekt geöffnet.")}</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Templates dieses Projekts"
      description="Eigene Live- und Postfix-Templates, gespeichert in .kiwi/templates.json. Die Datei gehört zum Projekt und kann eingecheckt werden, damit alle im Team dieselben Templates haben."
    >
      <div className="project-templates">
        <textarea
          className="project-templates-source"
          spellCheck={false}
          value={text}
          disabled={state === "laden"}
          placeholder={t("Noch keine eigenen Templates.")}
          onChange={(event) => {
            setText(event.target.value);
            setMessage("");
          }}
        />
        <div className="project-templates-actions">
          <button disabled={!changed || state === "speichern"} onClick={() => void save()}>
            {t("Speichern")}
          </button>
          <button
            disabled={Boolean(text.trim())}
            title={t("Schreibt zwei Beispiele in die Datei, die als Vorlage dienen")}
            onClick={() => setText(templateFileExample())}
          >
            {t("Beispiel einfügen")}
          </button>
          {message && <span className={state === "fehler" ? "project-templates-error" : "project-templates-note"}>{message}</span>}
        </div>
        {report.problems.length > 0 && (
          <ul className="project-templates-problems">
            {report.problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
        <ul className="project-templates-list">
          {report.templates.map((template) => (
            <li key={`${template.source}:${template.key}`}>
              <code>{template.key}</code>
              <span>{template.detail}</span>
              <em>{template.source === "postfix" ? t("Postfix") : t("Live")}</em>
            </li>
          ))}
          {!report.templates.length && !report.problems.length && (
            <li className="project-templates-empty">{t("Dieses Projekt definiert keine eigenen Templates.")}</li>
          )}
        </ul>
      </div>
    </SettingsSection>
  );
}

// The settings are written as German text in the markup, which keeps them
// readable where they are used. Translating in these three wrappers reaches
// every row's heading and explanation at once.
function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="settings-section"><div><strong>{t(title)}</strong><p>{t(description)}</p></div><div>{children}</div></div>;
}

function SettingsRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><strong>{t(title)}</strong><p>{t(description)}</p></div><div className="setting-control">{children}</div></div>;
}

function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`setting-row ${disabled ? "disabled" : ""}`}><div><strong>{t(title)}</strong><p>{t(description)}</p></div><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function NumberControl({ value, min, max, suffix, onChange }: { value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <div className="number-setting"><button onClick={() => onChange(Math.max(min, value - 1))}>−</button><span>{value}{suffix}</span><button onClick={() => onChange(Math.min(max, value + 1))}>+</button></div>;
}
