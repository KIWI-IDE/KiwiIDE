import { describe, expect, it } from "vitest";

const {
  moduleInfoSource,
  normalizeJpmsName,
  safeBuildIdentifier,
  safeModuleSegment,
} = require("../electron/services/module-service.cjs");
const {
  cwdFromPowerShellOutput,
  normalizeSize,
  terminalEnvironment,
} = require("../electron/services/terminal-service.cjs");
const { STANDARD_FONT_FALLBACKS, fontFallbacksFor } = require("../electron/services/system-font-service.cjs");
const { artifactExtension } = require("../electron/services/update-service.cjs");
const { sameWindowsPath } = require("../electron/services/portable-update-service.cjs");

/**
 * The small helpers that turn what somebody typed into something a build tool,
 * a shell or the filesystem will accept.
 *
 * None of them is interesting on its own, and all of them sit directly under a
 * dialog somebody types a name into. A module called "con" or "2fast" is the
 * kind of thing that gets found once, by the person it happens to.
 */
describe("names a module may be given", () => {
  it("turns a written name into a legal JPMS module name", () => {
    expect(normalizeJpmsName("honeymc cloud")).toBe("honeymc.cloud");
    expect(normalizeJpmsName("My-Modul.Kern")).toBe("my.modul.kern");
  });

  it("keeps a segment from starting with a digit", () => {
    expect(normalizeJpmsName("2fast")).toBe("_2fast");
  });

  it("falls back to a name rather than producing an empty one", () => {
    expect(normalizeJpmsName("")).toBe("kiwi.module");
    expect(normalizeJpmsName("...")).toBe("kiwi.module");
  });

  it("makes a build identifier out of anything", () => {
    expect(safeBuildIdentifier("mein modul!")).toBe("mein-modul");
    expect(safeBuildIdentifier("---")).toBe("module");
    expect(safeBuildIdentifier("a".repeat(200))).toHaveLength(96);
  });

  it("keeps a directory name Windows will accept", () => {
    expect(safeModuleSegment('a<b>c')).toBe("a-b-c");
    expect(safeModuleSegment("trailing. ")).toBe("trailing");
    expect(safeModuleSegment("")).toBe("module");
  });

  it("steps around the device names Windows reserves", () => {
    // A directory called "con" cannot be created at all, and the failure comes
    // back as a permission error that says nothing about the name.
    expect(safeModuleSegment("con")).toBe("_con");
    expect(safeModuleSegment("PRN")).toBe("_PRN");
    expect(safeModuleSegment("com1")).toBe("_com1");
    expect(safeModuleSegment("console")).toBe("console");
  });
});

describe("writing a module-info.java", () => {
  it("lists the dependencies, the exports and the services", () => {
    const source = moduleInfoSource("de.kern", {
      requires: ["java.base"],
      requiresTransitive: ["java.sql"],
      exports: ["de.kern.api"],
      opens: ["de.kern.intern"],
      uses: ["de.kern.api.Dienst"],
      provides: [{ service: "de.kern.api.Dienst", implementations: ["de.kern.intern.DienstImpl"] }],
    }, ["de.util"]);
    expect(source).toBe([
      "module de.kern {",
      "    requires de.util;",
      "    requires java.base;",
      "    requires transitive java.sql;",
      "    exports de.kern.api;",
      "    opens de.kern.intern;",
      "    uses de.kern.api.Dienst;",
      "    provides de.kern.api.Dienst with de.kern.intern.DienstImpl;",
      "}",
      "",
    ].join("\n"));
  });

  it("names a dependency once even when it is asked for twice", () => {
    const source = moduleInfoSource("de.kern", { requires: ["de.util"] }, ["de.util"]);
    expect(source.match(/requires de\.util;/g)).toHaveLength(1);
  });

  it("writes an empty module when nothing was declared", () => {
    expect(moduleInfoSource("de.kern", {}, [])).toBe("module de.kern {\n}\n");
  });
});

describe("the terminal's working directory", () => {
  it("follows the prompt PowerShell prints", () => {
    expect(cwdFromPowerShellOutput("PS C:\\projekt> ", "C:\\alt")).toBe("C:\\projekt");
  });

  it("takes the last prompt, not the first", () => {
    expect(cwdFromPowerShellOutput("PS C:\\a> cd b\nPS C:\\a\\b> ", "C:\\alt")).toBe("C:\\a\\b");
  });

  it("reads a prompt through its colour codes", () => {
    expect(cwdFromPowerShellOutput("\u001b[32mPS C:\\projekt>\u001b[0m ", "C:\\alt")).toBe("C:\\projekt");
  });

  it("keeps what it had for anything that is not an absolute path", () => {
    // The shell stays the authority. A relative or malformed value is ignored
    // rather than guessed at, because this only labels a window.
    expect(cwdFromPowerShellOutput("PS ..\\rel> ", "C:\\alt")).toBe("C:\\alt");
    expect(cwdFromPowerShellOutput("", "C:\\alt")).toBe("C:\\alt");
    expect(cwdFromPowerShellOutput("kein Prompt hier", "C:\\alt")).toBe("C:\\alt");
  });
});

describe("the size a terminal is given", () => {
  it("keeps a number inside its bounds", () => {
    expect(normalizeSize(1000, 80, 2, 500)).toBe(500);
    expect(normalizeSize(1, 80, 2, 500)).toBe(2);
    expect(normalizeSize(120, 80, 2, 500)).toBe(120);
  });

  it("rounds what it is given", () => {
    expect(normalizeSize(120.4, 80, 2, 500)).toBe(120);
    expect(normalizeSize(120.6, 80, 2, 500)).toBe(121);
  });

  it("falls back for anything that is not a number", () => {
    expect(normalizeSize("abc", 80, 2, 500)).toBe(80);
    expect(normalizeSize(undefined, 80, 2, 500)).toBe(80);
    expect(normalizeSize(Number.POSITIVE_INFINITY, 80, 2, 500)).toBe(80);
  });
});

describe("the environment a terminal starts in", () => {
  it("announces colour support", () => {
    expect(terminalEnvironment({ PATH: "x" })).toEqual({
      PATH: "x",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
  });

  it("passes over anything that is not text", () => {
    // node-pty rejects a non-string value, and it takes the whole terminal
    // with it rather than the one variable.
    expect(terminalEnvironment({ PATH: "x", ZAHL: 5, NICHTS: undefined })).toEqual({
      PATH: "x",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
  });
});

describe("the fonts an interface falls back to", () => {
  it("answers for the platforms it knows", () => {
    expect(fontFallbacksFor("win32")[0]).toBe("JetBrains Mono");
    expect(fontFallbacksFor("darwin")[0]).toBe("SF Mono");
  });

  it("answers for a platform it does not know", () => {
    expect(fontFallbacksFor("haiku")).toEqual(fontFallbacksFor("linux"));
  });

  it("hands out a copy, so a caller cannot empty the list for everyone", () => {
    const list = fontFallbacksFor("win32");
    list.length = 0;
    expect(fontFallbacksFor("win32").length).toBeGreaterThan(0);
    expect(Object.isFrozen(STANDARD_FONT_FALLBACKS.win32)).toBe(true);
  });
});

describe("the file an update arrives as", () => {
  it("names the renderer bundle and the installer apart", () => {
    expect(artifactExtension("renderer")).toBe(".kiwi");
    expect(artifactExtension("installer")).toBe(".exe");
    expect(artifactExtension("portable")).toBe(".exe");
  });
});

describe("comparing two Windows paths", () => {
  it("ignores the case and the shape of the separators", () => {
    expect(sameWindowsPath("C:/A/b", "c:\\a\\B")).toBe(process.platform === "win32");
    expect(sameWindowsPath("C:/a", "C:/a/b")).toBe(false);
  });

  it("treats nothing as nothing rather than throwing", () => {
    expect(sameWindowsPath("", "")).toBe(true);
  });
});
