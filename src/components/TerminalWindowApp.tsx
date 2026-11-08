import { ArrowDownToLine, Maximize2, Minus, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { IdeSettings } from "../types";
import { findTheme, personalizationVariables } from "../themes";
import { KiwiLogo } from "./KiwiLogo";
import { LazyTerminalScreen as TerminalScreen } from "./LazyTerminalScreen";
import { t } from "../i18n";

const MAX_OUTPUT_LENGTH = 250_000;

const projectName = (root: string) => root.split(/[\\/]/).filter(Boolean).at(-1) || root;

export function TerminalWindowApp() {
  const query = new URLSearchParams(window.location.search);
  const initialContext = {
    projectRoot: query.get("projectRoot") || "",
    sessionId: query.get("sessionId") || "1",
  };
  const [context, setContext] = useState(initialContext);
  const contextRef = useRef(initialContext);
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [backgroundImageData, setBackgroundImageData] = useState("");
  const [output, setOutput] = useState("");
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [cwd, setCwd] = useState(initialContext.projectRoot);
  const [shell, setShell] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", findTheme(settings?.theme || "").id);
    document.documentElement.style.setProperty("--roundness", String(Math.max(0, Math.min(250, settings?.uiRoundness ?? 100)) / 100));
  }, [settings?.theme]);

  useEffect(() => {
    if (!window.kiwi) {
      setError("Kiwi API ist nicht verfügbar.");
      setLoading(false);
      return undefined;
    }
    let disposed = false;
    const append = (text: string) => {
      if (!disposed) setOutput((current) => `${current}${text}`.slice(-MAX_OUTPUT_LENGTH));
    };
    const removeOutput = window.kiwi.terminal.onOutput((payload) => {
      const current = contextRef.current;
      if (payload.projectRoot !== current.projectRoot || (payload.sessionId || "1") !== current.sessionId) return;
      if (payload.cwd) setCwd(payload.cwd);
      append(payload.text);
    });
    const removeExit = window.kiwi.terminal.onExit((payload) => {
      const current = contextRef.current;
      if (payload.projectRoot !== current.projectRoot || (payload.sessionId || "1") !== current.sessionId) return;
      setRunning(false);
      append(`\n[Prozess beendet: ${payload.code}]\n\n`);
    });
    const removeSettings = window.kiwi.settings.onChanged(({ settings: next }) => setSettings(next));

    void (async () => {
      try {
        const [nextSettings, ownedContext] = await Promise.all([
          window.kiwi!.settings.get(),
          window.kiwi!.terminal.windowContext(),
        ]);
        const nextContext = ownedContext || initialContext;
        if (!nextContext.projectRoot) throw new Error("Der Terminal-Kontext fehlt.");
        contextRef.current = nextContext;
        setContext(nextContext);
        setSettings(nextSettings);
        await window.kiwi!.terminal.start(nextContext.projectRoot, nextContext.sessionId);
        const snapshot = await window.kiwi!.terminal.snapshot(nextContext.projectRoot, nextContext.sessionId);
        if (disposed) return;
        setOutput(snapshot.output);
        setRunning(snapshot.running);
        setCwd(snapshot.cwd || nextContext.projectRoot);
        setShell(projectName(snapshot.shell));
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Terminal konnte nicht geladen werden.");
      } finally {
        if (!disposed) setLoading(false);
      }
    })();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const current = contextRef.current;
      void window.kiwi?.terminal.closeWindow(current.projectRoot, current.sessionId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      disposed = true;
      removeOutput();
      removeExit();
      removeSettings();
      window.removeEventListener("keydown", onKeyDown);
    };
  // A terminal window has immutable ownership; a second session receives a
  // different BrowserWindow and therefore a different component instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!settings?.backgroundImage || !window.kiwi) {
      setBackgroundImageData("");
      return undefined;
    }
    void window.kiwi.settings.backgroundImageData(settings.backgroundImage)
      .then((data) => { if (!cancelled) setBackgroundImageData(data); })
      .catch(() => { if (!cancelled) setBackgroundImageData(""); });
    return () => { cancelled = true; };
  }, [settings?.backgroundImage]);

  const execute = async (event?: FormEvent) => {
    event?.preventDefault();
    const next = command.trim();
    if (!next || !window.kiwi || !context.projectRoot) return;
    setHistory((items) => [next, ...items.filter((item) => item !== next)].slice(0, 50));
    setHistoryIndex(-1);
    setCommand("");
    setRunning(true);
    try {
      await window.kiwi.terminal.execute({ root: context.projectRoot, command: next, sessionId: context.sessionId });
    } catch (reason) {
      appendError(reason instanceof Error ? reason.message : "Befehl konnte nicht ausgeführt werden.");
    }
  };

  const appendError = (message: string) => {
    setOutput((current) => `${current}\n[Fehler] ${message}\n`.slice(-MAX_OUTPUT_LENGTH));
  };

  const redock = () => {
    if (!context.projectRoot) return;
    void window.kiwi?.terminal.closeWindow(context.projectRoot, context.sessionId);
  };

  const shellStyle = settings ? {
    ...personalizationVariables(settings),
    "--workspace-background-image": backgroundImageData ? `url(${JSON.stringify(backgroundImageData)})` : "none",
    "--workspace-background-opacity": String(settings.backgroundOpacity / 100),
    zoom: settings.uiScale,
  } as CSSProperties : undefined;
  const shellClasses = [
    "app-shell",
    "terminal-window-shell",
    backgroundImageData ? "has-workspace-background" : "",
    `density-${settings?.uiDensity || "compact"}`,
    settings?.reducedMotion ? "reduced-motion" : "",
    settings?.enhancedFocus ? "enhanced-focus" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClasses} style={shellStyle}>
      <header className="titlebar terminal-window-titlebar">
        <div className="terminal-window-brand">
          <KiwiLogo size={20} />
          <strong>Terminal {context.sessionId}</strong>
          <span>{context.projectRoot ? projectName(context.projectRoot) : "Kiwi"}</span>
        </div>
        <div className="terminal-window-actions">
          <button type="button" onClick={redock} title={t("Zurück ins Hauptfenster (Esc)")} aria-label={t("Terminal zurück ins Hauptfenster docken")} aria-keyshortcuts="Escape">
            <ArrowDownToLine size={14} /><span>{t("Andocken")}</span>
          </button>
          <button
            type="button"
            onClick={() => void window.kiwi?.terminal.stop(context.projectRoot, context.sessionId)}
            title={t("Terminalprozess beenden")}
            aria-label={t("Terminalprozess beenden")}
            disabled={!running}
          >
            <Square size={11} fill="currentColor" /><span>{t("Stop")}</span>
          </button>
        </div>
        <div className="window-controls">
          <button onClick={() => window.kiwi?.app.minimize()} aria-label={t("Minimieren")}><Minus size={15} /></button>
          <button onClick={() => window.kiwi?.app.maximize()} aria-label={t("Maximieren oder wiederherstellen")}><Maximize2 size={14} /></button>
          <button className="close" onClick={redock} aria-label={t("Schließen und zurückdocken")}><X size={15} /></button>
        </div>
      </header>
      <main className="terminal-window-content">
        {loading ? (
          <div className="terminal-window-state" role="status"><span className="kiwi-spinner" /> {t("Terminal wird verbunden …")}</div>
        ) : error ? (
          <div className="terminal-window-state error" role="alert"><strong>{t("Terminal nicht verfügbar")}</strong><span>{error}</span></div>
        ) : (
          <div className="terminal terminal-window-terminal">
            <div className="terminal-window-session-line">
              <span className={running ? "running" : "stopped"} />
              <strong>{shell || t("Terminal")}</strong>
              <span>{cwd || context.projectRoot}</span>
            </div>
            <TerminalScreen
              output={output}
              fontSize={settings?.terminalFontSize || 12}
              transparent={Boolean(backgroundImageData)}
              background={settings?.themeColorOverrides?.terminalBackground
                ? `#${settings.themeColorOverrides.terminalBackground}` : ""}
              foreground={settings?.themeColorOverrides?.terminalForeground
                ? `#${settings.themeColorOverrides.terminalForeground}` : ""}
              autoFocus
              onData={(data) => {
                if (window.kiwi) {
                  setRunning(true);
                  void window.kiwi.terminal.input(context.projectRoot, data, context.sessionId).catch((reason) => {
                  appendError(reason instanceof Error ? reason.message : "Terminaleingabe fehlgeschlagen.");
                  });
                }
              }}
              onResize={(columns, rows) => {
                if (window.kiwi) void window.kiwi.terminal.resize(context.projectRoot, columns, rows, context.sessionId).catch(() => undefined);
              }}
            />
            <form className="terminal-input-row" onSubmit={execute}>
              <span>{t("PS")}</span><strong>{cwd || context.projectRoot}</strong><span className="terminal-angle">›</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = Math.min(historyIndex + 1, history.length - 1);
                    setHistoryIndex(next);
                    setCommand(history[next] || "");
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    const next = Math.max(historyIndex - 1, -1);
                    setHistoryIndex(next);
                    setCommand(next < 0 ? "" : history[next] || "");
                  }
                }}
                placeholder={t("Befehl eingeben …")}
                aria-label={t("Terminalbefehl")}
                spellCheck={false}
              />
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
