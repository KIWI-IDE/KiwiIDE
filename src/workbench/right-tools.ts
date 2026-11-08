import type { RightToolView } from "../types";

export const RIGHT_TOOL_ORDER: RightToolView[] = ["build", "dependencies", "collab"];

/** Keeps old layout profiles usable and rejects hand-edited/removed tool IDs. */
export function sanitizeRightTool(value: unknown, fallback: RightToolView | null = null): RightToolView | null {
  if (value === null) return null;
  return typeof value === "string" && RIGHT_TOOL_ORDER.includes(value as RightToolView)
    ? value as RightToolView
    : fallback;
}
