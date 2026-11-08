/**
 * Finding a file in the Explorer by typing its name.
 *
 * Every tree in every IDE does this, and it is the difference between
 * navigating a project and scrolling one. Without it a deep package means
 * either the mouse or four folder-opening keystrokes per level; with it the
 * first three letters of the class are enough.
 *
 * Deliberately not the file palette: this searches what is on screen, keeps
 * the tree where it is, and never opens anything. It is a way of moving the
 * selection, and it stops being one the moment nobody is typing.
 */

/** How long a typed prefix stands before it is a new search. */
export const SPEED_SEARCH_TIMEOUT_MS = 1_200;

export interface SpeedSearchState {
  /** What has been typed so far. Empty means no search is running. */
  query: string;
  /** When the last character arrived, so a pause can end the search. */
  at: number;
}

export const NO_SPEED_SEARCH: SpeedSearchState = { query: "", at: 0 };

/**
 * The prefix after one more keystroke.
 *
 * A pause starts a new search rather than extending an old one — typing
 * "Spieler", going away to think, and typing "Server" should look for
 * "Server", not for "SpielerServer".
 */
export function extendSpeedSearch(
  state: SpeedSearchState,
  character: string,
  now: number,
  timeoutMs = SPEED_SEARCH_TIMEOUT_MS,
): SpeedSearchState {
  const typed = String(character || "");
  if (typed.length !== 1) return state;
  const stale = !state.query || now - state.at > timeoutMs;
  return { query: stale ? typed : state.query + typed, at: now };
}

/** Removes the last character, and ends the search when nothing is left. */
export function shortenSpeedSearch(state: SpeedSearchState, now: number): SpeedSearchState {
  const query = state.query.slice(0, -1);
  return query ? { query, at: now } : NO_SPEED_SEARCH;
}

/**
 * Which entry the typed prefix means.
 *
 * A name that starts with what was typed wins over one that merely contains
 * it, because starting with it is what somebody typing a name intends. Within
 * each of those the search runs forward from where the selection already is
 * and wraps, so typing the same letter again walks through the matches — which
 * is how every other tree behaves and therefore what the fingers expect.
 *
 * Answers -1 when nothing matches, which callers treat as "leave the selection
 * alone": moving it somewhere arbitrary on a typo is worse than not moving.
 */
export function speedSearchMatch(names: string[], query: string, from = -1): number {
  const needle = String(query || "").toLowerCase();
  if (!needle || !names.length) return -1;
  const start = Number.isInteger(from) && from >= 0 ? from : -1;
  // Repeating the same single letter is a request for the next match, not for
  // the one already selected; a longer prefix is a refinement of it.
  const beginAt = needle.length === 1 ? start + 1 : start;
  const order: number[] = [];
  for (let step = 0; step < names.length; step += 1) {
    order.push(((beginAt < 0 ? 0 : beginAt) + step) % names.length);
  }
  const prefix = order.find((index) => String(names[index] || "").toLowerCase().startsWith(needle));
  if (prefix !== undefined) return prefix;
  const contains = order.find((index) => String(names[index] || "").toLowerCase().includes(needle));
  return contains === undefined ? -1 : contains;
}

/**
 * Whether a key should feed the search rather than do what it usually does.
 *
 * Only bare printable characters. Anything with a command modifier is a
 * shortcut somebody bound, and taking it here would break it silently.
 */
export function isSpeedSearchKey(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 && event.key !== " ";
}
