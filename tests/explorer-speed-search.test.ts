import { describe, expect, it } from "vitest";
import {
  extendSpeedSearch,
  isSpeedSearchKey,
  NO_SPEED_SEARCH,
  shortenSpeedSearch,
  speedSearchMatch,
  SPEED_SEARCH_TIMEOUT_MS,
} from "../src/explorer-speed-search";

const names = ["build", "src", "Spieler.java", "SpielerVerwaltung.java", "Server.java", "pom.xml"];

/**
 * Typing a name to get to it.
 *
 * Without this a deep package means either the mouse or four folder-opening
 * keystrokes per level.
 */
describe("finding an entry by what was typed", () => {
  it("prefers a name that starts with the prefix", () => {
    expect(speedSearchMatch(names, "spiel")).toBe(2);
    expect(speedSearchMatch(names, "pom")).toBe(5);
  });

  it("falls back to a name that merely contains it", () => {
    // Nothing starts with "verwalt", but one name has it inside.
    expect(speedSearchMatch(names, "verwalt")).toBe(3);
  });

  it("walks through the matches when the same letter is typed again", () => {
    // Which is how every other tree behaves, and therefore what fingers do.
    expect(speedSearchMatch(names, "s")).toBe(1);
    expect(speedSearchMatch(names, "s", 1)).toBe(2);
    expect(speedSearchMatch(names, "s", 2)).toBe(3);
    expect(speedSearchMatch(names, "s", 3)).toBe(4);
  });

  it("wraps rather than stopping at the end", () => {
    expect(speedSearchMatch(names, "s", 4)).toBe(1);
  });

  it("refines from where the selection is when the prefix grows", () => {
    // A longer prefix is not a request for the next match.
    expect(speedSearchMatch(names, "spieler", 2)).toBe(2);
  });

  it("ignores case, because nobody types it", () => {
    expect(speedSearchMatch(names, "SPIELERV")).toBe(3);
  });

  it("leaves the selection alone when nothing matches", () => {
    // Moving it somewhere arbitrary on a typo is worse than not moving.
    expect(speedSearchMatch(names, "zzz")).toBe(-1);
    expect(speedSearchMatch(names, "")).toBe(-1);
    expect(speedSearchMatch([], "s")).toBe(-1);
  });
});

describe("what has been typed so far", () => {
  it("grows while the typing continues", () => {
    const first = extendSpeedSearch(NO_SPEED_SEARCH, "s", 1_000);
    const second = extendSpeedSearch(first, "p", 1_200);
    expect(second.query).toBe("sp");
  });

  it("starts over after a pause", () => {
    // Typing a name, going away to think, and typing another should look for
    // the second one, not for both stuck together.
    const first = extendSpeedSearch(NO_SPEED_SEARCH, "s", 1_000);
    const later = extendSpeedSearch(first, "p", 1_000 + SPEED_SEARCH_TIMEOUT_MS + 1);
    expect(later.query).toBe("p");
  });

  it("takes back one character at a time and then stops", () => {
    const typed = extendSpeedSearch(extendSpeedSearch(NO_SPEED_SEARCH, "s", 1), "p", 2);
    expect(shortenSpeedSearch(typed, 3).query).toBe("s");
    expect(shortenSpeedSearch({ query: "s", at: 3 }, 4)).toEqual(NO_SPEED_SEARCH);
  });

  it("ignores anything that is not one character", () => {
    expect(extendSpeedSearch(NO_SPEED_SEARCH, "Enter", 1)).toEqual(NO_SPEED_SEARCH);
    expect(extendSpeedSearch(NO_SPEED_SEARCH, "", 1)).toEqual(NO_SPEED_SEARCH);
  });
});

describe("which keys belong to the search", () => {
  it("takes a bare printable character", () => {
    expect(isSpeedSearchKey({ key: "s" })).toBe(true);
    expect(isSpeedSearchKey({ key: "7" })).toBe(true);
  });

  it("leaves a shortcut alone", () => {
    // Taking a bound chord here would break it in silence.
    expect(isSpeedSearchKey({ key: "s", ctrlKey: true })).toBe(false);
    expect(isSpeedSearchKey({ key: "s", altKey: true })).toBe(false);
    expect(isSpeedSearchKey({ key: "F2" })).toBe(false);
    expect(isSpeedSearchKey({ key: "ArrowDown" })).toBe(false);
    // Space selects; it does not search.
    expect(isSpeedSearchKey({ key: " " })).toBe(false);
  });
});
