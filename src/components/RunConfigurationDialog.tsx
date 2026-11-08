import { Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModuleInfo, RunConfiguration, RunConfigurationType } from "../types";
import { describeCompound, eligibleMembers, resolveCompound } from "../run-compound";
import { t } from "../i18n";

const empty: RunConfiguration = {
  name: "Main",
  type: "java",
  mainClass: "",
  target: "",
  programArgs: "",
  vmArgs: "",
  workingDirectory: "",
  jdkPath: "",
  env: {},
  favorite: false,
  group: "",
};

export function RunConfigurationDialog({
  configuration,
  workspaceRoot,
  modules,
  configurations,
  onClose,
  onSave,
  onDelete,
  embedded = false,
}: {
  configuration?: RunConfiguration;
  workspaceRoot: string;
  modules?: ModuleInfo[];
  /** Everything that exists, so a compound can name some of it. */
  configurations?: RunConfiguration[];
  onClose: () => void;
  onSave: (configuration: RunConfiguration) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  embedded?: boolean;
}) {
  const [value, setValue] = useState<RunConfiguration>({ ...empty, projectRoot: workspaceRoot, workingDirectory: workspaceRoot });
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(configuration
    ? { ...empty, projectRoot: workspaceRoot, ...configuration }
    : { ...empty, projectRoot: workspaceRoot, workingDirectory: workspaceRoot }), [configuration, workspaceRoot]);
  const update = (patch: Partial<RunConfiguration>) => setValue((current) => ({ ...current, ...patch }));

  return (
    <div className={embedded ? "assistant-panel-content" : "overlay settings-overlay"} onMouseDown={embedded ? undefined : onClose}>
      <form
        className="run-config-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try { await onSave(value); } finally { setSaving(false); }
        }}
      >
        <header><div><Play size={18} /><span><strong>{t("Run-Konfiguration")}</strong><small>{t("Startparameter für Java und Build-Werkzeuge")}</small></span></div><button type="button" onClick={onClose}><X size={17} /></button></header>
        <div className="run-config-fields">
          <div className="field-pair">
            <label><span>{t("Name")}</span><input value={value.name} onChange={(event) => update({ name: event.target.value })} required /></label>
            <label><span>{t("Typ")}</span><select value={value.type} onChange={(event) => update({ type: event.target.value as RunConfigurationType })}><option value="java">{t("Java Application")}</option><option value="junit">{t("JUnit")}</option><option value="maven">{t("Maven Goal")}</option><option value="gradle">{t("Gradle Task")}</option><option value="docker">{t("Docker")}</option><option value="compose">{t("Docker Compose")}</option><option value="compound">{t("Mehrere zusammen")}</option></select></label>
          </div>
          <label><span>{t("Projekt / Modul")}</span>
            <select value={value.moduleId || ""} onChange={(event) => update({ projectRoot: workspaceRoot, moduleId: event.target.value || undefined })}>
              <option value="">Gesamtes Projekt · {workspaceRoot.split(/[\\/]/).at(-1)}</option>
              {(modules || []).map((module) => <option value={module.id} key={module.id}>{module.name} · {module.relativePath || "."}</option>)}
            </select>
          </label>
          <div className="field-pair">
            <label><span>{t("Gruppe")}</span><input value={value.group || ""} onChange={(event) => update({ group: event.target.value })} placeholder={t("Backend, Tests, Tools …")} /></label>
            <label className="run-config-check"><span>{t("Favorit")}</span><input type="checkbox" checked={Boolean(value.favorite)} onChange={(event) => update({ favorite: event.target.checked })} /></label>
          </div>
          {(value.type === "java" || value.type === "junit") && <label><span>{value.type === "java" ? "Main Class" : "Testklasse oder Methode"}</span><input value={value.type === "java" ? value.mainClass : value.target} onChange={(event) => update(value.type === "java" ? { mainClass: event.target.value } : { target: event.target.value })} placeholder={value.type === "java" ? "com.example.Main" : "com.example.MainTest#testName"} /></label>}
          {(value.type === "maven" || value.type === "gradle") && <label><span>{value.type === "maven" ? "Goals" : "Task"}</span><input value={value.target} onChange={(event) => update({ target: event.target.value })} placeholder={value.type === "maven" ? "clean verify" : "build"} /></label>}
          {(value.type === "docker" || value.type === "compose") && <label><span>{t("Docker-Befehl")}</span><input value={value.target} onChange={(event) => update({ target: event.target.value })} placeholder={value.type === "compose" ? "up --build" : "build -t kiwi-app ."} /></label>}
          {value.type === "compound" && (() => {
            /**
             * The configurations this one starts.
             *
             * Only those that cannot loop back are offered: a compound that
             * contains itself is an editor that hangs on a click, and refusing
             * it here means it can never be saved in that state at all.
             */
            const all = configurations || [];
            const chosen = value.members || [];
            const offered = eligibleMembers(all as never, value.id || "")
              .filter((entry) => !chosen.some((member) => member.id === entry.id));
            const resolved = resolveCompound(all as never, value.id || "");
            return (
              <div className="compound-members">
                <label>
                  <span>{t("Reihenfolge")}</span>
                  <select
                    value={value.compoundMode || "sequential"}
                    onChange={(event) => update({ compoundMode: event.target.value as "sequential" | "parallel" })}
                  >
                    <option value="sequential">{t("Nacheinander")}</option>
                    <option value="parallel">{t("Gleichzeitig")}</option>
                  </select>
                </label>
                <ul className="compound-list">
                  {chosen.map((member, index) => {
                    const named = all.find((entry) => entry.id === member.id);
                    return (
                      <li key={member.id}>
                        <span className="compound-index">{index + 1}</span>
                        <span className="compound-name">{named?.name || t("Nicht mehr vorhanden")}</span>
                        <button
                          type="button"
                          title={t("Entfernen")}
                          onClick={() => update({ members: chosen.filter((entry) => entry.id !== member.id) })}
                        ><Trash2 size={13} /></button>
                      </li>
                    );
                  })}
                  {!chosen.length && <li className="compound-empty">{t("Noch nichts ausgewählt.")}</li>}
                </ul>
                <label>
                  <span>{t("Hinzufügen")}</span>
                  <select
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      update({ members: [...chosen, { id: event.target.value }] });
                    }}
                  >
                    <option value="">{offered.length ? t("Konfiguration wählen…") : t("Nichts mehr verfügbar")}</option>
                    {offered.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                  </select>
                </label>
                {value.id && <p className="compound-summary">{describeCompound(resolved)}</p>}
              </div>
            );
          })()}
          <label><span>{t("Programmargumente")}</span><input value={value.programArgs} onChange={(event) => update({ programArgs: event.target.value })} placeholder='--server.port 8080' /></label>
          <label><span>{t("VM-Argumente")}</span><input value={value.vmArgs} onChange={(event) => update({ vmArgs: event.target.value })} placeholder={t("-Xmx1G -Dspring.profiles.active=dev")} /></label>
          <label><span>{t("Arbeitsordner")}</span><input value={value.workingDirectory} onChange={(event) => update({ workingDirectory: event.target.value })} /></label>
          <label><span>{t("JDK (leer = global)")}</span><input value={value.jdkPath} onChange={(event) => update({ jdkPath: event.target.value })} placeholder={t("C:\Program Files\Java\jdk-21")} /></label>
          <label><span>{t("Umgebungsvariablen")}</span><input value={Object.entries(value.env || {}).map(([key, val]) => `${key}=${val}`).join(";")} onChange={(event) => update({ env: Object.fromEntries(event.target.value.split(";").filter(Boolean).map((item) => { const [key, ...rest] = item.split("="); return [key.trim(), rest.join("=")]; })) })} placeholder={t("PROFILE=dev;PORT=8080")} /></label>
        </div>
        <footer>
          {value.id && onDelete && <button type="button" className="delete-config" onClick={() => void onDelete(value.id!)}><Trash2 size={14} /> {t("Löschen")}</button>}
          <span />
          <button type="button" className="secondary-button" onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? "Speichern…" : "Speichern"}</button>
        </footer>
      </form>
    </div>
  );
}
