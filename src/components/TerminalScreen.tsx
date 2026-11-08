import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

export function TerminalScreen({
  output,
  fontSize = 12,
  transparent = false,
  background = "",
  foreground = "",
  onData,
  onResize,
  autoFocus = false,
}: {
  output: string;
  fontSize?: number;
  transparent?: boolean;
  /**
   * The terminal's own colours, when the theme editor has set them.
   *
   * xterm draws on a canvas and knows nothing about CSS variables, so its
   * colours have to be handed to it. Empty means "keep what the theme always
   * gave", which is what an untouched setting must look like.
   */
  background?: string;
  foreground?: string;
  onData?: (data: string) => void;
  onResize?: (columns: number, rows: number) => void;
  autoFocus?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const previousRef = useRef("");
  const outputRef = useRef(output);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const autoFocusRef = useRef(autoFocus);
  outputRef.current = output;
  onDataRef.current = onData;
  onResizeRef.current = onResize;
  autoFocusRef.current = autoFocus;

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      allowTransparency: transparent,
      convertEol: true,
      cursorBlink: true,
      disableStdin: !onDataRef.current,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize,
      lineHeight: 1.3,
      scrollback: 10_000,
      theme: {
        background: transparent ? "#00000000" : (background || "#111410"),
        foreground: foreground || "#c9d1c5",
        cursor: "#9fea72",
        black: "#171a16",
        brightBlack: "#616a5e",
        green: "#8ee563",
        brightGreen: "#a5f47a",
        magenta: "#bf9aff",
        brightMagenta: "#d2bcff",
        red: "#f47c7c",
        yellow: "#e9b968",
        blue: "#80bdf4",
        cyan: "#75d9c7",
        white: "#dfe4da",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    let lastColumns = 0;
    let lastRows = 0;
    const reportSize = () => {
      if (terminal.cols === lastColumns && terminal.rows === lastRows) return;
      lastColumns = terminal.cols;
      lastRows = terminal.rows;
      onResizeRef.current?.(terminal.cols, terminal.rows);
    };
    const dataDisposable = terminal.onData((data) => onDataRef.current?.(data));
    const resizeDisposable = terminal.onResize(reportSize);
    fit.fit();
    reportSize();
    // Recreating xterm for a font/theme change used to leave it blank: the
    // output prop itself had not changed, so the output effect did not run.
    // Seed the new instance from the latest buffer before observing updates.
    if (outputRef.current) terminal.write(outputRef.current);
    previousRef.current = outputRef.current;
    if (autoFocusRef.current) queueMicrotask(() => terminal.focus());
    const observer = new ResizeObserver(() => {
      fit.fit();
      reportSize();
    });
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      previousRef.current = "";
    };
  }, [background, fontSize, foreground, transparent]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previous = previousRef.current;
    if (output.startsWith(previous)) terminal.write(output.slice(previous.length));
    else {
      // `clear()` keeps the current prompt row, which would leave the last line
      // of the previous run stuck above fresh output. `reset()` empties both
      // the scrollback and the viewport.
      terminal.reset();
      terminal.write(output);
    }
    previousRef.current = output;
  }, [output]);

  return <div className="xterm-host" ref={hostRef} />;
}
