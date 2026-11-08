import { Check, ClipboardCopy, ExternalLink, Github, KeyRound, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GitHubSession } from "../types";
import { t } from "../i18n";

type DeviceFlow = { userCode: string; verificationUri: string; expiresIn: number; interval: number };

export function GitHubSignInDialog({
  onSignedIn,
  onCancel,
}: {
  onSignedIn: (session: GitHubSession) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"device" | "token">("token");
  const [deviceAvailable, setDeviceAvailable] = useState(false);
  const [token, setToken] = useState("");
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopped = useRef(false);

  useEffect(() => {
    void window.kiwi?.git.githubStatus().then((session) => {
      setDeviceAvailable(session.deviceFlowAvailable);
      if (session.deviceFlowAvailable) setMode("device");
    }).catch(() => setDeviceAvailable(false));
    return () => { stopped.current = true; };
  }, []);

  const poll = async (device: DeviceFlow) => {
    const deadline = Date.now() + device.expiresIn * 1000;
    while (!stopped.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(2, device.interval) * 1000));
      if (stopped.current || !window.kiwi) return;
      try {
        const result = await window.kiwi.git.githubPollDeviceFlow();
        if (result.status === "complete") {
          onSignedIn(result.session);
          return;
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "GitHub-Anmeldung fehlgeschlagen.");
        setBusy(false);
        return;
      }
    }
    if (!stopped.current) {
      setError("Der GitHub-Anmeldecode ist abgelaufen. Starte die Anmeldung erneut.");
      setBusy(false);
      setFlow(null);
    }
  };

  const beginDeviceFlow = async () => {
    if (!window.kiwi) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.kiwi.git.githubBeginDeviceFlow();
      setFlow(next);
      await navigator.clipboard.writeText(next.userCode).catch(() => undefined);
      await window.kiwi.app.openUpdate(next.verificationUri);
      void poll(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub Device Login ist nicht verfügbar.");
      setBusy(false);
    }
  };

  return (
    <div className="quick-action-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="github-signin-dialog" role="dialog" aria-modal="true" aria-label={t("Bei GitHub anmelden")}>
        <header><div><Github size={19} /><span><strong>{t("Bei GitHub anmelden")}</strong><small>{t("Kiwi speichert Zugangsdaten verschlüsselt im lokalen Systemspeicher.")}</small></span></div><button className="icon-button" type="button" onClick={onCancel}><X size={16} /></button></header>
        <nav>{deviceAvailable && <button className={mode === "device" ? "active" : ""} type="button" onClick={() => setMode("device")}><Github size={14} /> {t("Browser-Anmeldung")}</button>}<button className={mode === "token" ? "active" : ""} type="button" onClick={() => setMode("token")}><KeyRound size={14} /> {t("Token")}</button></nav>
        {!deviceAvailable && (
          <p className="github-device-hint">
            Die Browser-Anmeldung braucht eine GitHub OAuth Client-ID. Trage sie unter Einstellungen › Updates &amp; Konten ein, dann steht sie hier zur Verfügung.
          </p>
        )}
        {mode === "device" ? (
          <div className="github-device-flow">
            {!flow ? <><p>{t("Öffnet GitHub im Browser. Dein Passwort wird niemals an Kiwi übergeben.")}</p><button className="primary-button" type="button" disabled={busy} onClick={() => void beginDeviceFlow()}>{busy ? <LoaderCircle className="kiwi-spinner" size={15} /> : <ExternalLink size={15} />} Mit GitHub verbinden</button></> : <>
              <span>Gib diesen Code bei GitHub ein:</span>
              <button className="github-device-code" type="button" onClick={() => void navigator.clipboard.writeText(flow.userCode)}><code>{flow.userCode}</code><ClipboardCopy size={15} /></button>
              <div className="github-device-wait"><LoaderCircle className="kiwi-spinner" size={15} /> {t("Warte auf Bestätigung im Browser …")}</div>
              <button type="button" onClick={() => void window.kiwi?.app.openUpdate(flow.verificationUri)}><ExternalLink size={14} /> {t("GitHub erneut öffnen")}</button>
            </>}
          </div>
        ) : (
          <form className="github-token-flow" onSubmit={async (event) => {
            event.preventDefault();
            if (!window.kiwi || !token.trim() || busy) return;
            setBusy(true);
            setError("");
            try {
              onSignedIn(await window.kiwi.git.githubSignIn(token.trim()));
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Token konnte nicht geprüft werden.");
              setBusy(false);
            }
          }}>
            <p>Unterstützt Fine-grained und Classic Personal Access Tokens. Für private Repositories werden passende Repository-Rechte benötigt.</p>
            <button className="github-token-create" type="button" onClick={() => {
              // Opens the creation page with the scopes Kiwi needs already
              // ticked; finding them by hand is the step people get wrong.
              void window.kiwi?.app.openUpdate(
                "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Kiwi%20IDE",
              );
            }}><ExternalLink size={14} /> {t("Token auf GitHub erstellen")}</button>
            <label><span>{t("Personal Access Token")}</span><input autoFocus type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("github_pat_… oder ghp_…")} /></label>
            <button className="primary-button" disabled={!token.trim() || busy} type="submit">{busy ? <LoaderCircle className="kiwi-spinner" size={15} /> : <Check size={15} />} Token prüfen und speichern</button>
          </form>
        )}
        {error && <div className="inline-field-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
