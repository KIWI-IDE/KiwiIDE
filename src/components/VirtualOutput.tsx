import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Above this many lines the pane stops laying the whole log out at once.
 *
 * Chosen so that everything an ordinary build prints keeps the behaviour it
 * has always had — wrapped lines, selectable as one block. A log that is
 * longer than this is one nobody reads end to end anyway, and laying it out on
 * every appended chunk is what makes a running build stutter.
 */
const VIRTUALIZE_ABOVE_LINES = 4_000;

/** Height of one row while virtualizing. Must match .output-virtual-row. */
const ROW_HEIGHT = 18;

/** Rows kept above and below the viewport so scrolling does not flicker. */
const OVERSCAN = 20;

/**
 * The output of a build, a run or a test, however long it is.
 *
 * A log is one string, and a `<pre>` holding it is re-laid-out from the top
 * every time a chunk is appended — which is exactly when somebody is watching
 * it. Past a few thousand lines that is visible as stutter, and it gets worse
 * as the build goes on.
 *
 * So above a threshold only the rows in view are put in the document. The cost
 * is wrapping: a row has to be one line for its position to be known without
 * measuring it, so long lines scroll sideways instead of wrapping. Below the
 * threshold nothing changes at all.
 */
export function VirtualOutput({ text, className = "", emptyText = "" }: {
  text: string;
  className?: string;
  emptyText?: string;
}) {
  const lines = useMemo(() => (text ? text.split("\n") : []), [text]);
  const virtualize = lines.length > VIRTUALIZE_ABOVE_LINES;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  // Whether the reader is at the bottom, decided before the new rows land:
  // a log that is being followed should keep following, and one that has been
  // scrolled up to read must not be yanked away.
  const followRef = useRef(true);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !virtualize) return undefined;
    const measure = () => setHeight(viewport.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [virtualize]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !virtualize || !followRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [lines.length, virtualize]);

  if (!text) return <pre className={`output-view ${className}`}>{emptyText}</pre>;

  if (!virtualize) {
    return <pre className={`output-view ${className}`}>{text}</pre>;
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil((height || ROW_HEIGHT * 40) / ROW_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(lines.length, first + visibleCount);

  return (
    <div
      className={`output-view output-virtual ${className}`}
      ref={viewportRef}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        setScrollTop(viewport.scrollTop);
        followRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < ROW_HEIGHT * 2;
      }}
    >
      {/* Holds the scrollbar open for the whole log, so the position of the
          thumb means what it would mean if every line were there. */}
      <div className="output-virtual-spacer" style={{ height: lines.length * ROW_HEIGHT }}>
        <div className="output-virtual-rows" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
          {lines.slice(first, last).map((line, index) => (
            <div className="output-virtual-row" key={first + index}>{line || " "}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
