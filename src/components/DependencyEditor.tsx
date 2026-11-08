import { CircleAlert, ExternalLink, Package, RefreshCw, Save, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DependencyEditorModel,
  DependencySelector,
  EditableDependency,
  VulnerabilityFinding,
  VulnerabilityReport,
} from "../types";
import { t } from "../i18n";

type Props = {
  /** Needed to ask about this project's declarations, nothing else. */
  workspaceRoot: string;
  model: DependencyEditorModel | null;
  loading: boolean;
  error: string;
  onAdd: () => void;
  onRefresh: () => void;
  onUpdate: (dependency: EditableDependency, version: string) => Promise<void>;
  onRemove: (selector: DependencySelector) => Promise<void>;
  onUpdateCatalog: (catalogPath: string, key: string, version: string) => Promise<void>;
};

const dependencySelector = (dependency: EditableDependency): DependencySelector => ({
  id: dependency.id,
  groupId: dependency.groupId,
  artifactId: dependency.artifactId,
  buildFile: dependency.buildFile,
  configuration: dependency.configuration || dependency.scope,
  managed: dependency.managed,
  catalogAlias: dependency.catalogAlias,
});

/**
 * One editor for Maven declarations, dependencyManagement and Gradle version
 * catalogs. Mutations are deliberately delegated to the main process: the UI
 * never tries to rewrite XML, Gradle or TOML itself.
 */
export function DependencyEditor({
  workspaceRoot,
  model,
  loading,
  error,
  onAdd,
  onRefresh,
  onUpdate,
  onRemove,
  onUpdateCatalog,
}: Props) {
  const [query, setQuery] = useState("");
  const [scanResult, setScanResult] = useState<{ key: string; report: VulnerabilityReport } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [catalogVersions, setCatalogVersions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const scanKey = JSON.stringify([
    workspaceRoot,
    model?.buildFiles,
    model?.dependencies.map(({ groupId, artifactId, version, declaredVersion }) => [groupId, artifactId, version, declaredVersion]),
  ]);
  const currentScanKey = useRef(scanKey);
  currentScanKey.current = scanKey;
  const scanRequest = useRef(0);
  // Hide an old answer immediately, including the render before effects run.
  const report = scanResult?.key === scanKey ? scanResult.report : null;

  useEffect(() => {
    setVersions(Object.fromEntries((model?.dependencies || []).map((dependency) => [dependency.id, dependency.version || dependency.declaredVersion])));
    setCatalogVersions(Object.fromEntries((model?.catalogs || []).flatMap((catalog) =>
      catalog.versions.map((entry) => [`${catalog.path}:${entry.key}`, entry.version]),
    )));
  }, [model]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return model?.dependencies || [];
    return (model?.dependencies || []).filter((dependency) => [
      dependency.groupId,
      dependency.artifactId,
      dependency.version,
      dependency.scope,
      dependency.configuration,
      dependency.catalogAlias,
      dependency.versionKey,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(needle)));
  }, [model?.dependencies, query]);

  /**
   * The findings, by `groupId:artifactId`, so a row can wear its own badge
   * without the list being searched again for every row drawn.
   */
  const byDependency = useMemo(() => {
    const grouped = new Map<string, VulnerabilityFinding[]>();
    for (const finding of report?.findings || []) {
      const coordinate = `${finding.dependency}@${finding.version}`;
      const list = grouped.get(coordinate) || [];
      list.push(finding);
      grouped.set(coordinate, list);
    }
    return grouped;
  }, [report]);

  /* A new version in the same pom.xml also invalidates the old answer. */
  useEffect(() => {
    scanRequest.current += 1;
    setScanResult(null);
    setScanning(false);
    return () => { scanRequest.current += 1; };
  }, [scanKey]);

  const scan = async (force = false) => {
    if (!workspaceRoot || scanning) return;
    const request = ++scanRequest.current;
    setScanning(true);
    try {
      const result = await window.kiwi!.security.scan(workspaceRoot, force);
      if (request === scanRequest.current && currentScanKey.current === scanKey) {
        setScanResult(result ? { key: scanKey, report: result } : null);
      }
    } catch {
      // The service already answers "not reachable" rather than throwing; this
      // is the belt for the braces, and silence is the right outcome.
      if (request === scanRequest.current) setScanResult(null);
    } finally {
      if (request === scanRequest.current) setScanning(false);
    }
  };

  const mutate = async (key: string, action: () => Promise<void>) => {
    scanRequest.current += 1;
    setScanResult(null);
    setScanning(false);
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="dependency-editor">
      <div className="dependency-editor-toolbar">
        <button className="dependency-add" onClick={onAdd} disabled={loading}>
          <Package size={13} /> Abhängigkeit hinzufügen
        </button>
        <label>
          <Search size={12} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Dependencies filtern")} />
        </label>
        <button
          className="dependency-scan"
          onClick={() => void scan(Boolean(report))}
          disabled={loading || scanning || Boolean(busy) || !model}
          title={t("Abhängigkeiten gegen die OSV-Datenbank prüfen")}
        >
          <ShieldAlert size={13} className={scanning ? "spin" : ""} />
          {scanning ? t("Wird geprüft …") : t("Schwachstellen prüfen")}
        </button>
        <button className="icon-button" onClick={onRefresh} disabled={loading} title={t("Neu laden")} aria-label={t("Dependencies neu laden")}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>

      {report && !report.complete && (
        <div className="dependency-editor-error">
          <CircleAlert size={13} />
          <span>
            {t("Prüfung unvollständig.")} {report.checkedDependencies}/{report.totalDependencies} {t("Abhängigkeiten vollständig geprüft.")}
            {!report.reachable && ` ${t("Die Schwachstellen-Datenbank konnte nicht vollständig abgefragt werden.")}`}
            {report.skippedDependencies > 0 && ` ${report.skippedDependencies} ${t("Abhängigkeiten ohne aufgelöste Version übersprungen.")}`}
          </span>
        </div>
      )}
      {report && report.totalDependencies === 0 && (
        <div className="dependency-editor-state">{t("Keine Abhängigkeiten zum Prüfen vorhanden.")}</div>
      )}
      {report?.checked && report.complete && !report.findings.length && (
        <div className="dependency-scan-clean">
          <ShieldCheck size={14} /> {t("Keine bekannten Schwachstellen in den geprüften Versionen.")}
        </div>
      )}
      {report && report.findings.length > 0 && (
        <div className="dependency-scan-findings">
          {report.findings.map((finding) => (
            <article className={`dependency-finding sev-${finding.severity.toLowerCase()}`} key={`${finding.dependency}-${finding.osvId}`}>
              <div className="dependency-finding-head">
                <span className="dependency-finding-severity">{finding.severity}</span>
                <strong>{finding.dependency}</strong>
                <span className="dependency-finding-version">{finding.version}</span>
                <button
                  type="button"
                  className="icon-button"
                  title={t("Advisory öffnen")}
                  aria-label={t("Advisory öffnen")}
                  onClick={() => void window.kiwi?.app.openUpdate(finding.url)}
                ><ExternalLink size={12} /></button>
              </div>
              <p>{finding.summary}</p>
              <small>
                {finding.id}
                {finding.fixedIn.length > 0 && ` · ${t("behoben in")} ${finding.fixedIn.join(", ")}`}
              </small>
            </article>
          ))}
        </div>
      )}

      {error && <div className="dependency-editor-error"><CircleAlert size={13} /> {error}</div>}
      {!error && loading && !model && <div className="dependency-editor-state"><RefreshCw size={16} className="spin" /> {t("Buildmodell wird gelesen …")}</div>}

      {model && (
        <div className="dependency-editor-content">
          <section>
            <header><strong>{t("Deklarationen")}</strong><span>{visible.length}</span></header>
            {!visible.length && <div className="dependency-editor-state">{t("Keine passenden Abhängigkeiten.")}</div>}
            {visible.map((dependency) => {
              const version = versions[dependency.id] ?? dependency.version;
              const changed = version.trim() !== (dependency.version || dependency.declaredVersion).trim();
              return (
                <article className="dependency-editor-row" key={dependency.id}>
                  <div className="dependency-editor-coordinate">
                    <strong>
                      {dependency.artifactId}
                      {(() => {
                        const hits = byDependency.get(`${dependency.groupId}:${dependency.artifactId}@${dependency.version.trim()}`) || [];
                        if (!hits.length) return null;
                        return (
                          <span className={`dependency-row-badge sev-${hits[0].severity.toLowerCase()}`} title={hits.map((hit) => hit.id).join(", ")}>
                            <ShieldAlert size={11} /> {hits.length}
                          </span>
                        );
                      })()}
                    </strong>
                    <small>{dependency.groupId}</small>
                    <div>
                      <span>{dependency.configuration || dependency.scope || "compile"}</span>
                      {dependency.ecosystem === "maven" && dependency.managed && <span className="managed">{t("dependencyManagement")}</span>}
                      {dependency.catalogAlias && <span className="catalog">libs.{dependency.catalogAlias}</span>}
                      {dependency.versionSource === "property" && <span>Property: {dependency.versionKey}</span>}
                    </div>
                  </div>
                  <div className="dependency-editor-version">
                    <input
                      aria-label={`Version von ${dependency.coordinate}`}
                      value={version}
                      disabled={!dependency.editableVersion || busy === dependency.id}
                      onChange={(event) => setVersions((current) => ({ ...current, [dependency.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && changed && version.trim()) {
                          void mutate(dependency.id, () => onUpdate(dependency, version.trim()));
                        }
                      }}
                    />
                    <button
                      className="icon-button"
                      title={t("Version speichern")}
                      aria-label={`Version von ${dependency.coordinate} speichern`}
                      disabled={!dependency.editableVersion || !changed || !version.trim() || Boolean(busy)}
                      onClick={() => void mutate(dependency.id, () => onUpdate(dependency, version.trim()))}
                    ><Save size={12} /></button>
                    <button
                      className="icon-button danger"
                      title={t("Abhängigkeit entfernen")}
                      aria-label={`${dependency.coordinate} entfernen`}
                      disabled={Boolean(busy)}
                      onClick={() => void mutate(`remove:${dependency.id}`, () => onRemove(dependencySelector(dependency)))}
                    ><Trash2 size={12} /></button>
                  </div>
                  <small className="dependency-editor-source" title={dependency.sourceFile}>{dependency.sourceFile}</small>
                </article>
              );
            })}
          </section>

          {model.catalogs.map((catalog) => (
            <section className="version-catalog-editor" key={catalog.path}>
              <header><strong>Versionskatalog · {catalog.name}</strong><span>{catalog.libraries.length} Libraries</span></header>
              <small className="dependency-editor-source" title={catalog.path}>{catalog.path}</small>
              {catalog.versions.map((entry) => {
                const id = `${catalog.path}:${entry.key}`;
                const value = catalogVersions[id] ?? entry.version;
                const changed = value.trim() !== entry.version.trim();
                return (
                  <label key={entry.key}>
                    <span><strong>{entry.key}</strong><small>{catalog.libraries.filter((library) => library.versionKey === entry.key).map((library) => library.alias).join(", ")}</small></span>
                    <input value={value} disabled={!entry.editable || busy === id} onChange={(event) => setCatalogVersions((current) => ({ ...current, [id]: event.target.value }))} />
                    <button className="icon-button" title={t("Katalogversion speichern")} disabled={!entry.editable || !changed || !value.trim() || Boolean(busy)} onClick={() => void mutate(id, () => onUpdateCatalog(catalog.path, entry.key, value.trim()))}><Save size={12} /></button>
                  </label>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
