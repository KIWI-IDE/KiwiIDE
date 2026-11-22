import { CircleHelp, RefreshCw, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { completionStatus, completionStatuses, completionFileKey, COMPLETION_STATUS_EVENT, type CompletionPhase } from "../language/completion-status";
import { t } from "../i18n";

const labels: Record<CompletionPhase, string> = {
  ready: "Vorschläge bereit", syncing: "Gradle wird synchronisiert", "sync-error": "Gradle-Synchronisierung fehlgeschlagen",
  "catalog-missing": "Versionskatalog fehlt", "source-unreachable": "Paketquelle nicht erreichbar",
  timeout: "Suche dauert zu lange", "no-matches": "Keine passenden Vorschläge", "server-missing": "Lokale Vorschläge aktiv",
  "server-starting": "Sprachserver startet", "server-error": "Sprachserver benötigt Hilfe",
};
const explanations: Record<CompletionPhase, string> = {
  ready: "Die verfügbaren Vorschläge sind geladen.",
  syncing: "Kiwi lädt Plugins, Tasks und Erweiterungen aus dem Gradle-Projekt. Lokale Vorschläge bleiben nutzbar.",
  "sync-error": "Das Gradle-Projekt konnte nicht eingelesen werden. Prüfe die Build-Fehler und synchronisiere erneut.",
  "catalog-missing": "Kiwi findet keinen passenden Versionskatalog. Prüfe gradle/libs.versions.toml und speichere die Datei.",
  "source-unreachable": "Die Paketquelle ist nicht erreichbar. Prüfe die Verbindung und versuche die Suche erneut.",
  timeout: "Die Paketquelle hat nicht rechtzeitig geantwortet. Du kannst lokale Aliase weiter verwenden.",
  "no-matches": "Für diese Eingabe gibt es keine Treffer. Prüfe die Schreibweise oder verwende eine vollständige Koordinate.",
  "server-missing": "Lokale Vorschläge stehen bereit. Für typabhängige Vorschläge muss der Sprachserver installiert und aktiviert sein.",
  "server-starting": "Der Sprachserver bereitet das Projekt vor. Lokale Vorschläge stehen bereits bereit.",
  "server-error": "Der Sprachserver konnte die Anfrage nicht beantworten. Prüfe seinen Status in den Einstellungen.",
};

export function CompletionStatus({ file, onSync, onSettings }: { file: string; onSync: () => void; onSettings: () => void }) {
  const [, update] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const changed = (event: Event) => { if (completionFileKey((event as CustomEvent).detail.file) === completionFileKey(file)) update(value => value + 1); };
    window.addEventListener(COMPLETION_STATUS_EVENT, changed);
    return () => window.removeEventListener(COMPLETION_STATUS_EVENT, changed);
  }, [file]);
  useEffect(() => setOpen(false), [file]);
  const state = completionStatus(file);
  if (!state) return null;
  return (
    <span className="completion-status-control">
      <button onClick={() => setOpen(value => !value)} aria-expanded={open} title={t("Hilfe zu Vorschlägen")}><CircleHelp size={12} /> {t(labels[state.phase])}</button>
      {open && <section className="completion-status-popover" role="dialog" aria-label={t("Hilfe zu Vorschlägen")}>
        <header><strong>{t("Hilfe zu Vorschlägen")}</strong><button onClick={() => setOpen(false)} aria-label={t("Schließen")}><X size={14} /></button></header>
        {completionStatuses(file).filter(item => item.phase !== "ready" || completionStatuses(file).length === 1).map(item => <article key={item.origin}>
          <strong>{t(labels[item.phase])}</strong><p>{t(explanations[item.phase])}</p>{item.detail && <small>{item.detail}</small>}
        </article>)}
        <footer><button onClick={() => { setOpen(false); onSync(); }}><RefreshCw size={13} />{t("Erneut prüfen")}</button><button onClick={() => { setOpen(false); onSettings(); }}><Settings2 size={13} />{t("Spracheinstellungen")}</button></footer>
      </section>}
    </span>
  );
}
