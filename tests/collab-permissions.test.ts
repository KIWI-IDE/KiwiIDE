import { describe, expect, it } from "vitest";

const {
  COLLAB_PERMISSIONS,
  mayDo,
  normalizePermissions,
} = require("../electron/services/collab-service.cjs");

/**
 * What a guest may do, one answer per thing.
 *
 * "bearbeiten" used to mean all of it at once. These are separate because they
 * are separately dangerous: a build runs the project's own scripts on the
 * host's machine, a terminal is a shell on it, and Git can push. Somebody who
 * should be able to type in a file needs none of those.
 */
describe("what a guest is allowed to do", () => {
  it("gives a reader nothing", () => {
    expect(normalizePermissions(undefined, "lesen")).toEqual([]);
    for (const permission of COLLAB_PERMISSIONS) {
      expect(mayDo({ role: "lesen" }, permission)).toBe(false);
    }
  });

  it("gives the old editing role exactly what it always meant", () => {
    // Not build, not debug, not terminal, not git — those were never part of
    // it and must not arrive with it now that they can be named.
    expect(normalizePermissions(undefined, "bearbeiten")).toEqual(["bearbeiten", "speichern"]);
    expect(mayDo({ role: "bearbeiten" }, "bearbeiten")).toBe(true);
    expect(mayDo({ role: "bearbeiten" }, "speichern")).toBe(true);
    for (const permission of ["build", "debug", "terminal", "git"]) {
      expect(mayDo({ role: "bearbeiten" }, permission)).toBe(false);
    }
  });

  it("grants only what was named", () => {
    const peer = { role: "lesen", permissions: ["bearbeiten", "git"] };
    expect(mayDo(peer, "bearbeiten")).toBe(true);
    expect(mayDo(peer, "git")).toBe(true);
    // Editing without saving is a real combination: try something in a buffer
    // without putting it on somebody else's disk.
    expect(mayDo(peer, "speichern")).toBe(false);
    expect(mayDo(peer, "terminal")).toBe(false);
  });

  it("drops anything it does not recognise", () => {
    expect(normalizePermissions(["bearbeiten", "root", "", null, "BUILD"], "lesen"))
      .toEqual(["bearbeiten", "build"]);
    expect(normalizePermissions("bearbeiten" as never, "lesen")).toEqual([]);
    expect(normalizePermissions([], "bearbeiten")).toEqual([]);
  });

  it("answers no for a peer that is not there", () => {
    for (const permission of COLLAB_PERMISSIONS) {
      expect(mayDo(null, permission)).toBe(false);
      expect(mayDo(undefined, permission)).toBe(false);
      expect(mayDo({}, permission)).toBe(false);
    }
  });
});
