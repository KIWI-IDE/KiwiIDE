import { describe, expect, it } from "vitest";
import { reportCompletionStatus, completionStatus, completionStatuses } from "./completion-status";
describe("completion diagnostics", () => {
  it("keeps an actionable failure visible while local suggestions are available", () => {
    const file = "C:/Project/diagnostics.gradle.kts";
    reportCompletionStatus(file, "server-missing", "missing", "server");
    reportCompletionStatus(file, "ready", "", "catalog");
    expect(completionStatus(file)?.phase).toBe("server-missing");
    reportCompletionStatus(file, "catalog-missing", "", "catalog");
    expect(completionStatus(file)?.phase).toBe("catalog-missing");
    reportCompletionStatus(file, "ready", "", "catalog");
    expect(completionStatuses(file)).toHaveLength(2);
  });
  it("matches Windows URI casing while preserving case-sensitive paths", () => {
    reportCompletionStatus("C:\\Project\\build.gradle.kts", "syncing", "", "gradle");
    expect(completionStatus("c:/project/build.gradle.kts")?.phase).toBe("syncing");
    reportCompletionStatus("/project/Build.gradle.kts", "timeout");
    expect(completionStatus("/project/build.gradle.kts")).toBeUndefined();
  });
});
