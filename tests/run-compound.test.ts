import { describe, expect, it } from "vitest";
import {
  describeCompound,
  eligibleMembers,
  isCompound,
  resolveCompound,
  wouldCycle,
  type CompoundConfiguration,
} from "../src/run-compound";

const plain = (id: string, name = id): CompoundConfiguration => ({ id, name, type: "java" });
const compound = (id: string, members: string[], mode?: "sequential" | "parallel"): CompoundConfiguration => ({
  id,
  name: id,
  type: "compound",
  members: members.map((member) => ({ id: member })),
  ...(mode ? { compoundMode: mode } : {}),
});

const world = [
  plain("server", "Server starten"),
  plain("client", "Client starten"),
  plain("db", "Datenbank starten"),
  compound("stack", ["db", "server", "client"]),
];

/**
 * A server and its client. A build, then the thing it built.
 *
 * Each of those was two or three trips to the run dropdown, in an order that
 * had to be remembered.
 */
describe("what a compound starts", () => {
  it("names them in the order they were put in", () => {
    const resolved = resolveCompound(world, "stack");
    expect(resolved.steps.map((step) => step.id)).toEqual(["db", "server", "client"]);
    expect(resolved.problems).toEqual([]);
  });

  it("waits between them unless told otherwise", () => {
    expect(resolveCompound(world, "stack").mode).toBe("sequential");
    expect(resolveCompound([...world, compound("both", ["server", "client"], "parallel")], "both").mode)
      .toBe("parallel");
  });

  it("expands a compound inside a compound", () => {
    // What matters at the end is the list of things that actually run.
    const nested = [...world, compound("alles", ["stack", "db"])];
    expect(resolveCompound(nested, "alles").steps.map((step) => step.id))
      .toEqual(["db", "server", "client"]);
  });

  it("starts a configuration named twice only once", () => {
    const twice = [...world, compound("doppelt", ["server", "server"])];
    expect(resolveCompound(twice, "doppelt").steps.map((step) => step.id)).toEqual(["server"]);
  });

  it("says which member is gone rather than quietly starting the rest", () => {
    const broken = [plain("server"), compound("stack", ["server", "weg"])];
    const resolved = resolveCompound(broken, "stack");
    expect(resolved.steps.map((step) => step.id)).toEqual(["server"]);
    expect(resolved.problems).toHaveLength(1);
  });

  it("says so when it would start nothing", () => {
    expect(resolveCompound([compound("leer", [])], "leer").problems[0]).toContain("startet nichts");
  });

  it("answers for a configuration that is not a compound at all", () => {
    expect(resolveCompound(world, "server").steps.map((step) => step.id)).toEqual(["server"]);
  });

  it("answers for one that no longer exists", () => {
    expect(resolveCompound(world, "weg").steps).toEqual([]);
    expect(resolveCompound(world, "weg").problems).toHaveLength(1);
  });
});

/**
 * A compound that contains itself.
 *
 * Directly is obvious and nobody writes it. Through two others is not, and it
 * is an editor that hangs on a click with no way back.
 */
describe("a compound that would contain itself", () => {
  it("cuts a cycle rather than following it", () => {
    const looping = [
      plain("server"),
      compound("a", ["server", "b"]),
      compound("b", ["a"]),
    ];
    const resolved = resolveCompound(looping, "a");
    expect(resolved.steps.map((step) => step.id)).toEqual(["server"]);
    expect(resolved.problems[0]).toContain("enthält sich selbst");
  });

  it("names the whole chain, not just the fact", () => {
    // "es hängt" says nothing about which of five configurations to open.
    const looping = [compound("a", ["b"]), compound("b", ["c"]), compound("c", ["a"])];
    expect(resolveCompound(looping, "a").problems[0]).toContain("→");
  });

  it("is asked before a member is added, not before it is run", () => {
    const existing = [compound("a", ["b"]), compound("b", []), plain("server")];
    expect(wouldCycle(existing, "b", "a")).toBe(true);
    expect(wouldCycle(existing, "a", "a")).toBe(true);
    expect(wouldCycle(existing, "a", "server")).toBe(false);
  });

  it("offers only members that cannot loop back", () => {
    const existing = [compound("a", ["b"]), compound("b", []), plain("server")];
    expect(eligibleMembers(existing, "b").map((entry) => entry.id)).toEqual(["server"]);
    expect(eligibleMembers(existing, "a").map((entry) => entry.id)).toEqual(["b", "server"]);
  });

  it("survives a cycle that does not involve the one being asked about", () => {
    const looping = [compound("a", ["b"]), compound("b", ["a"]), plain("server")];
    expect(wouldCycle(looping, "server", "a")).toBe(false);
  });
});

describe("saying what will happen", () => {
  it("names the configurations and whether they wait", () => {
    expect(describeCompound(resolveCompound(world, "stack")))
      .toBe("3 Konfigurationen nacheinander: Datenbank starten, Server starten, Client starten");
  });

  it("says the problem when there is nothing to start", () => {
    expect(describeCompound(resolveCompound([compound("leer", [])], "leer"))).toContain("startet nichts");
  });
});

describe("telling a compound from an ordinary configuration", () => {
  it("goes by the type and nothing else", () => {
    expect(isCompound({ type: "compound" })).toBe(true);
    expect(isCompound({ type: "java" })).toBe(false);
    expect(isCompound(null)).toBe(false);
  });
});
