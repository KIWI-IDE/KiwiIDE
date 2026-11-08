import { CircleCheck, FileKey, Gamepad2, Github, Plus, Trash2, Users, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import type { DiscordPresencePreview, GitHubSession, IdeSettings } from "../types";
import { t } from "../i18n";

/** `27:44`, the way Discord counts a session up. */
function elapsedLabel(start: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/**
 * Everything Kiwi signs in to or trusts, in one place.
 *
 * These four were reachable only from places that had nothing to do with each
 * other — GitHub from the Git view, the collaboration name from a dialog, and
 * the proxy and certificates not at all. They belong together because they
 * answer one question: who Kiwi is on the network, and who it believes.
 */
export function AccountsView({
  github,
  settings,
  onSignIn,
  onSignOut,
  onChange,
  onAddCertificate,
}: {
  github: GitHubSession | null;
  settings: IdeSettings;
  onSignIn: () => void;
  onSignOut: () => void;
  onChange: (patch: Partial<IdeSettings>) => void;
  onAddCertificate: () => void;
}) {
  const [proxy, setProxy] = useState(settings.proxyUrl || "");
  const [bypass, setBypass] = useState(settings.proxyBypass || "");
  const [name, setName] = useState(settings.collabDisplayName || "");
  const [preview, setPreview] = useState<DiscordPresencePreview | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /*
   * The card in the settings is the card Discord gets: the main process builds
   * it and hands it over, rather than this page drawing something that looks
   * like it. What Kiwi tells the world about somebody is not a thing to
   * approximate in a second place.
   */
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void window.kiwi?.presence.preview()
        .then((result) => { if (!cancelled) setPreview(result); })
        .catch(() => undefined);
    };
    read();
    // Once a second, so the elapsed time runs and a Discord started in the
    // meantime is noticed without the page having to be reopened.
    const timer = window.setInterval(() => {
      setNow(Date.now());
      read();
    }, 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [
    settings.discordRichPresence,
    settings.discordApplicationId,
    settings.discordShowProject,
    settings.discordShowFile,
    settings.discordShowElapsed,
    settings.discordDetails,
    settings.discordState,
  ]);

  /*
   * Laid out as the settings' own sections: the name and its explanation on
   * the left, the controls on the right. The page used to be a stack of cards
   * with their headings on top, which read as a panel that had been moved into
   * the settings rather than as one of them.
   */
  return (
    <div className="accounts-view">
      <section className="settings-section accounts-card">
        <div>
          <strong><Github size={15} /> GitHub</strong>
          <p>{t("Für Pull Requests, Klonen und Push über HTTPS.")}</p>
        </div>
        <div>
          {github?.signedIn ? (
            <div className="accounts-signed-in">
              <CircleCheck size={15} />
              <span>
                <strong>{github.login || t("Angemeldet")}</strong>
                <small>{github.scopes?.length ? github.scopes.join(", ") : t("Keine Berechtigungen gemeldet.")}</small>
              </span>
              <button type="button" className="quiet-button" onClick={onSignOut}>{t("Abmelden")}</button>
            </div>
          ) : (
            <div className="accounts-signed-out">
              <span>{t("Nicht angemeldet.")}</span>
              <button type="button" className="secondary-button" onClick={onSignIn}>{t("Bei GitHub anmelden")}</button>
            </div>
          )}
        </div>
      </section>

      <section className="settings-section accounts-card">
        <div>
          <strong><Users size={15} /> CodeToGetter</strong>
          <p>{t("Der Name, unter dem andere dich in einer Sitzung sehen.")}</p>
        </div>
        <div>
          <input
            value={name}
            aria-label={t("Anzeigename")}
            placeholder={t("z. B. Robin")}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => onChange({ collabDisplayName: name.trim() })}
          />
        </div>
      </section>

      <section className="settings-section accounts-card">
        <div>
          <strong><Gamepad2 size={15} /> Discord</strong>
          <p>{t("Zeigt auf deinem Discord-Profil, dass Kiwi läuft — wie bei IntelliJ.")}</p>
        </div>
        <div className="accounts-stack">
          <label className="accounts-switch">
            <input
              type="checkbox"
              checked={Boolean(settings.discordRichPresence)}
              onChange={(event) => onChange({ discordRichPresence: event.target.checked })}
            />
            <span>{t("Aktivität an Discord senden")}</span>
          </label>

          <div className="accounts-checks">
            {([
              ["discordShowProject", "Projektname"],
              ["discordShowFile", "Dateiname"],
              ["discordShowElapsed", "Verstrichene Zeit"],
            ] as Array<[keyof IdeSettings, string]>).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(settings[key])}
                  disabled={!settings.discordRichPresence}
                  onChange={(event) => onChange({ [key]: event.target.checked } as Partial<IdeSettings>)}
                />
                {t(label)}
              </label>
            ))}
          </div>

          {/* What is actually sent, asked of the part that sends it. */}
          <div className="discord-card">
            <div className="discord-card-head-row">
              <span className="discord-card-head">{t("Spielt")}</span>
              <span className="discord-card-dots">•••</span>
            </div>
            <div className="discord-card-body">
              <div className="discord-card-avatar-wrapper">
                <img
                  className="discord-card-avatar"
                  src={new URL("../../assets/branding/kiwi-logo-mark.png", import.meta.url).href}
                  alt="Kiwi IDE"
                />
                <div className="discord-card-badge" title="Kiwi IDE">
                  <img
                    src={new URL("../../assets/branding/kiwi-logo-mark.png", import.meta.url).href}
                    alt=""
                  />
                </div>
              </div>
              <div className="discord-card-info">
                <strong>Kiwi IDE</strong>
                {preview?.activity.details && <span>{preview.activity.details}</span>}
                {preview?.activity.state && <span>{preview.activity.party ? `${preview.activity.state} (${preview.activity.party.size[0]} von ${preview.activity.party.size[1]})` : preview.activity.state}</span>}
                {preview?.activity.timestamps && (
                  <span className="discord-card-time">
                    <Gamepad2 size={13} /> {elapsedLabel(preview.activity.timestamps.start, now)}
                  </span>
                )}
              </div>
            </div>
            <span className="discord-card-foot">
              {!preview?.configured
                ? t("Aus. Nichts wird gesendet.")
                : preview.rejection
                  /* Measured against the running client: a mistyped id comes
                     back as 4000 and retrying it for ever would say nothing. */
                  ? t("Discord kennt diese Anwendungs-ID nicht.")
                  : preview.connected
                    ? t("Mit Discord verbunden.")
                    : t("Discord läuft nicht — Kiwi versucht es im Hintergrund weiter.")}
            </span>
          </div>
        </div>
      </section>

      <section className="settings-section accounts-card">
        <div>
          <strong><Wifi size={15} /> {t("Proxy")}</strong>
          <p>{t("Leer lassen, um die Systemeinstellungen zu verwenden.")}</p>
        </div>
        <div className="accounts-stack">
          <label className="accounts-field">
            <span>{t("Proxy-Adresse")}</span>
            <input
              value={proxy}
              placeholder="http://proxy.firma.de:8080"
              onChange={(event) => setProxy(event.target.value)}
              onBlur={() => onChange({ proxyUrl: proxy.trim() })}
            />
          </label>
          <label className="accounts-field">
            <span>{t("Ohne Proxy")}</span>
            <input
              value={bypass}
              placeholder="localhost, 127.0.0.1, *.intern"
              onChange={(event) => setBypass(event.target.value)}
              onBlur={() => onChange({ proxyBypass: bypass.trim() })}
            />
          </label>
        </div>
      </section>

      <section className="settings-section accounts-card">
        <div>
          <strong><FileKey size={15} /> {t("Zertifikate")}</strong>
          <p>{t("Zusätzliche Stammzertifikate, etwa für einen Firmenproxy.")}</p>
        </div>
        <div className="accounts-stack">
          {(settings.extraCertificates || []).length === 0 && (
            <p className="accounts-empty">{t("Es werden nur die Zertifikate des Systems verwendet.")}</p>
          )}
          {(settings.extraCertificates || []).map((file) => (
            <div className="accounts-certificate" key={file}>
              <FileKey size={13} />
              <span title={file}>{file}</span>
              <button
                type="button"
                className="quiet-button"
                title={t("Entfernen")}
                onClick={() => onChange({
                  extraCertificates: (settings.extraCertificates || []).filter((item) => item !== file),
                })}
              ><Trash2 size={13} /></button>
            </div>
          ))}
          <button type="button" className="secondary-button" onClick={onAddCertificate}>
            <Plus size={15} /> {t("Zertifikat hinzufügen")}
          </button>
        </div>
      </section>
    </div>
  );
}
