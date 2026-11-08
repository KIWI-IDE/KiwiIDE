import { AlertTriangle, ArrowRight, Check, FileCode2, GitBranch, X } from "lucide-react";
import { changedLineCount, groupRefactorCallSites, type JavaRefactorPlan } from "../language/java-refactor";
import { t } from "../i18n";

interface JavaRefactorPreviewProps {
  plan: JavaRefactorPlan;
  applying?: boolean;
  onApply: (planId: string) => void | Promise<void>;
  onCancel: () => void;
  onOpenLocation?: (path: string, line: number, column: number) => void;
}

/**
 * An embeddable refactoring document. It intentionally reuses Kiwi's existing
 * refactor-preview classes, so App.tsx does not need another modal or CSS island.
 */
export function JavaRefactorPreview({
  plan,
  applying = false,
  onApply,
  onCancel,
  onOpenLocation,
}: JavaRefactorPreviewProps) {
  const callSiteGroups = groupRefactorCallSites(plan.affectedCallSites);
  return (
    <section className="refactor-preview-document" aria-label={plan.title}>
      <header className="document-header">
        <div>
          <strong>{plan.title}</strong>
          <small>{plan.files.length} Dateien · {plan.affectedCallSites.length} Aufrufstellen</small>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label={t("Vorschau schließen")}><X size={16} /></button>
      </header>

      {plan.blockedReasons.length > 0 && (
        <div className="inline-error" role="alert">
          <AlertTriangle size={16} />
          <div><strong>{t("Refactoring blockiert")}</strong>{plan.blockedReasons.map((reason) => <p key={reason}>{reason}</p>)}</div>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <div className="inline-warning">
          <AlertTriangle size={16} />
          <div>{plan.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
        </div>
      )}

      <div className="refactor-preview-list">
        {plan.resources.map((resource) => (
          <details key={`${resource.oldPath}:${resource.newPath}`} open>
            <summary>
              <GitBranch size={15} />
              <span>{resource.oldPath.split(/[\\/]/).at(-1)}</span>
              <ArrowRight size={13} />
              <small>{resource.newPath}</small>
            </summary>
          </details>
        ))}
        {plan.files.map((file) => (
          <details key={file.path} open={file.kind === "build-model"}>
            <summary>
              <FileCode2 size={15} />
              <span>{file.path.split(/[\\/]/).at(-1)}</span>
              <small>{file.kind === "build-model" ? "Buildmodell" : `${changedLineCount(file.before, file.after)} geänderte Zeilen`}</small>
            </summary>
            <div className="refactor-diff-grid">
              <div><header>{t("Vorher")}</header><pre>{file.before}</pre></div>
              <div><header>{t("Nachher")}</header><pre>{file.after}</pre></div>
            </div>
          </details>
        ))}
      </div>

      {callSiteGroups.length > 0 && (
        <section className="refactor-preview-list" aria-label={t("Betroffene Aufrufstellen")}>
          <h3>{t("Betroffene Aufrufstellen")}</h3>
          {callSiteGroups.map((group) => (
            <details key={group.path}>
              <summary><FileCode2 size={15} /><span>{group.name}</span><small>{group.entries.length}</small></summary>
              {group.entries.map((site) => (
                <button
                  key={`${site.path}:${site.line}:${site.column}`}
                  className="command-row"
                  type="button"
                  onClick={() => onOpenLocation?.(site.path, site.line, site.column)}
                >
                  <span>{site.preview || group.name}</span><small>Zeile {site.line}</small>
                </button>
              ))}
            </details>
          ))}
        </section>
      )}

      <footer className="document-footer">
        <button type="button" className="secondary-button" onClick={onCancel}>{t("Abbrechen")}</button>
        <button
          type="button"
          className="primary-button"
          disabled={plan.blocked || applying}
          onClick={() => void onApply(plan.id)}
        >
          <Check size={15} /> {applying ? "Wird angewendet …" : "Refactoring anwenden"}
        </button>
      </footer>
    </section>
  );
}
