import { CircleAlert, ExternalLink, Loader, Package, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AddDependencyOptions, VersionCatalogInfo } from "../types";
import { buildFileLabel, mvnRepositoryUrl } from "../language/build-files";
import { t } from "../i18n";

export interface DependencyCandidate {
  groupId: string;
  artifactId: string;
  version: string;
  packaging: string;
  updatedAt: number;
}

const MAVEN_SCOPES = ["compile", "provided", "runtime", "test"];
const GRADLE_CONFIGURATIONS = ["implementation", "api", "compileOnly", "runtimeOnly", "testImplementation"];

/**
 * What a key press does in the dependency dialog.
 *
 * Pasting a coordinate and pressing Enter is the fastest way there is to add a
 * library, and it did nothing at all — the hands had to leave the keyboard for
 * the button. Up and down walk the results the way every other list in Kiwi
 * does, and Enter on a list that nothing is chosen from takes the first
 * result, which is the one the search ranked highest.
 */
export function dependencyKeyAction({ key, hasTarget, resultCount, cursor, busy }: {
  key: string;
  hasTarget: boolean;
  resultCount: number;
  cursor: number;
  busy?: boolean;
}): { action: "add" | "move" | "none"; index: number } {
  const none = { action: "none" as const, index: cursor };
  if (busy) return none;
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (!resultCount) return none;
    const index = key === "ArrowDown"
      ? Math.min(resultCount - 1, cursor + 1)
      : Math.max(0, cursor - 1);
    return index === cursor ? none : { action: "move", index };
  }
  if (key !== "Enter") return none;
  if (hasTarget) return { action: "add", index: cursor };
  return resultCount ? { action: "move", index: 0 } : none;
}

/**
 * What the dialog should do with the text in the search field.
 *
 * Only a coordinate with a version is ready to be added without asking
 * anything further. "groupId:artifactId" used to count as one too, and that is
 * exactly the shape somebody types on the way to finding a version: the dialog
 * stopped searching, hid the result list, and asked for a version it gave no
 * way of discovering. Without a version it is a search term — a precise one.
 */
export function dependencyQueryIntent(query: string): {
  coordinate: { groupId: string; artifactId: string; version: string } | null;
  search: string;
} {
  const text = String(query || "").trim();
  const match = text.match(/^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+):([A-Za-z0-9._+-]+)$/);
  if (match) {
    return { coordinate: { groupId: match[1], artifactId: match[2], version: match[3] }, search: "" };
  }
  // One letter matches most of Maven Central; the search waits for a second.
  return { coordinate: null, search: text.length >= 2 ? text : "" };
}

/**
 * Adds a library without leaving the IDE.
 *
 * Adding a dependency used to mean switching to a browser, looking up the
 * coordinates and typing the block into the build file by hand. The search
 * needs the network, so the dialog stays usable without it: the coordinates
 * can always be typed in directly.
 */
export function DependencyDialog({
  buildType,
  onSearch,
  onVersions,
  onAdd,
  onClose,
  buildFiles = [],
  initialBuildFile = "",
  workspaceRoot = "",
  catalogs = [],
}: {
  buildType: string;
  onSearch: (query: string) => Promise<DependencyCandidate[]>;
  onVersions: (groupId: string, artifactId: string) => Promise<string[]>;
  onAdd: (coordinates: { groupId: string; artifactId: string; version: string }, scope: string, options?: AddDependencyOptions) => Promise<void>;
  onClose: () => void;
  buildFiles?: string[];
  /** Preselected module, for the entry that opens this from a module's own menu. */
  initialBuildFile?: string;
  workspaceRoot?: string;
  catalogs?: VersionCatalogInfo[];
}) {
  const gradle = buildType === "Gradle";
  const scopes = gradle ? GRADLE_CONFIGURATIONS : MAVEN_SCOPES;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DependencyCandidate[]>([]);
  const [selected, setSelected] = useState<DependencyCandidate | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState("");
  const [scope, setScope] = useState(gradle ? "implementation" : "compile");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [buildFile, setBuildFile] = useState(initialBuildFile || buildFiles[0] || "");
  // Which result the arrow keys are on. -1 until somebody moves, so a search
  // that has just come back does not pick for the reader.
  const [cursor, setCursor] = useState(-1);
  const [useVersionCatalog, setUseVersionCatalog] = useState(false);
  const [catalogPath, setCatalogPath] = useState(catalogs[0]?.path || "");
  const [alias, setAlias] = useState("");
  const [versionKey, setVersionKey] = useState("");

  const resultsRef = useRef<HTMLDivElement | null>(null);
  // The coordinate whose version list is being waited for.
  const requestedRef = useRef("");
  // The text the search that is still wanted was made for.
  const requestedQueryRef = useRef("");

  // Keep the row the arrow keys are on where it can be seen. "nearest" moves
  // the list only when it has to, so walking a visible list does not scroll.
  useEffect(() => {
    if (cursor < 0) return;
    const row = resultsRef.current?.children[cursor];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  useEffect(() => {
    if (!buildFile && buildFiles[0]) setBuildFile(buildFiles[0]);
    if (!catalogPath && catalogs[0]) setCatalogPath(catalogs[0].path);
  }, [buildFile, buildFiles, catalogPath, catalogs]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const intent = useMemo(() => dependencyQueryIntent(query), [query]);
  const pasted = intent.coordinate;

  useEffect(() => {
    const text = intent.search;
    if (!text) {
      setResults([]);
      return;
    }
    // Answers arrive in whatever order the network decides, so one that has
    // been typed past must not land on top of a newer one. What decides that
    // is the text searched for, not this effect: onSearch is made afresh on
    // every render of the workbench, so the effect is torn down and set up
    // again for reasons that have nothing to do with the search. Tying it to
    // the effect threw away the answer to the very query that was still in the
    // box — and the search only worked when it was typed a second time.
    requestedQueryRef.current = text;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const found = await onSearch(text);
        if (requestedQueryRef.current === text) setResults(found);
      } catch (reason) {
        if (requestedQueryRef.current === text) {
          setError(reason instanceof Error ? reason.message : "Suche fehlgeschlagen.");
          setResults([]);
        }
      } finally {
        if (requestedQueryRef.current === text) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [intent.search, onSearch]);

  const choose = async (candidate: DependencyCandidate) => {
    const coordinate = `${candidate.groupId}:${candidate.artifactId}`;
    requestedRef.current = coordinate;
    setSelected(candidate);
    setVersion(candidate.version);
    setVersions([candidate.version]);
    try {
      const published = await onVersions(candidate.groupId, candidate.artifactId);
      // Walking the list with the arrow keys asks for one of these per result,
      // and they come back in whatever order the network decides. Only the
      // answer for the entry that is still chosen may be shown — otherwise the
      // version list belongs to a library that is no longer selected.
      if (published.length && requestedRef.current === coordinate) setVersions(published);
    } catch {
      // The latest version from the search result is enough to continue with.
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // A button under the finger keeps its own Enter. Taking it here would make
    // the close button add a dependency.
    if (event.key === "Enter" && event.target instanceof HTMLButtonElement) return;
    const decision = dependencyKeyAction({
      key: event.key,
      hasTarget: Boolean(target),
      resultCount: results.length,
      cursor,
      busy,
    });
    if (decision.action === "none") return;
    event.preventDefault();
    if (decision.action === "add") {
      void add();
      return;
    }
    setCursor(decision.index);
    void choose(results[decision.index]);
  };

  const target = selected
    ? { groupId: selected.groupId, artifactId: selected.artifactId, version }
    : pasted
      ? pasted
      : null;

  const add = async () => {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const normalizedAlias = (alias || target.artifactId).replace(/[^A-Za-z0-9_.-]/g, "-");
      await onAdd(target, scope, {
        buildFile: buildFile || undefined,
        useVersionCatalog: gradle && useVersionCatalog,
        catalogPath: gradle && useVersionCatalog ? catalogPath || undefined : undefined,
        alias: gradle && useVersionCatalog ? normalizedAlias : undefined,
        versionKey: gradle && useVersionCatalog
          ? (versionKey || normalizedAlias).replace(/[^A-Za-z0-9_.-]/g, "-")
          : undefined,
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Abhängigkeit konnte nicht hinzugefügt werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dependency-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="dependency-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header>
          <Package size={17} />
          <span>
            <strong id="dependency-dialog-title">{t("Abhängigkeit hinzufügen")}</strong>
            <small>{buildFile ? `${t("Wird eingetragen in")} ${buildFileLabel(buildFile, workspaceRoot)}` : gradle ? "Wird in build.gradle eingetragen" : "Wird in pom.xml eingetragen"}</small>
          </span>
          <button onClick={onClose} aria-label={t("Schließen")}><X size={16} /></button>
        </header>

        <label className="dependency-search">
          {searching ? <Loader size={14} className="spinning" /> : <Search size={14} />}
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setCursor(-1);
            }}
            placeholder={t("Name suchen oder groupId:artifactId:version einfügen")}
            spellCheck={false}
          />
        </label>

        {pasted && (
          <p className="dependency-pasted">
            {`Koordinaten erkannt: ${pasted.groupId}:${pasted.artifactId}:${pasted.version}`}
          </p>
        )}

        {!pasted && (
          <div className="dependency-results" ref={resultsRef}>
            {results.length === 0 && !searching && query.trim().length >= 2 && !error && (
              <p className="dependency-empty">{t("Nichts gefunden.")}</p>
            )}
            {results.map((candidate) => (
              <div
                key={`${candidate.groupId}:${candidate.artifactId}`}
                className={`dependency-result ${selected?.artifactId === candidate.artifactId && selected?.groupId === candidate.groupId ? "active" : ""}`}
              >
                <button type="button" onClick={() => void choose(candidate)}>
                  <strong>{candidate.artifactId}</strong>
                  <small>{candidate.groupId}</small>
                  <span>{candidate.version}</span>
                </button>
                {/* The page a human reads before deciding. It cannot be searched
                    from here — mvnrepository.com answers a program with a bot
                    challenge — but it is one click away. */}
                <button
                  type="button"
                  className="dependency-result-link"
                  title={t("Auf mvnrepository.com ansehen")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void window.kiwi?.app.openArtifactPage(
                      mvnRepositoryUrl(candidate.groupId, candidate.artifactId, candidate.version),
                    ).catch(() => undefined);
                  }}
                ><ExternalLink size={13} /></button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="dependency-error"><CircleAlert size={13} /> {error}</p>}

        {(buildFiles.length > 0 || (gradle && catalogs.length > 0)) && (
          <div className="dependency-target-options">
            {buildFiles.length > 0 && (
              <label>
                <span>{t("Modul")}</span>
                {/* Every build file in a multi-project build is called the
                    same thing, so the module is what the entry says. */}
                <select value={buildFile} onChange={(event) => setBuildFile(event.target.value)}>
                  {buildFiles.map((file) => (
                    <option key={file} value={file}>{buildFileLabel(file, workspaceRoot)}</option>
                  ))}
                </select>
              </label>
            )}
            {gradle && catalogs.length > 0 && (
              <>
                <label className="dependency-catalog-toggle">
                  <input type="checkbox" checked={useVersionCatalog} onChange={(event) => setUseVersionCatalog(event.target.checked)} />
                  <span>{t("Gradle Version Catalog verwenden")}</span>
                </label>
                {useVersionCatalog && (
                  <div className="dependency-catalog-fields">
                    <select value={catalogPath} onChange={(event) => setCatalogPath(event.target.value)} aria-label={t("Versionskatalog")}>
                      {catalogs.map((catalog) => <option key={catalog.path} value={catalog.path}>{catalog.name}</option>)}
                    </select>
                    <input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder={target?.artifactId || "Alias"} aria-label={t("Library-Alias")} />
                    <input value={versionKey} onChange={(event) => setVersionKey(event.target.value)} placeholder={t("Versionsschlüssel")} aria-label={t("Versionsschlüssel")} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <footer>
          {selected && (
            <select value={version} onChange={(event) => setVersion(event.target.value)} aria-label={t("Version")}>
              {versions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          )}
          <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label={gradle ? "Konfiguration" : "Scope"}>
            {scopes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          {!target && (
            <small className="dependency-hint">
              {query.trim().length < 2
                ? t("Namen eingeben oder groupId:artifactId:version einfügen.")
                : t("Einen Treffer auswählen — oder die vollständige Koordinate einfügen.")}
            </small>
          )}
          <button className="primary-button" disabled={!target || busy} onClick={() => void add()}>
            {busy ? "Wird eingetragen…" : "Hinzufügen"}
          </button>
        </footer>
      </div>
    </div>
  );
}
