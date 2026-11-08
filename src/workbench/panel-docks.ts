import type { PanelView } from "../types";

/**
 * Where a tool window can sit.
 *
 * Three places along the bottom of the workbench, and a window of its own.
 * "bottom-left" is the foot of the Explorer's column, "bottom-right" the foot
 * of the build tool's, and "bottom" the row under the editor.
 *
 * Full-height side docks existed before, on either flank of the editor. Both
 * shapes they were given had the same fault: they took their width from the
 * file being edited, and the tab strip — PROBLEMS TODO BUILD RUN DEBUG TESTS
 * TERMINAL — had to be read in a column three hundred pixels wide. At the foot
 * of a column that is already there, a tool window costs the editor nothing.
 */
export type DockEdge =
  | "bottom"
  | "bottom-left"
  | "bottom-right"
  | "floating";

/**
 * The bottom of the workbench, left to right.
 *
 * One row can hold up to three tool windows: a corner on either side and
 * one in the middle. With a single window there the row looks exactly as it
 * always did, so the corners cost nothing until they are used.
 */
export const BOTTOM_DOCKS: DockEdge[] = ["bottom-left", "bottom", "bottom-right"];

export function isBottomDock(edge: DockEdge): boolean {
  return BOTTOM_DOCKS.includes(edge);
}

/** Order the tabs appear in, whichever edge they end up on. */
export const PANEL_VIEW_ORDER: PanelView[] = [
  "problems", "todos", "build", "run", "debug", "tests", "terminal", "tailer", "http", "output",
];

/**
 * Reads the selected output tab and migrates the short-lived collaboration tab.
 * CodeToGetter is a right-side tool now; restoring `collab` at the bottom would
 * otherwise leave a blank output window behind.
 */
export function sanitizePanelView(value: unknown, fallback: PanelView = "terminal"): PanelView {
  return typeof value === "string" && PANEL_VIEW_ORDER.includes(value as PanelView)
    ? value as PanelView
    : fallback;
}

export type PanelDocks = Partial<Record<PanelView, DockEdge>>;

const DOCK_EDGES = new Set<DockEdge>([
  "bottom", "bottom-left", "bottom-right", "floating",
]);

/**
 * Placements that no longer exist, and where their windows go.
 *
 * A session or a layout profile written by an earlier version names a
 * full-height side dock. Dropping those entries would silently empty a
 * workbench that had been arranged, so each one lands at the foot of the
 * column it used to occupy — which is where its window is now.
 */
const RETIRED_EDGES: Record<string, DockEdge> = { left: "bottom-left", right: "bottom-right" };

function readEdge(value: unknown): DockEdge | null {
  if (typeof value !== "string") return null;
  if (DOCK_EDGES.has(value as DockEdge)) return value as DockEdge;
  return RETIRED_EDGES[value] || null;
}

/**
 * Reads persisted dock data without trusting old or hand-edited storage.
 *
 * Sessions and layout profiles outlive individual Kiwi versions. Keeping the
 * validation here gives the renderer one migration path and prevents an
 * unknown tab/edge from producing a class name that has no layout rules.
 */
export function sanitizePanelDocks(value: unknown, fallback: PanelDocks = {}): PanelDocks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const result: PanelDocks = { ...fallback };
  for (const view of PANEL_VIEW_ORDER) {
    const edge = readEdge((value as Record<string, unknown>)[view]);
    if (edge) result[view] = edge;
  }
  return result;
}

/** Height reached while resizing the bottom tool window. */
export function resizedPanelHeight(startHeight: number, pointerDeltaY: number, viewportHeight: number): number {
  const maximum = Math.max(120, viewportHeight * 0.65);
  return Math.max(120, Math.min(maximum, startHeight - pointerDeltaY));
}

/**
 * The tab each edge shows.
 *
 * Every edge keeps its own selection, so opening Terminal on the right does
 * not change which of Problems/Build/Debug the bottom edge is showing. Only
 * known tabs survive: a stored selection for a tab that has since moved
 * elsewhere would leave the edge blank.
 */
export type DockSelection = Partial<Record<DockEdge, PanelView>>;

/** Edges read back from storage, without duplicates or invented names. */
export function sanitizeDockEdges(value: unknown): DockEdge[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<DockEdge>();
  for (const entry of value) {
    const edge = readEdge(entry);
    if (edge) seen.add(edge);
  }
  return ([...BOTTOM_DOCKS, "floating"] as DockEdge[]).filter((edge) => seen.has(edge));
}

export function sanitizeDockSelection(value: unknown): DockSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: DockSelection = {};
  for (const key of Object.keys(source)) {
    const edge = readEdge(key);
    const view = source[key];
    // A retired edge folds into the foot of its column, and the first entry
    // that names a tab wins: two of them cannot both be the one on screen.
    if (!edge || result[edge]) continue;
    if (typeof view === "string" && PANEL_VIEW_ORDER.includes(view as PanelView)) result[edge] = view as PanelView;
  }
  return result;
}

/**
 * The tab that should take over when one edge is closed.
 *
 * Closing the edge that holds the focused tool window must move the focus to a
 * window that is still on screen; `null` means nothing is left and the caller
 * hides the whole output area.
 */
export function focusAfterHidingDock(
  docks: PanelDocks,
  hidden: readonly DockEdge[],
  closing: DockEdge,
  current: PanelView | null,
  available: readonly PanelView[] = PANEL_VIEW_ORDER,
): PanelView | null {
  if (current && dockOf(docks, current) !== closing) return current;
  for (const edge of occupiedDocks(docks, available)) {
    if (edge === closing || hidden.includes(edge)) continue;
    const view = activeViewForDock(docks, edge, null, available);
    if (view) return view;
  }
  return null;
}

/**
 * Which edge each tool window sits on.
 *
 * IntelliJ lets every tool window be moved on its own, so Problems can sit at
 * the bottom while Terminal is on the right. One dock for all of them forces a
 * choice nobody wants to make: the panel is either wide enough for a terminal
 * or short enough to leave room for the editor.
 */
export function dockOf(docks: PanelDocks, view: PanelView): DockEdge {
  return docks[view] || "bottom";
}

/** Moves one tool window to an edge, leaving every other one where it is. */
export function assignPanelDock(docks: PanelDocks, view: PanelView, edge: DockEdge): PanelDocks {
  if (dockOf(docks, view) === edge) return docks;
  return { ...docks, [view]: edge };
}

/**
 * Moves a whole tool window with all of its tabs.
 *
 * Dragging one tab takes that tab out of the group; dragging the window itself
 * takes the group along, which is what makes "put the output down there" a
 * single gesture instead of one drag per tab.
 */
export function moveDock(
  docks: PanelDocks,
  from: DockEdge,
  to: DockEdge,
  available: readonly PanelView[] = PANEL_VIEW_ORDER,
): PanelDocks {
  if (from === to) return docks;
  const moving = viewsForDock(docks, from, available);
  if (!moving.length) return docks;
  const result = { ...docks };
  for (const view of moving) result[view] = to;
  return result;
}

/** Position and size of the floating tool window. */
export type FloatingBounds = { x: number; y: number; width: number; height: number };

export const DEFAULT_FLOATING_BOUNDS: FloatingBounds = { x: 160, y: 140, width: 680, height: 340 };
const MIN_FLOATING_WIDTH = 320;
const MIN_FLOATING_HEIGHT = 180;

export function sanitizeFloatingBounds(value: unknown, fallback = DEFAULT_FLOATING_BOUNDS): FloatingBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const source = value as Record<string, unknown>;
  const read = (key: keyof FloatingBounds) => {
    const number = Number(source[key]);
    return Number.isFinite(number) ? number : fallback[key];
  };
  return {
    x: read("x"),
    y: read("y"),
    width: Math.max(MIN_FLOATING_WIDTH, read("width")),
    height: Math.max(MIN_FLOATING_HEIGHT, read("height")),
  };
}

/**
 * Keeps a floating window reachable.
 *
 * A window dragged past the edge of the workbench would otherwise be
 * impossible to grab again, so a strip of its title bar always stays inside.
 */
export function clampFloatingBounds(
  bounds: FloatingBounds,
  viewport: { width: number; height: number },
): FloatingBounds {
  const width = Math.max(MIN_FLOATING_WIDTH, Math.min(bounds.width, Math.max(MIN_FLOATING_WIDTH, viewport.width - 16)));
  const height = Math.max(MIN_FLOATING_HEIGHT, Math.min(bounds.height, Math.max(MIN_FLOATING_HEIGHT, viewport.height - 16)));
  const visible = 120;
  return {
    width,
    height,
    x: Math.max(visible - width, Math.min(bounds.x, viewport.width - visible)),
    y: Math.max(0, Math.min(bounds.y, viewport.height - 34)),
  };
}

/**
 * Where a floating window starts.
 *
 * The stored default sat at x = 160, which used to be inside the band that
 * docked a window to the left: the floating window appeared half inside a drop
 * zone and docked itself again at the first small move. It opens in the middle
 * instead, clear of every band, and stays there until it is moved on purpose.
 */
export function centredFloatingBounds(
  viewport: { width: number; height: number },
  bounds: FloatingBounds = DEFAULT_FLOATING_BOUNDS,
): FloatingBounds {
  const zones = dropZones(viewport);
  const room = viewport.width - zones.left - zones.right - 32;
  const width = Math.max(MIN_FLOATING_WIDTH, Math.min(bounds.width, room));
  return clampFloatingBounds({
    ...bounds,
    width,
    x: Math.round((viewport.width - width) / 2),
    y: Math.round(Math.max(24, (zones.bottom - bounds.height) / 2)),
  }, viewport);
}

/** New bounds while the floating window is dragged by its title bar. */
export function movedFloatingBounds(
  bounds: FloatingBounds,
  pointerDeltaX: number,
  pointerDeltaY: number,
  viewport: { width: number; height: number },
): FloatingBounds {
  return clampFloatingBounds({ ...bounds, x: bounds.x + pointerDeltaX, y: bounds.y + pointerDeltaY }, viewport);
}

/** New bounds while the floating window is resized by its corner. */
export function resizedFloatingBounds(
  bounds: FloatingBounds,
  pointerDeltaX: number,
  pointerDeltaY: number,
  viewport: { width: number; height: number },
): FloatingBounds {
  return clampFloatingBounds({
    ...bounds,
    width: Math.max(MIN_FLOATING_WIDTH, bounds.width + pointerDeltaX),
    height: Math.max(MIN_FLOATING_HEIGHT, bounds.height + pointerDeltaY),
  }, viewport);
}

/**
 * Where a drag can end.
 *
 * "window" is not a dock: dropping above the bottom band takes the tool window
 * out of the workbench entirely, into a window of the operating system that
 * can go on another monitor.
 */
export type DropTarget = DockEdge | "window";

/** The area each drop target covers, in pixels of the workbench. */
export type DropZones = {
  /** Width of the left corner, which is the Explorer column. */
  left: number;
  /** Width of the right corner, which is the build tool column. */
  right: number;
  /** Where the bottom band begins. */
  bottom: number;
};

/** A corner never claims less than this share of the width, and never more. */
const MIN_SIDE_BAND = 0.2;
const MAX_SIDE_BAND = 0.34;

/**
 * The bands a drop is measured against — and the ones the preview draws.
 *
 * Both used to be decided separately: the preview highlighted the width the
 * docked window would have, while the drop was accepted only inside a fixed
 * share of the viewport. Aiming at the highlight therefore missed whenever the
 * two disagreed, and the drag fell through to the middle. One function now
 * answers both questions, so what lights up is what accepts the window.
 *
 * The corners are as wide as the columns they belong to, so the highlight
 * falls exactly where the window will land: under the Explorer on one side,
 * under the build tool on the other.
 */
export function dropZones(
  viewport: { width: number; height: number },
  sizes: { left?: number; right?: number } = {},
): DropZones {
  const band = (size: number | undefined) => Math.round(Math.min(
    viewport.width * MAX_SIDE_BAND,
    Math.max(viewport.width * MIN_SIDE_BAND, size || 0),
  ));
  return {
    left: band(sizes.left),
    right: band(sizes.right),
    bottom: Math.round(viewport.height * 0.72),
  };
}

/**
 * The placement a drag ends in.
 *
 * Height decides first: anywhere above the bottom band the tool window leaves
 * the workbench and becomes a window of its own. Inside the band the
 * horizontal position picks one of the three feet, along the same seams the
 * columns already have, so a drop lands where the highlight said it would.
 */
export function dropPlacementAt(
  x: number,
  y: number,
  viewport: { width: number; height: number },
  sizes: { left?: number; right?: number } = {},
): DropTarget {
  const zones = dropZones(viewport, sizes);
  if (y <= zones.bottom) return "window";
  if (x < zones.left) return "bottom-left";
  if (x > viewport.width - zones.right) return "bottom-right";
  return "bottom";
}

/** The tool windows on an edge, in the canonical tab order. */
export function viewsForDock(docks: PanelDocks, edge: DockEdge, available: readonly PanelView[] = PANEL_VIEW_ORDER): PanelView[] {
  return available.filter((view) => dockOf(docks, view) === edge);
}

/**
 * The tab an edge should show.
 *
 * Keeps the current one while it still belongs there — moving *another* tab
 * away must not switch what is on screen — and otherwise falls back to the
 * first in order. Returns null when the edge has nothing left, which is how
 * the caller knows to hide it.
 */
export function activeViewForDock(
  docks: PanelDocks,
  edge: DockEdge,
  current: PanelView | null,
  available: readonly PanelView[] = PANEL_VIEW_ORDER,
): PanelView | null {
  const views = viewsForDock(docks, edge, available);
  if (!views.length) return null;
  if (current && views.includes(current)) return current;
  return views[0];
}

/** Edges that hold at least one tool window, in a stable order. */
export function occupiedDocks(docks: PanelDocks, available: readonly PanelView[] = PANEL_VIEW_ORDER): DockEdge[] {
  return ([...BOTTOM_DOCKS, "floating"] as DockEdge[])
    .filter((edge) => viewsForDock(docks, edge, available).length > 0);
}
