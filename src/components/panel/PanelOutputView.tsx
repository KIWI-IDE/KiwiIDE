import { useEffect, useRef } from "react";
import type { PanelWindowSnapshot } from "../../types";

/**
 * Build, Run and generic output in a detached tool window.
 *
 * The text belongs to the workbench, which streams it from the running
 * process; this view only follows along and keeps the newest line in sight.
 */
export function PanelOutputView({ output }: { output: PanelWindowSnapshot["output"] }) {
  const surface = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    // Only follow while the reader is already at the end, so scrolling back
    // through a long build is not undone by the next line.
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    if (atEnd) element.scrollTop = element.scrollHeight;
  }, [output.text]);

  return (
    <div className="build-output">
      <pre ref={surface}>{output.text || "Noch keine Ausgabe."}</pre>
      {output.exitCode !== null && (
        <footer className={output.exitCode === 0 ? "exit-ok" : "exit-failed"}>
          Prozess beendet mit Code {output.exitCode}
        </footer>
      )}
    </div>
  );
}
