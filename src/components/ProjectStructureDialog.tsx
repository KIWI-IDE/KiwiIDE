import { Blocks, Braces, Library, X } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "../i18n";
import type { DependencyAudit, JdkInfo, ModuleInfo, ProjectInfo, ProjectSettings } from "../types";
import { JAVA_LANGUAGE_LEVELS } from "../language-levels";

type Section = "project" | "modules" | "libraries";

/**
 * Project structure, in the spirit of IntelliJ's dialog of the same name:
 * the project SDK and language level, the modules with their roots and
 * dependencies, and the declared libraries — all in one place instead of
 * spread over settings, the modules sidebar and the dependency view.
 */
export function ProjectStructureDialog({
  workspaceRoot,
  project,
  projectSettings,
  modules,
  jdks,
  audit,
  onProjectChange,
  onModuleChange,
  onClose,
}: {
  workspaceRoot: string;
  project: ProjectInfo;
  projectSettings: ProjectSettings;
  modules: ModuleInfo[];
  jdks: JdkInfo[];
  audit: DependencyAudit | null;
  onProjectChange: (patch: Partial<ProjectSettings>) => void;
  onModuleChange: (moduleId: string, patch: { jdkPath?: string; languageLevel?: string }) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>("project");
  const [selectedModuleId, setSelectedModuleId] = useState(modules[0]?.id || "");
  const selected = useMemo(
    () => modules.find((module) => module.id === selectedModuleId) || modules[0],
    [modules, selectedModuleId],
  );
  const relative = (absolute: string) =>
    absolute.toLowerCase().startsWith(workspaceRoot.toLowerCase())
      ? absolute.slice(workspaceRoot.length).replace(/^[\\/]/, "") || "."
      : absolute;

  const sections: Array<[Section, string, React.ReactNode]> = [
    ["project", t("Projekt"), <Braces size={15} />],
    ["modules", `${t("Module")} (${modules.length})`, <Blocks size={15} />],
    ["libraries", `${t("Bibliotheken")} (${audit?.dependencies.length ?? 0})`, <Library size={15} />],
  ];

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="modal project-structure-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-structure-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <Blocks size={17} />
            <strong id="project-structure-title">{t("Projektstruktur")}</strong>
            <small>{workspaceRoot || t("Kein Projekt geöffnet")}</small>
          </div>
          <button onClick={onClose} aria-label={t("Schließen")}><X size={16} /></button>
        </div>

        <div className="project-structure-body">
          <nav className="project-structure-nav">
            {sections.map(([id, label, icon]) => (
              <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
                {icon}<span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="project-structure-content">
            {section === "project" && (
              <>
                <label className="structure-row">
                  <span>{t("Project SDK")}</span>
                  <select
                    value={projectSettings.jdkPath}
                    disabled={!workspaceRoot}
                    onChange={(event) => onProjectChange({ jdkPath: event.target.value })}
                  >
                    <option value="">{t("Globales SDK verwenden")}</option>
                    {jdks.map((jdk) => <option key={jdk.path} value={jdk.path}>Java {jdk.major} · {jdk.path}</option>)}
                    {projectSettings.jdkPath && !jdks.some((jdk) => jdk.path === projectSettings.jdkPath) && (
                      <option value={projectSettings.jdkPath}>{projectSettings.jdkPath}</option>
                    )}
                  </select>
                </label>
                <label className="structure-row">
                  <span>{t("Language Level")}</span>
                  <select
                    value={projectSettings.languageLevel}
                    disabled={!workspaceRoot}
                    onChange={(event) => onProjectChange({ languageLevel: event.target.value })}
                  >
                    {JAVA_LANGUAGE_LEVELS.map((level) => (
                      <option key={level} value={level}>Java {level}</option>
                    ))}
                  </select>
                </label>
                <label className="structure-row">
                  <span>{t("Encoding")}</span>
                  <select
                    value={projectSettings.encoding}
                    disabled={!workspaceRoot}
                    onChange={(event) => onProjectChange({ encoding: event.target.value })}
                  >
                    {["UTF-8", "ISO-8859-1", "US-ASCII", "windows-1252"].map((encoding) => (
                      <option key={encoding} value={encoding}>{encoding}</option>
                    ))}
                  </select>
                </label>
                <dl className="structure-facts">
                  <div><dt>{t("Build-System")}</dt><dd>{project.type}{project.buildFile ? ` · ${project.buildFile}` : ""}</dd></div>
                  <div><dt>{t("Erkanntes JDK")}</dt><dd>{project.javaVersion || "unbekannt"}</dd></div>
                  <div><dt>{t("Wrapper")}</dt><dd>{project.hasWrapper ? "vorhanden" : "nicht vorhanden"}</dd></div>
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
                    <label className="structure-row">
                      <span>{t("Modul-SDK")}</span>
                      <select
                        value={selected.jdkPath}
                        onChange={(event) => onModuleChange(selected.id, { jdkPath: event.target.value })}
                      >
                        <option value="">{t("Project SDK verwenden")}</option>
                        {jdks.map((jdk) => <option key={jdk.path} value={jdk.path}>Java {jdk.major} · {jdk.path}</option>)}
                      </select>
                    </label>
                    <label className="structure-row">
                      <span>{t("Language Level")}</span>
                      <select
                        value={selected.languageLevel}
                        onChange={(event) => onModuleChange(selected.id, { languageLevel: event.target.value })}
                      >
                        <option value="">{t("Wie das Projekt")}</option>
                        {JAVA_LANGUAGE_LEVELS.map((level) => (
                          <option key={level} value={level}>Java {level}</option>
                        ))}
                      </select>
                    </label>
                    <div className="structure-roots">
                      <h4>{t("Source Roots")}</h4>
                      <ul>{selected.sourceRoots.map((root) => <li key={root}>{relative(root)}</li>)}</ul>
                      <h4>{t("Test Roots")}</h4>
                      <ul>{selected.testRoots.map((root) => <li key={root}>{relative(root)}</li>)}</ul>
                      <h4>{t("Resources")}</h4>
                      <ul>{selected.resourceRoots.map((root) => <li key={root}>{relative(root)}</li>)}</ul>
                      <h4>{t("Abhängigkeiten")}</h4>
                      <ul>
                        {selected.dependencies.length
                          ? selected.dependencies.map((id) => <li key={id}>{id}</li>)
                          : <li className="structure-muted">{t("keine Modulabhängigkeiten")}</li>}
                      </ul>
                      {selected.jpms && (
                        <>
                          <h4>{t("JPMS")}</h4>
                          <ul><li>module {selected.jpms.name}</li></ul>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {section === "libraries" && (
              <div className="structure-libraries">
                {!audit && <p className="structure-empty">{t("Abhängigkeiten werden geladen …")}</p>}
                {audit && !audit.dependencies.length && (
                  <p className="structure-empty">{t("Keine deklarierten Abhängigkeiten gefunden.")}</p>
                )}
                {audit?.dependencies.map((dependency) => {
                  const warning = audit.warnings.find((item) => item.coordinate === dependency.coordinate);
                  return (
                    <div className="structure-library" key={`${dependency.coordinate}:${dependency.version}`}>
                      <span><strong>{dependency.coordinate}</strong><small>{dependency.version || "Version extern verwaltet"}</small></span>
                      {warning && <em title={warning.message}>!</em>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="primary-button" onClick={onClose}>{t("Schließen")}</button>
        </div>
      </div>
    </div>
  );
}
