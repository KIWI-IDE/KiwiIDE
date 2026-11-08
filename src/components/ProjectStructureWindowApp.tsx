import { Blocks, Braces, Check, Cpu, Library, RefreshCw, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DependencyAudit,
  IdeSettings,
  JdkInfo,
  ModuleInfo,
  ProjectInfo,
  ProjectSettings,
  ProjectTask,
} from "../types";
import { findTheme } from "../themes";
import { projectStructureProblems } from "../structure/project-structure";
import {
  StandaloneDocumentHeader,
  StandaloneWindowFooter,
  StandaloneWindowFrame,
  StandaloneWindowNavigation,
} from "./StandaloneWindowLayout";
import { WindowRequestEpoch } from "./window-request-epoch";
import { t } from "../i18n";
import { JAVA_LANGUAGE_LEVELS } from "../language-levels";

type Section = "project" | "modules" | "libraries" | "sdks" | "build" | "problems";

const LANGUAGE_LEVELS = JAVA_LANGUAGE_LEVELS;

const emptyProject: ProjectInfo = { type: "Java", buildFile: null, javaVersion: "" };

/**
 * Project structure in a window of its own, like the settings.
 *
 * Everything here is edited as a draft and written only when it is confirmed:
 * the SDK, the language level and the encoding of a project reach the build on
 * the next run, and changing one by mistake while reading through is expensive
 * to notice. The dialog embedded in the workbench saved every keystroke
 * immediately, which is what this replaces.
 */
export function ProjectStructureWindowApp() {
  const initialRoot = new URLSearchParams(window.location.search).get("projectRoot") || "";
  const requests = useRef(new WindowRequestEpoch(initialRoot));
  const [workspaceRoot, setWorkspaceRoot] = useState(initialRoot);
  const [section, setSection] = useState<Section>("project");
  const [project, setProject] = useState<ProjectInfo>(emptyProject);
  const [saved, setSaved] = useState<ProjectSettings | null>(null);
  const [draft, setDraft] = useState<ProjectSettings | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [moduleDraft, setModuleDraft] = useState<Record<string, { jdkPath?: string; languageLevel?: string }>>({});
  const [jdks, setJdks] = useState<JdkInfo[]>([]);
  const [audit, setAudit] = useState<DependencyAudit | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [backgroundImageData, setBackgroundImageData] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", findTheme(settings?.theme || "").id);
    document.documentElement.style.setProperty("--roundness", String(Math.max(0, Math.min(250, settings?.uiRoundness ?? 100)) / 100));
  }, [settings?.theme]);

  const load = useCallback(async (root: string) => {
    const rootChanged = !requests.current.matchesRoot(root);
    const request = requests.current.begin(root);
    setLoading(true);
    setError("");
    setWorkspaceRoot(root);
    setProject(emptyProject);
    setSaved(null);
    setDraft(null);
    setModules([]);
    setModuleDraft({});
    setJdks([]);
    setAudit(null);
    setTasks([]);
    setFrameworks([]);
    setSelectedModuleId("");
    setBusy(false);
    if (rootChanged) {
      setNotice("");
      setSection("project");
    }
    try {
      const nextSettings = await window.kiwi!.settings.get();
      if (!requests.current.isCurrent(request)) return;
      setSettings(nextSettings);
      if (!root) return;
      const [info, moduleList, jdkList] = await Promise.all([
        window.kiwi!.project.detect(root),
        window.kiwi!.modules.list(root).catch(() => []),
        window.kiwi!.project.listJdks().catch(() => []),
      ]);
      if (!requests.current.isCurrent(request)) return;
      setProject(info);
      const projectSettings = info.projectSettings || null;
      setSaved(projectSettings);
      setDraft(projectSettings ? { ...projectSettings } : null);
      setModules(moduleList);
      setModuleDraft({});
      setSelectedModuleId((current) => moduleList.some((item) => item.id === current) ? current : moduleList[0]?.id || "");
      setJdks(jdkList);
      // The slower reads do not block the window: the SDK and the modules are
      // what someone opens this for.
      void window.kiwi!.project.auditDependencies(root)
        .then((result) => {
          if (requests.current.isCurrent(request)) setAudit(result);
        })
        .catch(() => {
          if (requests.current.isCurrent(request)) setAudit(null);
        });
      void window.kiwi!.project.tasks(root)
        .then((result) => {
          if (requests.current.isCurrent(request)) setTasks(result.tasks);
        })
        .catch(() => {
          if (requests.current.isCurrent(request)) setTasks([]);
        });
      void window.kiwi!.project.frameworkInfo(root)
        .then((result) => {
          if (requests.current.isCurrent(request)) setFrameworks(result.frameworks);
        })
        .catch(() => {
          if (requests.current.isCurrent(request)) setFrameworks([]);
        });
    } catch (reason) {
      if (!requests.current.isCurrent(request)) return;
      setError(reason instanceof Error ? reason.message : "Die Projektstruktur konnte nicht gelesen werden.");
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.kiwi) {
      setError("Kiwi API ist nicht verfügbar.");
      setLoading(false);
      return;
    }
    void load(initialRoot);
    const removeContext = window.kiwi.app.onSettingsContext(({ projectRoot }) => void load(projectRoot || ""));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      window.kiwi?.app.close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      requests.current.invalidate();
      removeContext();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [initialRoot, load]);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    return window.kiwi.settings.onChanged(({ settings: next }) => setSettings(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!settings?.backgroundImage || !window.kiwi) {
      setBackgroundImageData("");
      return;
    }
    void window.kiwi.settings.backgroundImageData(settings.backgroundImage)
      .then((data) => {
        if (!cancelled) setBackgroundImageData(data);
      })
      .catch(() => {
        if (!cancelled) setBackgroundImageData("");
      });
    return () => {
      cancelled = true;
    };
  }, [settings?.backgroundImage]);

  const selected = useMemo(
    () => modules.find((module) => module.id === selectedModuleId) || modules[0],
    [modules, selectedModuleId],
  );

  const projectChanges = useMemo(() => {
    if (!saved || !draft) return [] as Array<{ label: string; from: string; to: string }>;
    const rows: Array<{ label: string; from: string; to: string }> = [];
    const compare = (label: string, key: keyof ProjectSettings) => {
      const from = String(saved[key] ?? "");
      const to = String(draft[key] ?? "");
      if (from !== to) rows.push({ label, from: from || "—", to: to || "—" });
    };
    compare("Project SDK", "jdkPath");
    compare("Language Level", "languageLevel");
    compare("Encoding", "encoding");
    compare("Compiler-Argumente", "compilerArgs");
    return rows;
  }, [draft, saved]);

  const moduleChanges = useMemo(() => Object.entries(moduleDraft).flatMap(([id, patch]) => {
    const module = modules.find((item) => item.id === id);
    if (!module) return [];
    const rows: Array<{ label: string; from: string; to: string }> = [];
    if (patch.jdkPath !== undefined && patch.jdkPath !== module.jdkPath) {
      rows.push({ label: `${module.name} · SDK`, from: module.jdkPath || "—", to: patch.jdkPath || "Project SDK" });
    }
    if (patch.languageLevel !== undefined && patch.languageLevel !== module.languageLevel) {
      rows.push({ label: `${module.name} · Language Level`, from: module.languageLevel || "—", to: patch.languageLevel || "wie Projekt" });
    }
    return rows;
  }), [moduleDraft, modules]);

  const problems = useMemo(
    () => projectStructureProblems(project, saved, modules, jdks, audit),
    [audit, jdks, modules, project, saved],
  );

  const pending = [...projectChanges, ...moduleChanges];

  const apply = async () => {
    if (!workspaceRoot || !pending.length) return;
    const root = workspaceRoot;
    const request = requests.current.capture();
    const pendingCount = pending.length;
    const projectDraft = draft ? { ...draft } : null;
    const modulesAtApply = modules;
    const moduleDraftAtApply = { ...moduleDraft };
    setBusy(true);
    setError("");
    try {
      if (projectDraft && projectChanges.length) {
        await window.kiwi!.project.updateSettings(root, projectDraft);
        if (!requests.current.isCurrent(request)) return;
      }
      for (const [id, patch] of Object.entries(moduleDraftAtApply)) {
        const module = modulesAtApply.find((item) => item.id === id);
        if (!module) continue;
        const changed = (patch.jdkPath !== undefined && patch.jdkPath !== module.jdkPath)
          || (patch.languageLevel !== undefined && patch.languageLevel !== module.languageLevel);
        if (changed) {
          await window.kiwi!.modules.updateSettings(root, id, patch);
          if (!requests.current.isCurrent(request)) return;
        }
      }
      await load(root);
      if (!requests.current.matchesRoot(root)) return;
      const message = `${pendingCount} Änderung${pendingCount === 1 ? "" : "en"} übernommen.`;
      setNotice(message);
      const noticeRequest = requests.current.capture();
      window.setTimeout(() => {
        if (requests.current.isCurrent(noticeRequest)) setNotice("");
      }, 4000);
    } catch (reason) {
      if (!requests.current.isCurrent(request)) return;
      setError(reason instanceof Error ? reason.message : "Die Änderungen konnten nicht gespeichert werden.");
    } finally {
      if (requests.current.isCurrent(request)) setBusy(false);
    }
  };

  const discard = () => {
    setDraft(saved ? { ...saved } : null);
    setModuleDraft({});
  };

  const relative = (absolute: string) =>
    absolute.toLowerCase().startsWith(workspaceRoot.toLowerCase())
      ? absolute.slice(workspaceRoot.length).replace(/^[\\/]/, "") || "."
      : absolute;

  const sections: Array<[Section, string, React.ReactNode]> = [
    ["project", "Projekt", <Braces size={15} />],
    ["modules", `Module (${modules.length})`, <Blocks size={15} />],
    ["libraries", `Bibliotheken (${audit?.dependencies.length ?? 0})`, <Library size={15} />],
    ["sdks", `SDKs (${jdks.length})`, <Cpu size={15} />],
    ["build", `Build (${tasks.length})`, <Sparkles size={15} />],
    ["problems", `Probleme (${problems.length})`, <TriangleAlert size={15} />],
  ];

  return (
    <StandaloneWindowFrame
      title={t("Projektstruktur")}
      projectRoot={workspaceRoot}
      settings={settings}
      backgroundImageData={backgroundImageData}
      className="structure-window-shell"
    >
      {loading ? (
        <div className="settings-window-state">
          <span className="kiwi-spinner"><Blocks size={26} /></span>
          <strong>{t("Projektstruktur wird gelesen …")}</strong>
          <p>{t("Kiwi erkennt SDKs, Module, Bibliotheken und Build-Aufgaben.")}</p>
        </div>
      ) : !workspaceRoot ? (
        <div className="settings-window-state empty">
          <Blocks size={34} />
          <strong>{t("Kein Projekt geöffnet")}</strong>
          <p>{t("Öffne zuerst ein Projekt im Arbeitsbereich.")}</p>
        </div>
      ) : error && !draft ? (
        <div className="settings-window-state error">
          <TriangleAlert size={34} />
          <strong>{t("Projektstruktur konnte nicht geöffnet werden")}</strong>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load(workspaceRoot)}>{t("Erneut versuchen")}</button>
        </div>
      ) : (
        <section className="standalone-window-document structure-window-document" aria-labelledby="project-structure-window-title">
          <StandaloneDocumentHeader
            id="project-structure-window-title"
            icon={<Blocks size={19} />}
            title={t("Projektstruktur")}
            description="SDKs, Module, Bibliotheken und Build-Modell"
            actions={(
              <>
                <button onClick={() => void load(workspaceRoot)} title={t("Projektstruktur neu laden")} aria-label={t("Projektstruktur neu laden")}><RefreshCw size={16} /></button>
                <button onClick={() => window.kiwi?.app.close()} aria-label={t("Projektstruktur schließen")}><X size={17} /></button>
              </>
            )}
          />
          <div className="settings-layout project-structure-body">
            <StandaloneWindowNavigation label="Bereiche der Projektstruktur" className="project-structure-nav">
              <span className="standalone-window-nav-label">{t("Projektmodell")}</span>
              {sections.map(([id, label, icon]) => (
                <button key={id} className={section === id ? "active" : ""} title={label} onClick={() => setSection(id)}>
                  {icon}<span>{label}</span>
                </button>
              ))}
            </StandaloneWindowNavigation>

            <div className="settings-content project-structure-content">
              {section === "project" && draft && (
                <>
                  <StructureSetting title={t("Project SDK")} description="Wird für Build, Run, Tests und den Java-Compiler verwendet.">
                    <select value={draft.jdkPath} onChange={(event) => setDraft({ ...draft, jdkPath: event.target.value })}>
                      <option value="">{t("Globales SDK verwenden")}</option>
                      {jdks.map((jdk) => <option key={jdk.path} value={jdk.path}>Java {jdk.major} · {jdk.path}</option>)}
                      {draft.jdkPath && !jdks.some((jdk) => jdk.path === draft.jdkPath) && (
                        <option value={draft.jdkPath}>{draft.jdkPath}</option>
                      )}
                    </select>
                  </StructureSetting>
                  <StructureSetting title={t("Language Level")} description="Steuert Sprachfunktionen, --release und die Build-Toolchain.">
                    <select value={draft.languageLevel} onChange={(event) => setDraft({ ...draft, languageLevel: event.target.value })}>
                      {LANGUAGE_LEVELS.map((level) => <option key={level} value={level}>Java {level}</option>)}
                    </select>
                  </StructureSetting>
                  <StructureSetting title={t("Quelltext-Encoding")} description="Gilt für Java-Dateien, Ressourcen und Compiler-Ausgaben.">
                    <select value={draft.encoding} onChange={(event) => setDraft({ ...draft, encoding: event.target.value })}>
                      {["UTF-8", "ISO-8859-1", "US-ASCII", "windows-1252"].map((encoding) => (
                        <option key={encoding} value={encoding}>{encoding}</option>
                      ))}
                    </select>
                  </StructureSetting>
                  <StructureSetting title={t("Compiler-Argumente")} description="Zusätzliche Optionen für javac im aktuellen Projekt.">
                    <input
                      value={draft.compilerArgs}
                      onChange={(event) => setDraft({ ...draft, compilerArgs: event.target.value })}
                      placeholder={t("-Xlint:all")}
                      spellCheck={false}
                    />
                  </StructureSetting>
                  <dl className="structure-facts structure-summary-card">
                    <div><dt>{t("Build-System")}</dt><dd>{project.type}{project.buildFile ? ` · ${relative(project.buildFile)}` : ""}</dd></div>
                    <div><dt>{t("Erkanntes JDK")}</dt><dd>{project.javaVersion || "unbekannt"}</dd></div>
                    <div><dt>{t("Wrapper")}</dt><dd>{project.hasWrapper ? "vorhanden" : "nicht vorhanden"}</dd></div>
                    <div><dt>{t("Module")}</dt><dd>{modules.length}</dd></div>
                    <div><dt>{t("Offline-Modus")}</dt><dd>{project.mavenOffline || project.gradleOffline ? "aktiv" : "aus"}</dd></div>
                    <div><dt>{t("Preview-Features")}</dt><dd>{project.previewFeatures ? "aktiv" : "aus"}</dd></div>
                    <div><dt>{t("Build-Profile")}</dt><dd>{project.buildProfiles?.join(", ") || "keine"}</dd></div>
                    <div><dt>{t("Frameworks")}</dt><dd>{frameworks.join(", ") || "keine erkannt"}</dd></div>
                  </dl>
                </>
              )}

              {section === "modules" && (
                <div className="structure-modules">
                  <div className="structure-module-list">
                    {modules.map((module) => (
                      <button
                        key={module.id}
                        className={selected?.id === module.id ? "active" : ""}
                        onClick={() => setSelectedModuleId(module.id)}
                      >
                        <Blocks size={13} />
                        <span><strong>{module.name}</strong><small>{module.relativePath || "."}</small></span>
                      </button>
                    ))}
                    {!modules.length && <p className="structure-empty">{t("Keine Module erkannt.")}</p>}
                  </div>
                  {selected && (
                    <div className="structure-module-detail">
                      <StructureSetting title={t("Modul-SDK")} description="Überschreibt bei Bedarf das Project SDK für dieses Modul.">
                        <select
                          value={moduleDraft[selected.id]?.jdkPath ?? selected.jdkPath}
                          onChange={(event) => setModuleDraft((current) => ({
                            ...current,
                            [selected.id]: { ...current[selected.id], jdkPath: event.target.value },
                          }))}
                        >
                          <option value="">{t("Project SDK verwenden")}</option>
                          {jdks.map((jdk) => <option key={jdk.path} value={jdk.path}>Java {jdk.major} · {jdk.path}</option>)}
                        </select>
                      </StructureSetting>
                      <StructureSetting title={t("Language Level")} description="Kann pro Modul vom Projektwert abweichen.">
                        <select
                          value={moduleDraft[selected.id]?.languageLevel ?? selected.languageLevel}
                          onChange={(event) => setModuleDraft((current) => ({
                            ...current,
                            [selected.id]: { ...current[selected.id], languageLevel: event.target.value },
                          }))}
                        >
                          <option value="">{t("Wie das Projekt")}</option>
                          {LANGUAGE_LEVELS.map((level) => <option key={level} value={level}>Java {level}</option>)}
                        </select>
                      </StructureSetting>
                      <div className="structure-roots">
                        <h4>{t("Source Roots")}</h4>
                        <ul>{selected.sourceRoots.map((root) => <li key={root}>{relative(root)}</li>)}</ul>
                        <h4>{t("Test Roots")}</h4>
                        <ul>{selected.testRoots.map((root) => <li key={root}>{relative(root)}</li>)}</ul>
                        <h4>{t("Resources")}</h4>
                        <ul>{selected.resourceRoots.map((root) => <li key={root}>{relative(root)}</li>)}</ul>
                        <h4>{t("Test-Resources")}</h4>
                        <ul>
                          {selected.testResourceRoots.length
                            ? selected.testResourceRoots.map((root) => <li key={root}>{relative(root)}</li>)
                            : <li className="structure-muted">{t("keine")}</li>}
                        </ul>
                        <h4>{t("Ausgabeverzeichnis")}</h4>
                        <ul><li>{relative(selected.outputPath)}</li></ul>
                        <h4>{t("Abhängigkeiten")}</h4>
                        <ul>
                          {selected.dependencies.length
                            ? selected.dependencies.map((id) => <li key={id}>{id}</li>)
                            : <li className="structure-muted">{t("keine Modulabhängigkeiten")}</li>}
                        </ul>
                        {selected.jpms && (
                          <>
                            <h4>{t("JPMS")}</h4>
                            <ul>
                              <li>module {selected.jpms.name}</li>
                              {selected.jpms.requires.map((entry) => <li key={`r:${entry}`}>requires {entry}</li>)}
                              {selected.jpms.exports.map((entry) => <li key={`e:${entry}`}>exports {entry}</li>)}
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {section === "libraries" && (
                <div className="structure-libraries">
                  {!audit && <p className="structure-empty">{t("Abhängigkeiten werden gelesen …")}</p>}
                  {audit && !audit.dependencies.length && (
                    <p className="structure-empty">{t("Keine deklarierten Abhängigkeiten gefunden.")}</p>
                  )}
                  {audit?.dependencies.map((dependency) => {
                    const warning = audit.warnings.find((item) => item.coordinate === dependency.coordinate);
                    return (
                      <div className="structure-library" key={`${dependency.coordinate}:${dependency.version}`}>
                        <span>
                          <strong>{dependency.coordinate}</strong>
                          <small>{dependency.version || "Version extern verwaltet"}</small>
                        </span>
                        {warning && <em title={warning.message}>!</em>}
                      </div>
                    );
                  })}
                </div>
              )}

              {section === "sdks" && (
                <div className="structure-libraries">
                  {!jdks.length && <p className="structure-empty">{t("Kein JDK gefunden.")}</p>}
                  {jdks.map((jdk) => (
                    <div className="structure-library" key={jdk.path}>
                      <span>
                        <strong>Java {jdk.major}{jdk.path === saved?.jdkPath ? " · Project SDK" : ""}</strong>
                        <small>{jdk.version} · {jdk.path}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {section === "problems" && (
                <div className="structure-libraries">
                  {!problems.length && <p className="structure-empty">{t("Keine Konfigurationsprobleme gefunden.")}</p>}
                  {problems.map((problem, index) => (
                    <button
                      className={`structure-library structure-problem structure-problem-${problem.severity}`}
                      key={`${problem.section}:${problem.title}:${index}`}
                      onClick={() => setSection(problem.section)}
                    >
                      <span><strong>{problem.title}</strong><small>{problem.detail}</small></span>
                      <em>{problem.severity === "error" ? "Fehler" : "Warnung"}</em>
                    </button>
                  ))}
                </div>
              )}

              {section === "build" && (
                <div className="structure-libraries">
                  {!tasks.length && <p className="structure-empty">{t("Keine Build-Aufgaben gelesen.")}</p>}
                  {tasks.map((task) => (
                    <div className="structure-library" key={`${task.group || ""}:${task.name}`}>
                      <span><strong>{task.name}</strong><small>{task.description || task.group || ""}</small></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <StandaloneWindowFooter
            className={pending.length > 0 || Boolean(notice) || Boolean(error) ? "structure-apply-bar" : ""}
            status={error || notice || (pending.length
              ? `${pending.length} Änderung${pending.length === 1 ? "" : "en"} noch nicht angewendet`
              : "Alle Projekteinstellungen sind gespeichert")}
            tone={error ? "error" : notice || !pending.length ? "success" : "default"}
          >
            <button type="button" onClick={discard} disabled={busy || !pending.length}>
              <RotateCcw size={13} /> Verwerfen
            </button>
            <button className="primary-button" type="button" onClick={() => void apply()} disabled={busy || !pending.length}>
              <Check size={14} /> {busy ? t("Wird angewendet …") : t("Übernehmen")}
            </button>
          </StandaloneWindowFooter>
        </section>
      )}
    </StandaloneWindowFrame>
  );
}

function StructureSetting({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <label className="setting-row structure-setting-row">
      <div><strong>{title}</strong><p>{description}</p></div>
      <div className="setting-control">{children}</div>
    </label>
  );
}
