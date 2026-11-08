import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ArrowDownToLine, Filter, FolderOpen, Pause, Play, ScrollText, Trash2, WrapText } from "lucide-react";
import { t } from "../../i18n";
import { tailerStore, type TailerSnapshot } from "./tailer-store";

type Matcher =
  | null
  | { invalid: true }
  | { invalid: false; re: RegExp }
  | { invalid: false; needle: string; caseSensitive: boolean };

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function buildMatcher(state: TailerSnapshot): Matcher {
  if (!state.filter) return null;
  if (state.regex) {
    try {
      return { invalid: false, re: new RegExp(state.filter, state.caseSensitive ? "g" : "gi") };
    } catch {
      return { invalid: true };
    }
  }
  return {
    invalid: false,
    needle: state.caseSensitive ? state.filter : state.filter.toLowerCase(),
    caseSensitive: state.caseSensitive,
  };
}

function lineMatches(text: string, matcher: Matcher): boolean {
  if (!matcher || matcher.invalid) return true;
  if ("re" in matcher) {
    matcher.re.lastIndex = 0;
    return matcher.re.test(text);
  }
  return (matcher.caseSensitive ? text : text.toLowerCase()).includes(matcher.needle);
}

/** Wraps the matched spans of a line in <mark> so the hit stands out. */
function highlight(text: string, matcher: Matcher): ReactNode {
  if (!matcher || matcher.invalid) return text;

  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;

  if ("re" in matcher) {
    matcher.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].length === 0) {
        matcher.re.lastIndex++; // never stall on a zero-width match
        continue;
      }
      if (start > last) nodes.push(text.slice(last, start));
      nodes.push(<mark key={key++}>{text.slice(start, end)}</mark>);
      last = end;
    }
  } else {
    const hay = matcher.caseSensitive ? text : text.toLowerCase();
    let index = hay.indexOf(matcher.needle);
    while (index >= 0 && matcher.needle.length > 0) {
      if (index > last) nodes.push(text.slice(last, index));
      nodes.push(<mark key={key++}>{text.slice(index, index + matcher.needle.length)}</mark>);
      last = index + matcher.needle.length;
      index = hay.indexOf(matcher.needle, last);
    }
  }

  if (last === 0) return text;
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * The Tailer tool window: follows a log file live.
 *
 * The buffer and the file subscription live in {@link tailerStore}, outside
 * React, so this view can be unmounted and brought back without losing the log.
 */
export function TailerPanel({ workspaceRoot, fontSize }: { workspaceRoot: string; fontSize?: number }) {
  const state = useSyncExternalStore(tailerStore.subscribe, tailerStore.getSnapshot, tailerStore.getSnapshot);
  const surface = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);

  const matcher = useMemo(() => buildMatcher(state), [state.filter, state.regex, state.caseSensitive]);
  const invalid = Boolean(matcher && matcher.invalid);

  const shown = useMemo(() => {
    if (!state.filter || invalid) return state.lines;
    return state.lines.filter((line) => lineMatches(line.text, matcher));
  }, [state.lines, state.filter, matcher, invalid]);

  // Follow the tail, but only while the reader is already at the bottom.
  useEffect(() => {
    const element = surface.current;
    if (!element || !state.follow) return;
    programmatic.current = true;
    element.scrollTop = element.scrollHeight;
    requestAnimationFrame(() => { programmatic.current = false; });
  }, [shown, state.follow, state.wrap]);

  const onScroll = () => {
    const element = surface.current;
    if (!element || programmatic.current) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    if (atBottom !== state.follow) tailerStore.setFollow(atBottom);
  };

  return (
    <div className="tailer">
      <div className="tailer-toolbar">
        <button className={state.follow ? "active" : ""} title={t("Dem Dateiende folgen")} onClick={() => tailerStore.setFollow(!state.follow)}>
          <ArrowDownToLine size={13} /><span>{t("Folgen")}</span>
        </button>
        <button className={state.paused ? "active" : ""} title={t("Ansicht anhalten")} onClick={() => tailerStore.setPaused(!state.paused)}>
          {state.paused ? <Play size={13} /> : <Pause size={13} />}
          <span>{state.paused ? t("Weiter") : t("Pause")}{state.paused && state.pendingCount ? ` (${state.pendingCount})` : ""}</span>
        </button>
        <button title={t("Ansicht leeren")} onClick={() => tailerStore.clear()}><Trash2 size={13} /></button>
        <button className={state.wrap ? "active" : ""} title={t("Zeilenumbruch")} onClick={() => tailerStore.setWrap(!state.wrap)}><WrapText size={13} /></button>
        <span className="tailer-filter">
          <Filter size={12} aria-hidden="true" />
          <input
            value={state.filter}
            className={invalid ? "invalid" : ""}
            placeholder={t("Filtern…")}
            spellCheck={false}
            aria-label={t("Zeilen filtern")}
            onChange={(event) => tailerStore.setFilter(event.target.value)}
          />
          <button className={state.regex ? "active" : ""} title={t("Regulärer Ausdruck")} onClick={() => tailerStore.setRegex(!state.regex)}>.*</button>
          <button className={state.caseSensitive ? "active" : ""} title={t("Groß-/Kleinschreibung beachten")} onClick={() => tailerStore.setCaseSensitive(!state.caseSensitive)}>Aa</button>
        </span>
        <span className="tailer-spacer" />
        <span className="tailer-file" title={state.file}>
          {state.file ? basename(state.file) : t("keine Datei")}
          {state.file && !state.available ? ` · ${t("wartet")}` : ""}
        </span>
        <button title={t("Logdatei zum Verfolgen öffnen")} onClick={() => void tailerStore.choose(workspaceRoot)}>
          <FolderOpen size={13} /><span>{t("Öffnen…")}</span>
        </button>
      </div>

      <div
        className={`tailer-surface${state.wrap ? " wrap" : ""}`}
        ref={surface}
        onScroll={onScroll}
        style={fontSize ? { fontSize } : undefined}
      >
        {!state.file ? (
          <div className="tailer-empty">
            <ScrollText size={22} />
            <span>{t("Keine Datei ausgewählt.")}</span>
            <button className="primary-button" onClick={() => void tailerStore.choose(workspaceRoot)}>{t("Logdatei öffnen…")}</button>
          </div>
        ) : shown.length === 0 ? (
          <div className="tailer-empty">
            <span>{state.filter ? t("Keine passenden Zeilen.") : state.available ? t("Noch keine Ausgabe.") : t("Warte auf Datei…")}</span>
          </div>
        ) : (
          shown.map((line) => (
            <div key={line.seq} className={`tailer-line level-${line.level}`}>
              {highlight(line.text, matcher)}
            </div>
          ))
        )}
      </div>

      {state.error && <div className="tailer-error" role="alert">{state.error}</div>}
    </div>
  );
}
