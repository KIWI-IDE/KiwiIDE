export type RefactorPlanType = "move-class" | "change-signature" | "jdt-workspace-edit";

export interface RefactorCallSite {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface JavaSignatureParameter {
  sourceIndex: number | null;
  type: string;
  name: string;
  defaultValue?: string;
}

export interface JavaMethodSignature {
  name: string;
  returnType: string;
  parameters: JavaSignatureParameter[];
  throwsClause: string;
  position?: { line: number; character: number };
}

export interface JavaRefactorPreviewFile {
  path: string;
  before: string;
  after: string;
  kind: "edit" | "build-model";
  beforeHash: string;
}

export interface JavaRefactorPlan {
  id: string;
  root: string;
  type: RefactorPlanType;
  title: string;
  createdAt: string;
  blocked: boolean;
  blockedReasons: string[];
  warnings: string[];
  files: JavaRefactorPreviewFile[];
  resources: Array<{ kind: "rename"; oldPath: string; newPath: string }>;
  workspaceEdit: unknown;
  affectedCallSites: RefactorCallSite[];
  buildModelChanges: Array<{
    path: string;
    moduleId: string;
    targetModuleId: string;
    scope: "compile" | "test";
  }>;
  sourceModuleId?: string;
  targetModuleId?: string;
  sourcePath?: string;
  targetPath?: string;
  beforeSignature?: JavaMethodSignature;
  afterSignature?: JavaMethodSignature;
}

export interface UnusedPrivateFinding {
  id: string;
  kind: "class" | "method" | "field";
  name: string;
  path: string;
  moduleId: string | null;
  line: number;
  column: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  confidence: "high" | "low";
  safeDelete: boolean;
  explanation: string;
}

export interface UnusedPrivateAnalysis {
  root: string;
  analysedFiles: number;
  analysedDeclarations: number;
  skippedReflective: number;
  findings: UnusedPrivateFinding[];
  generatedAt: string;
  cached: boolean;
}

export function groupRefactorCallSites(callSites: RefactorCallSite[]) {
  const files = new Map<string, RefactorCallSite[]>();
  for (const site of callSites) {
    const entries = files.get(site.path) || [];
    entries.push(site);
    files.set(site.path, entries);
  }
  return [...files.entries()]
    .map(([path, entries]) => ({
      path,
      name: path.split(/[\\/]/).at(-1) || path,
      entries: [...entries].sort((left, right) => left.line - right.line || left.column - right.column),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function changedLineCount(before: string, after: string) {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  let changed = Math.abs(left.length - right.length);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) changed += 1;
  }
  return changed;
}
