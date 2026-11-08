import { describe, expect, it } from "vitest";
import { isRunnableSource, runnableSourceFor } from "../src/runnable-source";
import type { OpenFile } from "../src/types";

const source = (name: string, extra: Partial<OpenFile> = {}): OpenFile => ({
  path: `C:/p/src/${name}`,
  name,
  content: "",
  savedContent: "",
  language: "java",
  ...extra,
} as OpenFile);

const listing = (name: string): OpenFile => source(name, { language: "plaintext", readOnly: true });

/**
 * Pressing Run while looking at a disassembly asked the build to compile
 * `SpielerVerwaltung.bytecode`, and the failure arrived from the compiler
 * seconds later, phrased as a missing file.
 */
describe("what a tab can be run as", () => {
  it("takes an ordinary Java file", () => {
    expect(isRunnableSource(source("Welt.java"))).toBe(true);
  });

  it("refuses a read-only listing", () => {
    expect(isRunnableSource(listing("Welt.bytecode"))).toBe(false);
    expect(isRunnableSource(source("Welt.java", { readOnly: true }))).toBe(false);
  });

  it("refuses what is not Java", () => {
    expect(isRunnableSource(source("pom.xml", { language: "xml" }))).toBe(false);
  });

  it("refuses a tab with no file behind it", () => {
    expect(isRunnableSource(source("Neu.java", { path: "" }))).toBe(false);
    expect(isRunnableSource(null)).toBe(false);
  });
});

describe("finding the file an action is about", () => {
  it("takes the active tab when it is one", () => {
    const files = [source("A.java"), source("B.java")];
    expect(runnableSourceFor(files, "C:/p/src/B.java")?.name).toBe("B.java");
  });

  it("falls back to the source the listing came from", () => {
    // The listing opens to the right of its class, so the class is the tab
    // before it — and that is the one somebody pressing Run means.
    const files = [source("A.java"), source("Welt.java"), listing("Welt.bytecode"), source("Z.java")];
    expect(runnableSourceFor(files, "C:/p/src/Welt.bytecode")?.name).toBe("Welt.java");
  });

  it("looks to the right when there is nothing to the left", () => {
    const files = [listing("Welt.bytecode"), source("Welt.java")];
    expect(runnableSourceFor(files, "C:/p/src/Welt.bytecode")?.name).toBe("Welt.java");
  });

  it("answers nothing when no open tab qualifies", () => {
    // Reported by the caller rather than papered over: running the wrong file
    // is worse than saying there is none.
    expect(runnableSourceFor([listing("Welt.bytecode")], "C:/p/src/Welt.bytecode")).toBeNull();
    expect(runnableSourceFor([], "C:/p/src/Welt.java")).toBeNull();
  });

  it("still answers when the active path names no open tab", () => {
    const files = [source("A.java")];
    expect(runnableSourceFor(files, "")?.name).toBe("A.java");
  });
});
