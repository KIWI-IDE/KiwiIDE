/**
 * What Kiwi answers when asked which version it is.
 *
 * Two versions can be true at once: the installed application and the user
 * interface, which a restart-free update replaces on its own. Reporting only
 * one of them made bug reports about a renderer update impossible to place, so
 * the second line appears exactly when the two differ.
 */
export interface KiwiBuildInfo {
  renderer?: { version?: string; hot?: boolean; mainHash?: string };
  build?: {
    version?: string;
    electron?: string;
    chrome?: string;
    node?: string;
    platform?: string;
    arch?: string;
  };
}

export interface VersionSummary {
  /** The version to show first; the installed application wherever it is known. */
  version: string;
  /** Set only while a renderer update is running on top of another version. */
  renderer: string;
  runtime: string;
  platform: string;
}

const platformNames: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

export function versionSummary(info: KiwiBuildInfo | null, uiVersion: string): VersionSummary {
  const application = String(info?.build?.version || "").trim();
  const renderer = String(info?.renderer?.version || uiVersion || "").trim();
  const version = application || renderer;
  const runtime = [
    info?.build?.electron ? `Electron ${info.build.electron}` : "",
    info?.build?.chrome ? `Chromium ${info.build.chrome}` : "",
    info?.build?.node ? `Node ${info.build.node}` : "",
  ].filter(Boolean).join(" · ");
  const platform = info?.build?.platform
    ? `${platformNames[info.build.platform] || info.build.platform}${info.build.arch ? ` ${info.build.arch}` : ""}`
    : "";
  return {
    version,
    // Only worth saying when it is not the same answer twice.
    renderer: renderer && application && renderer !== application ? renderer : "",
    runtime,
    platform,
  };
}

/** The block a bug report can be pasted into, as one piece of text. */
export function versionReport(summary: VersionSummary): string {
  return [
    `Kiwi IDE ${summary.version || "unbekannt"}`,
    summary.renderer ? `Oberfläche ${summary.renderer}` : "",
    summary.runtime,
    summary.platform,
  ].filter(Boolean).join("\n");
}
