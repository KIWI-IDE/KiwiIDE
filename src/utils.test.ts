import { describe, expect, it } from "vitest";
import {
  ancestorDirectories,
  buildQuickFixForDiagnostic,
  compactPackageNodes,
  explainJavaDiagnostic,
  explorerLabel,
  jdkChoiceLabel,
  jdkSourceLabel,
  translucent,
  findTaskComments,
  flattenFiles,
  fuzzyScore,
  groupBuildOutputByModule,
  implementJavaInterface,
  isPathWithin,
  isTreeNodeExpanded,
  nextUiScale,
  trackSteps,
  treeExpansionPaths,
  withLoadedChildren,
  languageFromPath,
  parseBuildReport,
  parseJavaDiagnostics,
  remapExpandedExplorerPaths,
  removeTreeNode,
  treeExpansionKey,
} from "./utils";
import type { FileNode } from "./types";

describe("IDE utilities", () => {
  it("groups Maven, Gradle and plain Java build output by module", () => {
    const groups = groupBuildOutputByModule([
      "[INFO] Building root 1.0",
      "[INFO] root output",
      "[INFO] Building api 1.0",
      "[ERROR] api failed",
      "> Task :driver:compileJava",
      "driver output",
    ].join("\n"));
    expect(groups.map((group) => group.module)).toEqual(["root", "api", "driver"]);
    expect(groups.find((group) => group.module === "api")?.errors).toBe(1);
  });

  it("maps common project files to editor languages", () => {
    expect(languageFromPath("Main.java")).toBe("java");
    expect(languageFromPath("build.gradle")).toBe("groovy");
    expect(languageFromPath("pom.xml")).toBe("xml");
  });

  it("flattens nested workspace trees", () => {
    expect(flattenFiles([
      {
        id: "src",
        name: "src",
        path: "src",
        type: "directory",
        children: [{ id: "Main.java", name: "Main.java", path: "src/Main.java", type: "file" }],
      },
    ])).toHaveLength(1);
  });

  it("keeps compact lazy package nodes expanded when their visible path grows", () => {
    const de = {
      id: "de",
      name: "de",
      path: "C:\\project\\src\\main\\java\\de",
      type: "directory" as const,
      childrenLoaded: true,
      children: [{
        id: "example",
        name: "example",
        path: "C:\\project\\src\\main\\java\\de\\example",
        type: "directory" as const,
        childrenLoaded: false,
        children: [],
      }],
    };
    const compact = compactPackageNodes([de])[0];
    expect(compact.name).toBe("de.example");
    expect(compact.path).toBe("C:\\project\\src\\main\\java\\de\\example");
    expect(treeExpansionKey(compact)).toBe(de.path);
    expect(compact.treePaths).toEqual([de.path, "C:\\project\\src\\main\\java\\de\\example"]);
    expect(isTreeNodeExpanded(compact, new Set([de.path]))).toBe(true);
  });

  it("removes deleted Explorer nodes and descendants without matching similar names", () => {
    const tree = [{
      id: "src",
      name: "src",
      path: "C:\\project\\src",
      type: "directory" as const,
      children: [
        { id: "old", name: "old", path: "C:\\project\\src\\old", type: "directory" as const, children: [
          { id: "main", name: "Main.java", path: "C:\\project\\src\\old\\Main.java", type: "file" as const },
        ] },
        { id: "older", name: "older", path: "C:\\project\\src\\older", type: "directory" as const, children: [] },
      ],
    }];
    const next = removeTreeNode(tree, "C:\\project\\src\\old");
    expect(next[0].children?.map((node) => node.name)).toEqual(["older"]);
    expect(isPathWithin("C:\\project\\src\\old\\Main.java", "C:\\project\\src\\old")).toBe(true);
    expect(isPathWithin("C:\\project\\src\\older", "C:\\project\\src\\old")).toBe(false);
  });

  it("preserves and remaps expanded Explorer paths across drag-and-drop", () => {
    const source = "C:\\project\\src\\main\\java\\dev\\old";
    const target = "C:\\project\\src\\main\\java\\dev\\moved\\old";
    const targetDirectory = "C:\\project\\src\\main\\java\\dev\\moved";
    const expanded = new Set([
      "C:\\project\\src",
      source,
      `${source}\\internal`,
    ]);
    const next = remapExpandedExplorerPaths(expanded, [{
      source,
      target,
      move: true,
    }], targetDirectory);
    expect(next).toEqual(new Set([
      "C:\\project\\src",
      target,
      `${target}\\internal`,
      targetDirectory,
    ]));
  });

  it("ranks matching file names", () => {
    expect(fuzzyScore("MainController.java", "main")).toBeGreaterThan(fuzzyScore("Domain.java", "main"));
    expect(fuzzyScore("README.md", "xyz")).toBe(-1);
  });

  it("parses javac diagnostics on Windows paths", () => {
    const result = parseJavaDiagnostics("C:\\work\\Main.java:12: error: ';' expected");
    expect(result[0]).toMatchObject({ line: 12, severity: "error", message: "';' expected" });
  });

  it("parses localized German javac diagnostics", () => {
    const result = parseJavaDiagnostics([
      "C:\\work\\Worker.java:3: Warnung: Veraltete API",
      "C:\\work\\Broken.java:8: Fehler: Inkompatible Typen: Worker kann nicht in Marker konvertiert werden",
    ].join("\n"));
    expect(result).toEqual([
      {
        path: "C:\\work\\Worker.java",
        line: 3,
        column: 1,
        severity: "warning",
        message: "Veraltete API",
      },
      {
        path: "C:\\work\\Broken.java",
        line: 8,
        column: 1,
        severity: "error",
        message: "Inkompatible Typen: Worker kann nicht in Marker konvertiert werden",
      },
    ]);
  });

  it("parses clickable Maven and ANSI Gradle diagnostics", () => {
    const result = parseJavaDiagnostics([
      "[ERROR] /D:/work/Main.java:[7,14] cannot find symbol",
      "[ERROR] /D:/work/Main.java:[7,14] cannot find symbol",
      "\u001b[31mC:\\work\\Other.java:9:3: warning: unchecked conversion\u001b[0m",
    ].join("\n"));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ path: "D:/work/Main.java", line: 7, column: 14 });
    expect(result[1]).toMatchObject({ path: "C:\\work\\Other.java", line: 9, column: 3, severity: "warning" });
  });

  it("keeps Maven symbol details and explains a missing generated method", () => {
    const result = parseJavaDiagnostics([
      "[ERROR] /D:/work/CorePlayer.java:[16,46] Symbol nicht gefunden",
      "  Symbol: Methode getName()",
      "  Ort: Variable t von Typ de.example.CorePlayer",
      "[INFO] 1 error",
    ].join("\n"));
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("Methode getName()");
    expect(explainJavaDiagnostic(result[0])).toContain("de.example.CorePlayer");
    expect(explainJavaDiagnostic(result[0])).toContain("Lombok");
  });

  it("turns the common compiler messages into an instruction", () => {
    const explain = (message: string) =>
      explainJavaDiagnostic({ path: "A.java", line: 1, column: 1, severity: "error", message });

    expect(explain("';' expected")).toContain("Semikolon");
    expect(explain("reached end of file while parsing")).toContain("geschweifte Klammer");
    expect(explain("incompatible types: java.lang.String cannot be converted to int"))
      .toBe("String passt nicht zu int. Konvertiere den Wert oder passe den Typ an.");
    expect(explain("unreported exception java.io.IOException; must be caught or declared to be thrown"))
      .toContain("IOException");
    expect(explain("package org.example.util does not exist")).toContain("org.example.util");
    expect(explain("variable count might not have been initialized")).toContain("bevor");
    expect(explain("method run in class A cannot be applied to given types")).toContain("Argumente");
    expect(explain("value has private access in Other")).toContain("private");
    expect(explain("not a statement")).toContain("ternärer Ausdruck");
    expect(explain("Syntax error on token \"?\", delete this token")).toContain("Ternärer Operator");
  });

  it("does not offer to implement a primitive", () => {
    const primitive = { path: "A.java", line: 1, column: 1, severity: "error" as const,
      message: "incompatible types: java.lang.String cannot be converted to int" };
    expect(buildQuickFixForDiagnostic(primitive)).toBeNull();

    // A real interface mismatch still gets its quick fix.
    const real = { ...primitive, message: "incompatible types: de.demo.Worker cannot be converted to de.demo.Marker" };
    expect(buildQuickFixForDiagnostic(real)).toMatchObject({ kind: "implement-interface", targetType: "de.demo.Marker" });
  });

  it("passes an unknown message through unchanged", () => {
    const message = "irgendein unbekannter Compilerfehler";
    expect(explainJavaDiagnostic({ path: "A.java", line: 1, column: 1, severity: "error", message })).toBe(message);
  });

  it("summarizes Maven failures without repeating compiler diagnostics", () => {
    const report = parseBuildReport([
      "> mvn.cmd install",
      "[INFO] Scanning for projects...",
      "[ERROR] /D:/work/Bootstrap.java:[12,50] Inkompatible Typen: de.demo.EventBuss kann nicht in org.bukkit.event.Listener konvertiert werden",
      "[ERROR] /D:/work/Bootstrap.java:[12,50] Inkompatible Typen: de.demo.EventBuss kann nicht in org.bukkit.event.Listener konvertiert werden",
      "[INFO] BUILD FAILURE",
      "[INFO] Total time: 1.2 s",
    ].join("\n"), { exitCode: 1 });
    expect(report).toMatchObject({
      status: "failed",
      tool: "Maven",
      title: "1 Compilerfehler",
      duration: "1.2 s",
    });
    expect(report.diagnostics).toHaveLength(1);
    expect(report.detail).toContain("EventBuss");
  });

  it("offers and applies a missing-interface build fix", () => {
    const diagnostic = {
      path: "D:/work/Bootstrap.java",
      line: 12,
      column: 50,
      severity: "error" as const,
      message: "Inkompatible Typen: de.demo.EventBuss kann nicht in org.bukkit.event.Listener konvertiert werden",
    };
    expect(buildQuickFixForDiagnostic(diagnostic)).toMatchObject({
      sourceType: "de.demo.EventBuss",
      targetType: "org.bukkit.event.Listener",
      label: "Listener implementieren",
    });
    expect(implementJavaInterface(
      "package de.demo;\n\npublic class EventBuss {\n}\n",
      "de.demo.EventBuss",
      "org.bukkit.event.Listener",
    )).toBe("package de.demo;\n\nimport org.bukkit.event.Listener;\n\npublic class EventBuss implements Listener {\n}\n");
  });
});

describe("task comment detection", () => {
  it("finds TODO and FIXME in line and block comments", () => {
    const tasks = findTaskComments([
      "public class Main {",
      "    // TODO: rename this class",
      "    /* FIXME handle the null case */",
      "    void run() {}",
      "}",
    ].join("\n"));
    // column points at the marker word, not at the start of the comment.
    expect(tasks).toEqual([
      { line: 2, column: 8, kind: "TODO", text: "rename this class" },
      { line: 3, column: 8, kind: "FIXME", text: "handle the null case" },
    ]);
  });

  it("spans a multi-line block comment", () => {
    const tasks = findTaskComments([
      "/*",
      " * TODO: split this method",
      " */",
      "int value = 1;",
    ].join("\n"));
    expect(tasks).toEqual([{ line: 2, column: 4, kind: "TODO", text: "split this method" }]);
  });

  it("ignores markers in code and string literals", () => {
    const tasks = findTaskComments([
      'String note = "TODO: not a task";',
      "int todoList = 3;",
      "todoList++;",
    ].join("\n"));
    expect(tasks).toEqual([]);
  });

  it("does not treat a substring as a marker", () => {
    expect(findTaskComments("// mastodon migration")).toEqual([]);
    expect(findTaskComments("// todos are tracked elsewhere")).toEqual([]);
  });

  it("accepts a marker without a colon and any casing", () => {
    expect(findTaskComments("// todo drop the cache")).toEqual([
      { line: 1, column: 4, kind: "TODO", text: "drop the cache" },
    ]);
    expect(findTaskComments("// Fixme: off by one")[0].kind).toBe("FIXME");
  });

  it("recognises the other markers the TODO tool window groups", () => {
    expect(findTaskComments("// HACK: works by accident")[0].kind).toBe("HACK");
    expect(findTaskComments("// XXX revisit")[0].kind).toBe("XXX");
    expect(findTaskComments("// BUG: off by one")[0].kind).toBe("BUG");
    expect(findTaskComments("// NOTE: intentional")[0].kind).toBe("NOTE");
  });
});

describe("project-wide task scanning", () => {
  // The tool window scans on disk in the main process while the editor badge
  // scans the open buffer here. Two implementations of the same rules drift
  // unless something holds them against one fixture.
  const { findTaskComments: scanInMain } = require("../electron/services/task-comment-scanner.cjs");

  const fixture = [
    "package de.demo;",
    "",
    "/**",
    " * TODO: document this class",
    " */",
    "public class Demo {",
    '    private String note = "FIXME: not a task";',
    "    // HACK works by accident",
    "    /* XXX: revisit */",
    "    int todoList = 3;",
    "    void run() {} // BUG off by one",
    "}",
  ].join("\n");

  it("agrees with the editor scanner on the same source", () => {
    expect(scanInMain(fixture)).toEqual(findTaskComments(fixture));
  });

  it("reports the markers that are really in comments", () => {
    expect(scanInMain(fixture)).toEqual([
      { line: 4, column: 4, kind: "TODO", text: "document this class" },
      { line: 8, column: 8, kind: "HACK", text: "works by accident" },
      { line: 9, column: 8, kind: "XXX", text: "revisit" },
      { line: 11, column: 22, kind: "BUG", text: "off by one" },
    ]);
  });
});

describe("keeping a package chain visible", () => {
  const ROOT = "C:\\ws\\src\\main\\java";

  it("lists every directory from the root down to the target", () => {
    expect(ancestorDirectories(ROOT, `${ROOT}\\de\\app\\spigot`)).toEqual([
      ROOT,
      `${ROOT}\\de`,
      `${ROOT}\\de\\app`,
      `${ROOT}\\de\\app\\spigot`,
    ]);
  });

  it("keeps a split compact node expanded after a class is added", () => {
    const dir = (path: string, children: FileNode[] = []): FileNode =>
      ({ id: path, name: path.split("/").pop()!, path, type: "directory", children, childrenLoaded: true });
    const file = (path: string): FileNode =>
      ({ id: path, name: path.split("/").pop()!, path, type: "file" });
    const root = "C:/ws/src/main/java";

    // Adding a class next to a sub-package shortens the compact chain, so
    // `spigot` becomes a node of its own.
    const [node] = compactPackageNodes([
      dir(`${root}/de`, [dir(`${root}/de/app`, [
        dir(`${root}/de/app/spigot`, [file(`${root}/de/app/spigot/A.java`)]),
        file(`${root}/de/app/Neu.java`),
      ])]),
    ]);
    expect(node.name).toBe("de.app");
    const split = node.children!.find((child) => child.type === "directory")!;

    const withoutFix = new Set([`${root}/de`]);
    expect(isTreeNodeExpanded(split, withoutFix)).toBe(false);

    const withFix = new Set(ancestorDirectories(root, `${root}/de/app/spigot`));
    expect(isTreeNodeExpanded(split, withFix)).toBe(true);
  });

  it("ignores targets outside the root", () => {
    expect(ancestorDirectories(ROOT, "D:\\other\\Main.java")).toEqual([]);
    expect(ancestorDirectories("", `${ROOT}\\de`)).toEqual([]);
  });

  it("preserves absolute POSIX ancestors and distinguishes their case", () => {
    expect(ancestorDirectories("/home/kiwi", "/home/kiwi/src/app")).toEqual([
      "/home/kiwi", "/home/kiwi/src", "/home/kiwi/src/app",
    ]);
    expect(isPathWithin("/home/Kiwi/src", "/home/kiwi")).toBe(false);
  });
});

describe("Explorer labels", () => {
  const file = (name: string) => ({ id: name, name, path: `C:\ws\${name}`, type: "file" as const });

  it("hides only the configured source extensions", () => {
    expect(explorerLabel(file("Main.java"), true)).toBe("Main");
    expect(explorerLabel(file("Bootstrap.KT"), true)).toBe("Bootstrap");
    expect(explorerLabel(file("index.html"), true)).toBe("index");
    expect(explorerLabel(file("styles.css"), true)).toBe("styles");
    expect(explorerLabel(file("pom.xml"), true)).toBe("pom.xml");
    expect(explorerLabel(file("README.md"), true)).toBe("README.md");
  });

  it("leaves every name untouched while the option is off", () => {
    expect(explorerLabel(file("Main.java"), false)).toBe("Main.java");
  });

  it("keeps a build file whose name would turn into another one", () => {
    // Dropping ".kts" left "build.gradle" — the name of a different, equally
    // real Gradle file. A project carrying both showed the same row twice and
    // there was no way to tell which one an edit went into.
    expect(explorerLabel(file("build.gradle.kts"), true)).toBe("build.gradle.kts");
    expect(explorerLabel(file("settings.gradle.kts"), true)).toBe("settings.gradle.kts");
  });

  it("still hides the extension where nothing is left to confuse it with", () => {
    expect(explorerLabel(file("Build.kts"), true)).toBe("Build");
    expect(explorerLabel(file("Main.java"), true)).toBe("Main");
  });

  it("keeps directories and dotfiles intact", () => {
    expect(explorerLabel({ id: "d", name: "java", path: "C:\ws\java", type: "directory" }, true)).toBe("java");
    expect(explorerLabel(file(".java"), true)).toBe(".java");
  });

  it("prefers an explicit display name", () => {
    expect(explorerLabel({ ...file("target"), type: "directory", displayName: "build" }, true)).toBe("build");
  });
});

describe("Explorer expansion across package regrouping", () => {
  // Paths are joined rather than written as template literals: there a "\d" or
  // "\a" is read as an escape sequence and the backslash silently disappears.
  const join = (...parts: string[]) => ["C:", "project", "src", "main", "java", ...parts].join("\\");
  const directory = (path: string, children: any[] = [], childrenLoaded = true) => ({
    id: path, name: path.split("\\").pop()!, path, type: "directory" as const, childrenLoaded, children,
  });

  it("keeps a branch open when creating a package splits the compacted chain", () => {
    // de -> app -> spigot collapses into a single row keyed by "de".
    const before = compactPackageNodes([
      directory(join("de"), [directory(join("de", "app"), [directory(join("de", "app", "spigot"))])]),
    ])[0];
    expect(before.name).toBe("de.app.spigot");

    // Creating "de.tools" gives "de" a second child, so the chain breaks apart
    // and "app.spigot" becomes its own row under a different key.
    const [de] = compactPackageNodes([
      directory(join("de"), [
        directory(join("de", "app"), [directory(join("de", "app", "spigot"))]),
        directory(join("de", "tools")),
      ]),
    ]);
    expect(de.name).toBe("de");
    const [appSpigot] = de.children!;
    expect(appSpigot.name).toBe("app.spigot");
    expect(treeExpansionKey(appSpigot)).not.toBe(treeExpansionKey(before));

    // Remembering only the row's key — what opening used to do — loses the
    // branch the moment it regroups. This is the reported collapse.
    const keyOnly = new Set([treeExpansionKey(before)]);
    expect(isTreeNodeExpanded(appSpigot, keyOnly)).toBe(false);

    // Remembering every physical directory of the row survives the regrouping.
    const allIdentities = new Set(treeExpansionPaths(before));
    expect(isTreeNodeExpanded(de, allIdentities)).toBe(true);
    expect(isTreeNodeExpanded(appSpigot, allIdentities)).toBe(true);
  });

  it("keeps a branch open when packages merge back into one row", () => {
    // The opposite direction: "app.spigot" was its own row, so only the middle
    // directory was recorded. Merging makes "de" the key and the deepest
    // package the path, so neither end of the new row matches what was stored.
    const expanded = new Set([join("de", "app")]);
    const merged = compactPackageNodes([
      directory(join("de"), [directory(join("de", "app"), [directory(join("de", "app", "spigot"))])]),
    ])[0];
    expect(merged.name).toBe("de.app.spigot");
    expect(treeExpansionKey(merged)).toBe(join("de"));
    expect(merged.path).toBe(join("de", "app", "spigot"));
    expect(isTreeNodeExpanded(merged, expanded)).toBe(true);
  });

  it("collapsing still removes every identity of the row", () => {
    const compact = compactPackageNodes([
      directory(join("de"), [directory(join("de", "app"))]),
    ])[0];
    const expanded = new Set(treeExpansionPaths(compact));
    for (const identity of treeExpansionPaths(compact)) expanded.delete(identity);
    expect(isTreeNodeExpanded(compact, expanded)).toBe(false);
    expect(expanded.size).toBe(0);
  });

  it("reports every physical directory of a chain as an expansion identity", () => {
    const compact = compactPackageNodes([
      directory(join("de"), [directory(join("de", "app"), [directory(join("de", "app", "spigot"))])]),
    ])[0];
    expect([...treeExpansionPaths(compact)].sort()).toEqual([
      join("de"),
      join("de", "app"),
      join("de", "app", "spigot"),
    ]);
  });
});

describe("Explorer refresh keeps open branches open", () => {
  const join = (...parts: string[]) => ["C:", "project", "src", "main", "java", ...parts].join("\\");
  const file = (path: string) => ({ id: path, name: path.split("\\").pop()!, path, type: "file" as const });
  const directory = (path: string, children: any[] = [], childrenLoaded = true) => ({
    id: path, name: path.split("\\").pop()!, path, type: "directory" as const, childrenLoaded, children,
  });

  it("does not close sub-packages when a directory is listed again", () => {
    // de is open, and commands inside it is open too with a class loaded.
    const tree = [directory(join("de"), [
      directory(join("de", "commands"), [file(join("de", "commands", "Ping.java"))]),
      file(join("de", "Plugin.java")),
    ])];
    const expanded = new Set([join("de"), join("de", "commands")]);

    // Saving a file makes the watcher list "de" again. A listing has no loaded
    // grandchildren — commands comes back empty and unloaded.
    const listing = [
      directory(join("de", "commands"), [], false),
      file(join("de", "Plugin.java")),
      file(join("de", "Extra.java")),
    ];
    const [de] = withLoadedChildren(tree, join("de"), listing, expanded);

    expect(de.children!.map((child) => child.name).sort()).toEqual(["Extra.java", "Plugin.java", "commands"]);
    const commands = de.children!.find((child) => child.name === "commands")!;
    expect(commands.childrenLoaded).toBe(true);
    expect(commands.children!.map((child) => child.name)).toEqual(["Ping.java"]);
  });

  it("drops children of a directory that is no longer open", () => {
    const tree = [directory(join("de"), [
      directory(join("de", "commands"), [file(join("de", "commands", "Ping.java"))]),
    ])];
    // Nothing below "de" is expanded, so there is no state worth carrying over.
    const [de] = withLoadedChildren(tree, join("de"), [directory(join("de", "commands"), [], false)], new Set([join("de")]));
    expect(de.children![0].childrenLoaded).toBeFalsy();
  });

  it("keeps a deleted directory out of the tree", () => {
    const tree = [directory(join("de"), [
      directory(join("de", "commands"), [file(join("de", "commands", "Ping.java"))]),
      directory(join("de", "events"), [file(join("de", "events", "Join.java"))]),
    ])];
    const expanded = new Set([join("de"), join("de", "commands"), join("de", "events")]);
    // "events" was deleted on disk, so the listing no longer contains it.
    const [de] = withLoadedChildren(tree, join("de"), [directory(join("de", "commands"), [], false)], expanded);
    expect(de.children!.map((child) => child.name)).toEqual(["commands"]);
  });
});

describe("counting the steps of a synchronisation", () => {
  it("reports each step as it finishes, in completion order", async () => {
    const seen: Array<[number, string]> = [];
    const track = trackSteps(3, (done, label) => seen.push([done, label]));
    const slow = track("Module", new Promise((resolve) => setTimeout(() => resolve("m"), 20)));
    const quick = track("Aufgaben", Promise.resolve("t"));
    await Promise.all([slow, quick]);
    expect(seen).toEqual([[1, "Aufgaben"], [2, "Module"]]);
  });

  it("counts a failed step too, so the display does not stall", async () => {
    const seen: number[] = [];
    const track = trackSteps(2, (done) => seen.push(done));
    await expect(track("Audit", Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    await track("Modell", Promise.resolve(1));
    expect(seen).toEqual([1, 2]);
  });

  it("never counts past the total", async () => {
    const seen: number[] = [];
    const track = trackSteps(1, (done) => seen.push(done));
    await track("a", Promise.resolve(1));
    await track("b", Promise.resolve(2));
    expect(seen).toEqual([1, 1]);
  });
});

describe("zooming the interface", () => {
  it("steps up and down through the offered scales", () => {
    expect(nextUiScale(1, "in")).toBe(1.1);
    expect(nextUiScale(1, "out")).toBe(0.9);
    expect(nextUiScale(1.25, "in")).toBe(1.5);
  });

  it("stops at both ends instead of wrapping around", () => {
    expect(nextUiScale(1.5, "in")).toBe(1.5);
    expect(nextUiScale(0.85, "out")).toBe(0.85);
  });

  it("always finds its way back to 100 percent", () => {
    // The reported bug: shrinking worked and enlarging did not, so the window
    // stayed small. Every step out has a step back in.
    let scale = 1;
    for (let step = 0; step < 5; step += 1) scale = nextUiScale(scale, "out");
    expect(scale).toBe(0.85);
    for (let step = 0; step < 5; step += 1) scale = nextUiScale(scale, "in");
    expect(scale).toBe(1.5);
    expect(nextUiScale(scale, "reset")).toBe(1);
  });

  it("starts from 100 percent when the stored value is not a known step", () => {
    expect(nextUiScale(1.37, "in")).toBe(1.1);
    expect(nextUiScale(0, "out")).toBe(0.9);
  });
});

describe("thinning a colour so a wallpaper shows through", () => {
  it("adds an alpha channel to an opaque colour", () => {
    // The current line was left opaque while the editor behind it was made
    // transparent, so it drew a solid band right across the picture.
    expect(translucent("#0e1a20")).toBe("#0e1a2073");
  });

  it("thins a colour that already carries one", () => {
    expect(translucent("#0e1a2080", 0.5)).toBe("#0e1a2040");
  });

  it("expands the short form before thinning it", () => {
    expect(translucent("#abc", 1)).toBe("#aabbccff");
  });

  it("leaves a fully transparent colour transparent", () => {
    // Thinning nothing produces nothing; the editor surface itself is cleared
    // this way and must stay cleared.
    expect(translucent("#00000000")).toBe("#00000000");
  });

  it("hands back anything that is not a hex colour untouched", () => {
    expect(translucent("transparent")).toBe("transparent");
    expect(translucent("")).toBe("");
  });

  it("keeps the result inside the range Monaco accepts", () => {
    for (const alpha of [0, 0.5, 1, 2, -1]) {
      expect(translucent("#ffffff", alpha)).toMatch(/^#ffffff[0-9a-f]{2}$/);
    }
  });
});

describe("telling six installed JDKs apart", () => {
  it("names the distribution, which is what people know a JDK by", () => {
    expect(jdkSourceLabel("C:/Program Files/Amazon Corretto/jdk25.0.4_7")).toBe("Amazon Corretto");
    expect(jdkSourceLabel("C:/Program Files/Eclipse Adoptium/jdk-21")).toBe("Eclipse Temurin");
    expect(jdkSourceLabel("C:/Program Files/Zulu/zulu-21")).toBe("Azul Zulu");
    expect(jdkSourceLabel("C:/Program Files/Microsoft/jdk-17")).toBe("Microsoft Build of OpenJDK");
  });

  it("says when Kiwi fetched it itself", () => {
    // "The one I downloaded here" is the entry somebody looks for right after
    // downloading it.
    expect(jdkSourceLabel("C:/Users/x/AppData/Roaming/kiwi-ide/jdks/temurin-21/jdk-21"))
      .toBe("von Kiwi geladen");
  });

  it("reads a Windows path as well as a posix one", () => {
    expect(jdkSourceLabel("C:\Program Files\Zulu\zulu-17")).toBe("Azul Zulu");
  });

  it("says nothing rather than guessing", () => {
    expect(jdkSourceLabel("D:/irgendwo/jdk")).toBe("");
    expect(jdkSourceLabel("")).toBe("");
  });

  it("puts version, source and location in one line", () => {
    expect(jdkChoiceLabel({ major: 21, path: "C:/Program Files/Zulu/zulu-21" }))
      .toBe("Java 21 · Azul Zulu · C:/Program Files/Zulu/zulu-21");
  });

  it("leaves out a source it does not know", () => {
    expect(jdkChoiceLabel({ major: 17, path: "D:/eigenes/jdk" })).toBe("Java 17 · D:/eigenes/jdk");
  });

  it("still says something for a JDK whose version could not be read", () => {
    expect(jdkChoiceLabel({ major: 0, path: "D:/kaputt" })).toBe("Java ? · D:/kaputt");
  });
});
