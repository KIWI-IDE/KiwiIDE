import { Check, PackagePlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModuleChangePlan, ModuleInfo, ModuleSpec } from "../types";
import { t } from "../i18n";
import { JAVA_LANGUAGE_LEVELS } from "../language-levels";

interface ModuleDialogProps {
  open: boolean;
  projectRoot: string;
  modules: ModuleInfo[];
  onClose: () => void;
  onPreview: (spec: ModuleSpec) => Promise<ModuleChangePlan>;
  onApply: (plan: ModuleChangePlan) => Promise<void>;
  embedded?: boolean;
}

export function ModuleDialog({ open, projectRoot, modules, onClose, onPreview, onApply, embedded = false }: ModuleDialogProps) {
  const [spec, setSpec] = useState<ModuleSpec>({
    name: "",
    relativePath: "",
    packageName: "dev.kiwi.app",
    languageLevel: "",
    dependencies: [],
    jpms: false,
    adoptRootSources: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = useMemo(() => {
    const name = spec.name.trim();
    return Boolean(name)
      && name.length <= 128
      && !/[\u0000-\u001f\u007f]/.test(name);
  }, [spec.name]);

  if (!open) return null;

  const createModule = async () => {
    if (!valid) {
      setError("Der Modulname darf nicht leer sein oder Steuerzeichen enthalten.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Der bestehende Change-Plan bleibt intern als atomare Sicherheitsgrenze erhalten,
      // wird aber ohne zusätzlichen Vorschau-/Bestätigungsdialog direkt angewendet.
      const plan = await onPreview({
        ...spec,
        name: spec.name.trim(),
        relativePath: spec.relativePath?.trim() || "",
      });
      await onApply(plan);
      setSpec({
        name: "",
        relativePath: "",
        packageName: "dev.kiwi.app",
        languageLevel: "",
        dependencies: [],
        jpms: false,
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Das Modul konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? "assistant-panel-content" : "modal-backdrop"} onMouseDown={(event) => !embedded && event.target === event.currentTarget && onClose()}>
      <section className="modal module-dialog" role="dialog" aria-modal="true" aria-label={t("Modul erstellen")}>
        <header className="modal-header">
          <div><PackagePlus size={20} /><span><strong>{t("Modul hinzufügen")}</strong><small>{projectRoot}</small></span></div>
          <button onClick={onClose} aria-label={t("Schließen")}><X size={17} /></button>
        </header>

        <div className="module-form">
          <label>{t("Modulname")}<input autoFocus value={spec.name} onChange={(event) => setSpec({ ...spec, name: event.target.value })} placeholder={t("Core API 2.0 + Tools")} /></label>
          <small className="module-name-hint">Zahlen, Leerzeichen und Sonderzeichen sind erlaubt. Build-ID, Ordner und JPMS-Name werden bei Bedarf sicher normalisiert.</small>
          <label>{t("Relativer Pfad")}<input value={spec.relativePath} onChange={(event) => setSpec({ ...spec, relativePath: event.target.value })} placeholder={t("Automatisch aus dem Modulnamen")} /></label>
          <label>{t("Basis-Package")}<input value={spec.packageName} onChange={(event) => setSpec({ ...spec, packageName: event.target.value })} placeholder={t("dev.kiwi.core")} /></label>
          <div className="module-form-grid">
            <label>Java Language Level
              <select value={spec.languageLevel} onChange={(event) => setSpec({ ...spec, languageLevel: event.target.value })}>
                <option value="">{t("Vom Projekt erben")}</option>
                {JAVA_LANGUAGE_LEVELS.map((version) => <option key={version} value={version}>Java {version}</option>)}
              </select>
            </label>
            <label>{t("Modul-SDK")}<input value={spec.jdkPath || ""} onChange={(event) => setSpec({ ...spec, jdkPath: event.target.value })} placeholder={t("Vom Projekt erben")} /></label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={spec.sampleClass !== false}
              onChange={(event) => setSpec({ ...spec, sampleClass: event.target.checked })}
            />{" "}
            Beispielklasse anlegen
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={Boolean(spec.adoptRootSources)}
              onChange={(event) => setSpec({ ...spec, adoptRootSources: event.target.checked })}
            />{" "}
            Vorhandene Quellen des Projekts in dieses Modul verschieben
          </label>
          {spec.adoptRootSources && (
            <p className="module-hint">
              src/ wandert nach {spec.relativePath?.trim() || "<Modulname>"}/src/. Nötig, sobald ein Maven-Projekt
              Module bekommt: der Aggregator selbst baut keine Quellen mehr.
            </p>
          )}
          <label className="check-row"><input type="checkbox" checked={Boolean(spec.jpms)} onChange={(event) => setSpec({ ...spec, jpms: event.target.checked ? { name: "" } : false })} /> {t("JPMS-Descriptor module-info.java erzeugen")}</label>
          {spec.jpms !== false && (
            <label>JPMS-Name
              <input
                value={spec.jpms?.name || ""}
                onChange={(event) => setSpec({ ...spec, jpms: { ...(spec.jpms || {}), name: event.target.value } })}
                placeholder={t("Automatisch als gültiger Java-Modulname")}
              />
            </label>
          )}
          {modules.length > 0 && (
            <fieldset className="module-dependencies">
              <legend>{t("Modulabhängigkeiten")}</legend>
              {modules.map((module) => (
                <label key={module.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={spec.dependencies?.includes(module.id)}
                    onChange={(event) => setSpec({
                      ...spec,
                      dependencies: event.target.checked
                        ? [...(spec.dependencies || []), module.id]
                        : (spec.dependencies || []).filter((id) => id !== module.id),
                    })}
                  />
                  {module.name}
                </label>
              ))}
            </fieldset>
          )}
        </div>
        {error && <div className="dialog-error">{error}</div>}
        <footer className="modal-footer">
          <span />
          <button className="secondary-button" onClick={onClose} disabled={busy}>{t("Abbrechen")}</button>
          <button className="primary-button" onClick={() => void createModule()} disabled={!valid || busy}><Check size={15} /> {busy ? "Wird erstellt…" : "Modul erstellen"}</button>
        </footer>
      </section>
    </div>
  );
}
