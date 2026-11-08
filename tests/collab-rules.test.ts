import { describe, expect, it } from "vitest";

const {
  COLLAB_ROLES,
  IGNORED_DIRECTORIES,
  MAX_MESSAGE_BYTES,
  assertShareableRelative,
  editDelta,
  mayEdit,
  normalizeRole,
} = require("../electron/services/collab-service.cjs");

describe("what a guest may do", () => {
  it("offers exactly two roles, and reading is one of them", () => {
    expect([...COLLAB_ROLES].sort()).toEqual(["bearbeiten", "lesen"]);
  });

  it("lets only the editing role change anything", () => {
    expect(mayEdit("bearbeiten")).toBe(true);
    expect(mayEdit("lesen")).toBe(false);
  });

  it("treats anything it does not recognise as reading", () => {
    // A role arrives over a connection. Widening what a guest may do because a
    // value was misspelled is the one direction this must never fail in.
    // "BEARBEITEN " is not in this list on purpose: trimming and lowering
    // the case is deliberate, and that value really is the editing role.
    for (const value of ["administrator", "schreiben", "", null, undefined, 42, {}]) {
      expect({ value: String(value), mayEdit: mayEdit(value as string) })
        .toEqual({ value: String(value), mayEdit: false });
    }
  });

  it("reads a role written in another case", () => {
    expect(normalizeRole("Bearbeiten")).toBe("bearbeiten");
    expect(normalizeRole("  LESEN  ")).toBe("lesen");
  });

  it("falls back to what the caller says, but never past the two roles", () => {
    expect(normalizeRole("unfug", "bearbeiten")).toBe("bearbeiten");
    expect(normalizeRole("unfug", "administrator")).toBe("lesen");
  });
});

describe("paths a guest may name", () => {
  it("allows an ordinary source file", () => {
    expect(() => assertShareableRelative("src/main/java/Main.java")).not.toThrow();
    expect(() => assertShareableRelative("pom.xml")).not.toThrow();
  });

  it("refuses what the tree deliberately never showed", () => {
    // Not listing something is not the same as refusing it. A guest can ask
    // for a path by name, and .git or .env are exactly the names to guess.
    for (const hidden of [".git/config", ".env", ".kiwi/session.json", "node_modules/x/index.js", "target/classes/A.class", "build/x", "out/x", "bin/x", ".idea/workspace.xml"]) {
      expect({ hidden, refused: (() => {
        try { assertShareableRelative(hidden); return false; } catch { return true; }
      })() }).toEqual({ hidden, refused: true });
    }
  });

  it("refuses a hidden folder anywhere along the path, not only at the front", () => {
    expect(() => assertShareableRelative("src/.secrets/key.txt")).toThrow(/freigegeben/i);
    expect(() => assertShareableRelative("a/b/node_modules/c")).toThrow(/freigegeben/i);
  });

  it("ignores the case a guest happens to type", () => {
    expect(() => assertShareableRelative("NODE_MODULES/x")).toThrow(/freigegeben/i);
    expect(() => assertShareableRelative("Target/classes/A.class")).toThrow(/freigegeben/i);
  });

  it("takes backslashes as separators, because a Windows guest sends them", () => {
    expect(() => assertShareableRelative("src\\.git\\config")).toThrow(/freigegeben/i);
  });

  it("lets .gitignore through, which is the one dotfile worth reading", () => {
    expect(() => assertShareableRelative(".gitignore")).not.toThrow();
  });
});

describe("how much longer an edit makes a text", () => {
  it("counts an insertion as what it adds", () => {
    expect(editDelta({ start: 3, end: 3, text: "abc" })).toBe(3);
  });

  it("counts a deletion as what it removes", () => {
    expect(editDelta({ start: 3, end: 8, text: "" })).toBe(-5);
  });

  it("counts a replacement as the difference, not as both", () => {
    // Every offset after an edit moves by exactly this much; counting it as
    // the sum would push every later edit to the wrong place.
    expect(editDelta({ start: 0, end: 5, text: "xyz" })).toBe(-2);
    expect(editDelta({ start: 0, end: 2, text: "hallo" })).toBe(3);
  });

  it("counts an edit that changes nothing as nothing", () => {
    expect(editDelta({ start: 4, end: 7, text: "abc" })).toBe(0);
  });
});

describe("the limits the wire is held to", () => {
  it("caps a message rather than buffering whatever arrives", () => {
    expect(MAX_MESSAGE_BYTES).toBeGreaterThan(0);
    expect(MAX_MESSAGE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it("keeps the ignored directories as one list both sides read", () => {
    for (const name of ["node_modules", ".git", "target", "build"]) {
      expect({ name, ignored: IGNORED_DIRECTORIES.has(name) }).toEqual({ name, ignored: true });
    }
    expect(IGNORED_DIRECTORIES.has("src")).toBe(false);
  });
});
