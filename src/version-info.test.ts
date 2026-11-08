import { describe, expect, it } from "vitest";
import { versionReport, versionSummary } from "./version-info";

const health = (over: Record<string, unknown> = {}) => ({
  renderer: { version: "1.3.11", hot: false, mainHash: "abc" },
  build: {
    version: "1.3.11",
    electron: "33.2.1",
    chrome: "130.0.6723.44",
    node: "20.18.1",
    platform: "win32",
    arch: "x64",
  },
  ...over,
});

describe("what the settings say about the version", () => {
  it("names the installed version and what it runs on", () => {
    const summary = versionSummary(health(), "1.3.11");
    expect(summary.version).toBe("1.3.11");
    expect(summary.runtime).toBe("Electron 33.2.1 · Chromium 130.0.6723.44 · Node 20.18.1");
    expect(summary.platform).toBe("Windows x64");
  });

  it("says nothing about the interface while it is the same version", () => {
    // Two identical numbers under each other read like a fault.
    expect(versionSummary(health(), "1.3.11").renderer).toBe("");
  });

  it("names both once a restart-free update has replaced the interface", () => {
    const summary = versionSummary(
      health({ renderer: { version: "1.3.12", hot: true, mainHash: "abc" } }),
      "1.3.12",
    );
    expect(summary.version).toBe("1.3.11");
    expect(summary.renderer).toBe("1.3.12");
  });

  it("falls back to the interface's own version when the main process says nothing", () => {
    // The settings can be open before the health call answers, and an older
    // main process has no build block at all.
    expect(versionSummary(null, "1.3.11").version).toBe("1.3.11");
    expect(versionSummary({}, "1.3.11").version).toBe("1.3.11");
    expect(versionSummary({ renderer: { version: "1.3.11" } }, "").version).toBe("1.3.11");
  });

  it("leaves out a runtime it was not told about", () => {
    const summary = versionSummary({ build: { version: "1.3.11", electron: "33.2.1" } }, "1.3.11");
    expect(summary.runtime).toBe("Electron 33.2.1");
    expect(summary.platform).toBe("");
  });

  it("names an unfamiliar platform rather than hiding it", () => {
    expect(versionSummary({ build: { version: "1", platform: "freebsd", arch: "arm64" } }, "1").platform)
      .toBe("freebsd arm64");
  });

  it("pastes into a bug report as its own block", () => {
    expect(versionReport(versionSummary(health(), "1.3.11"))).toBe([
      "Kiwi IDE 1.3.11",
      "Electron 33.2.1 · Chromium 130.0.6723.44 · Node 20.18.1",
      "Windows x64",
    ].join("\n"));
  });

  it("says so rather than pasting an empty line when nothing is known", () => {
    expect(versionReport(versionSummary(null, ""))).toBe("Kiwi IDE unbekannt");
  });
});
