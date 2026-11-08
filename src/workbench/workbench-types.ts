/**
 * What the workbench is made of.
 *
 * The shapes the workbench passes around — a toast, a layout, the dock a tool
 * window is in — and the two lists that come with them. They describe the
 * workbench rather than doing anything, which is why they read better away
 * from the fourteen thousand lines that use them.
 */
import type { ActivityView, PanelView, RightToolView } from "../types";
import type { DockSelection, PanelDocks } from "./panel-docks";

export type Toast = { id: number; message: string; kind: "success" | "error" | "info" };
export type PaletteMode = "everywhere" | "commands" | "files" | "symbols" | "classes" | "recent" | "run" | "bookmarks" | "structure" | "surround";
export type BackgroundOperation = {
  id: string;
  projectRoot: string;
  kind: "index" | "sync" | "build" | "run" | "test" | "debug" | "repair";
  label: string;
  detail?: string;
  cancellable: boolean;
  startedAt?: number;
  /** Finished steps out of the total, when the work is countable. */
  progress?: { done: number; total: number };
};
export type PerformanceMetric = { kind: "startup" | "project" | "index" | "memory"; value: number; unit: "ms" | "MB"; timestamp: string; projectRoot?: string };
export type WorkbenchDocument = "git-commit" | "git-diff" | "git-merge" | "git-compare" | "git-rebase" | "git-pull-requests" | "refactor-preview" | "java-refactor" | "unused-private" | "web-preview" | "npm-packages" | "database" | "docker" | "git-graph" | "scratchpad";
export type WorkbenchLayout = {
  id: string;
  name: string;
  activity: ActivityView;
  sidebarVisible: boolean;
  panelVisible: boolean;
  panel: PanelView;
  /** Each output tool remembers its own edge in a named layout. */
  panelViewDocks?: PanelDocks;
  /** Which tab each edge was showing when the layout was saved. */
  dockSelection?: DockSelection;
  rightTool: RightToolView | null;
  rightToolDock: "left" | "right" | "bottom";
  focusMode: boolean;
  sidebarWidth: number;
  panelHeight: number;
  panelRightHeight?: number;
  panelLeftHeight?: number;
  rightToolSize: number;
};
/**
 * Tool windows that can be summoned by name.
 *
 * Closing a tool window has to be reversible without hunting for the tab that
 * went away with it, so menu and palette can bring each one back. HTTP is left
 * out on purpose: it appears with the request file that owns it.
 */
export const SUMMONABLE_PANEL_VIEWS: Array<[PanelView, string]> = [
  ["problems", "Problems"],
  ["todos", "TODO"],
  ["build", "Build"],
  ["run", "Run"],
  ["debug", "Debug"],
  ["tests", "Tests"],
  ["terminal", "Terminal"],
  ["tailer", "Tailer"],
];
/** Tool-window layout as sessions, layout profiles and updates store it. */
export type PersistedPanelLayout = {
  panel?: PanelView;
  panelVisible?: boolean;
  panelViewDocks?: PanelDocks;
  dockSelection?: DockSelection;
  hiddenDocks?: unknown;
  panelHeight?: number;
  panelRightHeight?: number;
  panelLeftHeight?: number;
  floatingBounds?: unknown;
};
export const builtInLayouts: WorkbenchLayout[] = [
  { id: "coding", name: "Programmieren", activity: "explorer", sidebarVisible: true, panelVisible: false, panel: "problems", panelViewDocks: {}, rightTool: "build", rightToolDock: "right", focusMode: false, sidebarWidth: 260, panelHeight: 215, panelRightHeight: 330, rightToolSize: 300 },
  { id: "debugging", name: "Debuggen", activity: "run", sidebarVisible: true, panelVisible: true, panel: "debug", panelViewDocks: { debug: "bottom" }, rightTool: null, rightToolDock: "right", focusMode: false, sidebarWidth: 270, panelHeight: 330, panelRightHeight: 390, rightToolSize: 300 },
  { id: "git-review", name: "Git-Review", activity: "source", sidebarVisible: true, panelVisible: false, panel: "problems", panelViewDocks: {}, rightTool: null, rightToolDock: "right", focusMode: false, sidebarWidth: 310, panelHeight: 240, panelRightHeight: 360, rightToolSize: 340 },
];
/** Percent-decodes a path, keeping the original when it is not valid escaping. */
