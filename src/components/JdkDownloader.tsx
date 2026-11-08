import { Download, FolderOpen, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { JdkInstallRoot, JdkPackage } from "../types";

/**
 * Fetching a Java runtime from inside the IDE.
 *
 * Kiwi cannot compile a line without a JDK, so "install Java first" is the wall
 * a new machine hits before anything else can be tried. The list is only loaded
 * when it is asked for: the workbench reaches the network nowhere else, and a
 * settings page that phones home the moment it opens would be a change of
 * character, not a convenience.
 */
type InstallResult = { installed: boolean; reason?: string; path: string; binary: JdkPackage };
type InstallPhase = "preparing" | "downloading" | "verifying" | "extracting" | "installing" | "done" | "";

export function JdkDownloader({ onInstalled }: { onInstalled: (result: InstallResult) => void | Promise<void> }) {
  const [versions, setVersions] = useState<Array<{ version: number; lts: boolean }>>([]);
  const [chosen, setChosen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(0);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState<InstallPhase>("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [ziel, setZiel] = useState<JdkInstallRoot | null>(null);
  const installingRef = useRef(0);

  // Which folder a download would go to. Read once when the panel appears: it
  // is the answer to "where is this about to put half a gigabyte", which is
  // worth seeing before pressing the button rather than after.
  useEffect(() => {
    let abgebrochen = false;
    void window.kiwi?.jdk.installRoot().then((antwort) => {
      if (!abgebrochen) setZiel(antwort);
    }).catch(() => undefined);
    return () => {
      abgebrochen = true;
    };
  }, []);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    return window.kiwi.jdk.onProgress((progress) => {
      if (installingRef.current && progress.feature !== installingRef.current) return;
      setPercent(progress.percent);
      setPhase(progress.phase || (progress.done ? "done" : "downloading"));
    });
  }, []);

  const load = async () => {
    if (!window.kiwi) return;
    setLoading(true);
    setFailed(false);
    setMessage("");
    try {
      const available = await window.kiwi.jdk.available();
      setVersions(available.versions);
      setChosen(available.mostRecentLts || available.versions[0]?.version || 0);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : t("Die Liste konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  };

  const install = async () => {
    if (!window.kiwi || !chosen) return;
    setInstalling(chosen);
    installingRef.current = chosen;
    setPercent(0);
    setPhase("preparing");
    setFailed(false);
    setMessage("");
    try {
      const result = await window.kiwi.jdk.install(chosen);
      // Saying where it went and that it is now the chosen one: a download
      // that changes nothing visible reads as a download that did not work.
      setMessage(result.installed
        ? `${t("Java")} ${result.binary.version} ${t("wurde installiert und als globale Laufzeit gewählt. Mit „Übernehmen“ speichern.")}`
        : `${t("Java")} ${result.binary.version} ${t("war bereits vorhanden und ist jetzt gewählt. Mit „Übernehmen“ speichern.")}`);
      await onInstalled(result);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : t("Der Download ist fehlgeschlagen."));
    } finally {
      installingRef.current = 0;
      setInstalling(0);
      setPhase("");
    }
  };

  const phaseLabel = phase === "preparing" ? t("Download wird vorbereitet …")
    : phase === "verifying" ? t("Prüfsumme wird geprüft …")
      : phase === "extracting" ? t("JDK wird entpackt …")
        : phase === "installing" ? t("JDK wird eingerichtet …")
          : `${percent} %`;

  if (!versions.length) {
    return (
      <div className="jdk-downloader">
        <button className="settings-sdk-add" onClick={() => void load()} disabled={loading}>
          <Download size={14} /> {loading ? t("Versionen werden geladen …") : t("Java herunterladen…")}
        </button>
      {ziel && (
        <div className="jdk-downloader-target">
          <span>
            <small>{t("Zielordner")}</small>
            <b title={ziel.root}>{ziel.root}</b>
          </span>
          <button
            type="button"
            className="settings-sdk-add"
            disabled={Boolean(installing)}
            onClick={() => void window.kiwi?.jdk.chooseInstallRoot().then((antwort) => {
              if (antwort) setZiel(antwort);
            }).catch(() => undefined)}
          ><FolderOpen size={14} /> {t("Ordner wählen…")}</button>
          {ziel.eigener && (
            <button
              type="button"
              className="settings-sdk-add"
              title={t("Zurück zu Kiwis eigenem Ordner")}
              disabled={Boolean(installing)}
              onClick={() => void window.kiwi?.jdk.resetInstallRoot().then(setZiel).catch(() => undefined)}
            ><RotateCcw size={14} /></button>
          )}
        </div>
      )}
        {message && <small className={failed ? "jdk-downloader-error" : ""}>{message}</small>}
      </div>
    );
  }

  return (
    <div className="jdk-downloader">
      <div className="settings-sdk-picker">
        <select
          value={chosen}
          aria-label={t("Java-Version zum Herunterladen")}
          disabled={Boolean(installing)}
          onChange={(event) => setChosen(Number(event.target.value))}
        >
          {versions.map((entry) => (
            <option key={entry.version} value={entry.version}>
              {`${t("Java")} ${entry.version}${entry.lts ? " · LTS" : ""}`}
            </option>
          ))}
        </select>
        <button className="settings-sdk-add" onClick={() => void install()} disabled={Boolean(installing) || !chosen}>
          <Download size={14} /> {installing ? phaseLabel : t("Herunterladen und einrichten")}
        </button>
      </div>
      {ziel && (
        <div className="jdk-downloader-target">
          <span>
            <small>{t("Zielordner")}</small>
            <b title={ziel.root}>{ziel.root}</b>
          </span>
          <button
            type="button"
            className="settings-sdk-add"
            disabled={Boolean(installing)}
            onClick={() => void window.kiwi?.jdk.chooseInstallRoot().then((antwort) => {
              if (antwort) setZiel(antwort);
            }).catch(() => undefined)}
          ><FolderOpen size={14} /> {t("Ordner wählen…")}</button>
          {ziel.eigener && (
            <button
              type="button"
              className="settings-sdk-add"
              title={t("Zurück zu Kiwis eigenem Ordner")}
              disabled={Boolean(installing)}
              onClick={() => void window.kiwi?.jdk.resetInstallRoot().then(setZiel).catch(() => undefined)}
            ><RotateCcw size={14} /></button>
          )}
        </div>
      )}
      {Boolean(installing) && (
        <div className="jdk-downloader-progress" role="progressbar" aria-valuetext={phaseLabel} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {/* Saying that the download is checked is worth the line: it is the
          reason a runtime fetched by an IDE can be trusted at all. */}
      <small className={failed ? "jdk-downloader-error" : ""}>
        {message || <><ShieldCheck size={12} /> {t("Von Eclipse Adoptium, per SHA-256 geprüft.")}</>}
      </small>
    </div>
  );
}
