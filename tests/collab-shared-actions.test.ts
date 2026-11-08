import { describe, expect, it } from "vitest";
import {
  describeSharedRequest,
  isSharedAction as isSharedActionUi,
  permissionForAction as permissionForActionUi,
  refusalFor,
  SHARED_ACTIONS,
} from "../src/collaboration/shared-session";

const {
  isSharedAction,
  mayDo,
  permissionForAction,
  SHARED_ACTIONS: HOST_ACTIONS,
} = require("../electron/services/collab-service.cjs");

/**
 * The build, debug and terminal permissions existed for a while and granted
 * nothing: output flowed to guests, and starting anything was the host's alone.
 * A permission that grants nothing is worse than no permission, because it
 * reads like a promise.
 */
describe("what a guest may ask the host to start", () => {
  it("puts running and testing behind the build permission", () => {
    // They are builds in every way that matters: they compile the host's code
    // and start a process on the host's machine.
    expect(permissionForAction("build")).toBe("build");
    expect(permissionForAction("test")).toBe("build");
    expect(permissionForAction("run")).toBe("build");
  });

  it("keeps debugging separate", () => {
    // A debugger also stops that process wherever it likes.
    expect(permissionForAction("debug")).toBe("debug");
  });

  it("answers nothing for something that is not an action", () => {
    expect(permissionForAction("git")).toBe("");
    expect(permissionForAction("")).toBe("");
    expect(isSharedAction("terminal")).toBe(false);
    expect(isSharedAction(undefined)).toBe(false);
  });

  it("reads a stray capital the same way", () => {
    expect(permissionForAction("  Build ")).toBe("build");
    expect(isSharedAction("DEBUG")).toBe(true);
  });
});

/**
 * A guest with `build` may not debug, and a guest with `debug` may not build.
 * The check happens on the host and nowhere else.
 */
describe("who gets to start what", () => {
  const guest = (permissions: string[]) => ({ role: "lesen", permissions });

  it("lets a build permission build, test and run", () => {
    for (const action of ["build", "test", "run"]) {
      expect(mayDo(guest(["build"]), permissionForAction(action))).toBe(true);
    }
  });

  it("does not let a build permission debug", () => {
    expect(mayDo(guest(["build"]), permissionForAction("debug"))).toBe(false);
    expect(mayDo(guest(["debug"]), permissionForAction("build"))).toBe(false);
  });

  it("gives an editor neither", () => {
    // "bearbeiten" meant everything dangerous at once, and must not again.
    expect(mayDo({ role: "bearbeiten" }, permissionForAction("build"))).toBe(false);
    expect(mayDo({ role: "bearbeiten" }, permissionForAction("debug"))).toBe(false);
  });
});

/** The rule lives on both sides; they have to agree. */
describe("the two copies of the rule", () => {
  it("name the same actions", () => {
    expect([...SHARED_ACTIONS]).toEqual([...HOST_ACTIONS]);
  });

  it("map them to the same permission", () => {
    for (const action of [...SHARED_ACTIONS, "git", "terminal", ""]) {
      expect([action, permissionForActionUi(action)]).toEqual([action, permissionForAction(action)]);
      expect([action, isSharedActionUi(action)]).toEqual([action, isSharedAction(action)]);
    }
  });
});

/**
 * A build starting by itself on your own machine is alarming, and the one
 * thing that makes it not alarming is knowing who.
 */
describe("what the host is told", () => {
  it("names the guest and what they started", () => {
    expect(describeSharedRequest("Robin", "test")).toBe("Robin führt die Tests aus.");
    expect(describeSharedRequest("Robin", "debug")).toBe("Robin startet den Debugger.");
  });

  it("still says something when the name is missing", () => {
    expect(describeSharedRequest("", "build")).toBe("Ein Gast baut das Projekt.");
  });
});

describe("what a refused guest is told", () => {
  it("says which of the two it was", () => {
    expect(refusalFor("debug")).toContain("nicht debuggen");
    expect(refusalFor("test")).toContain("bauen oder ausführen");
  });
});
