import { ChevronRight, CircleDot, Pause, Play, RotateCcw, Square } from "lucide-react";
import type { PanelWindowCommand, PanelWindowSnapshot } from "../../types";
import { t } from "../../i18n";

/**
 * The debugger in a detached tool window.
 *
 * Stepping, threads, frames and variables all live in the debug adapter behind
 * the workbench, so every button here is a request rather than a local action.
 * That is what lets this window sit on another monitor and still drive the
 * same session.
 */
export function PanelDebugView({
  debug,
  onCommand,
}: {
  debug: PanelWindowSnapshot["debug"];
  onCommand: (command: PanelWindowCommand) => void;
}) {
  const active = debug.status === "paused" || debug.status === "running";
  const step = (command: string, label: string) => (
    <button
      key={command}
      disabled={debug.status !== "paused"}
      onClick={() => onCommand({ type: "debugCommand", command })}
    >{label}</button>
  );

  return (
    <div className="debug-panel">
      <div className="debug-controls">
        <span>{debug.status}</span>
        <button
          disabled={debug.status !== "paused"}
          title={t("Fortsetzen")}
          onClick={() => onCommand({ type: "debugCommand", command: "continue" })}
        ><Play size={13} fill="currentColor" /></button>
        <button
          disabled={debug.status !== "running"}
          title={t("Anhalten")}
          onClick={() => onCommand({ type: "debugCommand", command: "pause" })}
        ><Pause size={13} /></button>
        {step("stepOver", "Step Over")}
        {step("stepInto", "Step Into")}
        {step("stepOut", "Step Out")}
        {step("restartFrame", "Frame neu starten")}
        <button
          disabled={!active}
          title={t("Beenden")}
          onClick={() => onCommand({ type: "debugCommand", command: "stop" })}
        ><Square size={12} fill="currentColor" /></button>
        <button
          disabled={!active}
          title={t("Neu starten")}
          onClick={() => onCommand({ type: "debugCommand", command: "relaunch" })}
        ><RotateCcw size={13} /></button>
      </div>
      {!active && !debug.variables.length ? (
        <div className="debug-empty">{t("Debugger ist nicht aktiv.")}</div>
      ) : (
        <div className="debug-columns">
          <section>
            <header>{t("VARIABLEN")}</header>
            <div className="debug-variables">
              {debug.variables.map((variable) => (
                <button
                  key={`${variable.name}:${variable.referenceId ?? 0}`}
                  className="debug-variable"
                  disabled={!variable.hasChildren || !variable.referenceId}
                  onClick={() => variable.referenceId && onCommand({ type: "expandVariable", referenceId: variable.referenceId })}
                >
                  {variable.hasChildren ? <ChevronRight size={12} /> : <CircleDot size={9} />}
                  <strong>{variable.name}</strong>
                  <span>{variable.value}</span>
                  {variable.type && <small>{variable.type}</small>}
                </button>
              ))}
              {!debug.variables.length && <div className="debug-empty">{t("Keine Variablen im aktuellen Frame.")}</div>}
            </div>
            {debug.watches.length > 0 && (
              <div className="debug-watches">
                <header>{t("WATCHES")}</header>
                {debug.watches.map((watch) => (
                  <div key={watch.expression}><strong>{watch.expression}</strong><span>{watch.value}</span></div>
                ))}
              </div>
            )}
          </section>
          <section>
            <header>{t("THREADS & CALL STACK")}</header>
            <div className="debug-threads">
              {debug.threads.map((thread) => (
                <button
                  key={thread.id}
                  className={thread.selected ? "active" : ""}
                  onClick={() => onCommand({ type: "selectThread", threadId: thread.id })}
                >
                  {thread.name}{thread.suspended ? " · angehalten" : ""}
                </button>
              ))}
            </div>
            <div className="debug-frames">
              {debug.frames.map((frame) => (
                <button key={frame.id} onClick={() => onCommand({ type: "selectFrame", frameId: frame.id })}>
                  <strong>{frame.className}.{frame.methodName}</strong>
                  <small>{frame.sourceName}:{frame.line}</small>
                </button>
              ))}
              {!debug.frames.length && <div className="debug-empty">{t("Kein Stack — die JVM läuft.")}</div>}
            </div>
          </section>
        </div>
      )}
      {debug.output && <pre className="debug-output">{debug.output}</pre>}
    </div>
  );
}
