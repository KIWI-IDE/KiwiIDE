import type { DependencyAdvice } from "../types";
import { t } from "../i18n";

export function DependencyAdvicePanel({ advice, version, checking, error, allowIncompatible, onAllow, onPick, onCheck }: {
  advice: DependencyAdvice | null; version: string; checking: boolean; error: string;
  allowIncompatible: boolean; onAllow: (value: boolean) => void; onPick: (version: string) => void; onCheck: () => void;
}) {
  const report = advice?.versions.find(entry => entry.version === version);
  return <aside className="dependency-advice" role="status" aria-live="polite">
    {checking ? <strong>{t("Kompatibilität wird geprüft…")}</strong> : <strong className={report?.status === "incompatible" ? "incompatible" : ""}>
      {report?.status === "compatible" ? t("Laut Metadaten passend") : report?.status === "incompatible" ? t("Passt nicht zum Projekt") : t("Nicht vollständig prüfbar")}
    </strong>}
    {advice && <small>{advice.javaTarget ? `Java ${advice.javaTarget}` : t("Java-Ziel unbekannt")}{advice.minecraftTarget ? ` · Minecraft ${advice.minecraftTarget}` : ""}</small>}
    {error && <p>{t("Die Kompatibilitätsprüfung ist nicht erreichbar. Die Versionsauswahl bleibt nutzbar.")}</p>}
    {report?.reasons.map(reason => <p key={reason}>{t(reason)}</p>)}
    {report?.notes.map(note => <p key={note}>{t(note)}</p>)}
    {!checking && !error && !report && <p>{t("Für diese Version liegen noch keine geprüften Metadaten vor.")}</p>}
    <div>
      {advice?.recommendedVersion && advice.recommendedVersion !== version && <button type="button" onClick={() => onPick(advice.recommendedVersion!)}>{t("Empfohlene Version verwenden")}: {advice.recommendedVersion}</button>}
      {!checking && !report && !error && <button type="button" onClick={onCheck}>{t("Diese Version prüfen")}</button>}
      <label><input type="checkbox" checked={allowIncompatible} onChange={event => onAllow(event.target.checked)} />{t("Auch unpassende Versionen verwenden")}</label>
    </div>
  </aside>;
}
