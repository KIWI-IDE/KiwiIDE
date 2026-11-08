import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileCode2,
  Info,
  Monitor,
  Play,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PanelWindowCommand, PanelWindowSnapshot } from "../types";
import { findTheme } from "../themes";
import { StandaloneDocumentHeader, StandaloneWindowFrame } from "./StandaloneWindowLayout";
import { PanelDebugView } from "./panel/PanelDebugView";
import { PanelOutputView } from "./panel/PanelOutputView";
import { PanelTerminalView } from "./panel/PanelTerminalView";
import { PanelTestsView } from "./panel/PanelTestsView";
import { t } from "../i18n";

/**
 * The tool window on its own — a real Kiwi window that can live on a second
 * monitor.
 *
 * It deliberately holds no workbench logic. The workbench runs the language
 * server, the build and the debugger, and publishes what its tool window
 * shows; this window draws exactly that and sends every click back. So there
 * is one source of truth, and the detached window can never disagree with the
 * one in the workbench.
 */
export function PanelWindowApp() {
  const [snapshot, setSnapshot] = useState<PanelWindowSnapshot | null>(null);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    const remove = window.kiwi.panel.onState((next) => setSnapshot(next));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      window.kiwi?.app.close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      remove();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", findTheme(snapshot?.theme || "").id);
    document.documentElement.style.setProperty("--roundness", String(Math.max(0, Math.min(250, snapshot?.roundness ?? 100)) / 100));
  }, [snapshot?.theme, snapshot?.roundness]);

  const send = useCallback((command: PanelWindowCommand) => window.kiwi?.panel.request(command), []);

  if (!snapshot) {
    return (
      <StandaloneWindowFrame className="panel-window-shell" title={t("Werkzeugfenster")}>
        <div className="panel-window-waiting" role="status">
          <span className="kiwi-spinner" />
          Warte auf die Werkbank …
        </div>
      </StandaloneWindowFrame>
    );
  }

  const { view } = snapshot;
  return (
    <StandaloneWindowFrame
      className="panel-window-shell"
      title={`${view.toUpperCase()} — ${snapshot.projectName || "Kiwi"}`}
      settings={snapshot.settings}
    >
      <section className="standalone-window-document panel-window-document" aria-labelledby="panel-window-title">
      <StandaloneDocumentHeader
        id="panel-window-title"
        icon={<Monitor size={19} />}
        title={snapshot.tabs.find((tab) => tab.id === view)?.label || "Werkzeugfenster"}
        description={snapshot.projectName
          ? `Werkzeugfenster von ${snapshot.projectName} — dieselbe Sitzung wie in der Werkbank`
          : "Werkzeugfenster — dieselbe Sitzung wie in der Werkbank"}
        actions={(
          <button
            className="panel-window-attach"
            title={t("Zurück in die Werkbank holen")}
            onClick={() => {
              send({ type: "attach" });
              window.kiwi?.app.close();
            }}
          >{t("Andocken")}</button>
        )}
      />
      <div className="bottom-panel panel-dock-window" data-panel-view={view}>
        <div className="panel-tabs">
          {snapshot.tabs.map((tab) => (
            <button
              key={tab.id}
              className={view === tab.id ? "active" : ""}
              onClick={() => send({ type: "selectView", view: tab.id })}
            >{tab.label}</button>
          ))}
          <div className="panel-actions">
            {snapshot.running && (
              <button title={t("Prozess beenden")} onClick={() => send({ type: "stopProcess" })}>
                <Square size={12} fill="currentColor" />
              </button>
            )}
            <button title={t("Leeren")} onClick={() => send({ type: "clear" })}><Trash2 size={13} /></button>
          </div>
        </div>
        <div className="panel-content">
          {view === "problems" && (
            <div className="problems-view">
              <div className="problem-toolbar">
                {([
                  ["all", `Alle ${snapshot.problems.counts.all}`],
                  ["error", `Fehler ${snapshot.problems.counts.error}`],
                  ["warning", `Warnungen ${snapshot.problems.counts.warning}`],
                  ["info", `Hinweise ${snapshot.problems.counts.info}`],
                ] as Array<[string, string]>).map(([id, label]) => (
                  <button
                    key={id}
                    className={snapshot.problems.filter === id ? "active" : ""}
                    onClick={() => send({ type: "setDiagnosticFilter", filter: id })}
                  >{label}</button>
                ))}
              </div>
              {snapshot.problems.groups.length === 0 ? (
                <div className="empty-problems"><CircleCheck size={20} /><span>{t("Keine Probleme gefunden.")}</span></div>
              ) : (
                <div className="problem-groups">
                  {snapshot.problems.groups.map((group) => (
                    <div className="problem-group" key={group.file}>
                      <div className="problem-group-header">
                        <FileCode2 size={13} />
                        <strong>{group.name}</strong>
                        <small>{group.relative}</small>
                        <span>{group.items.length}</span>
                      </div>
                      {group.items.map((diagnostic, index) => (
                        <button
                          key={`${diagnostic.path}:${diagnostic.line}:${index}`}
                          onClick={() => send({
                            type: "selectDiagnostic",
                            path: diagnostic.path,
                            line: diagnostic.line,
                            column: diagnostic.column,
                            endLine: diagnostic.endLine,
                            endColumn: diagnostic.endColumn,
                          })}
                        >
                          {diagnostic.severity === "error"
                            ? <CircleX size={15} className="severity-error" />
                            : diagnostic.severity === "warning"
                              ? <CircleAlert size={15} className="severity-warning" />
                              : <Info size={15} className="severity-info" />}
                          <span className="problem-message">{diagnostic.message}</span>
                          {diagnostic.source && <span className="problem-source">{diagnostic.source}</span>}
                          <span className="problem-location">[{diagnostic.line}, {diagnostic.column}]</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {view === "todos" && (
            <div className="todo-view">
              {snapshot.todos.length === 0 ? (
                <div className="empty-problems"><CircleCheck size={20} /><span>{t("Keine offenen Marker.")}</span></div>
              ) : snapshot.todos.map((todo, index) => (
                <button
                  key={`${todo.path}:${todo.line}:${index}`}
                  onClick={() => send({ type: "openTodo", path: todo.path, line: todo.line, column: todo.column })}
                >
                  <span className={`todo-kind todo-kind-${todo.kind.toLowerCase()}`}>{todo.kind}</span>
                  <span className="todo-text">{todo.text}</span>
                  <span className="problem-location">{todo.name} [{todo.line}]</span>
                </button>
              ))}
            </div>
          )}
          {(view === "build" || view === "run" || view === "output") && (
            <PanelOutputView output={snapshot.output} />
          )}
          {view === "debug" && <PanelDebugView debug={snapshot.debug} onCommand={send} />}
          {view === "tests" && <PanelTestsView reports={snapshot.tests} onRun={send} />}
          {view === "http" && (
            <div className="http-view">
              {snapshot.http.length === 0 ? (
                <div className="empty-problems"><Play size={20} /><span>{t("Noch keine Anfrage gesendet.")}</span></div>
              ) : snapshot.http.map((response) => (
                <div className="http-response" key={response.id}>
                  <header>
                    <strong>{response.method}</strong>
                    <span>{response.url}</span>
                    <span className={response.status >= 400 ? "severity-error" : "severity-info"}>
                      {response.status} {response.statusText}
                    </span>
                    <small>{Math.round(response.durationMs)} ms</small>
                  </header>
                  <pre>{response.body}</pre>
                </div>
              ))}
            </div>
          )}
          {view === "terminal" && <PanelTerminalView terminal={snapshot.terminal} onCommand={send} />}
          {view === "tailer" && (
            <div className="empty-problems"><ScrollText size={20} /><span>{t("Der Tailer ist nur im Hauptfenster verfügbar.")}</span></div>
          )}
        </div>
      </div>
      </section>
    </StandaloneWindowFrame>
  );
}
