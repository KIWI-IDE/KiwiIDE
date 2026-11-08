import { ExternalLink, RefreshCw, Download, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { LanguageServerConfiguration, LanguageServerStatus } from "../types";
import { t } from "../i18n";
import "./LanguageServersSettings.css";

export function LanguageServersSettings({ root, configuration, onChange }: {
  root: string;
  configuration: Record<string, LanguageServerConfiguration>;
  onChange: (configuration: Record<string, LanguageServerConfiguration>) => void;
}) {
  const [servers, setServers] = useState<LanguageServerStatus[]>([]);
  const [busy, setBusy] = useState("");
  const [installingAll, setInstallingAll] = useState(false);
  const [installStatus, setInstallStatus] = useState("");
  const [problem, setProblem] = useState("");
  const refresh = async () => {
    try { setServers(await window.kiwi!.polyglot.status(root || undefined)); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void refresh(); }, [root]);
  useEffect(() => window.kiwi?.polyglot.onStatus(() => { void refresh(); }), [root]);
  const change = (server: LanguageServerStatus, patch: Partial<LanguageServerConfiguration>) => {
    const current = configuration[server.languageId] || { enabled: true, command: "", args: server.args };
    onChange({ ...configuration, [server.languageId]: {
      ...current, ...patch,
    } });
  };
  const install = async (languageId: string) => {
    setBusy(languageId);
    setProblem("");
    try {
      const result = await window.kiwi!.polyglot.install(languageId);
      if (!result.installed) setProblem(result.reason || t("Installation fehlgeschlagen."));
      await refresh();
    } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  };
  const installAll = async () => {
    setInstallingAll(true);
    setProblem("");
    setInstallStatus(t("Installiere alle Sprachserver (TypeScript, Python, PHP, Rust, Go, C#, Shell, SQL…) …"));
    try {
      const res = await window.kiwi?.polyglot?.installAll?.();
      if (res) {
        setInstallStatus(t(`${res.installed} von ${res.total} Sprachservern erfolgreich eingerichtet.`));
      }
      await refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setInstallStatus("");
    } finally {
      setInstallingAll(false);
    }
  };
  return <section className="settings-section language-server-settings">
    <h2>{t("Sprachen & Sprachserver")}</h2>
    <p>{t("Syntaxfarben, Schlüsselwörter, Vorlagen und Vorschläge aus geöffneten Dateien sind ohne Installation verfügbar. Sprachserver ergänzen typabhängige Autovervollständigung, Diagnosen und Navigation.")}</p>
    <p>{t("Java verwendet weiterhin JDT LS. HTML, CSS, JavaScript und TypeScript verwenden die integrierten Sprachdienste.")}</p>
    <p>{t("Leerer Programmpfad bedeutet automatische Erkennung. Änderungen werden mit Übernehmen aktiviert. Compiler und Laufzeiten werden getrennt installiert.")}</p>
    <div className="language-servers-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "12px 0" }}>
      <button type="button" className="primary-button" disabled={installingAll} onClick={() => void installAll()}><Sparkles size={13} /> {installingAll ? t("Installiere alle Sprachserver …") : t("Alle Sprachserver automatisch installieren")}</button>
      <button type="button" onClick={() => void refresh()}><RefreshCw size={13} /> {t("Sprachserver erkennen")}</button>
      <button type="button" onClick={() => void window.kiwi!.polyglot.stop(root || undefined).then(refresh).catch((error) => setProblem(String(error)))}><RefreshCw size={13} /> {t("Sprachserver neu starten")}</button>
    </div>
    {installStatus && <p className="settings-notice" style={{ color: "var(--accent, #61dafb)", fontWeight: 500, margin: "6px 0" }}>{installStatus}</p>}
    {problem && <p role="alert" className="settings-error">{problem}</p>}
    {servers.map((server) => {
      const custom = configuration[server.languageId];
      return <article className="setting-row language-server-card" key={server.languageId}>
        <header><strong>{server.name}</strong><span className={server.available ? "available" : "missing"}>{server.serverName} · {server.available ? t("Verfügbar") : t("Nicht verfügbar")}</span></header>
        <label className="language-server-enabled"><input type="checkbox" checked={custom?.enabled !== false} onChange={(event) => change(server, { enabled: event.target.checked })} />{t("Sprachserver aktivieren")}</label>
        <label>{t("Programm oder vollständiger Pfad")}<input value={custom?.command || ""} placeholder={server.command} spellCheck={false} onChange={(event) => change(server, { command: event.target.value })} /></label>
        <label>{t("Argumente, eines pro Zeile")}<textarea rows={2} spellCheck={false} value={(custom?.args || server.args).join("\n")} onChange={(event) => change(server, { args: event.target.value.split("\n").filter(Boolean) })} /></label>
        {server.reason && <small>{server.reason}</small>}
        {server.installHint && <code>{server.installHint}</code>}
        <footer>
          {server.docsUrl && <button type="button" onClick={() => void window.kiwi?.app.openExternal(server.docsUrl!).catch(() => undefined)}><ExternalLink size={13} /> {t("Installationsanleitung")}</button>}
          {["python", "php", "typescript", "javascript", "typescriptreact", "shell", "bash", "sql"].includes(server.languageId) && <button type="button" disabled={Boolean(busy) || installingAll} onClick={() => void install(server.languageId)}><Download size={13} /> {busy === server.languageId ? t("Wird installiert …") : t("Für Kiwi installieren")}</button>}
        </footer>
      </article>;
    })}
  </section>;
}
