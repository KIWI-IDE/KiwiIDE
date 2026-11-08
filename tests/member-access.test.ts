import { describe, expect, it } from "vitest";
import { localMemberCompletions, memberAccessReceiver, parseJavaMembers } from "../src/language/java-completion";

/**
 * What stands before the dot.
 *
 * The scan of the buffer knows one class: the one being edited. After a dot,
 * what exists is decided by the receiver, and the scan knows nothing about it —
 * so the only receivers it may answer for are `this` and `super`.
 */
describe("reading the receiver of a member access", () => {
  it("finds a plain name", () => {
    expect(memberAccessReceiver("    player.")).toBe("player");
    expect(memberAccessReceiver("    player.get")).toBe("player");
    expect(memberAccessReceiver("    this.")).toBe("this");
    expect(memberAccessReceiver("    super.na")).toBe("super");
  });

  it("answers for a receiver that is not a name at all", () => {
    // The name is not the point — that it is not this file's own class is.
    // Each of these used to read as "no receiver", and the members of the class
    // being edited were offered for a value they have nothing to do with.
    for (const line of [
      "    getPlayer().",
      "    list.get(0).",
      "    array[0].",
      '    "text".',
      "    Map.<String>of().",
      "    players.get(\"server\").stream().filter(p -> p).",
    ]) {
      expect(memberAccessReceiver(line), line).not.toBeNull();
      expect(memberAccessReceiver(line), line).not.toBe("this");
    }
  });

  it("says there is no member access when there is none", () => {
    expect(memberAccessReceiver("    int score = 1")).toBeNull();
    expect(memberAccessReceiver("    player")).toBeNull();
    expect(memberAccessReceiver("")).toBeNull();
  });

  it("does not read a decimal number as a member access", () => {
    expect(memberAccessReceiver("    double d = 1.")).toBeNull();
    expect(memberAccessReceiver("    return 42.")).toBeNull();
    // A name that merely ends in a digit is still a name.
    expect(memberAccessReceiver("    player2.")).toBe("player2");
  });
});

describe("what the buffer offers after a dot", () => {
  const members = parseJavaMembers([
    "public class Alpha {",
    "  private String name;",
    "  public void reset() {}",
    "  public int score() { return 1; }",
    "}",
  ].join("\n"));
  const after = (lineBeforeCursor: string) =>
    localMemberCompletions(members, { lineBeforeCursor, line: 99 }).map((item) => item.label);

  it("offers this file's methods after this", () => {
    expect(after("    this.")).toEqual(["reset()", "score()"]);
  });

  it("offers nothing for a receiver it knows nothing about", () => {
    for (const line of [
      "    player.",
      "    getPlayer().",
      "    list.get(0).",
      "    array[0].",
      '    "text".',
      "    players.get(\"server\").stream().filter(player -> player.",
    ]) {
      expect(after(line), line).toEqual([]);
    }
  });

  it("still offers everything where no receiver is in the way", () => {
    expect(after("    ").length).toBeGreaterThan(0);
  });
});
