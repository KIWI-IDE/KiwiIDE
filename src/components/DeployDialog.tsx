import { CircleAlert, CircleCheck, Rocket, Server, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeployTarget } from "../types";
import { t } from "../i18n";

/**
 * Where the built jar goes, and what runs once it is there.
 *
 * The loop this closes: build, copy, restart, watch. Everything on the wire is
 * the system's own `scp` and `ssh`, so the key, the agent and `~/.ssh/config`
 * that already work in a terminal work here — Kiwi never sees a credential and
 * has nothing to store.
 *
 * The output is streamed as it arrives rather than collected and shown at the
 * end. A minute of nothing followed by everything at once is worse than a
 * terminal, which is what this replaces.
 */
export function DeployDialog({
  workspaceRoot,
  onClose,
}: {
  workspaceRoot: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<DeployTarget | null>(null);
  const [lines, setLines] = useState<Array<{ line: string; kind: string }>>([]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    void window.kiwi?.deploy.load(workspaceRoot).then(setTarget).catch(() => setTarget(null));
  }, [workspaceRoot]);

  useEffect(() => window.kiwi?.deploy.onLine((payload) => {
    if (payload.root !== workspaceRoot) return;
    setLines((current) => [...current, { line: payload.line, kind: payload.kind }]);
  }), [workspaceRoot]);

  /* The newest line is the one being waited for. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);

  const change = (patch: Partial<DeployTarget>) => setTarget((current) => (current ? { ...current, ...patch } : current));

  const reportError = (error: unknown) => {
    setOutcome({ ok: false, text: error instanceof Error ? error.message : String(error) });
  };

  const store = async () => {
    if (!target) return;
    // A blur can still be saving an earlier edit when Upload is clicked.
    // Finish it before saving the target that this deployment will use.
    const saving = saveQueueRef.current.catch(() => undefined)
      .then(() => window.kiwi!.deploy.save(workspaceRoot, target));
    saveQueueRef.current = saving;
    const saved = await saving;
    setTarget((current) => current === target ? saved : current);
  };

  const send = async () => {
    if (!target || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setLines([]);
    setOutcome(null);
    try {
      await store();
      const result = await window.kiwi!.deploy.run(workspaceRoot);
      setOutcome({
        ok: result.ok,
        text: result.ok
          ? (result.restarted ? t("Übertragen und neu gestartet.") : t("Übertragen."))
          : result.problem,
      });
    } catch (error) {
      reportError(error);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <section className="deploy-dialog" role="dialog" aria-modal onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <Server size={18} />
            <span>
              <strong>{t("Auf Server übertragen")}</strong>
              <small>{t("Kopiert das gebaute Artefakt per scp und startet den Dienst per ssh neu.")}</small>
            </span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Schließen")}><X size={16} /></button>
        </header>

        {!target ? (
          <div className="deploy-body"><p>{t("Wird geladen …")}</p></div>
        ) : (
          <div className="deploy-body">
            <div className="deploy-grid">
              <label>
                <span>{t("Server")}</span>
                <input
                  value={target.host}
                  disabled={running}
                  placeholder="cloud.beispiel.de"
                  spellCheck={false}
                  onChange={(event) => change({ host: event.target.value })}
                  onBlur={() => void store().catch(reportError)}
                />
              </label>
              <label>
                <span>{t("Benutzer")}</span>
                <input
                  value={target.user}
                  disabled={running}
                  placeholder="robin"
                  spellCheck={false}
                  onChange={(event) => change({ user: event.target.value })}
                  onBlur={() => void store().catch(reportError)}
                />
              </label>
              <label className="deploy-port">
                <span>{t("Port")}</span>
                <input
                  value={String(target.port)}
                  disabled={running}
                  inputMode="numeric"
                  onChange={(event) => change({ port: Number(event.target.value) || 22 })}
                  onBlur={() => void store().catch(reportError)}
                />
              </label>
            </div>

            <label className="deploy-field">
              <span>{t("Datei im Projekt")}</span>
              <input
                value={target.artifact}
                disabled={running}
                placeholder="build/libs/*-all.jar"
                spellCheck={false}
                onChange={(event) => change({ artifact: event.target.value })}
                onBlur={() => void store().catch(reportError)}
              />
              {/* The version in a shadowJar's name changes every release, so
                  the name cannot be written down once. */}
              <small>{t("Ein * im Dateinamen ist erlaubt; genommen wird die neueste Übereinstimmung.")}</small>
            </label>

            <label className="deploy-field">
              <span>{t("Zielverzeichnis auf dem Server")}</span>
              <input
                value={target.remoteDirectory}
                disabled={running}
                placeholder="/opt/honeymc"
                spellCheck={false}
                onChange={(event) => change({ remoteDirectory: event.target.value })}
                onBlur={() => void store().catch(reportError)}
              />
            </label>

            <label className="deploy-field">
              <span>{t("Neustart-Befehl")}</span>
              <input
                value={target.restartCommand}
                disabled={running}
                placeholder="systemctl --user restart honeymc"
                spellCheck={false}
                onChange={(event) => change({ restartCommand: event.target.value })}
                onBlur={() => void store().catch(reportError)}
              />
              <small>{t("Leer lassen, um nur zu kopieren.")}</small>
            </label>

            <p className="deploy-note">
              {t("Es werden ssh und scp des Systems benutzt — mit deinem Schlüssel, deinem Agenten und deiner ~/.ssh/config. Kiwi fragt nie nach einem Passwort und speichert keines.")}
            </p>

            {(lines.length > 0 || running) && (
              <div className="deploy-log" ref={logRef}>
                {lines.map((entry, index) => (
                  <div key={index} className={`deploy-line deploy-${entry.kind}`}>{entry.line}</div>
                ))}
                {running && <div className="deploy-line deploy-step">…</div>}
              </div>
            )}

            {outcome && (
              <div className={`deploy-outcome ${outcome.ok ? "ok" : "bad"}`}>
                {outcome.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                <span>{outcome.text}</span>
              </div>
            )}
          </div>
        )}

        <footer className="modal-actions">
          <button type="button" className="quiet-button" onClick={onClose}>{t("Schließen")}</button>
          <button type="button" className="primary-button" onClick={() => void send()} disabled={!target || running}>
            <Rocket size={14} /> {running ? t("Läuft …") : t("Übertragen")}
          </button>
        </footer>
      </section>
    </div>
  );
}
