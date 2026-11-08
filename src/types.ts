import type { Locale } from "./i18n";
import type { JavaMethodSignature, JavaRefactorPlan, JavaSignatureParameter, UnusedPrivateAnalysis } from "./language/java-refactor";

import type { EditorFileState } from "./editor/editor-state";

export type ActivityView = "explorer" | "modules" | "search" | "structure" | "hierarchy" | "source" | "tests" | "run" | "build";
/** A TODO/FIXME marker found anywhere in the project. */
export interface ProjectTaskComment {
  path: string;
  name: string;
  line: number;
  column: number;
  kind: string;
  text: string;
}

export type PanelView = "problems" | "todos" | "output" | "build" | "run" | "debug" | "tests" | "terminal" | "tailer" | "http";
/** Tool windows summoned from the narrow rail beside the editor. */
import type { SharedAction } from "./collaboration/shared-session";
import type { KiwiThemeFile } from "./theme-file";
import type { BackgroundAnchor, BackgroundFit } from "./workspace-background";
import type { LineHighlight, RevealMotion } from "./editor-feel";

export type RightToolView = "build" | "dependencies" | "collab";
/** Where a tool window sits. The workbench model in workbench/panel-docks
 * is the authority; this mirrors it for the settings that persist it. */
/** One downloadable Java build, as Adoptium describes it. */
export interface JdkPackage {
  release: string;
  version: string;
  major: number;
  link: string;
  checksum: string;
  size: number;
  name: string;
}

export type PanelDockEdge = "bottom" | "bottom-left" | "bottom-right";
export type JavaAction = "run" | "build" | "test" | "debug";
export type RunConfigurationType = "java" | "junit" | "maven" | "gradle" | "docker" | "compose" | "compound";

export interface FileNode {
  id: string;
  name: string;
  /** Optional Explorer label that does not change the physical file name. */
  displayName?: string;
  /** Java declaration kind detected from the source header for Explorer icons. */
  javaKind?: JavaSourceKind;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  childrenLoaded?: boolean;
  /** Stable Explorer identity when several package folders are shown as one compact node. */
  treeKey?: string;
  /** Physical directories represented by one compact package node. */
  treePaths?: string[];
}

export interface JdkInfo {
  available: boolean;
  version: string;
  major: number;
  path: string;
}

export interface WorkspaceProject {
  root: string;
  /** What to show: the chosen name if there is one, otherwise the folder's. */
  name: string;
  /** Set only when somebody named this project themselves. */
  label?: string;
  addedAt: string;
  lastOpenedAt: string;
  pinned: boolean;
  exists: boolean;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  roots: string[];
  activeRoot: string | null;
  updatedAt: string;
}

export interface WorkspaceState {
  version: number;
  projects: WorkspaceProject[];
  activeRoot: string | null;
  resumableProjects?: WorkspaceProject[];
  profiles?: WorkspaceProfile[];
}

export interface ProjectSession {
  openFiles: string[];
  activePath: string | null;
  splitPath: string | null;
  terminalCwd?: string;
  panel?: PanelView;
  panelVisible?: boolean;
  /** Per-tool-window placement, restored independently for every project. */
  panelViewDocks?: Partial<Record<PanelView, PanelDockEdge>>;
  panelHeight?: number;
  panelWidth?: number;
  cursor?: { line: number; column: number };
}

export interface WorkflowState {
  recentFiles: string[];
  favorites: string[];
  bookmarks: Array<{ id: string; path: string; line: number; label: string }>;
  terminalTasks: Array<{ id: string; name: string; command: string }>;
}

export interface LocalHistoryEntry {
  id: string;
  label: string;
  timestamp: string;
  files: number;
  undone?: boolean;
}

export interface CompletionSettings {
  /** Characters that accept the highlighted suggestion. */
  commitCharacters?: string;
  autoPopup: boolean;
  caseSensitive: boolean;
  insertImports: boolean;
  showDocumentation: boolean;
  prioritizeRecent: boolean;
  liveTemplates: boolean;
  postfixTemplates: boolean;
  /** Finish a statement with its semicolon and a constructor with its (). */
  finishStatements: boolean;
  /** Offer the methods and fields the open file itself declares. */
  localMembers: boolean;
  /** Whether hovering a name explains it. Off leaves errors and quick fixes. */
  hoverDocumentation?: boolean;
}

export interface ModuleDependency {
  moduleId: string;
  scope?: "compile" | "runtime" | "test";
  transitive?: boolean;
}

export interface JpmsDescriptor {
  name: string;
  requires: string[];
  requiresTransitive: string[];
  exports: string[];
  opens: string[];
  uses: string[];
  provides: Array<{ service: string; implementations: string[] }>;
}

export interface ModuleInfo {
  id: string;
  name: string;
  root: string;
  projectRoot: string;
  relativePath: string;
  buildSystem: ProjectInfo["type"];
  sourceRoots: string[];
  testRoots: string[];
  resourceRoots: string[];
  testResourceRoots: string[];
  outputPath: string;
  dependencies: string[];
  jdkPath: string;
  languageLevel: string;
  descriptorPath: string | null;
  jpms: JpmsDescriptor | null;
}

export interface ModuleSpec {
  name: string;
  relativePath?: string;
  packageName?: string;
  jdkPath?: string;
  languageLevel?: string;
  dependencies?: string[];
  jpms?: false | Partial<JpmsDescriptor>;
  /** Move the project's own src/ into the new module. */
  adoptRootSources?: boolean;
  /** false skips the placeholder class in a new module. */
  sampleClass?: boolean;
}

export interface ModuleChangePlan {
  id: string;
  root: string;
  action: "create" | "detach" | "update";
  /** Consequences the user should know about before the plan is applied. */
  warnings?: string[];
  module: Partial<ModuleInfo> & { name: string };
  createdAt: string;
  files: Array<{ path: string; before: string | null; after: string; beforeHash: string }>;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  /**
   * The text the application last put into the editor.
   *
   * Not what the editor holds — that is the editor's own, and typing changes
   * it many times a second. This changes only when Kiwi itself replaces the
   * text: opening, restoring a session, reloading after a replace, renaming.
   *
   * It exists because the editor is given its value as a prop, and the wrapper
   * compares that prop against the whole document on every render. Feeding
   * typing back in made every keystroke serialise the entire file, so the cost
   * of typing grew with the file: ten milliseconds a character at two lines,
   * seventy-eight at twenty thousand.
   */
  externalContent?: string;
  language: string;
  pinned?: boolean;
  preview?: boolean;
  /**
   * The buffer cannot be written to.
   *
   * A class from a jar has no file to save into, and a decompiled body is not
   * the source anybody wrote. Set once when the tab is opened.
   */
  readOnly?: boolean;
  /** Where a read-only buffer came from, for the tab and the editor.  */
  origin?: string;
  /**
   * The file is no longer on disk, while this buffer still holds its content.
   *
   * Deleting a file from outside left a tab that looked exactly like a saved
   * one: same name, no marker, nothing to say the file it stands for is gone.
   * Marked instead of closed, because closing it would be the one thing that
   * actually loses the text — saving puts the file back.
   */
  missing?: boolean;
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  replacement?: string;
}

export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  /** End of the offending range, when the reporter knows it. */
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
  /** Who reported it — the build tool, the language server or the syntax pass. */
  source?: string;
  message: string;
}

export interface ProcessOutput {
  stream: "stdout" | "stderr" | "input" | "pty";
  /** Which terminal produced it; absent for build and run output. */
  sessionId?: string;
  text: string;
  projectRoot?: string;
  /** Current working directory for interactive terminal output. */
  cwd?: string;
  moduleId?: string;
  operationId?: string;
}

export interface TerminalSessionSnapshot {
  projectRoot: string;
  sessionId: string;
  cwd: string;
  shell: string;
  running: boolean;
  output: string;
  columns: number;
  rows: number;
}

export interface TerminalWindowState {
  projectRoot: string;
  sessionId: string;
  open: boolean;
}

export type ProjectLanguage = "java" | "kotlin" | "python" | "rust" | "php" | "lua" | "go" | "c" | "cpp" | "csharp" | "objective-c" | "objective-cpp" | "typescript" | "javascript" | "node" | "dart" | "zig" | "swift" | "ruby" | "elixir" | "r" | "scala" | "shell" | "powershell" | "perl" | "gdscript" | "sql" | "terraform" | "assembly" | "autohotkey" | "odin";

export interface ProjectInfo {
  type: "Java" | "Maven" | "Gradle" | "Kotlin" | "Python" | "Rust" | "PHP" | "Lua" | "Go" | "C" | "C++" | "C#" | "Objective-C" | "Objective-C++" | "TypeScript" | "JavaScript" | "Node.js" | "Dart" | "Flutter" | "Zig" | "Swift" | "Ruby" | "Elixir" | "R" | "Scala" | "Shell" | "PowerShell" | "Perl" | "GDScript" | "SQL" | "Terraform" | "Assembly" | "AutoHotkey" | "Odin";
  language?: ProjectLanguage;
  buildFile: string | null;
  javaVersion: string;
  jdkPath?: string;
  projectJdkPath?: string;
  jdkMajor?: number;
  languageServerReady?: boolean;
  hasWrapper?: boolean;
  languageLevel?: string;
  encoding?: string;
  compilerArgs?: string;
  mavenOffline?: boolean;
  gradleOffline?: boolean;
  previewFeatures?: boolean;
  autoSyncBuild?: boolean;
  preferWrapper?: boolean;
  parallelBuilds?: boolean;
  cleanBeforeTest?: boolean;
  excludedPaths?: string[];
  excludedLibraries?: string[];
  buildProfiles?: string[];
  projectSettings?: ProjectSettings;
}

export interface ProjectSettings {
  jdkPath: string;
  languageLevel: string;
  encoding: string;
  compilerArgs: string;
  mavenOffline: boolean;
  gradleOffline: boolean;
  annotationProcessing: boolean;
  generatedSources: boolean;
  lombokSupport: boolean;
  unusedAnalysis: boolean;
  previewFeatures: boolean;
  autoSyncBuild: boolean;
  preferWrapper: boolean;
  parallelBuilds: boolean;
  cleanBeforeTest: boolean;
  excludedPaths: string[];
  excludedLibraries: string[];
  /** Maven profiles or Gradle project properties the build runs with. */
  buildProfiles: string[];
  /**
   * This project's own editor font and fallbacks.
   *
   * A project full of box-drawing characters or a language with its own script
   * wants a face the rest of the work does not. Empty follows the global font.
   */
  fontFamily: string;
  fontFallbacks: string;
  /**
   * This project's own picture, when it should not be the global one.
   *
   * Only the image: somebody who set a photograph for one project did not mean
   * to reset its blur, so everything else still comes from the global
   * settings.
   */
  backgroundImage: string;
}

export interface ProjectSpec {
  type: ProjectInfo["type"];
  language?: ProjectLanguage;
  location: string;
  name: string;
  groupId: string;
  artifactId: string;
  packageName: string;
  jdkPath?: string;
  languageLevel?: string;
  template?: string;
  /** false leaves the source folders empty instead of writing a sample class. */
  sampleClass?: boolean;
  initGit?: boolean;
  createReadme?: boolean;
  includeTests?: boolean;
  description?: string;
}

/** A Maven profile or the Gradle project property that stands in for one. */
export interface BuildProfile {
  id: string;
  active: boolean;
  description: string;
}

export interface ProjectTask {
  name: string;
  description: string;
  group?: string;
}

/** One artifact as Maven Central reports it. */
export interface DependencyCandidate {
  groupId: string;
  artifactId: string;
  version: string;
  packaging: string;
  updatedAt: number;
}

export interface DependencyAudit {
  type: ProjectInfo["type"];
  dependencies: Array<{ coordinate: string; version: string }>;
  warnings: Array<{ coordinate: string; version: string; message: string }>;
  unusedTask: string;
  updatesTask: string;
  securityTask: string;
}

export interface DependencyNode {
  id: string;
  coordinate: string;
  group: string;
  artifact: string;
  version: string;
  requestedVersion?: string;
  scope?: string;
  conflict?: boolean;
  omitted?: boolean;
  sourcePath?: string;
  javadocPath?: string;
  children: DependencyNode[];
}

export interface DependencyTree {
  type: ProjectInfo["type"];
  configurations: Array<{ name: string; description?: string; nodes: DependencyNode[] }>;
  conflicts: Array<{ coordinate: string; requested: string; selected: string }>;
  raw: string;
}

export interface RunConfiguration {
  id?: string;
  name: string;
  type: RunConfigurationType;
  mainClass?: string;
  target?: string;
  programArgs?: string;
  vmArgs?: string;
  workingDirectory?: string;
  jdkPath?: string;
  projectRoot?: string;
  moduleId?: string;
  env?: Record<string, string>;
  favorite?: boolean;
  group?: string;
  /**
   * The configurations a compound starts, in order.
   *
   * Only for the "compound" type. A compound may name another compound; what
   * runs in the end is the flattened list.
   */
  members?: Array<{ id: string }>;
  /** Whether a compound's members wait for one another. */
  compoundMode?: "sequential" | "parallel";
}

export interface GitHubSession {
  signedIn: boolean;
  login: string;
  name: string;
  avatarUrl: string;
  scopes: string[];
  tokenType: "classic" | "fine-grained" | "oauth" | "";
  encryptionAvailable: boolean;
  deviceFlowAvailable: boolean;
}

export interface GitFileStatus {
  path: string;
  absolutePath: string;
  index: string;
  workingTree: string;
  staged: boolean;
  conflict: boolean;
}

export interface GitStatus {
  available: boolean;
  output: string;
  branch?: string;
  branchLine?: string;
  files?: GitFileStatus[];
}

export interface GitBranch {
  current: boolean;
  name: string;
  upstream: string;
  /** Set when the branch exists only on a remote and has no local copy yet. */
  remote?: string;
}

export interface GitTag {
  name: string;
  hash: string;
  subject: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitComparison {
  base: string;
  head: string;
  leftOnly: number;
  rightOnly: number;
  commits: string[];
  stat: string;
  patch: string;
}

export interface GitHunk {
  index: number;
  header: string;
  preview: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  staged: boolean;
  changes: Array<{ id: string; kind: "add" | "remove" | "replace"; before: string; after: string; indexes: number[] }>;
}

export type GitMergeChoice = "ours" | "base" | "theirs" | "both" | "custom" | "lines";

export interface GitMergeResolvedChunk {
  kind: "resolved";
  content: string;
}

export interface GitMergeConflictChunk {
  kind: "conflict";
  id: string;
  base: string;
  ours: string;
  theirs: string;
  baseLines: string[];
  oursLines: string[];
  theirsLines: string[];
}

export interface GitMergeModel {
  path: string;
  snapshot: string;
  chunks: Array<GitMergeResolvedChunk | GitMergeConflictChunk>;
}

export interface GitMergeResolution {
  id: string;
  choice: GitMergeChoice;
  content?: string;
  lines?: Array<{ source: "ours" | "base" | "theirs"; index: number }>;
}

export type GitRebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

export interface GitRebaseEntry {
  action: GitRebaseAction;
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  message: string;
}

export interface GitRebasePlan {
  upstream: string;
  head: string;
  commits: GitRebaseEntry[];
}

export interface GitRebaseState {
  active: boolean;
  headName?: string;
  onto?: string;
  stoppedSha?: string;
  message?: string;
  todo: Array<Pick<GitRebaseEntry, "action" | "hash" | "subject">>;
  done: Array<Pick<GitRebaseEntry, "action" | "hash" | "subject">>;
  conflicts?: string[];
}

export interface GitCommitCheckSettings {
  build: boolean;
  tests: boolean;
  format: boolean;
  failOnSkipped: boolean;
}

export interface GitCommitCheckPlanItem {
  id: "build" | "tests" | "format";
  label: string;
  command: string;
  args: string[];
  reason: string;
}

export interface GitCommitCheckResult extends GitCommitCheckPlanItem {
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  output: string;
}

export interface GitPullRequest {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  url: string;
  author: string;
  avatarUrl: string;
  createdAt: string;
  updatedAt: string;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: number;
}

export interface TestMethod {
  id: string;
  name: string;
  displayName?: string;
  kind?: "test" | "parameterized" | "repeated" | "dynamic" | "template";
  nestedClass?: string;
  status: string;
}

export interface TestSuite {
  id: string;
  name: string;
  packageName: string;
  moduleId?: string;
  nested?: boolean;
  file: string;
  /**
   * The types this test names.
   *
   * Worked out where the file is already being read, so deciding which tests a
   * change can have broken does not mean reading every test file again.
   */
  references?: string[];
  methods: TestMethod[];
  status: string;
}

export interface TestReport {
  name: string;
  moduleId?: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  cases: Array<{
    name: string;
    className: string;
    time: number;
    status: "passed" | "failed" | "skipped";
    message: string;
    details: string;
  }>;
}

export interface TestHistoryRun {
  id: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  cases: Array<{
    id: string;
    moduleId?: string;
    className: string;
    name: string;
    status: "passed" | "failed" | "skipped";
    time: number;
    message?: string;
  }>;
}

export interface FlakyTest {
  id: string;
  className: string;
  name: string;
  passes: number;
  failures: number;
  skipped: number;
  lastStatus: "passed" | "failed" | "skipped";
}

export interface CoverageFile {
  path: string;
  lines: Array<{
    line: number;
    covered: boolean;
    coveredInstructions: number;
    missedInstructions: number;
    /** Branches on this line that were taken, and those that were not. */
    coveredBranches?: number;
    missedBranches?: number;
  }>;
  summary?: {
    packageName: string;
    className: string;
    coveredLines: number;
    missedLines: number;
    coveredBranches?: number;
    missedBranches?: number;
    /** Whole percent, or -1 where the file has no decisions in it at all. */
    branchPercentage?: number;
    methods: Array<{ name: string; descriptor?: string; covered: number; missed: number; percentage: number }>;
  };
}

export interface DebugBreakpoint {
  type?: "line" | "exception" | "field" | "method";
  className: string;
  /**
   * The file this breakpoint is in, when it is known.
   *
   * The class name is what the debugger works with, but it is derived from
   * the file name and the package declaration, so two files called
   * Beta.java without a package share one. The path is what makes two
   * breakpoints in two files two breakpoints.
   */
  path?: string;
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  caught?: boolean;
  uncaught?: boolean;
  /**
   * The field a `field` breakpoint watches.
   *
   * It answers the question a line breakpoint cannot: not "where does this
   * run" but "who put that value there", when the write is in a class nobody
   * suspected.
   */
  fieldName?: string;
  /** Stop when the field is written. The default, and the useful one. */
  onWrite?: boolean;
  /** Stop when it is only read. Loud, so it is off unless asked for. */
  onRead?: boolean;
  /** The method a `method` breakpoint stops on, in every overload. */
  methodName?: string;
  onEntry?: boolean;
  /** Stop on return, which is how the return value becomes visible. */
  onExit?: boolean;
  enabled?: boolean;
}

/** What came back from a request in a `.http` file. */
export interface HttpResponseResult {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  durationMs: number;
  bytes: number;
  truncated: boolean;
  contentType: string;
  /** Credentials are already masked here — see the service that builds it. */
  headers: Array<{ name: string; value: string }>;
  body: string;
  request: { method: string; url: string; headers: Array<{ name: string; value: string }> };
}

/**
 * Everything a detached tool window has to draw.
 *
 * The workbench stays the single source of this data — it is the window that
 * runs the language server, the build and the debugger — and publishes a
 * snapshot whenever what the panel shows changes. The detached window renders
 * it and sends its clicks back as commands, so both windows always agree
 * without a second copy of the workbench logic.
 */
export interface PanelWindowSnapshot {
  projectRoot: string;
  projectName: string;
  view: PanelView;
  tabs: Array<{ id: PanelView; label: string }>;
  running: boolean;
  theme: string;
  /** Full appearance settings keep a detached tool window visually identical. */
  settings: IdeSettings;
  /** Corner roundness, so the detached window matches the workbench. */
  roundness: number;
  problems: {
    filter: string;
    counts: { all: number; error: number; warning: number; info: number };
    groups: Array<{ file: string; name: string; relative: string; items: Diagnostic[] }>;
  };
  todos: Array<{ path: string; name: string; line: number; column: number; kind: string; text: string }>;
  output: { kind: "build" | "run" | "output"; text: string; exitCode: number | null };
  debug: {
    status: string;
    output: string;
    variables: DebugVariable[];
    threads: DebugThread[];
    frames: DebugStackFrame[];
    watches: Array<{ expression: string; value: string }>;
  };
  tests: TestReport[];
  http: Array<{ id: string; method: string; url: string; status: number; statusText: string; durationMs: number; body: string }>;
  terminal: { sessions: string[]; active: string; output: string };
}

/** A click in the detached tool window, executed by the workbench. */
export type PanelWindowCommand =
  | { type: "selectView"; view: PanelView }
  | { type: "selectDiagnostic"; path: string; line: number; column: number; endLine?: number; endColumn?: number }
  | { type: "setDiagnosticFilter"; filter: string }
  | { type: "openTodo"; path: string; line: number; column: number }
  | { type: "clear" }
  | { type: "stopProcess" }
  | { type: "debugCommand"; command: string; argument?: string }
  | { type: "selectThread"; threadId: number }
  | { type: "selectFrame"; frameId: number }
  | { type: "expandVariable"; referenceId: number }
  | { type: "runTest"; report: string; testCase?: string }
  | { type: "terminalInput"; sessionId: string; text: string }
  | { type: "selectTerminal"; sessionId: string }
  | { type: "attach" };

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  referenceId?: number;
  hasChildren?: boolean;
}

export interface DebugStackFrame {
  id: number;
  threadId: number;
  className: string;
  methodName: string;
  sourceName: string;
  line: number;
}

export interface DebugThread {
  id: number;
  name: string;
  status: number;
  suspended: boolean;
  selected: boolean;
}

/** Where downloaded JDKs land: the folder in use, Kiwi's own, and which. */
export interface JdkInstallRoot {
  root: string;
  standard: string;
  eigener: boolean;
}

export interface IdeSettings {
  languageServers: Record<string, LanguageServerConfiguration>;
  schemaVersion: number;
  jdkPath: string;
  /** Folder downloads land in; empty means Kiwi's own under the profile. */
  jdkInstallRoot: string;
  theme: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  insertSpaces: boolean;
  minimap: boolean;
  wordWrap: boolean;
  autoSave: boolean;
  formatOnSave: boolean;
  organizeImportsOnSave: boolean;
  formatKeepsWhitespace: boolean;
  completionCommitCharacters: string;
  completionCommitOnEnter: boolean;
  /**
   * Which modifier turns a click into "go to definition".
   *
   * The other one selects an additional cursor, so the two are exclusive and
   * this picks between them rather than setting each.
   */
  gotoDefinitionModifier: "ctrl" | "alt";
  stickyScroll: boolean;
  /** Whether the line the caret is on is filled in. */
  highlightActiveLine: boolean;
  bracketPairColorization: boolean;
  /**
   * Whether the angle brackets of nested generics are coloured too.
   *
   * Monaco leaves them alone for a good reason — in Java an angle bracket is a
   * comparison as often as it is a type argument — so this is its own switch.
   */
  genericBracketColorization: boolean;
  inlayHints: boolean;
  /** The documentation bubble on hovering a name. Errors show either way. */
  hoverDocumentation: boolean;
  /** Ranking used for automatic suggestions; Ctrl+Space still overrides it. */
  completionMode: "basic" | "smart";
  terminalFontSize: number;
  restoreSession: boolean;
  compactMode: boolean;
  uiScale: number;
  uiDensity: "compact" | "normal" | "comfortable";
  /** How round the workbench is, as a percentage of the designed radii. */
  uiRoundness: number;
  /** Nudge on top of the picked theme: lighter or darker, and toward the accent. */
  themeShade: number;
  themeTint: number;
  /** Extra separation between surfaces and text, without replacing the theme. */
  themeContrast: number;
  /** Strength of accent-tinted selection and active surfaces, in percent. */
  accentIntensity: number;
  /** Per-surface workbench and editor colour overrides (six-digit hex). */
  themeColorOverrides: Record<string, string>;
  /**
   * Themes somebody saved, imported or duplicated.
   *
   * Kept whole rather than as a diff against a built-in one, so a theme
   * survives the built-in it came from being changed in a later version.
   */
  customThemes: KiwiThemeFile[];
  /**
   * Whether the theme changes by itself, and by what.
   *
   * "system" follows Windows; "time" follows the clock, because the light in a
   * room does not ask the operating system.
   */
  themeSchedule: "off" | "system" | "time";
  /** Which theme stands for day and which for night, by id or custom name. */
  themeDay: string;
  themeNight: string;
  /** When each begins, as minutes after midnight. May wrap past midnight. */
  themeDayStart: number;
  themeNightStart: number;
  /** How strongly panels are separated, and how deep menus and dialogs cast. */
  borderStrength: number;
  shadowStrength: number;
  /** Font of the interface itself, independent of the editor font. */
  uiFont: string;
  accentColor: string;
  backgroundImage: string;
  backgroundOpacity: number;
  /**
   * More images, shown in turn, and how often they change.
   *
   * Empty is the single image above, which is what somebody who never opened
   * this expects.
   */
  backgroundPlaylist: string[];
  backgroundRotateSeconds: number;
  /**
   * Per-surface strength. -1 follows the overall one, so an untouched setting
   * is one slider rather than four that have to be kept in step by hand.
   */
  backgroundEditorOpacity: number;
  backgroundExplorerOpacity: number;
  backgroundTerminalOpacity: number;
  /** Where the picture sits, how it is scaled, and how soft it is. */
  backgroundAnchor: BackgroundAnchor;
  backgroundFit: BackgroundFit;
  backgroundScale: number;
  backgroundBlur: number;
  /** A wash of the accent colour over the image. */
  backgroundTint: number;
  /** Pixels of drift per thousand scrolled. Deliberately a small number. */
  backgroundParallax: number;
  /** What the strength is multiplied by in focus mode, in percent. */
  backgroundFocusStrength: number;
  /** Whether a moving image may play at all. Off, because it costs battery. */
  backgroundAllowAnimation: boolean;
  reducedMotion: boolean;
  explorerIconSize: number;
  explorerIndent: number;
  fontLigatures: boolean;
  lineNumbers: boolean;
  renderWhitespace: "none" | "selection" | "all";
  breadcrumbs: boolean;
  javaTabSize: number;
  xmlTabSize: number;
  gradleTabSize: number;
  startupBehavior: "restore" | "hub";
  completionAutoPopup: boolean;
  completionDelay: number;
  completionCaseSensitive: boolean;
  completionInsertImports: boolean;
  completionShowDocumentation: boolean;
  completionPrioritizeRecent: boolean;
  completionLiveTemplates: boolean;
  completionPostfixTemplates: boolean;
  completionFinishStatements: boolean;
  completionLocalMembers: boolean;
  completionShowMethods: boolean;
  completionShowFields: boolean;
  completionShowTypes: boolean;
  completionShowSnippets: boolean;
  explorerView: "folders" | "packages";
  compactPackages: boolean;
  explorerHideBuild: boolean;
  explorerHideDotDirectories: boolean;
  explorerHideGenerated: boolean;
  explorerExcludedPatterns: string[];
  /** Workbench language. The list of them lives in i18n, so it stays one list. */
  locale: Locale;
  /** Preset syntax palette, or "theme" to follow the active theme. */
  editorColorScheme: string;
  /** Per-token syntax colours, including `javaKeyword:<word>`, without a leading #. */
  editorTokenColors: Record<string, string>;
  explorerCollapseModulesWithProject: boolean;
  explorerHideFileExtensions: boolean;
  panelDock: PanelDockEdge;
  panelViewDocks: Partial<Record<PanelView, PanelDockEdge>>;
  explorerOpenMode: "single" | "double";
  explorerPreviewTabs: boolean;
  restoreExplorerState: boolean;
  openConsoleOnRun: boolean;
  inlineDebugValues: boolean;
  /** Recompile and redefine a changed Java class after saving during Debug. */
  hotSwapOnSave: boolean;
  breakOnExceptions: "none" | "uncaught" | "all";
  runEnvironmentTemplate: string;
  preserveConsoleOutput: boolean;
  rerunFailedTests: boolean;
  keymap: "kiwi" | "intellij" | "eclipse";
  customKeybindings: Record<string, string>;
  toolbarActions: string[];
  automaticUpdates: boolean;
  /**
   * Which releases this installation is offered.
   *
   * Canary is beta's faster sibling: the same prereleases, sooner, with no
   * promise that any of them lasts.
   */
  updateChannel: "stable" | "beta" | "canary";
  updateManifestUrl: string;
  githubClientId: string;
  cursorStyle: "line" | "block" | "underline";
  cursorBlinking: "blink" | "smooth" | "phase" | "expand" | "solid";
  /**
   * How the editor feels rather than what it does.
   *
   * None of this changes what the editor can do; all of it changes whether a
   * day in it is tiring.
   */
  cursorBlinkMs: number;
  cursorAnimation: boolean;
  smoothScrolling: boolean;
  /** Whether going somewhere else in the file glides or jumps. */
  revealMotion: RevealMotion;
  /** What the caret's line gets: nothing, the line, its number, or both. */
  lineHighlight: LineHighlight;
  /** Faces for the two things read differently from code. Empty follows it. */
  commentFont: string;
  inlayFont: string;
  /** Inlay hint size against the code size, in percent. */
  inlayFontScale: number;
  /** OpenType features, or "on"/"off". A string is what makes "arrows but not equals" possible. */
  ligatures: string;
  /** Faces to fall back to when the first has no glyph for a character. */
  fontFallbacks: string;
  minimapOpacity: number;
  /** How wide the text may get in focus mode, in characters. 0 leaves it alone. */
  focusMaxWidth: number;
  stickyEmphasis: number;
  breadcrumbEmphasis: number;
  indentGuides: boolean;
  sidebarPosition: "left" | "right";
  rightRailOrder: string[];
  rightRailHidden: string[];
  activityOrder: string[];
  activityHidden: string[];
  proxyUrl: string;
  proxyBypass: string;
  extraCertificates: string[];
  collabDisplayName: string;
  /**
   * What Discord is told about this session.
   *
   * Off until switched on, and inert without an application id from Discord's
   * developer portal. Each line of the card has its own switch, because a
   * project name and a file name are the two things somebody might not want
   * their whole friend list reading.
   */
  discordRichPresence: boolean;
  discordApplicationId: string;
  discordPublicKey?: string;
  discordShowProject: boolean;
  discordShowFile: boolean;
  discordShowElapsed: boolean;
  discordState?: string;
  discordDetails?: string;
  discordLargeImageKey?: string;
  discordLargeImageText?: string;
  discordSmallImageKey?: string;
  discordSmallImageText?: string;
  discordPartyId?: string;
  discordPartySize?: number;
  discordPartyMax?: number;
  discordJoinSecret?: string;
  crashReporting: boolean;
  screenReaderMode: boolean;
  enhancedFocus: boolean;
  recentProjects: string[];
  lastWorkspace: string;
  workspaceHistoryMigrated: boolean;
}

/**
 * The Discord card as the main process would send it.
 *
 * Shown in the settings instead of a mock-up: what Kiwi shares about somebody
 * is not a thing to approximate in a second place.
 */
export interface DiscordPresencePreview {
  activity: {
    details?: string;
    state?: string;
    timestamps?: { start: number };
    assets: { large_image: string; large_text: string; small_image?: string; small_text?: string };
    party?: { id: string; size: [number, number] };
    secrets?: { join?: string };
  };
  /** Whether Discord is actually running and has accepted the handshake. */
  connected: boolean;
  /** Whether it is switched on and has an application id at all. */
  configured: boolean;
  /** Why Discord refused, when it said so — a mistyped id, above all. */
  rejection: { code: number; message: string } | null;
}

/** One advisory against one declared dependency. */
export interface VulnerabilityFinding {
  /** The CVE number when there is one, the advisory's own id otherwise. */
  id: string;
  osvId: string;
  /** `groupId:artifactId`, as declared. */
  dependency: string;
  version: string;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  summary: string;
  /** Versions the advisory names as fixed, for this artefact. */
  fixedIn: string[];
  url: string;
}

/**
 * The result of asking osv.dev about a project's dependencies.
 *
 * Coverage distinguishes a complete clean scan from skipped versions or a
 * partial response. Known findings remain useful even in a partial report.
 */
export interface VulnerabilityReport {
  /** At least one dependency received a complete answer. */
  checked: boolean;
  complete: boolean;
  reachable: boolean;
  totalDependencies: number;
  checkedDependencies: number;
  /** Coordinates without a concrete version that OSV can check. */
  skippedDependencies: number;
  scannedAt: number;
  findings: VulnerabilityFinding[];
}

/** Where a project's built artefact goes, and what to run once it is there. */
export interface DeployTarget {
  host: string;
  user: string;
  port: number;
  /** The jar, relative to the project. The last segment may contain `*`. */
  artifact: string;
  /** An absolute path on the server. */
  remoteDirectory: string;
  /** One line, run over ssh after the upload. Empty means copy and stop. */
  restartCommand: string;
}

/** Whether a deployment could start, and what is in the way if it could not. */
export interface DeployCheck {
  ready: boolean;
  problem: string;
  target: DeployTarget;
  /** The file that would be sent, once it has been found. */
  artifact?: string;
}

export interface DeployResult {
  ok: boolean;
  problem: string;
  restarted?: boolean;
  /** True when the jar arrived but the restart did not work — new file, old process. */
  uploaded?: boolean;
}

export interface UpdateCheckResult {
  configured: boolean;
  available: boolean;
  currentVersion: string;
  version?: string;
  downloadUrl?: string;
  sha256?: string;
  bytes?: number;
  /** Opaque main-process approval. It prevents renderer-supplied executables. */
  approvalId?: string;
  releaseNotes?: string;
  source?: "github";
  releaseUrl?: string;
  channel?: string;
  publishedAt?: string;
  reason?: string;
  artifactKind?: "setup" | "portable" | "renderer" | "appimage" | "dmg";
  filename?: string;
  /** Fingerprint a renderer bundle must match to be applied without a restart. */
  mainHash?: string;
}

export type UpdateRuntimeStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "preparing"
  | "installing"
  | "restarting"
  | "installed"
  | "error";

export interface UpdateRuntimeState {
  status: UpdateRuntimeStatus;
  currentVersion: string;
  version?: string;
  bytes?: number;
  operation?: "check" | "download" | "install";
  reason?: string;
  updatedAt: string;
}

export interface DownloadedUpdate {
  path: string;
  sha256: string;
  bytes: number;
  version: string;
  artifactKind?: UpdateCheckResult["artifactKind"];
  cached?: boolean;
  relaunching?: boolean;
  /** True when the update was applied to the running Kiwi. */
  restartFree?: boolean;
  /** False when the applied update waits for the next start, e.g. while debugging. */
  reloaded?: boolean;
}

export type DependencyVersionSource = "literal" | "property" | "management" | "catalog" | "missing";

/** A directly declared or dependency-management entry and the source that owns its version. */
export interface EditableDependency {
  id: string;
  ecosystem: "maven" | "gradle";
  groupId: string;
  artifactId: string;
  coordinate: string;
  version: string;
  declaredVersion: string;
  editableVersion: boolean;
  versionSource: DependencyVersionSource;
  versionKey?: string;
  scope: string;
  configuration: string;
  managed: boolean;
  direct: boolean;
  buildFile: string;
  sourceFile: string;
  managedBy?: string;
  catalogAlias?: string;
  catalogName?: string;
  catalogPath?: string;
}

export interface VersionCatalogInfo {
  name: string;
  path: string;
  versions: Array<{ key: string; version: string; editable: boolean }>;
  libraries: Array<{
    alias: string;
    groupId: string;
    artifactId: string;
    version: string;
    declaredVersion: string;
    versionKey?: string;
  }>;
}

export interface DependencyEditorModel {
  type: "Maven" | "Gradle";
  buildFiles: string[];
  dependencies: EditableDependency[];
  catalogs: VersionCatalogInfo[];
}

export interface DependencySelector {
  id?: string;
  groupId?: string;
  artifactId?: string;
  buildFile?: string;
  configuration?: string;
  managed?: boolean;
  catalogAlias?: string;
  /** Also remove the library alias after removing its use from the build script. */
  removeCatalogEntry?: boolean;
}

export interface AddDependencyOptions {
  buildFile?: string;
  useVersionCatalog?: boolean;
  catalogPath?: string;
  alias?: string;
  versionKey?: string;
}

export interface DependencyMutationResult {
  file: string;
  files: string[];
  changed: boolean;
  added?: boolean;
  removed?: boolean;
  updated?: boolean;
  managed?: boolean;
  reason?: string;
  catalogAlias?: string;
  versionKey?: string;
}

export type JavaSourceKind = "class" | "interface" | "enum" | "record" | "annotation" | "exception" | "junit";

export interface JavaTypeOptions {
  isPublic: boolean;
  modifier: "" | "abstract" | "final";
  extendsType: string;
  interfaces: string[];
}

/** One person taking part in a CodeToGetter session. */
export interface CollabPeer {
  id: number;
  name: string;
  /** What this guest may do. Granted by the host, enforced by the host. */
  role: CollabRole;
  /**
   * Each thing separately.
   *
   * The role knows two words and there are six of these; a guest who may start
   * a build on the host's machine is not described by either word.
   */
  permissions?: string[];
  /** Where the guest connected from. The only part of them the host did not let them choose. */
  address?: string;
  /** When they joined, so a host can tell a long session from a new arrival. */
  since?: number;
}

/**
 * Reading, or reading and changing.
 *
 * Reading is the default, because a host who forgets to decide has shared
 * a project nobody can change — which is recoverable, unlike the opposite.
 */
export type CollabRole = "lesen" | "bearbeiten";

/**
 * One change to a shared file, as offsets into the text.
 *
 * Offsets rather than line and column: a line number stops meaning anything
 * the moment the other person inserts a line above it, and every rule for
 * moving one edit over another is written in offsets.
 */
export interface CollabEdit {
  start: number;
  end: number;
  text: string;
}

/** One entry of the tree a guest is shown. */
export interface CollabTreeEntry {
  path: string;
  directory: boolean;
}

/** What a host gets back when it opens a session. */
/**
 * Whether a session can be reached from outside the host's own network.
 *
 * When the router refuses, the numbers it refused with are what a manual
 * forwarding rule needs — so they are carried here rather than dropped, and
 * a refusal becomes a next step instead of a dead end.
 */
export interface CollabReachability {
  /** False when the host only ever asked for the local network. */
  requested: boolean;
  opened?: boolean;
  /** "NAT-PMP" or "UPnP", when one of them worked. */
  protocol?: string;
  address?: string;
  externalPort?: number;
  port?: number;
  localAddress?: string;
  gateway?: string;
  reason?: string;
}

export interface CollabSession {
  port: number;
  token: string;
  addresses: string[];
  project: string;
  invite: string;
  publicAccess?: CollabReachability;
  /** Set when the session is reached through a relay rather than directly. */
  relay?: { host: string; port: number } | null;
}
export interface LanguageServerConfiguration {
  enabled: boolean;
  command: string;
  args: string[];
}

export interface LanguageServerStatus {
  languageId: string;
  name: string;
  serverId: string;
  serverName: string;
  command: string;
  args: string[];
  enabled: boolean;
  available: boolean;
  status: string;
  reason?: string;
  root?: string;
  capabilities?: any;
  docsUrl?: string;
  installHint?: string;
}

export interface KiwiApi {
  polyglot: {
    status(root?: string): Promise<LanguageServerStatus[]>;
    open(payload: { root: string; file: string; text: string; languageId: string }): Promise<{ available: boolean; status: string; reason?: string; capabilities?: any }>;
    change(payload: { root: string; file: string; text: string; languageId?: string }): Promise<boolean>;
    save(payload: { root: string; file: string; text: string; languageId?: string }): Promise<boolean>;
    close(payload: { root: string; file: string; languageId?: string }): Promise<boolean>;
    request(payload: { root: string; file: string; languageId: string; method: string; params: any; requestId?: string }): Promise<any>;
    cancel(requestId: string): Promise<boolean>;
    stop(root?: string): Promise<boolean>;
    install(languageId: string): Promise<{ installed: boolean; reason?: string }>;
    installAll(): Promise<{ total: number; installed: number; results: Record<string, { installed: boolean; reason?: string }> }>;
    plan(payload: { root: string; file?: string; action: string; language?: ProjectLanguage }): Promise<any>;
    execute(payload: { root: string; file?: string; action: string; language?: ProjectLanguage }): Promise<{ started: boolean; root: string; language: ProjectLanguage; action: string; command?: string; operationId?: string }>;
    stopRun(root?: string): Promise<boolean>;
    onDiagnostics(callback: (payload: { root: string; languageId: string; uri: string; diagnostics: any[]; version?: number }) => void): () => void;
    onStatus(callback: (payload: { root: string; languageId: string; status: string; available: boolean; reason?: string; capabilities?: any }) => void): () => void;
    onLog(callback: (payload: { root?: string; languageId?: string; text: string }) => void): () => void;
    onOutput(callback: (payload: { root: string; text: string; stream: string; operationId?: string }) => void): () => void;
    onExit(callback: (payload: { root: string; code: number; action: string; operationId?: string }) => void): () => void;
  };
  platform: string;
  workspace: {
    open(): Promise<string | null>;
    register(root: string): Promise<string | null>;
    restore(): Promise<string | null>;
    openMany(): Promise<WorkspaceState>;
    add(roots: string | string[]): Promise<WorkspaceState>;
    list(): Promise<WorkspaceState>;
    /**
     * The open tabs and their drafts, written where a killed process cannot
     * lose them. Local storage is flushed on Chromium's schedule; this is not.
     */
    saveSession(root: string, session: unknown): Promise<{ saved: boolean; file: string }>;
    loadSession(root: string): Promise<Record<string, unknown> | null>;
    clearSession(root: string): Promise<{ cleared: boolean }>;
    /**
     * Where each file of a project was last left.
     *
     * Apart from the session, which is what is open: a file that was
     * closed keeps its place here, and reopening it lands there again.
     */
    saveEditorStates(root: string, states: EditorFileState[]): Promise<{ saved: boolean; file: string }>;
    loadEditorStates(root: string): Promise<EditorFileState[]>;
    recoverRecent(roots: string[]): Promise<WorkspaceState>;
    activate(root: string): Promise<WorkspaceState>;
    remove(root: string): Promise<WorkspaceState>;
    restoreState(): Promise<WorkspaceState>;
    closeAll(): Promise<WorkspaceState>;
    setPinned(root: string, pinned: boolean): Promise<WorkspaceState>;
    /** A name of one's own for a project; an empty one hands the folder's name back. */
    rename(root: string, name: string): Promise<WorkspaceState>;
    saveProfile(name: string): Promise<WorkspaceState>;
    openProfile(id: string): Promise<WorkspaceState>;
    deleteProfile(id: string): Promise<WorkspaceState>;
    tree(root: string): Promise<FileNode[]>;
    children(root: string, directory: string): Promise<FileNode[]>;
    search(root: string, query: string, options?: SearchOptions): Promise<SearchMatch[]>;
    taskComments(root: string): Promise<ProjectTaskComment[]>;
    validateProject(root: string): Promise<Diagnostic[]>;
    validateBuffer(root: string, file: string, content: string): Promise<Diagnostic[]>;
    replacePreview(root: string, query: string, replacement: string, options?: SearchOptions): Promise<SearchMatch[]>;
    replaceAll(root: string, query: string, replacement: string, paths?: string[] | null, options?: SearchOptions): Promise<{ files: number; replacements: number }>;
    watch(root: string): Promise<boolean>;
    history(root: string, file?: string): Promise<LocalHistoryEntry[]>;
    undo(root: string, id?: string): Promise<{ restored: boolean; id: string; label: string }>;
    beginOperation(root: string, label: string, paths: string[]): Promise<string | null>;
    endOperation(root: string): Promise<boolean>;
    onChanged(callback: (payload: { root: string; path: string; paths?: string[]; kind?: "rename" | "change" | "delete" }) => void): () => void;
    onHistory(callback: (payload: { root: string; id: string; label: string; timestamp: string }) => void): () => void;
  };
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<boolean>;
    create(parent: string, name: string, directory?: boolean): Promise<string>;
    rename(path: string, name: string): Promise<string>;
    delete(path: string): Promise<boolean>;
    transfer(source: string, targetDirectory: string, move?: boolean): Promise<string>;
    authorizeDrop(file: File): Promise<string | null>;
    importDropped(tokens: string[], targetDirectory: string): Promise<Array<{ source: string; target: string; move: boolean }>>;
    startDrag(paths: string[]): void;
    duplicate(path: string): Promise<string>;
    reveal(path: string): Promise<boolean>;
  };
  project: {
    chooseLocation(): Promise<string | null>;
    create(spec: ProjectSpec): Promise<{ root: string; mainFile: string; type: string }>;
    detect(root: string): Promise<ProjectInfo>;
    /**
     * Prepares a project without building it: the project itself, its
     * modules and its task list, kept for when it is opened.
     */
    prepare(root: string): Promise<{
      root: string;
      state: "ready" | "outdated" | "error";
      type?: string;
      modules?: number;
      tasks?: number;
      jdk?: string;
      wrapper?: boolean;
      reason?: string;
      tookMs?: number;
    }>;
    frameworkInfo(root: string): Promise<{
      frameworks: string[];
      symbols: Array<{ kind: "endpoint" | "bean" | "property" | "fxml" | "entity" | "repository"; name: string; detail: string; path: string; line: number; targetPath?: string }>;
    }>;
    getSettings(root: string): Promise<ProjectSettings>;
    updateSettings(root: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings>;
    repair(root: string): Promise<{
      repaired: boolean;
      backupRoot: string;
      moved: string[];
      copiedAcrossDrives: string[];
      /** What the shared Maven and Gradle caches gave up, and where it went. */
      shared?: {
        removed: number;
        quarantineRoot?: string;
        caches: Array<{
          tool: string;
          directory: string;
          missing: boolean;
          scanned: number;
          complete: boolean;
          damaged: Array<{ path: string; reason: string }>;
        }>;
        error?: string;
      };
      build: { ok: boolean; tasks?: number; modules?: number; error?: string };
      index: { available: boolean; status: string; reason?: string };
    }>;
    createSourceElement(root: string, parent: string, kind: "package" | JavaSourceKind, name: string, options?: Partial<JavaTypeOptions>): Promise<{ path: string; type: "file" | "directory"; kind: string }>;
    /**
     * The tasks of a build, answered from the last reading unless a build
     * file changed since — or unless `refresh` insists.
     */
    tasks(root: string, refresh?: boolean): Promise<{ type: string; tasks: ProjectTask[]; modules: string[]; profiles: BuildProfile[]; reason?: string }>;
    dependencies(root: string): Promise<string>;
    searchDependencies(query: string, limit?: number): Promise<DependencyCandidate[]>;
    dependencyVersions(groupId: string, artifactId: string): Promise<string[]>;
    listDependencies(root: string): Promise<DependencyEditorModel>;
    addDependency(root: string, coordinates: { groupId: string; artifactId: string; version: string }, scope?: string, options?: AddDependencyOptions): Promise<DependencyMutationResult>;
    removeDependency(root: string, selector: DependencySelector): Promise<DependencyMutationResult>;
    updateDependency(root: string, selector: DependencySelector, version: string): Promise<DependencyMutationResult>;
    updateVersionCatalog(root: string, catalogPath: string, key: string, version: string): Promise<DependencyMutationResult>;
    /**
     * The dependencies of one project of the build, "" being the root.
     *
     * A subproject is asked for by itself, because in a multi-project build
     * the root's answer is the aggregate and says nothing about what any one
     * module actually resolves.
     */
    dependencyTree(root: string, projectPath?: string): Promise<DependencyTree>;
    auditDependencies(root: string): Promise<DependencyAudit>;
    selectJdk(): Promise<JdkInfo | null>;
    listJdks(): Promise<JdkInfo[]>;
    onSettingsChanged(callback: (payload: { root: string; patch: Partial<ProjectSettings>; settings: ProjectSettings }) => void): () => void;
  };
  modules: {
    list(root: string): Promise<ModuleInfo[]>;
    previewCreate(root: string, spec: ModuleSpec): Promise<ModuleChangePlan>;
    previewRemove(root: string, moduleId: string): Promise<ModuleChangePlan>;
    applyPlan(root: string, planId: string): Promise<{ applied: boolean; module: ModuleInfo; files: string[] }>;
    updateSettings(root: string, moduleId: string, patch: Partial<Pick<ModuleInfo, "jdkPath" | "languageLevel" | "dependencies">>): Promise<ModuleInfo>;
  };
  settings: {
    get(): Promise<IdeSettings>;
    listSystemFonts(): Promise<string[]>;
    update(patch: Partial<IdeSettings>): Promise<IdeSettings>;
    reset(): Promise<IdeSettings>;
    chooseCertificate(): Promise<string>;
    exportBundle(text: string): Promise<string>;
    /** Writes one theme to a file of its own, not the whole settings bundle. */
    exportTheme(fileName: string, text: string): Promise<string>;
    /** Reads one back. Empty when the dialog was cancelled. */
    importTheme(): Promise<string>;
    importBundle(): Promise<string>;
    selectBackgroundImage(): Promise<string | null>;
    backgroundImageData(path: string): Promise<string>;
    onChanged(callback: (payload: { settings: IdeSettings; patch: Partial<IdeSettings> }) => void): () => void;
  };
  runConfigurations: {
    list(root: string): Promise<RunConfiguration[]>;
    save(root: string, configuration: RunConfiguration): Promise<RunConfiguration>;
    delete(root: string, id: string): Promise<boolean>;
  };
  workflow: {
    get(root: string): Promise<WorkflowState>;
    update(root: string, patch: Partial<WorkflowState>): Promise<WorkflowState>;
    rememberFile(root: string, file: string): Promise<WorkflowState>;
    createScratch(root: string, name?: string): Promise<string>;
  };
  refactor: {
    previewMove(root: string, request: { sourcePath: string; targetModuleId: string; targetPackage?: string; targetSourceRoot?: string; targetKind?: "production" | "test" }): Promise<JavaRefactorPlan>;
    prepareChangeSignature(root: string, file: string, position: { line: number; character: number }): Promise<{ available: boolean; reason: string; signature: JavaMethodSignature; affectedCallSites: JavaRefactorPlan["affectedCallSites"] }>;
    previewChangeSignature(root: string, request: { file: string; position: { line: number; character: number }; newName?: string; returnType?: string; parameters: JavaSignatureParameter[] }): Promise<JavaRefactorPlan>;
    previewWorkspaceEdit(root: string, title: string, edit: unknown, context?: { file?: string; position?: { line: number; character: number }; type?: string }): Promise<JavaRefactorPlan>;
    apply(root: string, planId: string): Promise<{ applied: boolean; id: string; files: string[]; targetPath: string | null }>;
    unusedPrivate(root: string, options?: { force?: boolean; maxFiles?: number; concurrency?: number }): Promise<UnusedPrivateAnalysis>;
  };
  java: {
    execute(payload: { root: string; file?: string; action: JavaAction; configuration?: RunConfiguration }): Promise<{
      command: string;
      project: ProjectInfo;
      operationId?: string;
      projectRoot?: string;
      moduleId?: string;
    }>;
    stop(root?: string): Promise<boolean>;
    detect(root: string): Promise<ProjectInfo>;
    onOutput(callback: (payload: ProcessOutput) => void): () => void;
    onExit(callback: (payload: { code: number; projectRoot?: string; operationId?: string }) => void): () => void;
  };
  panel: {
    openWindow(root: string): Promise<boolean>;
    closeWindow(): Promise<boolean>;
    windowState(): Promise<{ open: boolean }>;
    windowContext(): Promise<{ projectRoot: string }>;
    /** Workbench only: hands the detached windows what they should draw. */
    publish(snapshot: PanelWindowSnapshot): void;
    onState(callback: (snapshot: PanelWindowSnapshot) => void): () => void;
    /** Detached window only: asks the workbench to carry out a click. */
    request(command: PanelWindowCommand): void;
    onRequest(callback: (command: PanelWindowCommand) => void): () => void;
    onWindowState(callback: (state: { open: boolean }) => void): () => void;
  };
  terminal: {
    start(root: string, sessionId?: string, size?: { columns: number; rows: number }): Promise<{ started: boolean; shell: string; cwd: string; sessionId: string }>;
    list(root: string): Promise<string[]>;
    snapshot(root: string, sessionId?: string): Promise<TerminalSessionSnapshot>;
    /** Writes unmodified PTY data, including control characters such as Ctrl+C. */
    input(root: string, text: string, sessionId?: string): Promise<boolean>;
    resize(root: string, columns: number, rows: number, sessionId?: string): Promise<boolean>;
    execute(payload: { root: string; command: string; sessionId?: string }): Promise<boolean>;
    stop(root?: string, sessionId?: string): Promise<boolean>;
    openWindow(root: string, sessionId?: string): Promise<TerminalWindowState>;
    closeWindow(root: string, sessionId?: string): Promise<boolean>;
    windowContext(): Promise<Omit<TerminalWindowState, "open"> | null>;
    windowState(root?: string): Promise<Array<Omit<TerminalWindowState, "open">>>;
    onOutput(callback: (payload: ProcessOutput) => void): () => void;
    onExit(callback: (payload: { code: number; projectRoot?: string; sessionId?: string }) => void): () => void;
    onWindowState(callback: (payload: TerminalWindowState) => void): () => void;
  };
  tailer: {
    /** Opens the native picker; a chosen file is registered and its path returned. */
    choose(defaultPath?: string): Promise<string | null>;
    /** Starts following a file (inside a project or previously chosen). */
    open(path: string, options?: { lastLines?: number }): Promise<{ path: string }>;
    close(): Promise<boolean>;
    onLines(callback: (payload: { path: string; lines: string[] }) => void): () => void;
    onReset(callback: (payload: { path: string }) => void): () => void;
    onStatus(callback: (payload: { path: string; available: boolean }) => void): () => void;
    onError(callback: (payload: { path: string; message: string }) => void): () => void;
  };
  git: {
    clone(url: string, directory: string, name?: string): Promise<{ path: string; name: string; output: string }>;
    chooseCloneDirectory(): Promise<string>;
    status(root: string): Promise<GitStatus>;
    init(root: string): Promise<GitStatus>;
    diff(root: string, file?: string, staged?: boolean): Promise<string>;
    hunks(root: string, file: string, staged?: boolean): Promise<GitHunk[]>;
    applyHunk(root: string, file: string, index: number, reverse?: boolean): Promise<{ output: string; status: GitStatus }>;
    applyLines(root: string, file: string, index: number, changeIds: string[]): Promise<{ output: string; status: GitStatus }>;
    stage(root: string, paths: string[]): Promise<GitStatus>;
    unstage(root: string, paths: string[]): Promise<GitStatus>;
    commit(root: string, message: string, options?: { stageAll?: boolean; amend?: boolean }): Promise<{ output: string; status: GitStatus; checks: { ok: boolean; results: GitCommitCheckResult[] } }>;
    branches(root: string): Promise<GitBranch[]>;
    createBranch(root: string, name: string, checkout?: boolean): Promise<GitBranch[]>;
    checkout(root: string, name: string): Promise<GitStatus>;
    log(root: string, limit?: number): Promise<GitCommit[]>;
    pull(root: string): Promise<{ output: string; status: GitStatus }>;
    push(root: string, setUpstream?: boolean): Promise<{ output: string; status: GitStatus }>;
    compare(root: string, base: string, head?: string): Promise<GitComparison>;
    previewPull(root: string): Promise<GitComparison & { upstream: string; outgoing: number; incoming: number; note: string }>;
    stashes(root: string): Promise<Array<{ ref: string; hash: string; date: string; message: string }>>;
    stashSave(root: string, message?: string, includeUntracked?: boolean): Promise<{ output: string; stashes: Array<{ ref: string; hash: string; date: string; message: string }>; status: GitStatus }>;
    stashApply(root: string, ref: string, pop?: boolean): Promise<{ output: string; stashes: Array<{ ref: string; hash: string; date: string; message: string }>; status: GitStatus }>;
    stashDrop(root: string, ref: string): Promise<{ output: string; stashes: Array<{ ref: string; hash: string; date: string; message: string }>; status: GitStatus }>;
    fetch(root: string, prune?: boolean): Promise<{ output: string; status: GitStatus }>;
    merge(root: string, name: string, options?: { noFastForward?: boolean; squash?: boolean }):
      Promise<{ output: string; status: GitStatus; conflicted: boolean }>;
    mergeAbort(root: string): Promise<{ output: string; status: GitStatus }>;
    discard(root: string, paths: string[]): Promise<{ discarded: number; removed: number; status: GitStatus }>;
    deleteBranch(root: string, name: string, force?: boolean): Promise<{ output: string; branches: GitBranch[] }>;
    renameBranch(root: string, name: string, nextName: string):
      Promise<{ output: string; branches: GitBranch[]; status: GitStatus }>;
    revertCommit(root: string, hash: string): Promise<{ output: string; status: GitStatus; conflicted: boolean }>;
    cherryPick(root: string, hash: string): Promise<{ output: string; status: GitStatus; conflicted: boolean }>;
    resetTo(root: string, hash: string, mode?: "soft" | "mixed" | "hard"): Promise<{ output: string; status: GitStatus }>;
    tags(root: string): Promise<GitTag[]>;
    createTag(root: string, name: string, options?: { message?: string; commit?: string }):
      Promise<{ output: string; tags: GitTag[] }>;
    deleteTag(root: string, name: string): Promise<{ output: string; tags: GitTag[] }>;
    fileHistory(root: string, file: string, limit?: number): Promise<GitCommit[]>;
    blame(root: string, file: string): Promise<Array<{ hash: string; line: number; author: string; date: string; text: string }>>;
    conflict(root: string, file: string): Promise<{ path: string; base: string; ours: string; theirs: string; working: string }>;
    mergeModel(root: string, file: string): Promise<GitMergeModel>;
    resolveMerge(root: string, file: string, snapshot: string, resolutions: GitMergeResolution[]): Promise<GitStatus>;
    resolveConflict(root: string, file: string, content: string): Promise<GitStatus>;
    commitChecks(root: string): Promise<GitCommitCheckSettings>;
    updateCommitChecks(root: string, patch: Partial<GitCommitCheckSettings>): Promise<GitCommitCheckSettings>;
    commitCheckPlan(root: string): Promise<{ settings: GitCommitCheckSettings; kind: "maven" | "gradle" | "plain"; checks: GitCommitCheckPlanItem[] }>;
    runCommitChecks(root: string): Promise<{ ok: boolean; results: GitCommitCheckResult[] }>;
    rebasePlan(root: string, upstream: string): Promise<GitRebasePlan>;
    rebaseState(root: string): Promise<GitRebaseState>;
    rebaseInteractive(root: string, upstream: string, plan: GitRebaseEntry[]): Promise<{ code: number; output: string; state: GitRebaseState; status: GitStatus }>;
    rebase(root: string, action: "start" | "continue" | "skip" | "abort", upstream?: string): Promise<{ code: number; output: string; state: GitRebaseState; status: GitStatus }>;
    pullRequests(root: string, state?: "open" | "closed" | "all"): Promise<{ repository: { owner: string; repo: string; fullName: string; remote: string }; state: string; pulls: GitPullRequest[] }>;
    pullRequest(root: string, number: number): Promise<{
      repository: { owner: string; repo: string; fullName: string; remote: string };
      pull: GitPullRequest;
      body: string;
      mergeable: boolean | null;
      mergeableState: string;
      files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number; patch: string }>;
      reviews: Array<{ id: number; state: string; body: string; submittedAt: string; author: string }>;
    }>;
    createPullRequest(root: string, input: { title: string; body?: string; head?: string; base?: string; draft?: boolean }): Promise<GitPullRequest>;
    githubStatus(): Promise<GitHubSession>;
    githubSignIn(token: string): Promise<GitHubSession>;
    githubSignOut(): Promise<GitHubSession>;
    githubBeginDeviceFlow(): Promise<{ userCode: string; verificationUri: string; expiresIn: number; interval: number }>;
    githubPollDeviceFlow(): Promise<{ status: "pending"; retryAfter: number } | { status: "complete"; session: GitHubSession }>;
  };
  tests: {
    discover(root: string): Promise<TestSuite[]>;
    run(root: string, target?: string): Promise<unknown>;
    results(root: string): Promise<TestReport[]>;
    history(root: string): Promise<{ runs: TestHistoryRun[]; flaky: FlakyTest[] }>;
    coverage(root: string): Promise<{ command: string; operationId?: string }>;
    coverageResults(root: string): Promise<CoverageFile[]>;
  };
  http: {
    send(
      request: { method: string; url: string; headers?: Array<{ name: string; value: string }>; body?: string },
      options?: { id?: string; timeoutMs?: number },
    ): Promise<HttpResponseResult>;
    cancel(id: string): Promise<boolean>;
  };
  /**
   * CodeToGetter: two developers on one project when only one of them has it.
   *
   * The host owns the disk and answers every question. The guest has no file
   * API here at all — that is the point of the feature, not an omission.
   */
  collab: {
    /**
     * Starts hosting. With a relay address, nothing here listens: both ends
     * dial out to the relay, which is why no router has to be configured.
     */
    host(root: string, publicAccess?: boolean, relay?: string, hostOnly?: boolean): Promise<CollabSession>;
    stopHosting(): Promise<{ hosting: boolean }>;
    hostState(): Promise<{
      hosting: boolean;
      port?: number;
      addresses?: string[];
      project?: string;
      /** Absolute root owned by this host session; used to reject stale UI state. */
      root?: string;
      invite?: string;
      peers: CollabPeer[];
      defaultRole?: CollabRole;
      /** True while guests are refused a working copy on their own disk. */
      hostOnly?: boolean;
      blocked?: string[];
    }>;
    /** What a guest joining from now on may do. */
    setDefaultRole(root: string, role: CollabRole): Promise<{ defaultRole: CollabRole }>;
    /**
     * Refuses guests a copy of the project on their own machine.
     *
     * Not retroactive: a guest who already has the files has them, and a flag
     * cannot take them back. It applies to whoever joins from now on.
     */
    setHostOnly(root: string, hostOnly: boolean): Promise<{ hostOnly: boolean }>;
    /** Changes what one connected guest may do, while they are connected. */
    setPeerRole(root: string, peerId: number, role: CollabRole): Promise<CollabPeer>;
    /** Ends one guest's session, telling them it was the host and not the network. */
    disconnectPeer(root: string, peerId: number): Promise<{ id: number; name: string }>;
    /** Ends it and refuses that address for the rest of the session. */
    blockPeer(root: string, peerId: number): Promise<{ id: number; name: string; address?: string }>;
    unblock(root: string, address: string): Promise<{ blocked: string[] }>;
    onRemoved(callback: (payload: { message: string; session?: string }) => void): () => void;
    onRole(callback: (payload: { role: CollabRole; permissions?: string[]; session?: string }) => void): () => void;
    localEdit(
      root: string,
      path: string,
      edit: CollabEdit,
      baseVersion?: number,
    ): Promise<{
      ok: boolean;
      applied?: boolean;
      rebased?: boolean;
      version?: number;
      reason?: string;
      edit?: CollabEdit;
      text?: string;
    }>;
    localSnapshot(root: string, path: string): Promise<{
      path: string;
      text: string;
      version: number;
      dirty?: boolean;
    }>;
    localSave(root: string, path: string): Promise<{
      saved: boolean;
      version: number;
      currentVersion?: number;
      dirty?: boolean;
      conflict?: boolean;
      text?: string;
    }>;
    localReplace(root: string, path: string, text: string): Promise<{ version: number }>;
    join(code: string, name: string): Promise<{ project: string; peerId: number; peers: CollabPeer[]; /** What the host granted this guest on arrival. */ role: CollabRole; /** Each thing separately, because build and debug were never part of a role. */ permissions?: string[]; /** True when the host allows no copy on this machine; then there is no workspaceRoot to open. */ hostOnly?: boolean; /** The root the workbench opens the shared project under. */ workspaceRoot: string }>;
    leave(): Promise<{ joined: boolean }>;
    request(type: "tree", payload?: Record<string, never>): Promise<{ entries: CollabTreeEntry[]; truncated: boolean }>;
    request(type: "open", payload: { path: string }): Promise<{ path: string; text: string; version: number }>;
    request(
      type: "edit",
      payload: { path: string; edit: CollabEdit; baseVersion: number },
    ): Promise<{ applied: boolean; version: number; edit?: CollabEdit; reason?: string; text?: string }>;
    request(type: "save", payload: { path: string }): Promise<{
      saved: boolean;
      version: number;
      currentVersion?: number;
      dirty?: boolean;
      conflict?: boolean;
      text?: string;
    }>;
    request(type: "cursor", payload: { path: string; offset: number; anchor?: number }): Promise<unknown>;
    /**
     * Asks the host's machine to build, test, run or debug.
     *
     * Refused on the host when the permission was never granted, which is the
     * only place the decision is made.
     */
    request(type: "run", payload: { action: SharedAction }): Promise<{ started?: boolean }>;
    onPeers(callback: (payload: {
      session: "host" | "guest";
      peers: CollabPeer[];
      joined?: string;
      left?: string;
      defaultRole?: CollabRole;
      hostOnly?: boolean;
    }) => void): () => void;
    onEdit(callback: (payload: {
      session: "host" | "guest";
      path: string;
      edit: CollabEdit;
      version: number;
      by?: string | number;
    }) => void): () => void;
    onReset(callback: (payload: {
      session: "host" | "guest";
      path: string;
      text: string;
      version: number;
    }) => void): () => void;
    onSaved(callback: (payload: {
      session: "host" | "guest";
      path: string;
      by?: string | number;
      /** Revision whose bytes reached disk. */
      version?: number;
      /** Revision after the write completed, when supplied by the host. */
      currentVersion?: number;
      /** True when newer shared text still differs from the disk snapshot. */
      dirty?: boolean;
    }) => void): () => void;
    onCursor(callback: (payload: { projectRoot: string; path: string; offset: number; anchor: number; by: number; name: string }) => void): () => void;
    onTreeChanged(callback: (payload: { projectRoot: string }) => void): () => void;
    onOutput(callback: (payload: { channel: string; payload: unknown }) => void): () => void;
    /** A guest with the permission has asked this machine to start something. */
    onRunRequest(callback: (payload: {
      projectRoot: string;
      action: SharedAction;
      by: number;
      name: string;
    }) => void): () => void;
    onDisconnected(callback: (payload: { session: "guest" }) => void): () => void;
  };
  /** Fetching a Java runtime from Adoptium, so a new machine can compile. */
  jdk: {
    available(): Promise<{ versions: Array<{ version: number; lts: boolean }>; mostRecentLts: number }>;
    describe(feature: number): Promise<JdkPackage>;
    install(feature: number): Promise<{ installed: boolean; reason?: string; path: string; binary: JdkPackage }>;
    /** Where a download would land, and whether that folder was chosen. */
    installRoot(): Promise<JdkInstallRoot>;
    chooseInstallRoot(): Promise<JdkInstallRoot | null>;
    resetInstallRoot(): Promise<JdkInstallRoot>;
    onProgress(callback: (progress: {
      feature: number;
      received: number;
      total: number;
      percent: number;
      phase?: "preparing" | "downloading" | "verifying" | "extracting" | "installing" | "done";
      done?: boolean;
    }) => void): () => void;
  };
  bytecode: {
    disassemble(root: string, binaryName: string, sourceFile?: string):
      Promise<{ stdout: string; stderr: string; tool: string }>;
  };
  projectIndex: {
    /** The stored file list as text, empty when there is none yet. */
    load(root: string): Promise<{ root: string; text: string }>;
    build(root: string): Promise<{ version: number; root: string; builtAt: number; files: Array<{ path: string; modified: number }> }>;
    clear(root: string): Promise<boolean>;
  };
  templates: {
    read(root: string): Promise<{ path: string; text: string; exists: boolean }>;
    write(root: string, text: string): Promise<{ path: string; text: string; exists: boolean }>;
    onChanged(callback: (payload: { root: string }) => void): () => void;
  };
  debug: {
    start(payload: { root: string; file?: string; configuration?: RunConfiguration; breakpoints?: DebugBreakpoint[] }): Promise<{ started: boolean; engine?: string; port: number; mainClass: string }>;
    attach(payload: { root: string; host?: string; port: number; breakpoints?: DebugBreakpoint[] }): Promise<{ started: boolean; engine?: string; attached: boolean; port: number; mainClass: string }>;
    command(
      command: string,
      argument?: string | {
        file?: string;
        mode?: "smart" | "redefine" | "relaunch";
        previousSource?: string;
      },
    ): Promise<any>;
    stop(): Promise<boolean>;
    listBreakpoints(root: string): Promise<DebugBreakpoint[]>;
    saveBreakpoints(root: string, breakpoints: DebugBreakpoint[]): Promise<DebugBreakpoint[]>;
    onOutput(callback: (payload: { text: string; stream?: string }) => void): () => void;
    onState(callback: (payload: { status: string; engine?: string; reason?: string; threadId?: number; className?: string; line?: number; code?: number }) => void): () => void;
    onVariables(callback: (payload: { scope: string; variables: DebugVariable[] }) => void): () => void;
    onStack(callback: (payload: { threadId: number; frames: DebugStackFrame[] }) => void): () => void;
    onThreads(callback: (payload: { threads: DebugThread[] }) => void): () => void;
    onWatch(callback: (payload: DebugVariable & { expression: string }) => void): () => void;
    onHotReplace(callback: (payload: { success: boolean; restarted?: boolean; message: string }) => void): () => void;
    onBreakpoint(callback: (payload: {
      className: string;
      line?: number;
      member?: string;
      type?: "field" | "method";
      status: string;
      problem?: string;
    }) => void): () => void;
    onFieldHit(callback: (payload: {
      className: string;
      fieldName: string;
      access: "write" | "read";
      value: string;
      newValue: string;
    }) => void): () => void;
    onMethodExit(callback: (payload: { className: string; methodName: string; returnValue: string }) => void): () => void;
  };
  language: {
    start(root: string): Promise<{ available: boolean; status: string; reason?: string; capabilities?: unknown; project?: unknown; classpath?: unknown }>;
    request(root: string, method: string, params: unknown, requestId?: string): Promise<any>;
    cancel(requestId: string): Promise<boolean>;
    open(payload: { root: string; file: string; text: string; languageId: string }): Promise<{ available: boolean }>;
    change(payload: { root: string; file: string; text: string }): Promise<boolean>;
    save(payload: { root: string; file: string; text: string }): Promise<boolean>;
    close(payload: { root: string; file: string }): Promise<boolean>;
    refresh(root: string, file?: string): Promise<boolean>;
    stop(root?: string): Promise<boolean>;
    onDiagnostics(callback: (payload: any) => void): () => void;
    onStatus(callback: (payload: any) => void): () => void;
    onLog(callback: (payload: any) => void): () => void;
    onMessage(callback: (payload: any) => void): () => void;
    onApplyEdit(callback: (payload: any) => void): () => void;
  };
  /**
   * What Discord is told about this session.
   *
   * One way out: the card is not state the workbench reads back, and the main
   * process decides from the settings how much of this is used at all.
   */
  presence: {
    update(payload: { projectName: string; fileName: string }): Promise<boolean>;
    /** The card exactly as it would be sent, for the settings page to show. */
    preview(): Promise<DiscordPresencePreview>;
  };
  /** Known advisories against what the project declares. */
  security: {
    scan(root: string, force?: boolean): Promise<VulnerabilityReport>;
  };
  /** The built artefact onto the machine it runs on. */
  deploy: {
    load(root: string): Promise<DeployTarget>;
    save(root: string, target: DeployTarget): Promise<DeployTarget>;
    check(root: string): Promise<DeployCheck>;
    run(root: string): Promise<DeployResult>;
    onLine(callback: (payload: { root: string; line: string; kind: string }) => void): () => void;
  };
  app: {
    openEditor(root: string): Promise<boolean>;
    showWelcome(): Promise<boolean>;
    openSettings(root?: string): Promise<boolean>;
    openStructure(root?: string): Promise<boolean>;
    openNewProject(initialLocation?: string): Promise<boolean>;
    onSettingsContext(callback: (payload: { projectRoot: string }) => void): () => void;
    onWizardContext?(callback: (payload: { initialLocation: string }) => void): () => void;
    checkForUpdates(): Promise<UpdateCheckResult>;
    updateState(): Promise<UpdateRuntimeState>;
    onUpdateState(callback: (payload: UpdateRuntimeState) => void): () => void;
    downloadUpdate(update: UpdateCheckResult): Promise<DownloadedUpdate>;
    installUpdate(update: UpdateCheckResult): Promise<DownloadedUpdate>;
    health(): Promise<{
      sampledAt: string;
      main: { heapMb: number; rssMb: number; uptimeSeconds: number };
      language: { sessions: number; maxSessions: number; processes: Array<{ root: string; pid: number; documents: number; ready: boolean }> };
      terminal: { sessions: number; processes: Array<{ root: string; pid: number; running: boolean }> };
      debug: { active: boolean; root: string; adapterPid: number; vmPid: number; scopes: number; frames: number; threads: number };
      renderer: { version: string; hot: boolean; mainHash: string };
      build?: {
        version: string;
        electron: string;
        chrome: string;
        node: string;
        platform: string;
        arch: string;
      };
    }>;
    openUpdate(url: string): Promise<boolean>;
    /** Opens HTTP, HTTPS or mailto links in the system's registered handler. */
    openExternal(url: string): Promise<boolean>;
    /** Opens an artifact's page on mvnrepository.com; refuses every other address. */
    openArtifactPage(url: string): Promise<boolean>;
    minimize(): void;
    maximize(): void;
    close(): void;
  };
  database: {
    find(root: string): Promise<string[]>;
    schema(dbPath: string): Promise<{
      path: string;
      tables: Array<{
        name: string;
        rowCount: number;
        columns: Array<{
          cid: number;
          name: string;
          type: string;
          notnull: boolean;
          dflt_value: any;
          pk: boolean;
        }>;
      }>;
    }>;
    query(dbPath: string, sql: string): Promise<{
      columns: string[];
      rows: any[];
      rowCount: number;
      executionTimeMs: number;
      isSelect: boolean;
    }>;
  };
  docker: {
    check(): Promise<{ available: boolean; version: string }>;
    containers(all?: boolean): Promise<Array<{
      id: string;
      names: string;
      image: string;
      status: string;
      state: string;
      ports: string;
      created: string;
    }>>;
    images(): Promise<Array<{
      id: string;
      repository: string;
      tag: string;
      size: string;
      created: string;
    }>>;
    containerAction(id: string, action: string): Promise<{ success: boolean; output: string }>;
    composeAction(root: string, action: string): Promise<{ success: boolean; output: string }>;
  };
}

declare global {
  interface Window {
    kiwi?: KiwiApi;
  }
}
