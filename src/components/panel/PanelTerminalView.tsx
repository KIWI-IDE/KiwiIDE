import { useEffect, useRef, useState } from "react";
import type { PanelWindowCommand, PanelWindowSnapshot } from "../../types";
import { t } from "../../i18n";

/**
 * The terminal buffer in a detached tool window.
 *
 * A full interactive terminal already has its own window per session — that
 * one is attached straight to the PTY. This view follows the workbench buffer
 * and can send a line, which is what makes the detached tool window complete
 * rather than a hole where the Terminal tab used to be.
 */
export function PanelTerminalView({
  terminal,
  onCommand,
}: {
  terminal: PanelWindowSnapshot["terminal"];
  onCommand: (command: PanelWindowCommand) => void;
}) {
  const [line, setLine] = useState("");
  const surface = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    if (atEnd) element.scrollTop = element.scrollHeight;
  }, [terminal.output]);

  return (
    <div className="terminal">
      <div className="terminal-sessions">
        {terminal.sessions.map((sessionId) => (
          <span key={sessionId} className={sessionId === terminal.active ? "active" : ""}>
            <button onClick={() => onCommand({ type: "selectTerminal", sessionId })}>Terminal {sessionId}</button>
          </span>
        ))}
      </div>
      <pre className="terminal-screen" ref={surface}>{terminal.output}</pre>
      <div className="terminal-input-row">
        <span>{t("Befehl")}</span><span className="terminal-angle">›</span>
        <input
          value={line}
          spellCheck={false}
          placeholder={t("Zeile an das Terminal senden…")}
          onChange={(event) => setLine(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !line.trim()) return;
            onCommand({ type: "terminalInput", sessionId: terminal.active, text: `${line}\r` });
            setLine("");
          }}
        />
      </div>
    </div>
  );
}
