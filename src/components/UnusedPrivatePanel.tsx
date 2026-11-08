import { FileCode2, RefreshCw, ShieldAlert, X } from "lucide-react";
import type { UnusedPrivateAnalysis } from "../language/java-refactor";
import { t } from "../i18n";

export function UnusedPrivatePanel({
  analysis,
  loading,
  onRefresh,
  onClose,
  onOpen,
}: {
  analysis: UnusedPrivateAnalysis | null;
  loading?: boolean;
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
  onOpen: (path: string, line: number, column: number) => void;
}) {
  const findings = analysis?.findings || [];
  return (
    <section className="workbench-document unused-private-document">
      <header className="document-header">
        <div><ShieldAlert size={18} /><span><strong>{t("Ungenutzter privater Code")}</strong><small>{analysis ? `${analysis.analysedFiles} Dateien analysiert · ${findings.length} Treffer` : "Projektweite statische Analyse"}</small></span></div>
        <div className="header-actions">
          <button type="button" disabled={loading} onClick={() => void onRefresh()}><RefreshCw className={loading ? "kiwi-spinner" : ""} size={14} /> {t("Neu analysieren")}</button>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Schließen")}><X size={15} /></button>
        </div>
      </header>
      {loading && !analysis ? <div className="document-loading"><span className="loading-spinner" /> {t("Private Deklarationen und Referenzen werden analysiert …")}</div> : findings.length === 0 ? (
        <div className="document-empty"><ShieldAlert size={30} /><strong>{t("Keine sicheren Treffer")}</strong><span>{t("Reflektive oder unsichere Verwendungen werden bewusst nicht als tot markiert.")}</span></div>
      ) : (
        <div className="unused-private-list">
          {(["class", "method", "field"] as const).map((kind) => {
            const entries = findings.filter((item) => item.kind === kind);
            if (!entries.length) return null;
            return <section key={kind}><header>{kind === "class" ? "Klassen" : kind === "method" ? "Methoden" : "Felder"}<span>{entries.length}</span></header>{entries.map((item) => (
              <button type="button" key={item.id} onClick={() => onOpen(item.path, item.line, item.column)}>
                <FileCode2 size={15} /><span><strong>{item.name}</strong><small>{item.explanation}</small></span><code>{item.path.split(/[\\/]/).at(-1)}:{item.line}</code>
              </button>
            ))}</section>;
          })}
        </div>
      )}
    </section>
  );
}
