/**
 * Instant syntax validation for JSON files in the editor.
 */

export interface JsonSyntaxProblem {
  line: number;
  column: number;
  length: number;
  kind: "invalid-json";
  message: string;
  severity?: "error" | "warning";
}

export function findJsonSyntaxProblems(source: string): JsonSyntaxProblem[] {
  const content = String(source || "");
  if (!content.trim()) return [];

  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const rawMessage = String((error as Error)?.message || error);
    const spot = rawMessage.match(/\(line (\d+) column (\d+)\)/);
    const offsetMatch = rawMessage.match(/at position (\d+)/);
    const offset = offsetMatch ? Number(offsetMatch[1]) : NaN;
    const readable = rawMessage
      .replace(/\s*in JSON at position \d+.*$/s, "")
      .replace(/,\s*"[\s\S]*?"\s*is not valid JSON$/, "")
      .replace(/\s*is not valid JSON$/, "")
      .trim();

    if (spot) {
      return [{
        line: Number(spot[1]),
        column: Number(spot[2]),
        length: 1,
        kind: "invalid-json",
        message: `Ungültiges JSON: ${readable}`,
        severity: "error",
      }];
    }

    const safe = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, content.length));
    const lines = content.slice(0, safe).split(/\r?\n/);
    return [{
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      length: 1,
      kind: "invalid-json",
      message: `Ungültiges JSON: ${readable}`,
      severity: "error",
    }];
  }
}
