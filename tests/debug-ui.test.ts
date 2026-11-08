import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runDebugCodeLens } from "../src/language/monaco-lsp";
import { resolveJavaGutterAction, toggleJavaLineBreakpoint } from "../src/debug/breakpoint-gutter";
import { findDebugModule } from "../src/debug/debug-launch";
import type { KiwiApi, ModuleInfo } from "../src/types";

describe("debug CodeLens routing", () => {
  it("uses the workbench debug action instead of starting the backend directly", async () => {
    const onDebugFile = vi.fn(async () => undefined);
    const start = vi.fn();
    const listBreakpoints = vi.fn();
    const api = { debug: { start, listBreakpoints } } as unknown as KiwiApi;

    await expect(runDebugCodeLens("C:\\project\\Main.java", onDebugFile, api, () => "C:\\project"))
      .resolves.toBe(true);

    expect(onDebugFile).toHaveBeenCalledOnce();
    expect(onDebugFile).toHaveBeenCalledWith("C:\\project\\Main.java");
    expect(listBreakpoints).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps the provider fallback for isolated Monaco consumers", async () => {
    const breakpoints = [{ type: "line", className: "demo.Main", line: 4 }];
    const start = vi.fn(async () => ({ started: true }));
    const listBreakpoints = vi.fn(async () => breakpoints);
    const api = { debug: { start, listBreakpoints } } as unknown as KiwiApi;

    await expect(runDebugCodeLens("C:\\project\\Main.java", undefined, api, () => "C:\\project"))
      .resolves.toBe(true);

    expect(listBreakpoints).toHaveBeenCalledWith("C:\\project");
    expect(start).toHaveBeenCalledWith({
      root: "C:\\project",
      file: "C:\\project\\Main.java",
      breakpoints,
    });
  });
});

describe("Java breakpoint gutter", () => {
  it("runs a JUnit target on its icon and toggles breakpoints on other Java lines", () => {
    const targets = [{ id: "demo.SampleTest#works", line: 7 }];

    expect(resolveJavaGutterAction("java", 7, targets)).toEqual({
      kind: "test",
      targetId: "demo.SampleTest#works",
    });
    expect(resolveJavaGutterAction("java", 8, targets)).toEqual({ kind: "breakpoint", line: 8 });
    expect(resolveJavaGutterAction("xml", 8, targets)).toBeNull();
  });

  it("adds and removes only the selected line breakpoint", () => {
    const exception = { type: "exception" as const, className: "java.lang.Throwable", line: 0 };
    const added = toggleJavaLineBreakpoint([exception], "demo.Main", 12);

    expect(added).toContainEqual(expect.objectContaining({
      type: "line",
      className: "demo.Main",
      line: 12,
      enabled: true,
    }));
    expect(toggleJavaLineBreakpoint(added, "demo.Main", 12)).toEqual([exception]);
  });

  it("keeps two files with the same class name apart", () => {
    // qualifiedJavaClassName is package plus file name, so two Beta.java
    // without a package produce the same one. Before the path was kept, a
    // breakpoint set in one counted as a breakpoint in the other: the click
    // removed the first file's breakpoint, the workbench still said
    // "Breakpoint", and the gutter stayed empty.
    const first = toggleJavaLineBreakpoint([], "Beta", 3, "C:/a/Beta.java");
    const both = toggleJavaLineBreakpoint(first, "Beta", 3, "C:/b/Beta.java");
    expect(both).toHaveLength(2);
    expect(both.map((entry) => entry.path)).toEqual(["C:/a/Beta.java", "C:/b/Beta.java"]);
  });

  it("removes the breakpoint in the file it was clicked in, and only that one", () => {
    const both = toggleJavaLineBreakpoint(
      toggleJavaLineBreakpoint([], "Beta", 3, "C:/a/Beta.java"),
      "Beta", 3, "C:/b/Beta.java",
    );
    const left = toggleJavaLineBreakpoint(both, "Beta", 3, "C:/a/Beta.java");
    expect(left).toHaveLength(1);
    expect(left[0].path).toBe("C:/b/Beta.java");
  });

  it("still matches a breakpoint stored before a path was kept", () => {
    // Anyone updating Kiwi has these in their saved session, and orphaning
    // them would leave breakpoints that cannot be clicked away.
    const stored = [{ type: "line" as const, className: "demo.Main", line: 7 }];
    expect(toggleJavaLineBreakpoint(stored, "demo.Main", 7, "C:/src/demo/Main.java")).toEqual([]);
  });

  it("keeps a keyboard breakpoint and a gutter breakpoint apart", () => {
    // The two ways of setting one used to disagree about identity: the gutter
    // passed the file, the keyboard did not, and the class-name fallback then
    // made them collide. A click in one file removed the other file's
    // breakpoint, the workbench said "Breakpoint", and the gutter stayed empty.
    const viaKeyboard = toggleJavaLineBreakpoint([], "Beta", 3, "C:/a/Beta.java");
    const viaGutter = toggleJavaLineBreakpoint(viaKeyboard, "Beta", 3, "C:/b/Beta.java");
    expect(viaGutter).toHaveLength(2);
  });

  it("gives every newly set breakpoint a file", () => {
    // The fallback exists only for breakpoints stored before paths were kept.
    // Anything created now must carry one, or the collision comes back through
    // whichever caller forgot.
    const created = toggleJavaLineBreakpoint([], "demo.Main", 7, "C:/src/demo/Main.java");
    expect(created[0].path).toBe("C:/src/demo/Main.java");
  });
});

describe("debug module ownership", () => {
  it("does not force a root-level source into an unrelated conventional source set", () => {
    const rootModule = {
      id: "demo",
      root: "C:\\demo",
      relativePath: ".",
      sourceRoots: ["C:\\demo\\src\\main\\java"],
      testRoots: ["C:\\demo\\src\\test\\java"],
    } as ModuleInfo;

    expect(findDebugModule("C:\\demo\\src\\Main.java", [rootModule])).toBeUndefined();
    expect(findDebugModule("C:\\demo\\src\\main\\java\\demo\\Main.java", [rootModule]))
      .toBe(rootModule);
  });
});

describe("both ways of setting a breakpoint", () => {
  it("pass the file, so the two cannot disagree about identity", () => {
    // Checked in the source because the collision only appears when two
    // different callers are involved, which no unit of either one can show.
    const app = readFileSync(path.join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(app).toContain("toggleBreakpointAtLine(activeFile.name, activeFile.content, cursor.line, activeFile.path)");
    expect(app).toContain("action.line, model.uri.fsPath)");
  });
});
