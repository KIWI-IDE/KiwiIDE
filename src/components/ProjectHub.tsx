import { Download, FolderOpen, GitBranch, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2, TriangleAlert, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceProject, WorkspaceState } from "../types";
import { mergeProjectList } from "../projects/project-list";
import { buildTypeLabel, filterProjects, lastOpenedLabel } from "../projects/project-summary";
import { KiwiLogo } from "./KiwiLogo";
import { t } from "../i18n";

interface ProjectHubProps {
  workspace: WorkspaceState;
  recentProjects: string[];
  onOpen: () => void;
  onCreate: () => void;
  onCloneFromGit: () => void;
  onOpenProject: (root: string) => void;
  onTogglePinned: (project: WorkspaceProject) => void;
  onRemove: (root: string) => void;
  onRename: (project: WorkspaceProject) => void;
  onRelocate: (root: string) => void;
  onSettings: () => void;
  onJoinCollab: () => void;
}

export function ProjectHub({
  workspace,
  recentProjects,
  onOpen,
  onCreate,
  onCloneFromGit,
  onOpenProject,
  onTogglePinned,
  onRemove,
  onRename,
  onRelocate,
  onSettings,
  onJoinCollab,
}: ProjectHubProps) {
  // The same list the switcher in the title bar shows. It used to be built
  // here and nowhere else, so a project could be in one and not the other.
  const merged = useMemo(() => mergeProjectList(workspace, recentProjects), [recentProjects, workspace]);
  const [query, setQuery] = useState("");
  /**
   * What each project is built with, read once per project.
   *
   * Four rows that differ only in their name are four rows somebody has to
   * read the path of. Detecting a project is a handful of file reads, so it
   * happens for all of them at once and fills the rows in as it lands.
   */
  const [types, setTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(merged.filter((project) => project.exists).map(async (project) => {
      const info = await window.kiwi?.project.detect(project.root).catch(() => null);
      return [project.root, info?.type || ""] as const;
    })).then((pairs) => {
      if (cancelled) return;
      setTypes(Object.fromEntries(pairs.filter(([, type]) => type)));
    });
    return () => {
      // A hub closed while this was in flight has nothing to fill in.
      cancelled = true;
    };
  }, [merged]);

  const shown = filterProjects(merged, query);
  // A search box on four rows is furniture; on twenty it is the only way in.
  const searchable = merged.length >= 6;

  return (
    <main className="project-hub">
      {/* The bands of colour the splash drifts, running off the edges behind
          the list. Gradients rather than an image, so nothing is waited for. */}
      <div className="hub-art" aria-hidden="true"><i className="one" /><i className="two" /><i className="three" /></div>

      <section className="hub-hero">
        <h1 className="hub-lockup">Kiwi<em>IDE</em><span>{__APP_VERSION__}</span></h1>
        <div className="hub-intro">
        <p>{t("Eine lokale Hybrid-IDE für Java, Kotlin, Python, Rust, Webentwicklung, Lua, Go und die C-Sprachen.")}</p>
        <div className="hub-actions">
          <button type="button" className="primary-button" onClick={onOpen}><FolderOpen size={17} /> {t("Projekt öffnen")}</button>
          <button type="button" className="secondary-button" onClick={onCreate}><Plus size={17} /> {t("Neues Projekt")}</button>
          <button type="button" className="secondary-button" onClick={onOpen}><Download size={17} /> {t("Importieren")}</button>
          <button type="button" className="secondary-button" onClick={onCloneFromGit}><GitBranch size={17} /> {t("Von Git klonen")}</button>
          <button type="button" className="secondary-button" onClick={onJoinCollab}><Users size={17} /> CodeToGetter</button>
          <button type="button" className="quiet-button" onClick={onSettings}><Settings size={16} /> {t("Einstellungen")}</button>
        </div>
        </div>
        <div className="hub-maker">
          <KiwiLogo size={30} />
          {/* The name is set in caps, the category is not: uppercasing it too
              turned "IDEs" into "IDES", which reads as a different word. */}
          <b>Kiwi&nbsp;<i>IDEs</i></b>
        </div>
      </section>

      <section className="hub-recents" aria-label={t("Letzte Projekte")}>
        <header>
          <div>
            <span className="eyebrow">{t("WORKSPACE")}</span>
            <h2>{t("Projekte")}</h2>
          </div>
          <small>{merged.length ? `${merged.length} zuletzt verwendet` : "Noch keine Projekte"}</small>
        </header>
        {searchable && (
          <label className="hub-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Projekt suchen — Name oder Pfad")}
              aria-label={t("Projekt suchen — Name oder Pfad")}
            />
          </label>
        )}
        {merged.length === 0 ? (
          <div className="hub-empty">
            <FolderOpen size={32} />
            <strong>{t("Dein Workspace ist noch leer")}</strong>
            <p>{t("Öffne ein bestehendes Projekt oder wähle eine Sprache im Projektassistenten.")}</p>
          </div>
        ) : (
          <div className="hub-project-list">
            {shown.length === 0 && (
              <p className="hub-no-match">{t("Kein Projekt passt zu dieser Suche.")}</p>
            )}
            {shown.map((project) => (
              <article className={`hub-project ${project.exists ? "" : "missing"}`} key={project.root}>
                <button type="button" className="hub-project-main" data-project-root={project.root} onClick={() => project.exists && onOpenProject(project.root)}>
                  <span className="hub-project-icon">{project.exists ? project.name.slice(0, 1).toUpperCase() : <TriangleAlert size={18} />}</span>
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.exists ? project.root : `Nicht gefunden · ${project.root}`}</small>
                    {/* What it is and when it was last open: the two things
                        that tell four similar-looking rows apart. */}
                    <span className="hub-project-facts">
                      {buildTypeLabel(types[project.root]) && <em>{buildTypeLabel(types[project.root])}</em>}
                      {lastOpenedLabel(project.lastOpenedAt) && <i>{t(lastOpenedLabel(project.lastOpenedAt))}</i>}
                      {project.pinned && <b>{t("Angeheftet")}</b>}
                    </span>
                  </span>
                </button>
                <div className="hub-project-actions">
                  {!project.exists && <button type="button" onClick={() => onRelocate(project.root)}>{t("Neu zuordnen")}</button>}
                  <button
                    type="button"
                    data-project-action="rename"
                    aria-label={`${project.name} umbenennen`}
                    title={t("Umbenennen")}
                    onClick={() => onRename(project)}
                  ><Pencil size={15} /></button>
                  <button
                    type="button"
                    data-project-action="pin"
                    aria-label={`${project.name} ${project.pinned ? "loslösen" : "anheften"}`}
                    aria-pressed={project.pinned}
                    title={project.pinned ? t("Loslösen") : t("Anheften")}
                    onClick={() => onTogglePinned(project)}
                  >
                    {project.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                  <button
                    type="button"
                    data-project-action="remove"
                    aria-label={`${project.name} aus Liste entfernen`}
                    title={t("Aus Liste entfernen")}
                    onClick={() => onRemove(project.root)}
                  ><Trash2 size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer>
        <div className="hub-rule"><b /></div>
        <div className="hub-caption">
          <strong>Kiwi IDE {__APP_VERSION__}</strong>
          <span>Java · Kotlin · Python · Rust · PHP · Lua · Go · C · C++ · C# · Objective-C</span>
        </div>
      </footer>
    </main>
  );
}
