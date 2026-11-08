import type { ModuleInfo } from "../types";

export type JavaNavigationKind = "call" | "type" | "usages";
export type HierarchyDirection = "incoming" | "outgoing" | "supertypes" | "subtypes";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface JavaHierarchyItem {
  name: string;
  kind?: number;
  detail?: string;
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  data?: unknown;
}

export interface JavaHierarchyNode {
  id: string;
  item: JavaHierarchyItem;
  direction: HierarchyDirection;
}

export interface JavaHierarchyBranch {
  direction: HierarchyDirection;
  label: string;
  nodes: JavaHierarchyNode[];
}

export interface JavaUsage {
  id: string;
  uri: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  preview: string;
  moduleId: string | null;
  sourceKind: "production" | "test" | "external";
}

export interface JavaUsageFileGroup {
  path: string;
  name: string;
  moduleId: string | null;
  sourceKind: JavaUsage["sourceKind"];
  usages: JavaUsage[];
}

export interface JavaUsagePackageGroup {
  packageName: string;
  files: JavaUsageFileGroup[];
  count: number;
}

export interface JavaNavigationScope {
  moduleId: string | null;
  includeProduction: boolean;
  includeTests: boolean;
}

export interface JavaNavigationModel {
  id: string;
  kind: JavaNavigationKind;
  title: string;
  root?: JavaHierarchyItem;
  branches?: JavaHierarchyBranch[];
  usageGroups?: JavaUsagePackageGroup[];
}

type LspLocation = {
  uri?: string;
  range?: LspRange;
  targetUri?: string;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
};

const normalisePath = (value: string) => value.replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();

function absoluteRoot(root: string, projectRoot: string) {
  if (/^[a-zA-Z]:[\\/]/.test(root) || root.startsWith("/")) return root;
  return `${projectRoot.replace(/[\\/]$/, "")}\\${root}`;
}

function pathWithin(path: string, parent: string) {
  const child = normalisePath(path);
  const root = normalisePath(parent);
  return child === root || child.startsWith(`${root}\\`);
}

export function pathFromJavaUri(uri: string) {
  if (!/^file:/i.test(uri)) return uri;
  try {
    const parsed = new URL(uri);
    let value = decodeURIComponent(parsed.pathname);
    if (parsed.host) value = `//${parsed.host}${value}`;
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
    return value.replace(/\//g, "\\");
  } catch {
    const value = decodeURIComponent(uri.replace(/^file:\/\//i, ""));
    return /^[\\/][A-Za-z]:/.test(value) ? value.slice(1).replace(/\//g, "\\") : value.replace(/\//g, "\\");
  }
}

export function hierarchyNodeFromRelation(
  relation: unknown,
  direction: HierarchyDirection,
  index = 0,
): JavaHierarchyNode | null {
  if (!relation || typeof relation !== "object") return null;
  const value = relation as Record<string, unknown>;
  const candidate = (value.from || value.to || value) as Partial<JavaHierarchyItem>;
  if (!candidate || typeof candidate.name !== "string" || typeof candidate.uri !== "string" || !candidate.range || !candidate.selectionRange) {
    return null;
  }
  const item = candidate as JavaHierarchyItem;
  const position = item.selectionRange.start;
  return {
    id: `${direction}:${item.uri}:${position.line}:${position.character}:${item.name}:${index}`,
    item,
    direction,
  };
}

export function hierarchyNodesFromResponse(response: unknown, direction: HierarchyDirection) {
  if (!Array.isArray(response)) return [];
  return response
    .map((entry, index) => hierarchyNodeFromRelation(entry, direction, index))
    .filter((node): node is JavaHierarchyNode => Boolean(node));
}

export function classifyJavaPath(path: string, projectRoot: string, modules: ModuleInfo[]) {
  const candidates = modules
    .filter((module) => pathWithin(path, module.root))
    .sort((left, right) => right.root.length - left.root.length);
  const module = candidates[0] || null;
  if (!pathWithin(path, projectRoot)) return { moduleId: null, sourceKind: "external" as const, sourceRoot: null };
  if (module) {
    const testRoot = module.testRoots.map((root) => absoluteRoot(root, module.projectRoot)).find((root) => pathWithin(path, root));
    if (testRoot) return { moduleId: module.id, sourceKind: "test" as const, sourceRoot: testRoot };
    const sourceRoot = module.sourceRoots.map((root) => absoluteRoot(root, module.projectRoot)).find((root) => pathWithin(path, root));
    if (sourceRoot) return { moduleId: module.id, sourceKind: "production" as const, sourceRoot };
    return { moduleId: module.id, sourceKind: "production" as const, sourceRoot: module.root };
  }
  const isTest = /[\\/]src[\\/](?:test|integrationTest)[\\/]/i.test(path);
  return { moduleId: null, sourceKind: isTest ? "test" as const : "production" as const, sourceRoot: projectRoot };
}

export function matchesNavigationScope(
  path: string,
  projectRoot: string,
  modules: ModuleInfo[],
  scope: JavaNavigationScope,
) {
  const classification = classifyJavaPath(path, projectRoot, modules);
  if (classification.sourceKind === "external") return false;
  if (scope.moduleId && classification.moduleId !== scope.moduleId) return false;
  if (classification.sourceKind === "test") return scope.includeTests;
  return scope.includeProduction;
}

function packageForPath(path: string, projectRoot: string, modules: ModuleInfo[]) {
  const classification = classifyJavaPath(path, projectRoot, modules);
  const sourceRoot = classification.sourceRoot || projectRoot;
  const directory = path.replace(/[\\/][^\\/]+$/, "");
  if (!pathWithin(directory, sourceRoot)) return "(extern)";
  const relative = directory.slice(sourceRoot.replace(/[\\/]$/, "").length).replace(/^[\\/]+/, "");
  return relative ? relative.split(/[\\/]+/).filter(Boolean).join(".") : "(default)";
}

export function groupJavaUsageLocations(
  locations: unknown,
  fileContents: ReadonlyMap<string, string>,
  projectRoot: string,
  modules: ModuleInfo[],
): JavaUsagePackageGroup[] {
  if (!Array.isArray(locations)) return [];
  const packages = new Map<string, Map<string, JavaUsageFileGroup>>();
  const contentByPath = new Map([...fileContents].map(([path, content]) => [normalisePath(path), content]));
  for (const raw of locations) {
    if (!raw || typeof raw !== "object") continue;
    const location = raw as LspLocation;
    const uri = location.uri || location.targetUri;
    const range = location.range || location.targetSelectionRange || location.targetRange;
    if (!uri || !range) continue;
    const path = pathFromJavaUri(uri);
    const classification = classifyJavaPath(path, projectRoot, modules);
    const packageName = packageForPath(path, projectRoot, modules);
    const content = fileContents.get(path) || contentByPath.get(normalisePath(path)) || "";
    const preview = content.split(/\r?\n/)[range.start.line]?.trim() || "";
    const usage: JavaUsage = {
      id: `${uri}:${range.start.line}:${range.start.character}`,
      uri,
      path,
      line: range.start.line + 1,
      column: range.start.character + 1,
      endLine: range.end.line + 1,
      endColumn: range.end.character + 1,
      preview,
      moduleId: classification.moduleId,
      sourceKind: classification.sourceKind,
    };
    const files = packages.get(packageName) || new Map<string, JavaUsageFileGroup>();
    const file = files.get(path) || {
      path,
      name: path.split(/[\\/]/).at(-1) || path,
      moduleId: classification.moduleId,
      sourceKind: classification.sourceKind,
      usages: [],
    };
    file.usages.push(usage);
    files.set(path, file);
    packages.set(packageName, files);
  }
  return [...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, files]) => {
      const groups = [...files.values()]
        .map((file) => ({ ...file, usages: [...file.usages].sort((left, right) => left.line - right.line || left.column - right.column) }))
        .sort((left, right) => left.name.localeCompare(right.name));
      return { packageName, files: groups, count: groups.reduce((sum, file) => sum + file.usages.length, 0) };
    });
}
