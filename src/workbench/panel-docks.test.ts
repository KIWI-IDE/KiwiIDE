import { describe, expect, it } from "vitest";
import {
  activeViewForDock,
  BOTTOM_DOCKS,
  assignPanelDock,
  DEFAULT_FLOATING_BOUNDS,
  dockOf,
  centredFloatingBounds,
  dropPlacementAt,
  dropZones,
  focusAfterHidingDock,
  isBottomDock,
  moveDock,
  movedFloatingBounds,
  occupiedDocks,
  resizedFloatingBounds,
  sanitizeFloatingBounds,
  resizedPanelHeight,
  sanitizeDockEdges,
  sanitizeDockSelection,
  sanitizePanelDocks,
  sanitizePanelView,
  viewsForDock,
} from "./panel-docks";

describe("moving tool windows between edges", () => {
  it("puts everything at the bottom until it is moved", () => {
    expect(dockOf({}, "terminal")).toBe("bottom");
    expect(viewsForDock({}, "bottom-left")).toEqual([]);
    expect(viewsForDock({}, "bottom")).toContain("problems");
  });

  it("moves one window without disturbing the others", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    expect(dockOf(docks, "terminal")).toBe("bottom-right");
    expect(dockOf(docks, "problems")).toBe("bottom");
    expect(viewsForDock(docks, "bottom-right")).toEqual(["terminal"]);
  });

  it("returns the same object when nothing would change", () => {
    const docks = { terminal: "bottom-right" as const };
    // Re-assigning to the place it already sits in must not make React think
    // the layout changed.
    expect(assignPanelDock(docks, "terminal", "bottom-right")).toBe(docks);
  });

  it("keeps the tab order regardless of the place", () => {
    const docks = assignPanelDock(assignPanelDock({}, "terminal", "bottom-left"), "problems", "bottom-left");
    // problems comes before terminal in the canonical order, even though
    // terminal was moved there first.
    expect(viewsForDock(docks, "bottom-left")).toEqual(["problems", "terminal"]);
  });

  it("keeps the active tab while it still belongs to the place", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    expect(activeViewForDock(docks, "bottom", "build")).toBe("build");
    expect(activeViewForDock(docks, "bottom-right", "terminal")).toBe("terminal");
  });

  it("falls back to the first tab when the active one moved away", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    // Terminal was showing in the middle and has just been dragged to the
    // right corner; the middle has to show something that is still there.
    expect(activeViewForDock(docks, "bottom", "terminal")).toBe("problems");
  });

  it("reports an empty place as having nothing to show", () => {
    expect(activeViewForDock({}, "bottom-left", null)).toBeNull();
    expect(occupiedDocks({})).toEqual(["bottom"]);
  });

  it("lists the places that hold something, left to right", () => {
    const docks = assignPanelDock(assignPanelDock({}, "terminal", "bottom-right"), "problems", "bottom-left");
    expect(occupiedDocks(docks)).toEqual(["bottom-left", "bottom", "bottom-right"]);
  });

  it("hides a place once its last window leaves", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    const back = assignPanelDock(docks, "terminal", "bottom");
    expect(occupiedDocks(back)).toEqual(["bottom"]);
    expect(activeViewForDock(back, "bottom-right", "terminal")).toBeNull();
  });

  it("only considers windows that are actually available", () => {
    // The HTTP tab only exists once a request file is open; a place holding
    // just that one must not be reported as occupied meanwhile.
    const docks = assignPanelDock({}, "http", "bottom-right");
    expect(occupiedDocks(docks, ["problems", "terminal"])).toEqual(["bottom"]);
    expect(activeViewForDock(docks, "bottom-right", null, ["problems", "terminal"])).toBeNull();
  });

  it("restores only known tabs and valid places from project sessions", () => {
    expect(sanitizePanelDocks({ terminal: "bottom-right", debug: "bottom-left", build: "floating", unknown: "bottom" })).toEqual({
      build: "floating",
      debug: "bottom-left",
      terminal: "bottom-right",
    });
    expect(sanitizePanelDocks({ terminal: "nowhere", debug: 7 })).toEqual({});
  });

  it("moves the retired CodeToGetter output selection to a real output tab", () => {
    expect(sanitizePanelView("collab")).toBe("terminal");
    expect(sanitizePanelView("problems")).toBe("problems");
    expect(sanitizePanelDocks({ collab: "bottom-right", terminal: "bottom" })).toEqual({ terminal: "bottom" });
    expect(sanitizeDockSelection({ "bottom-right": "collab", bottom: "build" })).toEqual({ bottom: "build" });
  });

  it("restores the Tailer selection and dock from a saved layout", () => {
    const saved = JSON.parse(JSON.stringify({
      panel: "tailer", panelViewDocks: { tailer: "bottom-right" }, dockSelection: { "bottom-right": "tailer" },
    }));
    expect(sanitizePanelView(saved.panel)).toBe("tailer");
    expect(sanitizePanelDocks(saved.panelViewDocks)).toEqual({ tailer: "bottom-right" });
    expect(sanitizeDockSelection(saved.dockSelection)).toEqual({ "bottom-right": "tailer" });
    expect(viewsForDock(sanitizePanelDocks(saved.panelViewDocks), "bottom-right")).toEqual(["tailer"]);
  });

  it("lands a window from a retired side dock at the foot of its column", () => {
    // Full-height side docks are gone. A session that named one must not come
    // back empty: the window belongs at the foot of the column it used to have.
    expect(sanitizePanelDocks({ terminal: "right", debug: "left" })).toEqual({
      debug: "bottom-left",
      terminal: "bottom-right",
    });
    expect(sanitizeDockEdges(["left", "right"])).toEqual(["bottom-left", "bottom-right"]);
    expect(sanitizeDockSelection({ left: "problems", right: "terminal" })).toEqual({
      "bottom-left": "problems",
      "bottom-right": "terminal",
    });
  });

  it("uses the supplied profile defaults when legacy sessions have no dock data", () => {
    expect(sanitizePanelDocks(null, { debug: "bottom-right" })).toEqual({ debug: "bottom-right" });
    expect(sanitizePanelDocks({ terminal: "bottom-left" }, { debug: "bottom-right" })).toEqual({
      debug: "bottom-right",
      terminal: "bottom-left",
    });
  });

  it("resizes the bottom window against the drag direction and clamps it", () => {
    // Dragging the separator upwards is a negative delta and makes it taller.
    expect(resizedPanelHeight(215, -40, 900)).toBe(255);
    expect(resizedPanelHeight(215, 40, 900)).toBe(175);
    expect(resizedPanelHeight(215, 400, 900)).toBe(120);
    expect(resizedPanelHeight(215, -900, 900)).toBe(585);
  });

  it("reads back closed places without duplicates or invented names", () => {
    expect(sanitizeDockEdges(["bottom-right", "bottom-right", "nowhere"])).toEqual(["bottom-right"]);
    expect(sanitizeDockEdges(["bottom-right", "bottom-left"])).toEqual(["bottom-left", "bottom-right"]);
    expect(sanitizeDockEdges("bottom-right")).toEqual([]);
  });

  it("keeps one selected tab per place and drops unknown ones", () => {
    expect(sanitizeDockSelection({ bottom: "build", "bottom-right": "terminal" })).toEqual({
      bottom: "build",
      "bottom-right": "terminal",
    });
    expect(sanitizeDockSelection({ floating: "build" })).toEqual({ floating: "build" });
    expect(sanitizeDockSelection({ bottom: "nonsense", nowhere: "build" })).toEqual({});
    expect(sanitizeDockSelection(null)).toEqual({});
  });

  it("moves the focus to a window that is still visible when an edge is closed", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    // Closing the right edge while Terminal was focused: the bottom edge is
    // still open, so its first tab takes over.
    expect(focusAfterHidingDock(docks, [], "bottom-right", "terminal")).toBe("problems");
    // Closing an edge the focused window does not sit on changes nothing.
    expect(focusAfterHidingDock(docks, [], "bottom-right", "build")).toBe("build");
  });

  it("reports that nothing is left when the last visible edge is closed", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    expect(focusAfterHidingDock(docks, ["bottom"], "bottom-right", "terminal")).toBeNull();
  });
});

describe("moving a tool window as a whole", () => {
  it("takes every tab of that window along", () => {
    const docks = assignPanelDock({}, "terminal", "bottom-right");
    const moved = moveDock(docks, "bottom", "floating");
    // Terminal stays on the right; the whole bottom group floats.
    expect(dockOf(moved, "terminal")).toBe("bottom-right");
    expect(viewsForDock(moved, "floating")).toEqual(["problems", "todos", "build", "run", "debug", "tests", "tailer", "http", "output"]);
    expect(viewsForDock(moved, "bottom")).toEqual([]);
  });

  it("leaves the arrangement alone when there is nothing to move", () => {
    const docks = { terminal: "bottom-right" as const };
    expect(moveDock(docks, "floating", "bottom")).toBe(docks);
    expect(moveDock(docks, "bottom-right", "bottom-right")).toBe(docks);
  });

  it("only moves the tabs that exist right now", () => {
    const docks = assignPanelDock({}, "http", "bottom-left");
    expect(moveDock(docks, "bottom-left", "bottom", ["problems", "terminal"])).toBe(docks);
  });
});

describe("the floating tool window", () => {
  const viewport = { width: 1400, height: 900 };

  it("keeps a dragged window reachable", () => {
    const bounds = { x: 200, y: 200, width: 600, height: 300 };
    expect(movedFloatingBounds(bounds, 60, 40, viewport)).toMatchObject({ x: 260, y: 240 });
    // Dragged far past the right edge, a grabbable strip stays on screen.
    expect(movedFloatingBounds(bounds, 4_000, 4_000, viewport)).toMatchObject({
      x: viewport.width - 120,
      y: viewport.height - 34,
    });
    // And past the left edge, the title bar cannot vanish either.
    expect(movedFloatingBounds(bounds, -4_000, -4_000, viewport)).toMatchObject({ x: 120 - 600, y: 0 });
  });

  it("resizes from its corner without collapsing", () => {
    const bounds = { x: 100, y: 100, width: 600, height: 300 };
    expect(resizedFloatingBounds(bounds, 80, 50, viewport)).toMatchObject({ width: 680, height: 350 });
    expect(resizedFloatingBounds(bounds, -5_000, -5_000, viewport)).toMatchObject({ width: 320, height: 180 });
    // A window can never be larger than the workbench that hosts it.
    expect(resizedFloatingBounds(bounds, 5_000, 5_000, viewport)).toMatchObject({
      width: viewport.width - 16,
      height: viewport.height - 16,
    });
  });

  it("restores stored bounds and repairs damaged ones", () => {
    expect(sanitizeFloatingBounds({ x: 40, y: 60, width: 700, height: 400 }))
      .toEqual({ x: 40, y: 60, width: 700, height: 400 });
    expect(sanitizeFloatingBounds({ x: "nonsense", y: 60, width: 10, height: 400 }))
      .toEqual({ x: DEFAULT_FLOATING_BOUNDS.x, y: 60, width: 320, height: 400 });
    expect(sanitizeFloatingBounds(null)).toEqual(DEFAULT_FLOATING_BOUNDS);
  });

  it("docks along the bottom and sends everything above it out of the workbench", () => {
    // Height decides first: above the bottom band there is no docked place
    // left, so the window goes to one of its own and can reach a second
    // monitor. Dragging sideways up there no longer docks anything.
    expect(dropPlacementAt(700, 400, viewport)).toBe("window");
    expect(dropPlacementAt(80, 400, viewport)).toBe("window");
    expect(dropPlacementAt(1_350, 400, viewport)).toBe("window");
    expect(dropPlacementAt(700, 860, viewport)).toBe("bottom");
    expect(dropPlacementAt(80, 860, viewport)).toBe("bottom-left");
    expect(dropPlacementAt(1_350, 860, viewport)).toBe("bottom-right");
  });

  it("accepts a drop anywhere the preview lights up", () => {
    // The preview showed how wide the docked window would be while the drop was
    // accepted only inside a fixed share of the viewport. Releasing just inside
    // the highlight therefore fell through to the middle, which is what made
    // docking left and right look broken.
    const sizes = { left: 380, right: 380 };
    expect(dropZones(viewport, sizes)).toMatchObject({ left: 380, right: 380 });
    expect(dropPlacementAt(370, 860, viewport, sizes)).toBe("bottom-left");
    expect(dropPlacementAt(viewport.width - 370, 860, viewport, sizes)).toBe("bottom-right");
    // A narrow column still leaves a corner that can be aimed at.
    expect(dropPlacementAt(170, 860, viewport, { left: 180 })).toBe("bottom-left");
    // And a very wide one must not swallow the middle.
    expect(dropZones(viewport, { left: 1_200 }).left).toBe(476);
    expect(dropPlacementAt(700, 860, viewport, { left: 1_200 })).toBe("bottom");
  });

  it("opens the floating window clear of the bands that would dock it", () => {
    // The stored default sits inside the band that docks to the left, so the
    // window appeared half inside a drop zone and docked itself again at the
    // first small move of its handle.
    const zones = dropZones(viewport);
    expect(DEFAULT_FLOATING_BOUNDS.x).toBeLessThan(zones.left);
    const bounds = centredFloatingBounds(viewport);
    expect(bounds.x).toBeGreaterThan(zones.left);
    expect(bounds.x + bounds.width).toBeLessThan(viewport.width - zones.right);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(zones.bottom);
    expect(dropPlacementAt(bounds.x + 10, bounds.y + 10, viewport)).toBe("window");
    // A narrow workbench still yields a window that can be grabbed.
    const narrow = centredFloatingBounds({ width: 700, height: 500 });
    expect(narrow.width).toBeGreaterThanOrEqual(320);
    expect(narrow.x).toBeGreaterThanOrEqual(0);
  });

  it("lines the corners up with the columns they sit under", () => {
    // The corner is as wide as the column, so the highlight and the landing
    // place are the same strip of screen.
    expect(dropPlacementAt(80, 860, viewport)).toBe("bottom-left");
    expect(dropPlacementAt(1_350, 860, viewport)).toBe("bottom-right");
    expect(dropPlacementAt(300, 860, viewport, { left: 320 })).toBe("bottom-left");
    expect(dropPlacementAt(340, 860, viewport, { left: 320 })).toBe("bottom");
  });

  it("lists the bottom row from left to right", () => {
    const docks = { terminal: "bottom-left" as const, debug: "bottom-right" as const };
    expect(occupiedDocks(docks)).toEqual(["bottom-left", "bottom", "bottom-right"]);
    expect(BOTTOM_DOCKS.every(isBottomDock)).toBe(true);
    expect(isBottomDock("floating")).toBe(false);
  });
});
