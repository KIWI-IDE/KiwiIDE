import { describe, expect, it } from "vitest";
import { sanitizeRightTool } from "./right-tools";

describe("right tool layout restore", () => {
  it("restores CodeToGetter and rejects removed tools", () => {
    expect(sanitizeRightTool("collab")).toBe("collab");
    expect(sanitizeRightTool("build")).toBe("build");
    expect(sanitizeRightTool("unknown", "dependencies")).toBe("dependencies");
    expect(sanitizeRightTool(null, "build")).toBeNull();
  });
});
