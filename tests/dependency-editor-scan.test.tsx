import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DependencyEditor } from "../src/components/DependencyEditor";
import type { DependencyEditorModel, VulnerabilityReport } from "../src/types";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
}));

// Keep state/refs across explicit renders and exercise the actual handlers.
// Passive effects stay pending: a changed model must hide stale results even
// during the render before React can run its invalidation effect.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: () => undefined,
  useMemo: (calculate: () => unknown) => calculate(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next;
    }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ||= { current: initial },
}));

type ElementProps = { children?: ReactNode; className?: string; title?: string; onClick?: () => void };
function elements(node: ReactNode): Array<ReactElement<ElementProps>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

const root = "C:\\project";
const modelWithVersion = (version: string): DependencyEditorModel => ({
  type: "Maven", buildFiles: ["pom.xml"], catalogs: [],
  dependencies: [{
    id: "log4j", ecosystem: "maven", groupId: "org.apache.logging.log4j", artifactId: "log4j-core",
    coordinate: "org.apache.logging.log4j:log4j-core", version, declaredVersion: version,
    editableVersion: true, versionSource: "literal", scope: "compile", configuration: "",
    managed: false, direct: true, buildFile: "pom.xml", sourceFile: "pom.xml",
  }],
});
const clean: VulnerabilityReport = {
  checked: true, complete: true, reachable: true, totalDependencies: 1,
  checkedDependencies: 1, skippedDependencies: 0, scannedAt: 1, findings: [],
};
const vulnerable: VulnerabilityReport = {
  ...clean,
  findings: [{
    id: "CVE-2021-44228", osvId: "GHSA-jfh8-c2jp-5v3q", dependency: "org.apache.logging.log4j:log4j-core",
    version: "2.14.1", severity: "CRITICAL", summary: "Log4Shell", fixedIn: ["2.15.0"],
    url: "https://osv.dev/vulnerability/GHSA-jfh8-c2jp-5v3q",
  }],
};
const scan = vi.fn<(root: string, force?: boolean) => Promise<VulnerabilityReport>>();
const onRemove = vi.fn(async () => undefined);
let model: DependencyEditorModel;

function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return elements(DependencyEditor({
    workspaceRoot: root, model, loading: false, error: "", onAdd: () => undefined,
    onRefresh: () => undefined, onUpdate: async () => undefined, onRemove,
    onUpdateCatalog: async () => undefined,
  }));
}

function clickScan() {
  render().find((element) => element.props.className === "dependency-scan")!.props.onClick!();
}

function hasClass(tree: ReturnType<typeof render>, className: string) {
  return tree.some((element) => element.props.className?.split(" ").includes(className));
}

function expectNoScanEvidence() {
  const tree = render();
  expect(hasClass(tree, "dependency-scan-clean")).toBe(false);
  expect(hasClass(tree, "dependency-scan-findings")).toBe(false);
  expect(hasClass(tree, "dependency-row-badge")).toBe(false);
}

async function beginRecheck(report: VulnerabilityReport, expectedClass: string) {
  scan.mockResolvedValueOnce(report);
  clickScan();
  await Promise.resolve();
  expect(hasClass(render(), expectedClass)).toBe(true);
  if (report.findings.length) expect(hasClass(render(), "dependency-row-badge")).toBe(true);

  let finish!: (report: VulnerabilityReport) => void;
  const response = new Promise<VulnerabilityReport>((resolve) => { finish = resolve; });
  scan.mockReturnValueOnce(response);
  clickScan();
  expect(scan).toHaveBeenCalledTimes(2);
  return { response, finish };
}

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  model = modelWithVersion("2.14.1");
  scan.mockReset();
  onRemove.mockClear();
  vi.stubGlobal("window", { kiwi: { security: { scan } } });
});
afterEach(() => vi.unstubAllGlobals());

const reports = [
  { name: "clean", report: clean, expectedClass: "dependency-scan-clean" },
  { name: "vulnerable", report: vulnerable, expectedClass: "dependency-scan-findings" },
];

describe("dependency scan result lifetime", () => {
  it.each(reports)("hides a $name report and rejects its pending recheck after a version change", async ({ report, expectedClass }) => {
    const pending = await beginRecheck(report, expectedClass);
    model = modelWithVersion("2.17.0");
    expectNoScanEvidence();

    pending.finish(report);
    await pending.response;
    expectNoScanEvidence();
  });

  it.each(reports)("never restores a stale $name report after a dependency mutation", async ({ report, expectedClass }) => {
    const pending = await beginRecheck(report, expectedClass);
    render().find((element) => element.props.className === "icon-button danger")!.props.onClick!();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expectNoScanEvidence();

    // Keep the displayed model unchanged until its backend refresh arrives.
    // The old request must not restore either reassurance or warning badges.
    pending.finish(report);
    await pending.response;
    expectNoScanEvidence();
  });
});
