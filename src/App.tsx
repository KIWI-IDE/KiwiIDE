import { CodeToGetter } from "./components/CodeToGetter";
import { selectionForProblem } from "./editor/problem-selection";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import {
  Blocks,
  Bookmark,
  Monitor,
  Braces,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  CircleAlert,
  CircleCheck,
  Info,
  CircleX,
  Code2,
  Columns2,
  Command,
  Container,
  Database,
  Download,
  Ellipsis,
  Eye,
  FileCog,
  File,
  FileCode2,
  FileDiff,
  FileJson,
  FilePlus2,
  Files,
  FileText,
  Focus,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Github,
  GitCommitHorizontal,
  Hammer,
  History,
  ListTree,
  LoaderCircle,
  Maximize2,
  Minus,
  Network,
  Package,
  PanelBottom,
  Pause,
  Pencil,
  Pin,
  Globe,
  GripVertical,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  TriangleAlert,
  LayoutGrid,
  ListTodo,
  Search,
  Settings,
  SplitSquareHorizontal,
  Square,
  SquareCheck,
  SquareTerminal,
  Users,
  Star,
  TestTube2,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
  Lock as LockIcon,
  FlaskConical,
  Binary,
  ScrollText,
} from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { JAVA_LANGUAGE_LEVELS } from "./language-levels";
import type {
  ActivityView,
  CoverageFile,
  DebugBreakpoint,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  DependencyAudit,
  DependencyEditorModel,
  DependencyMutationResult,
  DependencyNode,
  DependencySelector,
  DependencyTree,
  Diagnostic,
  FileNode,
  EditableDependency,
  FlakyTest,
  GitStatus,
  GitComparison,
  IdeSettings,
  JavaAction,
  JavaSourceKind,
  JavaTypeOptions,
  ModuleChangePlan,
  GitHubSession,
  HttpResponseResult,
  JdkInfo,
  ModuleInfo,
  ModuleSpec,
  OpenFile,
  BuildProfile,
  PanelView,
  ProjectTaskComment,
  ProjectInfo,
  ProjectSettings,
  ProjectSpec,
  ProjectTask,
  RunConfiguration,
  RightToolView,
  SearchMatch,
  SearchOptions,
  TestReport,
  TestHistoryRun,
  TestSuite,
  UpdateCheckResult,
  PanelWindowSnapshot,
  UpdateRuntimeState,
  WorkflowState,
  WorkspaceProject,
  WorkspaceState,
} from "./types";
import {
  ancestorDirectories,
  basename,
  buildQuickFixForDiagnostic,
  compactPackageNodes,
  dirname,
  explainJavaDiagnostic,
  explorerLabel,
  findTaskComments,
  taskMarkers,
  flattenFiles,
  joinPath,
  fuzzyScore,
  implementJavaInterface,
  isPathWithin,
  isTreeNodeExpanded,
  mergeLoadedTreeState,
  nextUiScale,
  withLoadedChildren,
  groupBuildOutputByModule,
  javaTemplate,
  languageFromPath,
  parseBuildReport,
  relativePath,
  remapExpandedExplorerPaths,
  removeTreeNode,
  samePath,
  taskProjectPath,
  taskShortName,
  tasksForProject,
  trackSteps,
  translucent,
  treeExpansionKey,
  treeExpansionPaths,
  type TaskComment,
} from "./utils";
import { accentPalette, findTheme, monacoThemeId, personalizationVariables, resolveTokenColors, resolveWorkbenchColors, themes } from "./themes";
import { javaLanguageDefinition, javaKeywords, javaKeywordScope } from "./language/java-tokenizer";
import { HTTP_LANGUAGE_ID, installHttpLanguage } from "./language/http-language";
import { installBuildFileCompletion } from "./language/build-completion";
import { parseHttpFile, requestAtLine, type HttpRequestDefinition } from "./language/http-file";
import { findCodeSyntaxProblems, type SyntaxProblem } from "./language/syntax-router";
import { findJavaTestTargets, type JavaTestTarget } from "./language/java-tests";
import { resolveJavaGutterAction, toggleJavaLineBreakpoint } from "./debug/breakpoint-gutter";
import { findDebugModule } from "./debug/debug-launch";
import { matchesShortcut, resolveKeybindings } from "./keybindings";
import { hasOpenTernary, needsStatementSemicolon, parseJavaMembers } from "./language/java-completion";
import {
  extendSpeedSearch,
  isSpeedSearchKey,
  NO_SPEED_SEARCH,
  shortenSpeedSearch,
  speedSearchMatch,
} from "./explorer-speed-search";
import {
  describeLibraryUri,
  editorOpenTarget,
  isLibraryUri,
  isReadOnlyDocument,
  libraryClassSubtitle,
} from "./language/library-source";
import { findJavaRegions } from "./language/java-regions";
import {
  activeViewForDock,
  assignPanelDock,
  DEFAULT_FLOATING_BOUNDS,
  centredFloatingBounds,
  dockOf,
  dropPlacementAt,
  dropZones,
  focusAfterHidingDock,
  isBottomDock,
  moveDock,
  movedFloatingBounds,
  occupiedDocks,
  resizedFloatingBounds,
  resizedPanelHeight,
  sanitizeDockEdges,
  sanitizeDockSelection,
  sanitizeFloatingBounds,
  sanitizePanelDocks,
  sanitizePanelView,
  viewsForDock,
  type DockEdge,
  type DockSelection,
  type DropTarget,
  type FloatingBounds,
  type PanelDocks,
} from "./workbench/panel-docks";
import { sanitizeRightTool } from "./workbench/right-tools";
import { runSingleFlight } from "./workbench/single-flight";
import {
  applyCollabEdit,
  canApplyCollabRemoteEdit,
  collabAbsolutePath,
  collabEditsFromChanges,
  collabHostEditNeedsSnapshot,
  collabRelativePath,
  collabRootsEqual,
  enqueueCollabFileTask,
  isActiveCollabHost,
  shouldInitializeCollabHost,
} from "./collaboration/client";
import { createTranslator, setActiveLocale, t } from "./i18n";
import { KiwiLogo } from "./components/KiwiLogo";
import { LazyMonacoEditor as Editor } from "./components/LazyMonacoEditor";
import { KiwiInputDialog } from "./components/KiwiInputDialog";
import { KiwiConfirmDialog } from "./components/KiwiConfirmDialog";
import { JavaTypeDialog } from "./components/JavaTypeDialog";
import { ModuleDialog } from "./components/ModuleDialog";
import { ProjectHub } from "./components/ProjectHub";
import { VirtualOutput } from "./components/VirtualOutput";
import { TailerPanel } from "./components/panel/TailerPanel";
import { tailerStore } from "./components/panel/tailer-store";
import { preserveTypedWhitespace } from "./language/format-whitespace";
import { javaReleaseNumber, SURROUND_KINDS, surroundSelection, type SurroundKind } from "./language/postfix-templates";
import { describeFixes } from "./language/fix-all";
import { binaryClassName, bytecodeTitle, readBytecode } from "./language/bytecode-view";
import { collectRunTargets, orderRunTargets } from "./run-anything";
import { describeCompound, isCompound, resolveCompound } from "./run-compound";
import { affectedTests, describeAffected } from "./affected-tests";
import { describeBreakpoint, memberAtCaret, memberBreakpoint, sameBreakpoint } from "./debug-member-breakpoints";
import { runnableSourceFor } from "./runnable-source";
import { describeSharedRequest } from "./collaboration/shared-session";
import { scheduledTheme } from "./theme-file";
import { describeBaselines, detectMemoryTrend, detectRegression } from "./performance-baseline";
import {
  countStoredDrafts,
  describeDroppedDrafts,
  describeRecovery,
  draftsToStore,
  endedBadly,
} from "./crash-recovery";
import {
  backgroundFor,
  backgroundVariables,
  currentBackgroundImage,
} from "./workspace-background";
import { bracketColorIndex, genericBracketSpans } from "./language/generic-brackets";
import {
  editorFeelOptions,
  editorFeelVariables,
  editorFontStack,
  revealScrollType,
  tokenClassForColor,
} from "./editor-feel";
import {
  emptyIndex,
  indexNeedsRefresh,
  isBuildArtifact,
  readProjectIndex,
  searchIndex,
  searchSymbols,
  applyIndexChange,
  type ProjectIndex,
} from "./project-index";
import {
  changedLinesFromDiff,
  describeDiffCoverage,
  diffCoverage,
  type DiffCoverage,
} from "./coverage-detail";
import {
  applyTestProgress,
  NO_TEST_PROGRESS,
  NO_TEST_RUN,
  readTestProgress,
} from "./test-progress";
import {
  isProjectTemplateFile,
  parseCustomTemplates,
  TEMPLATE_FILE,
  templateFileExample,
  type CustomTemplate,
} from "./language/custom-templates";
import { createSettingsBundle, mergeLayouts, readSettingsBundle } from "./settings-transfer";
import { ProjectWizard } from "./components/ProjectWizard";
import { DependencyDialog } from "./components/DependencyDialog";
import { DependencyEditor } from "./components/DependencyEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { DeployDialog } from "./components/DeployDialog";
import { RunConfigurationDialog } from "./components/RunConfigurationDialog";
import { LazyTerminalScreen as TerminalScreen } from "./components/LazyTerminalScreen";
import {
  applyLspWorkspaceEdit,
  fileFromUri,
  fileUri,
  installJavaLanguageProviders,
  lspDiagnosticsToMarkers,
  previewLspWorkspaceEdit,
  type JavaLanguageController,
  type WorkspaceEditPreviewItem,
} from "./language/monaco-lsp";
import { acceptsDependencies, buildFileLabel } from "./language/build-files";
import { registerPolyglotLanguageProviders } from "./language/polyglot-monaco";
import { isPolyglotLanguage, languageDisplayName, sourceLanguage } from "./language/language-catalog";
import { getProjectNewTemplates, type ProjectNewItem } from "./language/project-templates";
import { generateJavaMembers, type JavaGenerationKind } from "./language/java-code-generation";
import { GenerateMembersDialog } from "./components/GenerateMembersDialog";
import { ProjectStructureDialog } from "./components/ProjectStructureDialog";
import { JavaNavigationPanel } from "./components/JavaNavigationPanel";
import { GitHubSignInDialog } from "./components/GitHubSignInDialog";
import { ChangeSignatureDialog } from "./components/ChangeSignatureDialog";
import { JavaRefactorPreview } from "./components/JavaRefactorPreview";
import { UnusedPrivatePanel } from "./components/UnusedPrivatePanel";
import { WebPreviewPanel } from "./components/WebPreviewPanel";
import { NpmPackageManager } from "./components/NpmPackageManager";
import { DatabaseBrowser } from "./components/DatabaseBrowser";
import { DockerPanel } from "./components/DockerPanel";
import { GitGraphView } from "./components/GitGraphView";
import { ScratchpadPanel } from "./components/ScratchpadPanel";
import { relativePathBreadcrumbs, enclosingCodeSymbol } from "./language/code-breadcrumbs";
import { BuildToolIcon } from "./components/BuildToolIcon";
import { branchKey, buildProjectNodes, taskGroupKey, usefulConfigurations } from "./build/build-tree";
import { adoptProjectStates, persistProjectStates } from "./editor/editor-state-store";
import { mergeProjectList, sameProjectRoot, readinessLabel, type ProjectReadiness } from "./projects/project-list";
import { useGitWorkbench } from "./workbench/use-git-workbench";
import { defineMonacoThemes } from "./monaco-workbench-themes";
import { defaultIdeSettings, defaultProjectInfo, emptyWorkflow } from "./workbench/workbench-defaults";
import {
  FileTypeIcon,
  TreeItem,
  VirtualProjectTree,
  emptyTree,
  flattenTreeNodes,
  flattenVisibleTree,
} from "./components/ProjectTree";
import {
  BusyIndicator,
  DebugVariableTree,
  DependencyNodeTree,
  FileHealthBadge,
  IconButton,
  UpdateProgress,
  emptyDiagnostics,
} from "./components/WorkbenchWidgets";
import {
  SUMMONABLE_PANEL_VIEWS,
  builtInLayouts,
  type BackgroundOperation,
  type PaletteMode,
  type PerformanceMetric,
  type PersistedPanelLayout,
  type Toast,
  type WorkbenchDocument,
  type WorkbenchLayout,
} from "./workbench/workbench-types";
import {
  clampPopupToViewport,
  contentFingerprint,
  editorTabSize,
  effectiveViewport,
  explainBuildToolFailure,
  fileKind,
  groupProjectTasks,
  isProjectDefinition,
  isUnsaved,
  javaBreadcrumbParts,
  javaPackageAt,
  legacyProjectRoots,
  nextDockLabel,
  parseEnvironmentTemplate,
  qualifiedJavaClassName,
  safeDecodeUri,
  splitUnifiedDiff,
  stableHue,
  storeJson,
  storedJson,
} from "./workbench/workbench-helpers";
import type { JavaMethodSignature, JavaRefactorPlan, UnusedPrivateAnalysis } from "./language/java-refactor";
import { resolveCrossModuleJavaMove } from "./language/java-refactor-integration";
import { GitCommitChecks, GitPullRequestView, GitRebaseEditor, GitThreeWayMergeEditor, installGitHunkStaging } from "./git";
import {
  groupJavaUsageLocations,
  hierarchyNodesFromResponse,
  pathFromJavaUri,
  type HierarchyDirection,
  type JavaHierarchyItem,
  type JavaHierarchyNode,
  type JavaNavigationModel,
} from "./language/java-navigation";

const ProjectStructureWindowApp = lazy(() => import("./components/ProjectStructureWindowApp").then((module) => ({
  default: module.ProjectStructureWindowApp,
})));
const ProjectWizardWindowApp = lazy(() => import("./components/ProjectWizardWindowApp").then((module) => ({
  default: module.ProjectWizardWindowApp,
})));
const SettingsWindowApp = lazy(() => import("./components/SettingsWindowApp").then((module) => ({
  default: module.SettingsWindowApp,
})));
const PanelWindowApp = lazy(() => import("./components/PanelWindowApp").then((module) => ({
  default: module.PanelWindowApp,
})));
const TerminalWindowApp = lazy(() => import("./components/TerminalWindowApp").then((module) => ({
  default: module.TerminalWindowApp,
})));

const appBootStartedAt = performance.now();

function isRunnableFileNode(node: FileNode | null | undefined): boolean {
  if (!node || node.type !== "file") return false;
  return /\.(java|py|pyw|rs|go|php|phtml|lua|c|cpp|cc|cxx|cs|kt|kts|m|mm)$/i.test(node.name);
}

/**
 * Registers one Monaco theme per workbench theme.
 *
 * With a workspace wallpaper the editor surface is transparent so the image
 * shows through. The minimap is a canvas that Monaco clears with
 * `minimap.background`, so it has to be cleared transparently too — otherwise
 * it stays an opaque block sitting on top of the wallpaper. The current line is
 * the same problem in miniature: left opaque, it draws a solid band right
 * across the picture, which is what it looked like — a selection nobody made.
 */
type BuildProjectDependencies = {
  loading: boolean;
  error: string;
  configurations: Array<{ name: string; nodes: DependencyNode[] }>;
};

type ExplorerContext = { x: number; y: number; node: FileNode; projectRoot: string };
type ExplorerSubmenu = "new" | "clipboard" | "refactor" | "git" | "more";
type ExplorerClipboard = { nodes: FileNode[]; move: boolean };
type TabContext = { x: number; y: number; path: string };
type ConfirmRequest = {
  title: string;
  description?: string;
  details?: string[];
  confirmLabel?: string;
  answer: (confirmed: boolean) => void;
};

type InputRequest = {
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  variant?: "dialog" | "quick";
  validate?: (value: string) => string | null;
  action: (value: string) => void | Promise<void>;
};
type JavaTypeRequest = { parent: string; packageName: string; initialKind: JavaSourceKind };
type BuildHistoryEntry = {
  id: string;
  finishedAt: string;
  status: "success" | "failed";
  action: JavaAction;
  output: string;
  modules: ReturnType<typeof groupBuildOutputByModule>;
};

function IdeApp() {
  const welcomeWindow = new URLSearchParams(window.location.search).get("window") === "welcome";
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ version: 1, projects: [], activeRoot: null });
  /**
   * How far each project has been prepared, keyed by its root.
   *
   * Shown beside the project in the switcher and nowhere else. It never
   * gates anything: a project that could not be prepared is a project that
   * opens the slow way, not one that cannot be opened.
   */
  const [projectReadiness, setProjectReadiness] = useState<Map<string, ProjectReadiness>>(() => new Map());
  /** Roots already handed to the preloader, so none is prepared twice. */
  const preparedProjects = useRef<Set<string>>(new Set());
  const [workspaceTrees, setWorkspaceTrees] = useState<Record<string, FileNode[]>>({});
  const [bootstrapped, setBootstrapped] = useState(false);
  const [projectLoading, setProjectLoading] = useState<{ label: string; detail?: string; progress?: { done: number; total: number } } | null>(null);
  const [updateRuntime, setUpdateRuntime] = useState<UpdateRuntimeState | null>(null);
  const [treeRefreshing, setTreeRefreshing] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [explorerRootOpen, setExplorerRootOpen] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityView>("explorer");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [httpResponses, setHttpResponses] = useState<Array<HttpResponseResult & { id: string; name: string; at: number }>>([]);
  const [httpPending, setHttpPending] = useState<{ id: string; name: string } | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  const [panel, setPanel] = useState<PanelView>("terminal");
  const [output, setOutput] = useState("");
  const [lastJavaAction, setLastJavaAction] = useState<JavaAction | null>(null);
  const [lastProcessExitCode, setLastProcessExitCode] = useState<number | null>(null);
  const [buildRawOpen, setBuildRawOpen] = useState(false);
  const [buildHistoryOpen, setBuildHistoryOpen] = useState(false);
  const [buildHistory, setBuildHistory] = useState<BuildHistoryEntry[]>([]);
  const [buildFixing, setBuildFixing] = useState<string | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<string[]>(["1"]);
  const [activeTerminalId, setActiveTerminalId] = useState("1");
  const [detachedTerminalSessions, setDetachedTerminalSessions] = useState<Set<string>>(new Set());
  /** The same set for handlers that run outside render, such as the view reset. */
  const detachedTerminalSessionsRef = useRef<Set<string>>(detachedTerminalSessions);
  const [terminalOutput, setTerminalOutput] = useState(
    "Kiwi Terminal\nBereit. Öffne einen Projektordner und führe einen Befehl aus.\n\n",
  );
  const [terminalCommand, setTerminalCommand] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>(defaultProjectInfo);
  const projectInfoRef = useRef<ProjectInfo>(defaultProjectInfo);
  projectInfoRef.current = projectInfo;
  /** The package roots this project calls its own, for labelling proposals. */
  const projectPackagesRef = useRef<string[]>([]);
  /** What has been typed into the Explorer to jump to a name. */
  const [speedSearch, setSpeedSearch] = useState(NO_SPEED_SEARCH);
  const speedSearchRef = useRef(NO_SPEED_SEARCH);
  /** The tree the speed search reads, and the row it has to bring into view. */
  /** The server's own diagnostics, for the batch fix that looks them up. */
  /** Set below, so the run action can reach a definition that follows it. */
  const runCompoundRef = useRef<(configuration: RunConfiguration) => Promise<void>>(async () => undefined);
  const languageDiagnosticsRef = useRef<Record<string, unknown[]>>({});
  const treeForSpeedSearch = useRef<FileNode[]>([]);
  const selectedNodeRef = useRef<FileNode | null>(null);

  /**
   * Scrolls the virtualised tree until a row is on screen.
   *
   * The row may not exist in the DOM at all — that is what virtualising means
   * — so the viewport is moved by index and height rather than by asking the
   * element to show itself.
   */
  const revealTreeIndex = useCallback((index: number) => {
    const viewport = document.querySelector<HTMLElement>(".virtual-tree-viewport");
    if (!viewport) return;
    const rowHeight = document.querySelector<HTMLElement>(".tree-row")?.getBoundingClientRect().height || 22;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight;
    }
  }, []);

  /** What .kiwi/templates.json in this project defines, and what is wrong with it. */
  const [projectTemplates, setProjectTemplates] = useState<{ templates: CustomTemplate[]; problems: string[] }>({ templates: [], problems: [] });
  const projectTemplatesRef = useRef<CustomTemplate[]>([]);
  projectTemplatesRef.current = projectTemplates.templates;

  /**
   * Reads the templates the open project defines.
   *
   * Kept out of the project load: a template file is not needed to show the
   * project, and a broken one must not be able to stop it from opening. The
   * problems it reports are shown in the settings rather than as a toast — a
   * template file is edited deliberately, and a message about it while
   * somebody is opening a project is noise.
   */
  const reloadProjectTemplates = useCallback(async (root: string) => {
    if (!root || !window.kiwi?.templates) {
      setProjectTemplates({ templates: [], problems: [] });
      return;
    }
    try {
      const file = await window.kiwi.templates.read(root);
      setProjectTemplates(parseCustomTemplates(file.text));
    } catch (error) {
      setProjectTemplates({ templates: [], problems: [error instanceof Error ? error.message : String(error)] });
    }
  }, []);

  useEffect(() => {
    void reloadProjectTemplates(workspaceRoot);
    // The settings window edits the file in a window of its own, so the
    // workbench is told rather than left with what it read at startup.
    return window.kiwi?.templates?.onChanged(({ root }) => {
      if (root === workspaceRoot) void reloadProjectTemplates(workspaceRoot);
    });
  }, [reloadProjectTemplates, workspaceRoot]);
  const [frameworkInfo, setFrameworkInfo] = useState<{
    frameworks: string[];
    symbols: Array<{ kind: "endpoint" | "bean" | "property" | "fxml" | "entity" | "repository"; name: string; detail: string; path: string; line: number; targetPath?: string }>;
  }>({ frameworks: [], symbols: [] });
  const [javaNavigation, setJavaNavigation] = useState<JavaNavigationModel | null>(null);
  const [javaNavigationLoading, setJavaNavigationLoading] = useState(false);
  const [javaNavigationError, setJavaNavigationError] = useState("");
  const javaNavigationRequestRef = useRef(0);
  const javaNavigationLastKindRef = useRef<"call" | "type" | "usages" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({});
  const [replaceMode, setReplaceMode] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("commands");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [symbolResults, setSymbolResults] = useState<any[]>([]);
  const [activeDocument, setActiveDocument] = useState<WorkbenchDocument | null>(null);
  const [refactorPreview, setRefactorPreview] = useState<{
    items: WorkspaceEditPreviewItem[];
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [javaRefactorPlan, setJavaRefactorPlan] = useState<JavaRefactorPlan | null>(null);
  const [javaRefactorApplying, setJavaRefactorApplying] = useState(false);
  const [changeSignatureRequest, setChangeSignatureRequest] = useState<{
    file: string;
    position: { line: number; character: number };
    signature: JavaMethodSignature;
  } | null>(null);
  const [unusedPrivateAnalysis, setUnusedPrivateAnalysis] = useState<UnusedPrivateAnalysis | null>(null);
  const [unusedPrivateLoading, setUnusedPrivateLoading] = useState(false);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem("kiwi.fontSize") || 14));
  const [minimap, setMinimap] = useState(() => localStorage.getItem("kiwi.minimap") !== "false");
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem("kiwi.wordWrap") === "true");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [topMenu, setTopMenu] = useState<string | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [tabContext, setTabContext] = useState<TabContext | null>(null);
  const [projectWizardOpen, setProjectWizardOpen] = useState(false);
  const [hubCollabOpen, setHubCollabOpen] = useState(false);
  const [runConfigOpen, setRunConfigOpen] = useState(false);
  const [runConfigurations, setRunConfigurations] = useState<RunConfiguration[]>([]);
  const [activeRunConfigId, setActiveRunConfigId] = useState("");
  const [editingRunConfig, setEditingRunConfig] = useState<RunConfiguration | undefined>();
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [projectTaskComments, setProjectTaskComments] = useState<ProjectTaskComment[]>([]);
  const [buildProfiles, setBuildProfiles] = useState<BuildProfile[]>([]);
  const [taskCommentsLoading, setTaskCommentsLoading] = useState(false);
  const [taskCommentFilter, setTaskCommentFilter] = useState("all");
  const [diagnosticFilter, setDiagnosticFilter] = useState("all");
  const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
  /** The build file the dependency dialog opens on, set when it is opened from a module. */
  const [dependencyDialogTarget, setDependencyDialogTarget] = useState("");
  const [configDiagnostics, setConfigDiagnostics] = useState<Diagnostic[]>([]);
  const [bufferDiagnostics, setBufferDiagnostics] = useState<Record<string, Diagnostic[]>>({});
  const [moduleInfos, setModuleInfos] = useState<ModuleInfo[]>([]);
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const [openTaskGroups, setOpenTaskGroups] = useState<Set<string>>(
    new Set(["Häufig verwendet", "Anwendung", "Build", "Build-Lifecycle", "Verifikation", "Java"]),
  );
  const [dependencies, setDependencies] = useState("");
  const [dependencyTree, setDependencyTree] = useState<DependencyTree | null>(null);
  const [dependencyAudit, setDependencyAudit] = useState<DependencyAudit | null>(null);
  const [dependencyEditorModel, setDependencyEditorModel] = useState<DependencyEditorModel | null>(null);
  const [dependencyEditorLoading, setDependencyEditorLoading] = useState(false);
  const [dependencyEditorError, setDependencyEditorError] = useState("");
  const [markdownPreviewOpen, setMarkdownPreviewOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [rightTool, setRightTool] = useState<RightToolView | null>("build");
  const [rightToolDock, setRightToolDock] = useState<"left" | "right" | "bottom">(() => {
    const saved = localStorage.getItem("kiwi.workbench.dock");
    return saved === "left" || saved === "bottom" ? saved : "right";
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem("kiwi.workbench.sidebarWidth") || 260));
  const [panelHeight, setPanelHeight] = useState(() => Number(localStorage.getItem("kiwi.workbench.panelHeight") || 215));
  /** Width of a right-docked tool window; the left edge keeps its own. */
  // A side dock now shares a column with the Explorer or the build tool
  // window, so what it owns is a height and no longer a width. The old keys are
  // still read: their value was a width around three hundred pixels, which is a
  // reasonable height too, and reading it keeps an arranged workbench arranged.
  const [panelRightHeight, setPanelRightHeight] = useState(() => Number(
    localStorage.getItem("kiwi.workbench.panelRightHeight") || localStorage.getItem("kiwi.workbench.panelWidth") || 300));
  const [panelLeftHeight, setPanelLeftHeight] = useState(() => Number(
    localStorage.getItem("kiwi.workbench.panelLeftHeight") || localStorage.getItem("kiwi.workbench.panelLeftWidth") || 300));
  /** Active project's tool-window placement; the global setting is only the default for new projects. */
  const [panelViewDocks, setPanelViewDocks] = useState<PanelDocks>(() => sanitizePanelDocks(defaultIdeSettings.panelViewDocks));
  const panelViewDocksRef = useRef<PanelDocks>(panelViewDocks);
  /**
   * Which tab each edge is showing, and which edges the user closed.
   *
   * Several tool windows are on screen at once, so "the panel" no longer has a
   * single tab or a single visibility: selecting Terminal on the right must
   * leave the bottom edge showing whatever it was showing.
   */
  const [dockSelection, setDockSelection] = useState<DockSelection>({});
  const [hiddenDocks, setHiddenDocks] = useState<DockEdge[]>([]);
  /**
   * A side-docked output is a tab of the existing tool-window column.
   *
   * Keep only the choice between the column's regular tool and its output
   * group here; the selected output tab itself continues to live in
   * `dockSelection`, so project sessions and layout profiles remain compatible.
   */
  /** Position and size of the tool window that floats above the workbench. */
  const [floatingBounds, setFloatingBounds] = useState<FloatingBounds>(DEFAULT_FLOATING_BOUNDS);
  /** True while the tool window is open as a separate Kiwi window. */
  const [panelWindowOpen, setPanelWindowOpen] = useState(false);
  const floatingBoundsRef = useRef<FloatingBounds>(floatingBounds);
  const dockSelectionRef = useRef<DockSelection>(dockSelection);
  /** Tabs that exist right now; handlers outside render need them too. */
  const availablePanelViewsRef = useRef<PanelView[]>([]);
  /** Latest snapshot builder, for the publisher effect further down. */
  const panelSnapshotRef = useRef<(() => PanelWindowSnapshot) | null>(null);
  // The relay subscribes once and reaches the handlers through these, so a
  // detached window never talks to a stale closure.
  const openFileRef = useRef<(path: string, position?: { line: number; column: number; endLine?: number; endColumn?: number }) => Promise<void>>(async () => undefined);
  const openLibraryClassRef = useRef<(uri: string, position?: { line: number; column: number }) => Promise<boolean>>(async () => false);
  const editorOpenerRef = useRef<{ dispose: () => void } | null>(null);
  const stopJavaRef = useRef<() => Promise<void>>(async () => undefined);
  const showTerminalSessionRef = useRef<(sessionId: string) => void>(() => undefined);
  const clearPanelViewRef = useRef<() => void>(() => undefined);
  /** Target a panel drag is currently hovering, or "" while nothing is dragged. */
  const [panelDropEdge, setPanelDropEdge] = useState<"" | DropTarget>("");
  /** Flips once the editor and Monaco are available, so effects can attach to them. */
  const [editorReady, setEditorReady] = useState(false);
  /** Mirrors panelDropEdge for handlers that must read it after a pointer-up. */
  const panelDropEdgeRef = useRef<"" | DropTarget>("");
  /** Widths of the docked side windows, which are also the drop bands. */
  const dropSizesRef = useRef<{ left: number; right: number }>({ left: 300, right: 300 });
  const panelWindowOpenRef = useRef(false);
  /** The focused tool window, for handlers that run outside render. */
  const panelViewRef = useRef<PanelView>("terminal");
  const [rightToolSize, setRightToolSize] = useState(() => Number(localStorage.getItem("kiwi.workbench.rightToolSize") || 300));
  const [activeLayoutId, setActiveLayoutId] = useState("coding");
  const [rightToolMenuOpen, setRightToolMenuOpen] = useState(false);
  /** The edge whose side header has its overflow menu open, or "" for none. */
  const [sideMenuEdge, setSideMenuEdge] = useState<"" | DockEdge>("");
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);
  const [testReports, setTestReports] = useState<TestReport[]>([]);
  const [testHistory, setTestHistory] = useState<TestHistoryRun[]>([]);
  const [flakyTests, setFlakyTests] = useState<FlakyTest[]>([]);
  const [testProgress, setTestProgress] = useState({ running: false, current: "", completed: 0, total: 0, passed: 0, failed: 0, skipped: 0 });
  const [coverageFiles, setCoverageFiles] = useState<CoverageFile[]>([]);
  const [languageStatus, setLanguageStatus] = useState<"idle" | "starting" | "indexing" | "ready" | "missing" | "error">("idle");
  const [languageDetail, setLanguageDetail] = useState("");
  const [languageDiagnostics, setLanguageDiagnostics] = useState<Record<string, any[]>>({});
  languageDiagnosticsRef.current = languageDiagnostics;
  const [debugStatus, setDebugStatus] = useState("stopped");
  const [debugOutput, setDebugOutput] = useState("");
  const [watchExpression, setWatchExpression] = useState("");
  const [breakpoints, setBreakpoints] = useState<DebugBreakpoint[]>([]);
  const [splitPath, setSplitPath] = useState<string | null>(null);
  const [ideSettings, setIdeSettings] = useState<IdeSettings | null>(null);
  const [backgroundImageData, setBackgroundImageData] = useState("");
  const backgroundImageDataRef = useRef("");
  const [explorerContext, setExplorerContext] = useState<ExplorerContext | null>(null);
  const [explorerSubmenu, setExplorerSubmenu] = useState<ExplorerSubmenu | null>(null);
  const [explorerClipboard, setExplorerClipboard] = useState<ExplorerClipboard | null>(null);
  const explorerClipboardRef = useRef<ExplorerClipboard | null>(null);
  const explorerPasteInFlightRef = useRef<Promise<void> | null>(null);
  const updateExplorerClipboard = useCallback((value: ExplorerClipboard | null) => {
    explorerClipboardRef.current = value;
    setExplorerClipboard(value);
  }, []);
  const [explorerRootDragOver, setExplorerRootDragOver] = useState(false);
  const [inputRequest, setInputRequest] = useState<InputRequest | null>(null);
  /**
   * A yes-or-no question in the middle of the window, and its answer.
   *
   * Held as a promise so the code that asks reads in the order it happens:
   * ask, wait, and act only on a yes.
   */
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [javaTypeRequest, setJavaTypeRequest] = useState<JavaTypeRequest | null>(null);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [projectStructureOpen, setProjectStructureOpen] = useState(false);
  /**
   * What the build tool window has open, and what it has fetched.
   *
   * The root starts expanded and the subprojects do not: a build with twenty
   * modules would otherwise open as several hundred rows. Dependencies are
   * fetched when somebody opens them, because asking Gradle costs a build
   * configuration per project and nobody looks at all of them.
   */
  const [openBuildProjects, setOpenBuildProjects] = useState<Set<string>>(() => new Set([""]));
  const [openBuildBranches, setOpenBuildBranches] = useState<Set<string>>(() => new Set([" tasks "]));
  const [projectDependencies, setProjectDependencies] = useState<Map<string, BuildProjectDependencies>>(() => new Map());
  const [structureJdks, setStructureJdks] = useState<JdkInfo[]>([]);
  const [generateRequest, setGenerateRequest] = useState<{ kind: JavaGenerationKind; source: string } | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState>(emptyWorkflow);
  const [operations, setOperations] = useState<BackgroundOperation[]>([]);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetric[]>(() => storedJson("kiwi.performance.metrics.v1", []));
  /**
   * Where a regression is reported.
   *
   * Through a ref because the recorder is called from effects that must not be
   * rebuilt when an unrelated callback changes identity, and because the same
   * message must not arrive twice for one measurement.
   */
  const regressionRef = useRef<(message: string) => void>(() => undefined);
  const lastRegressionRef = useRef("");
  const [layoutProfiles, setLayoutProfiles] = useState<WorkbenchLayout[]>(() => storedJson("kiwi.workbench.layouts.v1", []));
  const layoutProfilesRef = useRef<WorkbenchLayout[]>([]);
  layoutProfilesRef.current = layoutProfiles;
  const [focusMode, setFocusMode] = useState(false);
  const [debugVariables, setDebugVariables] = useState<DebugVariable[]>([]);
  const [debugVariableChildren, setDebugVariableChildren] = useState<Record<string, DebugVariable[]>>({});
  const [debugStack, setDebugStack] = useState<DebugStackFrame[]>([]);
  const [debugThreads, setDebugThreads] = useState<DebugThread[]>([]);
  const [debugWatches, setDebugWatches] = useState<Array<DebugVariable & { expression: string }>>([]);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const gitHunkStagingRef = useRef<{ dispose: () => void; refresh: () => Promise<void> } | null>(null);
  const gitHunkModelListenerRef = useRef<{ dispose: () => void } | null>(null);
  const explorerMenuRef = useRef<HTMLDivElement | null>(null);
  const explorerSubmenuRef = useRef<HTMLDivElement | null>(null);
  const explorerSubmenuTimerRef = useRef<number | null>(null);
  const languageProviderRef = useRef<JavaLanguageController | null>(null);
  const polyglotProviderRef = useRef<ReturnType<typeof registerPolyglotLanguageProviders> | null>(null);
  const refactorPreviewRef = useRef<{
    items: WorkspaceEditPreviewItem[];
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const workspaceRootRef = useRef("");
  const workspaceTreesRef = useRef<Record<string, FileNode[]>>({});
  const expandedRef = useRef<Set<string>>(new Set());
  const explorerDragSourceRef = useRef("");
  const explorerSelectionAnchorRef = useRef("");
  const languageChangeTimer = useRef<number | null>(null);
  const breakpointHydratedRoot = useRef("");
  const outputRef = useRef("");
  const terminalOutputRef = useRef("");
  // One shell was enough while the panel showed a single terminal; a server in
  // one and a build in another needs them side by side. Only the visible
  // session streams into terminalOutputRef, the rest wait in this map.
  const terminalBuffers = useRef<Record<string, string>>({});
  const outputFlushTimer = useRef<number | null>(null);
  const treeRefreshInFlight = useRef<Set<string>>(new Set());
  const treeRefreshQueued = useRef<Set<string>>(new Set());
  const refreshTreeRequestRef = useRef<(root?: string) => Promise<void>>(async () => undefined);
  const testTargetsRef = useRef<JavaTestTarget[]>([]);
  const runTestTargetRef = useRef<(target: string) => void>(() => undefined);
  const sendHttpRequestRef = useRef<(line?: number) => void>(() => undefined);
  const directoryLoads = useRef<Map<string, Promise<void>>>(new Map());
  // A real double click delivers click + dblclick and therefore asks to open
  // the same file twice. Keep one IPC read in flight and let the second request
  // upgrade it to a pinned tab. Without this, the late read could put a tab
  // back after "Alle rechten Fenster schließen" had just removed it.
  const pendingFileOpens = useRef<Map<string, { promise: Promise<void>; permanentRequested: boolean }>>(new Map());
  const workspaceLoadEpoch = useRef(0);
  const watcherRefreshTimer = useRef<number | null>(null);
  const pendingWatchChanges = useRef<Array<{ path: string; kind?: string }>>([]);
  // Paths Kiwi itself just wrote. The Explorer already refreshed them, so the
  // file watcher must not schedule a second full rebuild for the same edit.
  const selfInflictedChanges = useRef<Map<string, number>>(new Map());
  /** CodeToGetter state stays alive while its right tool is temporarily closed. */
  const collabHostingRef = useRef(false);
  const collabHostedRootRef = useRef("");
  /** Remote Monaco edits fire onChange too; paths in this set must not echo. */
  const collabRemoteEditsRef = useRef<Set<string>>(new Set());
  /** A file's local changes have to reach the host service in Monaco order. */
  const collabEditQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  /** Confirmed and optimistically reserved revisions of each hosted document. */
  const collabFileVersionsRef = useRef<Map<string, number>>(new Map());
  const collabPlannedVersionsRef = useRef<Map<string, number>>(new Map());
  /** Incremented synchronously for every local Monaco event. */
  const collabLocalRevisionsRef = useRef<Map<string, number>>(new Map());
  const collabHostEpochRef = useRef(0);
  const collabResyncEpochsRef = useRef<Map<string, number>>(new Map());
  const scheduleCollabHostSnapshotRef = useRef<(root: string, relative: string, key: string) => void>(() => undefined);
  const panelDragCleanupRef = useRef<(() => void) | null>(null);
  /** Explorer paths of the running drag, handed to the OS once it leaves the window. */
  const nativeDragPathsRef = useRef<string[]>([]);
  /** Latest settings and compacted trees for callbacks that must stay stable. */
  const settingsRef = useRef<IdeSettings>(defaultIdeSettings);
  const projectedTreesRef = useRef<Record<string, FileNode[]>>({});
  const treeSpinnerTimer = useRef<number | null>(null);
  const projectSyncTimers = useRef<Map<string, number>>(new Map());
  const projectSyncInFlight = useRef<Set<string>>(new Set());
  const projectSyncQueued = useRef<Map<string, string>>(new Map());
  const projectSyncFingerprints = useRef<Map<string, string>>(new Map());
  const indexStartedAt = useRef<Map<string, number>>(new Map());
  const bootMetricRecorded = useRef(false);
  const scheduleProjectSyncRef = useRef<(root: string, changedPath: string) => void>(() => {});
  const debugStatusRef = useRef("stopped");
  const toggleBreakpointAtLineRef = useRef<(fileName: string, content: string, line: number, filePath?: string) => void>(() => undefined);
  // Monaco providers are installed once, while the selected project, file and
  // run configuration continue to change. The CodeLens calls this ref so it
  // always reaches the current workbench debug action instead of a stale
  // closure from the editor's first mount.
  /**
   * How a jump to another place in the file is shown.
   *
   * Read through a ref: most of these calls sit in callbacks that would
   * otherwise be rebuilt every time an unrelated setting moved.
   */
  const revealMotionRef = useRef<0 | 1>(1);
  const startDebugRef = useRef<(filePath?: string) => Promise<void>>(async () => undefined);
  /** Read through a ref so a guest's request does not resubscribe on every render. */
  const runJavaRef = useRef<(action: JavaAction, moduleId?: string, override?: RunConfiguration, targetFile?: string) => Promise<void>>(async () => undefined);
  const hotSwapTimersRef = useRef<Map<string, number>>(new Map());
  const hotSwapRequestsRef = useRef<Map<string, { previousSource?: string }>>(new Map());
  const hotSwapRelaunchingRef = useRef(false);
  const debugInlineDecorations = useRef<string[]>([]);
  /** The line the debugger is stopped on, marked so it can be seen. */
  const debugStoppedDecorations = useRef<string[]>([]);
  const [debugStoppedLine, setDebugStoppedLine] = useState<{ path: string; line: number } | null>(null);
  const breakpointDecorations = useRef<string[]>([]);
  const bookmarkDecorations = useRef<string[]>([]);
  const coverageDecorations = useRef<string[]>([]);
  const regionDecorations = useRef<string[]>([]);
  const activeTestRun = useRef<{ target?: string; automaticRetry: boolean } | null>(null);
  const activeJavaActionRef = useRef<JavaAction | null>(null);
  /** The tail of the build output, and the run folded out of it so far. */
  const testProgressStream = useRef(NO_TEST_PROGRESS);
  const testProgressRun = useRef(NO_TEST_RUN);
  const slowOperationsReported = useRef<Set<string>>(new Set());
  const memoryWarningShown = useRef(false);
  /** Said once per session: a rising floor does not become news again. */
  const memoryTrendReported = useRef(false);
  const performanceMetricsRef = useRef<PerformanceMetric[]>([]);
  const serviceLeakWarningShown = useRef(false);
  const automaticUpdateChecked = useRef(false);
  const completionSettingsRef = useRef({
    autoPopup: true,
    caseSensitive: false,
    insertImports: true,
    showDocumentation: true,
    prioritizeRecent: true,
    liveTemplates: true,
    postfixTemplates: true,
    finishStatements: true,
    localMembers: true,
    hoverDocumentation: false,
    commitCharacters: "(.;",
  });
  // Set once a project's tabs are on screen, so the session writer can tell a
  // finished restore apart from a load that is still in flight.
  const [sessionRestoredRoot, setSessionRestoredRoot] = useState("");
  /** Said once per session: the same list of files does not become news again. */
  const droppedDraftsReported = useRef(false);
  /** Set when a restore lost files, so the shorter result is not written back. */
  const restoreIncomplete = useRef(false);
  /** Said once: a session that cannot be written is worth knowing about. */
  const sessionSaveFailed = useRef(false);
  /** The last session written, so the shutdown can mark exactly that one done. */
  const lastPayload = useRef<Record<string, unknown>>({});
  /** Set once at start when the previous session did not end. */
  const [crashNotice, setCrashNotice] = useState("");

  const sessionsRef = useRef<Map<string, {
    files: OpenFile[];
    activePath: string | null;
    splitPath: string | null;
    panel: PanelView;
    panelVisible: boolean;
    panelViewDocks: PanelDocks;
    dockSelection: DockSelection;
    hiddenDocks: DockEdge[];
    panelHeight: number;
    panelRightHeight: number;
    panelLeftHeight: number;
    floatingBounds: FloatingBounds;
    terminalOutput: string;
    cursor: { line: number; column: number };
  }>>(new Map());
  const currentSessionRef = useRef({
    files: [] as OpenFile[],
    activePath: null as string | null,
    splitPath: null as string | null,
    panel: "terminal" as PanelView,
    panelVisible: true,
    panelViewDocks: {} as PanelDocks,
    dockSelection: {} as DockSelection,
    hiddenDocks: [] as DockEdge[],
    panelHeight: 215,
    panelRightHeight: 300,
    panelLeftHeight: 300,
    floatingBounds: DEFAULT_FLOATING_BOUNDS,
    terminalOutput: "",
    cursor: { line: 1, column: 1 },
  });
  panelViewDocksRef.current = panelViewDocks;
  dockSelectionRef.current = dockSelection;
  floatingBoundsRef.current = floatingBounds;
  currentSessionRef.current = {
    files: openFiles,
    activePath,
    splitPath,
    panel,
    panelVisible,
    panelViewDocks,
    dockSelection,
    hiddenDocks,
    panelHeight,
    panelRightHeight,
    panelLeftHeight,
    floatingBounds,
    terminalOutput,
    cursor,
  };
  terminalOutputRef.current = terminalOutput;
  workspaceTreesRef.current = workspaceTrees;
  expandedRef.current = expanded;

  const activeFile = openFiles.find((file) => file.path === activePath) || null;
  const activeEditorLanguage = activeFile?.language || projectInfo.language || "java";
  const [polyglotStatus, setPolyglotStatus] = useState<Record<string, { status: string; reason?: string; available: boolean }>>({});
  useEffect(() => {
    polyglotProviderRef.current?.refreshModels();
  }, [workspaceRoot, JSON.stringify(ideSettings?.languageServers || {})]);
  useEffect(() => {
    if (!window.kiwi?.polyglot) return;
    const removeStatus = window.kiwi.polyglot.onStatus((payload) => {
      if (payload.root && payload.root !== workspaceRootRef.current) return;
      setPolyglotStatus((current) => ({ ...current, [payload.languageId]: payload }));
    });
    const removeDiagnostics = window.kiwi.polyglot.onDiagnostics((payload) => {
      if (payload.root !== workspaceRootRef.current) return;
      setLanguageDiagnostics((current) => ({ ...current, [payload.uri]: payload.diagnostics || [] }));
    });
    const removeOutput = window.kiwi.polyglot.onOutput((payload) => {
      if (payload.root !== workspaceRootRef.current) return;
      appendBufferedOutput(payload.text);
    });
    const removeExit = window.kiwi.polyglot.onExit((payload) => {
      if (payload.root !== workspaceRootRef.current) return;
      appendBufferedOutput(`\nProzess beendet mit Code ${payload.code}.\n`);
      setRunning(false);
      setLastProcessExitCode(payload.code);
      if (payload.operationId) completeOperation(payload.operationId);
    });
    return () => { removeStatus(); removeDiagnostics(); removeOutput(); removeExit(); };
  }, []);
  /**
   * The file a run, a build or a debug is about.
   *
   * Not every tab is source: a class read out of a JAR and a bytecode listing
   * are both real tabs that can be focused, and both were handed to the build
   * as the file to compile. The failure came back from the compiler seconds
   * later, phrased as a missing file.
   */
  const runnableFile = useMemo(() => runnableSourceFor(openFiles, activePath || ""), [activePath, openFiles]);
  const splitFile = openFiles.find((file) => file.path === splitPath) || null;
  const activeRunConfiguration = runConfigurations.find((item) => item.id === activeRunConfigId);
  const activeModule = activeFile
    ? moduleInfos
      .filter((module) => isPathWithin(activeFile.path, module.root))
      .sort((left, right) => right.root.length - left.root.length)[0]
    : moduleInfos.find((module) => module.id === selectedModuleId) || moduleInfos[0];
  const explorerModuleRoots = useMemo(
    () => new Set(moduleInfos
      .filter((module) => module.relativePath !== ".")
      .map((module) => module.root.toLocaleLowerCase())),
    [moduleInfos],
  );
  /**
   * The active file's text, a beat behind the typing.
   *
   * Three passes read the whole buffer only to draw something beside the
   * editor — the breadcrumb, the TODO list, the test targets — and all three
   * were keyed on the live content, so every keystroke parsed the entire file
   * three times. At twenty thousand lines that is the difference between
   * eleven and seventy-eight milliseconds a character.
   *
   * None of them has to be exact while a key is going down; they have to be
   * right once the typing stops, which is what useDeferredValue promises: the
   * keystroke renders first and these follow when there is room.
   */
  const [settledContent, setSettledContent] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setSettledContent(activeFile?.content ?? ""), 250);
    return () => window.clearTimeout(handle);
  }, [activeFile?.content]);
  const javaBreadcrumb = useMemo(
    () => activeFile?.language === "java" ? javaBreadcrumbParts(settledContent, cursor.line) : null,
    [activeFile?.language, cursor.line, settledContent],
  );
  // Grouped once per project rather than once for the whole build. The root
  // folder holds the root's own tasks and each module holds its own, so a
  // multi-project build no longer lists every task twice — once bare and once
  // with the module in front of it.
  const groupedTasksByProject = useMemo(() => {
    const byProject = new Map<string, ReturnType<typeof groupProjectTasks>>();
    const paths = new Set(["", ...projectTasks.map((task) => taskProjectPath(task.name))]);
    for (const projectPath of paths) {
      byProject.set(projectPath, groupProjectTasks(tasksForProject(projectTasks, projectPath), taskQuery));
    }
    return byProject;
  }, [projectTasks, taskQuery]);
  const settings = useMemo(() => ({
    ...defaultIdeSettings,
    ...ideSettings,
    fontSize,
    minimap,
    wordWrap,
  }), [fontSize, ideSettings, minimap, wordWrap]);

  /**
   * The terminal's colours, handed over rather than inherited.
   *
   * xterm draws on a canvas and knows nothing about CSS variables, so a theme
   * that changed everything else left the terminal exactly as it was.
   */
  /**
   * A theme that follows the room rather than a menu.
   *
   * Checked on a slow tick and on the system's own change event — a schedule
   * that rewrote the theme on every render would fight anybody choosing one by
   * hand, and one that only checked at startup would sit in a light theme all
   * evening.
   *
   * Windows reports its light/dark mode through the same media query the web
   * uses, so nothing has to cross into the main process for it.
   */
  useEffect(() => {
    if (settings.themeSchedule === "off") return undefined;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const now = new Date();
      const wanted = scheduledTheme({
        schedule: settings.themeSchedule,
        dayTheme: settings.themeDay,
        nightTheme: settings.themeNight,
        dayStart: settings.themeDayStart,
        nightStart: settings.themeNightStart,
        systemPrefersDark: Boolean(media?.matches),
        now: now.getHours() * 60 + now.getMinutes(),
      });
      // An empty answer means "leave it alone", and writing the theme it
      // already has would be a settings write every minute.
      if (wanted && wanted !== settingsRef.current.theme) {
        void window.kiwi?.settings.update({ theme: wanted }).catch(() => undefined);
      }
    };
    apply();
    const timer = window.setInterval(apply, 60_000);
    media?.addEventListener?.("change", apply);
    return () => {
      window.clearInterval(timer);
      media?.removeEventListener?.("change", apply);
    };
  }, [
    settings.themeDay,
    settings.themeDayStart,
    settings.themeNight,
    settings.themeNightStart,
    settings.themeSchedule,
  ]);


  /**
   * The picture this project asked for.
   *
   * Read for itself rather than out of `projectInfo`: that is refreshed by
   * events the workbench does not always receive — a settings change made in
   * this window is broadcast to every other one — and a picture that appears
   * only after something unrelated happens is a picture nobody trusts.
   */
  const [projectBackgroundImage, setProjectBackgroundImage] = useState("");
  const [projectFonts, setProjectFonts] = useState<{ family: string; fallbacks: string }>({ family: "", fallbacks: "" });
  useEffect(() => {
    let cancelled = false;
    if (!workspaceRoot || !window.kiwi) {
      setProjectBackgroundImage("");
      return undefined;
    }
    const read = () => {
      void window.kiwi?.project.getSettings(workspaceRoot)
        .then((project) => {
          if (cancelled) return;
          setProjectBackgroundImage(project?.backgroundImage || "");
          setProjectFonts({ family: project?.fontFamily || "", fallbacks: project?.fontFallbacks || "" });
        })
        .catch(() => {
          if (cancelled) return;
          setProjectBackgroundImage("");
          setProjectFonts({ family: "", fallbacks: "" });
        });
    };
    read();
    const stop = window.kiwi.project.onSettingsChanged(({ root, patch }) => {
      if (!samePath(root, workspaceRoot)) return;
      if ("backgroundImage" in patch || "fontFamily" in patch || "fontFallbacks" in patch) read();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [workspaceRoot]);

  /**
   * How the editor should feel here.
   *
   * The project's font wins over the global one and nothing else does: a
   * project full of box-drawing characters wants its own face, not its own
   * caret speed.
   */
  const editorFeel = useMemo(() => ({
    cursorBlinkMs: settings.cursorBlinkMs,
    cursorAnimation: settings.cursorAnimation,
    smoothScrolling: settings.smoothScrolling,
    revealMotion: settings.revealMotion,
    lineHighlight: settings.lineHighlight,
    commentFont: settings.commentFont,
    inlayFont: settings.inlayFont,
    inlayFontScale: settings.inlayFontScale,
    ligatures: settings.ligatures,
    fontFallbacks: projectFonts.fallbacks || settings.fontFallbacks,
    minimapOpacity: settings.minimapOpacity,
    focusMaxWidth: settings.focusMaxWidth,
    stickyEmphasis: settings.stickyEmphasis,
    breadcrumbEmphasis: settings.breadcrumbEmphasis,
  }), [
    projectFonts.fallbacks,
    settings.breadcrumbEmphasis,
    settings.commentFont,
    settings.cursorAnimation,
    settings.cursorBlinkMs,
    settings.focusMaxWidth,
    settings.fontFallbacks,
    settings.inlayFont,
    settings.inlayFontScale,
    settings.ligatures,
    settings.lineHighlight,
    settings.minimapOpacity,
    settings.revealMotion,
    settings.smoothScrolling,
    settings.stickyEmphasis,
  ]);

  revealMotionRef.current = revealScrollType(editorFeel, settings.reducedMotion);

  const genericBracketDecorations = useRef<string[]>([]);
  /**
   * Colours the angle brackets of nested generics.
   *
   * Monaco colours round, square and curly brackets by depth and leaves angle
   * brackets alone, because in Java one is a comparison as often as it is a
   * type argument. But `Map<String, List<Map<String, Set<Integer>>>>` is
   * exactly where the colouring earns its keep, so the pairs that are
   * certainly type arguments get the same treatment and the doubtful ones are
   * left plain.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return undefined;
    if (!settings.genericBracketColorization || !settings.bracketPairColorization
      || model.getLanguageId() !== "java") {
      genericBracketDecorations.current = editor.deltaDecorations(genericBracketDecorations.current, []);
      return undefined;
    }
    // After a beat: this runs on every keystroke otherwise, and a scan of the
    // whole file per character is the kind of cost nobody asked for.
    const timer = window.setTimeout(() => {
      const text = model.getValue();
      genericBracketDecorations.current = editor.deltaDecorations(
        genericBracketDecorations.current,
        genericBracketSpans(text).flatMap((span) => {
          const open = model.getPositionAt(span.start);
          const close = model.getPositionAt(span.end);
          const className = `kiwi-generic-bracket-${bracketColorIndex(span.depth)}`;
          return [
            {
              range: {
                startLineNumber: open.lineNumber,
                startColumn: open.column,
                endLineNumber: open.lineNumber,
                endColumn: open.column + 1,
              },
              options: { inlineClassName: className },
            },
            {
              range: {
                startLineNumber: close.lineNumber,
                startColumn: close.column,
                endLineNumber: close.lineNumber,
                endColumn: close.column + 1,
              },
              options: { inlineClassName: className },
            },
          ];
        }),
      );
    }, 220);
    return () => window.clearTimeout(timer);
  }, [
    activePath,
    settledContent,
    settings.bracketPairColorization,
    settings.genericBracketColorization,
  ]);

  /** The colour comments currently have, which is how their class is found. */
  const commentColor = useMemo(
    () => resolveTokenColors(findTheme(settings.theme), settings.editorTokenColors, settings.editorColorScheme).comment,
    [settings.editorColorScheme, settings.editorTokenColors, settings.theme],
  );

  /**
   * Comments in a face of their own.
   *
   * Prose set in a monospace face is prose nobody reads, but Monaco does not
   * name its token spans — it numbers them by the position of their colour in
   * the theme and injects a stylesheet saying which number is which colour.
   * So the number is looked up there and one rule is written for it, and the
   * lookup is redone whenever the theme or the colours move.
   *
   * Failing quietly is the right failure: no rule means comments in the code
   * font, which is what they always were.
   */
  useEffect(() => {
    const id = "kiwi-comment-font";
    const existing = document.getElementById(id);
    if (!settings.commentFont) {
      existing?.remove();
      return undefined;
    }
    // After a repaint, so Monaco's own stylesheet is in the document.
    const timer = window.setTimeout(() => {
      const rules: Array<{ selector: string; color: string }> = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let list: CSSRuleList | null = null;
        try {
          list = sheet.cssRules;
        } catch {
          // A stylesheet from another origin cannot be read, and none of
          // Monaco's are.
          continue;
        }
        for (const rule of Array.from(list || [])) {
          const styleRule = rule as CSSStyleRule;
          if (!styleRule.selectorText || !styleRule.style?.color) continue;
          rules.push({ selector: styleRule.selectorText, color: styleRule.style.color });
        }
      }
      const token = tokenClassForColor(rules, commentColor);
      const node = existing instanceof HTMLStyleElement
        ? existing
        : Object.assign(document.createElement("style"), { id });
      node.textContent = token
        ? ".monaco-editor .mtk" + token + " { font-family: var(--comment-font, var(--editor-font)); }"
        : "";
      if (!node.isConnected) document.head.append(node);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [commentColor, settings.commentFont]);

  /** The face the editor is set in here, project first. */
  const editorFont = useMemo(
    () => editorFontStack(projectFonts.family || settings.fontFamily, editorFeel.fontFallbacks),
    [editorFeel.fontFallbacks, projectFonts.family, settings.fontFamily],
  );

  /**
   * The picture that applies here.
   *
   * A project's own image wins over the global one, and only the image:
   * somebody who set a photograph for one project did not mean to reset its
   * blur, so everything else still comes from the global settings.
   */
  const activeBackground = useMemo(() => backgroundFor({
    image: settings.backgroundImage,
    playlist: settings.backgroundPlaylist,
    rotateSeconds: settings.backgroundRotateSeconds,
    opacity: settings.backgroundOpacity,
    editorOpacity: settings.backgroundEditorOpacity,
    explorerOpacity: settings.backgroundExplorerOpacity,
    terminalOpacity: settings.backgroundTerminalOpacity,
    anchor: settings.backgroundAnchor,
    fit: settings.backgroundFit,
    scale: settings.backgroundScale,
    blur: settings.backgroundBlur,
    tint: settings.backgroundTint,
    parallax: settings.backgroundParallax,
    focusStrength: settings.backgroundFocusStrength,
    allowAnimation: settings.backgroundAllowAnimation,
  }, projectBackgroundImage ? { image: projectBackgroundImage } : null), [
    projectBackgroundImage,
    settings.backgroundAllowAnimation,
    settings.backgroundAnchor,
    settings.backgroundBlur,
    settings.backgroundEditorOpacity,
    settings.backgroundExplorerOpacity,
    settings.backgroundFit,
    settings.backgroundFocusStrength,
    settings.backgroundImage,
    settings.backgroundOpacity,
    settings.backgroundParallax,
    settings.backgroundPlaylist,
    settings.backgroundRotateSeconds,
    settings.backgroundScale,
    settings.backgroundTerminalOpacity,
    settings.backgroundTint,
  ]);

  /**
   * Which of several pictures is showing.
   *
   * Turned over on a clock rather than on a render, so the picture does not
   * change every time something else does.
   */
  const [backgroundScroll, setBackgroundScroll] = useState(0);
  const [backgroundSince] = useState(() => Date.now());
  const [backgroundTick, setBackgroundTick] = useState(0);
  /**
   * How many pictures there are, and how often they change.
   *
   * Depended on by value rather than by identity: the settings memo rebuilds
   * its arrays, so an effect keyed on the array itself tore the timer down and
   * started it again on every render and never reached the first second.
   */
  const rotateEvery = Math.max(0, Math.round(activeBackground.rotateSeconds));
  const rotateCount = activeBackground.playlist.filter(Boolean).length;
  useEffect(() => {
    if (!rotateEvery || rotateCount < 2) return undefined;
    const timer = window.setInterval(() => setBackgroundTick((value) => value + 1), rotateEvery * 1000);
    return () => window.clearInterval(timer);
  }, [rotateCount, rotateEvery]);

  /**
   * How far the editor has been scrolled, for the drift.
   *
   * Sampled rather than followed: a state update on every scroll event would
   * re-render the workbench while somebody is reading, which is a far worse
   * thing than a picture that lags a frame behind.
   */
  useEffect(() => {
    if (!activeBackground.parallax) {
      setBackgroundScroll(0);
      return undefined;
    }
    const editor = editorRef.current;
    if (!editor) return undefined;
    let pending = 0;
    const listener = editor.onDidScrollChange((event) => {
      if (pending) return;
      pending = window.requestAnimationFrame(() => {
        pending = 0;
        setBackgroundScroll(event.scrollTop);
      });
    });
    return () => {
      if (pending) window.cancelAnimationFrame(pending);
      listener.dispose();
    };
  }, [activeBackground.parallax, activePath, settledContent]);

  const backgroundPath = useMemo(
    () => currentBackgroundImage(activeBackground, (Date.now() - backgroundSince) / 1000),
    // backgroundTick is what makes this recompute on the clock; it is not read.
    [activeBackground, backgroundSince, backgroundTick],
  );

  const terminalColors = useMemo(() => ({
    background: settings.themeColorOverrides?.terminalBackground
      ? `#${settings.themeColorOverrides.terminalBackground}` : "",
    foreground: settings.themeColorOverrides?.terminalForeground
      ? `#${settings.themeColorOverrides.terminalForeground}` : "",
  }), [settings.themeColorOverrides]);

  /**
   * Writes the layout the restore path at project load reads back: which
   * directories are open in the Explorer and which editors are on screen.
   * Both are stored per project root so switching projects keeps its own
   * arrangement, and both are rewritten on every change rather than only on
   * quit, because a crash or a killed process never reaches an exit hook.
   */
  useEffect(() => {
    if (!workspaceRoot || !settings.restoreExplorerState) return;
    const handle = window.setTimeout(() => {
      storeJson(`kiwi.explorer.expanded.v1:${workspaceRoot}`, [...expanded]);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [expanded, settings.restoreExplorerState, workspaceRoot]);

  // A detached tool window draws what the workbench publishes. Publishing on a
  // short timer rather than on every state change keeps a streaming build from
  // sending a snapshot per line, and nothing is published while no window is
  // open to receive it.
  useEffect(() => {
    if (!window.kiwi) return undefined;
    void window.kiwi.panel.windowState().then((state) => setPanelWindowOpen(state.open)).catch(() => undefined);
    return window.kiwi.panel.onWindowState((state) => setPanelWindowOpen(state.open));
  }, []);

  useEffect(() => {
    if (!panelWindowOpen || !window.kiwi) return undefined;
    const publish = () => {
      const snapshot = panelSnapshotRef.current?.();
      if (snapshot) window.kiwi?.panel.publish(snapshot);
    };
    publish();
    const handle = window.setInterval(publish, 250);
    return () => window.clearInterval(handle);
  }, [panelWindowOpen]);

  // A click in the detached window is carried out here, by the same handlers
  // the workbench uses itself. Nothing is duplicated: the other window decides
  // what should happen, this one knows how.
  useEffect(() => {
    if (!window.kiwi) return undefined;
    return window.kiwi.panel.onRequest((command) => {
      const root = workspaceRootRef.current;
      switch (command.type) {
        case "selectView":
          setPanelVisible(true);
          setPanel(command.view);
          break;
        case "selectDiagnostic":
          void openFileRef.current(command.path, {
            line: command.line,
            column: command.column,
            endLine: command.endLine,
            endColumn: command.endColumn,
          });
          break;
        case "setDiagnosticFilter":
          setDiagnosticFilter(command.filter);
          break;
        case "openTodo":
          void openFileRef.current(command.path, { line: command.line, column: command.column });
          break;
        case "clear":
          clearPanelViewRef.current();
          break;
        case "stopProcess":
          void stopJavaRef.current();
          break;
        case "debugCommand":
          void window.kiwi?.debug.command(command.command, command.argument).catch(() => undefined);
          break;
        case "selectThread":
          void window.kiwi?.debug.command("selectThread", String(command.threadId)).catch(() => undefined);
          break;
        case "selectFrame":
          void window.kiwi?.debug.command("selectFrame", String(command.frameId)).catch(() => undefined);
          break;
        case "expandVariable":
          void window.kiwi?.debug.command("variables", String(command.referenceId)).catch(() => undefined);
          break;
        case "runTest":
          runTestTargetRef.current(command.testCase || command.report);
          break;
        case "terminalInput":
          if (root) void window.kiwi?.terminal.input(root, command.text, command.sessionId).catch(() => undefined);
          break;
        case "selectTerminal":
          showTerminalSessionRef.current(command.sessionId);
          break;
        case "attach":
          setPanelWindowOpen(false);
          break;
        default:
          break;
      }
    });
  }, []);

  // Selecting a tool window makes it the focused one and brings its edge back
  // if that edge had been closed. Every other edge keeps the tab it was
  // showing, which is what lets Terminal sit on the right while Problems stays
  // at the bottom.
  useEffect(() => {
    const edge = dockOf(panelViewDocks, panel);
    setDockSelection((current) => current[edge] === panel ? current : { ...current, [edge]: panel });
    setHiddenDocks((current) => current.includes(edge) ? current.filter((item) => item !== edge) : current);
  }, [panel, panelViewDocks]);

  /**
   * Puts a stored tool-window layout back on screen.
   *
   * Sessions, layout profiles and the update recovery snapshot all write the
   * same shape, so they all read it back through one validated path instead of
   * three places that could drift apart.
   */
  const applyPanelLayout = useCallback((layout: PersistedPanelLayout | null, fallbackDocks?: PanelDocks) => {
    const isVisible = layout?.panelVisible ?? true;
    setPanelVisible(isVisible);
    const restoredDocks = sanitizePanelDocks(layout?.panelViewDocks, sanitizePanelDocks(fallbackDocks));
    setPanelViewDocks(restoredDocks);
    const restoredSelection = sanitizeDockSelection(layout?.dockSelection);
    if (isVisible) {
      setPanel("terminal");
      const terminalEdge = dockOf(restoredDocks, "terminal");
      restoredSelection[terminalEdge] = "terminal";
    } else if (layout?.panel) {
      setPanel(sanitizePanelView(layout.panel, "terminal"));
    }
    setDockSelection(restoredSelection);
    setHiddenDocks(sanitizeDockEdges(layout?.hiddenDocks));
    setPanelHeight(Math.max(120, Number(layout?.panelHeight) || 215));
    setPanelRightHeight(Math.max(220, Number(layout?.panelRightHeight) || 300));
    setPanelLeftHeight(Math.max(220, Number(layout?.panelLeftHeight ?? layout?.panelRightHeight) || 300));
    setFloatingBounds(sanitizeFloatingBounds(layout?.floatingBounds));
  }, []);

  /** Everything that describes where the tool windows are and what they show. */
  const panelLayoutSnapshot = useCallback(() => {
    const session = currentSessionRef.current;
    return {
      panel: session.panel,
      panelVisible: session.panelVisible,
      panelViewDocks: session.panelViewDocks,
      dockSelection: session.dockSelection,
      hiddenDocks: session.hiddenDocks,
      panelHeight: session.panelHeight,
      panelRightHeight: session.panelRightHeight,
      panelLeftHeight: session.panelLeftHeight,
      floatingBounds: session.floatingBounds,
    };
  }, []);

  // Tool-window placement is workbench state, not an editor-buffer setting.
  // Keep it per project even when restoring tabs has been disabled.
  useEffect(() => {
    if (!workspaceRoot || sessionRestoredRoot !== workspaceRoot) return;
    const persist = () => storeJson(`kiwi.panel.layout.v1:${workspaceRoot}`, panelLayoutSnapshot());
    const handle = window.setTimeout(persist, 250);
    // Both events, because a window does not see "beforeunload" on every way
    // it can go away — quitting the application is one of the ways it does
    // not — and what is being saved is a quarter of a second of work.
    window.addEventListener("beforeunload", persist);
    window.addEventListener("pagehide", persist);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("beforeunload", persist);
      window.removeEventListener("pagehide", persist);
    };
  }, [dockSelection, floatingBounds, hiddenDocks, panel, panelHeight, panelLayoutSnapshot, panelLeftHeight, panelViewDocks, panelVisible, panelRightHeight, sessionRestoredRoot, workspaceRoot]);

  /*
   * What the debounced write watches.
   *
   * The tab layout used to be the whole of it, because the draft text was left
   * to the shutdown hook. That hook does not run when a process is killed, so
   * the drafts are written here now — which means this key has to move when a
   * buffer does, or the timer arms once on mount and never again. That was the
   * shape of the bug: the write existed, ran once, and was never scheduled
   * after anything anybody typed.
   *
   * The length rather than the text: it changes on every edit, and hashing a
   * megabyte of source on each keystroke to decide whether to save it would
   * cost more than the save.
   */
  const sessionLayoutKey = `${openFiles.map((file) => `${file.path}:${file.content.length}:${file.content === file.savedContent ? "" : "*"}`).join("\u0000")}|${activePath}|${splitPath}|${JSON.stringify(panelLayoutSnapshot())}`;
  useEffect(() => {
    // While a project is still loading the open tabs still belong to the
    // previous one; writing them now would file them under the new root.
    if (!workspaceRoot || !settings.restoreSession || sessionRestoredRoot !== workspaceRoot) return;
    // See the restore: the stored session is the only copy of an unsaved
    // draft, and a restore that could not read its files must not have that
    // shorter list written back over it.
    if (restoreIncomplete.current) return;
    const persist = () => {
      const session = currentSessionRef.current;
      /*
       * Drafts on every write, not only on unload.
       *
       * A crashed renderer, a killed process and a power cut all fire no
       * unload event, so the write that used to carry the drafts is exactly
       * the one that does not happen when they are needed. Bounded, because
       * writing every keystroke of a large file into local storage would make
       * typing wait on a disk.
       */
      const stored = draftsToStore(session.files.slice(0, 12));
      const payload = {
        // Set while the session is live and cleared on the way out, so a start
        // that reads "running" knows the last one was cut off. In the file
        // rather than in local storage, which loses precisely the write that
        // would have said so.
        running: true,
        files: stored.files,
        activePath: session.activePath,
        splitPath: session.splitPath,
        ...panelLayoutSnapshot(),
        cursor: session.cursor,
      };
      storeJson(`kiwi.session.v2:${workspaceRoot}`, payload);
      lastPayload.current = payload;
      // And on disk, through the main process. Local storage is written on
      // Chromium's own schedule, so a killed process loses whatever had not
      // been flushed — which measuring showed is the normal outcome, not a
      // rare edge. The draft written a second before a crash was simply gone.
      void window.kiwi?.workspace.saveSession(workspaceRoot, payload).catch((error) => {
        // Said once. A session that cannot be written is the difference
        // between losing nothing and losing a morning, and swallowing the
        // failure is how it stayed unnoticed while being wired up.
        if (sessionSaveFailed.current) return;
        sessionSaveFailed.current = true;
        toast(error instanceof Error
          ? `Die Sitzung kann nicht gesichert werden: ${error.message}`
          : "Die Sitzung kann nicht gesichert werden.", "error");
      });
      // Where each file was left goes with it. Not part of the session —
      // that is what is open — but written on the same beat, because both
      // are worth exactly as much as the last moment they were saved.
      void persistProjectStates();
      // Said once per session and named, because "some drafts were not kept"
      // leaves somebody guessing which file to check.
      if (stored.dropped.length && !droppedDraftsReported.current) {
        droppedDraftsReported.current = true;
        toast(describeDroppedDrafts(stored.dropped), "info");
      }
    };
    const onUnload = () => {
      persist();
      // Best effort and deliberately not awaited: an unload handler that waits
      // on IPC is an unload handler that gets cut off.
      void window.kiwi?.workspace.saveSession(workspaceRoot, { ...lastPayload.current, running: false })
        .catch(() => undefined);
      void persistProjectStates();
    };
    const handle = window.setTimeout(persist, 400);
    // The session is the open tabs, the caret and any unsaved draft. Written
    // on both unload events for the same reason as the layout above: the
    // debounce is what would otherwise be lost, and it is exactly the part
    // somebody just typed.
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  // sessionLayoutKey is what re-arms the timer; it is read for its identity
  // rather than its value, which is why the linter cannot see the use.
  }, [panelLayoutSnapshot, sessionLayoutKey, sessionRestoredRoot, settings.restoreSession, workspaceRoot]);

  // An automatic update may arrive while files are still dirty. Unlike the
  // normal best-effort layout writer, this emergency snapshot is verified
  // synchronously. The preload reports a failed write to the main process and
  // the update is aborted instead of risking an unsaved editor buffer.
  useEffect(() => {
    if (!workspaceRoot || sessionRestoredRoot !== workspaceRoot) return undefined;
    const persistForUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ version?: string; failures?: string[] }>).detail;
      try {
        const session = currentSessionRef.current;
        const key = `kiwi.update.recovery.v1:${workspaceRoot}`;
        const serialized = JSON.stringify({
          version: 1,
          sourceVersion: __APP_VERSION__,
          targetVersion: String(detail?.version || ""),
          createdAt: new Date().toISOString(),
          files: session.files.map((file) => (
            file.content !== file.savedContent
              ? { path: file.path, content: file.content }
              : { path: file.path }
          )),
          activePath: session.activePath,
          splitPath: session.splitPath,
          ...panelLayoutSnapshot(),
          cursor: session.cursor,
        });
        localStorage.setItem(key, serialized);
        if (localStorage.getItem(key) !== serialized) {
          throw new Error("Der gespeicherte Sitzungsstand konnte nicht verifiziert werden.");
        }
      } catch (error) {
        const message = error instanceof Error
          ? `Update abgebrochen: ${error.message}`
          : "Update abgebrochen: Offene Dateien konnten nicht gespeichert werden.";
        detail?.failures?.push(message);
        document.documentElement.setAttribute("data-kiwi-update-prepare-error", message);
      }
    };
    window.addEventListener("kiwi:update-prepare", persistForUpdate);
    return () => window.removeEventListener("kiwi:update-prepare", persistForUpdate);
  }, [panelLayoutSnapshot, sessionRestoredRoot, workspaceRoot]);

  // Anything the user has not bound falls back to the catalogue default, so
  // new commands work out of the box without touching stored settings.
  const keys = useMemo(() => resolveKeybindings(settings.customKeybindings), [settings.customKeybindings]);

  const shellStyle = {
    // The whole accent family, not just one of its four tokens: the stylesheet
    // derives --green from --accent, so overriding only --green left every
    // rule written against --accent showing the theme's colour instead of the
    // chosen one — two accents side by side in the same window.
    ...accentPalette(settings.accentColor),
    "--explorer-icon-size": `${settings.explorerIconSize}px`,
    "--explorer-indent": `${settings.explorerIndent}px`,
    "--sidebar-width": `${sidebarWidth}px`,
    "--panel-height": `${panelHeight}px`,
    "--panel-right-height": `${panelRightHeight}px`,
    "--panel-left-height": `${panelLeftHeight}px`,
    "--right-tool-size": `${rightToolSize}px`,
    ...backgroundVariables(activeBackground, backgroundImageData, {
      focusMode,
      scrolled: backgroundScroll,
    }),
    "--editor-font": editorFont,
    ...editorFeelVariables(editorFeel, {
      reducedMotion: settings.reducedMotion,
      fontSize: settings.fontSize,
    }),
  } as CSSProperties;
  useEffect(() => {
    let cancelled = false;
    if (!backgroundPath || !window.kiwi) {
      setBackgroundImageData("");
      return;
    }
    void window.kiwi.settings.backgroundImageData(backgroundPath)
      .then((data) => {
        if (!cancelled) setBackgroundImageData(data);
      })
      .catch(() => {
        if (!cancelled) setBackgroundImageData("");
      });
    return () => {
      cancelled = true;
    };
  }, [backgroundPath]);
  // The configured ranking is the standing default; the completion actions set
  // it explicitly per keystroke. Without this the setting was stored and never
  // read, so automatic suggestions always ranked as "basic".
  languageProviderRef.current?.setCompletionIntent(settings.completionMode);
  completionSettingsRef.current = {
    autoPopup: settings.completionAutoPopup,
    caseSensitive: settings.completionCaseSensitive,
    insertImports: settings.completionInsertImports,
    showDocumentation: settings.completionShowDocumentation,
    prioritizeRecent: settings.completionPrioritizeRecent,
    liveTemplates: settings.completionLiveTemplates,
    postfixTemplates: settings.completionPostfixTemplates,
    finishStatements: settings.completionFinishStatements,
    localMembers: settings.completionLocalMembers,
    commitCharacters: settings.completionCommitCharacters,
    hoverDocumentation: settings.hoverDocumentation,
  };
  /**
   * Two drag-and-drop safeguards that have to sit above every drop zone.
   *
   * Without a default-prevented dragover/drop pair, a file released next to a
   * drop target makes Chromium navigate the window to it and the whole
   * workbench disappears. And the native OS drag may only start once the
   * pointer has left the window, because webContents.startDrag() ends the HTML
   * drag session that internal moves rely on.
   */
  useEffect(() => {
    const allowDrop = (event: DragEvent) => event.preventDefault();
    const blockStrayDrop = (event: DragEvent) => {
      event.preventDefault();
      nativeDragPathsRef.current = [];
    };
    const leaveWindow = (event: DragEvent) => {
      const paths = nativeDragPathsRef.current;
      // relatedTarget is null exactly when the pointer leaves the window.
      if (!paths.length || event.relatedTarget || event.clientX > 0 || event.clientY > 0) return;
      nativeDragPathsRef.current = [];
      window.kiwi?.file.startDrag(paths);
    };
    const endDrag = () => { nativeDragPathsRef.current = []; };
    document.addEventListener("dragover", allowDrop);
    document.addEventListener("drop", blockStrayDrop);
    document.addEventListener("dragleave", leaveWindow);
    document.addEventListener("dragend", endDrag);
    return () => {
      document.removeEventListener("dragover", allowDrop);
      document.removeEventListener("drop", blockStrayDrop);
      document.removeEventListener("dragleave", leaveWindow);
      document.removeEventListener("dragend", endDrag);
    };
  }, []);

  // The whole palette hangs off this attribute; styles.css derives every
  // surface, border and text step from the anchors it selects.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", findTheme(settings.theme).id);
  }, [settings.theme]);
  // The ramps are derived on the document element, where the theme lives, so
  // the accent and the nudge on top of it have to be set there too: a value
  // inherited from the root is already resolved by the time a descendant tries
  // to change what it was derived from.
  useEffect(() => {
    const style = document.documentElement.style;
    const values = personalizationVariables(settings);
    for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(values)) style.removeProperty(name);
    };
  }, [
    settings.accentColor, settings.theme, settings.themeShade, settings.themeTint,
    settings.themeContrast, settings.accentIntensity, settings.themeColorOverrides,
    settings.uiRoundness, settings.borderStrength, settings.shadowStrength, settings.uiFont,
  ]);
  // Monaco needs its themes rebuilt when the wallpaper is switched on or off,
  // because that decides whether the editor and minimap clear transparently.
  backgroundImageDataRef.current = backgroundImageData;
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineMonacoThemes(monaco, Boolean(backgroundImageData), settings.editorTokenColors, settings.editorColorScheme, settings.themeColorOverrides);
    monaco.editor.setTheme(monacoThemeId(settings.theme));
  }, [backgroundImageData, settings.editorColorScheme, settings.editorTokenColors, settings.theme, settings.themeColorOverrides]);
  useEffect(() => {
    const bodyStyle = document.body.style as CSSStyleDeclaration & { zoom: string };
    bodyStyle.zoom = String(settings.uiScale);
    return () => {
      bodyStyle.zoom = "";
    };
  }, [settings.uiScale]);

  /**
   * Keeps the docked panels inside the window.
   *
   * A width that was comfortable on a large screen at 100 % swallows a small
   * window at 150 %, and the stored value survives both changes — so it has to
   * be re-clamped whenever the scale or the window changes.
   */
  useEffect(() => {
    const fit = () => {
      const room = effectiveViewport();
      setSidebarWidth((value) => Math.max(180, Math.min(value, Math.max(180, room.width * 0.5))));
      setPanelHeight((value) => Math.max(120, Math.min(value, Math.max(120, room.height * 0.65))));
      setRightToolSize((value) => Math.max(150, Math.min(value, Math.max(150, room.width * 0.5))));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [settings.uiScale]);
  /**
   * Every file in the project, whether or not the tree has been expanded to it.
   *
   * The palette searched the Explorer's tree, and that tree loads one level at
   * a time — measured on a five-level package, the search answered nothing at
   * all until five folders had been clicked open, which is the work it exists
   * to avoid. The stored list is read on open, which is instant, and a walk
   * runs behind it when it is old.
   */
  const [projectIndex, setProjectIndex] = useState<ProjectIndex>(() => emptyIndex(""));
  const projectIndexRef = useRef(projectIndex);
  projectIndexRef.current = projectIndex;

  useEffect(() => {
    if (!workspaceRoot || !window.kiwi?.projectIndex) {
      setProjectIndex(emptyIndex(""));
      return;
    }
    let current = true;
    void (async () => {
      const stored = await window.kiwi!.projectIndex.load(workspaceRoot).catch(() => null);
      const loaded = readProjectIndex(stored?.text || "", workspaceRoot);
      if (!current) return;
      setProjectIndex(loaded);
      // Shown first, walked after: the list from last time is right about
      // almost everything and wrong about nothing that matters for a second.
      if (!indexNeedsRefresh(loaded, Date.now())) return;
      const built = await window.kiwi!.projectIndex.build(workspaceRoot).catch(() => null);
      if (current && built) setProjectIndex(readProjectIndex(JSON.stringify(built), workspaceRoot));
    })();
    return () => { current = false; };
  }, [workspaceRoot]);

  const allFiles = useMemo(() => flattenFiles(tree), [tree]);
  const buildReport = useMemo(
    () => parseBuildReport(output, {
      running: running && lastJavaAction === "build",
      exitCode: lastProcessExitCode,
    }),
    [lastJavaAction, lastProcessExitCode, output, running],
  );
  const buildOutputGroups = useMemo(() => groupBuildOutputByModule(buildReport.raw), [buildReport.raw]);
  useEffect(() => {
    if (!workspaceRoot) {
      setBuildHistory([]);
      return;
    }
    setBuildHistory(storedJson<BuildHistoryEntry[]>(`kiwi.build.history.v1:${workspaceRoot}`, []).slice(0, 30));
  }, [workspaceRoot]);
  const activeBuildDiagnostics = useMemo(() => {
    if (!buildReport.diagnostics.length) return [];
    return buildReport.diagnostics.filter((diagnostic) => {
      const isDirty = openFiles.some((f) => samePath(f.path, diagnostic.path) && isUnsaved(f));
      const hasLsp = Object.keys(languageDiagnostics).some((uri) => samePath(fileFromUri(uri), diagnostic.path));
      if (isDirty || hasLsp) return false;
      return true;
    });
  }, [buildReport.diagnostics, languageDiagnostics, openFiles]);
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const normalize = (value: string) => window.kiwi?.platform === "win32"
      ? value.replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\").toLocaleLowerCase()
      : value;
    const grouped = new Map<string, typeof buildReport.diagnostics>();
    for (const diagnostic of activeBuildDiagnostics) {
      const key = normalize(diagnostic.path);
      grouped.set(key, [...(grouped.get(key) || []), diagnostic]);
    }
    for (const model of monaco.editor.getModels()) {
      const markers = grouped.get(normalize(model.uri.fsPath)) || [];
      monaco.editor.setModelMarkers(model, "Kiwi Build", markers.map((diagnostic) => ({
        startLineNumber: Math.max(1, diagnostic.line),
        startColumn: Math.max(1, diagnostic.column),
        endLineNumber: Math.max(1, diagnostic.line),
        endColumn: Math.max(2, diagnostic.column + 1),
        severity: diagnostic.severity === "error"
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
        source: `${buildReport.tool} Build`,
        message: `${explainJavaDiagnostic(diagnostic)}\n\n${diagnostic.message}`,
      })));
    }
  }, [activeBuildDiagnostics, buildReport.tool]);
  /**
   * Structural mistakes found without asking the language server.
   *
   * They show up while typing and, more importantly, while JDT LS is still
   * starting or has failed to import the project — the moment when a broken
   * file would otherwise be reported by nobody at all.
   */
  /**
   * The open Java files as they were a moment after the last keystroke.
   *
   * Kiwi's own syntax pass reads a whole file, and it ran three times per
   * character — for the Problems panel, for the editor's markers, and for the
   * badge above the editor — across every open Java file rather than the one
   * being typed in. A profile of twenty thousand lines put it at the top by a
   * wide margin: eighty-eight percent of the samples taken while typing.
   *
   * Nothing here has to be right mid-keystroke. A quarter of a second after
   * typing stops is soon enough for a red underline, and it takes the whole
   * pass off the typing path.
   */
  /**
   * The package roots this project calls its own, kept from what is open.
   *
   * A Java file says its own package at the top, and the first two segments of
   * that are the root it shares with its siblings. Used only to tell the
   * project's own classes from a dependency's in the completion list, so a root
   * that is missed costs a label and nothing else.
   */
  useEffect(() => {
    const roots = new Set<string>();
    for (const file of openFiles) {
      if (file.language !== "java") continue;
      const declared = file.content.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
      if (!declared) continue;
      const parts = declared.split(".");
      roots.add(parts.slice(0, Math.min(2, parts.length)).join("."));
    }
    if (roots.size) projectPackagesRef.current = [...roots];
  }, [openFiles]);

  const [settledFileContents, setSettledFileContents] = useState<Array<{ path: string; name: string; content: string; language: string }>>([]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSettledFileContents(openFiles.map((file) => ({
        path: file.path,
        name: file.name,
        content: file.content,
        language: file.language,
      })));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [openFiles]);

  const javaSyntaxProblems = useMemo(() => {
    const byPath = new Map<string, SyntaxProblem[]>();
    for (const file of openFiles) {
      const problems = findCodeSyntaxProblems(file.language, file.content);
      if (problems.length > 0) {
        byPath.set(file.path, problems.slice(0, 25));
      }
    }
    return byPath;
  }, [openFiles]);

  const syntaxDiagnostics = useMemo(() => [...javaSyntaxProblems.entries()]
    .flatMap(([path, problems]) => problems.map((problem) => ({
      path,
      line: problem.line,
      column: problem.column,
      endLine: problem.line,
      endColumn: problem.column + problem.length,
      severity: (problem.severity || "error") as "error" | "warning",
      source: "Syntax",
      message: problem.message,
    }))), [javaSyntaxProblems]);

  const diagnostics = useMemo(() => [
    ...(projectInfo.jdkMajor && Number(projectInfo.languageLevel || 0) > projectInfo.jdkMajor ? [{
      path: projectInfo.buildFile ? `${workspaceRoot}\\${projectInfo.buildFile}` : workspaceRoot,
      line: 1,
      column: 1,
      severity: "error" as const,
      message: `Project SDK Java ${projectInfo.jdkMajor} ist zu alt für Language Level ${projectInfo.languageLevel}. Wähle ein neueres JDK unter Einstellungen › Java & SDKs.`,
    }] : []),
    ...activeBuildDiagnostics,
    ...Object.entries(languageDiagnostics).flatMap(([uri, items]) => items.map((item) => ({
      path: fileFromUri(uri) || uri,
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
      endLine: item.range.end.line + 1,
      endColumn: item.range.end.character + 1,
      // LSP severities are 1..4; treating 3 and 4 as warnings turned every
      // hint the server offers into something that looked like a defect.
      severity: item.severity === 1 ? "error" as const
        : item.severity === 2 ? "warning" as const
        : "info" as const,
      source: item.source || "Java",
      message: item.message,
    }))),
    ...syntaxDiagnostics,
    // A file that is open reports from its buffer; the rest come from the scan.
    ...configDiagnostics.filter((item) => !bufferDiagnostics[item.path]),
    ...Object.values(bufferDiagnostics).flat(),
  ], [activeBuildDiagnostics, bufferDiagnostics, configDiagnostics, languageDiagnostics, projectInfo.buildFile, projectInfo.jdkMajor, projectInfo.languageLevel, syntaxDiagnostics, workspaceRoot]);
  const diagnosticCounts = useMemo(() => ({
    error: diagnostics.filter((item) => item.severity === "error").length,
    warning: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
  }), [diagnostics]);
  // Grouping by file is what makes a long list usable: the same missing import
  // in twelve classes reads as twelve unrelated lines otherwise.
  const groupedDiagnostics = useMemo(() => {
    const grouped = new Map<string, Diagnostic[]>();
    for (const diagnostic of diagnostics) {
      if (diagnosticFilter !== "all" && diagnostic.severity !== diagnosticFilter) continue;
      grouped.set(diagnostic.path, [...(grouped.get(diagnostic.path) || []), diagnostic]);
    }
    for (const items of grouped.values()) items.sort((left, right) => left.line - right.line || left.column - right.column);
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [diagnosticFilter, diagnostics]);

  const dirtyCount = openFiles.filter(isUnsaved).length;

  const toast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    // Translated here rather than at each call: every notice in the workbench
    // passes through this function, and a message built at the call site would
    // otherwise have to be wrapped a hundred and sixty times over.
    setToasts((items) => [...items, { id, message: t(message), kind }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3500);
  }, []);

  /*
   * Everything about the repository, in one place.
   *
   * Handed back under the names it already had, so every reader of
   * `gitStatus` or caller of `performGitAction` below is unchanged.
   */
  const {
    gitStatus,
    setGitStatus,
    diffCoverageResult,
    setDiffCoverageResult,
    commitMessage,
    setCommitMessage,
    gitHistory,
    setGitHistory,
    gitBranches,
    setGitBranches,
    gitDiff,
    setGitDiff,
    gitDiffMode,
    setGitDiffMode,
    gitComparison,
    setGitComparison,
    gitDiffSelection,
    setGitDiffSelection,
    gitLineSelection,
    setGitLineSelection,
    gitMenuOpen,
    setGitMenuOpen,
    gitStashes,
    setGitStashes,
    mergeEditor,
    setMergeEditor,
    githubSession,
    setGithubSession,
    githubSignInOpen,
    setGithubSignInOpen,
    refreshGit,
    openPullPreview,
    performGitAction,
    createGitBranch,
    signOutOfGitHub,
  } = useGitWorkbench({ workspaceRoot, toast, setActiveDocument, askForName: setInputRequest });

  const explorerGitState = useCallback((node: FileNode) => {
    const changes = (gitStatus.files || []).filter((change) =>
      node.type === "directory"
        ? isPathWithin(change.absolutePath, node.path)
        : change.absolutePath.toLocaleLowerCase() === node.path.toLocaleLowerCase());
    if (!changes.length) return undefined;
    if (changes.some((change) => change.conflict)) return "conflict" as const;
    if (changes.some((change) => change.index === "?" && change.workingTree === "?")) return "untracked" as const;
    if (changes.some((change) => change.workingTree && change.workingTree !== " ")) return "modified" as const;
    if (changes.some((change) => change.staged)) return "staged" as const;
    return "modified" as const;
  }, [gitStatus.files]);

  /**
   * Asks in the middle of the window and waits for the answer.
   *
   * A notice in the corner offering to undo something was easy to miss and
   * easier to let expire, so the question comes first and nothing has happened
   * while it stands. Resolves false when the dialog is dismissed, so a caller
   * that ignores the answer still does nothing rather than something.
   */
  const askToConfirm = useCallback((request: Omit<ConfirmRequest, "answer">) => (
    new Promise<boolean>((resolve) => {
      setConfirmRequest({
        ...request,
        answer: (confirmed) => {
          setConfirmRequest(null);
          resolve(confirmed);
        },
      });
    })
  ), []);

  /**
   * Sends the request the cursor sits in, or the one on the given line.
   *
   * The response goes into the bottom panel rather than a popup: comparing it
   * with the previous one is the normal way an endpoint is checked, and a
   * popup would throw the previous one away.
   */
  const sendHttpRequest = useCallback(async (line?: number) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model || !window.kiwi) return;
    const requests = parseHttpFile(model.getValue());
    if (requests.length === 0) {
      toast("In dieser Datei steht keine Anfrage.", "info");
      return;
    }
    const target: HttpRequestDefinition | null = line
      ? requests.find((request) => request.line === line) || null
      : requestAtLine(requests, editor?.getPosition()?.lineNumber ?? 1) || requests[0];
    if (!target) {
      toast("Der Cursor steht in keiner Anfrage.", "info");
      return;
    }

    const id = `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setHttpPending({ id, name: target.name });
    setPanel("http");
    setPanelVisible(true);
    try {
      const result = await window.kiwi.http.send(
        { method: target.method, url: target.url, headers: target.headers, body: target.body },
        { id },
      );
      // Newest first, and only the last few are kept — an older response is
      // rarely read once two newer ones exist, and each one holds a full body.
      setHttpResponses((items) => [{ ...result, id, name: target.name, at: Date.now() }, ...items].slice(0, 20));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setHttpPending((current) => (current?.id === id ? null : current));
    }
  }, [toast]);

  sendHttpRequestRef.current = (line?: number) => void sendHttpRequest(line);

  const replaceBuildOutput = useCallback((text: string) => {
    outputRef.current = text.slice(-250_000);
    setOutput(outputRef.current);
  }, []);

  const updateTerminalLog = useCallback((update: string | ((current: string) => string)) => {
    const next = typeof update === "function" ? update(terminalOutputRef.current) : update;
    terminalOutputRef.current = next.slice(-250_000);
    setTerminalOutput(terminalOutputRef.current);
  }, []);

  const flushBufferedOutput = useCallback(() => {
    if (outputFlushTimer.current !== null) {
      window.clearTimeout(outputFlushTimer.current);
      outputFlushTimer.current = null;
    }
    setOutput(outputRef.current);
    setTerminalOutput(terminalOutputRef.current);
  }, []);

  const appendBufferedOutput = useCallback((text: string, includeBuildOutput = true) => {
    if (includeBuildOutput) outputRef.current = `${outputRef.current}${text}`.slice(-250_000);
    terminalOutputRef.current = `${terminalOutputRef.current}${text}`.slice(-250_000);
    if (outputFlushTimer.current !== null) return;
    outputFlushTimer.current = window.setTimeout(flushBufferedOutput, 50);
  }, [flushBufferedOutput]);

  const activeTerminalRef = useRef("1");
  // Closing a detached window emits `open:false` asynchronously. Remember an
  // explicit tab close until that numeric id is deliberately reused, so the
  // late event cannot resurrect the tab the user just removed.
  const closingTerminalSessionsRef = useRef<Set<string>>(new Set());
  activeTerminalRef.current = activeTerminalId;

  const showTerminalSession = useCallback((sessionId: string, synchronizedOutput?: string) => {
    const previousSession = activeTerminalRef.current;
    if (sessionId === previousSession && synchronizedOutput === undefined) return;
    if (sessionId !== previousSession) {
      terminalBuffers.current[previousSession] = terminalOutputRef.current;
    }
    const nextOutput = synchronizedOutput ?? terminalBuffers.current[sessionId] ?? "";
    terminalBuffers.current[sessionId] = nextOutput;
    // Window-state and PTY events can arrive before React commits the state
    // update. Move the routing reference in the same synchronous step so an
    // event in that gap cannot append to (or reactivate) the previous tab.
    activeTerminalRef.current = sessionId;
    terminalOutputRef.current = nextOutput;
    setActiveTerminalId(sessionId);
    setTerminalOutput(nextOutput);
  }, []);

  const hydrateTerminalSessions = useCallback(async (root: string) => {
    if (!window.kiwi) return;
    closingTerminalSessionsRef.current.clear();
    let sessionIds = await window.kiwi.terminal.list(root).catch(() => [] as string[]);
    if (!sessionIds.length) {
      await window.kiwi.terminal.start(root, "1");
      sessionIds = ["1"];
    }
    sessionIds = [...new Set(sessionIds)].sort((left, right) => Number(left) - Number(right));
    const snapshots = await Promise.all(sessionIds.map((sessionId) => (
      window.kiwi!.terminal.snapshot(root, sessionId).catch(() => null)
    )));
    if (workspaceRootRef.current !== root) return;

    const restoredBuffers: Record<string, string> = {};
    for (const snapshot of snapshots) {
      if (snapshot) restoredBuffers[snapshot.sessionId] = snapshot.output;
    }
    const activeSession = sessionIds[0] || "1";
    terminalBuffers.current = restoredBuffers;
    activeTerminalRef.current = activeSession;
    terminalOutputRef.current = restoredBuffers[activeSession] || "";
    setTerminalSessions(sessionIds);
    setActiveTerminalId(activeSession);
    setTerminalOutput(terminalOutputRef.current);
  }, []);

  const openTerminalSession = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) return;
    const next = String(Math.max(0, ...terminalSessions.map(Number)) + 1);
    closingTerminalSessionsRef.current.delete(next);
    setTerminalSessions((current) => [...current, next]);
    terminalBuffers.current[next] = "";
    try {
      await window.kiwi.terminal.start(workspaceRoot, next);
      showTerminalSession(next);
    } catch (error) {
      setTerminalSessions((current) => current.filter((id) => id !== next));
      delete terminalBuffers.current[next];
      toast(error instanceof Error ? error.message : "Terminal konnte nicht gestartet werden.", "error");
    }
  }, [showTerminalSession, terminalSessions, toast, workspaceRoot]);

  const closeTerminalSession = useCallback(async (sessionId: string) => {
    if (!workspaceRoot || !window.kiwi || terminalSessions.length <= 1) return;
    closingTerminalSessionsRef.current.add(sessionId);
    if (detachedTerminalSessions.has(sessionId)) {
      await window.kiwi.terminal.closeWindow(workspaceRoot, sessionId).catch(() => false);
    }
    await window.kiwi.terminal.stop(workspaceRoot, sessionId).catch((error) => {
      toast(error instanceof Error ? error.message : "Terminal konnte nicht beendet werden.", "error");
      return false;
    });
    const remaining = terminalSessions.filter((id) => id !== sessionId);
    setTerminalSessions(remaining);
    delete terminalBuffers.current[sessionId];
    if (sessionId === activeTerminalRef.current) {
      const fallback = remaining[remaining.length - 1];
      activeTerminalRef.current = fallback;
      setActiveTerminalId(fallback);
      terminalOutputRef.current = terminalBuffers.current[fallback] || "";
      setTerminalOutput(terminalOutputRef.current);
    }
  }, [detachedTerminalSessions, terminalSessions, toast, workspaceRoot]);

  const detachTerminalSession = useCallback(async (sessionId: string) => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      await window.kiwi.terminal.openWindow(workspaceRoot, sessionId);
      setDetachedTerminalSessions((current) => new Set(current).add(sessionId));
      // Only this terminal tab moves out. Problems, Build, Debug and the other
      // terminal sessions remain reachable in the shared tool window.
      setPanel("terminal");
      setPanelVisible(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Terminalfenster konnte nicht geöffnet werden.", "error");
    }
  }, [toast, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot || !window.kiwi) {
      setDetachedTerminalSessions(new Set());
      return undefined;
    }
    let disposed = false;
    void window.kiwi.terminal.windowState(workspaceRoot).then((items) => {
      if (!disposed) setDetachedTerminalSessions(new Set(items.map((item) => item.sessionId)));
    }).catch(() => undefined);
    const removeWindowState = window.kiwi.terminal.onWindowState((state) => {
      if (state.projectRoot !== workspaceRoot) return;
      const explicitlyClosing = !state.open && closingTerminalSessionsRef.current.has(state.sessionId);
      if (state.open) {
        setTerminalSessions((current) => current.includes(state.sessionId)
          ? current
          : [...current, state.sessionId].sort((left, right) => Number(left) - Number(right)));
      }
      setDetachedTerminalSessions((current) => {
        const next = new Set(current);
        if (state.open) next.add(state.sessionId);
        else next.delete(state.sessionId);
        return next;
      });
      if (!state.open) {
        if (explicitlyClosing) return;
        setPanel("terminal");
        setPanelVisible(true);
        // The detached window may have kept writing while another terminal was
        // visible in the workbench. Join the main-process buffer before making
        // it active, otherwise the previous terminal's content remains on
        // screen until fresh output happens to arrive.
        void window.kiwi!.terminal.snapshot(workspaceRoot, state.sessionId).then((snapshot) => {
          if (workspaceRootRef.current !== workspaceRoot) return;
          // Redocking is also a selection action: activate the returning
          // session and replace the visible buffer atomically with the
          // authoritative main-process snapshot.
          showTerminalSession(state.sessionId, snapshot.output);
        }).catch(() => showTerminalSession(state.sessionId));
      }
    });
    return () => {
      disposed = true;
      removeWindowState();
    };
  }, [showTerminalSession, workspaceRoot]);

  const checkForUpdates = useCallback(async (silent = false): Promise<UpdateCheckResult> => {
    if (!window.kiwi) {
      return { configured: false, available: false, currentVersion: __APP_VERSION__, reason: "Update-Dienst ist nicht verfügbar." };
    }
    try {
      const result = await window.kiwi.app.checkForUpdates();
      if (result.available) toast(`Kiwi ${result.version} ist verfügbar.`, "info");
      else if (!silent) toast(result.reason || `Kiwi ${result.currentVersion} ist aktuell.`, "success");
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Update-Prüfung fehlgeschlagen.";
      if (!silent) toast(reason, "error");
      return { configured: true, available: false, currentVersion: __APP_VERSION__, reason };
    }
  }, [toast]);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    let disposed = false;
    void window.kiwi.app.updateState()
      .then((state) => {
        if (disposed) return;
        setUpdateRuntime(state);
        if (state.status === "error" && state.operation === "install" && state.reason) {
          toast(state.reason, "error");
        }
      })
      .catch(() => undefined);
    const remove = window.kiwi.app.onUpdateState((state) => {
      if (!disposed) setUpdateRuntime(state);
    });
    return () => {
      disposed = true;
      remove();
    };
  }, [toast]);

  useEffect(() => {
    // Wait for the launch state before checking. A fallback relaunch after a
    // failed installer must not immediately retry the same update in a loop.
    if (window.kiwi?.platform !== "win32" || !bootstrapped || !updateRuntime || !settings.automaticUpdates || automaticUpdateChecked.current) return;
    if (updateRuntime.status === "error" && updateRuntime.operation === "install") return;
    automaticUpdateChecked.current = true;
    void checkForUpdates(true).then((result) => {
      if (!result.available || !result.downloadUrl || !result.sha256) return;
      toast(`Kiwi ${result.version} wird im Hintergrund aktualisiert.`, "info");
      return window.kiwi?.app.installUpdate(result).then((installed) => {
        // A renderer update is applied to the running Kiwi; only a release that
        // also changed the program itself needs the installer and a relaunch.
        toast(installed.restartFree
          ? (installed.reloaded === false
            ? `Kiwi ${installed.version} ist installiert und wird nach der laufenden Debug-Sitzung aktiv.`
            : `Kiwi ${installed.version} wurde ohne Neustart aktualisiert.`)
          : `Kiwi ${installed.version} wird installiert und öffnet den Workspace automatisch wieder.`, "success");
      }).catch((error) => {
        toast(error instanceof Error ? error.message : "Automatisches Update konnte nicht installiert werden.", "error");
      });
    });
  }, [bootstrapped, checkForUpdates, settings.automaticUpdates, toast, updateRuntime]);

  /**
   * Adds a certificate authority Kiwi should trust as well as the system ones.
   *
   * Stored as a path rather than as the certificate itself: a company renews
   * its proxy certificate, replaces the file, and Kiwi picks it up without
   * anybody having to add it again.
   */
  const openSettingsDocument = useCallback(() => {
    void window.kiwi?.app.openSettings(workspaceRoot || undefined);
  }, [workspaceRoot]);

  const upsertOperation = useCallback((operation: BackgroundOperation) => {
    setOperations((items) => {
      const index = items.findIndex((item) => item.id === operation.id);
      if (index < 0) return [...items, { ...operation, startedAt: operation.startedAt || Date.now() }];
      const next = [...items];
      next[index] = { ...next[index], ...operation, startedAt: next[index].startedAt || operation.startedAt || Date.now() };
      return next;
    });
  }, []);

  const completeOperation = useCallback((id: string) => {
    setOperations((items) => items.filter((item) => item.id !== id));
  }, []);

  const recordPerformanceMetric = useCallback((metric: Omit<PerformanceMetric, "timestamp">) => {
    setPerformanceMetrics((current) => {
      const next = [...current, { ...metric, timestamp: new Date().toISOString() }].slice(-200);
      localStorage.setItem("kiwi.performance.metrics.v1", JSON.stringify(next));
      performanceMetricsRef.current = next;
      /*
       * Whether this one was unusual for this machine.
       *
       * Five numbers tell you what just happened; they do not tell you whether
       * it was normal. A four-second startup means nothing on its own — it is
       * either a slow machine or a regression, and only this machine's own
       * history says which.
       *
       * Reported once, when it happens, rather than logged into a list nobody
       * opens. The check is cheap and the list is capped at 200.
       */
      const regression = detectRegression(next, metric.kind);
      if (regression) regressionRef.current(regression.message);
      return next;
    });
  }, []);

  /**
   * Telling somebody their last session was cut off.
   *
   * Once the workbench is up rather than at the moment it is noticed: a
   * message that arrives before there is anything on screen is a message
   * nobody reads. Cleared afterwards so a re-render cannot repeat it.
   */
  useEffect(() => {
    if (!crashNotice || !bootstrapped) return;
    toast(crashNotice, "info");
    setCrashNotice("");
  }, [bootstrapped, crashNotice, toast]);

  /** What this machine usually does, recomputed only when the numbers move. */
  const performanceBaselines = useMemo(() => describeBaselines(performanceMetrics), [performanceMetrics]);

  regressionRef.current = (message: string) => {
    // The same finding twice in a row is the same finding: a slow start
    // followed by a slow project load should say two things, not one thing
    // twice.
    if (lastRegressionRef.current === message) return;
    lastRegressionRef.current = message;
    toast(message, "info");
  };

  const applyWorkbenchLayout = useCallback((layout: WorkbenchLayout) => {
    // Layouts stored before the Extensions view was dropped can still name it.
    setActivity((layout.activity as string) === "extensions" ? "explorer" : layout.activity);
    setSidebarVisible(layout.sidebarVisible);
    setPanelVisible(layout.panelVisible);
    setPanel(sanitizePanelView(layout.panel, "terminal"));
    setPanelViewDocks(sanitizePanelDocks(layout.panelViewDocks));
    setRightTool(sanitizeRightTool(layout.rightTool));
    setRightToolDock(layout.rightToolDock);
    setFocusMode(layout.focusMode);
    setSidebarWidth(layout.sidebarWidth || 260);
    setPanelHeight(layout.panelHeight || 215);
    setPanelRightHeight(layout.panelRightHeight || 300);
    setPanelLeftHeight(layout.panelLeftHeight || layout.panelRightHeight || 300);
    setDockSelection(sanitizeDockSelection(layout.dockSelection));
    setHiddenDocks([]);
    setRightToolSize(layout.rightToolSize || 300);
    setActiveLayoutId(layout.id);
    localStorage.setItem("kiwi.workbench.dock", layout.rightToolDock);
    localStorage.setItem("kiwi.workbench.sidebarWidth", String(layout.sidebarWidth || 260));
    localStorage.setItem("kiwi.workbench.panelHeight", String(layout.panelHeight || 215));
    localStorage.setItem("kiwi.workbench.panelRightHeight", String(layout.panelRightHeight || 300));
    localStorage.setItem("kiwi.workbench.panelLeftHeight", String(layout.panelLeftHeight || layout.panelRightHeight || 300));
    localStorage.setItem("kiwi.workbench.rightToolSize", String(layout.rightToolSize || 300));
    toast(`Layout „${layout.name}“ geladen`, "success");
  }, [toast]);

  const saveWorkbenchLayout = useCallback(() => {
    setInputRequest({
      title: "Workbench-Layout speichern",
      description: "Speichert Toolfenster, Seitenleiste, unteres Panel und Fokusmodus als wiederverwendbares Profil.",
      label: "Profilname",
      initialValue: "Mein Layout",
      confirmLabel: "Layout speichern",
      validate: (value) => value.trim() ? null : "Bitte einen Profilnamen eingeben.",
      action: async (value) => {
        const name = value.trim();
        setLayoutProfiles((current) => {
          const existing = current.find((layout) => layout.name.toLocaleLowerCase() === name.toLocaleLowerCase());
          const layout: WorkbenchLayout = {
            id: existing?.id || crypto.randomUUID(),
            name,
            activity,
            sidebarVisible,
            panelVisible,
            panel,
            panelViewDocks: { ...panelViewDocks },
            dockSelection: { ...dockSelection },
            rightTool,
            rightToolDock,
            focusMode,
            sidebarWidth,
            panelHeight,
            panelRightHeight,
            panelLeftHeight,
            rightToolSize,
          };
          const next = [...current.filter((item) => item.id !== layout.id), layout].slice(-12);
          localStorage.setItem("kiwi.workbench.layouts.v1", JSON.stringify(next));
          return next;
        });
        setInputRequest(null);
        toast(`Layout „${name}“ gespeichert`, "success");
      },
    });
  }, [activity, dockSelection, focusMode, panel, panelHeight, panelLeftHeight, panelViewDocks, panelVisible, panelRightHeight, rightTool, rightToolDock, rightToolSize, sidebarVisible, sidebarWidth, toast]);

  /**
   * Starts/stops mirroring the host's real editor into CodeToGetter.
   * Existing unsaved buffers are sent as complete snapshots once; following
   * keystrokes use Monaco's exact incremental edits.
   */
  const applyCollabHostSnapshot = useCallback((key: string, text: string, saved = false) => {
    const model = monacoRef.current?.editor.getModels().find((candidate) =>
      candidate.uri.fsPath.toLocaleLowerCase() === key);
    collabRemoteEditsRef.current.add(key);
    try {
      if (model && model.getValue() !== text) model.setValue(text);
      setOpenFiles((files) => files.map((file) => file.path.toLocaleLowerCase() === key
        ? {
          ...file,
          content: text,
          savedContent: saved ? text : file.savedContent,
          preview: false,
        }
        : file));
    } finally {
      queueMicrotask(() => collabRemoteEditsRef.current.delete(key));
    }
  }, []);

  /**
   * Pulls one authoritative host-service snapshot after all older local work.
   * A user edit made while the request is in flight invalidates the snapshot;
   * another snapshot is then queued behind that newer edit instead.
   */
  const scheduleCollabHostSnapshot = useCallback((root: string, relative: string, key: string) => {
    if (!window.kiwi || !isActiveCollabHost(
      collabHostingRef.current,
      collabHostedRootRef.current,
      root,
    )) return;
    const epoch = collabHostEpochRef.current;
    if (collabResyncEpochsRef.current.get(key) === epoch) return;
    collabResyncEpochsRef.current.set(key, epoch);
    const localRevision = collabLocalRevisionsRef.current.get(key) || 0;
    let retryForNewerLocalEdit = false;
    void enqueueCollabFileTask(collabEditQueuesRef.current, key, async () => {
      if (epoch !== collabHostEpochRef.current
        || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      const snapshot = await window.kiwi!.collab.localSnapshot(root, relative);
      if (epoch !== collabHostEpochRef.current
        || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      if ((collabLocalRevisionsRef.current.get(key) || 0) !== localRevision) {
        retryForNewerLocalEdit = true;
        return;
      }
      collabFileVersionsRef.current.set(key, snapshot.version);
      collabPlannedVersionsRef.current.set(key, snapshot.version);
      applyCollabHostSnapshot(key, snapshot.text, snapshot.dirty === false);
    }).catch(() => undefined).finally(() => {
      if (collabResyncEpochsRef.current.get(key) === epoch) collabResyncEpochsRef.current.delete(key);
      if (retryForNewerLocalEdit && epoch === collabHostEpochRef.current) {
        scheduleCollabHostSnapshotRef.current(root, relative, key);
      }
    });
  }, [applyCollabHostSnapshot]);
  scheduleCollabHostSnapshotRef.current = scheduleCollabHostSnapshot;

  const handleCollabHostingChange = useCallback((hosting: boolean) => {
    if (!hosting) {
      if (!collabHostingRef.current && !collabHostedRootRef.current) return;
      collabHostingRef.current = false;
      collabHostedRootRef.current = "";
      collabHostEpochRef.current += 1;
      collabEditQueuesRef.current.clear();
      collabFileVersionsRef.current.clear();
      collabPlannedVersionsRef.current.clear();
      collabLocalRevisionsRef.current.clear();
      collabResyncEpochsRef.current.clear();
      return;
    }
    const root = workspaceRootRef.current;
    if (!root || !window.kiwi) return;
    // Opening the right tool or restoring hostState must not reset every
    // shared document a second time.
    if (!shouldInitializeCollabHost(
      collabHostingRef.current,
      collabHostedRootRef.current,
      root,
    )) return;
    collabHostingRef.current = true;
    collabHostedRootRef.current = root;
    collabHostEpochRef.current += 1;
    const epoch = collabHostEpochRef.current;
    collabEditQueuesRef.current.clear();
    collabFileVersionsRef.current.clear();
    collabPlannedVersionsRef.current.clear();
    collabLocalRevisionsRef.current.clear();
    collabResyncEpochsRef.current.clear();
    for (const file of currentSessionRef.current.files) {
      const relative = collabRelativePath(root, file.path);
      if (!relative) continue;
      const key = file.path.toLocaleLowerCase();
      collabLocalRevisionsRef.current.set(key, 0);
      void enqueueCollabFileTask(collabEditQueuesRef.current, key, async () => {
        if (epoch !== collabHostEpochRef.current
          || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
        const result = await window.kiwi!.collab.localReplace(root, relative, file.content);
        if (epoch !== collabHostEpochRef.current
          || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
        collabFileVersionsRef.current.set(key, result.version);
        if (!collabPlannedVersionsRef.current.has(key)) {
          collabPlannedVersionsRef.current.set(key, result.version);
        }
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const hostedRoot = collabHostedRootRef.current;
    if (!hostedRoot || collabRootsEqual(hostedRoot, workspaceRoot)) return;
    // A host session belongs to exactly one project. Stop it before another
    // root can accidentally reuse the same relative file names.
    collabHostingRef.current = false;
    collabHostedRootRef.current = "";
    collabHostEpochRef.current += 1;
    collabEditQueuesRef.current.clear();
    collabFileVersionsRef.current.clear();
    collabPlannedVersionsRef.current.clear();
    collabLocalRevisionsRef.current.clear();
    collabResyncEpochsRef.current.clear();
    void window.kiwi?.collab.stopHosting().catch(() => undefined);
  }, [workspaceRoot]);

  const beginWorkbenchResize = useCallback((
    kind: "sidebar" | "panel" | "rightTool",
    event: React.PointerEvent,
    // Which tool window is being resized. Each edge has its own size, so the
    // drag has to name its edge instead of following whichever tab is focused.
    edge: DockEdge = "bottom",
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebar = sidebarWidth;
    const startPanel = panelHeight;
    const startCornerHeight = edge === "bottom-left" ? panelLeftHeight : panelRightHeight;
    const startRight = rightToolSize;
    // Pointer coordinates arrive in the zoomed coordinate system while
    // window.innerHeight stays unscaled, so at 150 % the old limits allowed a
    // panel half again as tall as the window could show.
    const room = effectiveViewport();
    const onMove = (move: PointerEvent) => {
      if (kind === "sidebar") {
        const next = Math.max(180, Math.min(Math.min(520, room.width * 0.5), startSidebar + move.clientX - startX));
        setSidebarWidth(next);
      } else if (kind === "panel") {
        // Every docked place owns a height and nothing else: the middle sets
        // the height of the row under the editor, a corner its own height at
        // the foot of the column it sits in. The floating window is not resized
        // here; it has its own corner grip.
        if (edge === "bottom") {
          setPanelHeight(resizedPanelHeight(startPanel, move.clientY - startY, room.height));
        } else if (edge === "bottom-left") {
          setPanelLeftHeight(resizedPanelHeight(startCornerHeight, move.clientY - startY, room.height));
        } else if (edge === "bottom-right") {
          setPanelRightHeight(resizedPanelHeight(startCornerHeight, move.clientY - startY, room.height));
        }
      } else if (rightToolDock === "bottom") {
        const next = Math.max(150, Math.min(room.height * 0.7, startRight + startY - move.clientY));
        setRightToolSize(next);
      } else {
        const delta = rightToolDock === "left" ? move.clientX - startX : startX - move.clientX;
        setRightToolSize(Math.max(220, Math.min(Math.min(620, room.width * 0.5), startRight + delta)));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [panelHeight, panelLeftHeight, panelRightHeight, rightToolDock, rightToolSize, sidebarWidth]);

  const cancelPanelDockDrag = useCallback(() => {
    const cleanup = panelDragCleanupRef.current;
    panelDragCleanupRef.current = null;
    cleanup?.();
    setPanelDropEdge("");
  }, []);

  /**
   * Docks one tool window, the way IntelliJ lets each be placed on its own.
   *
   * The panel follows whichever tab is active, so selecting Terminal moves it
   * to wherever the terminal was put and selecting Problems brings it back —
   * each window remembers where it lives instead of all sharing one edge.
   */
  /**
   * Takes the tool window out of the workbench.
   *
   * The floating placement stays inside Kiwi's own window and can therefore
   * never reach a second monitor. Dropping in the middle asks for a window of
   * the operating system instead — the same one the button in the tab strip
   * opens, and the same one the settings use.
   */
  const openPanelWindow = useCallback((view: PanelView = panelViewRef.current) => {
    cancelPanelDockDrag();
    if (view === "tailer") {
      toast(t("Der Tailer ist nur im Hauptfenster verfügbar."), "info");
      return;
    }
    void window.kiwi?.panel.openWindow(workspaceRootRef.current || "");
  }, [cancelPanelDockDrag, toast]);

  useEffect(() => {
    // The detached panel does not mirror the Tailer's buffer or controls.
    // Summoning it therefore brings the tool window back to the workbench.
    if (panelWindowOpen && panel === "tailer") void window.kiwi?.panel.closeWindow();
  }, [panel, panelWindowOpen]);

  /**
   * Puts every view back where it started.
   *
   * A tool window can end up on one of five edges, floating over the
   * workbench, in a window of its own or closed altogether, and each of those
   * is remembered per project. Finding the way back one control at a time is
   * tedious and easy to get half right, so this is the single way out: every
   * tool window returns to the bottom with its default size, and everything
   * that left Kiwi's window — the tool window and any detached terminal —
   * comes back in.
   */
  const resetWorkbenchViews = useCallback(() => {
    cancelPanelDockDrag();
    setActivity("explorer");
    setSidebarVisible(true);
    setFocusMode(false);
    setPanelVisible(true);
    // No entry at all means every tab sits at the bottom, which is where they
    // all start out.
    panelViewDocksRef.current = {};
    setPanelViewDocks({});
    setDockSelection({});
    setHiddenDocks([]);
    setFloatingBounds(DEFAULT_FLOATING_BOUNDS);
    setSidebarWidth(260);
    setPanelHeight(215);
    setPanelRightHeight(300);
    setPanelLeftHeight(300);
    setRightTool("build");
    setRightToolDock("right");
    setRightToolSize(300);
    setActiveLayoutId("kiwi-reset");
    localStorage.setItem("kiwi.workbench.dock", "right");
    localStorage.setItem("kiwi.workbench.sidebarWidth", "260");
    localStorage.setItem("kiwi.workbench.panelHeight", "215");
    localStorage.setItem("kiwi.workbench.panelRightHeight", "300");
    localStorage.setItem("kiwi.workbench.panelLeftHeight", "300");
    localStorage.setItem("kiwi.workbench.rightToolSize", "300");
    void window.kiwi?.panel.closeWindow();
    const root = workspaceRootRef.current;
    if (root) {
      for (const sessionId of detachedTerminalSessionsRef.current) {
        void window.kiwi?.terminal.closeWindow(root, sessionId);
      }
    }
    toast("Ansicht zurückgesetzt: alle Werkzeugfenster sind wieder unten", "success");
  }, [cancelPanelDockDrag, toast]);

  /**
   * Opens the floating window where it cannot dock itself again.
   *
   * Its stored default sat inside the band that docks to the left, so the
   * window appeared half inside a drop zone. A placement the user chose is left
   * alone; only the untouched default is moved to the middle.
   */
  const placeFloatingWindow = useCallback(() => {
    setFloatingBounds((bounds) => bounds.x === DEFAULT_FLOATING_BOUNDS.x && bounds.y === DEFAULT_FLOATING_BOUNDS.y
      ? centredFloatingBounds(effectiveViewport(), bounds)
      : bounds);
  }, []);

  const dockPanelView = useCallback((view: PanelView, target: DockEdge) => {
    cancelPanelDockDrag();
    // Dropping a tab on an edge also puts that window in front there, the way
    // dragging one in IntelliJ does. Its old edge falls back to its first tab.
    setPanel(view);
    setPanelVisible(true);
    if (target === "floating") placeFloatingWindow();
    const next = assignPanelDock(panelViewDocksRef.current, view, target);
    if (next !== panelViewDocksRef.current) {
      panelViewDocksRef.current = next;
      setPanelViewDocks(next);
    }
  }, [cancelPanelDockDrag, placeFloatingWindow]);

  /**
   * Moves a whole tool window, with every tab it holds.
   *
   * Dragging one tab takes that tab out of the group, which is the finer
   * gesture; dragging the window itself moves the block in one go, including
   * out of the workbench into a window of its own.
   */
  const dockPanelEdge = useCallback((from: DockEdge, target: DockEdge) => {
    cancelPanelDockDrag();
    if (from === target) return;
    const docks = panelViewDocksRef.current;
    const available = availablePanelViewsRef.current;
    const shown = activeViewForDock(docks, from, dockSelectionRef.current[from] ?? null, available);
    const next = moveDock(docks, from, target, available);
    if (next === docks) return;
    if (target === "floating") placeFloatingWindow();
    panelViewDocksRef.current = next;
    setPanelViewDocks(next);
    setPanelVisible(true);
    setHiddenDocks((current) => current.filter((item) => item !== target));
    // The window keeps showing what it was showing, now in its new place.
    if (shown) setPanel(shown);
  }, [cancelPanelDockDrag, placeFloatingWindow]);

  /** Dragging a tab moves that tool window; a plain click still selects it. */
  const beginPanelViewDrag = useCallback((event: React.PointerEvent<HTMLElement>, view: PanelView) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cancelPanelDockDrag();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const controller = new AbortController();
    const startX = event.clientX;
    const startY = event.clientY;
    let active = true;
    let dragging = false;
    let previewed: DropTarget | null = null;
    const edgeAt = (x: number, y: number): DropTarget =>
      dropPlacementAt(x, y, effectiveViewport(), dropSizesRef.current);
    const cleanup = () => {
      if (!active) return;
      active = false;
      controller.abort();
      if (panelDragCleanupRef.current === cleanup) panelDragCleanupRef.current = null;
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        // Synthetic pointer events and a window switch may release it first.
      }
    };
    const cancel = () => {
      cleanup();
      setPanelDropEdge("");
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      // A few pixels of slack, so selecting a tab never counts as a drag.
      if (!dragging && Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) < 6) return;
      dragging = true;
      previewed = edgeAt(move.clientX, move.clientY);
      setPanelDropEdge(previewed);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      const target = previewed;
      cleanup();
      setPanelDropEdge("");
      if (!dragging || !target) return;
      if (target === "window") openPanelWindow(view);
      else dockPanelView(view, target);
    };
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      cancel();
    };
    panelDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove, { signal: controller.signal });
    window.addEventListener("pointerup", onUp, { signal: controller.signal });
    window.addEventListener("pointercancel", cancel, { signal: controller.signal });
    window.addEventListener("blur", cancel, { signal: controller.signal });
    window.addEventListener("keydown", onKeyDown, { signal: controller.signal });
    handle.addEventListener("lostpointercapture", cancel, { signal: controller.signal });
    try { handle.setPointerCapture(pointerId); } catch {}
  }, [cancelPanelDockDrag, dockPanelView, openPanelWindow]);

  /**
   * Drags the floating tool window.
   *
   * Moving and docking are one gesture, as in IntelliJ: the window follows the
   * pointer, and a release over one of the workbench edges docks it there
   * instead of leaving it where it was dropped.
   */
  const beginFloatingDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    cancelPanelDockDrag();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const controller = new AbortController();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = floatingBoundsRef.current;
    let active = true;
    let placement: DropTarget = "floating";
    const cleanup = () => {
      if (!active) return;
      active = false;
      controller.abort();
      if (panelDragCleanupRef.current === cleanup) panelDragCleanupRef.current = null;
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        // A window switch may have released the capture first.
      }
    };
    const cancel = () => {
      cleanup();
      setPanelDropEdge("");
      setFloatingBounds(startBounds);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      const room = effectiveViewport();
      setFloatingBounds(movedFloatingBounds(startBounds, move.clientX - startX, move.clientY - startY, room));
      placement = dropPlacementAt(move.clientX, move.clientY, room, dropSizesRef.current);
      // The middle means "leave it here" for a window that is already floating.
      // Reading it as "become a window of its own" would make the floating one
      // impossible to move at all, since moving it happens in the middle.
      setPanelDropEdge(placement === "window" ? "" : placement);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      cleanup();
      setPanelDropEdge("");
      if (placement !== "window" && placement !== "floating") dockPanelEdge("floating", placement);
    };
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      cancel();
    };
    panelDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove, { signal: controller.signal });
    window.addEventListener("pointerup", onUp, { signal: controller.signal });
    window.addEventListener("pointercancel", cancel, { signal: controller.signal });
    window.addEventListener("blur", cancel, { signal: controller.signal });
    window.addEventListener("keydown", onKeyDown, { signal: controller.signal });
    handle.addEventListener("lostpointercapture", cancel, { signal: controller.signal });
    try { handle.setPointerCapture(pointerId); } catch {}
  }, [cancelPanelDockDrag, dockPanelEdge]);

  /** Resizes the floating tool window from its lower right corner. */
  const beginFloatingResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const controller = new AbortController();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = floatingBoundsRef.current;
    const stop = () => {
      controller.abort();
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        // Nothing to release when the capture is already gone.
      }
    };
    window.addEventListener("pointermove", (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      setFloatingBounds(resizedFloatingBounds(
        startBounds,
        move.clientX - startX,
        move.clientY - startY,
        effectiveViewport(),
      ));
    }, { signal: controller.signal });
    window.addEventListener("pointerup", stop, { signal: controller.signal });
    window.addEventListener("pointercancel", stop, { signal: controller.signal });
    window.addEventListener("blur", stop, { signal: controller.signal });
    try { handle.setPointerCapture(pointerId); } catch {}
  }, []);

  const beginPanelDockDrag = useCallback((event: React.PointerEvent<HTMLElement>, edge: DockEdge) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    cancelPanelDockDrag();

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const controller = new AbortController();
    let active = true;
    const edgeAt = (x: number, y: number): DropTarget =>
      dropPlacementAt(x, y, effectiveViewport(), dropSizesRef.current);
    const cleanup = () => {
      if (!active) return;
      active = false;
      controller.abort();
      if (panelDragCleanupRef.current === cleanup) panelDragCleanupRef.current = null;
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        // The window may already have released capture during blur/unmount.
      }
    };
    const cancel = () => {
      cleanup();
      setPanelDropEdge("");
    };
    // The edge the preview last showed. Dropping recomputes nothing: a release
    // whose coordinates differ from the last movement — outside the window, or
    // any synthetic release — would otherwise dock the panel somewhere other
    // than the highlight promised.
    let previewed: DropTarget | null = null;
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      previewed = edgeAt(move.clientX, move.clientY);
      setPanelDropEdge(previewed);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      const target = previewed ?? edgeAt(up.clientX, up.clientY);
      cleanup();
      setPanelDropEdge("");
      // The whole tool window follows its handle: every tab of this edge moves
      // together, while dragging a single tab still takes only that one. A drop
      // in the middle takes the whole thing out of Kiwi's window.
      if (target === "window") openPanelWindow();
      else dockPanelEdge(edge, target);
    };
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      cancel();
    };

    panelDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove, { signal: controller.signal });
    window.addEventListener("pointerup", onUp, { signal: controller.signal });
    window.addEventListener("pointercancel", cancel, { signal: controller.signal });
    window.addEventListener("blur", cancel, { signal: controller.signal });
    window.addEventListener("keydown", onKeyDown, { signal: controller.signal });
    handle.addEventListener("lostpointercapture", cancel, { signal: controller.signal });
    handle.focus();
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointer events do not always have an active pointer to capture.
    }
  }, [cancelPanelDockDrag, dockPanelEdge, openPanelWindow]);

  const handlePanelDockKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>, edge: DockEdge) => {
    // Arrow up matches a drop above the bottom band: it takes the tool window
    // out of the workbench and into a window of its own. The other three walk
    // the feet of the workbench from left to right.
    const target: DropTarget | null = event.key === "ArrowLeft"
      ? "bottom-left"
      : event.key === "ArrowRight"
        ? "bottom-right"
        : event.key === "ArrowDown"
          ? "bottom"
          : event.key === "ArrowUp"
            ? "window"
            : null;
    if (!target) {
      if (event.key === "Escape") cancelPanelDockDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target === "window") openPanelWindow();
    else dockPanelEdge(edge, target);
  }, [cancelPanelDockDrag, dockPanelEdge, openPanelWindow]);

  useEffect(() => () => {
    const cleanup = panelDragCleanupRef.current;
    panelDragCleanupRef.current = null;
    cleanup?.();
  }, []);

  useEffect(() => {
    if (!panelVisible) cancelPanelDockDrag();
  }, [cancelPanelDockDrag, panelVisible]);

  useEffect(() => {
    localStorage.setItem("kiwi.workbench.sidebarWidth", String(sidebarWidth));
    localStorage.setItem("kiwi.workbench.panelHeight", String(panelHeight));
    localStorage.setItem("kiwi.workbench.panelRightHeight", String(panelRightHeight));
    localStorage.setItem("kiwi.workbench.panelLeftHeight", String(panelLeftHeight));
    localStorage.setItem("kiwi.workbench.rightToolSize", String(rightToolSize));
  }, [panelHeight, panelLeftHeight, panelRightHeight, rightToolSize, sidebarWidth]);

  const updateWorkflow = useCallback(async (patch: Partial<WorkflowState>) => {
    const root = workspaceRootRef.current;
    if (!root || !window.kiwi) return;
    setWorkflow(await window.kiwi.workflow.update(root, patch));
  }, []);

  const openExplorerContext = useCallback((x: number, y: number, node: FileNode, projectRoot: string) => {
    setExplorerSubmenu(null);
    setSelectedNode(node);
    setSelectedPaths((current) => current.has(node.path) ? current : new Set([node.path]));
    explorerSelectionAnchorRef.current = node.path;
    setExplorerContext({ x, y, node, projectRoot });
  }, []);

  const cancelExplorerSubmenuClose = useCallback(() => {
    if (explorerSubmenuTimerRef.current !== null) {
      window.clearTimeout(explorerSubmenuTimerRef.current);
      explorerSubmenuTimerRef.current = null;
    }
  }, []);

  const openExplorerSubmenu = useCallback((submenu: ExplorerSubmenu) => {
    cancelExplorerSubmenuClose();
    setExplorerSubmenu(submenu);
  }, [cancelExplorerSubmenuClose]);

  const scheduleExplorerSubmenuClose = useCallback(() => {
    cancelExplorerSubmenuClose();
    explorerSubmenuTimerRef.current = window.setTimeout(() => {
      setExplorerSubmenu(null);
      explorerSubmenuTimerRef.current = null;
    }, 100);
  }, [cancelExplorerSubmenuClose]);

  const refreshTree = useCallback(async (root = workspaceRoot) => {
    if (!root || !window.kiwi) return;
    if (treeRefreshInFlight.current.has(root)) {
      treeRefreshQueued.current.add(root);
      return;
    }
    treeRefreshInFlight.current.add(root);
    // Only surface the spinner once a refresh is slow enough to be worth
    // reporting; flipping it for every sub-100ms rebuild reads as flicker.
    if (root === workspaceRootRef.current && treeSpinnerTimer.current === null) {
      treeSpinnerTimer.current = window.setTimeout(() => {
        treeSpinnerTimer.current = null;
        if (treeRefreshInFlight.current.size) setTreeRefreshing(true);
      }, 260);
    }
    try {
      const nextTree = await window.kiwi.workspace.tree(root);
      let mergedTree = mergeLoadedTreeState(
        nextTree,
        workspaceTreesRef.current[root] || [],
        expandedRef.current,
      );
      const expandedDirectories = [...expandedRef.current]
        .filter((directory) => isPathWithin(directory, root))
        .sort((left, right) => left.length - right.length);
      const refreshedChildren = await Promise.all(expandedDirectories.map(async (directory) => {
        try {
          return { directory, children: await window.kiwi!.workspace.children(root, directory) };
        } catch {
          return null;
        }
      }));
      for (const refreshed of refreshedChildren) {
        if (refreshed) mergedTree = withLoadedChildren(mergedTree, refreshed.directory, refreshed.children, expandedRef.current);
      }
      workspaceTreesRef.current = { ...workspaceTreesRef.current, [root]: mergedTree };
      setWorkspaceTrees((current) => ({ ...current, [root]: mergedTree }));
      if (root === workspaceRootRef.current) setTree(mergedTree);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projekt konnte nicht gelesen werden.", "error");
    } finally {
      treeRefreshInFlight.current.delete(root);
      if (!treeRefreshInFlight.current.size && treeSpinnerTimer.current !== null) {
        window.clearTimeout(treeSpinnerTimer.current);
        treeSpinnerTimer.current = null;
      }
      if (root === workspaceRootRef.current) setTreeRefreshing(false);
      if (treeRefreshQueued.current.delete(root)) {
        window.setTimeout(() => void refreshTreeRequestRef.current(root), 0);
      }
    }
  }, [toast, workspaceRoot]);
  refreshTreeRequestRef.current = refreshTree;

  /**
   * Package compaction rebuilds every node of every project tree. It used to
   * run inline in the Explorer markup, so a single keystroke in the editor —
   * which re-renders this component — transformed the whole workspace again.
   * Recompute it only when the trees or the two relevant settings change.
   */
  /**
   * Collapsing a project optionally folds everything inside it, so reopening
   * starts from the project root instead of restoring a deep module tree.
   */
  const toggleProjectRoot = useCallback((root: string) => {
    setExplorerRootOpen((open) => {
      if (open && settingsRef.current.explorerCollapseModulesWithProject) {
        setExpanded((items) => new Set([...items].filter((item) => !isPathWithin(item, root))));
      }
      return !open;
    });
  }, []);

  /** Translator for the current locale; untranslated keys keep their German source. */
  panelDropEdgeRef.current = panelDropEdge;
  // A drag runs outside render, and the corners it is measured against are as
  // wide as the columns they sit under. `sidebarWidth` does not include the
  // 49 px activity bar, while `rightToolSize` does not include the 31 px tool
  // rail, so both are added: the seam a drop follows is the one on screen.
  dropSizesRef.current = { left: sidebarWidth + 49, right: rightToolSize + 31 };
  panelWindowOpenRef.current = panelWindowOpen;
  detachedTerminalSessionsRef.current = detachedTerminalSessions;

  /**
   * The rectangle the drop preview covers.
   *
   * Read from the same zones the drag is measured against. These were two
   * separate numbers before — the preview showed how wide the docked window
   * would be, the drop was accepted inside a fixed share of the viewport — so
   * releasing inside the highlight could still fall through to the middle.
   */
  const panelDropHintStyle = (target: DropTarget): CSSProperties => {
    const zones = dropZones(effectiveViewport(), dropSizesRef.current);
    switch (target) {
      case "bottom-left": return { top: zones.bottom, bottom: 0, left: 0, width: zones.left };
      case "bottom-right": return { top: zones.bottom, bottom: 0, right: 0, width: zones.right };
      case "bottom": return { top: zones.bottom, bottom: 0, left: zones.left, right: zones.right };
      default: return { top: 0, left: 0, right: 0, height: zones.bottom };
    }
  };
  /** Edge of the focused tool window; the other edges stay where they are. */
  const activePanelDock = dockOf(panelViewDocks, panel);
  panelViewRef.current = panel;
  openFileRef.current = (path, position) => openFile(path, position);
  openLibraryClassRef.current = (uri, position) => openLibraryClass(uri, position);
  stopJavaRef.current = () => stopJava();
  showTerminalSessionRef.current = (sessionId) => showTerminalSession(sessionId);

  const t = useMemo(() => createTranslator(settings.locale), [settings.locale]);
  // Dialogs import `t` from the module directly, so the active locale has to be
  // in place before they render.
  setActiveLocale(settings.locale);
  const runActionTitle = activeFile?.language === "java" ? t("Java ausführen (F5)") : t("Ausführen");

  /** TODO/FIXME of the active file, recomputed only when its content changes. */
  const fileTasks = useMemo(
    () => (activeFile ? findTaskComments(settledContent) : []),
    [activeFile, settledContent],
  );

  /**
   * Task markers across the whole project.
   *
   * Reading them from disk means a file that is open with unsaved edits would
   * show stale entries, so the buffer wins for the files currently open.
   */
  /**
   * Validates the project's build and configuration files.
   *
   * Runs for the whole project rather than only for open buffers, because a
   * broken pom.xml is worth seeing before someone opens it.
   */
  /**
   * The build file a node belongs to: the nearest one at or above it.
   *
   * Right-clicking a source file in a module should offer that module's build
   * file, not the root's — which is the whole point of opening the dialog from
   * here rather than from the toolbar.
   */
  /**
   * The build file a path belongs to.
   *
   * The file itself when it is one, otherwise the nearest one above it — the
   * module's, not the root's. Getting that wrong is not an error message: the
   * library is written correctly into a build file that governs no source, and
   * nothing about the project changes.
   */
  // Given once rather than made afresh on every render. The dialog debounces
  // its search, and a prop that changes identity restarts that debounce for
  // reasons that have nothing to do with what was typed.
  const searchDependencies = useCallback(
    (query: string) => window.kiwi!.project.searchDependencies(query),
    [],
  );
  const dependencyVersions = useCallback(
    (groupId: string, artifactId: string) => window.kiwi!.project.dependencyVersions(groupId, artifactId),
    [],
  );
  /**
   * The tabs the strip is too narrow to show, and the one being dragged.
   *
   * Measured rather than guessed: a tab counts as hidden when it does not lie
   * completely inside the strip's visible span. Anything else — counting
   * characters, assuming a width — goes wrong the moment somebody changes the
   * font or opens a file with a long name.
   */
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [tabOverflowOpen, setTabOverflowOpen] = useState(false);
  const draggedTabRef = useRef<string>("");

  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return undefined;
    const measure = () => {
      // Measured against the strip's own rectangle rather than with offsetLeft,
      // which is relative to the nearest positioned ancestor — and the strip is
      // not one, so offsets belonged to some element further up and tabs in
      // plain sight were reported as hidden. The arrow then appeared on a strip
      // that was not full at all.
      const view = strip.getBoundingClientRect();
      const hidden: string[] = [];
      for (const node of strip.querySelectorAll<HTMLElement>(".tab[data-file-path]")) {
        const box = node.getBoundingClientRect();
        // A tab half over the edge is one somebody cannot click, so it belongs
        // in the list too. The tolerance covers sub-pixel layout.
        if (box.left < view.left - 1 || box.right > view.right + 1) {
          hidden.push(node.dataset.filePath || "");
        }
      }
      setHiddenTabs((previous) => {
        const next = hidden.filter(Boolean);
        return previous.length === next.length && previous.every((path, index) => path === next[index])
          ? previous
          : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    for (const node of strip.children) observer.observe(node);
    strip.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", measure);
    };
  }, [openFiles, activeDocument]);

  // A list of tabs that no longer overflow has nothing left to drop down.
  useEffect(() => {
    if (!hiddenTabs.length) setTabOverflowOpen(false);
  }, [hiddenTabs.length]);

  /**
   * Puts a tab down where it was dragged to.
   *
   * The order of the tabs is the order of the open files, so moving one is
   * moving it in that list — which is also what makes the new order last, since
   * the session is written from the same list.
   */
  const moveTab = useCallback((from: string, to: string) => {
    if (samePath(from, to)) return;
    setOpenFiles((files) => {
      const fromIndex = files.findIndex((file) => samePath(file.path, from));
      const toIndex = files.findIndex((file) => samePath(file.path, to));
      if (fromIndex < 0 || toIndex < 0) return files;
      const next = [...files];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  /**
   * The activity bar as it is configured, and the pieces that configure it.
   *
   * The built-in list is the canonical one: an entry added in a later version
   * appears for everybody, because only what somebody actually moved or hid is
   * stored. An unknown id in the stored order is ignored rather than shown, so
   * removing an entry from a future version cannot leave a dead button behind.
   */
  const activityEntries = useMemo(() => [
    { id: "explorer", label: t("Explorer"), icon: <Files size={22} /> },
    { id: "modules", label: t("Modules"), icon: <Blocks size={21} /> },
    { id: "search", label: t("Suche"), icon: <Search size={21} /> },
    { id: "structure", label: t("Structure"), icon: <ListTree size={21} /> },
    { id: "hierarchy", label: "Hierarchien und Verwendungen", icon: <Network size={21} /> },
    { id: "source", label: t("Source Control"), icon: <GitBranch size={21} /> },
    { id: "tests", label: t("Tests"), icon: <TestTube2 size={21} /> },
    { id: "run", label: t("Run and Debug"), icon: <Bug size={21} /> },
    // The build tool's own mark, so the rail says which one this project uses
    // before anything is opened.
    { id: "build", label: projectInfo.type === "Maven" ? "Maven" : "Gradle", icon: <BuildToolIcon type={projectInfo.type} size={21} /> },
  ], [projectInfo.type]);

  const orderedActivityEntries = useMemo(() => {
    const order = settings.activityOrder || [];
    const known = new Map(activityEntries.map((entry) => [entry.id, entry]));
    const ordered = order.map((id) => known.get(id)).filter(Boolean) as typeof activityEntries;
    // Anything the stored order does not mention keeps its built-in place.
    const rest = activityEntries.filter((entry) => !order.includes(entry.id));
    return [...ordered, ...rest];
  }, [activityEntries, settings.activityOrder]);

  const visibleActivityEntries = useMemo(
    () => orderedActivityEntries.filter((entry) => !(settings.activityHidden || []).includes(entry.id)),
    [orderedActivityEntries, settings.activityHidden],
  );

  /**
   * The right rail, configured the same way the activity bar is.
   *
   * Same shape on purpose: both are strips of tool windows, and somebody who
   * has learned to rearrange one should not have to learn the other.
   */
  const rightRailEntries = useMemo(() => [
    { id: "build", title: t("Build Tool"), label: projectInfo.type, icon: <BuildToolIcon type={projectInfo.type} size={17} /> },
    { id: "dependencies", title: t("Dependencies"), label: t("Deps"), icon: <Network size={17} /> },
    { id: "collab", title: "CodeToGetter", label: "CodeToGetter", icon: <Users size={17} /> },
  ], [projectInfo.type]);

  const orderedRightRailEntries = useMemo(() => {
    const order = settings.rightRailOrder || [];
    const known = new Map(rightRailEntries.map((entry) => [entry.id, entry]));
    const ordered = order.map((id) => known.get(id)).filter(Boolean) as typeof rightRailEntries;
    return [...ordered, ...rightRailEntries.filter((entry) => !order.includes(entry.id))];
  }, [rightRailEntries, settings.rightRailOrder]);

  const visibleRightRailEntries = useMemo(
    () => orderedRightRailEntries.filter((entry) => !(settings.rightRailHidden || []).includes(entry.id)),
    [orderedRightRailEntries, settings.rightRailHidden],
  );

  const draggedRailRef = useRef("");
  const [railMenu, setRailMenu] = useState<{ x: number; y: number } | null>(null);

  const moveRightRailEntry = useCallback((from: string, to: string) => {
    if (from === to) return;
    const order = orderedRightRailEntries.map((entry) => entry.id);
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    order.splice(toIndex, 0, ...order.splice(fromIndex, 1));
    void window.kiwi?.settings.update({ rightRailOrder: order });
  }, [orderedRightRailEntries]);

  const toggleRightRailEntry = useCallback((id: string) => {
    const hidden = settings.rightRailHidden || [];
    const next = hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id];
    // A hidden tool window must not stay open behind its own missing button.
    if (next.includes(id) && rightTool === id) setRightTool(null);
    void window.kiwi?.settings.update({ rightRailHidden: next });
  }, [rightTool, settings.rightRailHidden]);

  const draggedActivityRef = useRef("");
  const [activityBarMenu, setActivityBarMenu] = useState<{ x: number; y: number } | null>(null);

  const moveActivityEntry = useCallback((from: string, to: string) => {
    if (from === to) return;
    const order = orderedActivityEntries.map((entry) => entry.id);
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    order.splice(toIndex, 0, ...order.splice(fromIndex, 1));
    void window.kiwi?.settings.update({ activityOrder: order });
  }, [orderedActivityEntries]);

  const toggleActivityEntry = useCallback((id: string) => {
    const hidden = settings.activityHidden || [];
    const next = hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id];
    // The one being looked at cannot be hidden out from under the sidebar.
    if (next.includes(id) && activity === id) {
      const fallback = visibleActivityEntries.find((entry) => entry.id !== id);
      if (fallback) setActivity(fallback.id as ActivityView);
    }
    void window.kiwi?.settings.update({ activityHidden: next });
  }, [activity, settings.activityHidden, visibleActivityEntries]);

  /**
   * Where the other people in a session are, and whether to go there.
   *
   * A cursor arrives as an offset into a file, because that is the one measure
   * both ends agree on: the guest's editor and the host's Monaco model number
   * their lines differently the moment either has an unsaved change. The offset
   * is turned into a position against the model that is actually open.
   */
  const [collabCursors, setCollabCursors] = useState<Array<{
    peerId: number;
    name: string;
    path: string;
    offset: number;
    anchor: number;
  }>>([]);
  const [followedPeer, setFollowedPeer] = useState(0);
  const followedPeerRef = useRef(0);
  followedPeerRef.current = followedPeer;
  const remoteCursorDecorations = useRef<string[]>([]);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    return window.kiwi.collab.onCursor((payload) => {
      setCollabCursors((cursors) => {
        const rest = cursors.filter((cursor) => cursor.peerId !== payload.by);
        return [...rest, {
          peerId: payload.by,
          name: payload.name || `Gast ${payload.by}`,
          path: payload.path,
          offset: payload.offset,
          anchor: payload.anchor ?? payload.offset,
        }];
      });
    });
  }, []);

  /**
   * Follows somebody: their file is opened and their place scrolled to.
   *
   * Only while following, and only when they are somewhere else — jumping the
   * editor to where a cursor already is would fight with the reader's own
   * scrolling for no gain.
   */
  useEffect(() => {
    if (!followedPeer || !workspaceRoot) return;
    const cursor = collabCursors.find((item) => item.peerId === followedPeer);
    if (!cursor?.path) return;
    // A shared path is project-relative with forward slashes; samePath and the
    // file API both normalise separators, so no joining by hand is needed.
    const target = `${workspaceRoot}/${cursor.path}`;
    if (!samePath(target, activePath || "")) {
      void openFileRef.current(target).catch(() => undefined);
      return;
    }
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const position = model.getPositionAt(Math.min(cursor.offset, model.getValueLength()));
    editor.revealPositionInCenterIfOutsideViewport(position, revealMotionRef.current);
  }, [activePath, collabCursors, followedPeer, workspaceRoot]);

  /**
   * Draws the other cursors into the editor.
   *
   * A colour per peer and their name beside the caret, so a selection reads as
   * somebody's rather than as an unexplained highlight. Only the cursors for
   * the file on screen are drawn; the rest are still tracked, because that is
   * what following one of them needs.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !workspaceRoot) return;
    const length = model.getValueLength();
    const mine = collabCursors.filter((cursor) =>
      cursor.path && samePath(`${workspaceRoot}/${cursor.path}`, activePath || ""));
    remoteCursorDecorations.current = editor.deltaDecorations(
      remoteCursorDecorations.current,
      mine.map((cursor) => {
        const head = model.getPositionAt(Math.min(cursor.offset, length));
        const tail = model.getPositionAt(Math.min(cursor.anchor, length));
        const before = tail.lineNumber < head.lineNumber
          || (tail.lineNumber === head.lineNumber && tail.column <= head.column);
        return {
          range: {
            startLineNumber: before ? tail.lineNumber : head.lineNumber,
            startColumn: before ? tail.column : head.column,
            endLineNumber: before ? head.lineNumber : tail.lineNumber,
            endColumn: before ? head.column : tail.column,
          },
          options: {
            className: "collab-remote-selection",
            hoverMessage: { value: cursor.name },
            // The caret itself, with the name attached, so an empty selection
            // is still visible as somebody being there.
            beforeContentClassName: "collab-remote-caret",
            stickiness: 1,
            inlineClassName: undefined,
            after: {
              content: ` ${cursor.name} `,
              inlineClassName: "collab-remote-label",
            },
          },
        };
      }),
    );
  }, [activePath, collabCursors, workspaceRoot]);

  // Held in a ref: the editor is wired up once, and the callback it captures
  // must not be the one from that first render for the rest of the session.
  const sendCollabCursorRef = useRef<(path: string, offset: number, anchor: number) => void>(() => undefined);

  /** Tells the session where this editor's caret and selection are. */
  const sendCollabCursor = useCallback((path: string, offset: number, anchor: number) => {
    if (!collabHostingRef.current || !workspaceRootRef.current) return;
    void window.kiwi?.collab.request("cursor", {
      path: relativePath(workspaceRootRef.current, path).replace(/\\/g, "/"),
      offset,
      anchor,
    }).catch(() => undefined);
  }, []);
  sendCollabCursorRef.current = sendCollabCursor;

  /**
   * Writes the settings, the keymap and the saved layouts to one file.
   *
   * What is left out is the point: a bundle is meant to be shared, and the JDK
   * path, the recent projects, the certificates and the GitHub client id belong
   * to this machine and nobody else's.
   */
  const exportSettingsBundle = useCallback(async () => {
    try {
      const bundle = createSettingsBundle(settingsRef.current, layoutProfilesRef.current);
      const written = await window.kiwi?.settings.exportBundle(JSON.stringify(bundle, null, 2));
      if (written) toast(`${t("Einstellungen exportiert")} · ${basename(written)}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Der Export ist fehlgeschlagen."), "error");
    }
  }, [toast]);

  const importSettingsBundle = useCallback(async () => {
    try {
      const text = await window.kiwi?.settings.importBundle();
      if (!text) return;
      const { settings: incoming, layouts } = readSettingsBundle(text);
      await window.kiwi?.settings.update(incoming);
      if (layouts.length) {
        const merged = mergeLayouts(layoutProfilesRef.current as never, layouts);
        setLayoutProfiles(merged as never);
        localStorage.setItem("kiwi.workbench.layouts.v1", JSON.stringify(merged));
      }
      toast(
        layouts.length
          ? `${t("Einstellungen importiert")} · ${layouts.length} ${t("Layouts")}`
          : t("Einstellungen importiert"),
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("Der Import ist fehlgeschlagen."), "error");
    }
  }, [toast]);

  const buildFileForPath = useCallback((target: string, isDirectory = false) => {
    if (!target) return "";
    // A build file that was named is the answer, whether or not the dependency
    // model has been read yet — which it has not, the first time somebody
    // opens a project and asks straight away.
    if (!isDirectory && acceptsDependencies(target)) return target;
    const files = dependencyEditorModel?.buildFiles || [];
    if (!files.length) return "";
    const directory = isDirectory ? target : dirname(target);
    const candidates = files
      .filter((file) => isPathWithin(directory, dirname(file)))
      .sort((left, right) => right.length - left.length);
    return candidates[0] || "";
  }, [dependencyEditorModel?.buildFiles]);

  const buildFileForNode = useCallback(
    (node: FileNode | null) => (node ? buildFileForPath(node.path, node.type === "directory") : ""),
    [buildFileForPath],
  );

  /**
   * Marks the open buffers whose file has gone away.
   *
   * Only the paths a structural event named, and only those that are open:
   * asking about anything else would read the disk for files nobody is
   * looking at. A file that comes back — restored, or recreated by saving —
   * clears the mark on its own.
   */
  const markMissingOpenFiles = useCallback(async (paths: string[]) => {
    if (!window.kiwi) return;
    const open = currentSessionRef.current.files;
    const touched = paths.filter((candidate) => open.some((file) => samePath(file.path, candidate)));
    if (!touched.length) return;
    const states = await Promise.all(touched.map(async (candidate) => ({
      path: candidate,
      missing: await window.kiwi!.file.read(candidate).then(() => false, () => true),
    })));
    setOpenFiles((files) => files.map((file) => {
      const state = states.find((entry) => samePath(entry.path, file.path));
      if (!state || Boolean(file.missing) === state.missing) return file;
      return { ...file, missing: state.missing };
    }));
  }, []);

  const refreshConfigDiagnostics = useCallback(async (root = workspaceRootRef.current) => {
    if (!root || !window.kiwi) return;
    try {
      setConfigDiagnostics(await window.kiwi.workspace.validateProject(root));
    } catch {
      setConfigDiagnostics([]);
    }
  }, []);

  const refreshTaskComments = useCallback(async (root = workspaceRootRef.current) => {
    if (!root || !window.kiwi) return;
    setTaskCommentsLoading(true);
    try {
      setProjectTaskComments(await window.kiwi.workspace.taskComments(root));
    } catch {
      setProjectTaskComments([]);
    } finally {
      setTaskCommentsLoading(false);
    }
  }, []);

  const taskComments = useMemo(() => {
    const open = new Map(openFiles.map((file) => [file.path.toLowerCase(), file]));
    const fromDisk = projectTaskComments.filter((task) => !open.has(task.path.toLowerCase()));
    // Read from the settled copies, not the live buffers: this scans every
    // open file line by line, and keyed on the live content it did so on every
    // keystroke. It was the second-largest cost in a profile of typing.
    const fromBuffers = settledFileContents.flatMap((file) => findTaskComments(file.content).map((task) => ({
      ...task,
      path: file.path,
      name: file.name,
      kind: String(task.kind),
    })));
    return [...fromDisk, ...fromBuffers]
      .filter((task) => taskCommentFilter === "all" || task.kind.toUpperCase() === taskCommentFilter)
      .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  }, [openFiles, projectTaskComments, settledFileContents, taskCommentFilter]);

  const projectedTrees = useMemo(() => {
    if (!(settings.explorerView === "packages" && settings.compactPackages)) return workspaceTrees;
    const result: Record<string, FileNode[]> = {};
    for (const [root, nodes] of Object.entries(workspaceTrees)) {
      result[root] = compactPackageNodes(nodes);
    }
    return result;
  }, [settings.compactPackages, settings.explorerView, workspaceTrees]);
  settingsRef.current = settings;
  debugStatusRef.current = debugStatus;
  projectedTreesRef.current = projectedTrees;

  /**
   * Records paths that Kiwi is about to change itself. The Explorer refreshes
   * those directly, so the watcher echo that arrives a moment later must not
   * trigger a second rebuild of the same subtree.
   */
  const markSelfInflicted = useCallback((paths: string[], windowMs = 1_500) => {
    const expiresAt = Date.now() + windowMs;
    for (const candidate of paths) {
      if (!candidate) continue;
      selfInflictedChanges.current.set(candidate.toLowerCase(), expiresAt);
      selfInflictedChanges.current.set(dirname(candidate).toLowerCase(), expiresAt);
    }
    for (const [key, expiry] of selfInflictedChanges.current) {
      if (expiry < Date.now()) selfInflictedChanges.current.delete(key);
    }
  }, []);

  const loadDirectoryChildren = useCallback(async (root: string, directory: string, compactChain = false) => {
    if (!window.kiwi) return;
    const key = `${root}\0${directory}`;
    const existing = directoryLoads.current.get(key);
    if (existing) return existing;
    setLoadingDirectories((current) => new Set(current).add(directory));
    const request = (async () => {
      try {
        let target = directory;
        const loadedPaths: string[] = [];
        for (let depth = 0; depth < 24; depth += 1) {
          const children = await window.kiwi!.workspace.children(root, target);
          loadedPaths.push(target);
          const next = withLoadedChildren(workspaceTreesRef.current[root] || [], target, children, expandedRef.current);
          workspaceTreesRef.current = { ...workspaceTreesRef.current, [root]: next };
          setWorkspaceTrees((current) => ({ ...current, [root]: next }));
          if (root === workspaceRootRef.current) setTree(next);
          const normalized = target.replace(/\\/g, "/").toLocaleLowerCase();
          const child = children.length === 1 && children[0].type === "directory" ? children[0] : null;
          if (!compactChain || !/\/src\/(?:main|test)\/java(?:\/|$)/.test(normalized) || !child) break;
          target = child.path;
        }
        if (compactChain && loadedPaths.length) {
          setExpanded((current) => new Set([...current, ...loadedPaths]));
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "Ordner konnte nicht geladen werden.", "error");
      } finally {
        directoryLoads.current.delete(key);
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(directory);
          return next;
        });
      }
    })();
    directoryLoads.current.set(key, request);
    return request;
  }, [toast]);



  const loadWorkspace = useCallback(async (root: string) => {
    const loadStartedAt = performance.now();
    const loadEpoch = ++workspaceLoadEpoch.current;
    if (!window.kiwi) {
      toast("Dateizugriff ist nur in der Desktop-App verfügbar.", "error");
      return;
    }
    // Opening a project is eight independent reads; a bare spinner gave no clue
    // which one a large project was stuck on.
    const loadSteps = [
      "Projektstruktur lesen",
      "Build-System erkennen",
      "Git-Status lesen",
      "Startkonfigurationen lesen",
      "Einstellungen lesen",
      "Haltepunkte lesen",
      "Module erkennen",
      "Zuletzt verwendetes lesen",
    ];
    const trackLoad = trackSteps(loadSteps.length, (done, name) => {
      if (loadEpoch === workspaceLoadEpoch.current) {
        setProjectLoading({ label: "Projekt wird geöffnet", detail: `${basename(root)} · ${name}`, progress: { done, total: loadSteps.length } });
      }
    });
    setProjectLoading({ label: "Projekt wird geöffnet", detail: basename(root), progress: { done: 0, total: loadSteps.length } });
    try {
    const previousRoot = workspaceRootRef.current;
    if (previousRoot && previousRoot !== root) {
      sessionsRef.current.set(previousRoot, { ...currentSessionRef.current });
      if (collabRootsEqual(collabHostedRootRef.current, previousRoot)) {
        collabHostingRef.current = false;
        collabHostedRootRef.current = "";
        collabHostEpochRef.current += 1;
        collabEditQueuesRef.current.clear();
        collabFileVersionsRef.current.clear();
        collabPlannedVersionsRef.current.clear();
        collabLocalRevisionsRef.current.clear();
        collabResyncEpochsRef.current.clear();
        await window.kiwi.collab.stopHosting().catch(() => undefined);
      }
    }
    setSessionRestoredRoot("");
    const registered = await window.kiwi.workspace.register(root);
    if (!registered) throw new Error("Der Projektordner ist nicht mehr verfügbar.");
    root = registered;
    const nextWorkspaceState = await window.kiwi.workspace.activate(root);
    setWorkspaceState(nextWorkspaceState);
    workspaceRootRef.current = root;
    breakpointHydratedRoot.current = "";
    setWorkspaceRoot(root);
    setSelectedNode(null);
    setSelectedPaths(new Set());
    explorerSelectionAnchorRef.current = "";
    setExpanded(settings.restoreExplorerState
      ? new Set(storedJson<string[]>(`kiwi.explorer.expanded.v1:${root}`, []))
      : new Set());
    setLanguageDiagnostics({});
    setPolyglotStatus({});
    setSelectedNode(null);
    localStorage.setItem("kiwi.lastWorkspace", root);
    const [nextTree, info, git, configurations, loadedSettings, savedBreakpoints, detectedModules, savedWorkflow] = await Promise.all([
      trackLoad(loadSteps[0], window.kiwi.workspace.tree(root)),
      trackLoad(loadSteps[1], window.kiwi.java.detect(root)),
      trackLoad(loadSteps[2], window.kiwi.git.status(root)),
      trackLoad(loadSteps[3], window.kiwi.runConfigurations.list(root)),
      trackLoad(loadSteps[4], window.kiwi.settings.get()),
      trackLoad(loadSteps[5], window.kiwi.debug.listBreakpoints(root)),
      trackLoad(loadSteps[6], window.kiwi.modules.list(root)),
      trackLoad(loadSteps[7], window.kiwi.workflow.get(root)),
    ]);
    if (loadEpoch !== workspaceLoadEpoch.current) return;
    setTree(nextTree);
    workspaceTreesRef.current = { ...workspaceTreesRef.current, [root]: nextTree };
    setWorkspaceTrees((current) => ({ ...current, [root]: nextTree }));
    setProjectInfo(info);
    if (info.jdkMajor && Number(info.languageLevel || 0) > info.jdkMajor) {
      toast(
        `Das Projekt benötigt Java ${info.languageLevel}, aktuell ist aber nur JDK ${info.jdkMajor} ausgewählt. Build, Tests und Run sind bis zur SDK-Auswahl blockiert.`,
        "error",
      );
    }
    setGitStatus(git);
    setRunConfigurations(configurations);
    setActiveRunConfigId(configurations[0]?.id || "");
    setIdeSettings(loadedSettings);
    setBreakpoints(savedBreakpoints);
    setModuleInfos(detectedModules);
    setWorkflow(savedWorkflow);
    setSelectedModuleId((current) => detectedModules.some((module) => module.id === current) ? current : detectedModules[0]?.id || "");
    breakpointHydratedRoot.current = root;
    setFontSize(loadedSettings.fontSize);
    setMinimap(loadedSettings.minimap);
    setWordWrap(loadedSettings.wordWrap);
    recordPerformanceMetric({ kind: "project", value: Math.round(performance.now() - loadStartedAt), unit: "ms", projectRoot: root });
    const savedExpanded = loadedSettings.restoreExplorerState
      ? storedJson<string[]>(`kiwi.explorer.expanded.v1:${root}`, [])
      : [];
    const restoredExpansion = new Set(
      savedExpanded.length
        ? savedExpanded
        : nextTree.filter((node) => node.type === "directory" && node.name.toLowerCase() === "src").map((node) => node.path),
    );
    expandedRef.current = restoredExpansion;
    setExpanded(restoredExpansion);
    // workspace.tree() only reads one level. Without pulling the children of
    // every restored directory the Explorer shows those nodes as open but
    // empty, which is why the saved layout never came back.
    if (restoredExpansion.size) void refreshTreeRequestRef.current(root);
    void window.kiwi.workspace.watch(root);
    // Where every file of this project was last left, including the ones
    // that are not open. Awaited nowhere: a file that opens before this
    // lands simply opens at its beginning, which is what it did before.
    void adoptProjectStates(root);
    void window.kiwi.project.tasks(root).then((result) => {
      setProjectTasks(result.tasks);
      setBuildProfiles(result.profiles || []);
    }).catch(() => {
      setProjectTasks([]);
      setBuildProfiles([]);
    });
    void window.kiwi.tests.discover(root).then(setTestSuites).catch(() => setTestSuites([]));
    void refreshTaskComments(root);
    void refreshConfigDiagnostics(root);
    void window.kiwi.project.frameworkInfo(root).then(setFrameworkInfo).catch(() => setFrameworkInfo({ frameworks: [], symbols: [] }));
    void window.kiwi.tests.results(root).then(async (reports) => {
      setTestReports(reports);
      const history = await window.kiwi!.tests.history(root);
      setTestHistory(history.runs);
      setFlakyTests(history.flaky);
    }).catch(() => {
      setTestReports([]);
      setTestHistory([]);
      setFlakyTests([]);
    });
    void window.kiwi.git.log(root, 30).then(setGitHistory).catch(() => setGitHistory([]));
    void window.kiwi.git.branches(root).then(setGitBranches).catch(() => setGitBranches([]));
    if (!info.language || info.language === "java") {
    setLanguageStatus("starting");
    setLanguageDetail("JDT LS wird gestartet …");
    upsertOperation({
      id: `index:${root}`,
      projectRoot: root,
      kind: "index",
      label: "Java-Projekt indexieren",
      detail: "JDT LS wird gestartet …",
      cancellable: true,
    });
    void window.kiwi.language.start(root).then((result) => {
      applySemanticLegend(result.capabilities);
      setLanguageStatus(result.available ? "ready" : result.status === "missing" || result.status === "jdk-required" ? "missing" : "error");
      setLanguageDetail(result.available ? "Autocomplete und Navigation sind bereit." : result.reason || "");
      completeOperation(`index:${root}`);
      if (!result.available) {
        if (result.status === "jdk-required") openSettingsDocument();
        toast(result.reason || "Java-Sprachdienst ist nicht verfügbar.", "info");
      }
    }).catch((error) => {
      setLanguageStatus("error");
      setLanguageDetail(error instanceof Error ? error.message : "Sprachdienstfehler");
      completeOperation(`index:${root}`);
      toast(error instanceof Error ? error.message : "Java-Sprachdienst konnte nicht gestartet werden.", "error");
    });
    } else {
      setLanguageStatus("idle");
      setLanguageDetail("");
    }
    const cachedSession = sessionsRef.current.get(root);
    const persistedPanelLayout = storedJson<PersistedPanelLayout | null>(`kiwi.panel.layout.v1:${root}`, null);
    if (cachedSession) {
      setOpenFiles(cachedSession.files);
      setActivePath(cachedSession.activePath);
      setSplitPath(cachedSession.splitPath);
      applyPanelLayout(cachedSession, loadedSettings.panelViewDocks);
      updateTerminalLog(cachedSession.terminalOutput);
      setCursor(cachedSession.cursor);
      window.setTimeout(() => {
        editorRef.current?.setPosition({ lineNumber: cachedSession.cursor.line, column: cachedSession.cursor.column });
        editorRef.current?.revealLineInCenter(cachedSession.cursor.line, revealMotionRef.current);
      }, 80);
      for (const file of cachedSession.files.filter((item) => item.language === "java")) {
        void window.kiwi.language.open({ root, file: file.path, text: file.content, languageId: "java" });
      }
    } else {
      setOpenFiles([]);
      setActivePath(null);
      setSplitPath(null);
      type PersistedEditorSession = PersistedPanelLayout & {
          files?: Array<{ path: string; content?: string }>;
          activePath?: string | null;
          splitPath?: string | null;
          cursor?: { line: number; column: number };
          sourceVersion?: string;
          targetVersion?: string;
          /** Set while the session was live; still set means it was cut off. */
          running?: boolean;
          savedAt?: number;
        };
      const updateRecoveryKey = `kiwi.update.recovery.v1:${root}`;
      const storedUpdateRecovery = storedJson<PersistedEditorSession | null>(updateRecoveryKey, null);
      const updateRecovery = storedUpdateRecovery
        && (storedUpdateRecovery.targetVersion === __APP_VERSION__ || storedUpdateRecovery.sourceVersion === __APP_VERSION__)
        ? storedUpdateRecovery
        : null;
      if (storedUpdateRecovery && !updateRecovery) localStorage.removeItem(updateRecoveryKey);
      /*
       * The session on disk before the one in local storage.
       *
       * They are usually the same. When they differ it is because the last
       * process was killed, and then the one on disk is the newer of the two:
       * it was written synchronously while the other was still waiting for a
       * flush that never came.
       */
      const onDisk = loadedSettings.restoreSession
        ? await window.kiwi.workspace.loadSession(root).catch(() => null) as PersistedEditorSession | null
        : null;
      /*
       * Whether the last session ended.
       *
       * The file still saying "running" means nothing cleared it, which means
       * nothing ran the shutdown: a crash, a kill or a power cut, which are
       * the same thing from here.
       */
      if (endedBadly(onDisk?.running ? { running: true, at: Number(onDisk.savedAt) || 0 } : null)) {
        setCrashNotice(describeRecovery(countStoredDrafts((onDisk?.files || []) as never)));
      }
      const persisted = updateRecovery || onDisk || (loadedSettings.restoreSession
        ? storedJson(`kiwi.session.v2:${root}`, null) as PersistedEditorSession | null
        : null);
      const legacyPaths = loadedSettings.restoreSession
        ? storedJson<string[]>(`kiwi.session:${root}`, [])
        : [];
      const sessionFiles: Array<{ path: string; content?: string }> = persisted?.files?.length
        ? persisted.files
        : legacyPaths.map((filePath) => ({ path: filePath }));
      let recoveredDrafts = 0;
      let recoveryReadFailures = 0;
      const restored = (await Promise.all(sessionFiles.slice(0, updateRecovery ? 50 : 12).map(async (sessionFile) => {
        try {
          const diskContent = await window.kiwi!.file.read(sessionFile.path);
          const draft = typeof sessionFile.content === "string" ? sessionFile.content : diskContent;
          if (draft !== diskContent) recoveredDrafts += 1;
          return {
            path: sessionFile.path,
            name: basename(sessionFile.path),
            content: draft,
            savedContent: diskContent,
            externalContent: diskContent,
            language: languageFromPath(sessionFile.path),
          } satisfies OpenFile;
        } catch {
          // Counted whatever brought us here. This used to be counted only
          // during an update recovery, so an ordinary restore that could not
          // read its files dropped them without a word — and then the empty
          // result was written back over the session that held them.
          recoveryReadFailures += 1;
          return null;
        }
      // Narrowed by hand rather than by a predicate: the literal above states
      // externalContent, OpenFile leaves it optional, and a predicate has to be
      // assignable both ways.
      }))).filter(Boolean) as OpenFile[];
      // Reading the stored files took time, and another project may have been
      // opened meanwhile. Without this the slower load still applied its tabs
      // and its tool-window arrangement over the project that is now on
      // screen — the newly opened project appeared to inherit the previous
      // one's layout.
      if (loadEpoch !== workspaceLoadEpoch.current) return;
      setOpenFiles(restored);
      setActivePath(restored.some((file) => file.path === persisted?.activePath) ? persisted?.activePath || null : restored[0]?.path || null);
      setSplitPath(restored.some((file) => file.path === persisted?.splitPath) ? persisted?.splitPath || null : null);
      // The full session is flushed synchronously during beforeunload and is
      // therefore the freshest source during a renderer reload. The separate
      // panel snapshot remains the fallback when tab/session restore is off.
      applyPanelLayout(persisted || persistedPanelLayout, loadedSettings.panelViewDocks);
      if (persisted?.cursor) {
        setCursor(persisted.cursor);
        window.setTimeout(() => {
          editorRef.current?.setPosition({ lineNumber: persisted.cursor!.line, column: persisted.cursor!.column });
          editorRef.current?.revealLineInCenter(persisted.cursor!.line, revealMotionRef.current);
        }, 100);
      }
      for (const file of restored.filter((item) => item.language === "java")) {
        void window.kiwi.language.open({ root, file: file.path, text: file.content, languageId: "java" });
      }
      if (updateRecovery && recoveryReadFailures === 0) localStorage.removeItem(updateRecoveryKey);
      if (updateRecovery && recoveryReadFailures > 0) {
        toast(`${recoveryReadFailures} Datei${recoveryReadFailures === 1 ? " konnte" : "en konnten"} nach dem Update nicht wiederhergestellt werden. Der Wiederherstellungsstand bleibt gespeichert.`, "error");
      }
      if (recoveredDrafts) toast(`${recoveredDrafts} ungespeicherte Dateiänderung${recoveredDrafts === 1 ? "" : "en"} wiederhergestellt`, "info");
      /*
       * A restore that lost files must not erase them.
       *
       * The stored session is the only copy of an unsaved draft. When a file
       * cannot be read the restore returns fewer tabs than it was given, and
       * the periodic write would then put that shorter list back — turning one
       * unreadable file into a permanently lost draft. So the write is held
       * until somebody does something the session should record.
       */
      restoreIncomplete.current = recoveryReadFailures > 0 && sessionFiles.length > restored.length;
      if (restoreIncomplete.current && !updateRecovery) {
        toast(`${recoveryReadFailures} Datei${recoveryReadFailures === 1 ? "" : "en"} aus der letzten Sitzung `
          + "konnte nicht geöffnet werden. Die gespeicherte Sitzung bleibt erhalten.", "error");
      }
    }
    await hydrateTerminalSessions(root);
    if (loadEpoch !== workspaceLoadEpoch.current) return;
    setSessionRestoredRoot(root);
    toast(`${basename(root)} geöffnet`, "success");
    } catch (error) {
      if (loadEpoch === workspaceLoadEpoch.current) {
        toast(error instanceof Error ? error.message : "Projekt konnte nicht geöffnet werden.", "error");
      }
    } finally {
      if (loadEpoch === workspaceLoadEpoch.current) setProjectLoading(null);
    }
  }, [applyPanelLayout, completeOperation, hydrateTerminalSessions, openSettingsDocument, settings.restoreExplorerState, toast, updateTerminalLog, upsertOperation]);

  /**
   * Clones a repository and opens what it made.
   *
   * Two steps, because the second needs a real folder chooser: the address is
   * typed, then the parent directory is picked, and the clone creates the
   * project folder inside it. Opening the result is the point — a clone that
   * leaves somebody looking at the hub has done half a job.
   */
  const cloneFromGit = useCallback(() => {
    setInputRequest({
      title: t("Von Git klonen"),
      description: t("Adresse des Repositorys, danach wird der Zielordner gewählt."),
      label: t("Repository-Adresse"),
      placeholder: "https://github.com/benutzer/projekt.git",
      confirmLabel: t("Weiter"),
      validate: (value) => (value.trim() ? null : t("Bitte gib eine Repository-Adresse an.")),
      action: async (url) => {
        const directory = await window.kiwi!.git.chooseCloneDirectory();
        if (!directory) return;
        toast(t("Repository wird geklont …"), "info");
        try {
          const result = await window.kiwi!.git.clone(url.trim(), directory);
          toast(`${result.name} ${t("geklont")}`, "success");
          await loadWorkspace(result.path);
        } catch (error) {
          toast(error instanceof Error ? error.message : t("Klonen fehlgeschlagen."), "error");
        }
      },
    });
  }, [loadWorkspace, toast]);


  const openWorkspace = useCallback(async () => {
    if (!window.kiwi) {
      toast("Starte Kiwi mit „npm run dev“, um lokale Ordner zu öffnen.", "info");
      return;
    }
    const state = await window.kiwi.workspace.openMany();
    setWorkspaceState(state);
    if (welcomeWindow && state.activeRoot) {
      await window.kiwi.app.openEditor(state.activeRoot);
      return;
    }
    if (state.activeRoot) await loadWorkspace(state.activeRoot);
  }, [loadWorkspace, toast, welcomeWindow]);

  const openProjectFromHub = useCallback(async (root: string) => {
    if (!window.kiwi) return;
    try {
      await window.kiwi.app.openEditor(root);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projekt konnte nicht geöffnet werden.", "error");
    }
  }, [toast]);

  const removeWorkspaceProject = useCallback(async (root: string) => {
    if (!window.kiwi) return;
    try {
      const hadActiveWorkspace = Boolean(workspaceRootRef.current);
      if (root === workspaceRootRef.current) {
        sessionsRef.current.set(root, { ...currentSessionRef.current });
      }
      const state = await window.kiwi.workspace.remove(root);
      setIdeSettings(await window.kiwi.settings.get());
      sessionsRef.current.delete(root);
      setWorkspaceTrees((current) => {
        const next = { ...current };
        delete next[root];
        return next;
      });
      setWorkspaceState(hadActiveWorkspace ? state : { ...state, activeRoot: null });
      if (hadActiveWorkspace && state.activeRoot) {
        await loadWorkspace(state.activeRoot);
        return;
      }
      workspaceRootRef.current = "";
      setWorkspaceRoot("");
      setOpenFiles([]);
      setActivePath(null);
      setTree([]);
      if (hadActiveWorkspace && !state.activeRoot) await window.kiwi.app.showWelcome();
      toast(`${basename(root)} aus der Liste entfernt`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projekt konnte nicht entfernt werden.", "error");
    }
  }, [loadWorkspace, toast]);

  const closeWorkspace = useCallback(async () => {
    if (!window.kiwi) return;
    const state = await window.kiwi.workspace.closeAll();
    sessionsRef.current.clear();
    workspaceRootRef.current = "";
    setWorkspaceState(state);
    setWorkspaceRoot("");
    setWorkspaceTrees({});
    setTree([]);
    setOpenFiles([]);
    setActivePath(null);
    setSplitPath(null);
    await window.kiwi.app.showWelcome();
  }, []);

  const toggleWorkspacePinned = useCallback(async (project: WorkspaceProject) => {
    if (!window.kiwi) return;
    try {
      setWorkspaceState(await window.kiwi.workspace.setPinned(project.root, !project.pinned));
      toast(`${project.name} ${project.pinned ? "losgelöst" : "angeheftet"}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projektstatus konnte nicht geändert werden.", "error");
    }
  }, [toast]);

  /**
   * Give a project a name of one's own.
   *
   * The folder stays where it is: this names the row, not the directory. Two
   * checkouts of one repository sit in two folders with the same name, and
   * this is how they stop looking alike. Clearing the field hands the folder's
   * name back.
   */
  const renameWorkspaceProject = useCallback((project: WorkspaceProject) => {
    const folder = project.root.split(/[\\/]/).filter(Boolean).at(-1) || project.root;
    setInputRequest({
      title: t("Projekt umbenennen"),
      description: t("Nur der Name in der Liste ändert sich — der Ordner bleibt, wo er ist."),
      label: t("Projektname"),
      initialValue: project.name,
      placeholder: folder,
      confirmLabel: t("Umbenennen"),
      variant: "dialog",
      validate: (value) => (value.trim().length > 80 ? t("Der Name ist zu lang.") : null),
      action: async (value) => {
        setInputRequest(null);
        if (!window.kiwi) return;
        try {
          setWorkspaceState(await window.kiwi.workspace.rename(project.root, value));
          const named = value.trim();
          toast(named ? `Heißt jetzt ${named}` : `Heißt wieder ${folder}`, "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : t("Das Projekt konnte nicht umbenannt werden."), "error");
        }
      },
    });
  }, [toast]);

  const relocateWorkspaceProject = useCallback(async (missingRoot: string) => {
    if (!window.kiwi) return;
    const selected = await window.kiwi.workspace.openMany();
    if (!selected.activeRoot) return;
    await window.kiwi.workspace.remove(missingRoot);
    setWorkspaceState(await window.kiwi.workspace.list());
    await loadWorkspace(selected.activeRoot);
  }, [loadWorkspace]);

  const previewModule = useCallback(async (spec: ModuleSpec) => {
    if (!workspaceRoot || !window.kiwi) throw new Error("Kein Projekt aktiv.");
    return window.kiwi.modules.previewCreate(workspaceRoot, spec);
  }, [workspaceRoot]);

  const applyModulePlan = useCallback(async (plan: ModuleChangePlan) => {
    if (!workspaceRoot || !window.kiwi) return;
    await window.kiwi.modules.applyPlan(workspaceRoot, plan.id);
    const detected = await window.kiwi.modules.list(workspaceRoot);
    setModuleInfos(detected);
    await refreshTree(workspaceRoot);
    toast(`Modul ${plan.module.name} wurde verknüpft.`, "success");
    // Consequences of the change, e.g. a parent POM turning into an aggregator.
    for (const warning of plan.warnings || []) toast(warning, "info");
  }, [refreshTree, toast, workspaceRoot]);

  /**
   * Hands the semantic-token legend to the provider.
   *
   * The legend only exists after the server has answered "initialize", while
   * the providers are registered before the editor even mounts, so it has to
   * be delivered rather than read at registration time.
   */
  const applySemanticLegend = useCallback((capabilities: any) => {
    const legend = capabilities?.semanticTokensProvider?.legend;
    languageProviderRef.current?.setSemanticTokenLegend(
      legend?.tokenTypes?.length ? { tokenTypes: legend.tokenTypes, tokenModifiers: legend.tokenModifiers || [] } : null,
    );
  }, []);

  /** Reads disk baseline plus the possibly newer in-memory shared document. */
  const readEditorFileSnapshot = useCallback(async (root: string, path: string) => {
    if (!window.kiwi) return { content: "", savedContent: "" };
    const savedContent = await window.kiwi.file.read(path);
    const relative = collabRelativePath(root, path);
    if (!relative || !isActiveCollabHost(
      collabHostingRef.current,
      collabHostedRootRef.current,
      root,
    )) return { content: savedContent, savedContent };
    const key = path.toLocaleLowerCase();
    const epoch = collabHostEpochRef.current;
    let sharedContent = savedContent;
    await enqueueCollabFileTask(collabEditQueuesRef.current, key, async () => {
      if (epoch !== collabHostEpochRef.current
        || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      const snapshot = await window.kiwi!.collab.localSnapshot(root, relative);
      if (epoch !== collabHostEpochRef.current) return;
      sharedContent = snapshot.text;
      collabFileVersionsRef.current.set(key, snapshot.version);
      collabPlannedVersionsRef.current.set(key, snapshot.version);
      if (!collabLocalRevisionsRef.current.has(key)) collabLocalRevisionsRef.current.set(key, 0);
    });
    return { content: sharedContent, savedContent };
  }, []);

  /**
   * Opens a class that lives inside a jar.
   *
   * There is no file to read: the language server addresses it with a `jdt://`
   * address and hands back the source it has — the attached one where there is
   * one, a decompiled one where there is not. Either way the tab is read-only,
   * because there is nothing to save into and a decompiled body is not what
   * anybody wrote.
   */
  const openLibraryClass = useCallback(async (
    uri: string,
    position?: { line: number; column: number },
  ) => {
    const root = workspaceRootRef.current;
    if (!root || !window.kiwi) return false;
    const described = describeLibraryUri(uri);
    const name = described?.name || uri;
    if (!openFiles.some((file) => file.path === uri)) {
      setLoadingFiles((current) => new Set(current).add(uri));
      try {
        const source = await window.kiwi.language.request(root, "java/classFileContents", { uri });
        const content = typeof source === "string" ? source : String(source?.contents ?? "");
        if (!content.trim()) {
          toast(`Für ${name} liegt keine Quelle bei.`, "info");
          return false;
        }
        setOpenFiles((files) => [...files, {
          path: uri,
          name,
          content,
          // Saved and current are the same and stay that way, so the tab never
          // looks as though it has unsaved work in it.
          savedContent: content,
          externalContent: content,
          language: "java",
          preview: false,
          readOnly: true,
          origin: libraryClassSubtitle(described),
        }]);
      } catch (error) {
        toast(error instanceof Error ? error.message : `${name} konnte nicht geöffnet werden.`, "error");
        return false;
      } finally {
        setLoadingFiles((current) => {
          const next = new Set(current);
          next.delete(uri);
          return next;
        });
      }
    }
    setActiveDocument(null);
    setActivePath(uri);
    if (position) {
      window.setTimeout(() => {
        editorRef.current?.revealLineInCenter(position.line, revealMotionRef.current);
        editorRef.current?.setPosition({ lineNumber: position.line, column: position.column });
      }, 120);
    }
    return true;
  }, [openFiles, toast]);

  const openFile = useCallback(async (
    nodeOrPath: FileNode | string,
    position?: { line: number; column: number; endLine?: number; endColumn?: number },
  ) => {
    const path = typeof nodeOrPath === "string" ? nodeOrPath : nodeOrPath.path;
    const name = typeof nodeOrPath === "string" ? basename(path) : nodeOrPath.name;
    const existing = openFiles.find((file) => file.path === path);
    if (!existing) {
      if (!window.kiwi) return;
      setLoadingFiles((current) => new Set(current).add(path));
      try {
        const currentRoot = workspaceRootRef.current;
        const { content, savedContent } = await readEditorFileSnapshot(currentRoot, path);
        setOpenFiles((files) => [...files, {
          path,
          name,
          content,
          savedContent,
          externalContent: content,
          language: languageFromPath(path),
          preview: false,
        }]);
        if (currentRoot && isPathWithin(path, currentRoot) && path.toLowerCase().endsWith(".java")) {
          void window.kiwi.language.open({ root: currentRoot, file: path, text: content, languageId: "java" });
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : `${name} konnte nicht geöffnet werden.`, "error");
        return;
      } finally {
        setLoadingFiles((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    } else if (existing.preview) {
      setOpenFiles((files) => files.map((file) => file.path === path ? { ...file, preview: false } : file));
    }
    setActiveDocument(null);
    setActivePath(path);
    const currentRoot = workspaceRootRef.current;
    if (currentRoot && isPathWithin(path, currentRoot) && window.kiwi) {
      void window.kiwi.workflow.rememberFile(currentRoot, path).then(setWorkflow).catch(() => undefined);
    }
    if (position) {
      // The editor may still be mounting, or still showing the file that was
      // open before. Applying a selection to the wrong model does nothing at
      // all and leaves the reader at the top of the file, so the jump waits
      // for the model that actually belongs to this path instead of guessing
      // a delay that is long enough on a fast machine.
      // Compared on the path, not on the URI string: Monaco re-encodes a URI it
      // parsed, so `file:///C:/…` comes back as `file:///c%3A/…`.
      const applySelection = (attempt = 0, reasserts = 0) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const modelPath = model?.uri.fsPath || "";
        const matches = Boolean(model)
          && (samePath(modelPath, path) || samePath(safeDecodeUri(modelPath), path));
        if (!editor || !model || !matches || position.line > model.getLineCount()) {
          // Two seconds was enough on a warm machine and nowhere near it on a
          // cold one. Waiting a few seconds for an editor that is still opening
          // is the lesser surprise.
          if (attempt < 120) window.setTimeout(() => applySelection(attempt + 1), 50);
          // Giving up in silence was the worse half of this: the reader clicked
          // a problem, the editor stayed where it was, and nothing said why —
          // which reads as a dead control rather than a file that would not
          // open. It also made the fault invisible from the outside, so a jump
          // that never ran and one whose selection was taken away afterwards
          // looked exactly alike.
          else toast(`${basename(path)} konnte nicht an der gemeldeten Stelle geöffnet werden.`, "error");
          return;
        }
        // Selecting the range rather than only placing the caret is what makes
        // the jump land *on* the problem: the offending token is highlighted
        // instead of leaving the reader to find it somewhere on the line. The
        // rules for turning what a reporter said into a range a model actually
        // has live in one place, with tests, because there are more of them
        // than there looks and each one comes from a reporter that gives less
        // than it should.
        const selection = selectionForProblem(model, position);
        editor.setSelection(selection);
        editor.revealRangeInCenterIfOutsideViewport(selection, revealMotionRef.current);
        editor.focus();
        // This runs inside the click that asked for it, before React has
        // committed the state the same call just set. Whatever re-renders the
        // editor afterwards can drop the selection, and the reader is then left
        // on the right line with nothing marked — which is the whole difference
        // between jumping to a problem and merely scrolling near it. Confirming
        // once the frame has been through costs nothing when it held, and is
        // the only thing that helps when it did not.
        if (reasserts < 2) {
          window.requestAnimationFrame(() => {
            const current = editor.getSelection();
            const held = Boolean(current)
              && !current!.isEmpty()
              && current!.startLineNumber === selection.startLineNumber;
            if (!held) applySelection(attempt, reasserts + 1);
          });
        }
      };
      applySelection();
    }
  }, [openFiles, readEditorFileSnapshot, toast, workspaceRoot]);

  /**
   * Opens a file, as a preview tab or as a lasting one.
   *
   * `permanent` is not pinning. A double click in the Explorer opens a file
   * to work in rather than to glance at, and that used to set `pinned` —
   * so the pin appeared on the tab of every file anybody opened that way,
   * without anyone ever having pinned anything.
   */
  const openFileInProject = useCallback(async (root: string, node: FileNode, permanent = false) => {
    if (!window.kiwi) return;
    if (root !== workspaceRootRef.current) await loadWorkspace(root);
    const requestKey = `${root.toLowerCase()}\0${node.path.toLowerCase()}`;
    const pending = pendingFileOpens.current.get(requestKey);
    if (pending) {
      pending.permanentRequested ||= permanent;
      await pending.promise;
      // The first request may already have committed its preview state before
      // the double-click arrived, so apply the pin upgrade once more afterwards.
      if (pending.permanentRequested) {
        setOpenFiles((files) => files.map((file) => file.path === node.path
          ? { ...file, preview: false }
          : file));
      }
      return;
    }

    const request = { promise: Promise.resolve(), permanentRequested: permanent };
    pendingFileOpens.current.set(requestKey, request);
    request.promise = (async () => {
      setLoadingFiles((current) => new Set(current).add(node.path));
      try {
        const { content, savedContent } = await readEditorFileSnapshot(root, node.path);
        const lasting = request.permanentRequested || !settingsRef.current.explorerPreviewTabs;
        const nextFile: OpenFile = {
          path: node.path,
          name: node.name,
          content,
          savedContent,
          externalContent: content,
          language: languageFromPath(node.path),
          pinned: false,
          // A preview tab is replaced by the next file opened, which is exactly
          // what someone browsing does not want when they open a class to work
          // in it. Turning previews off makes every open a real tab.
          preview: !lasting && settingsRef.current.explorerPreviewTabs,
        };
        setOpenFiles((files) => {
          if (files.some((file) => file.path === node.path)) {
            return request.permanentRequested
              ? files.map((file) => file.path === node.path ? { ...file, preview: false } : file)
              : files;
          }
          const kept = files.filter((file) => !file.preview || file.content !== file.savedContent);
          const normalized = kept.map((file) => file.preview ? { ...file, preview: false } : file);
          return [...normalized, nextFile];
        });
        setActiveDocument(null);
        setActivePath(node.path);
        void window.kiwi!.workflow.rememberFile(root, node.path).then(setWorkflow).catch(() => undefined);
        if (nextFile.language === "java") {
          void window.kiwi!.language.open({ root, file: node.path, text: content, languageId: "java" });
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : `${node.name} konnte nicht geöffnet werden.`, "error");
      } finally {
        if (pendingFileOpens.current.get(requestKey) === request) pendingFileOpens.current.delete(requestKey);
        setLoadingFiles((current) => {
          const next = new Set(current);
          next.delete(node.path);
          return next;
        });
      }
    })();
    await request.promise;
  }, [loadWorkspace, readEditorFileSnapshot, toast]);

  /**
   * Explorer row callbacks. They used to be inline in the markup, which gave
   * every row a new callback identity on each render and defeated the memo on
   * TreeItem. VirtualProjectTree binds its project root to them once.
   */
  const handleTreeToggle = useCallback((root: string, item: FileNode) => {
    const opening = !isTreeNodeExpanded(item, expandedRef.current) || !item.childrenLoaded;
    setExpanded((items) => {
      const next = new Set(items);
      if (isTreeNodeExpanded(item, next) && !opening) {
        for (const identity of treeExpansionPaths(item)) next.delete(identity);
      } else {
        // Symmetric with closing: remembering only the current key loses the
        // state the moment the compacted chain regroups.
        for (const identity of treeExpansionPaths(item)) next.add(identity);
      }
      return next;
    });
    if (opening && !item.childrenLoaded) {
      void loadDirectoryChildren(
        root,
        item.path,
        settingsRef.current.explorerView === "packages"
          && settingsRef.current.compactPackages
          && /\/src\/(?:main|test)\/java\/.+/i.test(item.path.replace(/\\/g, "/")),
      );
    }
  }, [loadDirectoryChildren]);

  const handleTreeSelect = useCallback((root: string, event: React.MouseEvent, item: FileNode) => {
    if (event.shiftKey && explorerSelectionAnchorRef.current) {
      const projected = projectedTreesRef.current[root] || emptyTree;
      const visible = flattenVisibleTree(projected, expandedRef.current).map((entry) => entry.node.path);
      const anchorIndex = visible.indexOf(explorerSelectionAnchorRef.current);
      const itemIndex = visible.indexOf(item.path);
      if (anchorIndex >= 0 && itemIndex >= 0) {
        const [start, end] = anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
        setSelectedPaths(new Set(visible.slice(start, end + 1)));
      }
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      });
      explorerSelectionAnchorRef.current = item.path;
    } else {
      setSelectedPaths(new Set([item.path]));
      explorerSelectionAnchorRef.current = item.path;
    }
    setSelectedNode(item);
  }, []);

  const handleTreeOpen = useCallback((root: string, item: FileNode, permanent: boolean) => {
    void openFileInProject(root, item, permanent);
  }, [openFileInProject]);

  const handleTreeContextMenu = useCallback((root: string, event: React.MouseEvent, item: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    openExplorerContext(event.clientX, event.clientY, item, root);
  }, [openExplorerContext]);

  const handleTreeDragEnd = useCallback(() => {
    explorerDragSourceRef.current = "";
    setExplorerRootDragOver(false);
  }, []);

  const performInstantHotSwap = useCallback(async (filePath: string) => {
    const pendingTimer = hotSwapTimersRef.current.get(filePath);
    if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
    hotSwapTimersRef.current.delete(filePath);
    const request = hotSwapRequestsRef.current.get(filePath);
    const status = debugStatusRef.current;
    const canHotSwap = ["running", "paused", "restarting"].includes(status)
      || (status === "starting" && hotSwapRelaunchingRef.current);
    if (!window.kiwi || !canHotSwap) {
      hotSwapRequestsRef.current.delete(filePath);
      return false;
    }
    hotSwapRequestsRef.current.delete(filePath);
    try {
      await window.kiwi.debug.command("hotReplace", {
        file: filePath,
        mode: "smart",
        ...(request?.previousSource !== undefined ? { previousSource: request.previousSource } : {}),
      });
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Instant HotSwap ist fehlgeschlagen.", "error");
      return false;
    }
  }, [toast]);

  const scheduleInstantHotSwap = useCallback((filePath: string, previousSource?: string) => {
    const status = debugStatusRef.current;
    const canHotSwap = ["running", "paused", "restarting"].includes(status)
      || (status === "starting" && hotSwapRelaunchingRef.current);
    if (!settingsRef.current.hotSwapOnSave || !canHotSwap) return;
    hotSwapRequestsRef.current.set(filePath, { previousSource });
    const existing = hotSwapTimersRef.current.get(filePath);
    if (existing !== undefined) window.clearTimeout(existing);
    // Auto Save already has its own delay. This short per-file debounce only
    // merges repeated Ctrl+S/file-watcher bursts without making HotSwap feel
    // delayed; the service also serialises javac jobs as a second safety net.
    const timer = window.setTimeout(() => {
      hotSwapTimersRef.current.delete(filePath);
      void performInstantHotSwap(filePath);
    }, 90);
    hotSwapTimersRef.current.set(filePath, timer);
  }, [performInstantHotSwap]);

  useEffect(() => () => {
    for (const timer of hotSwapTimersRef.current.values()) window.clearTimeout(timer);
    hotSwapTimersRef.current.clear();
    hotSwapRequestsRef.current.clear();
  }, []);


  /**
   * Persists one exact host snapshot behind every older Monaco edit. Hosted
   * files must go through the collaboration service's save queue: writing the
   * disk first and replacing the shared document afterwards creates a window
   * in which a guest edit can be overwritten.
   */
  /**
   * One line per thing that happens to a file.
   *
   * Opening, saving and losing a file are the moments where a buffer and the
   * disk can disagree, and when they do there is nothing in the interface that
   * says which step went wrong. Only these moments are logged — a line per
   * keystroke would bury the one line that matters.
   */
  const logEditor = useCallback((action: string, path: string, detail = "") => {
    // eslint-disable-next-line no-console
    console.info(`[Editor] ${action} ${relativePath(workspaceRootRef.current, path) || path}${detail ? ` ${detail}` : ""}`);
  }, []);

  const persistFileSnapshot = useCallback(async (
    root: string,
    path: string,
    content: string,
    options: { recreate?: boolean; expected?: string } = {},
  ) => {
    if (!window.kiwi) return { saved: false, savedContent: content };
    const { recreate = false, expected } = options;
    const relative = collabRelativePath(root, path);
    const hostsThisRoot = collabHostingRef.current
      && collabRootsEqual(collabHostedRootRef.current, root)
      && Boolean(relative);
    // A file that is no longer there cannot be saved by the sharing service:
    // it writes a shared document over a file it expects to find, and answers
    // that the file does not exist. Writing it directly is what makes it exist
    // again, and the session picks it up from there.
    if (!hostsThisRoot || recreate) {
      // Whether the file is still the one this buffer was read from.
      //
      // Something else may have written it since: another program, a project
      // sync, Kiwi's own replace-across-files. Overwriting it would throw that
      // away without a word, and the person who did the writing has no reason
      // to suspect it happened. Only the sharing session used to check; every
      // save checks now.
      if (!recreate && typeof expected === "string") {
        const current = await window.kiwi.file.read(path).catch(() => null);
        if (current !== null && current !== expected && current !== content) {
          return { saved: false, conflict: true, savedContent: current };
        }
      }
      await window.kiwi.file.write(path, content);
      return { saved: true, savedContent: content };
    }
    const key = path.toLocaleLowerCase();
    const epoch = collabHostEpochRef.current;
    let saved = false;
    let conflict = false;
    let savedContent = content;
    await enqueueCollabFileTask(collabEditQueuesRef.current, key, async () => {
      if (epoch !== collabHostEpochRef.current
        || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      const result = await window.kiwi!.collab.localSave(root, relative);
      if (epoch !== collabHostEpochRef.current
        || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      saved = result.saved;
      conflict = result.conflict === true;
      const serviceVersion = result.currentVersion ?? result.version;
      if (Number.isInteger(serviceVersion)) collabFileVersionsRef.current.set(key, serviceVersion);
      // Read back the bytes that actually reached disk. A guest can edit while
      // the asynchronous write is running, so current Monaco/shared text is
      // not necessarily the saved baseline described by the response.
      savedContent = await window.kiwi!.file.read(path).catch(() => result.text ?? content);
      if (!result.saved) {
        if (typeof result.text === "string") savedContent = result.text;
        scheduleCollabHostSnapshotRef.current(root, relative, key);
      } else if (result.dirty !== true
        && (result.currentVersion === undefined || result.currentVersion === result.version)) {
        collabPlannedVersionsRef.current.set(key, serviceVersion);
      }
    });
    return { saved, conflict, savedContent };
  }, []);


  const saveFile = useCallback(async (path: string, silent = false) => {
    const file = openFiles.find((item) => item.path === path);
    // Nothing to save into, so saying so beats failing at the filesystem.
    if (file?.readOnly || isReadOnlyDocument(path)) {
      if (!silent) {
        toast(`${file?.name || basename(path)} stammt aus einer Bibliothek und kann nicht geändert werden.`, "info");
      }
      return false;
    }
    if (!file || !window.kiwi) {
      logEditor("Speichern übersprungen", path, file ? "keine Preload-API" : "keine offene Datei");
      return false;
    }
    logEditor("Speichern", path, file.missing ? "Datei fehlt auf der Platte" : "");
    try {
      let content = file.content;
      const activeModel = activePath === path ? editorRef.current?.getModel() : null;
      if (settings.organizeImportsOnSave && file.language === "java" && activeModel) {
        await languageProviderRef.current?.organizeImports(activeModel).catch(() => []);
        content = activeModel.getValue();
      }
      if (settings.formatOnSave && activePath === path) {
        // A formatter that is not registered leaves no trace when it does not
        // run: getAction answers null and the optional call is simply skipped,
        // so "format on save" looks switched on and does nothing at all.
        const formatAction = editorRef.current?.getAction("editor.action.formatDocument");
        const beforeFormat = content;
        await formatAction?.run();
        const formatted = editorRef.current?.getModel()?.getValue() ?? content;
        // The formatter's work on the code is kept; the whitespace around it is
        // the author's. Without this, saving re-indented every line, emptied
        // the blank ones and cut whatever followed the last character — which
        // is what "spaces and tabs are deleted on save" was.
        content = settings.formatKeepsWhitespace === false
          ? formatted
          : preserveTypedWhitespace(beforeFormat, formatted);
        if (content !== formatted) {
          // The model has the formatter's version; put back what it took.
          applyExternalContent(path, content);
        }
        logEditor(
          "Formatieren",
          path,
          !formatAction
            ? "kein Formatierer registriert"
            : formatted === beforeFormat
              ? "ohne Änderung"
              : content === beforeFormat
                ? "nur Whitespace, verworfen"
                : "Text geändert",
        );
      }
      const changed = content !== file.savedContent;
      const persisted = await persistFileSnapshot(workspaceRoot, path, content, { recreate: Boolean(file.missing), expected: file.savedContent });
      if (!persisted.saved) {
        const liveContent = monacoRef.current?.editor.getModels().find((model) =>
          model.uri.fsPath.toLocaleLowerCase() === path.toLocaleLowerCase())?.getValue();
        setOpenFiles((files) => files.map((item) => item.path === path
          ? { ...item, content: liveContent ?? item.content, savedContent: persisted.savedContent }
          : item));
        toast(
          persisted.conflict
            ? "Die Datei wurde extern geändert. Kiwi hat den aktuellen Stand geladen; bitte prüfe deine Änderungen."
            : "Die Datei konnte nicht gespeichert werden.",
          "error",
        );
        return false;
      }
      if (workspaceRoot && file.language === "java") {
        void window.kiwi.language.save({ root: workspaceRoot, file: path, text: content });
        if (changed) scheduleInstantHotSwap(path, file.savedContent);
      } else if (workspaceRoot && isPolyglotLanguage(file.language)) {
        void window.kiwi.polyglot.save({ root: workspaceRoot, file: path, text: content, languageId: file.language }).catch(() => false);
      }
      const liveContent = monacoRef.current?.editor.getModels().find((model) =>
        model.uri.fsPath.toLocaleLowerCase() === path.toLocaleLowerCase())?.getValue();
      setOpenFiles((files) => files.map((item) =>
        item.path === path
          ? { ...item, content: liveContent ?? item.content, savedContent: persisted.savedContent }
          : item,
      ));
      logEditor("Gespeichert", path);
      // The templates file takes effect where it is edited: saving it and
      // then finding the old templates still being offered reads as the
      // feature not working.
      if (isProjectTemplateFile(workspaceRoot, path)) void reloadProjectTemplates(workspaceRoot);
      if (file.missing) setOpenFiles((files) => files.map((item) => item.path === path ? { ...item, missing: false } : item));
      if (!silent) toast(`${file.name} gespeichert`, "success");
      return true;
    } catch (error) {
      logEditor("Speichern fehlgeschlagen", path, error instanceof Error ? error.message : String(error));
      toast(error instanceof Error ? error.message : "Speichern fehlgeschlagen.", "error");
      return false;
    }
  }, [activePath, logEditor, openFiles, persistFileSnapshot, reloadProjectTemplates, scheduleInstantHotSwap, settings.formatOnSave, settings.organizeImportsOnSave, toast, workspaceRoot]);

  const saveAll = useCallback(async () => {
    const dirty = openFiles.filter(isUnsaved);
    if (!window.kiwi || dirty.length === 0) return;
    try {
      const savedContents = new Map<string, string>();
      for (const file of dirty) {
        const model = monacoRef.current?.editor.getModels().find((candidate) =>
          candidate.uri.fsPath.toLowerCase() === file.path.toLowerCase(),
        );
        if (settings.organizeImportsOnSave && file.language === "java" && model) {
          await languageProviderRef.current?.organizeImports(model).catch(() => []);
        }
        const content = model?.getValue() ?? file.content;
        const persisted = await persistFileSnapshot(workspaceRoot, file.path, content, { recreate: Boolean(file.missing), expected: file.savedContent });
        savedContents.set(file.path, persisted.savedContent);
        if (!persisted.saved) {
          throw new Error(persisted.conflict
            ? `${file.name} wurde extern geändert und deshalb nicht überschrieben.`
            : `${file.name} konnte nicht gespeichert werden.`);
        }
      }
      if (workspaceRoot) {
        for (const file of dirty.filter((item) => item.language === "java")) {
          const content = savedContents.get(file.path) ?? file.content;
          void window.kiwi.language.save({ root: workspaceRoot, file: file.path, text: content });
          scheduleInstantHotSwap(file.path, file.savedContent);
        }
        for (const file of dirty.filter((item) => isPolyglotLanguage(item.language))) {
          const content = savedContents.get(file.path) ?? file.content;
          void window.kiwi.polyglot.save({ root: workspaceRoot, file: file.path, text: content, languageId: file.language }).catch(() => false);
        }
      }
      setOpenFiles((files) => files.map((file) => {
        const content = savedContents.get(file.path);
        if (content === undefined) return file;
        const liveContent = monacoRef.current?.editor.getModels().find((model) =>
          model.uri.fsPath.toLocaleLowerCase() === file.path.toLocaleLowerCase())?.getValue();
        return { ...file, content: liveContent ?? file.content, savedContent: content };
      }));
      toast(`${dirty.length} Datei${dirty.length === 1 ? "" : "en"} gespeichert`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Speichern fehlgeschlagen.", "error");
    }
  }, [openFiles, persistFileSnapshot, scheduleInstantHotSwap, settings.organizeImportsOnSave, toast, workspaceRoot]);

  const closeFile = useCallback((path: string) => {
    const file = openFiles.find((item) => item.path === path);
    const close = () => {
      const index = openFiles.findIndex((item) => item.path === path);
      const remaining = openFiles.filter((item) => item.path !== path);
      if (workspaceRoot && file?.language === "java") {
        void window.kiwi?.language.close({ root: workspaceRoot, file: path });
      } else if (workspaceRoot && file && isPolyglotLanguage(file.language)) {
        void window.kiwi?.polyglot.close({ root: workspaceRoot, file: path }).catch(() => false);
      }
      setOpenFiles(remaining);
      if (activePath === path) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path || null);
      setInputRequest(null);
    };
    if (file && isUnsaved(file)) {
      setInputRequest({
        title: "Ungespeicherte Datei schließen",
        description: "Die nicht gespeicherten Änderungen gehen verloren.",
        label: `Zur Bestätigung „${file.name}“ eingeben`,
        confirmLabel: "Trotzdem schließen",
        validate: (value) => value === file.name ? null : "Der Dateiname stimmt nicht überein.",
        action: close,
      });
      return;
    }
    close();
  }, [activePath, openFiles, workspaceRoot]);

  const closeTabGroup = useCallback((path: string, mode: "current" | "others" | "left" | "right" | "all") => {
    const index = openFiles.findIndex((file) => file.path === path);
    if (index < 0) return;
    const targets = openFiles.filter((_, candidateIndex) => {
      if (mode === "current") return candidateIndex === index;
      if (mode === "others") return candidateIndex !== index;
      if (mode === "left") return candidateIndex < index;
      if (mode === "right") return candidateIndex > index;
      return true;
    });
    if (!targets.length) return;
    const performClose = () => {
      const paths = new Set(targets.map((file) => file.path));
      for (const file of targets) {
        if (workspaceRoot && file.language === "java") {
          void window.kiwi?.language.close({ root: workspaceRoot, file: file.path });
        }
      }
      const remaining = openFiles.filter((file) => !paths.has(file.path));
      setOpenFiles(remaining);
      if (activePath && paths.has(activePath)) {
        const preferred = mode === "others"
          ? remaining.find((file) => file.path === path)
          : remaining[Math.min(index, Math.max(0, remaining.length - 1))];
        setActivePath(preferred?.path || null);
      }
      if (splitPath && paths.has(splitPath)) setSplitPath(null);
      setTabContext(null);
      setInputRequest(null);
    };
    const dirty = targets.filter(isUnsaved);
    if (dirty.length) {
      setInputRequest({
        title: `${targets.length} Tabs schließen`,
        description: `${dirty.length} Tab${dirty.length === 1 ? "" : "s"} enthält nicht gespeicherte Änderungen.`,
        label: "Zum Bestätigen SCHLIESSEN eingeben",
        confirmLabel: "Tabs trotzdem schließen",
        validate: (value) => value === "SCHLIESSEN" ? null : "Bitte SCHLIESSEN eingeben.",
        action: performClose,
      });
      return;
    }
    performClose();
  }, [activePath, openFiles, splitPath, workspaceRoot]);

  const toggleFavorite = useCallback(async (path: string) => {
    const favorites = workflow.favorites.some((candidate) => candidate.toLowerCase() === path.toLowerCase())
      ? workflow.favorites.filter((candidate) => candidate.toLowerCase() !== path.toLowerCase())
      : [path, ...workflow.favorites];
    await updateWorkflow({ favorites });
    toast(favorites.includes(path) ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt", "success");
  }, [toast, updateWorkflow, workflow.favorites]);

  const toggleBookmark = useCallback(async (targetPath?: string, lineNumber?: number) => {
    const file = targetPath || activeFile?.path;
    if (!file) return;
    const line = lineNumber ?? (cursor.line || 1);
    const existing = workflow.bookmarks.find((b) => samePath(b.path, file) && b.line === line);
    let nextBookmarks;
    if (existing) {
      nextBookmarks = workflow.bookmarks.filter((b) => b.id !== existing.id);
      toast(`Lesezeichen in Zeile ${line} entfernt.`, "info");
    } else {
      const targetFile = openFiles.find((f) => samePath(f.path, file)) || activeFile;
      const lineContent = targetFile?.content ? targetFile.content.split("\n")[line - 1]?.trim() : "";
      const label = lineContent ? `${basename(file)}:${line} — ${lineContent.slice(0, 40)}` : `${basename(file)}:${line}`;
      nextBookmarks = [...workflow.bookmarks, {
        id: crypto.randomUUID(),
        path: file,
        line,
        label,
      }];
      toast(`Lesezeichen in Zeile ${line} gesetzt.`, "success");
    }
    await updateWorkflow({ bookmarks: nextBookmarks });
  }, [activeFile, cursor.line, openFiles, toast, updateWorkflow, workflow.bookmarks]);
  const toggleBookmarkRef = useRef(toggleBookmark);
  useEffect(() => {
    toggleBookmarkRef.current = toggleBookmark;
  }, [toggleBookmark]);

  const applySurround = useCallback((kind: SurroundKind) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const monaco = monacoRef.current;
    if (!editor || !model || !monaco) return;
    const rawSel = editor.getSelection();
    const pos = editor.getPosition() || { lineNumber: 1, column: 1 };
    const selection = (!rawSel || rawSel.isEmpty())
      ? new monaco.Range(pos.lineNumber, 1, pos.lineNumber, model.getLineMaxColumn(pos.lineNumber))
      : rawSel;
    const lineRange = new monaco.Range(
      selection.startLineNumber,
      1,
      selection.endLineNumber,
      model.getLineMaxColumn(selection.endLineNumber),
    );
    const textToWrap = model.getValueInRange(lineRange);
    const indent = model.getOptions().insertSpaces
      ? " ".repeat(model.getOptions().tabSize)
      : "\t";
    const wrapped = surroundSelection(textToWrap, kind, { indent });
    const snippetController = (editor as { getContribution?: (id: string) => { insert?: (text: string, range?: unknown) => void } | null }).getContribution?.("snippetController2");
    if (snippetController?.insert) {
      editor.setSelection(lineRange);
      snippetController.insert(wrapped, lineRange);
    } else {
      const clean = wrapped.replace(/\$\{\d+:([^}]+)\}/g, "$1").replace(/\$\{\d+\}/g, "");
      editor.executeEdits("kiwi.surroundSelection", [{ range: lineRange, text: clean }]);
    }
    editor.focus();
  }, []);


  useEffect(() => {
    void window.kiwi?.git.githubStatus().then(setGithubSession).catch(() => setGithubSession(null));
  }, []);

  /** Loads the data the project structure dialog needs, then opens it in a separate window. */
  const openProjectStructure = useCallback(() => {
    if (!workspaceRoot || !window.kiwi) {
      toast("Öffne zuerst ein Projekt.", "info");
      return;
    }
    if (window.kiwi.app?.openStructure) {
      void window.kiwi.app.openStructure(workspaceRoot);
    } else {
      setProjectStructureOpen(true);
      void window.kiwi.project.listJdks().then(setStructureJdks).catch(() => setStructureJdks([]));
      void window.kiwi.modules.list(workspaceRoot).then(setModuleInfos).catch(() => undefined);
      if (!dependencyAudit) {
        void window.kiwi.project.auditDependencies(workspaceRoot).then(setDependencyAudit).catch(() => undefined);
      }
    }
  }, [dependencyAudit, toast, workspaceRoot]);

  /** Opens New Project wizard in a separate window. */
  const openNewProject = useCallback(() => {
    if (window.kiwi?.app?.openNewProject) {
      void window.kiwi.app.openNewProject(workspaceRoot ? dirname(workspaceRoot) : "");
    } else {
      setProjectWizardOpen(true);
    }
  }, [workspaceRoot]);

  /** Opens the field picker; the dialog calls generateMembers with a selection. */
  const requestGenerateMembers = useCallback((kind: JavaGenerationKind) => {
    if (!activeFile || activeFile.language !== "java") {
      toast("Öffne zuerst eine Java-Klasse.", "info");
      return;
    }
    setGenerateRequest({ kind, source: activeFile.content });
  }, [activeFile, toast]);

  const generateMembers = useCallback((kind: JavaGenerationKind, fields?: string[]) => {
    if (!activeFile || activeFile.language !== "java") {
      toast("Öffne zuerst eine Java-Klasse.", "info");
      return;
    }
    try {
      const next = generateJavaMembers(activeFile.content, kind, { fields });
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (editor && model && model.uri.fsPath.toLowerCase() === activeFile.path.toLowerCase()) {
        editor.pushUndoStop();
        editor.executeEdits("kiwi.generateMembers", [{ range: model.getFullModelRange(), text: next }]);
        editor.pushUndoStop();
      } else {
        setOpenFiles((files) => files.map((file) => file.path === activeFile.path ? { ...file, content: next } : file));
      }
      toast("Java-Member generiert", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Code konnte nicht generiert werden.", "error");
    }
  }, [activeFile, toast]);

  const createScratch = useCallback(() => {
    if (!workspaceRoot || !window.kiwi) return;
    setInputRequest({
      title: "Java Scratch erstellen",
      description: "Scratch-Dateien werden unter .kiwi gespeichert und nicht in normale Builds aufgenommen.",
      label: "Name",
      initialValue: "Scratch",
      confirmLabel: "Erstellen",
      validate: (value) => /^[A-Za-z_$][\w$]*(?:\.java)?$/.test(value) ? null : "Ungültiger Java-Klassenname.",
      action: async (name) => {
        const file = await window.kiwi!.workflow.createScratch(workspaceRoot, name);
        setWorkflow(await window.kiwi!.workflow.get(workspaceRoot));
        setInputRequest(null);
        await openFile(file);
      },
    });
  }, [openFile, workspaceRoot]);

  const saveTerminalTask = useCallback(() => {
    const command = terminalCommand.trim();
    if (!command) {
      toast("Gib zuerst einen Terminal-Befehl ein.", "info");
      return;
    }
    setInputRequest({
      title: "Terminal-Task speichern",
      label: "Task-Name",
      initialValue: command.split(/\s+/)[0] || "Task",
      confirmLabel: "Speichern",
      action: async (name) => {
        await updateWorkflow({
          terminalTasks: [...workflow.terminalTasks, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            command,
          }],
        });
        setInputRequest(null);
        toast("Terminal-Task gespeichert", "success");
      },
    });
  }, [terminalCommand, toast, updateWorkflow, workflow.terminalTasks]);

  const undoLastProjectOperation = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      const result = await window.kiwi.workspace.undo(workspaceRoot);
      await refreshTree(workspaceRoot);
      const refreshed = await Promise.all(openFiles.map(async (file) => {
        try {
          const content = await window.kiwi!.file.read(file.path);
          applyExternalContent(file.path, content);
          return { ...file, content, savedContent: content, externalContent: content };
        } catch {
          return null;
        }
      }));
      setOpenFiles(refreshed.filter(Boolean) as OpenFile[]);
      toast(`Rückgängig: ${result.label}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Operation konnte nicht rückgängig gemacht werden.", "error");
    }
  }, [openFiles, refreshTree, toast, workspaceRoot]);

  const showLocalHistory = useCallback(async (file = activeFile?.path) => {
    if (!workspaceRoot || !window.kiwi) return;
    const entries = await window.kiwi.workspace.history(workspaceRoot, file);
    const text = entries.length
      ? entries.map((entry) => `${new Date(entry.timestamp).toLocaleString()}  ${entry.label}  (${entry.files} Dateien)${entry.undone ? " · rückgängig" : ""}`).join("\n")
      : "Für diese Auswahl ist noch keine lokale Historie vorhanden.";
    replaceBuildOutput(text);
    setPanel("build");
    setPanelVisible(true);
  }, [activeFile?.path, replaceBuildOutput, workspaceRoot]);

  const saveNamedWorkspace = useCallback(() => {
    if (!workspaceRoot || !window.kiwi) return;
    setInputRequest({
      title: "Workspace speichern",
      description: "Speichert die aktuell geöffneten Projektwurzeln als benannten Workspace.",
      label: "Workspace-Name",
      initialValue: `${basename(workspaceRoot)} Workspace`,
      confirmLabel: "Speichern",
      action: async (name) => {
        setWorkspaceState(await window.kiwi!.workspace.saveProfile(name));
        setInputRequest(null);
        toast("Workspace gespeichert", "success");
      },
    });
  }, [recordPerformanceMetric, toast, workspaceRoot]);

  const openNamedWorkspace = useCallback(async (id: string) => {
    if (!window.kiwi) return;
    const state = await window.kiwi.workspace.openProfile(id);
    setWorkspaceState(state);
    const trees = await Promise.all(state.projects.filter((project) => project.exists).map(async (project) => [
      project.root,
      await window.kiwi!.workspace.tree(project.root).catch(() => []),
    ] as const));
    setWorkspaceTrees(Object.fromEntries(trees));
    if (state.activeRoot) await loadWorkspace(state.activeRoot);
  }, [loadWorkspace]);

  const runJava = useCallback(async (action: JavaAction, moduleId?: string, override?: RunConfiguration, targetFile?: string) => {
    // A compound is not run; the configurations it names are. Caught here so
    // every way in — the toolbar, F5, the palette, the menu — goes the same
    // way. The recursive calls carry an override and fall straight through.
    if (action === "run" && !override && isCompound(activeRunConfiguration)) {
      await runCompoundRef.current(activeRunConfiguration as RunConfiguration);
      return;
    }
    if (!workspaceRoot || !window.kiwi) {
      toast("Öffne zuerst ein Projekt.", "info");
      return;
    }
    const effectiveFile = targetFile
      ? { path: targetFile, name: basename(targetFile), language: languageFromPath(targetFile) }
      : activeFile;
    const activeSourceLanguage = effectiveFile && isPolyglotLanguage(effectiveFile.language) ? effectiveFile.language : projectInfo.language;
    const polyglotRun = !override && activeSourceLanguage && isPolyglotLanguage(activeSourceLanguage);
    await saveAll();
    if (settings.openConsoleOnRun) {
      setPanelVisible(true);
      setPanel(action === "test" && !polyglotRun ? "tests" : action === "build" ? "build" : "run");
    }
    // The clean Build view represents only the current build. Keeping old
    // compiler output here would leave already fixed diagnostics visible.
    if (action === "build" || !settings.preserveConsoleOutput) {
      replaceBuildOutput("");
    }
    activeJavaActionRef.current = action;
    setLastJavaAction(action);
    setLastProcessExitCode(null);
    if (action === "build") setBuildRawOpen(false);
    updateTerminalLog((current) => `${current}\n\u001b[32mkiwi\u001b[0m › ${action} ${effectiveFile?.name || runnableFile?.name || basename(workspaceRoot)}\n`);
    setRunning(true);
    try {
      const projectBuildType = projectInfo.type === "Maven"
        ? "maven" as const
        : projectInfo.type === "Gradle"
          ? "gradle" as const
          : "java" as const;
      const target = moduleId ? moduleInfos.find((module) => module.id === moduleId) : null;
      const configuration = action === "build"
        ? { name: target ? `Modul bauen: ${target.name}` : "Projekt bauen", type: projectBuildType }
        // An override is one step of a compound; without one it is whatever the
        // toolbar has selected.
        : (override || activeRunConfiguration || { name: "Temporär", type: "java" as const });
      if (polyglotRun && activeSourceLanguage) {
        const result = await window.kiwi.polyglot.execute({
          root: workspaceRoot, file: effectiveFile?.path, action,
          language: activeSourceLanguage as import("./types").ProjectLanguage,
        });
        if (!result.started) setRunning(false);
        if (result.operationId) upsertOperation({
          id: result.operationId, projectRoot: workspaceRoot, kind: action,
          label: `${languageDisplayName(activeSourceLanguage)} · ${action}`, detail: result.command || "", cancellable: true,
        });
        return;
      }
      const result = await window.kiwi.java.execute({
        root: workspaceRoot,
        file: effectiveFile?.path || runnableFile?.path,
        action,
        configuration: {
          ...configuration,
          // An empty moduleId builds the whole project, which is what the
          // toolbar and the project-level action pass.
          ...(moduleId ? { moduleId } : {}),
          env: {
            ...parseEnvironmentTemplate(settings.runEnvironmentTemplate),
            ...(action === "build" ? {} : activeRunConfiguration?.env || {}),
          },
        },
      });
      setProjectInfo(result.project);
      if (result.operationId) {
        upsertOperation({
          id: result.operationId,
          projectRoot: workspaceRoot,
          kind: action,
          label: action === "test" ? "Tests ausführen" : action === "build" ? "Projekt bauen" : "Anwendung ausführen",
          detail: result.command,
          cancellable: true,
        });
      }
    } catch (error) {
      setRunning(false);
      setLastProcessExitCode(1);
      toast(error instanceof Error ? error.message : "Java-Prozess konnte nicht gestartet werden.", "error");
    }
  }, [activeFile, runnableFile, activeRunConfiguration, moduleInfos, projectInfo.type, projectInfo.language, replaceBuildOutput, saveAll, settings.openConsoleOnRun, settings.preserveConsoleOutput, settings.runEnvironmentTemplate, toast, updateTerminalLog, upsertOperation, workspaceRoot]);
  runJavaRef.current = runJava;

  /**
   * A configuration that starts several others.
   *
   * A server and its client, a build and the thing it built, a suite split
   * across three modules: each of those was two or three trips to the run
   * dropdown, in an order that had to be remembered.
   *
   * Resolved before anything starts, so a compound that contains itself is
   * reported rather than followed — that would be an editor hanging on a click
   * with no way back.
   */
  const runCompoundConfiguration = useCallback(async (configuration: RunConfiguration) => {
    const resolved = resolveCompound(runConfigurations as never, configuration.id || "");
    for (const problem of resolved.problems) toast(problem, "error");
    if (!resolved.steps.length) return;
    toast(describeCompound(resolved), "info");
    if (resolved.mode === "parallel") {
      await Promise.all(resolved.steps.map((step) => runJava("run", undefined, step as RunConfiguration)));
      return;
    }
    for (const step of resolved.steps) {
      await runJava("run", undefined, step as RunConfiguration);
    }
  }, [runConfigurations, runJava, toast]);
  runCompoundRef.current = runCompoundConfiguration;

  const stopJava = useCallback(async () => {
    await window.kiwi?.java.stop(workspaceRoot);
    await window.kiwi?.polyglot.stopRun(workspaceRoot);
    setRunning(false);
    toast("Prozess beendet", "info");
  }, [toast, workspaceRoot]);

  const executeTerminal = useCallback(async () => {
    const command = terminalCommand.trim();
    if (!command || !workspaceRoot || !window.kiwi) return;
    setCommandHistory((items) => [command, ...items.filter((item) => item !== command)].slice(0, 50));
    setHistoryIndex(-1);
    setTerminalCommand("");
    await window.kiwi.terminal.execute({ root: workspaceRoot, command, sessionId: activeTerminalId });
  }, [activeTerminalId, terminalCommand, workspaceRoot]);

  const performSearch = useCallback(async () => {
    if (!workspaceRoot || !searchQuery.trim() || !window.kiwi) return;
    setSearching(true);
    setSearchError("");
    try {
      setSearchResults(replaceMode
        ? await window.kiwi.workspace.replacePreview(workspaceRoot, searchQuery.trim(), replaceValue, searchOptions)
        : await window.kiwi.workspace.search(workspaceRoot, searchQuery.trim(), searchOptions));
    } catch (error) {
      // An invalid regular expression is a normal typing state, not a failure.
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : "Suche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  }, [replaceMode, replaceValue, searchOptions, searchQuery, workspaceRoot]);

  /**
   * Reloads the open buffers that Kiwi itself has just rewritten on disk.
   *
   * Only the ones with nothing unsaved in them: a buffer being edited is the
   * one place the person's work exists, and replacing its text with the file's
   * would be the loss this is meant to prevent. Those keep their edits and are
   * caught by the conflict check when they are saved.
   */
  /**
   * Puts text Kiwi decided on into the editor's model.
   *
   * Reloading after a replace, renaming, undoing a local-history step: the
   * buffer's text is being replaced by the application rather than by typing,
   * and the model has to be told. Monaco keeps the undo stack across this, so
   * the change can still be undone.
   *
   * The caret is put back where it was. setValue drops it at the very
   * beginning of the file, which is what "after about two seconds the cursor
   * jumps to the front" was: something reloaded the buffer underneath somebody
   * who was typing in the middle of it, and took their place in the file with
   * it. Where the text is genuinely different the position is clamped to what
   * the new text has, so the caret lands as close as the file allows.
   */
  const applyExternalContent = useCallback((path: string, content: string) => {
    const model = monacoRef.current?.editor.getModels()
      .find((candidate) => samePath(candidate.uri.fsPath, path));
    if (!model || model.getValue() === content) return;
    const editor = editorRef.current;
    const showing = editor?.getModel() === model;
    const position = showing ? editor?.getPosition() ?? null : null;
    const scrollTop = showing ? editor?.getScrollTop() ?? null : null;
    // An edit rather than a wholesale replacement: this keeps the undo stack,
    // so a reload can still be undone.
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: content }],
      () => null,
    );
    if (showing && position && editor) {
      editor.setPosition(model.validatePosition(position));
      if (typeof scrollTop === "number") editor.setScrollTop(scrollTop);
    }
    logEditor("Neu geladen", path);
  }, [logEditor]);

  const adoptDiskContent = useCallback(async (paths: string[]) => {
    if (!window.kiwi || !paths.length) return;
    const open = currentSessionRef.current.files;
    const reloadable = open.filter((file) => !isUnsaved(file) && paths.some((candidate) => samePath(candidate, file.path)));
    if (!reloadable.length) return;
    const loaded = await Promise.all(reloadable.map(async (file) => ({
      path: file.path,
      content: await window.kiwi!.file.read(file.path).catch(() => null),
    })));
    setOpenFiles((files) => files.map((file) => {
      const next = loaded.find((entry) => samePath(entry.path, file.path));
      if (!next || next.content === null || next.content === file.content) return file;
      applyExternalContent(file.path, next.content);
      return { ...file, content: next.content, savedContent: next.content, externalContent: next.content };
    }));
  }, [applyExternalContent, logEditor]);

  const replaceAllMatches = useCallback(async () => {
    if (!workspaceRoot || !searchQuery || !window.kiwi) return;
    try {
      const result = await window.kiwi.workspace.replaceAll(
        workspaceRoot,
        searchQuery,
        replaceValue,
        [...new Set(searchResults.map((item) => item.path))],
        searchOptions,
      );
      await refreshTree();
      // The replacement was written straight to disk, behind whatever is open.
      // A buffer left holding the old text would look saved and put it back on
      // the next save; one that is being edited keeps its edits, and the check
      // in persistFileSnapshot is what stops that save from silently winning.
      await adoptDiskContent([...new Set(searchResults.map((item) => item.path))]);
      setSearchResults([]);
      toast(`${result.replacements} Ersetzungen in ${result.files} Dateien`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ersetzen fehlgeschlagen.", "error");
    }
  }, [adoptDiskContent, refreshTree, replaceValue, searchOptions, searchQuery, searchResults, toast, workspaceRoot]);

  const createEntry = useCallback((directory: boolean, targetNode?: FileNode | null) => {
    if (!workspaceRoot || !window.kiwi) return;
    const target = targetNode === undefined ? selectedNode : targetNode;
    const parent = target?.type === "directory"
      ? target.path
      : target
        ? dirname(target.path)
        : workspaceRoot;
    setInputRequest({
      title: directory ? "Verzeichnis erstellen" : "Datei erstellen",
      description: relativePath(workspaceRoot, parent) || basename(workspaceRoot),
      label: directory ? "Verzeichnisname" : "Dateiname",
      initialValue: directory ? "new-package" : "Main.java",
      validate: (name) => /[<>:"/\\|?*]/.test(name) ? "Der Name enthält ungültige Zeichen." : null,
      action: async (name) => {
        try {
          const path = await window.kiwi!.file.create(parent, name, directory);
          if (!directory && name.endsWith(".java")) await window.kiwi!.file.write(path, javaTemplate(name));
          setExpanded((items) => new Set([...items, ...ancestorDirectories(workspaceRootRef.current, parent)]));
          await refreshTree();
          if (!directory) await openFile(path);
          setInputRequest(null);
          toast(`${directory ? "Ordner" : "Datei"} erstellt`, "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Element konnte nicht erstellt werden.", "error");
        }
      },
    });
  }, [openFile, refreshTree, selectedNode, toast, workspaceRoot]);

  const createTemplateEntry = useCallback((template: ProjectNewItem, targetNode?: FileNode | null) => {
    if (!workspaceRoot || !window.kiwi) return;
    const target = targetNode === undefined ? selectedNode : targetNode;
    const parent = target?.type === "directory"
      ? target.path
      : target
        ? dirname(target.path)
        : workspaceRoot;
    setInputRequest({
      title: `${template.label} erstellen`,
      description: relativePath(workspaceRoot, parent) || basename(workspaceRoot),
      label: template.isPackage ? "Paketname (Ordner)" : "Dateiname",
      initialValue: template.defaultName,
      validate: (name) => /[<>:"/\\|?*]/.test(name) ? "Der Name enthält ungültige Zeichen." : null,
      action: async (rawName) => {
        try {
          const trimmed = rawName.trim();
          let name = trimmed;
          if (template.extension && !name.toLowerCase().endsWith(template.extension.toLowerCase())) {
            name = `${name}${template.extension}`;
          }
          if (template.isPackage) {
            const folder = await window.kiwi!.file.create(parent, trimmed, true);
            const initFile = await window.kiwi!.file.create(folder, "__init__.py", false);
            await window.kiwi!.file.write(initFile, template.content(trimmed));
            setExpanded((items) => new Set([...items, ...ancestorDirectories(workspaceRootRef.current, parent), folder]));
            await refreshTree();
            await openFile(initFile);
            setInputRequest(null);
            toast("Paket erstellt", "success");
            return;
          }
          const path = await window.kiwi!.file.create(parent, name, false);
          const content = template.content(name.replace(/\.[^.]+$/, ""));
          if (content) {
            await window.kiwi!.file.write(path, content);
          }
          setExpanded((items) => new Set([...items, ...ancestorDirectories(workspaceRootRef.current, parent)]));
          await refreshTree();
          await openFile(path);
          setInputRequest(null);
          toast(`${template.label} erstellt`, "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Element konnte nicht erstellt werden.", "error");
        }
      },
    });
  }, [openFile, refreshTree, selectedNode, toast, workspaceRoot]);

  const runFileFromExplorer = useCallback(async (node: FileNode) => {
    await openFile(node.path);
    void runJava("run", undefined, undefined, node.path);
  }, [openFile, runJava]);

  const renameEntry = useCallback((targetNode?: FileNode | null) => {
    const target = targetNode === undefined ? selectedNode : targetNode;
    if (!target || !window.kiwi) return;
    const dot = target.type === "file" ? target.name.lastIndexOf(".") : -1;
    const extension = dot > 0 ? target.name.slice(dot) : "";
    const editableName = extension ? target.name.slice(0, dot) : target.name;
    setInputRequest({
      title: "Refactor · Umbenennen",
      description: extension
        ? `Die Dateiendung ${extension} bleibt erhalten.`
        : target.path,
      label: extension ? "Neuer Name ohne Dateiendung" : "Neuer Name",
      initialValue: editableName,
      confirmLabel: "Umbenennen",
      validate: (name) => /[<>:"/\\|?*.]/.test(name)
        ? "Der Name darf keine Dateiendung oder ungültige Zeichen enthalten."
        : extension === ".java" && !/^[A-Za-z_$][\w$]*$/.test(name)
          ? "Java-Klassennamen müssen gültige Java-Bezeichner sein."
          : null,
      action: async (name) => {
        const fullName = `${name}${extension}`;
        if (fullName === target.name) {
          setInputRequest(null);
          return;
        }
        try {
          const nextPath = await window.kiwi!.file.rename(target.path, fullName);
          const updatedContent = extension === ".java"
            ? await window.kiwi!.file.read(nextPath)
            : null;
          setOpenFiles((files) => files.map((file) =>
            file.path === target.path
              ? {
                ...file,
                path: nextPath,
                name: fullName,
                language: languageFromPath(nextPath),
                ...(updatedContent === null ? {} : { content: updatedContent, savedContent: updatedContent, externalContent: updatedContent }),
              }
              : file,
          ));
          if (activePath === target.path) setActivePath(nextPath);
          setSelectedNode(null);
          await refreshTree();
          setInputRequest(null);
          toast("Umbenannt", "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Umbenennen fehlgeschlagen.", "error");
        }
      },
    });
  }, [activePath, refreshTree, selectedNode, toast]);

  const deleteEntry = useCallback(async (targetNode?: FileNode | null) => {
    const target = targetNode === undefined ? selectedNode : targetNode;
    if (!target || !window.kiwi) return;
    try {
      await window.kiwi.file.delete(target.path);
      const root = workspaceRootRef.current;
      const nextTree = removeTreeNode(workspaceTreesRef.current[root] || [], target.path);
      workspaceTreesRef.current = { ...workspaceTreesRef.current, [root]: nextTree };
      setWorkspaceTrees((current) => ({ ...current, [root]: nextTree }));
      setTree(nextTree);
      setExpanded((items) => new Set([
        ...[...items].filter((path) => !isPathWithin(path, target.path)),
        ...ancestorDirectories(workspaceRootRef.current, dirname(target.path)),
      ]));
      setOpenFiles((files) => files.filter((file) => !isPathWithin(file.path, target.path)));
      if (activePath && isPathWithin(activePath, target.path)) setActivePath(null);
      if (splitPath && isPathWithin(splitPath, target.path)) setSplitPath(null);
      setSelectedNode(null);
      setSelectedPaths(new Set());
      await refreshTree(root);
      toast(`${target.name} in den Papierkorb verschoben`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Löschen fehlgeschlagen.", "error");
    }
  }, [activePath, refreshTree, selectedNode, splitPath, toast]);

  const createJavaElement = useCallback((
    kind: "package" | JavaSourceKind,
    targetNode?: FileNode | null,
  ) => {
    if (!workspaceRoot || !window.kiwi) return;
    const target = targetNode === undefined ? selectedNode : targetNode;
    const parent = target?.type === "directory" ? target.path : target ? dirname(target.path) : workspaceRoot;
    const packageName = javaPackageAt(workspaceRoot, parent, projectInfo.type);
    if (kind !== "package") {
      setJavaTypeRequest({ parent, packageName, initialKind: kind });
      return;
    }
    setInputRequest({
      title: "Neues Package",
      description: relativePath(workspaceRoot, parent) || basename(workspaceRoot),
      label: packageName ? "Vollständiger oder neuer Package-Name" : "Package-Name",
      initialValue: packageName ? `${packageName}.` : "com.example",
      variant: "quick",
      validate: (name) => /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(name) ? null : "Ungültiger Package-Name.",
      action: async (name) => {
        try {
          const result = await window.kiwi!.project.createSourceElement(workspaceRoot, parent, "package", name);
          setExpanded((items) => new Set([
            ...items,
            ...ancestorDirectories(workspaceRootRef.current, result.type === "directory" ? result.path : dirname(result.path)),
          ]));
          await refreshTree();
          await loadDirectoryChildren(workspaceRoot, parent);
          setInputRequest(null);
          toast("Package erstellt", "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Package konnte nicht erstellt werden.", "error");
        }
      },
    });
  }, [loadDirectoryChildren, projectInfo.type, refreshTree, selectedNode, toast, workspaceRoot]);

  const createJavaType = useCallback(async ({
    kind,
    name,
    options,
  }: {
    kind: JavaSourceKind;
    name: string;
    options: JavaTypeOptions;
  }) => {
    if (!workspaceRoot || !window.kiwi || !javaTypeRequest) return;
    try {
      const result = await window.kiwi.project.createSourceElement(
        workspaceRoot,
        javaTypeRequest.parent,
        kind,
        name,
        options,
      );
      setExpanded((items) => new Set([
        ...items,
        ...ancestorDirectories(workspaceRootRef.current, dirname(result.path)),
      ]));
      await refreshTree();
      await loadDirectoryChildren(workspaceRoot, javaTypeRequest.parent);
      await openFile(result.path);
      setJavaTypeRequest(null);
      toast(`${kind === "junit" ? "JUnit-Test" : "Java-Typ"} erstellt`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Java-Typ konnte nicht erstellt werden.", "error");
    }
  }, [javaTypeRequest, loadDirectoryChildren, openFile, refreshTree, toast, workspaceRoot]);

  const createModuleInfo = useCallback((targetNode?: FileNode | null) => {
    if (!workspaceRoot || !window.kiwi) return;
    const target = targetNode === undefined ? selectedNode : targetNode;
    const parent = target?.type === "directory" ? target.path : target ? dirname(target.path) : workspaceRoot;
    setInputRequest({
      title: "JPMS-Descriptor erstellen",
      description: "Erzeugt module-info.java im ausgewählten Source Root.",
      label: "Modulname",
      initialValue: basename(workspaceRoot).replace(/[^A-Za-z0-9.]/g, ".").toLowerCase(),
      validate: (name) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name) ? null : "Ungültiger JPMS-Modulname.",
      action: async (name) => {
        try {
          const file = await window.kiwi!.file.create(parent, "module-info.java", false);
          await window.kiwi!.file.write(file, `module ${name} {\n}\n`);
          await refreshTree();
          await openFile(file);
          setInputRequest(null);
          toast("module-info.java erstellt", "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "JPMS-Descriptor konnte nicht erstellt werden.", "error");
        }
      },
    });
  }, [openFile, refreshTree, selectedNode, toast, workspaceRoot]);

  const duplicateEntry = useCallback(async (target: FileNode) => {
    if (!window.kiwi) return;
    try {
      const path = await window.kiwi.file.duplicate(target.path);
      await refreshTree();
      if (target.type === "file") await openFile(path);
      toast("Element dupliziert", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Duplizieren fehlgeschlagen.", "error");
    }
  }, [openFile, refreshTree, toast]);

  const getExplorerSelection = useCallback((fallback?: FileNode | null) => {
    const root = workspaceRootRef.current;
    const allNodes = flattenTreeNodes(workspaceTreesRef.current[root] || []);
    const chosen = allNodes.filter((node) => selectedPaths.has(node.path));
    if (fallback && !chosen.some((node) => node.path === fallback.path)) return [fallback];
    const candidates = chosen.length ? chosen : fallback ? [fallback] : selectedNode ? [selectedNode] : [];
    return candidates.filter((candidate) => !candidates.some((parent) =>
      parent.path !== candidate.path && parent.type === "directory" && isPathWithin(candidate.path, parent.path)));
  }, [selectedNode, selectedPaths]);

  const pasteExplorerEntry = useCallback((target: FileNode) => {
    const clipboard = explorerClipboardRef.current;
    const kiwi = window.kiwi;
    if (!clipboard || !kiwi) return Promise.resolve();
    const directory = target.type === "directory" ? target.path : dirname(target.path);
    return runSingleFlight(explorerPasteInFlightRef, async () => {
      try {
        if (clipboard.move) {
          const moveResolution = resolveCrossModuleJavaMove(
            clipboard.nodes.map((node) => ({ path: node.path, type: node.type })),
            directory,
            moduleInfos,
          );
          if (moveResolution.kind === "blocked") throw new Error(moveResolution.message);
          if (moveResolution.kind === "preview") {
            await saveAll();
            const plan = await kiwi.refactor.previewMove(workspaceRoot, moveResolution.request);
            setJavaRefactorPlan(plan);
            setActiveDocument("java-refactor");
            toast("Sichere Modulverschiebung wird vor dem Anwenden vollständig angezeigt.", "info");
            return;
          }
        }
        const completed: string[] = [];
        for (const node of clipboard.nodes) {
          if (node.path === directory || isPathWithin(directory, node.path)) {
            throw new Error(`${node.name} kann nicht in sich selbst eingefügt werden.`);
          }
          completed.push(await kiwi.file.transfer(node.path, directory, clipboard.move));
        }
        if (clipboard.move) {
          setOpenFiles((files) => files.filter((file) =>
            !clipboard.nodes.some((node) => isPathWithin(file.path, node.path))));
          updateExplorerClipboard(null);
        }
        setExpanded((items) => new Set([...items, directory]));
        await refreshTree();
        setSelectedPaths(new Set(completed));
        toast(
          `${completed.length} Element${completed.length === 1 ? "" : "e"} ${clipboard.move ? "verschoben" : "kopiert"}`,
          "success",
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : "Einfügen fehlgeschlagen.", "error");
      }
    });
  }, [moduleInfos, refreshTree, saveAll, toast, updateExplorerClipboard, workspaceRoot]);

  const handleExplorerDragStart = useCallback((event: React.DragEvent, node: FileNode) => {
    const paths = getExplorerSelection(node).map((entry) => entry.path);
    explorerDragSourceRef.current = paths[0] || node.path;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-kiwi-explorer-path", paths[0] || node.path);
    event.dataTransfer.setData("application/x-kiwi-explorer-paths", JSON.stringify(paths));
    event.dataTransfer.setData("text/plain", paths.join("\n"));
    // The native OS drag is deferred until the pointer leaves the window.
    // webContents.startDrag() takes over the drag session, so starting it here
    // would cancel the HTML drag before an internal drop can complete.
    nativeDragPathsRef.current = paths;
  }, [getExplorerSelection]);

  const handleExplorerDrop = useCallback(async (event: React.DragEvent, targetNode: FileNode) => {
    if (!window.kiwi || !workspaceRoot) return;
    const targetDirectory = targetNode.type === "directory" ? targetNode.path : dirname(targetNode.path);
    const expansionBeforeDrop = new Set(expandedRef.current);
    setExplorerRootDragOver(false);
    markSelfInflicted([targetDirectory, targetNode.path]);
    try {
      await saveAll();
      let results: Array<{ source: string; target: string; move: boolean }> = [];
      const rawInternalSources = event.dataTransfer.getData("application/x-kiwi-explorer-paths");
      const parsedInternalSources: unknown = rawInternalSources
        ? JSON.parse(rawInternalSources)
        : [event.dataTransfer.getData("application/x-kiwi-explorer-path")].filter(Boolean);
      const internalSources: string[] = Array.isArray(parsedInternalSources)
        ? parsedInternalSources.filter((source): source is string => typeof source === "string" && source.length > 0)
        : [];
      if (internalSources.length && internalSources.every((source: string) => isPathWithin(source, workspaceRoot))) {
        const normalizedSources = internalSources.filter((source: string, index: number, sources: string[]) =>
          sources.indexOf(source) === index
          && !sources.some((parent) => parent !== source && isPathWithin(source, parent)));
        const explorerNodes = new Map(flattenTreeNodes(workspaceTreesRef.current[workspaceRoot] || []).map((node) => [node.path, node]));
        const moveResolution = resolveCrossModuleJavaMove(
          normalizedSources.map((source) => ({
            path: source,
            type: explorerNodes.get(source)?.type || (/\.java$/i.test(source) ? "file" : "directory"),
          })),
          targetDirectory,
          moduleInfos,
        );
        if (moveResolution.kind === "blocked") throw new Error(moveResolution.message);
        if (moveResolution.kind === "preview") {
          const plan = await window.kiwi.refactor.previewMove(workspaceRoot, moveResolution.request);
          setJavaRefactorPlan(plan);
          setActiveDocument("java-refactor");
          toast("Sichere Modulverschiebung wird vor dem Anwenden vollständig angezeigt.", "info");
          return;
        }
        /*
         * Asked before anything moves.
         *
         * A folder dropped one row off its mark used to be moved first and
         * offered back afterwards, and an offer in the corner of the screen is
         * easy to miss and easier to let expire. Nothing has happened on disk
         * when this question is asked.
         */
        const zuVerschieben = normalizedSources.filter((source) =>
          source !== targetDirectory
          && !isPathWithin(targetDirectory, source)
          && dirname(source).toLocaleLowerCase() !== targetDirectory.toLocaleLowerCase());
        if (!zuVerschieben.length) return;
        const bestaetigt = await askToConfirm({
          title: zuVerschieben.length === 1 ? "Element verschieben?" : `${zuVerschieben.length} Elemente verschieben?`,
          description: `Ziel: ${targetDirectory}`,
          details: zuVerschieben.map((source) => basename(source)),
          confirmLabel: "Verschieben",
        });
        if (!bestaetigt) return;

        for (const internalSource of normalizedSources) {
          if (internalSource === targetDirectory || isPathWithin(targetDirectory, internalSource)) {
            throw new Error("Ein Ordner kann nicht in sich selbst verschoben werden.");
          }
          if (dirname(internalSource).toLocaleLowerCase() === targetDirectory.toLocaleLowerCase()) continue;
          const target = await window.kiwi.file.transfer(internalSource, targetDirectory, true);
          results.push({ source: internalSource, target, move: true });
        }
      } else {
        const tokens = (await Promise.all(
          [...event.dataTransfer.files].map((file) => window.kiwi!.file.authorizeDrop(file)),
        )).filter((token): token is string => Boolean(token));
        if (!tokens.length) throw new Error("Beim Ablegen wurden keine lesbaren Dateien gefunden.");
        results = await window.kiwi.file.importDropped(tokens, targetDirectory);
      }
      if (!results.length) return;

      const remap = (candidate: string) => {
        const moved = results.find((result) => result.move && isPathWithin(candidate, result.source));
        return moved ? `${moved.target}${candidate.slice(moved.source.length)}` : candidate;
      };
      const nextFiles = openFiles.map((file) => ({ ...file, path: remap(file.path), name: basename(remap(file.path)) }));
      if (results.some((result) => result.move)) {
        const refreshedFiles = await Promise.all(nextFiles.map(async (file) => {
          const content = await window.kiwi!.file.read(file.path).catch(() => file.content);
          return { ...file, content, savedContent: content };
        }));
        for (const file of openFiles) {
          const nextPath = remap(file.path);
          if (nextPath === file.path || file.language !== "java") continue;
          await window.kiwi.language.close({ root: workspaceRoot, file: file.path }).catch(() => undefined);
          const nextFile = refreshedFiles.find((candidate) => candidate.path === nextPath);
          if (nextFile) {
            await window.kiwi.language.open({
              root: workspaceRoot,
              file: nextPath,
              text: nextFile.content,
              languageId: "java",
            }).catch(() => undefined);
          }
        }
        setOpenFiles(refreshedFiles);
        if (activePath) setActivePath(remap(activePath));
        if (splitPath) setSplitPath(remap(splitPath));
      }
      const latest = results.at(-1)!;
      setSelectedPaths(new Set(results.map((result) => result.target)));
      setSelectedNode(null);
      const nextExpanded = remapExpandedExplorerPaths(expansionBeforeDrop, results, targetDirectory);
      expandedRef.current = nextExpanded;
      setExpanded(nextExpanded);
      // remapExpandedExplorerPaths already expanded the target directory, so a
      // single tree refresh reloads its children too. Refreshing and then
      // loading the directory separately made the entry vanish and reappear.
      markSelfInflicted(results.flatMap((result) => [result.source, result.target]));
      await refreshTree(workspaceRoot);
      const movedResults = results.filter((result) => result.move);
      const copied = results.length - movedResults.length;
      const summary = [
        movedResults.length ? `${movedResults.length} Element${movedResults.length === 1 ? "" : "e"} verschoben` : "",
        copied ? `${copied} Element${copied === 1 ? "" : "e"} importiert` : "",
      ].filter(Boolean).join(", ");
      // Said, not asked. The question came before anything moved.
      if (summary) toast(summary, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Drag-and-drop konnte nicht abgeschlossen werden.", "error");
    } finally {
      explorerDragSourceRef.current = "";
    }
  }, [activePath, askToConfirm, markSelfInflicted, moduleInfos, openFiles, refreshTree, saveAll, splitPath, toast, workspaceRoot]);

  const copyExplorerPath = useCallback(async (target: FileNode, relative = false) => {
    const value = relative ? relativePath(workspaceRoot, target.path) : target.path;
    await navigator.clipboard.writeText(value);
    toast(relative ? "Relativen Pfad kopiert" : "Pfad kopiert", "success");
  }, [toast, workspaceRoot]);

  const resetGlobalSettings = useCallback(async () => {
    if (!window.kiwi) return defaultIdeSettings;
    const next = await window.kiwi.settings.reset();
    setIdeSettings(next);
    setFontSize(next.fontSize);
    setMinimap(next.minimap);
    setWordWrap(next.wordWrap);
    if (workspaceRoot) await refreshTree(workspaceRoot);
    toast("Globale Einstellungen wurden zurückgesetzt.", "success");
    return next;
  }, [refreshTree, toast, workspaceRoot]);

  const restartLanguageService = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) return;
    if (isPolyglotLanguage(activeFile?.language || projectInfo.language || "")) {
      await window.kiwi.polyglot.stop(workspaceRoot);
      polyglotProviderRef.current?.refreshModels();
      return;
    }
    setLanguageStatus("starting");
    await window.kiwi.language.stop().catch(() => undefined);
    const result = await window.kiwi.language.start(workspaceRoot);
    applySemanticLegend(result.capabilities);
    setLanguageStatus(result.available ? "ready" : result.status === "jdk-required" || result.status === "missing" ? "missing" : "error");
    if (!result.available) toast(result.reason || "Java-Sprachdienst ist nicht verfügbar.", "info");
    for (const file of openFiles.filter((item) => item.language === "java")) {
      await window.kiwi.language.open({ root: workspaceRoot, file: file.path, text: file.content, languageId: "java" });
    }
  }, [activeFile?.language, projectInfo.language, openFiles, toast, workspaceRoot]);

  const updateProjectSettings = useCallback(async (patch: Partial<ProjectSettings>) => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      await window.kiwi.project.updateSettings(workspaceRoot, patch);
      const info = await window.kiwi.java.detect(workspaceRoot);
      setProjectInfo(info);
      if (["jdkPath", "languageLevel", "encoding", "annotationProcessing", "generatedSources", "lombokSupport", "unusedAnalysis"]
        .some((key) => key in patch)) {
        await restartLanguageService();
      }
      toast("Projekteinstellungen gespeichert", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projekteinstellung konnte nicht gespeichert werden.", "error");
    }
  }, [restartLanguageService, toast, workspaceRoot]);

  useEffect(() => {
    if (!window.kiwi) return;
    const removeGlobalSettings = window.kiwi.settings.onChanged(({ settings: next, patch }) => {
      setIdeSettings(next);
      setFontSize(next.fontSize);
      setMinimap(next.minimap);
      setWordWrap(next.wordWrap);
      if (workspaceRoot && [
        "explorerHideBuild",
        "explorerHideDotDirectories",
        "explorerHideGenerated",
        "explorerExcludedPatterns",
        "explorerView",
        "compactPackages",
      ].some((key) => key in patch)) {
        void refreshTree(workspaceRoot);
      }
    });
    const removeProjectSettings = window.kiwi.project.onSettingsChanged(({ root, patch }) => {
      if (!workspaceRoot || root.toLocaleLowerCase() !== workspaceRoot.toLocaleLowerCase()) return;
      void window.kiwi!.java.detect(workspaceRoot).then(setProjectInfo);
      if (["jdkPath", "languageLevel", "encoding", "annotationProcessing", "generatedSources", "lombokSupport", "unusedAnalysis"]
        .some((key) => key in patch)) {
        void restartLanguageService();
      }
    });
    return () => {
      removeGlobalSettings();
      removeProjectSettings();
    };
  }, [refreshTree, restartLanguageService, workspaceRoot]);

  const repairProject = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) return;
    const operationId = `repair:${workspaceRoot}`;
    upsertOperation({
      id: operationId,
      projectRoot: workspaceRoot,
      kind: "repair",
      label: "Projekt reparieren",
      detail: "Index und Kiwi-Caches werden sicher neu aufgebaut …",
      cancellable: false,
    });
    try {
      const result = await window.kiwi.project.repair(workspaceRoot);
      const [, tools] = await Promise.all([
        refreshTree(workspaceRoot),
        window.kiwi.project.tasks(workspaceRoot).catch(() => ({ tasks: [], modules: [] })),
      ]);
      setProjectTasks(tools.tasks);
      setLanguageStatus(result.index.available ? "ready" : "error");
      setLanguageDetail(result.index.reason || (result.index.available ? "Index wurde neu aufgebaut." : "Index konnte nicht gestartet werden."));
      // A damaged artifact in the shared repository is the one thing a user
      // cannot see, so the count is worth saying out loud: it explains why a
      // build that failed for days suddenly works.
      const removed = result.shared?.removed || 0;
      const damaged = removed === 1
        ? t("ein beschädigtes Artefakt entfernt")
        : `${removed} ${t("beschädigte Artefakte entfernt")}`;
      toast(
        result.build.ok
          ? `${t("Projekt repariert")} · ${result.build.tasks || 0} ${t("Build-Aufgaben erkannt")}${removed ? ` · ${damaged}` : ""}`
          : `${t("Index repariert; Build-Konfiguration meldet")}: ${result.build.error || t("unbekannter Fehler")}`,
        result.build.ok ? "success" : "info",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projekt konnte nicht repariert werden.", "error");
    } finally {
      completeOperation(operationId);
    }
  }, [completeOperation, refreshTree, toast, upsertOperation, workspaceRoot]);

  const createProject = useCallback(async (spec: ProjectSpec) => {
    if (!window.kiwi) return;
    try {
      const result = await window.kiwi.project.create(spec);
      setProjectWizardOpen(false);
      if (welcomeWindow) {
        toast(`${spec.name} wurde erstellt`, "success");
        await window.kiwi.app.openEditor(result.root);
        return;
      }
      await loadWorkspace(result.root);
      await openFile(result.mainFile);
      toast(`${spec.name} wurde erstellt`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Projekt konnte nicht erstellt werden.", "error");
    }
  }, [loadWorkspace, openFile, toast, welcomeWindow]);

  const saveRunConfiguration = useCallback(async (configuration: RunConfiguration) => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      const saved = await window.kiwi.runConfigurations.save(workspaceRoot, configuration);
      const configurations = await window.kiwi.runConfigurations.list(workspaceRoot);
      setRunConfigurations(configurations);
      setActiveRunConfigId(saved.id || "");
      setRunConfigOpen(false);
      toast("Run-Konfiguration gespeichert", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Run-Konfiguration konnte nicht gespeichert werden.", "error");
    }
  }, [toast, workspaceRoot]);

  const deleteRunConfiguration = useCallback(async (id: string) => {
    if (!workspaceRoot || !window.kiwi) return;
    await window.kiwi.runConfigurations.delete(workspaceRoot, id);
    const configurations = await window.kiwi.runConfigurations.list(workspaceRoot);
    setRunConfigurations(configurations);
    setActiveRunConfigId(configurations[0]?.id || "");
    setRunConfigOpen(false);
  }, [workspaceRoot]);

  const duplicateRunConfiguration = useCallback(async () => {
    if (!activeRunConfiguration || !workspaceRoot || !window.kiwi) return;
    const duplicate = await window.kiwi.runConfigurations.save(workspaceRoot, {
      ...activeRunConfiguration,
      id: undefined,
      name: `${activeRunConfiguration.name} Kopie`,
    });
    const configurations = await window.kiwi.runConfigurations.list(workspaceRoot);
    setRunConfigurations(configurations);
    setActiveRunConfigId(duplicate.id || "");
    toast("Run-Konfiguration dupliziert", "success");
  }, [activeRunConfiguration, toast, workspaceRoot]);

  /**
   * Attaches the debugger to a JVM that is already running.
   *
   * Launching the process was the only way in, which excludes every server
   * started by something else — a container, a service manager, another
   * machine. The target has to carry the JDWP agent flag; nothing here can add
   * it afterwards, so the failure message says so.
   */
  const attachDebugger = useCallback(() => {
    if (!workspaceRoot || !window.kiwi) return;
    setInputRequest({
      title: "An laufende JVM andocken",
      description: "Die Ziel-JVM muss mit -agentlib:jdwp=transport=dt_socket,server=y,address=… gestartet worden sein.",
      label: "Host und Port",
      initialValue: "127.0.0.1:5005",
      confirmLabel: "Andocken",
      validate: (value) => /^[\w.-]+:\d{1,5}$/.test(value.trim()) ? null : "Als host:port angeben, zum Beispiel 127.0.0.1:5005.",
      action: async (value) => {
        const [host, port] = value.trim().split(":");
        setInputRequest(null);
        setPanelVisible(true);
        setPanel("debug");
        try {
          const result = await window.kiwi!.debug.attach({
            root: workspaceRoot,
            host,
            port: Number(port),
            breakpoints,
          });
          toast(`Angedockt an ${result.mainClass}`, "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Andocken fehlgeschlagen.", "error");
        }
      },
    });
  }, [breakpoints, toast, workspaceRoot]);

  const startDebug = useCallback(async (requestedFile?: string) => {
    if (!workspaceRoot || !window.kiwi) return;
    if (!requestedFile && (isPolyglotLanguage(activeFile?.language || "") || (projectInfo.language && projectInfo.language !== "java"))) {
      toast(t("Der integrierte Debugger unterstützt derzeit Java. Für diese Sprache sind Ausführen und Bauen verfügbar."), "info");
      return;
    }
    // React paints the disabled state on the next render. Guarding the ref as
    // well prevents a fast double click (or CodeLens + shortcut) from starting
    // two sessions before that paint happens.
    if (debugStatusRef.current !== "stopped") return;
    debugStatusRef.current = "starting";
    setDebugStatus("starting");
    const debugFile = typeof requestedFile === "string" ? requestedFile : runnableFile?.path;
    const codeLensLaunch = typeof requestedFile === "string";
    if (settings.openConsoleOnRun) {
      setPanelVisible(true);
      setPanel("debug");
    }
    setDebugOutput("");
    upsertOperation({
      id: `debug:${workspaceRoot}`,
      projectRoot: workspaceRoot,
      kind: "debug",
      label: "Debug-Sitzung",
      detail: codeLensLaunch
        ? basename(debugFile || workspaceRoot)
        : activeRunConfiguration?.name || runnableFile?.name || basename(workspaceRoot),
      cancellable: true,
    });
    try {
      await saveAll();
      if (!codeLensLaunch && activeRunConfiguration && activeRunConfiguration.type !== "java") {
        throw new Error(
          `Die ausgewählte Konfiguration „${activeRunConfiguration.name}“ ist keine Java-Application. `
          + "Wähle eine Java-Run-Konfiguration oder den Debug-CodeLens neben main().",
        );
      }
      const inferredModule = debugFile ? findDebugModule(debugFile, moduleInfos) : undefined;
      // A CodeLens means "this exact main method". It must not accidentally
      // inherit another selected configuration's mainClass. For the toolbar,
      // the selected Java configuration remains authoritative.
      const debugConfiguration: RunConfiguration = codeLensLaunch
        ? {
            name: `Debug ${basename(debugFile || workspaceRoot)}`,
            type: "java",
            moduleId: inferredModule?.id,
          }
        : {
            ...(activeRunConfiguration || { name: "Temporär", type: "java" as const }),
            ...(!activeRunConfiguration && inferredModule ? { moduleId: inferredModule.id } : {}),
          };
      await window.kiwi.debug.start({
        root: workspaceRoot,
        file: debugFile,
        configuration: {
          ...debugConfiguration,
          env: {
            ...parseEnvironmentTemplate(settings.runEnvironmentTemplate),
            ...(debugConfiguration.env || {}),
          },
        },
        breakpoints: [
          ...breakpoints.filter((breakpoint) => breakpoint.type !== "exception"),
          ...(settings.breakOnExceptions === "none" ? [] : [{
            type: "exception" as const,
            className: "java.lang.Throwable",
            line: 0,
            caught: settings.breakOnExceptions === "all",
            uncaught: true,
            enabled: true,
          }]),
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Debugger konnte nicht gestartet werden.";
      // A backend failure can arrive after it already emitted "starting". Stop
      // that partial session and restore the renderer explicitly; otherwise all
      // Debug buttons stay disabled until the whole IDE is restarted.
      await window.kiwi.debug.stop().catch(() => undefined);
      debugStatusRef.current = "stopped";
      setDebugStatus("stopped");
      setPanelVisible(true);
      setPanel("debug");
      setDebugOutput((current) => {
        const separator = current && !current.endsWith("\n") ? "\n" : "";
        return `${current}${separator}Debug-Start fehlgeschlagen: ${message}\n`.slice(-250_000);
      });
      completeOperation(`debug:${workspaceRoot}`);
      toast(message, "error");
    }
  }, [activeFile, runnableFile, activeRunConfiguration, breakpoints, completeOperation, moduleInfos, saveAll, settings.breakOnExceptions, settings.openConsoleOnRun, settings.runEnvironmentTemplate, toast, upsertOperation, workspaceRoot]);

  /**
   * A guest starting something on this machine.
   *
   * The build, debug and terminal permissions existed for a while and granted
   * nothing: output flowed to guests, and starting anything was the host's
   * alone. A permission that grants nothing reads like a promise.
   *
   * The host has already decided — the session refused this if the permission
   * was never given — so what is left here is to run it the ordinary way, so
   * guests see exactly the output the host sees, and to say who asked. A build
   * starting by itself on your own machine is alarming; knowing whose it is
   * makes it not.
   */
  useEffect(() => {
    if (!window.kiwi) return undefined;
    return window.kiwi.collab.onRunRequest((payload) => {
      if (!workspaceRootRef.current || !samePath(payload.projectRoot, workspaceRootRef.current)) return;
      toast(describeSharedRequest(payload.name, payload.action), "info");
      if (payload.action === "debug") void startDebugRef.current();
      else void runJavaRef.current(payload.action as JavaAction);
    });
  }, [toast]);
  startDebugRef.current = startDebug;

  const toggleBreakpointAtLine = useCallback((fileName: string, content: string, line: number, filePath = "") => {
    const className = qualifiedJavaClassName({
      path: fileName,
      name: fileName,
      content,
      savedContent: content,
      language: "java",
    });
    setBreakpoints((items) => toggleJavaLineBreakpoint(items, className, line, filePath));
    toast(`Breakpoint ${line}`, "info");
  }, [toast]);
  toggleBreakpointAtLineRef.current = toggleBreakpointAtLine;

  const toggleBreakpoint = useCallback(() => {
    if (!activeFile || activeFile.language !== "java") return;
    // The file, not only its name. Without it this created a breakpoint the
    // gutter identifies differently from the one the gutter creates, and the
    // two then collide through the class-name fallback: a click in one file
    // removed a breakpoint set by the keyboard in another file of the same
    // class name, saying "Breakpoint" while the gutter stayed empty.
    toggleBreakpointAtLine(activeFile.name, activeFile.content, cursor.line, activeFile.path);
  }, [activeFile, cursor.line, toggleBreakpointAtLine]);

  /**
   * A breakpoint on the member the caret is on.
   *
   * The two questions a line breakpoint cannot answer are the ones that cost
   * the most time: who wrote that value, and who calls this method at all. The
   * caret says which member is meant — and nothing happens when it is not on
   * one, because a breakpoint on the wrong member is worse than none.
   */
  const toggleMemberBreakpoint = useCallback(() => {
    if (!activeFile || activeFile.language !== "java") return;
    const member = memberAtCaret(activeFile.content, cursor.line);
    if (!member) {
      toast(t("Setze den Cursor auf ein Feld oder eine Methode."), "info");
      return;
    }
    const className = qualifiedJavaClassName({
      path: activeFile.path || activeFile.name,
      name: activeFile.name,
      content: activeFile.content,
      savedContent: activeFile.content,
      language: "java",
    });
    const created = memberBreakpoint(className, member, activeFile.path || "");
    if (!created) return;
    setBreakpoints((items) => {
      const existing = items.findIndex((item) => sameBreakpoint(item, created));
      return existing >= 0 ? items.filter((_item, index) => index !== existing) : [...items, created];
    });
    const removed = breakpoints.some((item) => sameBreakpoint(item, created));
    toast(`${removed ? t("Entfernt") : t("Gesetzt")}: ${describeBreakpoint(created)}`, "info");
  }, [activeFile, breakpoints, cursor.line, t, toast]);

  const runToCursor = useCallback(() => {
    if (!activeFile || activeFile.language !== "java" || debugStatus !== "paused" || !window.kiwi) return;
    void window.kiwi.debug.command("runToCursor", JSON.stringify({
      className: qualifiedJavaClassName(activeFile),
      line: cursor.line,
    })).catch((error) => toast(error instanceof Error ? error.message : "Run to Cursor konnte nicht gestartet werden.", "error"));
  }, [activeFile, cursor.line, debugStatus, toast]);

  const refreshDependencyEditor = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi || projectInfo.type === "Java") {
      setDependencyEditorModel(null);
      setDependencyEditorError("");
      return;
    }
    setDependencyEditorLoading(true);
    setDependencyEditorError("");
    try {
      setDependencyEditorModel(await window.kiwi.project.listDependencies(workspaceRoot));
    } catch (error) {
      setDependencyEditorError(error instanceof Error ? error.message : "Builddateien konnten nicht gelesen werden.");
    } finally {
      setDependencyEditorLoading(false);
    }
  }, [projectInfo.type, workspaceRoot]);

  /**
   * Reads the build's tasks, dependencies and audit again.
   *
   * `force` only for the reload button, which is the one caller whose
   * whole purpose is to distrust what is stored. After a dependency was
   * written the build file's timestamp has moved, so the stored answer is
   * already void — forcing there just spends a Gradle configuration phase
   * in the middle of an edit, which is exactly where it is most in the
   * way.
   */
  const refreshProjectTools = useCallback(async ({ force = false } = {}) => {
    if (!workspaceRoot || !window.kiwi) return;
    const [taskResult, dependencyOutput, treeResult, audit] = await Promise.all([
      window.kiwi.project.tasks(workspaceRoot, force),
      window.kiwi.project.dependencies(workspaceRoot).catch(() => "Abhängigkeiten konnten nicht geladen werden."),
      window.kiwi.project.dependencyTree(workspaceRoot).catch(() => null),
      window.kiwi.project.auditDependencies(workspaceRoot).catch(() => null),
    ]);
    setProjectTasks(taskResult.tasks);
    // Everything the tree had fetched per project belongs to the build
    // that was just re-read, so it is fetched again when reopened.
    setProjectDependencies((current) => (current.size ? new Map() : current));
    setDependencies(dependencyOutput);
    setDependencyTree(treeResult);
    setDependencyAudit(audit);
    void refreshDependencyEditor();
  }, [refreshDependencyEditor, workspaceRoot]);

  const performDependencyMutation = useCallback(async (
    action: () => Promise<DependencyMutationResult>,
    successMessage: string,
  ) => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      const result = await action();
      if (!result.changed && !result.added && !result.removed && !result.updated) {
        toast(result.reason || "Die Builddatei war bereits aktuell.", "info");
        return;
      }
      toast(successMessage, "success");
      // A build file that is open has to show what was just written into it.
      await adoptDiskContent((result.files?.length ? result.files : [result.file]).filter(Boolean));
      await refreshDependencyEditor();
      await refreshTree(workspaceRoot);
      void refreshProjectTools();
      void refreshConfigDiagnostics(workspaceRoot);
      for (const file of result.files?.length ? result.files : [result.file]) {
        if (file) void window.kiwi.language.refresh(workspaceRoot, file).catch(() => false);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Dependency-Änderung fehlgeschlagen.", "error");
    }
  }, [adoptDiskContent, refreshDependencyEditor, refreshProjectTools, refreshTree, toast, workspaceRoot]);

  const scheduleProjectSync = useCallback((root: string, changedPath: string) => {
    if (root === workspaceRootRef.current && projectInfo.autoSyncBuild === false) return;
    const existing = projectSyncTimers.current.get(root);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(async () => {
      if (projectSyncInFlight.current.has(root)) {
        projectSyncQueued.current.set(root, changedPath);
        if (root === workspaceRootRef.current) {
          setLanguageDetail(`${basename(changedPath)} wurde während der Synchronisierung erneut geändert und ist vorgemerkt.`);
        }
        return;
      }
      projectSyncInFlight.current.add(root);
      const operationId = `sync:${root}`;
      const startedAt = performance.now();
      const baseline = isProjectDefinition(changedPath)
        ? await window.kiwi?.file.read(changedPath).catch(() => "")
        : "";
      const fingerprintKey = `${root.toLocaleLowerCase()}\u0000${changedPath.toLocaleLowerCase()}`;
      const fingerprint = baseline ? contentFingerprint(baseline) : "";
      if (fingerprint && projectSyncFingerprints.current.get(fingerprintKey) === fingerprint) {
        projectSyncTimers.current.delete(root);
        return;
      }
      const log = (message: string) => {
        const line = `[Projekt-Sync ${new Date().toLocaleTimeString()}] ${message}\n`;
        outputRef.current = `${outputRef.current}${line}`.slice(-250_000);
        setOutput(outputRef.current);
      };
      log(`Start: ${changedPath}`);
      if (root === workspaceRootRef.current) {
        setLanguageStatus("indexing");
        setLanguageDetail(`Projektmodell wird wegen ${basename(changedPath)} synchronisiert …`);
      }
      // A single spinner says nothing about a Gradle sync that takes a minute.
      // The steps are counted and named as they finish, so what is running and
      // how much is left is visible in the operation centre and the status bar.
      const steps = [
        "Sprachserver benachrichtigen",
        "Projektmodell lesen",
        "Aufgaben lesen",
        "Module lesen",
        "Abhängigkeiten auflösen",
        "Abhängigkeitsbaum lesen",
        "Abhängigkeiten prüfen",
        "Build-Datei lesen",
      ];
      const track = trackSteps(steps.length, (done, name) => {
        upsertOperation({
          id: operationId,
          projectRoot: root,
          kind: "sync",
          label: "Maven-/Gradle-Projekt synchronisieren",
          detail: `${name} · ${basename(changedPath)}`,
          cancellable: true,
          progress: { done, total: steps.length },
        });
        if (root === workspaceRootRef.current) {
          setLanguageDetail(`Synchronisierung ${done}/${steps.length}: ${name}`);
        }
      });

      upsertOperation({
        id: operationId,
        projectRoot: root,
        kind: "sync",
        label: "Maven-/Gradle-Projekt synchronisieren",
        detail: `${steps[0]} · ${basename(changedPath)}`,
        cancellable: true,
        progress: { done: 0, total: steps.length },
      });
      try {
        await track(steps[0], Promise.resolve(window.kiwi?.language.refresh(root, changedPath)));
        const [info, tasks, modules, dependencyOutput, treeResult, audit, editorModel] = await Promise.all([
          track(steps[1], window.kiwi!.java.detect(root)),
          track(steps[2], window.kiwi!.project.tasks(root)),
          track(steps[3], window.kiwi!.modules.list(root)),
          track(steps[4], window.kiwi!.project.dependencies(root).catch(() => "")),
          track(steps[5], window.kiwi!.project.dependencyTree(root).catch(() => null)),
          track(steps[6], window.kiwi!.project.auditDependencies(root).catch(() => null)),
          track(steps[7], window.kiwi!.project.listDependencies(root).catch(() => null)),
        ]);
        if (root === workspaceRootRef.current) {
          setProjectInfo(info);
          setProjectTasks(tasks.tasks);
          // A generic task list used to look like the project's own. Saying
          // why it is generic is the difference between "this project has no
          // tasks" and "Gradle could not be asked".
          if (tasks.reason) log(tasks.reason);
          setModuleInfos(modules);
          if (dependencyOutput) setDependencies(dependencyOutput);
          setDependencyTree(treeResult);
          setDependencyAudit(audit);
          setDependencyEditorModel(editorModel);
          setDependencyEditorError("");
          setLanguageStatus("ready");
          setLanguageDetail(`${info.type}-Projekt aktuell: ${modules.length} Modul(e), ${tasks.tasks.length} Aufgabe(n).`);
          // A build file the import is holding open cannot always be read
          // back on Windows. Treating that as "the file changed" reported a
          // conflict that never happened and paid for a second full sync
          // every time, so an unreadable file counts as unchanged.
          const current = baseline
            ? await window.kiwi!.file.read(changedPath).catch(() => baseline)
            : baseline;
          if (baseline && current !== baseline) {
            projectSyncQueued.current.set(root, changedPath);
            setLanguageDetail(`${basename(changedPath)} änderte sich während der Synchronisierung; ein zweiter Lauf folgt.`);
            log(`${basename(changedPath)} wurde während des Imports geändert; ein zweiter Lauf folgt.`);
          }
          log(`Erfolgreich nach ${Math.round(performance.now() - startedAt)} ms: ${info.type}, ${modules.length} Modul(e).`);
          if (fingerprint) projectSyncFingerprints.current.set(fingerprintKey, fingerprint);
          toast(`${info.type}-Projekt synchronisiert`, "success");
        }
      } catch (error) {
        if (root === workspaceRootRef.current) {
          const explained = explainBuildToolFailure(error);
          setLanguageStatus("error");
          setLanguageDetail(explained);
          log(`Fehler nach ${Math.round(performance.now() - startedAt)} ms: ${error instanceof Error ? error.stack || error.message : String(error)}`);
          setPanel("build");
          setPanelVisible(true);
          toast(explained, "error");
        }
      } finally {
        projectSyncInFlight.current.delete(root);
        completeOperation(operationId);
        projectSyncTimers.current.delete(root);
        const queued = projectSyncQueued.current.get(root);
        if (queued) {
          projectSyncQueued.current.delete(root);
          window.setTimeout(() => scheduleProjectSyncRef.current(root, queued), 50);
        }
      }
    }, 180);
    projectSyncTimers.current.set(root, timer);
  }, [completeOperation, projectInfo.autoSyncBuild, toast, upsertOperation]);
  scheduleProjectSyncRef.current = scheduleProjectSync;

  /** Runs a build task, optionally scoped to one module instead of the project. */
  const runProjectTask = useCallback(async (task: ProjectTask, moduleId = "") => {
    if (!workspaceRoot || !window.kiwi) return;
    await saveAll();
    const type = projectInfo.type === "Maven" ? "maven" : projectInfo.type === "Gradle" ? "gradle" : "java";
    const action: JavaAction = task.name === "test" ? "test" : task.name === "run" ? "run" : "build";
    activeJavaActionRef.current = action;
    setLastJavaAction(action);
    setLastProcessExitCode(null);
    setBuildRawOpen(false);
    setRunning(true);
    setPanelVisible(true);
    setPanel("build");
    replaceBuildOutput("");
    try {
      const result = await window.kiwi.java.execute({
        root: workspaceRoot,
        action,
        // BuildService prefixes Gradle targets and adds -pl for Maven when a
        // module is named, so one task definition serves both scopes.
        configuration: { name: task.name, type, target: task.name, ...(moduleId ? { moduleId } : {}) },
      });
      if (result.operationId) {
        upsertOperation({
          id: result.operationId,
          projectRoot: workspaceRoot,
          kind: action,
          label: moduleId ? `${task.name} · ${moduleInfos.find((item) => item.id === moduleId)?.name || moduleId}` : task.name,
          detail: result.command,
          cancellable: true,
        });
      }
    } catch (error) {
      setRunning(false);
      setLastProcessExitCode(1);
      toast(explainBuildToolFailure(error), "error");
    }
  }, [moduleInfos, projectInfo.type, replaceBuildOutput, saveAll, toast, upsertOperation, workspaceRoot]);

  /**
   * The grouped task tree, rendered for the project and once per module.
   * `moduleId` is empty for the project; group expansion is tracked per scope
   * so opening Build-Lifecycle on one module does not open it everywhere.
   */
  /**
   * The dependencies of one project of the build, fetched once.
   *
   * Gradle configures the build to answer this, which takes seconds, so it
   * happens when somebody opens the branch and not before — and a project
   * already fetched is not fetched again when the branch is reopened.
   */
  const loadProjectDependencies = useCallback((taskPath: string) => {
    if (!workspaceRootRef.current || !window.kiwi) return;
    if (projectDependencies.get(taskPath)?.loading) return;
    setProjectDependencies((current) => {
      const next = new Map(current);
      next.set(taskPath, { loading: true, error: "", configurations: current.get(taskPath)?.configurations || [] });
      return next;
    });
    void window.kiwi.project.dependencyTree(workspaceRootRef.current, taskPath)
      .then((tree) => setProjectDependencies((current) => {
        const next = new Map(current);
        next.set(taskPath, { loading: false, error: "", configurations: usefulConfigurations(tree.configurations || []) });
        return next;
      }))
      .catch((error: unknown) => setProjectDependencies((current) => {
        const next = new Map(current);
        next.set(taskPath, {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          configurations: [],
        });
        return next;
      }));
  }, [projectDependencies]);

  const toggleBuildBranch = useCallback((key: string) => {
    setOpenBuildBranches((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * The build tool window, wherever it is docked.
   *
   * The same tree serves the activity bar on the left and the right rail:
   * two copies would have drifted apart, and the one somebody was not
   * looking at would be the one that kept the bug.
   */
  const renderBuildTool = () => (
          <div className="build-tool">
            <div className="build-tool-toolbar" aria-label={t("Build-Aktionen")}>
              <IconButton label="Neu laden" onClick={() => void refreshProjectTools({ force: true })}><RefreshCw size={14} /></IconButton>
              <IconButton label="Projekt synchronisieren" disabled={!projectInfo.buildFile} onClick={() => {
                if (workspaceRoot && projectInfo.buildFile) void scheduleProjectSync(workspaceRoot, `${workspaceRoot}\\${projectInfo.buildFile}`);
              }}><RotateCcw size={14} /></IconButton>
              <span className="build-toolbar-separator" />
              <IconButton label="Alle aufklappen" onClick={() => {
                setOpenBuildProjects(new Set(buildProjects.map((node) => node.taskPath)));
                setOpenBuildBranches(new Set(buildProjects.map((node) => branchKey(node.taskPath, "tasks"))));
                // Group keys carry the project they belong to, so the same
                // group in two projects opens in both rather than neither.
                setOpenTaskGroups(new Set(buildProjects.flatMap((node) =>
                  (groupedTasksByProject.get(node.taskPath) || []).map((group) => taskGroupKey(node.id, group.name)))));
              }}><Plus size={14} /></IconButton>
              <IconButton label="Alle einklappen" onClick={() => {
                setOpenTaskGroups(new Set());
                setOpenBuildBranches(new Set());
                setOpenBuildProjects(new Set());
              }}><Minus size={14} /></IconButton>
              <span className="build-toolbar-spacer" />
              <IconButton label="Tasks suchen" active={taskSearchOpen} onClick={() => setTaskSearchOpen((value) => !value)}><Search size={14} /></IconButton>
              <IconButton label="Build-Einstellungen" onClick={openSettingsDocument}><Settings size={14} /></IconButton>
            </div>

            {taskSearchOpen && (
              <div className="task-search">
                <Search size={13} />
                <input
                  autoFocus
                  value={taskQuery}
                  onChange={(event) => setTaskQuery(event.target.value)}
                  placeholder={t("Task oder Goal suchen")}
                  onKeyDown={(event) => {
                    const task = projectTasks.find((item) => item.name.toLowerCase().includes(taskQuery.toLowerCase()));
                    if (event.key === "Enter" && task) void runProjectTask(task);
                    if (event.key === "Escape") {
                      setTaskQuery("");
                      setTaskSearchOpen(false);
                    }
                  }}
                />
              </div>
            )}

            {buildProfiles.length > 0 && (
              <div className="build-profiles">
                <span>{projectInfo.type === "Gradle" ? "Varianten" : "Profile"}</span>
                {buildProfiles.map((profile) => {
                  const selected = (projectInfo.projectSettings?.buildProfiles || []).includes(profile.id);
                  return (
                    <label key={profile.id} title={profile.description || (profile.active ? t("Standardmäßig aktiv") : "")}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          const current = projectInfo.projectSettings?.buildProfiles || [];
                          void updateProjectSettings({
                            buildProfiles: event.target.checked
                              ? [...current, profile.id]
                              : current.filter((entry) => entry !== profile.id),
                          });
                        }}
                      />
                      <span>{profile.id}</span>
                      {profile.active && <em>{t("Standard")}</em>}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="task-list build-task-tree">
              {/* Every project of the build as a peer, the way the build
                  itself is arranged: the root owns no subproject's tasks. */}
              {buildProjectNodes(moduleInfos, projectTasks, projectName).map((node) => {
                const projectKey = node.taskPath;
                const projectOpen = openBuildProjects.has(projectKey);
                const tasksKey = branchKey(projectKey, "tasks");
                const dependenciesKey = branchKey(projectKey, "dependencies");
                const tasksOpen = openBuildBranches.has(tasksKey);
                const dependenciesOpen = openBuildBranches.has(dependenciesKey);
                const dependencies = projectDependencies.get(projectKey);
                return (
                  <div className="build-tree-project" key={"projekt:" + projectKey}>
                    <button
                      className={`build-tree-root ${!node.isRoot && selectedModuleId === node.id ? "selected" : ""}`}
                      type="button"
                      aria-expanded={projectOpen}
                      onClick={() => {
                        if (node.id) setSelectedModuleId(node.id);
                        setOpenBuildProjects((current) => {
                          const next = new Set(current);
                          if (next.has(projectKey)) next.delete(projectKey);
                          else next.add(projectKey);
                          return next;
                        });
                      }}
                    >
                      {projectOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <BuildToolIcon type={projectInfo.type} size={15} />
                      <strong>{node.name}</strong>
                    </button>
                    {projectOpen && (
                      <div className="build-tree-children">
                        <button className="build-tree-branch" type="button" aria-expanded={tasksOpen} onClick={() => toggleBuildBranch(tasksKey)}>
                          {tasksOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <Folder size={14} />
                          <span>{t("Tasks")}</span>
                        </button>
                        {tasksOpen && renderTaskGroups(node.id, node.taskPath)}
                        <button
                          className="build-tree-branch"
                          type="button"
                          aria-expanded={dependenciesOpen}
                          onClick={() => {
                            toggleBuildBranch(dependenciesKey);
                            if (!dependenciesOpen && !dependencies) loadProjectDependencies(projectKey);
                          }}
                        >
                          {dependenciesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <Network size={14} /><span>{t("Dependencies")}</span>
                        </button>
                        {dependenciesOpen && (
                          <div className="build-tree-configurations">
                            {dependencies?.loading && <div className="empty-sidebar">{t("Abhängigkeiten werden gelesen …")}</div>}
                            {dependencies?.error && <div className="empty-sidebar">{dependencies.error}</div>}
                            {dependencies && !dependencies.loading && !dependencies.error && !dependencies.configurations.length && (
                              <div className="empty-sidebar">{t("Dieses Projekt hat keine aufgelösten Abhängigkeiten.")}</div>
                            )}
                            {(dependencies?.configurations || []).map((configuration) => {
                              const configurationKey = branchKey(projectKey, "configuration", configuration.name);
                              const configurationOpen = openBuildBranches.has(configurationKey);
                              return (
                                <section className="task-group" key={configurationKey}>
                                  <button
                                    type="button"
                                    className="task-group-header"
                                    aria-expanded={configurationOpen}
                                    onClick={() => toggleBuildBranch(configurationKey)}
                                  >
                                    {configurationOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    <Package size={13} />
                                    <span>{configuration.name}</span>
                                  </button>
                                  {configurationOpen && (
                                    <div className="task-group-items dependency-branch">
                                      <DependencyNodeTree nodes={configuration.nodes} />
                                    </div>
                                  )}
                                </section>
                              );
                            })}
                            <button className="build-tree-branch nested" type="button" onClick={() => setRightTool("dependencies")}>
                              <Pencil size={13} /><span>{t("Abhängigkeiten bearbeiten…")}</span>
                            </button>
                          </div>
                        )}
                        {/* Run configurations belong to the build, not to
                            one of its projects, so only the root lists them. */}
                        {node.isRoot && (
                          <button className="build-tree-branch" type="button" onClick={() => { setEditingRunConfig(activeRunConfiguration); setRunConfigOpen(true); }}>
                            <ChevronRight size={12} /><Play size={14} /><span>{t("Run-Konfigurationen")}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
  );

  const renderTaskGroups = useCallback((moduleId: string, projectPath = "") => (
    <div className="build-task-groups">
      {(groupedTasksByProject.get(projectPath) || []).map((group) => {
        const groupKey = taskGroupKey(moduleId, group.name);
        const groupOpen = Boolean(taskQuery.trim()) || openTaskGroups.has(groupKey);
        return (
          <section className="task-group" key={groupKey}>
            <button
              type="button"
              className="task-group-header"
              aria-expanded={groupOpen}
              onClick={() => setOpenTaskGroups((current) => {
                const next = new Set(current);
                if (next.has(groupKey)) next.delete(groupKey);
                else next.add(groupKey);
                return next;
              })}
            >
              {groupOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={13} />
              <span>{t(group.name)}</span>
            </button>
            {groupOpen && (
              <div className="task-group-items">
                {group.tasks.map((task) => (
                  <button
                    type="button"
                    className="task-item"
                    key={`${groupKey}:${task.name}`}
                    onClick={() => void runProjectTask(task, moduleId)}
                    title={`${task.name}${task.description ? ` — ${task.description}` : ""}`}
                  >
                    <Settings size={12} />
                    {/* The module is already the folder this sits in, so the
                        entry says what the task is rather than repeating it. */}
                    <strong>{taskShortName(task.name)}</strong>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {!(groupedTasksByProject.get(projectPath) || []).length && <div className="empty-sidebar">{t("Keine passenden Tasks gefunden.")}</div>}
    </div>
  ), [groupedTasksByProject, openTaskGroups, runProjectTask, taskQuery]);


  const runTest = useCallback(async (target?: string, automaticRetry = false) => {
    if (!workspaceRoot || !window.kiwi) return;
    activeJavaActionRef.current = "test";
    setLastJavaAction("test");
    setLastProcessExitCode(null);
    setPanelVisible(true);
    setPanel("tests");
    setRunning(true);
    testProgressStream.current = NO_TEST_PROGRESS;
    testProgressRun.current = NO_TEST_RUN;
    const selectedSuite = target ? testSuites.find((suite) => suite.id === target) : undefined;
    setTestProgress({
      running: true,
      current: target || "Alle Tests",
      completed: 0,
      total: target?.includes("#") ? 1 : selectedSuite ? Math.max(1, selectedSuite.methods.length) : testSuites.reduce((sum, suite) => sum + Math.max(1, suite.methods.length), 0),
      passed: 0,
      failed: 0,
      skipped: 0,
    });
    activeTestRun.current = { target, automaticRetry };
    try { await window.kiwi.tests.run(workspaceRoot, target); }
    catch (error) {
      activeTestRun.current = null;
      setRunning(false);
      toast(error instanceof Error ? error.message : "Test konnte nicht gestartet werden.", "error");
    }
  }, [testSuites, toast, workspaceRoot]);

  /**
   * The tests a change can possibly have broken.
   *
   * Running the whole suite after touching one class is the reason people stop
   * running tests before pushing. Picking the wrong subset is far worse, so
   * this errs the other way: anything that mentions a changed class, anything
   * whose own file changed, and everything at all when a pom or a resource
   * moved — those can move any test and this cannot tell which.
   *
   * Offered, never substituted. Whoever asks for all tests gets all tests.
   */
  const runAffectedTests = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) {
      toast("Öffne zuerst ein Projekt.", "info");
      return;
    }
    const status = await window.kiwi.git.status(workspaceRoot).catch(() => null);
    const changed = (status?.files || [])
      .map((file: { path?: string }) => String(file?.path || ""))
      .filter(Boolean)
      .map((file: string) => (file.includes(":") ? file : `${workspaceRoot}/${file}`));
    const result = affectedTests(changed, testSuites as never);
    toast(describeAffected(result, testSuites.length), result.reason ? "info" : "success");
    if (!result.suites.length) return;
    // One target per run is what the build tools take, so a narrowing to
    // several classes runs them as one filter where the tool allows it.
    await runTest(result.suites.length === testSuites.length ? undefined : result.suites.join(","));
  }, [runTest, testSuites, toast, workspaceRoot]);
  runTestTargetRef.current = (target: string) => void runTest(target);

  const runTestAtCursor = useCallback(() => {
    const editor = editorRef.current;
    const pos = editor?.getPosition();
    const line = pos?.lineNumber || cursor.line || 1;
    const targets = testTargetsRef.current;
    const applicable = targets.filter((t) => t.line <= line).sort((a, b) => b.line - a.line);
    const best = applicable[0] || targets.find((t) => t.kind === "class") || targets[0];
    if (best) {
      toast(`${t("Test am Cursor ausführen")}: ${best.label}`, "info");
      runTestTargetRef.current(best.id);
    } else {
      void runJava("test");
    }
  }, [cursor.line, runJava, toast]);

  const runCoverage = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) return;
    activeJavaActionRef.current = "test";
    setLastJavaAction("test");
    setLastProcessExitCode(null);
    setPanelVisible(true);
    setPanel("tests");
    setRunning(true);
    try {
      const result = await window.kiwi.tests.coverage(workspaceRoot);
      if (result.operationId) {
        upsertOperation({
          id: result.operationId,
          projectRoot: workspaceRoot,
          kind: "test",
          label: "Testabdeckung ermitteln",
          detail: result.command,
          cancellable: true,
        });
      }
    } catch (error) {
      setRunning(false);
      toast(error instanceof Error ? error.message : "Testabdeckung konnte nicht gestartet werden.", "error");
    }
  }, [toast, upsertOperation, workspaceRoot]);



  const prepareJavaNavigation = useCallback(async () => {
    if (!workspaceRoot || !activeFile || activeFile.language !== "java" || !window.kiwi) {
      throw new Error("Öffne eine Java-Datei und setze den Cursor auf ein Symbol.");
    }
    const editor = editorRef.current;
    const position = editor?.getPosition();
    if (!editor || !position) throw new Error("Der Editor ist noch nicht bereit.");
    const currentText = editor.getModel()?.getValue() ?? activeFile.content;
    await window.kiwi.language.change({ root: workspaceRoot, file: activeFile.path, text: currentText });
    return {
      position,
      params: {
        textDocument: { uri: fileUri(activeFile.path) },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      },
      symbol: editor.getModel()?.getWordAtPosition(position)?.word || basename(activeFile.path).replace(/\.java$/i, ""),
    };
  }, [activeFile, workspaceRoot]);

  const showHierarchy = useCallback(async (kind: "call" | "type") => {
    javaNavigationLastKindRef.current = kind;
    const requestId = ++javaNavigationRequestRef.current;
    setActivity("hierarchy");
    setSidebarVisible(true);
    setJavaNavigationLoading(true);
    setJavaNavigationError("");
    try {
      const context = await prepareJavaNavigation();
      const prepareMethod = kind === "call" ? "textDocument/prepareCallHierarchy" : "textDocument/prepareTypeHierarchy";
      const items = await window.kiwi!.language.request(workspaceRoot, prepareMethod, context.params);
      const item = (Array.isArray(items) ? items[0] : items) as JavaHierarchyItem | undefined;
      if (!item) throw new Error("An dieser Position wurde kein geeignetes Symbol gefunden.");
      const directions: HierarchyDirection[] = kind === "call"
        ? ["incoming", "outgoing"]
        : ["supertypes", "subtypes"];
      const methods = kind === "call"
        ? ["callHierarchy/incomingCalls", "callHierarchy/outgoingCalls"]
        : ["typeHierarchy/supertypes", "typeHierarchy/subtypes"];
      const responses = await Promise.all(methods.map((method) =>
        window.kiwi!.language.request(workspaceRoot, method, { item }).catch(() => []),
      ));
      if (requestId !== javaNavigationRequestRef.current) return;
      const labels = kind === "call"
        ? ["Eingehende Aufrufe", "Ausgehende Aufrufe"]
        : ["Obertypen", "Untertypen"];
      setJavaNavigation({
        id: `${kind}:${item.uri}:${item.selectionRange.start.line}:${Date.now()}`,
        kind,
        title: `${kind === "call" ? "Call" : "Type"} Hierarchy: ${item.name}`,
        root: item,
        branches: responses.map((response, index) => ({
          direction: directions[index],
          label: labels[index],
          nodes: hierarchyNodesFromResponse(response, directions[index]),
        })),
      });
    } catch (error) {
      if (requestId !== javaNavigationRequestRef.current) return;
      const message = error instanceof Error ? error.message : "Hierarchie konnte nicht geladen werden.";
      setJavaNavigationError(message);
      toast(message, "error");
    } finally {
      if (requestId === javaNavigationRequestRef.current) setJavaNavigationLoading(false);
    }
  }, [prepareJavaNavigation, toast, workspaceRoot]);

  const showFindUsages = useCallback(async () => {
    javaNavigationLastKindRef.current = "usages";
    const requestId = ++javaNavigationRequestRef.current;
    setActivity("hierarchy");
    setSidebarVisible(true);
    setJavaNavigationLoading(true);
    setJavaNavigationError("");
    try {
      const context = await prepareJavaNavigation();
      const locations = await window.kiwi!.language.request(workspaceRoot, "textDocument/references", {
        ...context.params,
        context: { includeDeclaration: true },
      });
      const paths = [...new Set((Array.isArray(locations) ? locations : []).map((location: any) =>
        pathFromJavaUri(location?.uri || location?.targetUri || ""),
      ).filter((path: string) => path && isPathWithin(path, workspaceRoot)))] as string[];
      const contents = new Map<string, string>();
      await Promise.all(paths.map(async (path) => {
        try {
          contents.set(path, await window.kiwi!.file.read(path));
        } catch {
          contents.set(path, "");
        }
      }));
      if (requestId !== javaNavigationRequestRef.current) return;
      setJavaNavigation({
        id: `usages:${activeFile?.path || ""}:${context.position.lineNumber}:${Date.now()}`,
        kind: "usages",
        title: `Verwendungen von ${context.symbol}`,
        usageGroups: groupJavaUsageLocations(locations, contents, workspaceRoot, moduleInfos),
      });
    } catch (error) {
      if (requestId !== javaNavigationRequestRef.current) return;
      const message = error instanceof Error ? error.message : "Verwendungen konnten nicht geladen werden.";
      setJavaNavigationError(message);
      toast(message, "error");
    } finally {
      if (requestId === javaNavigationRequestRef.current) setJavaNavigationLoading(false);
    }
  }, [activeFile?.path, moduleInfos, prepareJavaNavigation, toast, workspaceRoot]);

  const loadHierarchyChildren = useCallback(async (node: JavaHierarchyNode) => {
    if (!workspaceRoot || !window.kiwi) return [];
    const method: Record<HierarchyDirection, string> = {
      incoming: "callHierarchy/incomingCalls",
      outgoing: "callHierarchy/outgoingCalls",
      supertypes: "typeHierarchy/supertypes",
      subtypes: "typeHierarchy/subtypes",
    };
    const response = await window.kiwi.language.request(workspaceRoot, method[node.direction], { item: node.item });
    return hierarchyNodesFromResponse(response, node.direction);
  }, [workspaceRoot]);

  const refreshJavaNavigation = useCallback(() => {
    const kind = javaNavigationLastKindRef.current || javaNavigation?.kind;
    if (kind === "usages") void showFindUsages();
    else if (kind === "call" || kind === "type") void showHierarchy(kind);
  }, [javaNavigation?.kind, showFindUsages, showHierarchy]);

  const selectDiagnostic = (diagnostic: Diagnostic) => {
    const absolutePath = /^[a-zA-Z]:[\\/]/.test(diagnostic.path) || diagnostic.path.startsWith("/")
      ? diagnostic.path
      : `${workspaceRoot}\\${diagnostic.path}`;
    void openFile(absolutePath, {
      line: diagnostic.line,
      column: diagnostic.column,
      endLine: diagnostic.endLine,
      endColumn: diagnostic.endColumn,
    });
  };

  const applyBuildQuickFix = useCallback(async (diagnostic: Diagnostic) => {
    if (!workspaceRoot || !window.kiwi) return;
    const fix = buildQuickFixForDiagnostic(diagnostic);
    if (!fix) {
      selectDiagnostic(diagnostic);
      return;
    }
    const fixKey = `${diagnostic.path}:${diagnostic.line}:${fix.sourceType}:${fix.targetType}`;
    setBuildFixing(fixKey);
    try {
      const className = fix.sourceType.split(".").at(-1)?.split("$")[0] || fix.sourceType;
      const matches = await window.kiwi.workspace.search(workspaceRoot, `class ${className}`);
      const sourcePath = [...new Set(matches.map((item) => item.path))]
        .find((candidate) => basename(candidate).toLocaleLowerCase() === `${className}.java`.toLocaleLowerCase());
      if (!sourcePath) throw new Error(`Die Quelldatei für ${className} wurde nicht gefunden.`);
      const before = await window.kiwi.file.read(sourcePath);
      const after = implementJavaInterface(before, fix.sourceType, fix.targetType);
      if (!after) throw new Error(`Die Deklaration von ${className} konnte nicht sicher geändert werden.`);
      if (after === before) {
        toast(`${className} implementiert ${fix.targetType.split(".").at(-1)} bereits.`, "info");
        return;
      }
      await window.kiwi.file.write(sourcePath, after);
      setOpenFiles((files) => files.map((file) => file.path === sourcePath
        ? { ...file, content: after, savedContent: after }
        : file));
      await window.kiwi.language.change({ root: workspaceRoot, file: sourcePath, text: after }).catch(() => false);
      await window.kiwi.language.save({ root: workspaceRoot, file: sourcePath, text: after }).catch(() => false);
      await openFile(sourcePath, {
        line: Math.max(1, after.slice(0, after.indexOf(`class ${className}`)).split(/\r?\n/).length),
        column: 1,
      });
      toast(`${fix.label} angewendet. Starte den Build erneut.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Quick Fix konnte nicht angewendet werden.", "error");
    } finally {
      setBuildFixing(null);
    }
  }, [openFile, toast, workspaceRoot]);

  const completeRefactorPreview = useCallback((confirmed: boolean) => {
    const current = refactorPreviewRef.current;
    refactorPreviewRef.current = null;
    setRefactorPreview(null);
    setActiveDocument((document) => document === "refactor-preview" ? null : document);
    current?.resolve(confirmed);
  }, []);

  /**
   * Every quick fix in the open file, taken in one go.
   *
   * Forty missing imports after a paste is forty trips to the lightbulb. The
   * whole change is shown before a character of it is written — nothing here
   * decides that a fix is safe, the preview does.
   */
  /**
   * What the compiler made of the open file.
   *
   * The question comes up rarely and matters entirely when it does: what a
   * lambda captures, which of two overloads a call picked, what a record
   * generates. Answering it meant leaving the IDE for a terminal and
   * remembering javap's flags.
   *
   * Shown in a read-only tab, because it is not a file and there is nothing to
   * save into it.
   */
  const showBytecode = useCallback(async () => {
    const file = openFiles.find((item) => item.path === activePath);
    const root = workspaceRootRef.current;
    if (!file || !root || !window.kiwi?.bytecode) {
      toast("Öffne zuerst eine Java-Datei.", "info");
      return;
    }
    const binaryName = binaryClassName(file.path, file.content);
    if (!binaryName) {
      toast("Bytecode gibt es nur für eine Java-Klasse.", "info");
      return;
    }
    const address = `bytecode:${binaryName}`;
    try {
      const answer = await window.kiwi.bytecode.disassemble(root, binaryName, file.path);
      const result = readBytecode(answer.stdout, answer.stderr, binaryName);
      if (result.problem) {
        toast(result.problem, "info");
        return;
      }
      setOpenFiles((files) => {
        const without = files.filter((item) => item.path !== address);
        return [...without, {
          path: address,
          name: bytecodeTitle(binaryName),
          content: result.text,
          savedContent: result.text,
          externalContent: result.text,
          language: "plaintext",
          preview: false,
          readOnly: true,
          origin: binaryName,
        }];
      });
      setActiveDocument(null);
      setActivePath(address);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Der Bytecode konnte nicht gelesen werden.", "error");
    }
  }, [activePath, openFiles, toast]);

  const fixAllProblems = useCallback(async () => {
    const model = editorRef.current?.getModel();
    if (!model || model.getLanguageId() !== "java") {
      toast("Alle Probleme beheben gilt für eine geöffnete Java-Datei.", "info");
      return;
    }
    try {
      // The server's own diagnostics, not a reconstruction: it attaches data
      // to them that its code actions are looked up by.
      //
      // Looked up by the workbench's path, not the model's. Monaco writes the
      // Windows drive letter in lower case in `fsPath`, so a URI built from it
      // matches nothing in a map keyed the other way — the same mismatch that
      // once made breakpoint glyphs disappear.
      const store = languageDiagnosticsRef.current;
      const wanted = fileUri(activePath || model.uri.fsPath).toLowerCase();
      const key = Object.keys(store).find((entry) => entry.toLowerCase() === wanted);
      const diagnostics = (key ? store[key] : []) || [];
      const result = await languageProviderRef.current?.fixAll(model, diagnostics as never);
      if (!result) return;
      if (!result.total) {
        toast(describeFixes(result), "info");
        return;
      }
      if (result.confirmed) toast(describeFixes(result), "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Die Korrekturen konnten nicht angewendet werden.", "error");
    }
  }, [activePath, toast]);

  const confirmRefactorEdit = useCallback(async (edit: unknown) => {
    const monaco = monacoRef.current;
    if (!monaco || !window.kiwi) return false;
    const items = await previewLspWorkspaceEdit(monaco, window.kiwi, edit);
    if (!items.length) return true;
    if (refactorPreviewRef.current) refactorPreviewRef.current.resolve(false);
    return new Promise<boolean>((resolve) => {
      const preview = { items, resolve };
      refactorPreviewRef.current = preview;
      setRefactorPreview(preview);
      setActiveDocument("refactor-preview");
    });
  }, []);

  const applyJavaRefactorPlan = useCallback(async (planId: string) => {
    if (!window.kiwi || !workspaceRoot || !javaRefactorPlan) return;
    setJavaRefactorApplying(true);
    try {
      const plan = javaRefactorPlan;
      const expansionBeforeApply = new Set(expandedRef.current);
      const moveResults = plan.resources
        .filter((resource) => resource.kind === "rename")
        .map((resource) => ({ source: resource.oldPath, target: resource.newPath, move: true }));
      const touchedPaths = [
        ...plan.files.map((file) => file.path),
        ...moveResults.flatMap((result) => [result.source, result.target]),
      ];
      markSelfInflicted(touchedPaths, 3_000);
      await window.kiwi.refactor.apply(workspaceRoot, planId);
      const remap = (candidate: string) => {
        const resource = plan.resources.find((item) => item.kind === "rename" && isPathWithin(candidate, item.oldPath));
        return resource ? `${resource.newPath}${candidate.slice(resource.oldPath.length)}` : candidate;
      };
      const refreshed = await Promise.all(openFiles.map(async (file) => {
        const nextPath = remap(file.path);
        const content = await window.kiwi!.file.read(nextPath).catch(() => file.content);
        return { ...file, path: nextPath, name: basename(nextPath), content, savedContent: content };
      }));
      const changedFiles = new Set(plan.files.map((file) => file.path.toLocaleLowerCase()));
      for (let index = 0; index < openFiles.length; index += 1) {
        const before = openFiles[index];
        const after = refreshed[index];
        if (before.language !== "java") continue;
        if (before.path !== after.path) {
          await window.kiwi.language.close({ root: workspaceRoot, file: before.path }).catch(() => undefined);
          await window.kiwi.language.open({
            root: workspaceRoot,
            file: after.path,
            text: after.content,
            languageId: "java",
          }).catch(() => undefined);
        } else if (changedFiles.has(before.path.toLocaleLowerCase())) {
          await window.kiwi.language.change({ root: workspaceRoot, file: after.path, text: after.content }).catch(() => false);
          await window.kiwi.language.save({ root: workspaceRoot, file: after.path, text: after.content }).catch(() => false);
        }
      }
      setOpenFiles(refreshed);
      setActivePath((current) => current ? remap(current) : current);
      setSplitPath((current) => current ? remap(current) : current);
      setSelectedPaths((current) => new Set([...current].map(remap)));
      setSelectedNode(null);
      if (moveResults.length) {
        const targetDirectory = dirname(moveResults.at(-1)!.target);
        const nextExpanded = remapExpandedExplorerPaths(expansionBeforeApply, moveResults, targetDirectory);
        expandedRef.current = nextExpanded;
        setExpanded(nextExpanded);
        const clipboard = explorerClipboardRef.current;
        if (clipboard?.nodes.some((node) => moveResults.some((result) => isPathWithin(node.path, result.source)))) {
          updateExplorerClipboard(null);
        }
      }
      setJavaRefactorPlan(null);
      setActiveDocument(null);
      await Promise.all([
        refreshTree(workspaceRoot),
        window.kiwi.modules.list(workspaceRoot).then(setModuleInfos).catch(() => undefined),
      ]);
      if (plan.buildModelChanges.length) void refreshProjectTools();
      toast("Refactoring als eine rückgängig machbare Projektänderung angewendet", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Refactoring konnte nicht angewendet werden.", "error");
    } finally {
      setJavaRefactorApplying(false);
    }
  }, [javaRefactorPlan, markSelfInflicted, openFiles, refreshProjectTools, refreshTree, toast, updateExplorerClipboard, workspaceRoot]);

  const openChangeSignature = useCallback(async () => {
    if (!window.kiwi || !workspaceRoot || !activeFile || activeFile.language !== "java") {
      toast("Öffne zuerst eine Java-Methode.", "info");
      return;
    }
    try {
      await saveFile(activeFile.path);
      const position = { line: Math.max(0, cursor.line - 1), character: Math.max(0, cursor.column - 1) };
      const prepared = await window.kiwi.refactor.prepareChangeSignature(workspaceRoot, activeFile.path, position);
      if (!prepared.signature) throw new Error(prepared.reason || "Die Methodensignatur konnte nicht gelesen werden.");
      setChangeSignatureRequest({ file: activeFile.path, position, signature: prepared.signature });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Change Signature ist an dieser Position nicht verfügbar.", "error");
    }
  }, [activeFile, cursor.column, cursor.line, saveFile, toast, workspaceRoot]);

  const analyzeUnusedPrivate = useCallback(async (force = false) => {
    if (!window.kiwi || !workspaceRoot || unusedPrivateLoading) return;
    setActiveDocument("unused-private");
    setUnusedPrivateLoading(true);
    try {
      setUnusedPrivateAnalysis(await window.kiwi.refactor.unusedPrivate(workspaceRoot, { force, concurrency: 4 }));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Dead-Code-Analyse fehlgeschlagen.", "error");
    } finally {
      setUnusedPrivateLoading(false);
    }
  }, [toast, unusedPrivateLoading, workspaceRoot]);

  /**
   * Re-validates the open configuration files while they are edited.
   *
   * Debounced and routed through the main process so there is exactly one
   * implementation of every rule, shared with the project-wide scan.
   */
  const configBufferKey = openFiles
    .filter((file) => file.language !== "java")
    .map((file) => `${file.path}:${file.content.length}`)
    .join("|");
  useEffect(() => {
    if (!workspaceRoot || !window.kiwi) return;
    const handle = window.setTimeout(async () => {
      const candidates = currentSessionRef.current.files.filter((file) => file.language !== "java");
      const results = await Promise.all(candidates.map((file) => window.kiwi!.workspace
        .validateBuffer(workspaceRoot, file.path, file.content)
        .then((items) => [file.path, items] as const)
        .catch(() => [file.path, [] as Diagnostic[]] as const)));
      setBufferDiagnostics(Object.fromEntries(results.filter(([, items]) => items.length)));
    }, 350);
    return () => window.clearTimeout(handle);
  }, [configBufferKey, workspaceRoot]);

  // Owned separately from the JDT LS markers so the two never overwrite each
  // other: the server clears its own set whenever it re-analyses a file.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const model of monaco.editor.getModels()) {
      // Also samePath: a model whose URI spells the drive letter differently
      // found no open file here, and the red underlines stayed away with it.
      const file = openFiles.find((item) => samePath(item.path, model.uri.fsPath));
      if (!file) continue;
      monaco.editor.setModelMarkers(model, "Kiwi Syntax", (javaSyntaxProblems.get(file.path) || []).map((problem) => ({
        severity: problem.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        message: problem.message,
        startLineNumber: problem.line,
        startColumn: problem.column,
        endLineNumber: problem.line,
        endColumn: problem.column + problem.length,
        source: "Kiwi",
      })));
      // The configuration checks come back from the main process, so they are
      // applied here rather than recomputed in the renderer.
      monaco.editor.setModelMarkers(model, "Kiwi Config", (bufferDiagnostics[file.path] || []).map((item) => ({
        severity: item.severity === "error" ? monaco.MarkerSeverity.Error
          : item.severity === "warning" ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
        message: item.message,
        startLineNumber: item.line,
        startColumn: item.column,
        endLineNumber: item.endLine ?? item.line,
        endColumn: item.endColumn ?? item.column + 1,
        source: item.source || "Kiwi",
      })));
    }
  }, [bufferDiagnostics, javaSyntaxProblems, openFiles]);

  const beforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    // Replaces Monaco's own Java grammar, which lumps every keyword and every
    // name into two tokens and leaves most editor colours with nothing to
    // colour. Has to happen before the first model is tokenized.
    monaco.languages.setMonarchTokensProvider("java", javaLanguageDefinition() as never);
    // Monaco brings no HTTP language at all, so it is added rather than
    // replaced — grammar, send command and the lens above each request.
    installHttpLanguage(monaco, (line) => sendHttpRequestRef.current(line));
    // Completion for pom.xml and Gradle scripts. Registered per language and
    // filtered by file name, so an ordinary XML or Groovy file is untouched.
    if (window.kiwi) installBuildFileCompletion(monaco, window.kiwi);
    defineMonacoThemes(monaco, Boolean(backgroundImageDataRef.current), settingsRef.current.editorTokenColors, settingsRef.current.editorColorScheme, settingsRef.current.themeColorOverrides);
    /**
     * Where Ctrl+Click lands.
     *
     * Monaco asks whoever registered an opener to open the file a definition
     * is in. Nobody had, and its behaviour without one is documented as doing
     * nothing at all — so every jump out of the current file was dropped in
     * silence, whether the target was another class in the project or one
     * inside a jar.
     */
    editorOpenerRef.current?.dispose();
    editorOpenerRef.current = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        const target = editorOpenTarget(
          resource.toString(),
          resource.fsPath,
          selectionOrPosition as never,
          fileFromUri,
        );
        if (target.kind === "library") {
          void openLibraryClassRef.current(target.uri, target.position);
          return true;
        }
        if (target.kind === "file") {
          void openFileRef.current(target.path, target.position);
          return true;
        }
        return false;
      },
    });
    if (window.kiwi) {
      polyglotProviderRef.current?.dispose();
      polyglotProviderRef.current = registerPolyglotLanguageProviders(monaco, window.kiwi, (model) => {
        const roots = [workspaceRootRef.current, ...sessionsRef.current.keys()].filter(Boolean);
        return roots.sort((a, b) => b.length - a.length).find((root) => isPathWithin(model.uri.fsPath, root))
          || (model.uri.fsPath ? dirname(model.uri.fsPath) : "");
      });
      monaco.editor.registerCommand("kiwi.runPolyglotLens", async (_accessor, filePath: string) => {
        await openFileRef.current(filePath);
        void runJavaRef.current("run", undefined, undefined, filePath);
      });
      languageProviderRef.current?.dispose();
      languageProviderRef.current = installJavaLanguageProviders(
        monaco,
        window.kiwi,
        () => workspaceRootRef.current,
        () => completionSettingsRef.current,
        confirmRefactorEdit,
        (filePath) => startDebugRef.current(filePath),
        // Only used to say where a proposal came from. The project's own
        // packages are read from what it declares, so a name from this project
        // is not labelled as arriving with a dependency.
        () => ({
          projectType: projectInfoRef.current?.type || "",
          projectPackages: projectPackagesRef.current,
          // "21", "1.8" and "17" all appear here; only the release number
          // matters, and 1.8 is Java 8.
          languageLevel: javaReleaseNumber(projectInfoRef.current?.javaVersion || ""),
          // The project's own templates, which replace a built-in of the same
          // name rather than joining it.
          customTemplates: projectTemplatesRef.current,
        }),
      );
    }
  };



  /**
   * The line commands, as entries in Monaco's own command list.
   *
   * Without a keybinding on purpose. Registering one here looked like it took
   * Ctrl+D back from Monaco's "add selection to next find match" and did not:
   * the built-in kept winning and deleting a line quietly did nothing. The
   * chord is claimed by the workbench's key handler instead, which runs before
   * the editor is asked. What is left here is the action itself, so both
   * commands stay reachable from Monaco's command palette.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;
    const registered = [
      ["kiwi.deleteLine", "Zeile löschen", "editor.action.deleteLines"],
    ] as Array<[string, string, string]>;
    const disposables = registered.map(([id, label, action]) => editor.addAction({
      id,
      label,
      keybindings: [],
      run: (instance) => instance.trigger("keyboard", action, {}),
    }));
    return () => {
      for (const disposable of disposables) disposable.dispose();
    };
  }, [editorReady]);

  const onEditorMount: OnMount = (editor, monaco) => {
    gitHunkStagingRef.current?.dispose();
    gitHunkStagingRef.current = null;
    gitHunkModelListenerRef.current?.dispose();
    gitHunkModelListenerRef.current = null;
    editorRef.current = editor;
    setEditorReady(true);
    editor.focus();
    const installHunkStagingForModel = () => {
      gitHunkStagingRef.current?.dispose();
      gitHunkStagingRef.current = null;
      const model = editor.getModel();
      const root = workspaceRootRef.current;
      if (!window.kiwi || !root || !model?.uri.fsPath || !isPathWithin(model.uri.fsPath, root)) return;
      gitHunkStagingRef.current = installGitHunkStaging(
        monaco,
        editor,
        root,
        model.uri.fsPath,
        () => void refreshGit(root),
        (message) => toast(message, "error"),
      );
    };
    installHunkStagingForModel();
    gitHunkModelListenerRef.current = editor.onDidChangeModel(installHunkStagingForModel);
    // JUnit icons retain precedence in the shared glyph margin. Every other
    // Java line behaves like the breakpoint gutter of a desktop IDE.
    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = event.target.position?.lineNumber;
      const model = editor.getModel();
      if (!line || !model) return;
      if (event.event.ctrlKey || event.event.metaKey || event.event.altKey) {
        event.event.preventDefault();
        event.event.stopPropagation();
        void toggleBookmarkRef.current(model.uri.fsPath, line);
        return;
      }
      const action = resolveJavaGutterAction(model?.getLanguageId(), line, testTargetsRef.current);
      if (!action) return;
      event.event.preventDefault();
      event.event.stopPropagation();
      if (action.kind === "test") {
        runTestTargetRef.current(action.targetId);
      } else {
        toggleBreakpointAtLineRef.current(basename(model.uri.fsPath), model.getValue(), action.line, model.uri.fsPath);
      }
    });
    /**
     * Ends a finished line with the semicolon it was going to get.
     *
     * Only where the line demonstrably ends at the caret — the rule says no to
     * anything an open bracket, a trailing operator or a block header could
     * still continue. Enter is otherwise left completely alone: the handler
     * takes the key only in the case it is sure about, so the suggestion
     * widget, snippets and auto-indent all keep working as they did.
     */
    editor.onKeyDown((event) => {
      if (event.keyCode !== monaco.KeyCode.Enter) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!completionSettingsRef.current.finishStatements) return;
      const model = editor.getModel();
      const position = editor.getPosition();
      const selection = editor.getSelection();
      if (!model || !position || model.getLanguageId() !== "java") return;
      if (selection && !selection.isEmpty()) return;
      // An open suggestion widget owns Enter; so does an active snippet.
      if (document.querySelector(".monaco-editor .suggest-widget.visible")) return;
      const line = model.getLineContent(position.lineNumber);
      if (!needsStatementSemicolon(
        line.slice(0, position.column - 1),
        line.slice(position.column - 1),
        {
          // A call that returns something can be continued with another `.` on
          // the next line, so the semicolon waits unless the call returns
          // nothing. Both answers have to be had without asking the language
          // server, which cannot be reached inside a key handler.
          callReturnType: languageProviderRef.current?.acceptedCallReturnType(
            model.uri.toString(),
            position.lineNumber,
          ) || "",
          members: parseJavaMembers(model.getValue()),
        },
      )) return;
      event.preventDefault();
      event.stopPropagation();
      editor.executeEdits("kiwi.finishStatement", [{
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        text: ";",
      }], [new monaco.Selection(position.lineNumber, position.column + 1, position.lineNumber, position.column + 1)]);
      // Typed rather than inserted, so the new line is indented the way every
      // other line break in the editor is.
      editor.trigger("keyboard", "type", { text: "\n" });
    });
    editor.addAction({
      id: "kiwi.triggerBasicCompletion",
      label: "Basic Code Completion",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
      // Deliberately not in the context menu: completion is a keyboard action,
      // and two entries for it pushed the navigation commands out of sight.
      run: async (instance) => {
        languageProviderRef.current?.setCompletionIntent("basic");
        const model = instance.getModel();
        if (model && workspaceRootRef.current && model.getLanguageId() === "java" && window.kiwi) {
          await window.kiwi.language.change({
            root: workspaceRootRef.current,
            file: model.uri.fsPath,
            text: model.getValue(),
          }).catch(() => undefined);
        }
        instance.trigger("keyboard", "editor.action.triggerSuggest", {});
      },
    });
    editor.addAction({
      id: "kiwi.triggerSmartCompletion",
      label: "Smart Code Completion",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space],
      run: async (instance) => {
        languageProviderRef.current?.setCompletionIntent("smart");
        const model = instance.getModel();
        if (model && workspaceRootRef.current && model.getLanguageId() === "java" && window.kiwi) {
          await window.kiwi.language.change({
            root: workspaceRootRef.current,
            file: model.uri.fsPath,
            text: model.getValue(),
          }).catch(() => undefined);
        }
        instance.trigger("keyboard", "editor.action.triggerSuggest", {});
      },
    });
    editor.addAction({
      id: "kiwi.completeStatement",
      label: "Statement vervollständigen",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 2,
      precondition: "editorLangId == java",
      run: (instance) => {
        const model = instance.getModel();
        const position = instance.getPosition();
        if (!model || !position) return;
        const line = model.getLineContent(position.lineNumber);
        const indent = line.match(/^\s*/)?.[0] || "";
        let trimmed = line.trim();
        if (!trimmed) return;
        const missingParentheses = Math.max(0, (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length);
        if (missingParentheses) trimmed += ")".repeat(missingParentheses);
        const needsBlock = !trimmed.endsWith("{") && (
          /^(?:if|for|while|switch|catch|synchronized)\b/.test(trimmed)
          || /^(?:else|try|finally|do)\b/.test(trimmed)
          || /^(?:(?:public|protected|private|static|final|abstract|synchronized|native|default)\s+)*[\w$<>\[\], ?.@]+\s+[\w$]+\s*\([^;]*\)\s*(?:throws\s+[\w$., ]+)?$/.test(trimmed)
        );
        if (needsBlock) {
          instance.executeEdits("kiwi.completeStatement", [{
            range: new monaco.Range(position.lineNumber, 1, position.lineNumber, model.getLineMaxColumn(position.lineNumber)),
            text: `${indent}${trimmed} {\n${indent}    \n${indent}}`,
          }]);
          instance.setPosition({ lineNumber: position.lineNumber + 1, column: indent.length + 5 });
          return;
        }
        if (hasOpenTernary(trimmed)) return;
        if (!/[;{}:,]$/.test(trimmed)) {
          instance.executeEdits("kiwi.completeStatement", [{
            range: new monaco.Range(position.lineNumber, 1, position.lineNumber, model.getLineMaxColumn(position.lineNumber)),
            text: `${indent}${trimmed};`,
          }]);
        }
        instance.trigger("keyboard", "editor.action.insertLineAfter", {});
      },
    });
    editor.addAction({
      id: "kiwi.toggleBookmark",
      label: "Lesezeichen umschalten",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F11],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 3,
      run: (instance) => {
        const model = instance.getModel();
        const pos = instance.getPosition();
        if (!model || !pos) return;
        void toggleBookmarkRef.current(model.uri.fsPath, pos.lineNumber);
      },
    });
    editor.addAction({
      id: "kiwi.nextProblem",
      label: "Nächstes Problem",
      keybindings: [monaco.KeyCode.F8],
      run: (instance) => instance.trigger("keyboard", "editor.action.marker.next", {}),
    });
    editor.addAction({
      id: "kiwi.prevProblem",
      label: "Vorheriges Problem",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F8],
      run: (instance) => instance.trigger("keyboard", "editor.action.marker.prev", {}),
    });
    editor.addAction({
      id: "kiwi.quickFix",
      label: "Quick Fix und Intentionen",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Enter],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 1,
      run: (instance) => instance.trigger("keyboard", "editor.action.quickFix", {}),
    });
    // Right-clicking in the editor is where a refactoring is actually reached
    // for; the Explorer context menu was the only entry point before.
    for (const [id, label, kind, order] of [
      ["kiwi.extractMethod", "Methode extrahieren", "refactor.extract.function", 1],
      ["kiwi.extractVariable", "Variable einführen", "refactor.extract.variable", 2],
      ["kiwi.changeSignature", "Signatur ändern…", "refactor.rewrite", 3],
    ] as Array<[string, string, string, number]>) {
      editor.addAction({
        id,
        label,
        contextMenuGroupId: "2_refactor",
        contextMenuOrder: order,
        precondition: "editorLangId == java",
        run: (instance) => instance.trigger("keyboard", "editor.action.codeAction", { kind, apply: "never" }),
      });
    }
    editor.addAction({
      id: "kiwi.renameSymbol",
      label: "Symbol umbenennen",
      keybindings: [monaco.KeyCode.F2],
      // Not in the context menu: Monaco already lists its own "Rename Symbol"
      // there and both trigger the same command. The keybinding stays because
      // it is the one the shortcut settings refer to.
      run: (instance) => instance.trigger("keyboard", "editor.action.rename", {}),
    });
    editor.addAction({
      id: "kiwi.watchSelection",
      label: "Ausdruck beobachten",
      contextMenuGroupId: "5_debug",
      contextMenuOrder: 1,
      // Without a selection there is no expression to watch.
      precondition: "editorHasSelection",
      run: (instance) => {
        const model = instance.getModel();
        const selection = instance.getSelection();
        const expression = model && selection ? model.getValueInRange(selection).trim() : "";
        if (!expression) return;
        setWatchExpression(expression);
        setPanel("debug");
        setPanelVisible(true);
        void window.kiwi?.debug.command("evaluate", expression).catch(() => undefined);
      },
    });
    // One entry rather than four: the dialog behind it already offers every
    // kind, so four near-identical lines only made the menu longer. The
    // individual commands stay available from the palette.
    editor.addAction({
      id: "kiwi.generateJavaMembers",
      label: "Generieren …",
      contextMenuGroupId: "3_generate",
      contextMenuOrder: 1,
      precondition: "editorLangId == java",
      run: () => requestGenerateMembers("accessors"),
    });
    editor.addAction({
      id: "kiwi.generateConstructor",
      label: "Konstruktor generieren",
      run: () => requestGenerateMembers("constructor"),
    });
    editor.addAction({
      id: "kiwi.generateEqualsHashCode",
      label: "equals() und hashCode() generieren",
      run: () => requestGenerateMembers("equalsHashCode"),
    });
    editor.addAction({
      id: "kiwi.generateToString",
      label: "toString() generieren",
      run: () => requestGenerateMembers("toString"),
    });
    editor.addAction({
      id: "kiwi.sendHttpRequest",
      label: "HTTP-Anfrage senden",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyR],
      contextMenuGroupId: "4_run",
      contextMenuOrder: 1,
      precondition: `editorLangId == '${HTTP_LANGUAGE_ID}'`,
      // The lens passes a line; the shortcut passes none and the cursor decides.
      run: (_instance, line?: number) => sendHttpRequestRef.current(typeof line === "number" ? line : undefined),
    });
    // Adding a library from the file it belongs in.
    //
    // The dialog offers every build file of the project and starts on the
    // first, which in a multi-project build is the root — a file that governs
    // no source. The library was written correctly and nothing happened, which
    // is indistinguishable from not being written at all. Right-clicking in a
    // build file says which one is meant.
    const buildFileContext = editor.createContextKey<boolean>("kiwiBuildFile", false);
    const editorFilePath = (instance: MonacoEditor.ICodeEditor) => {
      const uri = instance.getModel()?.uri;
      if (!uri) return "";
      try {
        return fileFromUri(uri.toString());
      } catch {
        return "";
      }
    };
    const refreshBuildFileContext = () => buildFileContext.set(acceptsDependencies(editorFilePath(editor)));
    editor.onDidChangeModel(refreshBuildFileContext);
    refreshBuildFileContext();
    editor.addAction({
      id: "kiwi.surroundSelection",
      label: "Auswahl umschließen…",
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 1,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyT],
      run: () => {
        setPaletteMode("surround");
        setPaletteQuery("");
        setPaletteOpen(true);
      },
    });
    editor.addAction({
      id: "kiwi.duplicateLine",
      label: "Zeile duplizieren",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      run: (instance) => {
        const model = instance.getModel();
        const selection = instance.getSelection();
        if (!model || !selection) return;
        if (selection.isEmpty()) {
          instance.trigger("keyboard", "editor.action.copyLinesDownAction", {});
        } else if (selection.startLineNumber === selection.endLineNumber) {
          const text = model.getValueInRange(selection);
          instance.executeEdits("kiwi.duplicateLine", [{
            range: new monaco.Range(selection.endLineNumber, selection.endColumn, selection.endLineNumber, selection.endColumn),
            text,
          }]);
          instance.setSelection(new monaco.Range(
            selection.endLineNumber,
            selection.endColumn,
            selection.endLineNumber,
            selection.endColumn + text.length,
          ));
        } else {
          instance.trigger("keyboard", "editor.action.copyLinesDownAction", {});
        }
      },
    });
    editor.addAction({
      id: "kiwi.moveLineUp",
      label: "Zeile nach oben verschieben",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow],
      run: (instance) => instance.trigger("keyboard", "editor.action.moveLinesUpAction", {}),
    });
    editor.addAction({
      id: "kiwi.moveLineDown",
      label: "Zeile nach unten verschieben",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.DownArrow],
      run: (instance) => instance.trigger("keyboard", "editor.action.moveLinesDownAction", {}),
    });
    editor.addAction({
      id: "kiwi.organizeImports",
      label: "Imports organisieren",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyO],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 4,
      precondition: "editorLangId == java",
      run: (instance) => {
        const model = instance.getModel();
        if (!model) return;
        void languageProviderRef.current?.organizeImports(model).then(() => {
          toast(t("Imports organisiert"), "success");
        }).catch(() => undefined);
      },
    });
    editor.addAction({
      id: "kiwi.fileStructure",
      label: "Datei-Struktur anzeigen",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
      run: () => {
        setPaletteMode("structure");
        setPaletteQuery("");
        setPaletteOpen(true);
      },
    });
    editor.addAction({
      id: "kiwi.runTestAtCursor",
      label: "Test am Cursor ausführen",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.F10],
      contextMenuGroupId: "4_run",
      contextMenuOrder: 0,
      precondition: "editorLangId == java",
      run: () => {
        runTestAtCursor();
      },
    });
    editor.addAction({
      id: "kiwi.addDependencyHere",
      label: "Abhängigkeit hinzufügen…",
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 0,
      precondition: "kiwiBuildFile",
      run: (instance) => {
        const file = editorFilePath(instance);
        if (!file) return;
        setDependencyDialogTarget(file);
        setDependencyDialogOpen(true);
      },
    });
    editor.addAction({
      id: "kiwi.createTestClass",
      label: "JUnit-Testklasse erstellen",
      contextMenuGroupId: "3_generate",
      contextMenuOrder: 2,
      precondition: "editorLangId == java",
      run: () => {
        const file = currentSessionRef.current.files.find((item) => item.path === currentSessionRef.current.activePath);
        if (!file) return;
        const parent = dirname(file.path);
        void createJavaElement("junit", { id: parent, name: basename(parent), path: parent, type: "directory" });
      },
    });
    editor.onDidChangeCursorPosition((event) => {
      setCursor({ line: event.position.lineNumber, column: event.position.column });
    });
    // What the others in a session see. Sent as offsets into the text, which is
    // the one measure both ends agree on: an unsaved change on either side
    // makes their line numbers mean different things.
    editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      const file = model?.uri.fsPath;
      if (!model || !file) return;
      sendCollabCursorRef.current(
        file,
        model.getOffsetAt(event.selection.getPosition()),
        model.getOffsetAt(event.selection.getSelectionStart()),
      );
    });
  };

  useEffect(() => {
    if (!gitStatus.available) return;
    void gitHunkStagingRef.current?.refresh().catch(() => undefined);
  }, [gitStatus.available, gitStatus.files]);

  useEffect(() => () => {
    gitHunkStagingRef.current?.dispose();
    gitHunkStagingRef.current = null;
    gitHunkModelListenerRef.current?.dispose();
    gitHunkModelListenerRef.current = null;
  }, []);

  useEffect(() => {
    if (!window.kiwi) {
      setBootstrapped(true);
      return;
    }
    void Promise.all([
      welcomeWindow ? window.kiwi.workspace.list() : window.kiwi.workspace.restoreState(),
      window.kiwi.settings.get(),
    ]).then(async ([initialState, initialSettings]) => {
      let state = initialState;
      let settings = initialSettings;
      if (welcomeWindow && !settings.workspaceHistoryMigrated) {
        state = await window.kiwi!.workspace.recoverRecent(legacyProjectRoots());
        settings = await window.kiwi!.settings.get();
      }
      setIdeSettings(settings);
      setWorkspaceState(state);
      setFontSize(settings.fontSize);
      setMinimap(settings.minimap);
      setWordWrap(settings.wordWrap);
      if (!welcomeWindow && state.activeRoot) await loadWorkspace(state.activeRoot);
      if (!welcomeWindow && !state.activeRoot) await window.kiwi?.app.showWelcome();
    }).catch((error) => {
      toast(error instanceof Error ? error.message : "Workspace konnte nicht wiederhergestellt werden.", "error");
    }).finally(() => setBootstrapped(true));
  }, [loadWorkspace, welcomeWindow]);

  useEffect(() => {
    if (!window.kiwi || welcomeWindow || !workspaceRoot) return undefined;
    let disposed = false;
    void window.kiwi.collab.hostState().then(async (state) => {
      if (disposed) return;
      const root = workspaceRootRef.current;
      const ownsSession = state.hosting && collabRootsEqual(state.root || "", root);
      if (state.hosting && !ownsSession) await window.kiwi!.collab.stopHosting().catch(() => undefined);
      if (!disposed) handleCollabHostingChange(ownsSession);
    }).catch(() => undefined);

    const removeEdit = window.kiwi.collab.onEdit((payload) => {
      if (payload.session !== "host") return;
      const root = workspaceRootRef.current;
      if (!isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      const absolute = collabAbsolutePath(root, payload.path);
      if (!absolute || !isPathWithin(absolute, root)) return;
      const key = absolute.toLocaleLowerCase();
      const hasPendingLocalWork = collabEditQueuesRef.current.has(key);
      if (!canApplyCollabRemoteEdit(
        collabFileVersionsRef.current.get(key),
        payload.version,
        hasPendingLocalWork,
      )) {
        scheduleCollabHostSnapshotRef.current(root, payload.path, key);
        return;
      }
      collabFileVersionsRef.current.set(key, payload.version);
      collabPlannedVersionsRef.current.set(key, payload.version);
      const monaco = monacoRef.current;
      const model = monaco?.editor.getModels().find((candidate) =>
        candidate.uri.fsPath.toLocaleLowerCase() === key);
      collabRemoteEditsRef.current.add(key);
      try {
        if (model && monaco) {
          const start = model.getPositionAt(payload.edit.start);
          const end = model.getPositionAt(payload.edit.end);
          model.applyEdits([{
            range: monaco.Range.fromPositions(start, end),
            text: payload.edit.text,
            forceMoveMarkers: true,
          }]);
          const content = model.getValue();
          setOpenFiles((files) => files.map((file) => file.path.toLocaleLowerCase() === key
            ? { ...file, content, preview: false }
            : file));
        } else {
          setOpenFiles((files) => files.map((file) => file.path.toLocaleLowerCase() === key
            ? { ...file, content: applyCollabEdit(file.content, payload.edit), preview: false }
            : file));
        }
      } finally {
        // Monaco emits its change synchronously. Keeping the marker to the next
        // microtask also covers the React wrapper synchronising its value prop.
        queueMicrotask(() => collabRemoteEditsRef.current.delete(key));
      }
    });
    const removeSaved = window.kiwi.collab.onSaved((payload) => {
      if (payload.session !== "host") return;
      const root = workspaceRootRef.current;
      if (!isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      // A save can complete while another edit is already in flight. Only an
      // explicitly clean, current snapshot may advance the editor baseline.
      if (payload.dirty !== false
        || (payload.currentVersion !== undefined && payload.version !== undefined
          && payload.currentVersion !== payload.version)) return;
      const absolute = collabAbsolutePath(root, payload.path);
      if (!absolute) return;
      const key = absolute.toLocaleLowerCase();
      const savedVersion = payload.currentVersion ?? payload.version;
      if (!collabEditQueuesRef.current.has(key) && Number.isInteger(savedVersion)) {
        collabFileVersionsRef.current.set(key, savedVersion as number);
        collabPlannedVersionsRef.current.set(key, savedVersion as number);
      }
      // Reading the bytes that were actually written avoids marking a newer
      // unsent Monaco value clean merely because it is the current React value.
      void window.kiwi!.file.read(absolute).then((savedContent) => {
        setOpenFiles((files) => files.map((file) => file.path.toLocaleLowerCase() === key
          ? { ...file, savedContent }
          : file));
      }).catch(() => undefined);
    });
    const removeReset = window.kiwi.collab.onReset((payload) => {
      if (payload.session !== "host") return;
      const root = workspaceRootRef.current;
      if (!isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
      const absolute = collabAbsolutePath(root, payload.path);
      if (!absolute || !isPathWithin(absolute, root)) return;
      const key = absolute.toLocaleLowerCase();
      if (collabEditQueuesRef.current.has(key)) {
        // The reset is the new disk baseline, but applying it over optimistic
        // typing would erase the user's latest input. Drain and resynchronise.
        setOpenFiles((files) => files.map((file) => file.path.toLocaleLowerCase() === key
          ? { ...file, savedContent: payload.text }
          : file));
        scheduleCollabHostSnapshotRef.current(root, payload.path, key);
        return;
      }
      collabFileVersionsRef.current.set(key, payload.version);
      collabPlannedVersionsRef.current.set(key, payload.version);
      const model = monacoRef.current?.editor.getModels().find((candidate) =>
        candidate.uri.fsPath.toLocaleLowerCase() === key);
      collabRemoteEditsRef.current.add(key);
      try {
        if (model && model.getValue() !== payload.text) model.setValue(payload.text);
        setOpenFiles((files) => files.map((file) => file.path.toLocaleLowerCase() === key
          ? { ...file, content: payload.text, savedContent: payload.text, preview: false }
          : file));
      } finally {
        queueMicrotask(() => collabRemoteEditsRef.current.delete(key));
      }
    });
    return () => {
      disposed = true;
      removeEdit();
      removeSaved();
      removeReset();
    };
  }, [handleCollabHostingChange, welcomeWindow, workspaceRoot]);

  useEffect(() => {
    if (!window.kiwi) return;
    const removeOutput = window.kiwi.java.onOutput((payload) => {
      if (payload.projectRoot && payload.projectRoot !== workspaceRootRef.current) return;
      if (payload.operationId) {
        upsertOperation({
          id: payload.operationId,
          projectRoot: payload.projectRoot || workspaceRootRef.current,
          kind: panel === "tests" ? "test" : panel === "run" ? "run" : "build",
          label: panel === "tests" ? "Tests ausführen" : panel === "run" ? "Anwendung ausführen" : "Projekt bauen",
          detail: payload.text.trim().slice(0, 120),
          cancellable: true,
        });
      }
      appendBufferedOutput(payload.text);
      if (activeTestRun.current) {
        /**
         * What the tests are doing, while they are doing it.
         *
         * Read through a buffer that survives a chunk boundary. The stream
         * hands over whatever has arrived, which stops mid-line as often as
         * not, and reading each chunk on its own lost both halves of every
         * line it split — for Maven that is a whole class's counts.
         *
         * Counts are summed rather than maxed. Maven reports "Tests run: N"
         * once per class, so taking the largest showed the biggest single
         * class instead of the total, all the way through the run — which is
         * the only time a progress display is looked at. Its final total line
         * carries no "- in <class>" and is deliberately not matched, so
         * nothing is counted twice.
         */
        const read = readTestProgress(testProgressStream.current, payload.text);
        testProgressStream.current = read.state;
        if (read.events.length) {
          testProgressRun.current = applyTestProgress(testProgressRun.current, read.events);
          const run = testProgressRun.current;
          const completed = run.passed + run.failed + run.skipped;
          setTestProgress((current) => ({
            ...current,
            current: run.current || current.current,
            completed,
            total: Math.max(current.total, completed),
            passed: run.passed,
            failed: run.failed,
            skipped: run.skipped,
          }));
        }
      }
    });
    const removeExit = window.kiwi.java.onExit(({ code, projectRoot, operationId }) => {
      if (projectRoot && projectRoot !== workspaceRootRef.current) return;
      const action = activeJavaActionRef.current;
      const completedOutput = `${outputRef.current}\nProzess beendet mit Code ${code}.\n`.slice(-250_000);
      if (action === "build" && workspaceRootRef.current) {
        const entry: BuildHistoryEntry = {
          id: `${Date.now()}-${operationId || "build"}`,
          finishedAt: new Date().toISOString(),
          status: code === 0 ? "success" : "failed",
          action,
          output: completedOutput,
          modules: groupBuildOutputByModule(completedOutput),
        };
        setBuildHistory((current) => {
          const next = [entry, ...current].slice(0, 30);
          localStorage.setItem(`kiwi.build.history.v1:${workspaceRootRef.current}`, JSON.stringify(next));
          return next;
        });
      }
      if (operationId) completeOperation(operationId);
      setRunning(false);
      setLastProcessExitCode(code);
      setTestProgress((current) => ({ ...current, running: false, completed: Math.max(current.completed, current.total) }));
      const suffix = `\nProzess beendet mit Code ${code}.\n`;
      appendBufferedOutput(suffix);
      flushBufferedOutput();
      if (code === 0) toast("Java-Prozess erfolgreich beendet", "success");
      else {
        setPanel(action === "test" ? "tests" : action === "run" ? "run" : "build");
        setPanelVisible(true);
        toast(`Build fehlgeschlagen (Code ${code})`, "error");
      }
      if (workspaceRoot) {
        const completedTestRun = activeTestRun.current;
        activeTestRun.current = null;
        void window.kiwi!.tests.results(workspaceRoot).then((reports) => {
          setTestReports(reports);
          void window.kiwi!.tests.history(workspaceRoot).then((history) => {
            setTestHistory(history.runs);
            setFlakyTests(history.flaky);
          });
          const failed = reports.some((report) => report.failures + report.errors > 0);
          if (failed && completedTestRun && settings.rerunFailedTests && !completedTestRun.automaticRetry) {
            toast("Fehlgeschlagene Tests werden einmal automatisch wiederholt.", "info");
            void runTest(completedTestRun.target, true);
          }
        }).catch(() => undefined);
        void window.kiwi!.tests.coverageResults(workspaceRoot).then(async (files) => {
          if (!files.length) return;
          setCoverageFiles(files);
          // Measured against the working tree as it stands, which is what the
          // run just covered.
          const patch = await window.kiwi!.git.diff(workspaceRoot).catch(() => "");
          const changed = changedLinesFromDiff(patch);
          setDiffCoverageResult(changed.size ? diffCoverage(files, changed) : null);
        }).catch(() => undefined);
        void window.kiwi!.git.status(workspaceRoot).then(setGitStatus).catch(() => undefined);
      }
    });
    const removeTerminalOutput = window.kiwi.terminal.onOutput((payload) => {
      if (payload.projectRoot && payload.projectRoot !== workspaceRootRef.current) return;
      const session = payload.sessionId || "1";
      // A background terminal keeps collecting; only the visible one is
      // allowed to touch the buffer the screen is rendered from.
      if (session !== activeTerminalRef.current) {
        terminalBuffers.current[session] = `${terminalBuffers.current[session] || ""}${payload.text}`.slice(-250_000);
        return;
      }
      appendBufferedOutput(payload.text, false);
    });
    const removeTerminalExit = window.kiwi.terminal.onExit(({ code, projectRoot, sessionId }) => {
      if (projectRoot && projectRoot !== workspaceRootRef.current) return;
      const session = sessionId || "1";
      const notice = `\n[Prozess beendet: ${code}]\n\n`;
      if (session !== activeTerminalRef.current) {
        terminalBuffers.current[session] = `${terminalBuffers.current[session] || ""}${notice}`.slice(-250_000);
        return;
      }
      appendBufferedOutput(notice, false);
      flushBufferedOutput();
    });
    const removeWorkspaceChanged = window.kiwi.workspace.onChanged(({ root, path, paths, kind }) => {
      if (root !== workspaceRootRef.current) return;
      const changes = (paths?.length ? paths : [path]).filter(Boolean);
      // The index follows the watcher rather than being rebuilt: walking a
      // large project again because one file was saved is what made the old
      // refresh visible. A rename says nothing about which way it went, so the
      // entry is written and a missing file falls out on the next walk.
      setProjectIndex((current) => (current.files.length
        ? applyIndexChange(current, { changed: changes }, Date.now())
        : current));
      pendingWatchChanges.current.push(...changes.map((changedPath) => ({ path: changedPath, kind })));
      if (watcherRefreshTimer.current !== null) window.clearTimeout(watcherRefreshTimer.current);
      watcherRefreshTimer.current = window.setTimeout(() => {
        watcherRefreshTimer.current = null;
        const pending = pendingWatchChanges.current.splice(0);
        const unique = [...new Map(pending.map((item) => [item.path.toLowerCase(), item])).values()];
        const now = Date.now();
        const structural = unique.filter((item) => {
          if (item.kind === "change") return false;
          const expiry = selfInflictedChanges.current.get(item.path.toLowerCase());
          return !expiry || expiry < now;
        });
        if (structural.length) {
          const parents = [...new Set(structural.map((item) => dirname(item.path)))];
          if (parents.length <= 6) {
            for (const parent of parents) {
              if (parent === root || !expandedRef.current.has(parent)) void refreshTreeRequestRef.current(root);
              else void loadDirectoryChildren(root, parent);
            }
          } else {
            void refreshTreeRequestRef.current(root);
          }
        }
        // An open file that is no longer on disk. Node's watcher cannot say
        // whether a structural event was a create, a rename or a delete, so
        // the ones that matter — the files with a buffer open — are asked
        // directly. A tab that stands for nothing looks identical to a saved
        // one otherwise.
        if (structural.length) void markMissingOpenFiles(structural.map((item) => item.path));
        for (const change of unique) {
          if (isProjectDefinition(change.path)) {
            scheduleProjectSync(root, change.path);
          } else if (/\.(?:java|jar)$/i.test(change.path)) {
            void window.kiwi!.language.refresh(root, change.path).catch(() => undefined);
          }
        }
      }, 140);
    });
    const removeDiagnostics = window.kiwi.language.onDiagnostics((payload) => {
      if (payload.projectRoot && payload.projectRoot !== workspaceRootRef.current) return;
      setLanguageDiagnostics((current) => ({ ...current, [payload.uri]: payload.diagnostics || [] }));
      const monaco = monacoRef.current;
      if (!monaco) return;
      const uri = monaco.Uri.parse(payload.uri);
      const model = monaco.editor.getModel(uri)
        || monaco.editor.getModels().find((item) => item.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase());
      if (model) monaco.editor.setModelMarkers(model, "JDT LS", lspDiagnosticsToMarkers(monaco, payload.diagnostics || []));
    });
    const removeLanguageStatus = window.kiwi.language.onStatus((payload) => {
      if (payload.projectRoot && payload.projectRoot !== workspaceRootRef.current) return;
      if (["starting", "indexing", "ready", "missing", "error"].includes(payload.status)) {
        setLanguageStatus(payload.status);
        setLanguageDetail(payload.detail || payload.reason || (payload.status === "ready" ? "Autocomplete ist bereit." : ""));
        const root = payload.projectRoot || workspaceRootRef.current;
        if (payload.status === "starting" || payload.status === "indexing") {
          if (!indexStartedAt.current.has(root)) indexStartedAt.current.set(root, performance.now());
          upsertOperation({
            id: `index:${root}`,
            projectRoot: root,
            kind: "index",
            label: "Java-Projekt indexieren",
            detail: payload.detail || t("Abhängigkeiten und Symbole werden verarbeitet …"),
            cancellable: true,
          });
        }
        if (payload.status === "ready" || payload.status === "missing" || payload.status === "error") {
          const started = indexStartedAt.current.get(root);
          if (payload.status === "ready" && started !== undefined) {
            recordPerformanceMetric({ kind: "index", value: Math.round(performance.now() - started), unit: "ms", projectRoot: root });
          }
          indexStartedAt.current.delete(root);
          completeOperation(`index:${root}`);
        }
      }
    });
    const removeLanguageMessage = window.kiwi.language.onMessage((payload) => {
      if (payload.projectRoot && payload.projectRoot !== workspaceRootRef.current) return;
      if (payload.message) toast(payload.message, payload.type === 1 ? "error" : "info");
    });
    const removeLanguageApplyEdit = window.kiwi.language.onApplyEdit(async (edit) => {
      const monaco = monacoRef.current;
      if (!monaco || !window.kiwi) return;
      try {
        const touched = await applyLspWorkspaceEdit(monaco, window.kiwi, edit, workspaceRootRef.current);
        for (const filePath of touched) {
          const content = await window.kiwi.file.read(filePath);
          setOpenFiles((files) => files.map((file) => file.path === filePath
            ? { ...file, content, savedContent: content }
            : file));
        }
        await refreshTree(workspaceRootRef.current);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Workspace-Edit konnte nicht angewendet werden.", "error");
      }
    });
    const removeDebugOutput = window.kiwi.debug.onOutput((payload) => {
      setDebugOutput((current) => `${current}${payload.text}`.slice(-250_000));
    });
    const removeDebugState = window.kiwi.debug.onState((payload) => {
      debugStatusRef.current = payload.status;
      setDebugStatus(payload.status);
      if (payload.status === "restarting") hotSwapRelaunchingRef.current = true;
      else if (["running", "paused", "stopped"].includes(payload.status)) hotSwapRelaunchingRef.current = false;
      if (payload.status === "stopped") {
        for (const timer of hotSwapTimersRef.current.values()) window.clearTimeout(timer);
        hotSwapTimersRef.current.clear();
        hotSwapRequestsRef.current.clear();
        completeOperation(`debug:${workspaceRootRef.current}`);
        setDebugVariables([]);
        setDebugVariableChildren({});
        setDebugStack([]);
        setDebugThreads([]);
        const editor = editorRef.current;
        if (editor) debugInlineDecorations.current = editor.deltaDecorations(debugInlineDecorations.current, []);
      }
      if (payload.status === "paused" && payload.className && payload.line) {
        const name = `${payload.className.split(".").at(-1)}.java`;
        const file = allFiles.find((item) => item.name === name);
        if (file) void openFile(file.path, { line: payload.line, column: 1 });
        // Jumping to the line said where it was and then left nothing behind:
        // one scroll later there was no telling which line was about to run.
        setDebugStoppedLine({ path: file?.path || "", line: payload.line });
      } else if (payload.status !== "paused") {
        setDebugStoppedLine(null);
      }
    });
    const removeDebugVariables = window.kiwi.debug.onVariables(({ scope, variables }) => {
      if (scope === "locals") setDebugVariables(variables);
      else setDebugVariableChildren((current) => ({ ...current, [scope]: variables }));
      const editor = editorRef.current;
      const position = editor?.getPosition();
      const model = editor?.getModel();
      if (!settings.inlineDebugValues) {
        if (editor) debugInlineDecorations.current = editor.deltaDecorations(debugInlineDecorations.current, []);
        return;
      }
      if (!editor || !model || !position || !variables.length) return;
      const lineEnd = model.getLineMaxColumn(position.lineNumber);
      debugInlineDecorations.current = editor.deltaDecorations(debugInlineDecorations.current, [{
        range: {
          startLineNumber: position.lineNumber,
          startColumn: lineEnd,
          endLineNumber: position.lineNumber,
          endColumn: lineEnd,
        },
        options: {
          after: {
            content: `  ${variables.slice(0, 5).map((item) => `${item.name} = ${item.value}`).join("   ")}`,
            inlineClassName: "debug-inline-value",
          },
        },
      }]);
    });
    const removeDebugStack = window.kiwi.debug.onStack(({ frames }) => setDebugStack(frames));
    const removeDebugThreads = window.kiwi.debug.onThreads(({ threads }) => setDebugThreads(threads));
    const removeDebugWatch = window.kiwi.debug.onWatch((watch) => {
      setDebugWatches((current) => [
        ...current.filter((item) => item.expression !== watch.expression),
        watch,
      ]);
    });
    const removeHotReplace = window.kiwi.debug.onHotReplace((payload) => {
      toast(payload.message, payload.success ? "success" : "error");
    });
    // The value a field is about to take is the whole reason to stop on a
    // write, and it is gone by the time the next line runs — so it goes into
    // the console, where it stays, and not into a toast that expires.
    const removeFieldHit = window.kiwi.debug.onFieldHit((payload) => {
      const member = `${payload.className.split(".").at(-1)}.${payload.fieldName}`;
      appendBufferedOutput(payload.access === "write"
        ? `Feld-Breakpoint: ${member} = ${payload.newValue} (vorher ${payload.value})\n`
        : `Feld-Breakpoint: ${member} gelesen, Wert ${payload.value}\n`);
    });
    const removeMethodExit = window.kiwi.debug.onMethodExit((payload) => {
      const member = `${payload.className.split(".").at(-1)}.${payload.methodName}()`;
      appendBufferedOutput(`Methoden-Breakpoint: ${member} liefert ${payload.returnValue || "—"}\n`);
    });
    const removeBreakpointStatus = window.kiwi.debug.onBreakpoint((payload) => {
      // Only failures are worth saying out loud. A verified breakpoint is what
      // pressing the button was supposed to do.
      if (payload.status !== "failed" || !payload.member) return;
      toast(`${payload.className.split(".").at(-1)}.${payload.member}: ${payload.problem || "Breakpoint nicht gesetzt"}`, "error");
    });
    return () => {
      removeOutput();
      removeExit();
      removeTerminalOutput();
      removeTerminalExit();
      removeWorkspaceChanged();
      removeDiagnostics();
      removeLanguageStatus();
      removeLanguageMessage();
      removeLanguageApplyEdit();
      removeDebugOutput();
      removeDebugState();
      removeDebugVariables();
      removeDebugStack();
      removeDebugThreads();
      removeDebugWatch();
      removeHotReplace();
      removeFieldHit();
      removeMethodExit();
      removeBreakpointStatus();
    };
  }, [allFiles, appendBufferedOutput, completeOperation, flushBufferedOutput, loadDirectoryChildren, openFile, panel, recordPerformanceMetric, refreshTree, runTest, scheduleProjectSync, settings.inlineDebugValues, settings.rerunFailedTests, toast, upsertOperation, workspaceRoot]);

  useEffect(() => {
    if (!bootstrapped || bootMetricRecorded.current) return;
    bootMetricRecorded.current = true;
    recordPerformanceMetric({ kind: "startup", value: Math.round(performance.now() - appBootStartedAt), unit: "ms" });
    const timer = window.setInterval(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
      if (memory) {
        const memoryMb = Math.round(memory / 1024 / 1024);
        recordPerformanceMetric({ kind: "memory", value: memoryMb, unit: "MB", projectRoot: workspaceRootRef.current || undefined });
        if (memoryMb >= 900 && !memoryWarningShown.current) {
          memoryWarningShown.current = true;
          toast(`Hoher Speicherverbrauch erkannt: ${memoryMb} MB. Schließe unbenutzte Tabs oder repariere den Projektindex.`, "info");
        }
        if (memoryMb < 650) memoryWarningShown.current = false;
        /*
         * A floor that keeps rising.
         *
         * The threshold above catches a single big number, which a large
         * project legitimately reaches. What it cannot see is memory that
         * never comes back down: every dip higher than the last, because
         * whatever is held is never given back. That needs the shape of the
         * session rather than one reading.
         */
        if (!memoryTrendReported.current) {
          const trend = detectMemoryTrend(performanceMetricsRef.current);
          if (trend?.leaking) {
            memoryTrendReported.current = true;
            toast(trend.message, "info");
          }
        }
      }
      void window.kiwi?.app.health().then((health) => {
        recordPerformanceMetric({ kind: "memory", value: health.main.rssMb, unit: "MB", projectRoot: workspaceRootRef.current || undefined });
        const suspicious = health.language.sessions > health.language.maxSessions
          // Several live terminals are intentional (and can now each be
          // popped out). A count above one is not a leak; stopped processes
          // are removed by TerminalService and project/app shutdown owns the
          // remaining lifecycle.
          || health.terminal.processes.some((process) => !process.running)
          || (health.debug.active && (!health.debug.adapterPid || !health.debug.vmPid));
        if (suspicious && !serviceLeakWarningShown.current) {
          serviceLeakWarningShown.current = true;
          toast("Ein Hintergrunddienst wirkt verwaist. „Projekt reparieren“ beendet JDT-, Terminal- und Debug-Prozesse kontrolliert.", "info");
        } else if (!suspicious) {
          serviceLeakWarningShown.current = false;
        }
      }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [bootstrapped, recordPerformanceMetric, toast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const operation of operations) {
        if (!operation.startedAt || now - operation.startedAt < 30_000 || slowOperationsReported.current.has(operation.id)) continue;
        slowOperationsReported.current.add(operation.id);
        toast(`„${operation.label}“ läuft ungewöhnlich lange. Details und Abbrechen findest du im Fortschrittsbereich.`, "info");
      }
      const activeIds = new Set(operations.map((operation) => operation.id));
      for (const id of slowOperationsReported.current) {
        if (!activeIds.has(id)) slowOperationsReported.current.delete(id);
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [operations, toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.ctrlKey || event.metaKey;
      const eventElement = event.target instanceof Element ? event.target : document.activeElement;
      const explorerFocused = Boolean(eventElement?.closest(".tree-view, .project-heading"));
      const editorFocused = Boolean(eventElement?.closest(".monaco-editor"));
      // Running before the page means the workbench sees keys that are being
      // typed into a field. A bare printable character is never a shortcut
      // there, whatever somebody bound it to.
      if (!commandKey && !event.altKey && event.key.length === 1
        && eventElement?.closest("input, textarea, [contenteditable='true'], .monaco-editor")) {
        return;
      }
      // While a shortcut is being recorded, every key belongs to the recorder.
      // Running Ctrl+S instead of storing it would make the one screen for
      // changing shortcuts the one screen where they cannot be changed.
      if (eventElement?.closest(".keybinding-capture")) return;
      /**
       * Typing a name in the Explorer to get to it.
       *
       * Every tree in every IDE does this, and without it a deep package is
       * either the mouse or four folder-opening keystrokes per level. It moves
       * the focus and nothing else — the row is a button, so Enter then opens
       * what the letters found, which is the whole interaction.
       */
      if (explorerFocused && (isSpeedSearchKey(event) || event.key === "Backspace")) {
        // Searched over the tree itself, not over the rows that happen to be
        // rendered: the list is virtualised, so the DOM holds only the window
        // around the viewport and a name scrolled out of it would be
        // unreachable by typing — which is the case speed search exists for.
        const visible = flattenVisibleTree(treeForSpeedSearch.current, expandedRef.current);
        if (visible.length) {
          event.preventDefault();
          const now = Date.now();
          const next = event.key === "Backspace"
            ? shortenSpeedSearch(speedSearchRef.current, now)
            : extendSpeedSearch(speedSearchRef.current, event.key, now);
          speedSearchRef.current = next;
          setSpeedSearch(next);
          const from = visible.findIndex((entry) => entry.node.path === selectedNodeRef.current?.path);
          const hit = speedSearchMatch(visible.map((entry) => entry.node.name), next.query, from);
          if (hit >= 0) {
            const found = visible[hit].node;
            setSelectedNode(found);
            setSelectedPaths(new Set([found.path]));
            revealTreeIndex(hit);
          }
          return;
        }
      }
      if (speedSearchRef.current.query && (event.key === "Escape" || event.key.startsWith("Arrow"))) {
        speedSearchRef.current = NO_SPEED_SEARCH;
        setSpeedSearch(NO_SPEED_SEARCH);
      }
      /**
       * Whether a Java-only command may run, and why it may not.
       *
       * These commands need the language server's model of a Java file, so in
       * a build script or an XML file there is nothing for them to do. Doing
       * nothing silently is what makes a shortcut look broken: the key is
       * pressed, the screen does not move, and the only conclusion available
       * is that the binding is dead. Saying so costs one line.
       */
      const javaCommand = (label: string) => {
        if (activeFile?.language === "java") return true;
        event.preventDefault();
        toast(`„${label}" gibt es nur in Java-Dateien.`, "info");
        return false;
      };
      // Not gated on Java: Monaco offers code actions for every language it
      // has a provider for, and where there are none it says so itself.
      if (matchesShortcut(event, keys.quickFix) && editorFocused) {
        event.preventDefault();
        editorRef.current?.trigger("keyboard", "editor.action.quickFix", {});
      }
      if (matchesShortcut(event, keys.generate) && editorFocused && javaCommand("Java-Code generieren")) {
        event.preventDefault();
        setPaletteMode("commands");
        setPaletteQuery("generieren");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.rename)) {
        event.preventDefault();
        // Renaming from inside the editor means the symbol under the caret.
        // Falling through to the Explorer from there would rename the file
        // instead, which is not what the key was pressed for.
        if (editorFocused) {
          if (javaCommand("Umbenennen")) editorRef.current?.trigger("keyboard", "editor.action.rename", {});
        } else if (selectedNode) {
          renameEntry(selectedNode);
        }
      }
      if (explorerFocused && matchesShortcut(event, keys.explorerCut) && selectedNode) {
        event.preventDefault();
        updateExplorerClipboard({ nodes: getExplorerSelection(selectedNode), move: true });
      }
      if (explorerFocused && matchesShortcut(event, keys.explorerCopy) && selectedNode) {
        event.preventDefault();
        updateExplorerClipboard({ nodes: getExplorerSelection(selectedNode), move: false });
      }
      if (explorerFocused && matchesShortcut(event, keys.explorerPaste) && selectedNode && explorerClipboardRef.current) {
        event.preventDefault();
        void pasteExplorerEntry(selectedNode);
      }
      if (matchesShortcut(event, keys.closeTab) && activePath) {
        event.preventDefault();
        closeFile(activePath);
      }
      if (matchesShortcut(event, keys.saveAll)) {
        event.preventDefault();
        void saveAll();
      } else if (matchesShortcut(event, keys.save) && activePath) {
        event.preventDefault();
        void saveFile(activePath);
      }
      if (matchesShortcut(event, keys.nextTab) || matchesShortcut(event, keys.previousTab)) {
        const index = openFiles.findIndex((file) => file.path === activePath);
        if (index >= 0 && openFiles.length > 1) {
          event.preventDefault();
          const step = matchesShortcut(event, keys.nextTab) ? 1 : -1;
          void openFile(openFiles[(index + step + openFiles.length) % openFiles.length].path);
        }
      }
      if (matchesShortcut(event, keys.commandPalette)) {
        event.preventDefault();
        setPaletteMode("commands");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.searchEverywhere)) {
        event.preventDefault();
        setPaletteMode("everywhere");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.recentFiles)) {
        event.preventDefault();
        setPaletteMode("recent");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.classes)) {
        event.preventDefault();
        setPaletteMode("classes");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.files)) {
        event.preventDefault();
        setPaletteMode("files");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      // The one list for everything that can be started. Ctrl+Shift+R is what
      // IntelliJ binds "Run Anything" to, and nothing else here claims it.
      if (commandKey && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        setPaletteMode("run");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (settings.keymap === "intellij" && commandKey && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setPaletteMode("commands");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (settings.keymap === "eclipse" && commandKey && event.key === "3") {
        event.preventDefault();
        setPaletteMode("commands");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.symbols)) {
        event.preventDefault();
        setPaletteMode("symbols");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      // Zoom is handled here rather than left to Chromium. Chromium's own
      // accelerators are bound to the US layout's "+" and "-" keys, so on a
      // German keyboard shrinking worked and enlarging did not — and its zoom
      // is a separate state from the app's own scale, so the two could not undo
      // each other. Every spelling of the keys is accepted: the character, the
      // physical key and the numeric block.
      const zoomOut = event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract" || event.code === "Slash";
      const zoomIn = event.key === "+" || event.key === "="
        || event.code === "Equal" || event.code === "NumpadAdd" || event.code === "BracketRight";
      const zoomReset = event.key === "0" || event.code === "Digit0" || event.code === "Numpad0";
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (zoomOut || zoomIn || zoomReset)) {
        event.preventDefault();
        event.stopPropagation();
        const next = nextUiScale(settingsRef.current.uiScale, zoomReset ? "reset" : zoomIn ? "in" : "out");
        if (next !== settingsRef.current.uiScale) void window.kiwi?.settings.update({ uiScale: next });
        return;
      }
      if (matchesShortcut(event, keys.togglePanel)) {
        event.preventDefault();
        setPanelVisible((visible) => !visible);
      }
      if (matchesShortcut(event, keys.toggleTerminal)) {
        event.preventDefault();
        setPanel("terminal");
        setPanelVisible(true);
      }
      if (matchesShortcut(event, keys.toggleProblems)) {
        event.preventDefault();
        setPanel("problems");
        setPanelVisible(true);
      }
      if (matchesShortcut(event, keys.toggleTodos)) {
        event.preventDefault();
        setPanel("todos");
        setPanelVisible(true);
      }
      if (matchesShortcut(event, keys.build)) {
        event.preventDefault();
        void runJava("build");
      } else if (matchesShortcut(event, keys.toggleSidebar)) {
        event.preventDefault();
        setSidebarVisible((visible) => !visible);
      }
      if (matchesShortcut(event, keys.openProject)) {
        event.preventDefault();
        void openWorkspace();
      }
      if (matchesShortcut(event, keys.findInFiles)) {
        event.preventDefault();
        setActivity("search");
        setSidebarVisible(true);
      }
      if (matchesShortcut(event, keys.settings)) {
        event.preventDefault();
        openSettingsDocument();
      }
      if (matchesShortcut(event, keys.stop)) {
        event.preventDefault();
        void stopJava();
      } else if (matchesShortcut(event, keys.run)) {
        event.preventDefault();
        void runJava("run");
      }
      if (matchesShortcut(event, keys.runTests)) {
        event.preventDefault();
        runTestAtCursor();
      }
      if (matchesShortcut(event, keys.debug)) {
        event.preventDefault();
        void startDebug();
      } else if (matchesShortcut(event, keys.toggleBreakpoint)) {
        event.preventDefault();
        toggleBreakpoint();
      }
      // Editor commands only make sense while an editor is on screen; Monaco
      // owns the actual implementation, we only route the key to it.
      // The refactorings were only reachable from the Explorer context menu,
      // which is the last place someone looks while writing a method body.
      for (const [binding, kind, label] of [
        [keys.extractMethod, "refactor.extract.function", "Methode extrahieren"],
        [keys.extractVariable, "refactor.extract.variable", "Variable einführen"],
      ] as Array<[string, string, string]>) {
        if (!matchesShortcut(event, binding)) continue;
        if (!javaCommand(label)) continue;
        event.preventDefault();
        editorRef.current?.trigger("keyboard", "editor.action.codeAction", { kind, apply: "never" });
      }
      if (matchesShortcut(event, keys.changeSignature) && javaCommand("Signatur ändern")) {
        event.preventDefault();
        void openChangeSignature();
      }
      if (matchesShortcut(event, keys.findUsages) && javaCommand("Verwendungen suchen")) {
        event.preventDefault();
        void showFindUsages();
      }
      // Commands that change the buffer, so they only fire while the buffer is
      // where the typing goes. Ctrl+D is the reason this list exists: Monaco
      // binds it to "add selection to next find match" and an action of our
      // own registered on the editor does not take it back — the built-in
      // keeps winning. Claiming the key here, before the editor is asked, is
      // what makes a rebindable command actually rebindable.
      for (const [binding, action] of [
        [keys.redo, "redo"],
        [keys.reformat, "editor.action.formatDocument"],
        [keys.toggleComment, "editor.action.commentLine"],
        [keys.deleteLine, "editor.action.deleteLines"],
        [keys.duplicateLine, "kiwi.duplicateLine"],
        [keys.moveLineUp, "editor.action.moveLinesUpAction"],
        [keys.moveLineDown, "editor.action.moveLinesDownAction"],
      ] as Array<[string, string]>) {
        if (!editorFocused || !matchesShortcut(event, binding) || !editorRef.current) continue;
        event.preventDefault();
        editorRef.current.trigger("keyboard", action, {});
      }
      // Navigation reads the buffer rather than changing it, so it is useful
      // from the Explorer or a tool window too.
      for (const [binding, action] of [
        [keys.gotoLine, "editor.action.gotoLine"],
        [keys.gotoDeclaration, "editor.action.revealDefinition"],
      ] as Array<[string, string]>) {
        if (!matchesShortcut(event, binding) || !editorRef.current) continue;
        event.preventDefault();
        editorRef.current.trigger("keyboard", action, {});
      }
      if (matchesShortcut(event, keys.organizeImports) && javaCommand("Imports organisieren")) {
        event.preventDefault();
        const model = editorRef.current?.getModel();
        if (model) {
          void languageProviderRef.current?.organizeImports(model).then(() => {
            toast(t("Imports organisiert"), "success");
          }).catch(() => undefined);
        }
      }
      if (matchesShortcut(event, keys.fileStructure)) {
        event.preventDefault();
        setPaletteMode("structure");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.surroundWith)) {
        event.preventDefault();
        setPaletteMode("surround");
        setPaletteQuery("");
        setPaletteOpen(true);
      }
      if (matchesShortcut(event, keys.focusMode)) {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
      if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
        if (!selectedNode || !workspaceRoot) return;
        event.preventDefault();
        const selectedRow = document.querySelector<HTMLElement>(`.tree-row[title="${CSS.escape(selectedNode.path)}"]`);
        const rect = selectedRow?.getBoundingClientRect();
        openExplorerContext(rect?.left || 72, (rect?.bottom || 120) + 2, selectedNode, workspaceRoot);
      }
      if (matchesShortcut(event, keys.generate) && !editorFocused) {
        event.preventDefault();
        createEntry(false);
      }
      // Whoever claimed the key keeps it. Monaco owns chords of its own and
      // stops them at the editor, so a listener that waited for the bubble
      // never saw Ctrl+G or F12; running first and only silencing the event
      // once a command has actually taken it leaves every other key — typing
      // included — exactly as it was.
      if (event.defaultPrevented) event.stopPropagation();
    };
    /**
     * Escape stays where it was, at the end of the chain.
     *
     * It is the one key the editor is expected to answer first: closing the
     * suggestion list, leaving a snippet, dismissing the find box. Moved in
     * front of Monaco it would dismiss the widget and close the tool window
     * behind it in the same press.
     */
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
        else if (tabContext) setTabContext(null);
        else if (activityBarMenu) setActivityBarMenu(null);
        else if (railMenu) setRailMenu(null);
        else if (projectSwitcherOpen) setProjectSwitcherOpen(false);
        else if (explorerSubmenu) setExplorerSubmenu(null);
        else if (explorerContext) setExplorerContext(null);
        else if (inputRequest) setInputRequest(null);
        else if (changeSignatureRequest) setChangeSignatureRequest(null);
        else if (javaTypeRequest) setJavaTypeRequest(null);
        else if (projectWizardOpen) setProjectWizardOpen(false);
        else if (hubCollabOpen) setHubCollabOpen(false);
        else if (runConfigOpen) setRunConfigOpen(false);
        else if (moduleDialogOpen) setModuleDialogOpen(false);
        else if (toolbarMenuOpen) setToolbarMenuOpen(false);
        else if (editorMenuOpen) setEditorMenuOpen(false);
        else if (rightToolMenuOpen) setRightToolMenuOpen(false);
        else if (gitMenuOpen) setGitMenuOpen(false);
        else if (operationsOpen) setOperationsOpen(false);
        else if (topMenu) setTopMenu(null);
        else if (activeDocument === "refactor-preview") completeRefactorPreview(false);
        else if (activeDocument === "java-refactor") { setJavaRefactorPlan(null); setActiveDocument(null); }
        else if (activeDocument) setActiveDocument(null);
        else if (panelVisible) setPanelVisible(false);
        else if (sidebarVisible) setSidebarVisible(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keydown", handleEscape);
    };
  }, [
    activeDocument,
    activeFile,
    activePath,
    closeFile,
    changeSignatureRequest,
    completeRefactorPreview,
    createEntry,
    editorMenuOpen,
    explorerContext,
    explorerSubmenu,
    getExplorerSelection,
    gitMenuOpen,
    inputRequest,
    hubCollabOpen,
    javaTypeRequest,
    moduleDialogOpen,
    openWorkspace,
    openChangeSignature,
    openExplorerContext,
    operationsOpen,
    paletteOpen,
    pasteExplorerEntry,
    panelVisible,
    projectWizardOpen,
    rightToolMenuOpen,
    runConfigOpen,
    runJava,
    renameEntry,
    saveAll,
    saveFile,
    selectedNode,
    keys,
    settings.keymap,
    sidebarVisible,
    showFindUsages,
    startDebug,
    stopJava,
    tabContext,
    toggleBreakpoint,
    toggleMemberBreakpoint,
    toolbarMenuOpen,
    topMenu,
    updateExplorerClipboard,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceRoot || !settings.restoreExplorerState) return;
    localStorage.setItem(`kiwi.explorer.expanded.v1:${workspaceRoot}`, JSON.stringify([...expanded]));
  }, [expanded, settings.restoreExplorerState, workspaceRoot]);

  useLayoutEffect(() => {
    if (!explorerContext) return;
    const menu = explorerMenuRef.current;
    if (!menu) return;

    const positionMenu = () => {
      const gutter = 8;
      const rect = menu.getBoundingClientRect();
      const left = Math.max(gutter, Math.min(explorerContext.x, window.innerWidth - rect.width - gutter));
      const top = Math.max(gutter, Math.min(explorerContext.y, window.innerHeight - rect.height - gutter));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };

    positionMenu();
    menu.focus({ preventScroll: true });
    window.addEventListener("resize", positionMenu);
    return () => window.removeEventListener("resize", positionMenu);
  }, [explorerContext]);

  useLayoutEffect(() => {
    if (!explorerContext || !explorerSubmenu) return;
    const submenu = explorerSubmenuRef.current;
    const trigger = explorerMenuRef.current?.querySelector<HTMLElement>(
      `[data-explorer-submenu="${explorerSubmenu}"]`,
    );
    if (!submenu || !trigger) return;

    const positionSubmenu = () => {
      const gutter = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const submenuRect = submenu.getBoundingClientRect();
      const opensRight = triggerRect.right + submenuRect.width - 3 <= window.innerWidth - gutter;
      const requestedLeft = opensRight
        ? triggerRect.right - 3
        : triggerRect.left - submenuRect.width + 3;
      const requestedTop = explorerSubmenu === "clipboard"
        ? triggerRect.bottom - submenuRect.height + 5
        : triggerRect.top - 5;
      const left = Math.max(gutter, Math.min(requestedLeft, window.innerWidth - submenuRect.width - gutter));
      const top = Math.max(gutter, Math.min(requestedTop, window.innerHeight - submenuRect.height - gutter));
      submenu.style.left = `${left}px`;
      submenu.style.top = `${top}px`;
    };

    positionSubmenu();
    window.addEventListener("resize", positionSubmenu);
    explorerMenuRef.current?.addEventListener("scroll", positionSubmenu);
    return () => {
      window.removeEventListener("resize", positionSubmenu);
      explorerMenuRef.current?.removeEventListener("scroll", positionSubmenu);
    };
  }, [explorerContext, explorerSubmenu]);

  useEffect(() => {
    if (!explorerContext) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (
        explorerMenuRef.current?.contains(target)
        || explorerSubmenuRef.current?.contains(target)
      )) return;
      setExplorerSubmenu(null);
      setExplorerContext(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [explorerContext]);

  useEffect(() => () => cancelExplorerSubmenuClose(), [cancelExplorerSubmenuClose]);

  useEffect(() => {
    localStorage.setItem("kiwi.fontSize", String(fontSize));
    localStorage.setItem("kiwi.minimap", String(minimap));
    localStorage.setItem("kiwi.wordWrap", String(wordWrap));
    if (window.kiwi) void window.kiwi.settings.update({ fontSize, minimap, wordWrap });
  }, [fontSize, minimap, wordWrap]);

  useEffect(() => {
    if (!settings.autoSave || !activeFile || activeFile.content === activeFile.savedContent) return;
    const timer = window.setTimeout(() => void saveFile(activeFile.path, true), 900);
    return () => window.clearTimeout(timer);
  }, [activeFile, saveFile, settings.autoSave]);

  // The session is written by the debounced writer above and flushed on
  // shutdown. A second, immediate writer used to duplicate it here: it fired on
  // every cursor movement, serialising every open buffer each time, and it
  // wrote an older field set — so it regularly overwrote the freshly saved
  // tool-window arrangement with a stale one, and a project came back with all
  // its windows at the bottom.

  useEffect(() => {
    if (!["symbols", "classes", "everywhere"].includes(paletteMode) || !workspaceRoot || !paletteQuery.trim() || !window.kiwi) {
      setSymbolResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.kiwi!.language.request(workspaceRoot, "workspace/symbol", { query: paletteQuery.trim() })
        .then((items) => setSymbolResults(Array.isArray(items) ? items.slice(0, 100) : []))
        .catch(() => setSymbolResults([]));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [paletteMode, paletteQuery, workspaceRoot]);

  useEffect(() => {
    if (workspaceRoot && breakpointHydratedRoot.current === workspaceRoot && window.kiwi) {
      void window.kiwi.debug.saveBreakpoints(workspaceRoot, breakpoints);
    }
  }, [breakpoints, workspaceRoot]);

  useEffect(() => {
    if (debugStatus !== "paused" || !watchExpression.trim() || !window.kiwi) return;
    const timer = window.setTimeout(() => {
      void window.kiwi!.debug.command("evaluate", watchExpression.trim()).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [debugStatus, watchExpression]);

  /**
   * Marks the line the debugger stopped on.
   *
   * Opening the file at the line said where it was and then left nothing
   * behind: one scroll later there was no telling which line was about to run.
   * Cleared as soon as the process resumes, because a stale mark is worse than none.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const here = debugStoppedLine
      && (!debugStoppedLine.path || samePath(debugStoppedLine.path, model.uri.fsPath || ""))
      && debugStoppedLine.line > 0
      && debugStoppedLine.line <= model.getLineCount();
    debugStoppedDecorations.current = editor.deltaDecorations(
      debugStoppedDecorations.current,
      here && debugStoppedLine
        ? [{
          range: {
            startLineNumber: debugStoppedLine.line,
            startColumn: 1,
            endLineNumber: debugStoppedLine.line,
            endColumn: 1,
          },
          options: { isWholeLine: true, className: "kiwi-debug-stopped-line" },
        }]
        : [],
    );
  }, [activePath, debugStoppedLine, settledContent]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    // Taken from the model the gutter click was made on, not from the file the
    // workbench believes is active. Those disagree for a moment on every tab
    // switch, and the click writes a breakpoint under one class name while
    // this drew them under another: Kiwi said "Breakpoint" and showed nothing.
    const modelPath = model.uri.fsPath || "";
    const modelName = basename(modelPath);
    const className = /\.java$/i.test(modelName)
      ? qualifiedJavaClassName({
        path: modelPath,
        name: modelName,
        content: model.getValue(),
        savedContent: model.getValue(),
        language: "java",
      })
      : "";
    // The class name is needed only for a breakpoint stored before paths were
    // kept. Requiring one for all of them meant that a file which did not parse
    // into a class name — which a Java file does not, for most of the time
    // somebody is typing in it — lost every mark in its gutter, including the
    // ones that knew exactly which file they belonged to.
    breakpointDecorations.current = editor.deltaDecorations(
      breakpointDecorations.current,
      modelPath
        ? breakpoints
          // Same identity as the toggle: the file when it is known, the class
          // name only for breakpoints stored before a path was kept.
          // samePath, not equality. Monaco writes the drive letter of a file
          // URI in lower case, and a breakpoint carries the path the workbench
          // knows — so "C:\…\Beta.java" and "c:\…\Beta.java" are the same file
          // and were two different ones here. The breakpoint was set, was
          // listed, and was handed to the debugger; only its mark in the
          // gutter was missing, which reads as the click not having worked.
          .filter((breakpoint) => breakpoint.type !== "exception"
            && (breakpoint.path
              ? samePath(breakpoint.path, modelPath)
              : Boolean(className) && breakpoint.className === className))
          .filter((breakpoint) => breakpoint.line > 0 && breakpoint.line <= model.getLineCount())
          .map((breakpoint) => ({
            range: {
              startLineNumber: breakpoint.line,
              startColumn: 1,
              endLineNumber: breakpoint.line,
              endColumn: 1,
            },
            options: {
              glyphMarginClassName: breakpoint.enabled === false
                ? "debug-breakpoint-glyph debug-breakpoint-glyph-disabled"
                : "debug-breakpoint-glyph",
              glyphMarginHoverMessage: {
                value: breakpoint.enabled === false
                  ? `Deaktivierter Breakpoint · Zeile ${breakpoint.line}`
                  : `Breakpoint · Zeile ${breakpoint.line}`,
              },
            },
          }))
        : [],
    );
  }, [activeFile, breakpoints]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activePath) {
      if (editor) {
        bookmarkDecorations.current = editor.deltaDecorations(bookmarkDecorations.current, []);
      }
      return;
    }
    const currentBookmarks = (workflow.bookmarks || []).filter(
      (b) => samePath(b.path, activePath) && b.line > 0 && b.line <= model.getLineCount(),
    );
    bookmarkDecorations.current = editor.deltaDecorations(
      bookmarkDecorations.current,
      currentBookmarks.map((bm) => ({
        range: {
          startLineNumber: bm.line,
          startColumn: 1,
          endLineNumber: bm.line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: "bookmark-glyph",
          glyphMarginHoverMessage: {
            value: `🔖 Lesezeichen: ${bm.label || `Zeile ${bm.line}`}`,
          },
        },
      })),
    );
  }, [activeFile, activePath, editorReady, workflow.bookmarks]);

  /**
   * Makes a `//region` read as a heading rather than a comment.
   *
   * The marker structures a file the way a heading structures a document, and
   * until now it was styled like any other comment: the same muted colour, no
   * line to follow, nothing in the gutter. A rule, the name repeated at the end
   * of the line and a colour of its own give the reader something to scan for.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const isJava = model.getLanguageId() === "java";
    const regions = isJava ? findJavaRegions(model.getValue()) : [];
    regionDecorations.current = editor.deltaDecorations(
      regionDecorations.current,
      regions.flatMap((region) => {
        const head = {
          range: { startLineNumber: region.startLine, startColumn: 1, endLineNumber: region.startLine, endColumn: 1 },
          options: {
            isWholeLine: true,
            className: "kiwi-region-line",
            linesDecorationsClassName: "kiwi-region-marker",
            after: region.name
              ? {
                content: `  ${region.name}`,
                inlineClassName: region.closed ? "kiwi-region-name" : "kiwi-region-name kiwi-region-open",
              }
              : undefined,
            hoverMessage: {
              value: region.closed
                ? `Region „${region.name || "ohne Namen"}“ · Zeilen ${region.startLine}–${region.endLine}`
                : `Region „${region.name || "ohne Namen"}“ wurde nie mit //endregion geschlossen`,
            },
          },
        };
        if (!region.closed) return [head];
        return [head, {
          range: { startLineNumber: region.endLine, startColumn: 1, endLineNumber: region.endLine, endColumn: 1 },
          options: { isWholeLine: true, className: "kiwi-region-line kiwi-region-line-end" },
        }];
      }),
    );
  }, [activeFile, editorReady]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activePath) return;
    const coverage = coverageFiles.find((file) => file.path.toLowerCase() === activePath.toLowerCase());
    coverageDecorations.current = editor.deltaDecorations(
      coverageDecorations.current,
      (coverage?.lines || []).filter((line) => line.line > 0 && line.line <= model.getLineCount()).map((line) => ({
        range: {
          startLineNumber: line.line,
          startColumn: 1,
          endLineNumber: line.line,
          endColumn: model.getLineMaxColumn(line.line),
        },
        options: {
          isWholeLine: true,
          linesDecorationsClassName: line.covered ? "coverage-line-covered" : "coverage-line-missed",
          glyphMarginClassName: line.covered ? "coverage-glyph-covered" : "coverage-glyph-missed",
          hoverMessage: {
            value: line.covered
              ? `✅ Abgedeckt · ${line.coveredInstructions} Instruktionen`
              : `❌ Nicht abgedeckt · ${line.missedInstructions} Instruktionen`,
          },
        },
      })),
    );
  }, [activePath, coverageFiles]);

  /**
   * Run icons next to test classes and methods.
   *
   * Running a single method needed the Tests tool window before, which is a
   * detour when the cursor is already inside the method. Positions come from
   * the buffer rather than the discovery on disk so unsaved edits do not push
   * the icons onto the wrong lines.
   */
  const testTargets = useMemo(
    () => (activeFile?.language === "java" && /test/i.test(activeFile.name)
      ? findJavaTestTargets(settledContent, activeFile.name)
      : []),
    [activeFile?.language, activeFile?.name, settledContent],
  );
  testTargetsRef.current = testTargets;

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const collection = editor.createDecorationsCollection(testTargets
      .filter((target) => target.line <= model.getLineCount())
      .map((target) => ({
        range: { startLineNumber: target.line, startColumn: 1, endLineNumber: target.line, endColumn: 1 },
        options: {
          glyphMarginClassName: target.kind === "class" ? "test-glyph-class" : "test-glyph-method",
          glyphMarginHoverMessage: {
            value: target.kind === "class"
              ? `▶ Alle Tests in ${target.label} ausführen`
              : `▶ ${target.label}() ausführen`,
          },
        },
      })));
    return () => collection.clear();
  }, [testTargets]);


  useEffect(() => () => {
    languageProviderRef.current?.dispose();
    polyglotProviderRef.current?.dispose();
    if (languageChangeTimer.current) window.clearTimeout(languageChangeTimer.current);
    if (outputFlushTimer.current !== null) window.clearTimeout(outputFlushTimer.current);
    if (watcherRefreshTimer.current !== null) window.clearTimeout(watcherRefreshTimer.current);
    for (const timer of projectSyncTimers.current.values()) window.clearTimeout(timer);
  }, []);

  const commands = useMemo(() => [
    { label: "Search Everywhere", detail: "Toolbar", icon: <Search size={16} />, action: () => { setPaletteMode("everywhere"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Neues Projekt", detail: "Java · Kotlin · Python · Rust · PHP · Lua · Go · C/C++/C#", icon: <Plus size={16} />, action: openNewProject },
    { label: "Projektordner öffnen", detail: "Ctrl+O", icon: <FolderOpen size={16} />, action: openWorkspace },
    { label: "Zu Klasse wechseln", detail: "Ctrl+N", icon: <Braces size={16} />, action: () => { setPaletteMode("classes"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Zu Datei wechseln", detail: "Ctrl+Shift+N", icon: <File size={16} />, action: () => { setPaletteMode("files"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Zuletzt verwendete Dateien", detail: "Ctrl+E", icon: <History size={16} />, action: () => { setPaletteMode("recent"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Zu Symbol wechseln", detail: "Ctrl+Shift+O", icon: <Braces size={16} />, action: () => { setPaletteMode("symbols"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Aktive Datei speichern", detail: "Ctrl+S", icon: <Check size={16} />, action: () => activePath && saveFile(activePath) },
    { label: "Alle Dateien speichern", detail: "Ctrl+Shift+S", icon: <Check size={16} />, action: saveAll },
    { label: "Smart Code Completion", detail: "Ctrl+Leertaste", icon: <Zap size={16} />, action: () => editorRef.current?.trigger("palette", "editor.action.triggerSuggest", {}) },
    { label: "Quick Fix und Intentionen", detail: keys.quickFix, icon: <FileCog size={16} />, action: () => editorRef.current?.trigger("palette", "editor.action.quickFix", {}) },
    { label: "Symbol umbenennen", detail: keys.rename, icon: <Pencil size={16} />, action: () => editorRef.current?.trigger("palette", "editor.action.rename", {}) },
    { label: "Abhängigkeit hinzufügen", detail: projectInfo.type, icon: <Package size={16} />, action: () => { setDependencyDialogTarget(""); setDependencyDialogOpen(true); } },
    { label: "Methode extrahieren", detail: `Java · ${keys.extractMethod}`, icon: <WandSparkles size={16} />, action: () => editorRef.current?.trigger("palette", "editor.action.codeAction", { kind: "refactor.extract.function", apply: "never" }) },
    { label: "Variable einführen", detail: `Java · ${keys.extractVariable}`, icon: <WandSparkles size={16} />, action: () => editorRef.current?.trigger("palette", "editor.action.codeAction", { kind: "refactor.extract.variable", apply: "never" }) },
    { label: "Signatur ändern", detail: `Java · ${keys.changeSignature}`, icon: <Braces size={16} />, action: () => void openChangeSignature() },
    { label: "Ungenutzten privaten Code analysieren", detail: "Java · projektweit", icon: <CircleAlert size={16} />, action: () => void analyzeUnusedPrivate(false) },
    ...SUMMONABLE_PANEL_VIEWS.map(([view, name]) => ({
      label: `Werkzeugfenster: ${name}`,
      detail: "Öffnet das Fenster an seiner Kante",
      icon: <Columns2 size={16} />,
      action: () => { setPanelVisible(true); setPanel(view); },
    })),
    { label: "Java ausführen", detail: "F5", icon: <Play size={16} />, action: () => runJava("run") },
    { label: "Java debuggen", detail: "Shift+F9", icon: <Bug size={16} />, action: startDebug },
    { label: "An laufende JVM andocken…", detail: "JDWP", icon: <Bug size={16} />, action: attachDebugger },
    { label: "Breakpoint umschalten", detail: "F9", icon: <CircleAlert size={16} />, action: toggleBreakpoint },
    {
      label: "Feld-/Methoden-Breakpoint umschalten",
      detail: "Hält an, wo das Feld geschrieben oder die Methode betreten wird",
      icon: <CircleAlert size={16} />,
      action: toggleMemberBreakpoint,
    },
    { label: "Run-Konfiguration bearbeiten", detail: "", icon: <Settings size={16} />, action: () => { setEditingRunConfig(activeRunConfiguration); setRunConfigOpen(true); } },
    { label: "Imports organisieren", detail: "Ctrl+Alt+O", icon: <ListTree size={16} />, action: () => {
      const model = editorRef.current?.getModel();
      if (model) void languageProviderRef.current?.organizeImports(model).then(() => toast(t("Imports organisiert"), "success"));
    } },
    { label: "Datei-Struktur anzeigen", detail: "Ctrl+F12", icon: <ListTree size={16} />, action: () => { setPaletteMode("structure"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Auswahl umschließen…", detail: "Ctrl+Alt+T", icon: <Code2 size={16} />, action: () => { setPaletteMode("surround"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Test am Cursor ausführen", detail: "Ctrl+Shift+F10", icon: <TestTube2 size={16} />, action: runTestAtCursor },
    { label: "Alle Probleme beheben", detail: "Datei · zeigt die Änderung vorher", icon: <WandSparkles size={16} />, action: () => void fixAllProblems() },
    { label: "Run Anything", detail: "Strg+Shift+R · Konfiguration, Task oder Terminal-Befehl", icon: <Play size={16} />, action: () => { setPaletteMode("run"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Betroffene Tests ausführen", detail: "Nur was die Änderung berühren kann", icon: <FlaskConical size={16} />, action: () => void runAffectedTests() },
    { label: "Bytecode anzeigen", detail: "javap für die offene Klasse", icon: <Binary size={16} />, action: () => void showBytecode() },
    { label: "Konstruktor generieren", detail: `Java · ${keys.generate}`, icon: <WandSparkles size={16} />, action: () => requestGenerateMembers("constructor") },
    { label: "Getter und Setter generieren", detail: `Java · ${keys.generate}`, icon: <WandSparkles size={16} />, action: () => generateMembers("accessors") },
    { label: "equals() und hashCode() generieren", detail: `Java · ${keys.generate}`, icon: <WandSparkles size={16} />, action: () => generateMembers("equalsHashCode") },
    { label: "toString() generieren", detail: `Java · ${keys.generate}`, icon: <WandSparkles size={16} />, action: () => generateMembers("toString") },
    { label: "Methoden implementieren oder überschreiben", detail: "Alt+Enter · JDT LS", icon: <FileCog size={16} />, action: () => editorRef.current?.trigger("palette", "editor.action.quickFix", {}) },
    { label: "Testklasse für aktuelle Klasse erstellen", detail: "JUnit", icon: <TestTube2 size={16} />, action: () => {
      if (!activeFile) return;
      const parent = dirname(activeFile.path);
      createJavaElement("junit", { id: parent, name: basename(parent), path: parent, type: "directory" });
    } },
    { label: "Java Scratch erstellen", detail: "Lokale Experimentierdatei", icon: <FilePlus2 size={16} />, action: createScratch },
    { label: "Aktive Datei als Favorit umschalten", detail: "", icon: <Star size={16} />, action: () => activeFile && void toggleFavorite(activeFile.path) },
    { label: "Lesezeichen umschalten", detail: "Ctrl+F11", icon: <Bookmark size={16} />, action: () => void toggleBookmark() },
    { label: "Lesezeichen anzeigen", detail: "", icon: <Bookmark size={16} />, action: () => { setPaletteMode("bookmarks"); setPaletteQuery(""); setPaletteOpen(true); } },
    { label: "Lokale Historie anzeigen", detail: "Unabhängig von Git", icon: <History size={16} />, action: () => void showLocalHistory() },
    { label: "Letzte Projektoperation rückgängig", detail: "", icon: <RotateCcw size={16} />, action: undoLastProjectOperation },
    { label: "Aktuellen Workspace benennen und speichern", detail: "", icon: <Save size={16} />, action: saveNamedWorkspace },
    { label: "Call Hierarchy", detail: "", icon: <History size={16} />, action: () => void showHierarchy("call") },
    { label: "Type Hierarchy", detail: "", icon: <Network size={16} />, action: () => void showHierarchy("type") },
    { label: "Verwendungen suchen", detail: keys.findUsages, icon: <Search size={16} />, action: () => void showFindUsages() },
    { label: "Projekt bauen", detail: "Ctrl+Shift+B", icon: <Hammer size={16} />, action: () => runJava("build") },
    { label: "Tests ausführen", detail: "", icon: <TestTube2 size={16} />, action: () => runJava("test") },
    { label: "Tests mit Abdeckung ausführen", detail: "JaCoCo", icon: <Eye size={16} />, action: runCoverage },
    { label: "Fehlgeschlagenen Test erneut ausführen", detail: "", icon: <RefreshCw size={16} />, action: () => {
      const failed = testReports.flatMap((report) => report.cases).find((test) => test.status === "failed");
      if (failed) void runTest(`${failed.className}#${failed.name}`);
      else toast("Es gibt keinen fehlgeschlagenen Test.", "info");
    } },
    { label: "Terminal-Befehl als Task speichern", detail: "", icon: <SquareTerminal size={16} />, action: saveTerminalTask },
    { label: "Fokusmodus umschalten", detail: "Ctrl+Shift+F11", icon: <Focus size={16} />, action: () => setFocusMode((value) => !value) },
    { label: "Workbench-Layout speichern", detail: "Toolfenster-Profil", icon: <Save size={16} />, action: saveWorkbenchLayout },
    {
      label: "Ansicht zurücksetzen",
      detail: "Alle Werkzeugfenster zurück nach unten, Standardgrößen, eigene Fenster wieder angedockt",
      icon: <RotateCcw size={16} />,
      action: () => resetWorkbenchViews(),
    },
    ...builtInLayouts.map((layout) => ({
      label: `Profil laden: ${layout.name}`,
      detail: "Integriertes Workbench-Profil",
      icon: <PanelBottom size={16} />,
      action: () => {
        applyWorkbenchLayout(layout);
        if (layout.id === "git-review") setActiveDocument("git-commit");
      },
    })),
    ...layoutProfiles.map((layout) => ({
      label: `Workbench-Layout laden: ${layout.name}`,
      detail: `${layout.rightToolDock === "left" ? "Links" : layout.rightToolDock === "bottom" ? "Unten" : "Rechts"} · ${layout.panel}`,
      icon: <PanelBottom size={16} />,
      action: () => applyWorkbenchLayout(layout),
    })),
    { label: "Terminal ein-/ausblenden", detail: "Ctrl+J", icon: <SquareTerminal size={16} />, action: () => setPanelVisible((value) => !value) },
    { label: "HTTP-Anfrage senden", detail: "Ctrl+Alt+R", icon: <Globe size={16} />, action: () => void sendHttpRequest() },
    { label: "Git: Vom Remote holen (fetch)", detail: "", icon: <RefreshCw size={16} />, action: async () => {
      if (!workspaceRoot || !window.kiwi) return;
      const result = await window.kiwi.git.fetch(workspaceRoot, true);
      setGitStatus(result.status);
      setGitBranches(await window.kiwi.git.branches(workspaceRoot));
      toast("Remote-Stand geholt", "success");
    } },
    { label: "Git: Änderungen der Datei verwerfen", detail: "", icon: <RotateCcw size={16} />, action: () => {
      if (!workspaceRoot || !activeFile) { toast("Öffne zuerst eine Datei.", "info"); return; }
      const name = basename(activeFile.path);
      setInputRequest({
        title: "Änderungen verwerfen",
        description: `Alle nicht committeten Änderungen an ${name} gehen verloren. Git kann das nicht zurückholen.`,
        // Typing the name is the guard: there is no undo behind this one.
        label: "Zum Bestätigen den Dateinamen eingeben",
        initialValue: "",
        confirmLabel: "Verwerfen",
        validate: (value) => value.trim() === name ? null : `Bitte „${name}“ eingeben.`,
        action: async () => {
          const result = await window.kiwi!.git.discard(workspaceRoot, [activeFile.path]);
          setGitStatus(result.status);
          setInputRequest(null);
          toast(result.removed ? "Datei entfernt" : "Änderungen verworfen", "success");
        },
      });
    } },
    { label: "Git: Commit rückgängig machen (revert)", detail: "", icon: <RotateCcw size={16} />, action: () => {
      setInputRequest({
        title: "Commit zurücknehmen",
        description: "Erzeugt einen neuen Commit, der die Änderung umkehrt",
        label: "Commit",
        initialValue: "HEAD",
        confirmLabel: "Revert",
        action: async (hash) => {
          if (!workspaceRoot || !window.kiwi) return;
          const result = await window.kiwi.git.revertCommit(workspaceRoot, hash.trim());
          setGitStatus(result.status);
          setInputRequest(null);
          toast(result.conflicted ? "Revert mit Konflikten" : "Revert erstellt", result.conflicted ? "info" : "success");
        },
      });
    } },
    { label: "Git: Commit übernehmen (cherry-pick)", detail: "", icon: <GitCommitHorizontal size={16} />, action: () => {
      setInputRequest({
        title: "Commit übernehmen",
        label: "Commit",
        initialValue: "",
        confirmLabel: "Cherry-Pick",
        action: async (hash) => {
          if (!workspaceRoot || !window.kiwi) return;
          const result = await window.kiwi.git.cherryPick(workspaceRoot, hash.trim());
          setGitStatus(result.status);
          setInputRequest(null);
          toast(result.conflicted ? "Cherry-Pick mit Konflikten" : "Commit übernommen", result.conflicted ? "info" : "success");
        },
      });
    } },
    { label: "Git: Branch löschen", detail: "", icon: <Trash2 size={16} />, action: () => {
      setInputRequest({
        title: "Branch löschen",
        description: "Nicht zusammengeführte Branches werden abgelehnt",
        label: "Branch",
        initialValue: "",
        confirmLabel: "Löschen",
        action: async (name) => {
          if (!workspaceRoot || !window.kiwi) return;
          const result = await window.kiwi.git.deleteBranch(workspaceRoot, name.trim());
          setGitBranches(result.branches);
          setInputRequest(null);
          toast(`Branch ${name.trim()} gelöscht`, "success");
        },
      });
    } },
    { label: "Git: Branch umbenennen", detail: "", icon: <GitBranch size={16} />, action: () => {
      setInputRequest({
        title: "Branch umbenennen",
        description: gitStatus.branch ? `Aktuell: ${gitStatus.branch}` : "",
        label: "Neuer Name",
        initialValue: gitStatus.branch || "",
        confirmLabel: "Umbenennen",
        action: async (name) => {
          if (!workspaceRoot || !window.kiwi || !gitStatus.branch) return;
          const result = await window.kiwi.git.renameBranch(workspaceRoot, gitStatus.branch, name.trim());
          setGitBranches(result.branches);
          setGitStatus(result.status);
          setInputRequest(null);
          toast("Branch umbenannt", "success");
        },
      });
    } },
    { label: "Seitenleiste ein-/ausblenden", detail: "Ctrl+B", icon: <PanelBottom size={16} />, action: () => setSidebarVisible((value) => !value) },
    { label: "Projekt reparieren", detail: "Index, Cache und Build-Modell neu aufbauen", icon: <WandSparkles size={16} />, action: repairProject },
    { label: "Nach Updates suchen", detail: "HTTPS-Release-Manifest", icon: <RefreshCw size={16} />, action: () => void checkForUpdates() },
    { label: "Einstellungen öffnen", detail: "Ctrl+,", icon: <Settings size={16} />, action: openSettingsDocument },
    ...(workspaceState.profiles || []).map((profile) => ({
      label: `Workspace öffnen: ${profile.name}`,
      detail: `${profile.roots.length} Projekte`,
      icon: <FolderOpen size={16} />,
      action: () => void openNamedWorkspace(profile.id),
    })),
  ], [
    activeFile,
    activePath,
    activeRunConfiguration,
    analyzeUnusedPrivate,
    applyWorkbenchLayout,
    createJavaElement,
    createScratch,
    checkForUpdates,
    duplicateRunConfiguration,
    generateMembers,
    layoutProfiles,
    openNamedWorkspace,
    openChangeSignature,
    openWorkspace,
    repairProject,
    runJava,
    runCoverage,
    runTest,
    saveAll,
    saveFile,
    saveNamedWorkspace,
    saveTerminalTask,
    saveWorkbenchLayout,
    keys.generate,
    keys.changeSignature,
    keys.extractMethod,
    keys.extractVariable,
    keys.quickFix,
    keys.rename,
    showHierarchy,
    showFindUsages,
    showLocalHistory,
    startDebug,
    testReports,
    toast,
    toggleBreakpoint,
    toggleMemberBreakpoint,
    toggleFavorite,
    undoLastProjectOperation,
    workspaceState.profiles,
  ]);

  const paletteItems = useMemo(() => {
    const commandItems = commands
      .map((command) => ({ ...command, score: fuzzyScore(command.label, paletteQuery) }))
      .filter((command) => command.score >= 0)
      .sort((a, b) => b.score - a.score);
    const symbolItems = symbolResults
      .filter((symbol) => paletteMode !== "classes" || [5, 10, 11, 23].includes(Number(symbol.kind)))
      .map((symbol) => {
        const target = symbol.location || symbol;
        const uri = target.uri || target.targetUri;
        const targetRange = target.range || target.targetSelectionRange || target.targetRange;
        return {
          label: symbol.name,
          detail: symbol.containerName || uri || "",
          icon: <Braces size={16} />,
          action: () => {
            if (!uri) return;
            const filePath = monacoRef.current?.Uri.parse(uri).fsPath || uri;
            void openFile(filePath, {
              line: (targetRange?.start?.line || 0) + 1,
              column: (targetRange?.start?.character || 0) + 1,
            });
          },
          score: fuzzyScore(`${symbol.name} ${symbol.containerName || ""}`, paletteQuery),
        };
      })
      .filter((item) => item.score >= 0);
    /**
     * Files from the index rather than from the tree.
     *
     * The tree holds only what has been expanded to, so searching it answered
     * nothing for a file five folders deep. The index holds the project. The
     * tree is still the fallback for the moment before the index has loaded.
     */
    const indexed = searchIndex(projectIndex, paletteQuery, 80);
    const fileItems = indexed.length
      ? indexed.map((match, position) => ({
          label: match.name,
          detail: match.path,
          icon: <FileTypeIcon name={match.name} size={16} />,
          // The index stores forward slashes; the workbench speaks the
          // platform's, and the two disagree on Windows.
          action: () => void openFile(joinPath(workspaceRoot, match.path)),
          // Already ordered; the palette sorts by score, so the order is the
          // score.
          score: 1000 - position,
        }))
      : allFiles
        // Whatever a build produced is not what somebody is looking for, and
        // a .class sorts before the .java it was made from.
        .filter((file) => !isBuildArtifact(file.path))
        .map((file) => ({
          label: file.name,
          detail: relativePath(workspaceRoot, file.path),
          icon: <FileTypeIcon name={file.name} size={16} />,
          action: () => openFile(file),
          score: fuzzyScore(`${file.name} ${relativePath(workspaceRoot, file.path)}`, paletteQuery),
        }))
        .filter((file) => file.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 80);
    const recentItems = workflow.recentFiles
      .map((filePath, index) => ({
        label: basename(filePath),
        detail: relativePath(workspaceRoot, filePath),
        icon: <History size={16} />,
        action: () => void openFile(filePath),
        score: Math.max(1, 100 - index) + fuzzyScore(basename(filePath), paletteQuery),
      }))
      .filter((item) => fuzzyScore(`${item.label} ${item.detail}`, paletteQuery) >= 0);
    /**
     * One list for everything that can be started.
     *
     * A run configuration lived in a dropdown, a Maven goal in the Maven tool
     * window, a Gradle task in the Gradle one, and a command in the terminal:
     * four places, and which one answers "just run the tests" depended on what
     * the project happened to use. Typing something none of them matches sends
     * it to the terminal, because that is what somebody typing an unknown word
     * into a run box means.
     */
    const runItems = orderRunTargets(
      collectRunTargets(
        {
          configurations: runConfigurations,
          tasks: projectTasks,
          buildTool: projectInfo.type,
        },
        paletteQuery,
      ),
      paletteQuery,
    ).slice(0, 60).map((target, index) => ({
      label: target.label,
      detail: target.detail,
      icon: target.kind === "shell"
        ? <SquareTerminal size={16} />
        : target.kind === "config" ? <Play size={16} /> : <Hammer size={16} />,
      action: () => {
        if (target.kind === "shell") {
          if (!workspaceRoot) return;
          setPanelVisible(true);
          setPanel("terminal");
          void window.kiwi?.terminal.execute({
            root: workspaceRoot,
            command: target.value,
            sessionId: activeTerminalId,
          });
          return;
        }
        if (target.kind === "config") {
          setActiveRunConfigId(target.value);
          void runJava("run");
          return;
        }
        void runProjectTask({ name: target.value, description: target.detail });
      },
      // The list is already in the order it should be shown in; the palette
      // sorts by score, so the score has to carry that order.
      score: 1000 - index,
    }));
    /**
     * Types and methods from the index, for the minute before the server has
     * finished starting.
     *
     * Only when the server has answered with nothing: its answer is wider —
     * inherited members, dependencies, generics — and this one is a reader
     * over the project's own files. Better than an empty list, worse than the
     * real thing, and never shown instead of it.
     */
    const indexedSymbols = symbolItems.length ? [] : searchSymbols(projectIndex, paletteQuery, {
      kinds: paletteMode === "classes" ? ["class"] : undefined,
      limit: 60,
    }).map((symbol, position) => ({
      label: symbol.name,
      detail: `${symbol.owner || basename(symbol.path)} · ${symbol.path}`,
      icon: <Braces size={16} />,
      action: () => void openFile(joinPath(workspaceRoot, symbol.path), { line: symbol.line, column: 1 }),
      score: 1000 - position,
    }));
    const bookmarkItems = (workflow.bookmarks || [])
      .map((bm) => ({
        label: bm.label || `${basename(bm.path)}:${bm.line}`,
        detail: `${relativePath(workspaceRoot, bm.path)} : ${bm.line}`,
        icon: <Bookmark size={16} />,
        action: () => void openFile(bm.path, { line: bm.line, column: 1 }),
        score: 600 + fuzzyScore(bm.label || basename(bm.path), paletteQuery),
      }))
      .filter((item) => fuzzyScore(`${item.label} ${item.detail}`, paletteQuery) >= 0);

    if (paletteMode === "run") return runItems;
    if (paletteMode === "commands") return commandItems;
    if (paletteMode === "symbols" || paletteMode === "classes") {
      return symbolItems.length ? symbolItems : indexedSymbols;
    }
    if (paletteMode === "recent") return recentItems;
    if (paletteMode === "bookmarks") return bookmarkItems;
    if (paletteMode === "structure") {
      if (!activeFile?.content) return [];
      const members = parseJavaMembers(activeFile.content);
      const items: Array<{ label: string; detail: string; icon: ReactNode; action: () => void; score: number }> = [];
      for (const t of members.types) {
        items.push({
          label: t.name,
          detail: `${t.kind} · Zeile ${t.line}`,
          icon: <Package size={16} />,
          action: () => {
            setPaletteOpen(false);
            if (editorRef.current) {
              editorRef.current.revealLineInCenter(t.line);
              editorRef.current.setPosition({ lineNumber: t.line, column: 1 });
              editorRef.current.focus();
            }
          },
          score: 1000,
        });
      }
      for (const m of members.methods) {
        items.push({
          label: m.signature || `${m.name}(...)`,
          detail: `${m.returnType ? `${m.returnType} · ` : ""}${m.visibility} · Zeile ${m.line}`,
          icon: <Code2 size={16} />,
          action: () => {
            setPaletteOpen(false);
            if (editorRef.current) {
              editorRef.current.revealLineInCenter(m.line);
              editorRef.current.setPosition({ lineNumber: m.line, column: 1 });
              editorRef.current.focus();
            }
          },
          score: 800,
        });
      }
      for (const f of members.fields) {
        items.push({
          label: `${f.name}: ${f.type}`,
          detail: `${f.isStatic ? "static · " : ""}Zeile ${f.line}`,
          icon: <Braces size={16} />,
          action: () => {
            setPaletteOpen(false);
            if (editorRef.current) {
              editorRef.current.revealLineInCenter(f.line);
              editorRef.current.setPosition({ lineNumber: f.line, column: 1 });
              editorRef.current.focus();
            }
          },
          score: 600,
        });
      }
      if (!paletteQuery.trim()) return items;
      return items.filter((item) => fuzzyScore(`${item.label} ${item.detail}`, paletteQuery) >= 0);
    }
    if (paletteMode === "surround") {
      const surroundOptions: Array<{ kind: SurroundKind; num: string; label: string; detail: string }> = [
        { kind: "if", num: "1", label: "if (true) { ... }", detail: "Bedingung" },
        { kind: "if_else", num: "2", label: "if (true) { ... } else { ... }", detail: "Verzweigung" },
        { kind: "while", num: "3", label: "while (true) { ... }", detail: "Schleife" },
        { kind: "for", num: "4", label: "for (var item : items) { ... }", detail: "Iteration" },
        { kind: "try", num: "5", label: "try { ... } catch (Exception e)", detail: "Fehlerbehandlung" },
        { kind: "try_finally", num: "6", label: "try { ... } finally", detail: "Absicherung" },
        { kind: "synchronized", num: "7", label: "synchronized (this) { ... }", detail: "Synchronisation" },
        { kind: "comment", num: "8", label: "/* ... */", detail: "Kommentar-Block" },
      ];
      return surroundOptions.map((opt) => ({
        label: `${opt.num}. ${opt.label}`,
        detail: opt.detail,
        icon: <Code2 size={16} />,
        action: () => {
          setPaletteOpen(false);
          applySurround(opt.kind);
        },
        score: 100,
      })).filter((item) => fuzzyScore(`${item.label} ${item.detail}`, paletteQuery) >= 0);
    }
    if (paletteMode === "everywhere") {
      return [...commandItems.slice(0, 20), ...fileItems.slice(0, 30),
        ...bookmarkItems.slice(0, 15),
        ...(symbolItems.length ? symbolItems : indexedSymbols).slice(0, 30)]
        .sort((left, right) => right.score - left.score)
        .slice(0, 80);
    }
    return fileItems;
  }, [activeFile, activeTerminalId, allFiles, applySurround, commands, openFile, paletteMode, paletteQuery, projectIndex, projectInfo.type,
    projectTasks, runConfigurations, runJava, runProjectTask, symbolResults, workflow.bookmarks, workflow.recentFiles, workspaceRoot]);

  const sourceChanges = gitStatus.files || [];
  const branch = gitStatus.branch || gitStatus.output.match(/^##\s+([^\s.]+)/m)?.[1] || "main";
  /*
   * What to call the open project.
   *
   * The folder's name, unless somebody gave this project a name of its own in
   * the hub. The switcher's own list showed the chosen name while the button
   * above it still read the folder's, so the two disagreed on screen.
   */
  const projectName = (() => {
    if (!workspaceRoot) return "Kein Projekt";
    const known = [...(workspaceState.resumableProjects || []), ...(workspaceState.projects || [])]
      .find((project) => sameProjectRoot(project.root, workspaceRoot));
    return known?.label || basename(workspaceRoot);
  })();
  /**
   * What Discord is told, when the card is switched on at all.
   *
   * The file's own name rather than its path: a class opened out of a JAR has
   * a `jdt://` address nobody wants read out on a card. Sent on every change
   * because the main process is what holds it to Discord's rate limit — this
   * does not need to be clever about how often it fires, and the settings
   * decide whether any of it is used.
   */
  const activeFileName = activeFile?.name || "";
  useEffect(() => {
    void window.kiwi?.presence.update({
      projectName: workspaceRoot ? projectName : "",
      fileName: activeFileName,
    });
  }, [activeFileName, projectName, workspaceRoot]);

  /**
   * The projects the switcher offers: exactly the ones the hub lists.
   *
   * It used to read the workspace list alone, so a project opened
   * yesterday and closed since was in the hub and not in the switcher.
   */
  const switcherProjects = useMemo(
    () => mergeProjectList(workspaceState, settings.recentProjects || []),
    [settings.recentProjects, workspaceState],
  );

  /*
   * Prepares the other projects in the background, one at a time.
   *
   * Everything a build needs before it can start — the project, its modules,
   * its task list — and no build at all. The answers are kept, so switching to
   * one of these finds them already there instead of waiting seven seconds for
   * Gradle to configure.
   *
   * One at a time and in the order the switcher shows them, which is pinned
   * first and most recently opened after: three Gradle configuration phases at
   * once would make the machine slower for the project somebody is actually
   * working in. The active project is skipped — the startup preload has it.
   */
  useEffect(() => {
    if (!window.kiwi || !workspaceRoot) return undefined;
    const queue = switcherProjects
      .filter((project) => project.exists && project.root !== workspaceRoot)
      .map((project) => project.root)
      .filter((root) => !preparedProjects.current.has(root));
    if (!queue.length) return undefined;

    let cancelled = false;
    const run = async () => {
      // A pause first: the workbench has just opened a project of its own, and
      // that is what the machine should be spending itself on.
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      for (const root of queue) {
        if (cancelled) return;
        preparedProjects.current.add(root);
        setProjectReadiness((current) => new Map(current).set(root, "preloading"));
        const result = await window.kiwi!.project.prepare(root).catch(() => ({ state: "error" as const }));
        if (cancelled) return;
        setProjectReadiness((current) => new Map(current).set(root, result.state));
      }
    };
    void run();
    return () => {
      // A project switch abandons the queue rather than letting it run on
      // against a workbench that has moved elsewhere.
      cancelled = true;
    };
  }, [switcherProjects, workspaceRoot]);
  /** The projects of the build, root first, each a peer of the others. */
  const buildProjects = useMemo(
    () => buildProjectNodes(moduleInfos, projectTasks, projectName),
    [moduleInfos, projectName, projectTasks],
  );
  const explorerProject = workspaceState.projects.find((project) => project.root === workspaceRoot);
  // What the Explorer speed search reads: the active project's tree as it is
  // rendered, and where the selection currently sits in it.
  treeForSpeedSearch.current = projectedTrees[workspaceRoot] || emptyTree;
  selectedNodeRef.current = selectedNode;
  const documentTitles: Record<WorkbenchDocument, { label: string; icon: ReactNode }> = {
    "git-commit": { label: "Git Commit", icon: <GitCommitHorizontal size={14} /> },
    "git-diff": { label: gitDiffSelection ? `Diff · ${basename(gitDiffSelection.file)}` : "Git Diff", icon: <FileDiff size={14} /> },
    "git-merge": { label: mergeEditor ? `Merge · ${basename(mergeEditor.path)}` : "Git Merge", icon: <GitBranch size={14} /> },
    "git-compare": { label: gitComparison ? `${gitComparison.base} ↔ ${gitComparison.head}` : "Branch-Vergleich", icon: <GitBranch size={14} /> },
    "git-rebase": { label: "Interaktives Rebase", icon: <GitBranch size={14} /> },
    "git-pull-requests": { label: "Pull Requests", icon: <Github size={14} /> },
    "refactor-preview": { label: "Refactoring-Vorschau", icon: <FileDiff size={14} /> },
    "java-refactor": { label: javaRefactorPlan?.title || "Java-Refactoring", icon: <FileDiff size={14} /> },
    "unused-private": { label: "Ungenutzter privater Code", icon: <CircleAlert size={14} /> },
    "web-preview": { label: "Live Web-Preview", icon: <Globe size={14} /> },
    "npm-packages": { label: "NPM-Pakete", icon: <Package size={14} /> },
    "database": { label: "Datenbank-Browser", icon: <Database size={14} /> },
    "docker": { label: "Docker & Container", icon: <Container size={14} /> },
    "git-graph": { label: "Git Graph", icon: <GitBranch size={14} /> },
    "scratchpad": { label: "Scratchpad", icon: <FileText size={14} /> },
  };

  const openGitChange = async (change: NonNullable<GitStatus["files"]>[number]) => {
    if (!window.kiwi || !workspaceRoot) return;
    if (change.conflict) {
      const conflict = await window.kiwi.git.conflict(workspaceRoot, change.absolutePath);
      setMergeEditor({ ...conflict, result: conflict.ours || conflict.theirs });
      setActiveDocument("git-merge");
      return;
    }
    const [diff, hunks] = await Promise.all([
      window.kiwi.git.diff(workspaceRoot, change.absolutePath, change.staged),
      window.kiwi.git.hunks(workspaceRoot, change.absolutePath, change.staged),
    ]);
    setGitDiff(diff);
    setGitLineSelection({});
    setGitDiffSelection({ file: change.absolutePath, staged: change.staged, hunks });
    setActiveDocument("git-diff");
  };

  const renderWorkbenchDocument = () => {
    if (activeDocument === "git-commit") {
      return (
        <section className="workbench-document git-commit-document">
          <header className="document-header">
            <div><GitCommitHorizontal size={18} /><span><strong>{t("Änderungen committen")}</strong><small>{branch} · {sourceChanges.length} Datei(en)</small></span></div>
            <div>
              <button onClick={() => void performGitAction("pull")}><Download size={13} /> {t("Pull")}</button>
              <button onClick={() => void performGitAction("push")}><Upload size={13} /> {t("Push")}</button>
            </div>
          </header>
          <div className="commit-document-body">
            <section className="commit-composer">
              <label>
                <span>{t("Commit-Nachricht")}</span>
                <textarea
                  autoFocus
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder={t("Was wurde geändert?")}
                />
              </label>
              <div className="commit-primary-actions">
                <button onClick={() => void performGitAction("stageAll")} disabled={!sourceChanges.length}><Plus size={13} /> {t("Alle stagen")}</button>
                <button
                  title={t("Ergänzt den letzten Commit, statt einen neuen anzulegen")}
                  disabled={!sourceChanges.length && !commitMessage.trim()}
                  onClick={() => void performGitAction("amend")}
                ><History size={13} /> {t("Ergänzen")}</button>
                <button
                  disabled={!sourceChanges.length || !commitMessage.trim()}
                  onClick={() => void performGitAction("commitAll")}
                ><Check size={13} /> {t("Alles committen")}</button>
                <button
                  className="primary-button"
                  disabled={!sourceChanges.length || !commitMessage.trim()}
                  onClick={() => void performGitAction("commitAndPush")}
                ><Upload size={14} /> {t("Commit & Push")}</button>
              </div>
            </section>
            <section className="commit-files">
              <header><span>{t("DATEIEN")}</span><b>{sourceChanges.length}</b></header>
              {sourceChanges.map((change) => (
                <div className={`commit-file-row ${change.conflict ? "conflict" : ""}`} key={change.path}>
                  <button onClick={() => void openGitChange(change)}>
                    <FileTypeIcon name={change.path} />
                    <span><strong>{basename(change.path)}</strong><small>{relativePath(workspaceRoot, change.absolutePath)}</small></span>
                    <em>{change.conflict ? "Konflikt" : change.staged ? "Staged" : "Geändert"}</em>
                  </button>
                  <button
                    title={change.staged ? t("Unstage") : t("Stage")}
                    onClick={async () => setGitStatus(change.staged
                      ? await window.kiwi!.git.unstage(workspaceRoot, [change.absolutePath])
                      : await window.kiwi!.git.stage(workspaceRoot, [change.absolutePath]))}
                  >{change.staged ? <Minus size={13} /> : <Plus size={13} />}</button>
                </div>
              ))}
              {!sourceChanges.length && <div className="document-empty"><CircleCheck size={26} /><span>{t("Arbeitsverzeichnis ist sauber.")}</span></div>}
            </section>
          </div>
          <GitCommitChecks root={workspaceRoot} compact />
        </section>
      );
    }

    if (activeDocument === "git-diff") {
      return (
        <section className="workbench-document git-diff-document">
          <header className="document-header">
            <div><FileDiff size={18} /><span><strong>{gitDiffSelection ? basename(gitDiffSelection.file) : "Git Diff"}</strong><small>{gitDiffSelection?.staged ? "Gestagte Änderungen" : "Arbeitskopie"}</small></span></div>
            <div className="document-header-actions">
              <div className="diff-mode-switch" role="group" aria-label={t("Diff-Darstellung")}>
                <button className={gitDiffMode === "split" ? "active" : ""} onClick={() => setGitDiffMode("split")}>{t("Nebeneinander")}</button>
                <button className={gitDiffMode === "inline" ? "active" : ""} onClick={() => setGitDiffMode("inline")}>{t("Inline")}</button>
              </div>
              {gitDiffSelection && (
                <button onClick={async () => {
                  if (!window.kiwi) return;
                  setGitStatus(gitDiffSelection.staged
                    ? await window.kiwi.git.unstage(workspaceRoot, [gitDiffSelection.file])
                    : await window.kiwi.git.stage(workspaceRoot, [gitDiffSelection.file]));
                  toast(gitDiffSelection.staged ? "Datei aus dem Commit entfernt" : "Datei gestagt", "success");
                }}>{gitDiffSelection.staged ? <Minus size={13} /> : <Plus size={13} />}{gitDiffSelection.staged ? " Unstage" : " Stage"}</button>
              )}
            </div>
          </header>
          {gitDiffSelection?.hunks.length ? (
            <div className="diff-hunk-bar">
              {gitDiffSelection.hunks.map((hunk) => (
                <button key={hunk.index} onClick={async () => {
                  if (!window.kiwi) return;
                  const result = await window.kiwi.git.applyHunk(workspaceRoot, gitDiffSelection.file, hunk.index, gitDiffSelection.staged);
                  setGitStatus(result.status);
                  const [diff, hunks] = await Promise.all([
                    window.kiwi.git.diff(workspaceRoot, gitDiffSelection.file, gitDiffSelection.staged),
                    window.kiwi.git.hunks(workspaceRoot, gitDiffSelection.file, gitDiffSelection.staged),
                  ]);
                  setGitDiff(diff);
                  setGitDiffSelection((current) => current ? { ...current, hunks } : null);
                }}>{gitDiffSelection.staged ? "Hunk unstage" : "Hunk stage"} · {hunk.header}</button>
              ))}
            </div>
          ) : null}
          {!gitDiffSelection?.staged && gitDiffSelection?.hunks.some((hunk) => hunk.changes.length > 0) && (
            <div className="git-inline-stage-list">
              {gitDiffSelection.hunks.filter((hunk) => hunk.changes.length > 0).map((hunk) => (
                <details key={`lines:${hunk.index}`}>
                  <summary>Einzelne Zeilen auswählen · {hunk.header}</summary>
                  {hunk.changes.map((change) => {
                    const selectionKey = String(hunk.index);
                    const checked = (gitLineSelection[selectionKey] || []).includes(change.id);
                    return (
                      <label key={change.id}>
                        <input type="checkbox" checked={checked} onChange={(event) => setGitLineSelection((current) => {
                          const selected = current[selectionKey] || [];
                          return {
                            ...current,
                            [selectionKey]: event.target.checked
                              ? [...selected, change.id]
                              : selected.filter((id) => id !== change.id),
                          };
                        })} />
                        <span>{change.before && <del>- {change.before}</del>}{change.after && <ins>+ {change.after}</ins>}</span>
                      </label>
                    );
                  })}
                  <button disabled={!(gitLineSelection[String(hunk.index)] || []).length} onClick={async () => {
                    if (!window.kiwi) return;
                    const result = await window.kiwi.git.applyLines(
                      workspaceRoot,
                      gitDiffSelection.file,
                      hunk.index,
                      gitLineSelection[String(hunk.index)] || [],
                    );
                    setGitStatus(result.status);
                    const [diff, hunks] = await Promise.all([
                      window.kiwi.git.diff(workspaceRoot, gitDiffSelection.file, false),
                      window.kiwi.git.hunks(workspaceRoot, gitDiffSelection.file, false),
                    ]);
                    setGitDiff(diff);
                    setGitDiffSelection((current) => current ? { ...current, hunks } : null);
                    setGitLineSelection((current) => ({ ...current, [String(hunk.index)]: [] }));
                    toast("Ausgewählte Zeilen gestagt", "success");
                  }}>{t("Ausgewählte Zeilen stage")}</button>
                </details>
              ))}
            </div>
          )}
          {gitDiffMode === "inline" ? (
            <pre className="document-diff">{gitDiff || "Keine Unterschiede vorhanden."}</pre>
          ) : (
            <div className="document-diff-split">
              <header><span>{t("Vorher")}</span><span>{t("Nachher")}</span></header>
              {splitUnifiedDiff(gitDiff || "Keine Unterschiede vorhanden.").map((row, index) => (
                <div className={`diff-split-row ${row.kind}`} key={index}>
                  <code>{row.left || " "}</code>
                  <code>{row.right || " "}</code>
                </div>
              ))}
            </div>
          )}
        </section>
      );
    }

    if (activeDocument === "git-compare" && gitComparison) {
      return (
        <section className="workbench-document git-compare-document">
          <header className="document-header">
            <div>
              <GitBranch size={18} />
              <span>
                <strong>{gitComparison.base} ↔ {gitComparison.head}</strong>
                <small>{gitComparison.leftOnly} nur links · {gitComparison.rightOnly} nur rechts</small>
              </span>
            </div>
            <button onClick={() => void performGitAction("pull")} disabled={!gitComparison.rightOnly}>
              <Download size={13} /> Pull
            </button>
          </header>
          <div className="git-comparison-summary">
            <section>
              <header>{t("Commits")}</header>
              {gitComparison.commits.length
                ? gitComparison.commits.map((commit) => <code key={commit}>{commit}</code>)
                : <span>{t("Keine zusätzlichen Commits auf der rechten Seite.")}</span>}
            </section>
            <section>
              <header>{t("Dateien")}</header>
              <pre>{gitComparison.stat || "Keine Dateiänderungen."}</pre>
            </section>
          </div>
          <pre className="document-diff">{gitComparison.patch || "Keine Unterschiede vorhanden."}</pre>
        </section>
      );
    }

    if (activeDocument === "git-rebase") {
      return <GitRebaseEditor
        root={workspaceRoot}
        initialUpstream={branch === "main" ? "origin/main" : "main"}
        onClose={() => setActiveDocument(null)}
        onChanged={() => void refreshGit()}
      />;
    }

    if (activeDocument === "git-pull-requests") {
      return <GitPullRequestView root={workspaceRoot} onClose={() => setActiveDocument(null)} />;
    }

    if (activeDocument === "git-merge" && mergeEditor) {
      return <GitThreeWayMergeEditor
        root={workspaceRoot}
        file={mergeEditor.path}
        onClose={() => { setMergeEditor(null); setActiveDocument(null); }}
        onResolved={() => {
          void refreshGit();
          void refreshTree();
          setMergeEditor(null);
          setActiveDocument(null);
          toast("Merge-Konflikt wurde zeilenweise aufgelöst und gestagt", "success");
        }}
      />;
    }

    if (activeDocument === "java-refactor" && javaRefactorPlan) {
      return <JavaRefactorPreview
        plan={javaRefactorPlan}
        applying={javaRefactorApplying}
        onApply={applyJavaRefactorPlan}
        onCancel={() => { setJavaRefactorPlan(null); setActiveDocument(null); }}
        onOpenLocation={(file, line, column) => void openFile(file, { line, column })}
      />;
    }

    if (activeDocument === "unused-private") {
      return <UnusedPrivatePanel
        analysis={unusedPrivateAnalysis}
        loading={unusedPrivateLoading}
        onRefresh={() => analyzeUnusedPrivate(true)}
        onClose={() => setActiveDocument(null)}
        onOpen={(file, line, column) => void openFile(file, { line, column })}
      />;
    }

    if (activeDocument === "refactor-preview" && refactorPreview) {
      return (
        <section className="workbench-document refactor-preview-document">
          <header className="document-header">
            <div>
              <FileDiff size={18} />
              <span>
                <strong>{t("Refactoring prüfen")}</strong>
                <small>{refactorPreview.items.length} Dateiänderung(en) · noch nicht angewendet</small>
              </span>
            </div>
          </header>
          <div className="refactor-preview-list">
            {refactorPreview.items.map((item, index) => (
              <details open={index === 0} key={`${item.kind}:${item.path}:${item.targetPath || ""}`}>
                <summary>
                  <span className={`refactor-kind ${item.kind}`}>
                    {item.kind === "edit" ? "M" : item.kind === "create" ? "+" : item.kind === "delete" ? "−" : "→"}
                  </span>
                  <strong>{basename(item.targetPath || item.path)}</strong>
                  <small>
                    {item.kind === "rename"
                      ? `${relativePath(workspaceRoot, item.path)} → ${relativePath(workspaceRoot, item.targetPath || item.path)}`
                      : relativePath(workspaceRoot, item.path)}
                  </small>
                </summary>
                {item.kind === "edit" ? (
                  <div className="refactor-diff-grid">
                    <div><header>{t("Vorher")}</header><pre>{item.before}</pre></div>
                    <div><header>{t("Nachher")}</header><pre>{item.after}</pre></div>
                  </div>
                ) : (
                  <div className="refactor-resource-change">
                    {item.kind === "create" && <>Neue Datei wird erstellt: <strong>{item.path}</strong></>}
                    {item.kind === "delete" && <>Datei wird gelöscht: <strong>{item.path}</strong></>}
                    {item.kind === "rename" && <>Verschieben/Umbenennen nach: <strong>{item.targetPath}</strong></>}
                  </div>
                )}
              </details>
            ))}
          </div>
          <footer className="document-footer">
            <span>{t("Alle Änderungen werden zusammen als eine Workspace-Operation angewendet.")}</span>
            <button onClick={() => completeRefactorPreview(false)}>{t("Abbrechen")}</button>
            <button className="primary-button" onClick={() => completeRefactorPreview(true)}>
              <Check size={14} /> Änderungen anwenden
            </button>
          </footer>
        </section>
      );
    }

    if (activeDocument === "web-preview") {
      return (
        <section className="workbench-document web-preview-document" style={{ height: "100%", width: "100%" }}>
          <WebPreviewPanel workspaceRoot={workspaceRoot} onClose={() => setActiveDocument(null)} />
        </section>
      );
    }

    if (activeDocument === "npm-packages") {
      return (
        <section className="workbench-document npm-packages-document" style={{ height: "100%", width: "100%" }}>
          <NpmPackageManager
            workspaceRoot={workspaceRoot}
            onClose={() => setActiveDocument(null)}
            onExecuteCommand={(cmd) => {
              void window.kiwi?.terminal?.execute({ root: workspaceRoot, command: cmd });
            }}
          />
        </section>
      );
    }

    if (activeDocument === "database") {
      return (
        <section className="workbench-document database-document" style={{ height: "100%", width: "100%" }}>
          <DatabaseBrowser workspaceRoot={workspaceRoot} onClose={() => setActiveDocument(null)} />
        </section>
      );
    }

    if (activeDocument === "docker") {
      return (
        <section className="workbench-document docker-document" style={{ height: "100%", width: "100%" }}>
          <DockerPanel
            workspaceRoot={workspaceRoot}
            onClose={() => setActiveDocument(null)}
            onExecuteInTerminal={(cmd) => {
              void window.kiwi?.terminal?.execute({ root: workspaceRoot, command: cmd });
            }}
          />
        </section>
      );
    }

    if (activeDocument === "git-graph") {
      return (
        <section className="workbench-document git-graph-document" style={{ height: "100%", width: "100%" }}>
          <GitGraphView
            workspaceRoot={workspaceRoot}
            onClose={() => setActiveDocument(null)}
          />
        </section>
      );
    }

    if (activeDocument === "scratchpad") {
      return (
        <section className="workbench-document scratchpad-document" style={{ height: "100%", width: "100%" }}>
          <ScratchpadPanel
            workspaceRoot={workspaceRoot}
            onClose={() => setActiveDocument(null)}
            onSaveAsFile={(title, content) => {
              void window.kiwi?.file.write(`${workspaceRoot}/${title}`, content).then(() => {
                toast(`Notiz als ${title} gespeichert`, "success");
              });
            }}
          />
        </section>
      );
    }

    return null;
  };

  const sidebarContent = () => {
    if (activity === "explorer") {
      return (
        <>
          <div className="sidebar-header">
            <span>{t("EXPLORER")}</span>
            {/* What is being typed to jump to a name, so the tree moving under
                the fingers is explained rather than mysterious. */}
            {speedSearch.query && <span className="tree-speed-search">{speedSearch.query}</span>}
            <div className="header-actions">
              <IconButton label="Aktualisieren" onClick={() => void refreshTree()} disabled={!workspaceRoot || treeRefreshing}><RefreshCw size={14} className={treeRefreshing ? "kiwi-spinner" : ""} /></IconButton>
            </div>
          </div>
          {explorerProject ? (
            <>
              <div
                className={`tree-view multi-root-tree ${explorerRootDragOver ? "drag-over-root" : ""}`}
                role="tree"
                aria-label={t("Projektdateien")}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = event.dataTransfer.types.some((type) =>
                    type === "application/x-kiwi-explorer-path" || type === "application/x-kiwi-explorer-paths")
                    ? "move"
                    : "copy";
                  setExplorerRootDragOver(true);
                }}
                onDragLeave={(event) => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                  setExplorerRootDragOver(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!workspaceRoot) return;
                  void handleExplorerDrop(event, {
                    id: workspaceRoot,
                    name: projectName,
                    path: workspaceRoot,
                    type: "directory",
                  });
                }}
                onContextMenu={(event) => {
                  if (!workspaceRoot) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const node: FileNode = { id: workspaceRoot, name: projectName, path: workspaceRoot, type: "directory" };
                  openExplorerContext(event.clientX, event.clientY, node, workspaceRoot);
                }}
              >
                {[explorerProject].map((project) => (
                  <section className={`workspace-project-tree ${project.root === workspaceRoot ? "active" : ""}`} key={project.root}>
                    <div
                      className={`project-heading ${explorerRootDragOver ? "drag-over" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={explorerRootOpen}
                      onClick={() => toggleProjectRoot(project.root)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleProjectRoot(project.root);
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const node: FileNode = { id: project.root, name: project.name, path: project.root, type: "directory" };
                        openExplorerContext(event.clientX, event.clientY, node, project.root);
                      }}
                    >
                      {explorerRootOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <FolderOpen size={15} className="project-root-icon" />
                      <span className="project-heading-copy">
                        <strong>{project.name}</strong>
                        <small>{project.root}</small>
                      </span>
                    </div>
                    {treeRefreshing && !(workspaceTrees[project.root] || []).length && (
                      <BusyIndicator label="Explorer wird geladen" detail="Projektstruktur wird eingelesen …" />
                    )}
                    {project.exists && explorerRootOpen && (
                      <VirtualProjectTree
                        projectRoot={project.root}
                        nodes={projectedTrees[project.root] || emptyTree}
                        expanded={expanded}
                        loadingDirectories={loadingDirectories}
                        selectedPaths={selectedPaths}
                        onToggle={handleTreeToggle}
                        onSelect={handleTreeSelect}
                        onOpen={handleTreeOpen}
                        onContextMenu={handleTreeContextMenu}
                        onDragStart={handleExplorerDragStart}
                        onDragEnd={handleTreeDragEnd}
                        onDrop={handleExplorerDrop}
                        getGitState={explorerGitState}
                        openMode={settings.explorerOpenMode}
                        indent={settings.explorerIndent}
                        rowHeight={settings.uiDensity === "comfortable" ? 28 : settings.uiDensity === "compact" ? 21 : 24}
                        moduleRoots={explorerModuleRoots}
                        hideExtensions={settings.explorerHideFileExtensions}
                      />
                    )}
                    {project.exists && explorerRootOpen && (
                      <div className="explorer-auxiliary">
                        <button onClick={() => { setRightTool("dependencies"); void refreshProjectTools(); }}>
                          <Network size={14} /><span>{t("Externe Bibliotheken")}</span>
                        </button>
                        <button onClick={createScratch}>
                          <FileCode2 size={14} /><span>{t("Scratches und Konsolen")}</span>
                        </button>
                      </div>
                    )}
                    {!project.exists && <button className="missing-project" onClick={() => void relocateWorkspaceProject(project.root)}>{t("Projekt nicht gefunden · neu zuordnen")}</button>}
                  </section>
                ))}
              </div>
              {workflow.favorites.length > 0 && (
                <>
                  <div className="outline-heading"><Star size={13} /> {t("FAVORITEN")}</div>
                  <div className="workflow-shortcuts">
                    {workflow.favorites.map((filePath) => (
                      <button key={filePath} onClick={() => void openFile(filePath)} title={filePath}>
                        <FileTypeIcon name={basename(filePath)} /><span>{basename(filePath)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="empty-sidebar">
              <FolderOpen size={30} />
              <p>{t("Du hast noch keinen Ordner geöffnet.")}</p>
              <button className="primary-button" onClick={() => void openWorkspace()}>{t("Ordner öffnen")}</button>
            </div>
          )}
        </>
      );
    }

    if (activity === "modules") {
      const selectedModule = moduleInfos.find((module) => module.id === selectedModuleId) || moduleInfos[0];
      return (
        <>
          <div className="sidebar-header">
            <span>{t("MODULES")}</span>
            <div className="header-actions">
              <IconButton label="Alle Module bauen" onClick={() => void runJava("build")} disabled={!workspaceRoot || running}><Hammer size={14} /></IconButton>
              <IconButton label="Modul hinzufügen" onClick={() => setModuleDialogOpen(true)} disabled={!workspaceRoot}><Plus size={15} /></IconButton>
              <IconButton label="Neu erkennen" onClick={() => {
                if (!workspaceRoot || !window.kiwi) return;
                void window.kiwi.modules.list(workspaceRoot).then(setModuleInfos);
              }} disabled={!workspaceRoot}><RefreshCw size={14} /></IconButton>
            </div>
          </div>
          {!moduleInfos.length ? (
            <div className="empty-sidebar"><Blocks size={29} /><p>{t("Keine Module erkannt.")}</p><button className="primary-button" onClick={() => setModuleDialogOpen(true)}>{t("Modul erstellen")}</button></div>
          ) : (
            <div className="modules-view">
              <div className="module-list">
                {moduleInfos.map((module) => (
                  <div className={`module-row ${selectedModule?.id === module.id ? "active" : ""}`} key={module.id}>
                    <button onClick={() => setSelectedModuleId(module.id)}>
                      <Blocks size={14} /><span><strong>{module.name}</strong><small>{module.buildSystem} · {module.relativePath || "."}</small></span>
                    </button>
                    <IconButton
                      label={`${module.name} bauen`}
                      onClick={() => void runJava("build", module.id)}
                      disabled={running}
                    ><Hammer size={13} /></IconButton>
                  </div>
                ))}
              </div>
              {selectedModule && (
                <div className="module-details">
                  <label className="module-setting"><span>{t("SDK")}</span><button onClick={() => {
                    setInputRequest({
                      title: `SDK für ${selectedModule.name}`,
                      description: "Überschreibt das Project SDK ausschließlich für dieses Modul.",
                      label: "JDK-Pfad",
                      initialValue: selectedModule.jdkPath,
                      confirmLabel: "Übernehmen",
                      action: async (jdkPath) => {
                        if (!window.kiwi || !workspaceRoot) return;
                        const updated = await window.kiwi.modules.updateSettings(workspaceRoot, selectedModule.id, { jdkPath });
                        setModuleInfos((items) => items.map((item) => item.id === updated.id ? updated : item));
                        setInputRequest(null);
                      },
                    });
                  }}>{selectedModule.jdkPath || projectInfo.projectJdkPath || "Project SDK"}</button></label>
                  <label className="module-setting"><span>{t("Language Level")}</span>
                    <select value={selectedModule.languageLevel} onChange={async (event) => {
                      if (!window.kiwi || !workspaceRoot) return;
                      const updated = await window.kiwi.modules.updateSettings(workspaceRoot, selectedModule.id, { languageLevel: event.target.value });
                      setModuleInfos((items) => items.map((item) => item.id === updated.id ? updated : item));
                    }}>
                      <option value="">{t("Vom Projekt erben")}</option>
                      {JAVA_LANGUAGE_LEVELS.map((version) => <option key={version} value={version}>Java {version}</option>)}
                    </select>
                  </label>
                  <div><span>{t("Source Roots")}</span><strong>{selectedModule.sourceRoots.length}</strong></div>
                  <div><span>{t("Dependencies")}</span><strong>{selectedModule.dependencies.length}</strong></div>
                  <div><span>{t("JPMS")}</span><strong>{selectedModule.jpms?.name || "Kein Descriptor"}</strong></div>
                  {selectedModule.jpms && (
                    <div className="jpms-summary">
                      <code>module {selectedModule.jpms.name}</code>
                      {selectedModule.jpms.requires.map((name) => <small key={name}>requires {name}</small>)}
                      {selectedModule.jpms.exports.map((name) => <small key={name}>exports {name}</small>)}
                    </div>
                  )}
                  <button className="secondary-button" onClick={() => {
                    setInputRequest({
                      title: "Modul-Verknüpfung lösen",
                      description: "Quellen werden nicht gelöscht. Gib zur Bestätigung den Modulnamen ein.",
                      label: `Bestätigung: ${selectedModule.name}`,
                      validate: (value) => value === selectedModule.name ? null : "Der Modulname stimmt nicht überein.",
                      confirmLabel: "Verknüpfung lösen",
                      action: async () => {
                        if (!window.kiwi || !workspaceRoot) return;
                        const plan = await window.kiwi.modules.previewRemove(workspaceRoot, selectedModule.id);
                        await window.kiwi.modules.applyPlan(workspaceRoot, plan.id);
                        setModuleInfos(await window.kiwi.modules.list(workspaceRoot));
                        setInputRequest(null);
                        toast("Modul wurde aus dem Build gelöst; Quellen bleiben erhalten.", "success");
                      },
                    });
                  }}>{t("Verknüpfung lösen")}</button>
                </div>
              )}
            </div>
          )}
        </>
      );
    }

    if (activity === "search") {
      return (
        <>
          <div className="sidebar-header"><span>{t("SUCHE")}</span></div>
          <form className="search-form" onSubmit={(event) => { event.preventDefault(); void performSearch(); }}>
            <div className="search-input-wrap">
              <Search size={14} />
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("Im Projekt suchen")}
              />
            </div>
            <button type="submit" className="search-submit" disabled={!workspaceRoot || searching}>
              {searching ? <RefreshCw size={14} className="spin" /> : <ChevronRight size={15} />}
            </button>
          </form>
          <div className="replace-toggle-row">
            <button className={replaceMode ? "active" : ""} onClick={() => setReplaceMode((value) => !value)}>{t("Replace")}</button>
            <button
              className={searchOptions.caseSensitive ? "active" : ""}
              title={t("Groß-/Kleinschreibung beachten")}
              aria-pressed={Boolean(searchOptions.caseSensitive)}
              onClick={() => setSearchOptions((value) => ({ ...value, caseSensitive: !value.caseSensitive }))}
            >{t("Aa")}</button>
            <button
              className={searchOptions.wholeWord ? "active" : ""}
              title={t("Nur ganze Wörter")}
              aria-pressed={Boolean(searchOptions.wholeWord)}
              onClick={() => setSearchOptions((value) => ({ ...value, wholeWord: !value.wholeWord }))}
            >|ab|</button>
            <button
              className={searchOptions.regex ? "active" : ""}
              title={t("Regulärer Ausdruck")}
              aria-pressed={Boolean(searchOptions.regex)}
              onClick={() => setSearchOptions((value) => ({ ...value, regex: !value.regex }))}
            >.*</button>
            {replaceMode && <button onClick={() => void replaceAllMatches()} disabled={!searchResults.length}>{t("Alle ersetzen")}</button>}
          </div>
          {searchError && <div className="result-summary search-error">{searchError}</div>}
          {replaceMode && <div className="replace-input"><input value={replaceValue} onChange={(event) => setReplaceValue(event.target.value)} placeholder={t("Ersetzen durch")} /></div>}
          <div className="result-summary">
            {searchResults.length ? `${searchResults.length} Treffer` : searchQuery ? "Keine Treffer" : "Textsuche im gesamten Projekt"}
          </div>
          <div className="search-results">
            {searchResults.map((match, index) => (
              <button
                className="search-result"
                key={`${match.path}:${match.line}:${index}`}
                onClick={() => void openFile(match.path, { line: match.line, column: match.column })}
              >
                <div><FileTypeIcon name={match.path} size={14} /><strong>{basename(match.path)}</strong><span>:{match.line}</span></div>
                <code>{match.preview}</code>
                {match.replacement !== undefined && <code className="replacement-preview">→ {match.replacement}</code>}
                <small>{relativePath(workspaceRoot, dirname(match.path))}</small>
              </button>
            ))}
          </div>
        </>
      );
    }

    if (activity === "structure") {
      const symbols = activeFile?.language === "java"
        ? [...activeFile.content.matchAll(/\b(class|interface|enum|record|void|public|private|protected)\s+([A-Za-z_$][\w$]*)\s*(?:\([^)]*\))?/g)]
        : [];
      return (
        <>
          <div className="sidebar-header">
            <span>{t("STRUCTURE")}</span>
            <div className="header-actions">
              <IconButton label="Framework-Struktur aktualisieren" onClick={() => workspaceRoot && void window.kiwi?.project.frameworkInfo(workspaceRoot).then(setFrameworkInfo)}><RefreshCw size={13} /></IconButton>
            </div>
          </div>
          <div className="structure-file">{activeFile ? <><FileTypeIcon name={activeFile.name} /><strong>{activeFile.name}</strong></> : "Keine Datei ausgewählt"}</div>
          <div className="structure-list">
            {symbols.map((symbol, index) => (
              <button key={`${symbol.index}:${index}`} onClick={() => {
                const line = activeFile!.content.slice(0, symbol.index).split(/\r?\n/).length;
                editorRef.current?.setPosition({ lineNumber: line, column: 1 });
                editorRef.current?.revealLineInCenter(line, revealMotionRef.current);
              }}>
                {symbol[1] === "class" || symbol[1] === "interface" ? <Braces size={14} /> : <CircleCheck size={13} />}
                <span>{symbol[2]}</span><small>{symbol[1]}</small>
              </button>
            ))}
          </div>
          {frameworkInfo.frameworks.length > 0 && (
            <div className="framework-symbols">
              <header><Network size={12} /> {t("FRAMEWORKS")} <small>{frameworkInfo.frameworks.join(" · ")}</small></header>
              {frameworkInfo.symbols.map((symbol, index) => (
                <div className={`framework-symbol ${symbol.kind}`} key={`${symbol.path}:${symbol.line}:${index}`}>
                  <button onClick={() => void openFile(symbol.path, { line: symbol.line, column: 1 })}>
                    {symbol.kind === "endpoint" ? <Network size={12} /> : symbol.kind === "fxml" ? <FileCode2 size={12} /> : <Braces size={12} />}
                    <span><strong>{symbol.name}</strong><small>{symbol.detail}</small></span>
                  </button>
                  {symbol.targetPath && <button title={t("Controller öffnen")} onClick={() => void openFile(symbol.targetPath!)}><ChevronRight size={12} /></button>}
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    if (activity === "hierarchy") {
      return (
        <JavaNavigationPanel
          model={javaNavigation}
          loading={javaNavigationLoading}
          error={javaNavigationError}
          projectRoot={workspaceRoot}
          modules={moduleInfos}
          activeModuleId={activeModule?.id}
          onRefresh={refreshJavaNavigation}
          onLoadChildren={loadHierarchyChildren}
          onNavigate={(path, line, column, endLine, endColumn) => {
            void openFile(path, { line, column, endLine, endColumn });
          }}
        />
      );
    }

    if (activity === "build") {
      return (
        <>
          <div className="sidebar-header">
            <span>{projectInfo.type === "Maven" ? "MAVEN" : "GRADLE"}</span>
          </div>
          {renderBuildTool()}
        </>
      );
    }

    if (activity === "tests") {
      return (
        <>
          <div className="sidebar-header">
            <span>{t("TESTS")}</span>
            <div className="header-actions">
              <IconButton label="Alle Tests ausführen" onClick={() => void runTest()} disabled={!testSuites.length}><Play size={14} /></IconButton>
              <IconButton label="Tests mit Abdeckung" onClick={() => void runCoverage()} disabled={!testSuites.length || projectInfo.type === "Java"}><Eye size={14} /></IconButton>
              <IconButton label="Aktualisieren" onClick={() => workspaceRoot && void window.kiwi?.tests.discover(workspaceRoot).then(setTestSuites)}><RefreshCw size={14} /></IconButton>
            </div>
          </div>
          <div className="test-tree">
            {testSuites.length === 0 && <div className="empty-sidebar"><TestTube2 size={28} /><p>{t("Keine JUnit-Tests gefunden.")}</p></div>}
            {[...new Set(testSuites.map((suite) => suite.moduleId || "project"))].map((moduleId) => (
              <section className="test-module-group" key={moduleId}>
                <header><Blocks size={12} /> {moduleInfos.find((module) => module.id === moduleId)?.name || projectName}</header>
                {[...new Set(testSuites.filter((suite) => (suite.moduleId || "project") === moduleId).map((suite) => suite.packageName || "(default)"))].map((packageName) => (
                  <div className="test-package-group" key={`${moduleId}:${packageName}`}>
                    <div className="test-package-heading"><Package size={12} /> {packageName}</div>
                    {testSuites.filter((suite) => (suite.moduleId || "project") === moduleId && (suite.packageName || "(default)") === packageName).map((suite) => (
                      <div className="test-suite" key={suite.id}>
                        <button onClick={() => void runTest(suite.id)}><TestTube2 size={14} /><strong>{suite.name}</strong>{suite.nested && <small>{t("Nested")}</small>}<Play size={12} /></button>
                        {suite.methods.map((method) => (
                          <button className="test-method" key={method.id} onClick={() => void runTest(method.id)}>
                            <CircleCheck size={12} />
                            <span>{method.displayName || method.name}</span>
                            {method.kind && method.kind !== "test" && <small>{method.kind}</small>}
                            <Play size={11} />
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
          {(flakyTests.length > 0 || testHistory.length > 0) && (
            <div className="test-history-sidebar">
              {flakyTests.length > 0 && (
                <details open>
                  <summary><CircleAlert size={12} /> {t("Instabile Tests")} <b>{flakyTests.length}</b></summary>
                  {flakyTests.slice(0, 8).map((test) => (
                    <button key={test.id} onClick={() => void runTest(test.id)}>
                      <span><strong>{test.name}</strong><small>{test.className}</small></span>
                      <em>{test.failures}× fehlgeschlagen · {test.passes}× bestanden</em>
                    </button>
                  ))}
                </details>
              )}
              {testHistory.length > 0 && (
                <details>
                  <summary><History size={12} /> {t("Testhistorie")} <b>{testHistory.length}</b></summary>
                  {testHistory.slice(0, 8).map((run) => (
                    <div className="test-history-run" key={run.id}>
                      <CircleCheck size={12} />
                      <span><strong>{new Date(run.timestamp).toLocaleString()}</strong><small>{run.duration.toFixed(2)} s</small></span>
                      <em>{run.passed}/{run.total}</em>
                    </div>
                  ))}
                </details>
              )}
            </div>
          )}
        </>
      );
    }

    if (activity === "source") {
      return (
        <>
          <div className="github-account">
            {githubSession?.signedIn ? (
              <>
                <Github size={14} />
                <span><strong>{githubSession.login}</strong><small>{githubSession.scopes.join(", ") || "keine Scopes"}</small></span>
                <button onClick={() => void signOutOfGitHub()}>{t("Abmelden")}</button>
              </>
            ) : (
              <>
                <Github size={14} />
                <span><strong>{t("Nicht bei GitHub angemeldet")}</strong><small>{t("Für Push und Pull auf private Repositories nötig.")}</small></span>
                <button className="primary-button" onClick={() => setGithubSignInOpen(true)}>{t("Anmelden")}</button>
              </>
            )}
          </div>
          <div className="sidebar-header">
            <span>{t("SOURCE CONTROL")}</span>
            <div className="header-actions">
              <IconButton label="Commit im Editor öffnen" onClick={() => setActiveDocument("git-commit")}><GitCommitHorizontal size={14} /></IconButton>
              <IconButton label="Aktualisieren" onClick={() => void refreshGit()}><RefreshCw size={14} /></IconButton>
              <IconButton label="Weitere Aktionen" active={gitMenuOpen} onClick={() => {
                setGitMenuOpen((value) => !value);
                if (!gitMenuOpen && workspaceRoot) void window.kiwi?.git.stashes(workspaceRoot).then(setGitStashes);
              }}><Ellipsis size={15} /></IconButton>
            </div>
            {gitMenuOpen && (
              <div className="git-hamburger-menu" role="menu">
                <button onClick={() => {
                  setInputRequest({
                    title: "Änderungen stagen (Stash)",
                    label: "Beschreibung",
                    initialValue: `Kiwi ${new Date().toLocaleString()}`,
                    confirmLabel: "Stash erstellen",
                    action: async (message) => {
                      if (!workspaceRoot || !window.kiwi) return;
                      const result = await window.kiwi.git.stashSave(workspaceRoot, message, true);
                      setGitStatus(result.status);
                      setGitStashes(result.stashes);
                      setInputRequest(null);
                      toast("Änderungen wurden gestasht", "success");
                    },
                  });
                  setGitMenuOpen(false);
                }}><Save size={13} /><span>{t("Änderungen stashen…")}</span></button>
                {gitStashes.map((stash) => (
                  <div className="git-stash-menu-item" key={stash.ref}>
                    <button title={stash.message} onClick={async () => {
                      if (!workspaceRoot || !window.kiwi) return;
                      const result = await window.kiwi.git.stashApply(workspaceRoot, stash.ref, true);
                      setGitStatus(result.status);
                      setGitStashes(result.stashes);
                      setGitMenuOpen(false);
                    }}><RotateCcw size={12} /><span>{stash.ref} · {stash.message}</span></button>
                    <button title={t("Stash löschen")} onClick={async () => {
                      if (!workspaceRoot || !window.kiwi) return;
                      const result = await window.kiwi.git.stashDrop(workspaceRoot, stash.ref);
                      setGitStashes(result.stashes);
                    }}><Trash2 size={11} /></button>
                  </div>
                ))}
                <div className="context-separator" />
                <button disabled={!activeFile} onClick={async () => {
                  if (!workspaceRoot || !activeFile || !window.kiwi) return;
                  const history = await window.kiwi.git.fileHistory(workspaceRoot, activeFile.path);
                  const text = history.map((commit) => `${commit.shortHash}  ${commit.date}  ${commit.author}  ${commit.subject}`).join("\n");
                  replaceBuildOutput(text || "Keine Datei-Historie vorhanden.");
                  setPanel("build");
                  setPanelVisible(true);
                  setGitMenuOpen(false);
                }}><History size={13} /><span>{t("Datei-Historie")}</span></button>
                <button disabled={!activeFile} onClick={async () => {
                  if (!workspaceRoot || !activeFile || !window.kiwi) return;
                  const blame = await window.kiwi.git.blame(workspaceRoot, activeFile.path);
                  const text = blame.map((line) => `${String(line.line).padStart(4)} ${line.hash.slice(0, 8)} ${line.author.padEnd(18).slice(0, 18)} ${line.text}`).join("\n");
                  replaceBuildOutput(text || "Keine Blame-Daten vorhanden.");
                  setPanel("build");
                  setPanelVisible(true);
                  setGitMenuOpen(false);
                }}><GitCommitHorizontal size={13} /><span>{t("Annotate / Blame")}</span></button>
                <button onClick={() => { setActiveDocument("git-graph"); setGitMenuOpen(false); }}>
                  <GitBranch size={13} /><span>{t("Visueller Commit-Graph")}</span>
                </button>
                <button onClick={() => { setActiveDocument("git-pull-requests"); setGitMenuOpen(false); }}>
                  <Github size={13} /><span>{t("Pull Requests")}</span>
                </button>
                <button onClick={() => void openPullPreview()}>
                  <Download size={13} /><span>{t("Eingehende Änderungen prüfen")}</span>
                </button>
                <button onClick={() => {
                  setInputRequest({
                    title: "Branches vergleichen",
                    description: `Vergleicht einen Basis-Branch mit ${branch}, ohne Dateien zu verändern.`,
                    label: "Basis-Branch",
                    initialValue: branch === "main" ? "origin/main" : "main",
                    confirmLabel: "Vergleichen",
                    action: async (base) => {
                      if (!workspaceRoot || !window.kiwi) return;
                      const comparison = await window.kiwi.git.compare(workspaceRoot, base, branch);
                      setGitComparison(comparison);
                      setActiveDocument("git-compare");
                      setInputRequest(null);
                    },
                  });
                  setGitMenuOpen(false);
                }}><Columns2 size={13} /><span>{t("Branch vergleichen…")}</span></button>
                <button onClick={() => { setActiveDocument("git-rebase"); setGitMenuOpen(false); }}><GitBranch size={13} /><span>{t("Interaktives Rebase…")}</span></button>
                <div className="context-separator" />
                <button onClick={async () => {
                  if (!workspaceRoot || !window.kiwi) return;
                  setGitMenuOpen(false);
                  try {
                    const result = await window.kiwi.git.fetch(workspaceRoot, true);
                    setGitStatus(result.status);
                    setGitBranches(await window.kiwi.git.branches(workspaceRoot));
                    replaceBuildOutput(result.output || "Remote-Referenzen sind aktuell.");
                    toast("Remote-Stand geholt", "success");
                  } catch (error) {
                    toast(error instanceof Error ? error.message : "Fetch fehlgeschlagen.", "error");
                  }
                }}><RefreshCw size={13} /><span>{t("Vom Remote holen (fetch)")}</span></button>
                <button onClick={() => {
                  setInputRequest({
                    title: "Branch mergen",
                    description: `In ${gitStatus.branch || "den aktuellen Branch"} zusammenführen`,
                    label: "Branch",
                    initialValue: gitBranches.find((branch) => !branch.current)?.name || "",
                    confirmLabel: "Mergen",
                    action: async (name) => {
                      if (!workspaceRoot || !window.kiwi) return;
                      const result = await window.kiwi.git.merge(workspaceRoot, name.trim());
                      setGitStatus(result.status);
                      replaceBuildOutput(result.output);
                      setInputRequest(null);
                      // A conflict is where the merge editor takes over, so it is
                      // reported as the next step rather than as a failure.
                      toast(result.conflicted
                        ? "Merge mit Konflikten — im Source-Control-Fenster auflösen"
                        : "Merge abgeschlossen", result.conflicted ? "info" : "success");
                    },
                  });
                  setGitMenuOpen(false);
                }}><GitBranch size={13} /><span>{t("Branch mergen…")}</span></button>
                <button onClick={async () => {
                  if (!workspaceRoot || !window.kiwi) return;
                  setGitMenuOpen(false);
                  try {
                    const result = await window.kiwi.git.mergeAbort(workspaceRoot);
                    setGitStatus(result.status);
                    toast("Merge abgebrochen", "success");
                  } catch (error) {
                    toast(error instanceof Error ? error.message : "Kein Merge im Gange.", "error");
                  }
                }}><X size={13} /><span>{t("Merge abbrechen")}</span></button>
                <button onClick={() => {
                  setInputRequest({
                    title: "Tag erstellen",
                    description: "Zeigt auf den aktuellen Commit",
                    label: "Name",
                    initialValue: "v1.0.0",
                    confirmLabel: "Tag setzen",
                    action: async (name) => {
                      if (!workspaceRoot || !window.kiwi) return;
                      await window.kiwi.git.createTag(workspaceRoot, name.trim(), { message: name.trim() });
                      setInputRequest(null);
                      toast(`Tag ${name.trim()} erstellt`, "success");
                    },
                  });
                  setGitMenuOpen(false);
                }}><GitCommitHorizontal size={13} /><span>{t("Tag erstellen…")}</span></button>
                <div className="git-rebase-actions">
                  {(["continue", "skip", "abort"] as const).map((action) => <button key={action} onClick={async () => {
                    if (!workspaceRoot || !window.kiwi) return;
                    const result = await window.kiwi.git.rebase(workspaceRoot, action);
                    setGitStatus(result.status);
                    replaceBuildOutput(result.output);
                    setGitMenuOpen(false);
                  }}>{action}</button>)}
                </div>
              </div>
            )}
          </div>
          <div className="source-branch">
            <GitBranch size={15} />
            <select
              value={branch}
              disabled={!gitStatus.available}
              onChange={async (event) => {
                if (!workspaceRoot || !window.kiwi) return;
                setGitStatus(await window.kiwi.git.checkout(workspaceRoot, event.target.value));
                toast(`Zu ${event.target.value} gewechselt`, "success");
              }}
            >
              {gitBranches.length ? gitBranches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>) : <option>{branch}</option>}
            </select>
            <button title={t("Neuer Branch")} onClick={() => void createGitBranch()} disabled={!gitStatus.available}><Plus size={13} /></button>
          </div>
          {!gitStatus.available ? (
            <div className="empty-sidebar"><GitBranch size={28} /><p>{t("Dieser Ordner ist noch kein Git-Repository.")}</p><button className="primary-button" onClick={() => void performGitAction("init")}>{t("Repository erstellen")}</button></div>
          ) : (
            <>
              <div className="source-message">
                <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t("Commit-Nachricht")} aria-label={t("Commit-Nachricht")} />
                <button
                  title={sourceChanges.some((file) => file.staged) ? t("Commit") : t("Für einen Commit zuerst Änderungen stagen")}
                  disabled={!sourceChanges.some((file) => file.staged) || !commitMessage.trim()}
                  onClick={() => void performGitAction("commit")}
                ><Check size={15} /></button>
              </div>
              {!sourceChanges.some((file) => file.staged) && (
                <div className="commit-check"><CircleAlert size={12} /> {t("Keine gestagten Änderungen")}</div>
              )}
              <div className="git-actions">
                <button onClick={() => void performGitAction("stageAll")}><Plus size={12} /> {t("Stage all")}</button>
                <button onClick={() => void performGitAction("pull")}><Download size={12} /> {t("Pull")}</button>
                <button onClick={() => void performGitAction("push")}><Upload size={12} /> {t("Push")}</button>
              </div>
              <div className="changes-heading"><ChevronDown size={13} /> {t("ÄNDERUNGEN")} <span>{sourceChanges.length}</span></div>
              <div className="changes-list">
                {sourceChanges.map((change) => (
                  <div key={change.path} className={`change-row ${change.conflict ? "conflict" : ""}`}>
                    <button className="change-file" onClick={async () => {
                      await openGitChange(change);
                    }}>
                      <FileTypeIcon name={change.path} /><span>{basename(change.path)}</span><small>{change.conflict ? "!" : `${change.index}${change.workingTree}`.trim() || "M"}</small>
                    </button>
                    <button
                      className="change-stage"
                      title={change.staged ? t("Unstage") : t("Stage")}
                      onClick={async () => setGitStatus(change.staged
                        ? await window.kiwi!.git.unstage(workspaceRoot, [change.absolutePath])
                        : await window.kiwi!.git.stage(workspaceRoot, [change.absolutePath]))}
                    >
                      {change.staged ? <Minus size={12} /> : <Plus size={12} />}
                    </button>
                  </div>
                ))}
              </div>
              <div className="changes-heading"><ChevronDown size={13} /> {t("HISTORY")} <span>{gitHistory.length}</span></div>
              <div className="git-history">
                {gitHistory.slice(0, 8).map((commit) => <div key={commit.shortHash}><GitCommitHorizontal size={12} /><span><strong>{commit.subject}</strong><small>{commit.shortHash} · {commit.author}</small></span></div>)}
              </div>
            </>
          )}
        </>
      );
    }

    if (activity === "run") {
      return (
        <>
          <div className="sidebar-header"><span>{t("RUN AND DEBUG")}</span></div>
          <div className="run-card">
            <div className="run-card-title"><span className="java-logo">J</span><div><strong>{t("Java Application")}</strong><small>{runnableFile?.name || projectName}</small></div></div>
            <button className="primary-button run-main" onClick={() => void runJava("run")} disabled={!workspaceRoot || running}>
              <Play size={15} fill="currentColor" /> Run
            </button>
            <button className="secondary-button debug-main" onClick={() => void startDebug()} disabled={!workspaceRoot || debugStatus !== "stopped"}>
              <Bug size={14} /> Debug
            </button>
            <button className="secondary-button" onClick={() => void runJava("build")} disabled={!workspaceRoot || running}>
              <Hammer size={14} /> Build project
            </button>
            <button className="secondary-button" onClick={() => void runJava("test")} disabled={!workspaceRoot || running}>
              <TestTube2 size={14} /> Run tests
            </button>
            {running && <button className="stop-button" onClick={() => void stopJava()}><Square size={13} fill="currentColor" /> {t("Stop process")}</button>}
          </div>
          <div className="run-section"><ChevronDown size={13} /> {t("BREAKPOINTS")}</div>
          <div className="breakpoint-list">
            {breakpoints.map((breakpoint, index) => (
              <div className="breakpoint-editor" key={`${breakpoint.type || "line"}:${breakpoint.className}:${breakpoint.fieldName || breakpoint.methodName || breakpoint.line}:${index}`}>
                <label className="breakpoint-row">
                  <input
                    type="checkbox"
                    checked={breakpoint.enabled !== false}
                    onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, enabled: event.target.checked } : item,
                    ))}
                    aria-label={t("Breakpoint aktiv")}
                  />
                  <CircleAlert size={13} />
                  <span>{describeBreakpoint(breakpoint)}</span>
                  <button onClick={() => setBreakpoints((items) => items.filter((_item, itemIndex) => itemIndex !== index))} aria-label={t("Breakpoint entfernen")}><X size={12} /></button>
                </label>
                {breakpoint.type === "field" ? (
                  <div className="exception-options">
                    <label><input type="checkbox" checked={breakpoint.onWrite !== false} onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, onWrite: event.target.checked } : item))} /> {t("beim Schreiben")}</label>
                    <label><input type="checkbox" checked={breakpoint.onRead === true} onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, onRead: event.target.checked } : item))} /> {t("beim Lesen")}</label>
                  </div>
                ) : breakpoint.type === "method" ? (
                  <div className="exception-options">
                    <label><input type="checkbox" checked={breakpoint.onEntry !== false} onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, onEntry: event.target.checked } : item))} /> {t("beim Eintritt")}</label>
                    <label><input type="checkbox" checked={breakpoint.onExit === true} onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, onExit: event.target.checked } : item))} /> {t("beim Austritt")}</label>
                  </div>
                ) : breakpoint.type === "exception" ? (
                  <div className="exception-options">
                    <label><input type="checkbox" checked={breakpoint.caught !== false} onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, caught: event.target.checked } : item))} /> {t("caught")}</label>
                    <label><input type="checkbox" checked={breakpoint.uncaught !== false} onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, uncaught: event.target.checked } : item))} /> {t("uncaught")}</label>
                  </div>
                ) : (
                  <div className="breakpoint-options">
                    <input
                      className="breakpoint-condition"
                      value={breakpoint.condition || ""}
                      onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, condition: event.target.value } : item,
                      ))}
                      placeholder={t("Bedingung, z. B. count > 5")}
                      aria-label={t("Breakpoint-Bedingung")}
                    />
                    <input
                      className="breakpoint-condition"
                      value={breakpoint.hitCondition || ""}
                      onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, hitCondition: event.target.value } : item,
                      ))}
                      placeholder={t("Treffer, z. B. 5, >=10 oder %3")}
                      aria-label={t("Breakpoint-Trefferanzahl")}
                    />
                    <input
                      className="breakpoint-condition"
                      value={breakpoint.logMessage || ""}
                      onChange={(event) => setBreakpoints((items) => items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, logMessage: event.target.value } : item,
                      ))}
                      placeholder={t("Logpoint, z. B. count = {count}")}
                      aria-label={t("Logpoint-Nachricht")}
                    />
                  </div>
                )}
              </div>
            ))}
            <button className="add-exception-breakpoint" onClick={() => setBreakpoints((items) => [
              ...items,
              { type: "exception", className: "java.lang.Throwable", line: 0, caught: false, uncaught: true, enabled: true },
            ])}><Plus size={12} /> {t("Exception Breakpoint")}</button>
          </div>
          {!breakpoints.length && <div className="empty-breakpoints">{t("F9 setzt einen Breakpoint in der aktuellen Zeile.")}</div>}
          <div className="run-section"><ChevronDown size={13} /> {t("WATCH")} <span>{debugWatches.length}</span></div>
          {debugWatches.map((watch) => (
            <div className="debug-sidebar-watch" key={watch.expression}>
              <button className="debug-sidebar-value" onClick={() => void window.kiwi?.debug.command("evaluate", watch.expression)}>
                <Eye size={12} /><span><strong>{watch.expression}</strong><small>{watch.value}</small></span>
              </button>
              {/* The list only ever grew, so a mistyped expression stayed for
                  the rest of the session. */}
              <button
                className="debug-watch-remove"
                title={`${watch.expression} nicht mehr beobachten`}
                onClick={() => setDebugWatches((current) => current.filter((item) => item.expression !== watch.expression))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <div className="run-section"><ChevronDown size={13} /> {t("CALL STACK")} <span>{debugStack.length}</span></div>
          {debugStack.slice(0, 30).map((frame) => <button className="debug-sidebar-value" key={`${frame.threadId}:${frame.id}`}><Braces size={12} /><span><strong>{frame.className}.{frame.methodName}</strong><small>{frame.sourceName}:{frame.line}</small></span></button>)}
        </>
      );
    }

    return null;
  };

  const menuDefinitions: Record<string, { label: string; shortcut?: string; action?: () => void }[]> = {
    Datei: [
      { label: "Neues Projekt…", action: openNewProject },
      { label: "Projekt öffnen…", shortcut: "Ctrl+O", action: openWorkspace },
      { label: "Projekt importieren…", action: openWorkspace },
      { label: "Modul hinzufügen…", action: () => setModuleDialogOpen(true) },
      { label: "Projektstruktur…", action: openProjectStructure },
      { label: "Neue Datei", action: () => void createEntry(false) },
      { label: "Speichern", shortcut: "Ctrl+S", action: () => activePath && void saveFile(activePath) },
      { label: "Alle speichern", shortcut: "Ctrl+Shift+S", action: () => void saveAll() },
      { label: "Aktives Projekt schließen", action: () => workspaceRoot && void removeWorkspaceProject(workspaceRoot) },
      { label: "Workspace schließen", action: () => void closeWorkspace() },
    ],
    Bearbeiten: [
      { label: "Rückgängig", shortcut: "Ctrl+Z", action: () => editorRef.current?.trigger("menu", "undo", null) },
      { label: "Wiederholen", shortcut: keys.redo, action: () => editorRef.current?.trigger("menu", "redo", null) },
      { label: "Suchen", shortcut: "Ctrl+F", action: () => editorRef.current?.trigger("menu", "actions.find", null) },
      { label: "Ersetzen", shortcut: "Ctrl+H", action: () => editorRef.current?.trigger("menu", "editor.action.startFindReplaceAction", null) },
    ],
    Auswahl: [
      { label: "Alles auswählen", shortcut: "Ctrl+A", action: () => editorRef.current?.trigger("menu", "editor.action.selectAll", null) },
      { label: "Zeile duplizieren", shortcut: "Shift+Alt+↓", action: () => editorRef.current?.trigger("menu", "editor.action.copyLinesDownAction", null) },
      { label: "Zeile verschieben", shortcut: "Alt+↓", action: () => editorRef.current?.trigger("menu", "editor.action.moveLinesDownAction", null) },
    ],
    Ansicht: [
      { label: "Command Palette…", shortcut: "Ctrl+Shift+P", action: () => { setPaletteMode("commands"); setPaletteOpen(true); } },
      { label: "Seitenleiste umschalten", shortcut: "Ctrl+B", action: () => setSidebarVisible((value) => !value) },
      { label: "Panel umschalten", shortcut: "Ctrl+J", action: () => setPanelVisible((value) => !value) },
      // Each tool window can be summoned by name, which is also how a window
      // that was closed at its edge comes back.
      ...SUMMONABLE_PANEL_VIEWS.map(([view, name]) => ({
        label: `Werkzeugfenster: ${name}`,
        action: () => { setPanelVisible(true); setPanel(view); },
      })),
      { label: "Einstellungen", shortcut: "Ctrl+,", action: openSettingsDocument },
    ],
    Ausführen: [
      { label: "Ohne Debugging ausführen", shortcut: "F5", action: () => void runJava("run") },
      { label: "Debug starten", shortcut: "Shift+F9", action: () => void startDebug() },
      { label: "Breakpoint umschalten", shortcut: "F9", action: toggleBreakpoint },
      { label: "Feld-/Methoden-Breakpoint umschalten", action: toggleMemberBreakpoint },
      { label: "Run-Konfigurationen…", action: () => { setEditingRunConfig(activeRunConfiguration); setRunConfigOpen(true); } },
      { label: "Projekt bauen", shortcut: "Ctrl+Shift+B", action: () => void runJava("build") },
      { label: "Tests ausführen", action: () => void runJava("test") },
      { label: "Auf Server übertragen…", action: () => setDeployOpen(true) },
      { label: "Beenden", shortcut: "Shift+F5", action: () => void stopJava() },
    ],
    Terminal: [
      { label: "Terminal fokussieren", shortcut: "Ctrl+`", action: () => { setPanelVisible(true); setPanel("terminal"); } },
      { label: "Terminal leeren", action: () => updateTerminalLog("") },
      { label: "Aktive Terminal-Sitzung beenden", action: () => void window.kiwi?.terminal.stop(workspaceRoot, activeTerminalId) },
    ],
    Hilfe: [
      { label: "Tastenkürzel", action: () => { setPaletteMode("commands"); setPaletteOpen(true); } },
      { label: "Über Kiwi IDE", action: () => toast(`Kiwi IDE ${__APP_VERSION__} · Lokale Java-Entwicklung mit Multi-Root und Modulen.`, "info") },
    ],
  };

  const renderCodeEditor = (file: OpenFile, primary: boolean) => (
    /*
     * Keyed by the pane, never by the file.
     *
     * With the path in the key, every tab switch was a different element to
     * React: it tore the whole pane down and built a new one, Monaco and all.
     * That is the flicker, the jump to the top and the lost scroll position —
     * a brand new editor starts at line one, and the place this file was left
     * was being restored into an editor that had not been measured yet.
     * Switching the model is what a tab switch is; the editor stays.
     */
    <div className={`editor-pane${file.readOnly ? " editor-pane-read-only" : ""}`} key={primary ? "primary" : "secondary"}>
      {file.readOnly && (
        // Said once, above the code, rather than only discovered by typing
        // into it and having nothing happen.
        <div className="editor-readonly-note">
          <LockIcon size={11} />
          <span>{t("Nur lesbar")}{file.origin ? ` · ${file.origin}` : ""}</span>
        </div>
      )}
      {!primary && <div className="split-editor-header"><FileTypeIcon name={file.name} /><span>{file.name}</span><button onClick={() => setSplitPath(null)}><X size={13} /></button></div>}
      {/*
        * Markdown gets a second way of being read.
        *
        * The preview is laid over the editor instead of replacing it, so the
        * model, the cursor and the undo history stay exactly where they were
        * and switching back costs nothing. Only the primary pane offers it:
        * a split exists to compare two files, and a preview in one half would
        * be a third thing to reason about.
        */}
      {primary && /\.(md|markdown)$/i.test(file.name) && (
        <div className="markdown-toolbar">
          <button
            type="button"
            onClick={() => setMarkdownPreviewOpen((open) => !open)}
            title={markdownPreviewOpen ? t("Zum Quelltext zurück") : t("Markdown-Vorschau anzeigen")}
          >
            {markdownPreviewOpen ? <Code2 size={12} /> : <Eye size={12} />}
            {markdownPreviewOpen ? t("Quelltext") : t("Vorschau")}
          </button>
        </div>
      )}
      {primary && markdownPreviewOpen && /\.(md|markdown)$/i.test(file.name) && (
        <MarkdownPreview
          text={file.content}
          onOpenRelative={(target) => {
            // Anchors point inside the rendered page, which this preview does
            // not scroll to; a path is a file in the project beside this one.
            const clean = target.split("#")[0];
            if (!clean) return;
            void openFile(joinPath(dirname(file.path), clean));
          }}
        />
      )}
      <FileHealthBadge
        diagnostics={[
          ...(languageDiagnostics[fileUri(file.path)] || emptyDiagnostics),
          // The badge must not stay green while the file does not even parse.
          ...(javaSyntaxProblems.get(file.path) || []).map((problem) => ({
            severity: problem.severity === "warning" ? 2 : 1,
            range: { start: { line: problem.line - 1, character: problem.column - 1 } },
            message: problem.message,
          })),
        ]}
        tasks={fileTasks}
        onJump={(line, column) => {
          const editor = primary ? editorRef.current : null;
          editor?.revealLineInCenter(line, revealMotionRef.current);
          editor?.setPosition({ lineNumber: line, column });
          editor?.focus();
        }}
      />
      <Editor
        path={
          // A class out of a jar already carries a URI. Wrapping it a
          // second time made `file://jdt://contents/…`, and every request
          // about it reached JDT as a path with a colon in the middle.
          isLibraryUri(file.path) ? file.path : fileUri(file.path)
        }
        // Given once, when this file's model is created. Not a controlled
        // value: the wrapper compares a value prop against the entire document
        // on every render, which made typing cost more the larger the file,
        // and applied the prop back onto the model after a tab switch — which
        // silently undid what had been typed. Text Kiwi itself replaces is
        // written to the model in applyExternalContent below.
        defaultValue={file.content}
        language={file.language}
        theme={monacoThemeId(settings.theme)}
        beforeMount={beforeMount}
        onMount={primary ? onEditorMount : undefined}
        onChange={(value, event) => {
          const content = value ?? "";
          setOpenFiles((files) => files.map((item) => item.path === file.path
            ? { ...item, content, preview: false }
            : item));
          if (file.language === "java" && window.kiwi) {
            if (languageChangeTimer.current) window.clearTimeout(languageChangeTimer.current);
            languageChangeTimer.current = window.setTimeout(() => {
              const root = workspaceRootRef.current;
              if (root && isPathWithin(file.path, root)) {
                void window.kiwi!.language.change({ root, file: file.path, text: content });
              }
            }, 180);
          }
          const root = workspaceRootRef.current;
          const key = file.path.toLocaleLowerCase();
          const relative = collabRelativePath(root, file.path);
          if (window.kiwi && isActiveCollabHost(
            collabHostingRef.current,
            collabHostedRootRef.current,
            root,
          ) && relative
            && !collabRemoteEditsRef.current.has(key) && event?.changes?.length) {
            // Every range is measured against the model before this Monaco
            // event. Applying from the end keeps all preceding offsets valid.
            const changes = collabEditsFromChanges([...event.changes]);
            const epoch = collabHostEpochRef.current;
            const firstBaseVersion = collabPlannedVersionsRef.current.get(key)
              ?? collabFileVersionsRef.current.get(key);
            const baseVersions = changes.map((_, index) => firstBaseVersion === undefined
              ? undefined
              : firstBaseVersion + index);
            if (firstBaseVersion !== undefined) {
              collabPlannedVersionsRef.current.set(key, firstBaseVersion + changes.length);
            }
            collabLocalRevisionsRef.current.set(
              key,
              (collabLocalRevisionsRef.current.get(key) || 0) + 1,
            );
            let needsSnapshot = false;
            void enqueueCollabFileTask(collabEditQueuesRef.current, key, async () => {
              if (epoch !== collabHostEpochRef.current
                || !isActiveCollabHost(collabHostingRef.current, collabHostedRootRef.current, root)) return;
              let fallbackVersion = collabFileVersionsRef.current.get(key);
              for (let index = 0; index < changes.length; index += 1) {
                const change = changes[index];
                const baseVersion = baseVersions[index] ?? fallbackVersion;
                const result = await window.kiwi!.collab.localEdit(root, relative, change, baseVersion);
                if (Number.isInteger(result.version)) {
                  fallbackVersion = result.version;
                  collabFileVersionsRef.current.set(key, result.version as number);
                }
                if (collabHostEditNeedsSnapshot(baseVersion, change, result)) needsSnapshot = true;
              }
              const planned = collabPlannedVersionsRef.current.get(key);
              const reservedEnd = firstBaseVersion === undefined
                ? undefined
                : firstBaseVersion + changes.length;
              if (!needsSnapshot && Number.isInteger(fallbackVersion)
                && (reservedEnd === undefined || planned === reservedEnd)) {
                collabPlannedVersionsRef.current.set(key, fallbackVersion as number);
              }
            }).catch(() => {
              needsSnapshot = true;
            }).finally(() => {
              if (needsSnapshot && epoch === collabHostEpochRef.current) {
                scheduleCollabHostSnapshotRef.current(root, relative, key);
              }
            });
          }
        }}
        options={{
          // A class out of a jar has no file to save into, and a decompiled
          // body is not the source anybody wrote.
          readOnly: Boolean(file.readOnly),
          domReadOnly: Boolean(file.readOnly),
          fontFamily: editorFont,
          fontSize,
          lineHeight: Math.round(fontSize * settings.lineHeight),
          lineNumbers: settings.lineNumbers ? "on" : "off",
          renderWhitespace: settings.renderWhitespace,
          minimap: { enabled: minimap, renderCharacters: false, maxColumn: 90, scale: 1 },
          wordWrap: wordWrap ? "on" : "off",
          automaticLayout: true,
          codeLens: true,
          codeLensFontSize: Math.max(11, fontSize - 2),
          glyphMargin: true,
          padding: { top: 14, bottom: 16 },
          scrollBeyondLastLine: true,
          // Everything about how it feels, in one place, so the caret's speed
          // and the setting that names it can never disagree.
          ...editorFeelOptions(editorFeel, settings.reducedMotion),
          stickyScroll: { enabled: settings.stickyScroll },
          bracketPairColorization: { enabled: settings.bracketPairColorization },
          guides: { bracketPairs: settings.bracketPairColorization, indentation: settings.indentGuides !== false },
          cursorStyle: settings.cursorStyle || "line",
          suggest: {
            showIcons: true,
            showInlineDetails: true,
            showSnippets: settings.completionShowSnippets,
            showMethods: settings.completionShowMethods,
            showFunctions: settings.completionShowMethods,
            showConstructors: settings.completionShowTypes,
            showClasses: settings.completionShowTypes,
            showInterfaces: settings.completionShowTypes,
            showModules: settings.completionShowTypes,
            showProperties: settings.completionShowFields,
            showFields: settings.completionShowFields,
            showVariables: true,
            showKeywords: true,
            showTypeParameters: true,
            preview: true,
            previewMode: "subwordSmart",
            localityBonus: true,
            shareSuggestSelections: true,
            showDeprecated: true,
            snippetsPreventQuickSuggestions: false,
            showStatusBar: true,
            // Accepting a suggestion in the middle of existing text must not
            // eat what follows the caret. The language server sends both an
            // insert and a replace range; this picks the one that keeps it.
            insertMode: "insert",
          },
          quickSuggestions: settings.completionAutoPopup ? { other: true, comments: false, strings: false } : false,
          quickSuggestionsDelay: settings.completionDelay,
          suggestOnTriggerCharacters: settings.completionAutoPopup,
          suggestSelection: "recentlyUsedByPrefix",
          tabCompletion: "on",
          wordBasedSuggestions: "off",
          // "smart" accepts on Enter only where it cannot be a newline the
          // author meant; off means Enter is always a newline and Tab accepts.
          acceptSuggestionOnEnter: settings.completionCommitOnEnter === false ? "off" : "smart",
          // Monaco spends Ctrl and Alt on go-to-definition and multi-cursor,
          // one each; naming the multi-cursor one is how the other is chosen.
          multiCursorModifier: settings.gotoDefinitionModifier === "alt" ? "ctrlCmd" : "alt",
          acceptSuggestionOnCommitCharacter: Boolean((settings.completionCommitCharacters || "").length),
          parameterHints: { enabled: true, cycle: true },
          inlayHints: { enabled: settings.inlayHints ? "on" : "off" },
          // Standalone Monaco keeps its themes' semanticHighlighting flag at
          // false, so without this the tokens the server sends are decoded and
          // then thrown away.
          "semanticHighlighting.enabled": true,
          inlineSuggest: { enabled: true, showToolbar: "onHover" },
          // Hovers and the suggest details are laid out inside the editor box by
          // default, so near the right or bottom edge they were pushed off the
          // screen. Fixed overflow widgets are positioned against the viewport.
          fixedOverflowWidgets: true,
          formatOnPaste: true,
          formatOnType: true,
          tabSize: editorTabSize(settings, file.language),
          insertSpaces: settings.insertSpaces,
          // The configured width is the width. Monaco guesses one from the
          // file it is given and lets the guess override the setting, so a
          // Java file that happened to carry two-space lines made Tab insert
          // two spaces and Enter indent by two — with the setting still
          // reading four, and the behaviour changing from file to file.
          detectIndentation: false,
          // Whitespace stays where it was typed. Monaco takes the indent back
          // out of a line that was left empty, so a blank line inside a method
          // lost the indentation it was given and the caret jumped to column
          // one on returning to it.
          trimAutoWhitespace: false,
        }}
      />
    </div>
  );

  if (welcomeWindow) {
    return (
      <div
        className={`app-shell hub-shell density-${settings.uiDensity} ${backgroundImageData ? "has-workspace-background" : ""} ${settings.reducedMotion ? "reduced-motion" : ""} ${settings.screenReaderMode ? "screen-reader-mode" : ""} ${settings.enhancedFocus ? "enhanced-focus" : ""}`}
        style={shellStyle}
      >
        <header className="titlebar hub-titlebar">
          <div className="brand"><KiwiLogo size={23} /><strong>{t("Kiwi")}</strong><span>{t("Projekt-Hub")}</span></div>
          <div className="window-controls">
            <button onClick={() => window.kiwi?.app.minimize()} aria-label={t("Minimieren")}><Minus size={15} /></button>
            <button onClick={() => window.kiwi?.app.maximize()} aria-label={t("Maximieren")}><Maximize2 size={13} /></button>
            <button className="close" onClick={() => window.kiwi?.app.close()} aria-label={t("Schließen")}><X size={15} /></button>
          </div>
        </header>
        {bootstrapped ? (
          <ProjectHub
            workspace={workspaceState}
            recentProjects={settings.recentProjects}
            onOpen={() => void openWorkspace()}
            onCreate={openNewProject}
            onOpenProject={(root) => void openProjectFromHub(root)}
            onTogglePinned={(project) => void toggleWorkspacePinned(project)}
            onRemove={(root) => void removeWorkspaceProject(root)}
            onRename={(project) => renameWorkspaceProject(project)}
            onRelocate={(root) => void relocateWorkspaceProject(root)}
            onSettings={openSettingsDocument}
            onCloneFromGit={cloneFromGit}
            onJoinCollab={() => setHubCollabOpen(true)}
          />
        ) : (
          <div className="hub-loading">
            <KiwiLogo size={72} />
            <div className="editor-bootstrap-title">
              <strong>{t("Kiwi IDE")}</strong>
              <small>Version {__APP_VERSION__}</small>
            </div>
            <BusyIndicator label="Workspace wird vorbereitet" detail="Einstellungen und Projekte werden geladen …" />
          </div>
        )}
        {projectWizardOpen && (
          <ProjectWizard
            initialLocation=""
            chooseLocation={() => window.kiwi?.project.chooseLocation() || Promise.resolve(null)}
            chooseJdk={() => window.kiwi?.project.selectJdk() || Promise.resolve(null)}
            onCreate={createProject}
            onClose={() => setProjectWizardOpen(false)}
          />
        )}
        {hubCollabOpen && (
          <div className="modal-overlay codetogetter-hub-overlay" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHubCollabOpen(false);
          }}>
            <section className="codetogetter-hub-dialog" role="dialog" aria-modal="true" aria-label="CodeToGetter">
              <header>
                <span><Users size={17} /><strong>CodeToGetter</strong></span>
                <button className="icon-button" type="button" onClick={() => setHubCollabOpen(false)} aria-label={t("Schließen")}><X size={15} /></button>
              </header>
              <p>{t("Tritt einem Projekt bei, ohne es auf diesem Computer zu speichern.")}</p>
              <CodeToGetter
                workspaceRoot=""
                guestOnly
                onNotice={toast}
                onJoined={(root) => void loadWorkspace(root)}
              />
            </section>
          </div>
        )}
        {inputRequest && (
          <KiwiInputDialog
            open
            title={inputRequest.title}
            description={inputRequest.description}
            label={inputRequest.label}
            initialValue={inputRequest.initialValue}
            placeholder={inputRequest.placeholder}
            confirmLabel={inputRequest.confirmLabel}
            variant={inputRequest.variant}
            validate={inputRequest.validate}
            onCancel={() => setInputRequest(null)}
            onConfirm={inputRequest.action}
          />
        )}
        <UpdateProgress state={updateRuntime} />
        <div className="toast-stack" role="status" aria-live="polite" aria-atomic="true">
          {toasts.map((item) => <div className={`toast ${item.kind}`} key={item.id}><span>{item.message}</span></div>)}
        </div>
      </div>
    );
  }

  if (!bootstrapped || !workspaceRoot) {
    return (
      <div className={`app-shell editor-bootstrap-shell ${backgroundImageData ? "has-workspace-background" : ""} ${settings.screenReaderMode ? "screen-reader-mode" : ""} ${settings.enhancedFocus ? "enhanced-focus" : ""}`} style={shellStyle}>
        <KiwiLogo size={92} className="editor-bootstrap-logo" />
        <div className="editor-bootstrap-title">
          <strong>{t("Kiwi IDE")}</strong>
          <small>Version {__APP_VERSION__}</small>
        </div>
        <BusyIndicator
          label={projectLoading?.label || "Kiwi wird gestartet"}
          detail={projectLoading?.detail || "Workspace wird vorbereitet …"}
          progress={projectLoading?.progress}
        />
        <UpdateProgress state={updateRuntime} />
      </div>
    );
  }


  /**
   * The tabs that exist right now, in their canonical order.
   *
   * HTTP only appears once a request file is open, and an edge that would hold
   * nothing but HTTP has to disappear with it — which is why the list is what
   * every dock lookup is measured against.
   */
  // The tab names were English words in the German interface and stayed English
  // in every other one, which left a Russian workbench reading PROBLEMS BUILD
  // RUN in Latin letters between Cyrillic menus. The count stays outside the
  // translation: it is a number, not a word.
  const panelTabs = ([
    ["problems", `${t("PROBLEMS")}${diagnostics.length ? ` ${diagnostics.length}` : ""}`],
    ["todos", `${t("TODO")}${taskComments.length ? ` ${taskComments.length}` : ""}`],
    ["build", t("BUILD")],
    ["run", t("RUN")],
    ["debug", t("DEBUG")],
    ["tests", `${t("TESTS")}${testReports.length ? ` ${testReports.reduce((sum, report) => sum + report.tests, 0)}` : ""}`],
    ["terminal", t("TERMINAL")],
    ["tailer", t("TAILER")],
    ...(httpResponses.length || httpPending || activeFile?.language === HTTP_LANGUAGE_ID
      ? [["http", `HTTP${httpResponses.length ? ` ${httpResponses.length}` : ""}`]]
      : []),
  ] as [PanelView, string][]);
  const availablePanelViews = panelTabs.map(([id]) => id);
  const panelLabels = new Map(panelTabs);
  const edgeNames: Record<DockEdge, string> = {
    bottom: "unten",
    "bottom-left": "unten links",
    "bottom-right": "unten rechts",
    floating: "als eigenes Fenster",
  };
  const panelTabIcons: Partial<Record<PanelView, ReactNode>> = {
    problems: <CircleX size={13} />,
    todos: <ListTodo size={13} />,
    build: <Hammer size={13} />,
    run: <Play size={13} />,
    debug: <Bug size={13} />,
    tests: <TestTube2 size={13} />,
    terminal: <SquareTerminal size={13} />,
    tailer: <ScrollText size={13} />,
    http: <Globe size={13} />,
  };
  availablePanelViewsRef.current = availablePanelViews;

  /** Empties whatever the given tool window shows. */
  const clearPanelView = (view: PanelView) => {
    if (view === "terminal") updateTerminalLog("");
    if (view === "output" || view === "build" || view === "run") {
      replaceBuildOutput("");
      setGitDiff("");
      setLastProcessExitCode(null);
      setBuildRawOpen(false);
    }
    if (view === "debug") setDebugOutput("");
    if (view === "tailer") tailerStore.clear();
  };
  clearPanelViewRef.current = () => clearPanelView(panelViewRef.current);

  /** Closing one tool window leaves the others where they are. */
  const hideDock = (edge: DockEdge) => {
    const next = focusAfterHidingDock(panelViewDocks, hiddenDocks, edge, panel, availablePanelViews);
    if (!next) {
      // Nothing else is on screen: hide the whole output area and forget the
      // individually closed edges, so reopening it restores the layout.
      setPanelVisible(false);
      setHiddenDocks([]);
      return;
    }
    setHiddenDocks((current) => current.includes(edge) ? current : [...current, edge]);
    setPanel(next);
  };

  /**
   * One tool window per edge.
   *
   * Every edge has its own tabs, its own selected tab and its own size, so
   * Terminal can sit on the right while Problems stays at the bottom — the
   * IntelliJ arrangement. `null` means the edge holds nothing to show.
   */
  const renderToolWindow = (edge: DockEdge) => {
    if (!panelVisible) return null;
    // While the tool window runs as a window of its own, the workbench shows
    // nothing of it at all. A strip left behind saying where it went was still
    // a strip: the room it takes is exactly what moving it out was for. Its
    // edges are untouched, so closing that window brings every tab back
    // wherever it sat before.
    if (panelWindowOpen) return null;
    // The focused window's edge stays on screen even while `hiddenDocks` is
    // being cleaned up by the selection effect, so it never blinks out.
    if (hiddenDocks.includes(edge) && edge !== activePanelDock) return null;
    const view = activeViewForDock(panelViewDocks, edge, dockSelection[edge] ?? null, availablePanelViews);
    if (!view) return null;
    const views = viewsForDock(panelViewDocks, edge, availablePanelViews);
    // A corner is a row at the foot of a column that is already there: the
    // Explorer's on the left, the build tool's on the right. It takes that
    // column's width and owns only its height, so the editor keeps every pixel
    // it had. The middle keeps the full-width row under the editor.
    const corner = edge === "bottom-left" || edge === "bottom-right";
    const cornerHeight = edge === "bottom-left" ? panelLeftHeight : panelRightHeight;
    const setCornerHeight = edge === "bottom-left" ? setPanelLeftHeight : setPanelRightHeight;
    const floating = edge === "floating";
    // The same controls serve both shapes: along the bottom they sit in the
    // tab strip, at a side they belong to the window header, where a narrow
    // dock has room for them.
    const panelActions = (
            <div className="panel-actions">
              {view === "terminal" && (
                <button
                  className="terminal-popout-action"
                  title={detachedTerminalSessions.has(activeTerminalId)
                    ? `Terminal ${activeTerminalId} in den Vordergrund holen`
                    : `Terminal ${activeTerminalId} in ein eigenes Fenster verschieben`}
                  aria-label={detachedTerminalSessions.has(activeTerminalId)
                    ? `Terminal ${activeTerminalId} in den Vordergrund holen`
                    : `Terminal ${activeTerminalId} in eigenes Fenster verschieben`}
                  onClick={() => void detachTerminalSession(activeTerminalId)}
                  disabled={!workspaceRoot}
                >
                  <SquareTerminal size={13} />
                  <span>{detachedTerminalSessions.has(activeTerminalId) ? t("Fenster anzeigen") : t("In Fenster öffnen")}</span>
                </button>
              )}
              <button
                className="panel-detach-action"
                title={t("Werkzeugfenster als eigenes Fenster öffnen — auch auf einem zweiten Monitor")}
                aria-label={t("Werkzeugfenster in eigenes Fenster öffnen")}
                onClick={() => openPanelWindow()}
                disabled={view === "tailer"}
              ><Monitor size={13} /></button>
              <label
                className="panel-dock-picker"
                title={`${view.toUpperCase()} ist ${edgeNames[edge]} angedockt`}
              >
                <Columns2 size={12} aria-hidden="true" />
                <select
                  value={edge}
                  aria-label={`${view.toUpperCase()} andocken`}
                  onChange={(event) => {
                    const target = event.target.value as DropTarget;
                    if (target === "window") openPanelWindow();
                    else dockPanelView(view, target);
                  }}
                >
                  <option value="bottom-left">{t("Unten links")}</option>
                  <option value="bottom">{t("Unten")}</option>
                  <option value="bottom-right">{t("Unten rechts")}</option>
                  <option value="floating">{t("Schwebend über der Werkbank")}</option>
                  <option value="window" disabled={view === "tailer"}>{t("Eigenes Fenster (zweiter Monitor)")}</option>
                </select>
              </label>
              {running && <button onClick={() => void stopJava()} title={t("Prozess beenden")}><Square size={12} fill="currentColor" /></button>}
              <button onClick={() => clearPanelView(view)} title={t("Leeren")}><Trash2 size={13} /></button>
              <button className="panel-close-action" onClick={() => hideDock(edge)} title={t("Werkzeugfenster schließen")}><X size={14} /></button>
            </div>
    );
    return (
            <section
              key={edge}
              data-panel-dock={edge}
              data-panel-view={view}
              className={`bottom-panel panel-dock-${edge}${panelDropEdge ? " panel-dragging" : ""}${view === panel ? " panel-focused" : ""}`}
              style={floating
                ? { left: floatingBounds.x, top: floatingBounds.y, width: floatingBounds.width, height: floatingBounds.height }
                : corner ? { height: cornerHeight, flexBasis: cornerHeight }
                : undefined}
              onPointerDownCapture={() => { if (view !== panel) setPanel(view); }}
            >
              {corner && (
                <div
                  className="workbench-resizer panel-resizer"
                  role="separator"
                  aria-label={`Höhe des Werkzeugfensters ${edgeNames[edge]} ändern`}
                  aria-orientation="horizontal"
                  tabIndex={0}
                  onPointerDown={(event) => beginWorkbenchResize("panel", event, edge)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    const step = event.key === "ArrowUp" ? -10 : 10;
                    setCornerHeight((value) => resizedPanelHeight(value, step, effectiveViewport().height));
                    event.preventDefault();
                  }}
                />
              )}
              {corner && (
                <div className="panel-side-header">
                  <span
                    className="panel-drag-handle"
                    role="button"
                    tabIndex={0}
                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowDown ArrowUp"
                    aria-label={`Werkzeugfenster ${edgeNames[edge]} verschieben`}
                    title={t("Ziehen: an eine Kante zum Andocken oder in die Mitte für ein eigenes Fenster auf einem zweiten Monitor; Pfeiltasten docken an, Pfeil hoch öffnet das eigene Fenster")}
                    onPointerDown={(event) => beginPanelDockDrag(event, edge)}
                    onKeyDown={(event) => handlePanelDockKeyDown(event, edge)}
                  >
                    <GripVertical size={13} />
                  </span>
                  <strong>{panelTabIcons[view]}<span>{panelLabels.get(view) || view}</span></strong>
                  <div className="panel-side-actions">
                    <IconButton
                      label="Aktionen"
                      active={sideMenuEdge === edge}
                      onClick={() => setSideMenuEdge((current) => current === edge ? "" : edge)}
                    ><Ellipsis size={15} /></IconButton>
                    <IconButton className="panel-close-action" label="Werkzeugfenster schließen" onClick={() => hideDock(edge)}><X size={14} /></IconButton>
                  </div>
                  {sideMenuEdge === edge && (
                    <div className="panel-side-menu" role="menu" onClick={() => setSideMenuEdge("")}>
                      {panelActions}
                    </div>
                  )}
                </div>
              )}
              <div className="panel-tabs">
                <span
                  className="panel-drag-handle"
                  role="button"
                  tabIndex={0}
                  aria-keyshortcuts="ArrowLeft ArrowRight ArrowDown ArrowUp"
                  aria-label={`Werkzeugfenster ${edgeNames[edge]} verschieben`}
                  title={floating
                    ? t("Ziehen, um das Fenster zu bewegen oder an eine Kante anzudocken")
                    : "Ziehen: an eine Kante zum Andocken oder in die Mitte für ein eigenes Fenster auf einem zweiten Monitor; Pfeiltasten docken an, Pfeil hoch öffnet das eigene Fenster"}
                  onPointerDown={(event) => floating ? beginFloatingDrag(event) : beginPanelDockDrag(event, edge)}
                  onKeyDown={(event) => handlePanelDockKeyDown(event, edge)}
                >
                  <GripVertical size={13} />
                </span>
                {views.map((id) => (
                  <button
                    key={id}
                    className={view === id ? "active" : ""}
                    title={`${panelLabels.get(id) || id} — ziehen, um dieses Werkzeugfenster an eine andere Kante zu legen`}
                    onClick={() => setPanel(id)}
                    onPointerDown={(event) => beginPanelViewDrag(event, id)}
                  >{panelLabels.get(id) || id}</button>
                ))}
                {!corner && panelActions}
              </div>
              <div className="panel-content">
                {view === "terminal" && (
                  <div
                    className={`terminal${detachedTerminalSessions.has(activeTerminalId) ? " terminal-session-detached" : ""}`}
                    data-terminal-session={activeTerminalId}
                    data-terminal-buffer-length={terminalOutput.length}
                  >
                    <div className="terminal-sessions">
                      {terminalSessions.map((sessionId) => (
                        <span key={sessionId} className={sessionId === activeTerminalId ? "active" : ""}>
                          <button onClick={() => showTerminalSession(sessionId)}>Terminal {sessionId}</button>
                          {terminalSessions.length > 1 && (
                            <button
                              className="terminal-session-close"
                              title={`Terminal ${sessionId} schließen`}
                              onClick={() => closeTerminalSession(sessionId)}
                            >
                              <X size={10} />
                            </button>
                          )}
                        </span>
                      ))}
                      <button className="terminal-session-add" onClick={() => void openTerminalSession()} title={t("Neues Terminal")} disabled={!workspaceRoot}>
                        <Plus size={12} />
                      </button>
                    </div>
                    {detachedTerminalSessions.has(activeTerminalId) ? (
                      <div className="terminal-detached-placeholder" role="status">
                        <SquareTerminal size={24} />
                        <strong>Terminal {activeTerminalId} ist in einem eigenen Fenster</strong>
                        <span>Andere Terminal-Sitzungen sowie Problems, Build und Debug bleiben hier verfügbar.</span>
                        <button type="button" onClick={() => void detachTerminalSession(activeTerminalId)}>{t("Fenster anzeigen")}</button>
                      </div>
                    ) : (
                      <>
                        <TerminalScreen
                          output={terminalOutput}
                          fontSize={settings.terminalFontSize}
                          transparent={Boolean(backgroundImageData)}
                          background={terminalColors.background}
                          foreground={terminalColors.foreground}
                          autoFocus
                          onData={(data) => {
                            if (window.kiwi) void window.kiwi.terminal.input(workspaceRoot, data, activeTerminalId).catch((error) => {
                              toast(error instanceof Error ? error.message : "Terminaleingabe fehlgeschlagen.", "error");
                            });
                          }}
                          onResize={(columns, rows) => {
                            if (window.kiwi) void window.kiwi.terminal.resize(workspaceRoot, columns, rows, activeTerminalId).catch(() => undefined);
                          }}
                        />
                        {workflow.terminalTasks.length > 0 && (
                          <div className="terminal-tasks">
                            {workflow.terminalTasks.map((task) => (
                              <button key={task.id} title={task.command} onClick={() => {
                                void window.kiwi?.terminal.execute({ root: workspaceRoot, command: task.command, sessionId: activeTerminalId });
                              }}><Play size={11} />{task.name}</button>
                            ))}
                          </div>
                        )}
                        <div className="terminal-input-row">
                          <span>{t("Schnellbefehl")}</span><span className="terminal-angle">›</span>
                          <input
                            value={terminalCommand}
                            onChange={(event) => setTerminalCommand(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void executeTerminal();
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                const next = Math.min(historyIndex + 1, commandHistory.length - 1);
                                setHistoryIndex(next);
                                setTerminalCommand(commandHistory[next] || "");
                              }
                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                const next = Math.max(historyIndex - 1, -1);
                                setHistoryIndex(next);
                                setTerminalCommand(next < 0 ? "" : commandHistory[next] || "");
                              }
                            }}
                            disabled={!workspaceRoot}
                            placeholder={workspaceRoot ? t("Optionalen Befehl direkt ausführen…") : t("Öffne zuerst ein Projekt")}
                            spellCheck={false}
                          />
                          <button className="terminal-save-task" onClick={saveTerminalTask} title={t("Befehl als Task speichern")}><Save size={13} /></button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {view === "tailer" && (
                  <TailerPanel workspaceRoot={workspaceRoot} fontSize={settings.terminalFontSize} />
                )}
                {(view === "output" || view === "build" || view === "run") && (
                  gitDiff && gitDiffSelection ? (
                    <div className="git-diff-panel">
                      <header>
                        <strong>{basename(gitDiffSelection.file)}</strong>
                        <span>{gitDiffSelection.staged ? "Gestagte Änderungen" : "Arbeitskopie"}</span>
                      </header>
                      {gitDiffSelection.hunks.length > 0 && (
                        <div className="git-hunk-actions">
                          {gitDiffSelection.hunks.map((hunk) => (
                            <div key={`${gitDiffSelection.file}:${hunk.index}`}>
                              <code>{hunk.header}</code>
                              <pre>{hunk.preview}</pre>
                              {!gitDiffSelection.staged && hunk.changes.length > 0 && (
                                <div className="git-line-picker">
                                  <strong>{t("Zeilenweise auswählen")}</strong>
                                  {hunk.changes.map((change) => {
                                    const selectionKey = String(hunk.index);
                                    const checked = (gitLineSelection[selectionKey] || []).includes(change.id);
                                    return (
                                      <label key={change.id}>
                                        <input type="checkbox" checked={checked} onChange={(event) => setGitLineSelection((current) => {
                                          const selected = current[selectionKey] || [];
                                          return {
                                            ...current,
                                            [selectionKey]: event.target.checked
                                              ? [...selected, change.id]
                                              : selected.filter((id) => id !== change.id),
                                          };
                                        })} />
                                        <span>
                                          {change.before && <del>- {change.before}</del>}
                                          {change.after && <ins>+ {change.after}</ins>}
                                        </span>
                                      </label>
                                    );
                                  })}
                                  <button disabled={!(gitLineSelection[String(hunk.index)] || []).length} onClick={async () => {
                                    if (!workspaceRoot || !window.kiwi) return;
                                    try {
                                      const result = await window.kiwi.git.applyLines(
                                        workspaceRoot,
                                        gitDiffSelection.file,
                                        hunk.index,
                                        gitLineSelection[String(hunk.index)] || [],
                                      );
                                      setGitStatus(result.status);
                                      const [diff, hunks] = await Promise.all([
                                        window.kiwi.git.diff(workspaceRoot, gitDiffSelection.file, false),
                                        window.kiwi.git.hunks(workspaceRoot, gitDiffSelection.file, false),
                                      ]);
                                      setGitDiff(diff);
                                      setGitDiffSelection((current) => current ? { ...current, hunks } : null);
                                      setGitLineSelection((current) => ({ ...current, [String(hunk.index)]: [] }));
                                      toast("Ausgewählte Zeilen gestagt", "success");
                                    } catch (error) {
                                      toast(error instanceof Error ? error.message : "Zeilen konnten nicht gestagt werden.", "error");
                                    }
                                  }}>{t("Ausgewählte Zeilen stage")}</button>
                                </div>
                              )}
                              <button onClick={async () => {
                                if (!workspaceRoot || !window.kiwi) return;
                                try {
                                  const result = await window.kiwi.git.applyHunk(
                                    workspaceRoot,
                                    gitDiffSelection.file,
                                    hunk.index,
                                    gitDiffSelection.staged,
                                  );
                                  setGitStatus(result.status);
                                  const [diff, hunks] = await Promise.all([
                                    window.kiwi.git.diff(workspaceRoot, gitDiffSelection.file, gitDiffSelection.staged),
                                    window.kiwi.git.hunks(workspaceRoot, gitDiffSelection.file, gitDiffSelection.staged),
                                  ]);
                                  setGitDiff(diff);
                                  setGitDiffSelection((current) => current ? { ...current, hunks } : null);
                                  toast(gitDiffSelection.staged ? "Diff-Abschnitt entfernt" : "Diff-Abschnitt gestagt", "success");
                                } catch (error) {
                                  toast(error instanceof Error ? error.message : "Diff-Abschnitt konnte nicht angewendet werden.", "error");
                                }
                              }}>{gitDiffSelection.staged ? "Diesen Abschnitt unstage" : "Nur diesen Abschnitt stage"}</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <pre className="output-view">{gitDiff}</pre>
                    </div>
                  ) : view === "build" ? (
                    <div className={`build-dashboard ${buildReport.status}`}>
                      <header className="build-result-header">
                        <div className="build-result-icon">
                          {buildReport.status === "running"
                            ? <LoaderCircle size={18} className="kiwi-spinner" />
                            : buildReport.status === "success"
                              ? <CircleCheck size={18} />
                              : buildReport.status === "failed"
                                ? <CircleX size={18} />
                                : <Hammer size={18} />}
                        </div>
                        <div className="build-result-copy">
                          <strong>{buildReport.title}</strong>
                          <span>{buildReport.detail}</span>
                          <small>
                            {buildReport.tool}
                            {buildReport.duration ? ` · ${buildReport.duration}` : ""}
                            {buildReport.command ? ` · ${buildReport.command}` : ""}
                          </small>
                        </div>
                        <div className="build-result-actions">
                          <button className="primary-button" disabled={running} onClick={() => void runJava("build")}>
                            {running ? <LoaderCircle size={13} className="kiwi-spinner" /> : <Play size={13} />}
                            {buildReport.status === "failed" ? "Erneut bauen" : "Projekt bauen"}
                          </button>
                          <button onClick={() => setBuildRawOpen((value) => !value)}>
                            <FileCode2 size={13} />{buildRawOpen ? "Protokoll schließen" : "Rohprotokoll"}
                          </button>
                          <button onClick={() => setBuildHistoryOpen((value) => !value)}>
                            <History size={13} />Verlauf{buildHistory.length ? ` (${buildHistory.length})` : ""}
                          </button>
                        </div>
                      </header>
                      {buildReport.status === "running" && <progress className="build-progress" />}
                      {buildHistoryOpen && (
                        <div className="build-history" aria-label={t("Build-Verlauf")}>
                          {buildHistory.length ? buildHistory.map((entry) => (
                            <button key={entry.id} onClick={() => {
                              replaceBuildOutput(entry.output);
                              setLastProcessExitCode(entry.status === "success" ? 0 : 1);
                              setLastJavaAction("build");
                              setBuildRawOpen(true);
                            }}>
                              {entry.status === "success" ? <CircleCheck size={14} /> : <CircleX size={14} />}
                              <span>
                                <strong>{entry.status === "success" ? "Build erfolgreich" : "Build fehlgeschlagen"}</strong>
                                <small>{new Date(entry.finishedAt).toLocaleString()} · {entry.modules.length} Modul(e)</small>
                              </span>
                              <ChevronRight size={13} />
                            </button>
                          )) : <div className="build-history-empty">{t("Noch kein abgeschlossener Build.")}</div>}
                        </div>
                      )}
                      {buildReport.diagnostics.length > 0 ? (
                        <div className="build-issues" aria-label={t("Compilerfehler")}>
                          <div className="build-issues-heading">
                            <strong>{t("Probleme")}</strong>
                            <span>{buildReport.diagnostics.length}</span>
                          </div>
                          {buildReport.diagnostics.map((diagnostic, index) => {
                            const quickFix = buildQuickFixForDiagnostic(diagnostic);
                            const fixKey = quickFix
                              ? `${diagnostic.path}:${diagnostic.line}:${quickFix.sourceType}:${quickFix.targetType}`
                              : "";
                            return (
                              <article className={`build-issue ${diagnostic.severity}`} key={`${diagnostic.path}:${diagnostic.line}:${diagnostic.column}:${index}`}>
                                <button className="build-issue-main" onClick={() => selectDiagnostic(diagnostic)}>
                                  {diagnostic.severity === "error" ? <CircleX size={15} /> : <CircleAlert size={15} />}
                                  <span>
                                    <strong>{explainJavaDiagnostic(diagnostic)}</strong>
                                    <small>{diagnostic.message}</small>
                                  </span>
                                  <code>{basename(diagnostic.path)}:{diagnostic.line}:{diagnostic.column}</code>
                                </button>
                                {quickFix && (
                                  <button
                                    className="build-quick-fix"
                                    disabled={buildFixing === fixKey}
                                    onClick={() => void applyBuildQuickFix(diagnostic)}
                                  >
                                    {buildFixing === fixKey ? <LoaderCircle size={13} className="kiwi-spinner" /> : <WandSparkles size={13} />}
                                    {quickFix.label}
                                  </button>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      ) : buildReport.status === "success" ? (
                        <div className="build-empty success"><CircleCheck size={24} /><span><strong>{t("Bereit")}</strong><small>{t("Keine Compilerfehler gefunden.")}</small></span></div>
                      ) : buildReport.status === "failed" ? (
                        <div className="build-empty failed"><CircleAlert size={24} /><span><strong>{t("Build-Werkzeug fehlgeschlagen")}</strong><small>{t("Öffne das Rohprotokoll für die vollständige Meldung.")}</small></span></div>
                      ) : (
                        <div className="build-empty"><Hammer size={24} /><span><strong>{t("Projekt bauen")}</strong><small>{t("Ctrl+Shift+B startet den Build.")}</small></span></div>
                      )}
                      {buildRawOpen && (
                        <div className="build-module-output">
                          {buildOutputGroups.length > 1 ? buildOutputGroups.map((group) => (
                            <details key={group.module} open={group.errors > 0}>
                              <summary>
                                <span>{group.module}</span>
                                {group.errors > 0 && <em>{group.errors} Fehler</em>}
                              </summary>
                              <VirtualOutput className="build-raw-output" text={group.output} />
                            </details>
                          )) : <VirtualOutput className="build-raw-output" text={buildReport.raw} emptyText="Noch keine Prozessausgabe." />}
                        </div>
                      )}
                    </div>
                  ) : <VirtualOutput text={output} emptyText="Noch keine Prozessausgabe." />
                )}
                {view === "debug" && (
                  <div className="debug-panel">
                    <div className="debug-controls">
                      <button onClick={() => void window.kiwi?.debug.command("continue")} disabled={debugStatus !== "paused"} title={t("Continue")}><Play size={13} /></button>
                      <button onClick={() => void window.kiwi?.debug.command("pause")} disabled={debugStatus !== "running"} title={t("Pause")}><Pause size={13} /></button>
                      <button onClick={() => void window.kiwi?.debug.command("stepOver")} disabled={debugStatus !== "paused"}>{t("Step Over")}</button>
                      <button onClick={() => void window.kiwi?.debug.command("stepInto")} disabled={debugStatus !== "paused"}>{t("Step Into")}</button>
                      <button onClick={() => void window.kiwi?.debug.command("stepOut")} disabled={debugStatus !== "paused"}>{t("Step Out")}</button>
                      <button onClick={runToCursor} disabled={debugStatus !== "paused" || activeFile?.language !== "java"} title={t("Bis zur aktuellen Cursorzeile weiterlaufen")}>{t("Run to Cursor")}</button>
                      <button onClick={() => void window.kiwi?.debug.command("restartFrame")} disabled={debugStatus !== "paused"} title={t("Aktuelle Methode vom Anfang erneut ausführen")}>{t("Frame neu starten")}</button>
                      <button
                        className="debug-hot-replace"
                        onClick={async () => {
                          const filePath = activeFile?.path;
                          if (!filePath) return;
                          if (activeFile.content !== activeFile.savedContent) {
                            const saved = await saveFile(filePath, true);
                            if (!saved) return;
                          }
                          // This works while the debuggee is running. JDI may
                          // synchronize internally for a moment, but Kiwi does
                          // not enter or remain in a paused UI state.
                          await performInstantHotSwap(filePath);
                        }}
                        disabled={!activeFile
                          || activeFile.language !== "java"
                          || !["running", "paused"].includes(debugStatus)}
                        title={t("Methodencode sofort ersetzen; bereits ausgeführter Start- und Initialisierungscode lädt die Anwendung automatisch neu")}
                      >
                        <RefreshCw size={12} /> Smart HotSwap
                      </button>
                      <select
                        value={debugThreads.find((thread) => thread.selected)?.id || ""}
                        onChange={(event) => void window.kiwi?.debug.command("selectThread", event.target.value)}
                        disabled={!debugThreads.length}
                        aria-label={t("Debug-Thread")}
                      >
                        {debugThreads.map((thread) => <option key={thread.id} value={thread.id}>{thread.selected ? "● " : ""}{thread.name}{thread.suspended ? " · pausiert" : ""}</option>)}
                      </select>
                      <select
                        value=""
                        onChange={(event) => {
                          if (event.target.value) void window.kiwi?.debug.command(event.target.value);
                          event.currentTarget.value = "";
                        }}
                        disabled={!["running", "paused"].includes(debugStatus)}
                        aria-label={t("Profiler")}
                      >
                        <option value="">{t("Profiler…")}</option>
                        <option value="profileCpu">{t("CPU · JFR 60 s")}</option>
                        <option value="profileHeap">{t("Heap · Klassen")}</option>
                        <option value="profileMemory">{t("Speicherübersicht")}</option>
                        <option value="profileThreads">{t("Thread Dump")}</option>
                      </select>
                      <div className="debug-watch">
                        <Eye size={12} />
                        <input disabled={debugStatus !== "paused"} value={watchExpression} onChange={(event) => setWatchExpression(event.target.value)} placeholder={t("Watch expression")} onKeyDown={(event) => {
                          if (event.key === "Enter" && watchExpression.trim()) void window.kiwi?.debug.command("evaluate", watchExpression.trim());
                        }} />
                      </div>
                      <span>{debugStatus}</span>
                    </div>
                    <div className="debug-workspace">
                      <section className="debug-variable-list">
                        <header>{t("Variablen")}</header>
                        <DebugVariableTree
                          variables={debugVariables}
                          childrenByReference={debugVariableChildren}
                          onExpand={(referenceId) => void window.kiwi?.debug.command("variables", String(referenceId))}
                          onWatch={(name) => {
                            setWatchExpression(name);
                            void window.kiwi?.debug.command("evaluate", name);
                          }}
                          onSetValue={(name) => setInputRequest({
                            title: t("Wert ändern"),
                            description: t("Der neue Wert wird als Java-Ausdruck ausgewertet."),
                            label: name,
                            placeholder: "42",
                            confirmLabel: t("Übernehmen"),
                            validate: (value) => (value.trim() ? null : t("Bitte gib einen Wert an.")),
                            action: async (value) => {
                              try {
                                await window.kiwi!.debug.command("setVariable", JSON.stringify({ target: name, value: value.trim() }));
                              } catch (error) {
                                toast(error instanceof Error ? error.message : t("Der Wert konnte nicht geändert werden."), "error");
                              }
                            },
                          })}
                        />
                      </section>
                      <section className="debug-stack-list">
                        <header>{t("Threads & Call Stack")}</header>
                        {debugStack.map((frame) => <button key={`${frame.threadId}:${frame.id}`}><span>{frame.className}.{frame.methodName}</span><small>{frame.sourceName}:{frame.line}</small></button>)}
                      </section>
                    </div>
                    <pre>{debugOutput || "Debugger ist nicht aktiv."}</pre>
                  </div>
                )}
                {view === "tests" && (
                  <div className="test-results-panel">
                    {testProgress.running && (
                      <div className="test-live-progress" role="status" aria-live="polite">
                        <div><RefreshCw size={14} className="spin" /><span><strong>{t("Tests laufen")}</strong><small>{testProgress.current}</small></span><b>{testProgress.completed}/{testProgress.total || "?"}</b></div>
                        <progress max={Math.max(1, testProgress.total)} value={testProgress.completed} />
                        <small>{testProgress.passed} bestanden · {testProgress.failed} fehlgeschlagen · {testProgress.skipped} übersprungen</small>
                      </div>
                    )}
                    {!testProgress.running && testHistory[0] && (
                      <div className="test-last-run" role="status">
                        <History size={13} />
                        <span>
                          Letzter Lauf {new Date(testHistory[0].timestamp).toLocaleString()} · {testHistory[0].passed} bestanden · {testHistory[0].failed} fehlgeschlagen · {testHistory[0].duration.toFixed(2)} s
                        </span>
                        {flakyTests.length > 0 && <b>{flakyTests.length} instabil</b>}
                      </div>
                    )}
                    {testReports.some((report) => report.cases.some((test) => test.status === "failed")) && (
                      <button className="rerun-failed" onClick={() => {
                        const failed = testReports.flatMap((report) => report.cases).find((test) => test.status === "failed");
                        if (failed) void runTest(`${failed.className}#${failed.name}`);
                      }}><RefreshCw size={13} /> {t("Fehlgeschlagenen Test erneut ausführen")}</button>
                    )}
                    {testReports.length === 0 ? <div className="empty-problems"><TestTube2 size={20} /><span>{t("Noch keine Testergebnisse.")}</span></div> : testReports.map((report) => (
                      <div className="test-report" key={report.name}>
                        <header><strong>{report.name}</strong><span>{report.tests - report.failures - report.errors - report.skipped} passed · {report.failures + report.errors} failed · {report.time.toFixed(2)}s</span></header>
                        {report.cases.map((test) => <button className={test.status} key={`${test.className}:${test.name}`}><CircleCheck size={13} /><span>{test.name}</span><small>{test.time.toFixed(3)}s</small></button>)}
                      </div>
                    ))}
                    {diffCoverageResult && (
                      /* The number that decides whether the change is tested,
                         rather than the one that describes the whole project. */
                      <section className="coverage-diff">
                        <header>
                          <Eye size={14} />
                          <span>{t("Abdeckung dieser Änderung")}</span>
                          <b>{describeDiffCoverage(diffCoverageResult)}</b>
                        </header>
                        {diffCoverageResult.gaps.map((gap) => (
                          <button
                            key={gap.path}
                            className="coverage-gap"
                            onClick={() => void openFile(gap.path, { line: gap.lines[0], column: 1 })}
                            title={gap.path}
                          >
                            <span>{basename(gap.path)}</span>
                            <small>{gap.lines.length} {gap.lines.length === 1 ? t("Zeile") : t("Zeilen")} {t("ohne Test")}</small>
                          </button>
                        ))}
                      </section>
                    )}
                    {coverageFiles.some((file) => file.summary) && (
                      <section className="coverage-summary">
                        <header><Eye size={14} /> {t("Coverage nach Klasse und Methode")}</header>
                        {coverageFiles.filter((file) => file.summary).map((file) => {
                          const summary = file.summary!;
                          const total = summary.coveredLines + summary.missedLines;
                          const percentage = total ? Math.round((summary.coveredLines / total) * 100) : 0;
                          return (
                            <details key={file.path}>
                              <summary>
                                <strong>{summary.className}</strong>
                                <span>
                                  {percentage}% · {summary.coveredLines}/{total} {t("Zeilen")}
                                  {/* The weaker number is the one people quote. A file can read
                                      100% of lines with half its decisions never taken. */}
                                  {typeof summary.branchPercentage === "number" && summary.branchPercentage >= 0
                                    && ` · ${summary.branchPercentage}% ${t("Zweige")}`}
                                </span>
                              </summary>
                              {summary.methods.map((method) => <div key={`${method.name}:${method.descriptor}`}><span>{method.name}</span><progress max={100} value={method.percentage} /><b>{method.percentage}%</b></div>)}
                            </details>
                          );
                        })}
                      </section>
                    )}
                  </div>
                )}
                {view === "todos" && (
                  <div className="todo-view">
                    <div className="todo-toolbar">
                      <select value={taskCommentFilter} onChange={(event) => setTaskCommentFilter(event.target.value)}>
                        <option value="all">{t("Alle Marker")}</option>
                        {taskMarkers.map((marker) => <option key={marker} value={marker}>{marker}</option>)}
                      </select>
                      <span>{taskComments.length} Einträge in {new Set(taskComments.map((task) => task.path)).size} Dateien</span>
                      <button onClick={() => void refreshTaskComments()} disabled={taskCommentsLoading} title={t("Projekt erneut durchsuchen")}>
                        <RefreshCw size={12} className={taskCommentsLoading ? "spinning" : ""} />
                      </button>
                    </div>
                    {taskComments.length === 0 ? (
                      <div className="empty-problems"><CircleCheck size={20} /><span>{t("Keine offenen TODOs im Projekt.")}</span></div>
                    ) : (
                      <div className="todo-list">
                        {taskComments.map((task) => (
                          <button
                            key={`${task.path}:${task.line}:${task.column}`}
                            onClick={() => void openFile(task.path, { line: task.line, column: task.column })}
                          >
                            <span className={`todo-kind todo-kind-${task.kind.toLowerCase()}`}>{task.kind}</span>
                            <span className="todo-text">{task.text || "(ohne Beschreibung)"}</span>
                            <span className="problem-location">{task.name} [{task.line}]</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {view === "http" && (
                  <div className="http-view">
                    <div className="http-toolbar">
                      <button onClick={() => void sendHttpRequest()} disabled={activeFile?.language !== HTTP_LANGUAGE_ID || Boolean(httpPending)}>
                        <Play size={12} /> Anfrage senden
                      </button>
                      {httpPending && (
                        <button className="http-cancel" onClick={() => void window.kiwi?.http.cancel(httpPending.id)}>
                          <Square size={12} /> Abbrechen
                        </button>
                      )}
                      <span>{httpPending ? `${httpPending.name} läuft…` : `${httpResponses.length} Antworten`}</span>
                      {httpResponses.length > 0 && (
                        <button onClick={() => setHttpResponses([])} title={t("Verlauf leeren")}><Trash2 size={12} /></button>
                      )}
                    </div>
                    {httpResponses.length === 0 && !httpPending ? (
                      <div className="empty-problems">
                        <Globe size={20} />
                        <span>{t("Noch keine Antwort. Lege eine .http-Datei an und sende eine Anfrage.")}</span>
                      </div>
                    ) : (
                      <div className="http-list">
                        {httpResponses.map((response) => (
                          <details key={response.id} open={response.id === httpResponses[0]?.id}>
                            <summary>
                              <span className={`http-status http-status-${response.ok ? "ok" : "fail"}`}>{response.status}</span>
                              <span className="http-name">{response.name}</span>
                              <span className="http-meta">
                                {response.request.method} · {response.durationMs} ms · {response.bytes} B
                                {response.truncated ? " · gekürzt" : ""}
                              </span>
                            </summary>
                            <div className="http-detail">
                              <div className="http-headers">
                                {response.headers.map((header) => (
                                  <div key={header.name}><span>{header.name}</span>{header.value}</div>
                                ))}
                              </div>
                              <pre>{response.body || "(leerer Rumpf)"}</pre>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {view === "problems" && (
                  <div className="problems-view">
                    <div className="problem-toolbar">
                      {([
                        ["all", `Alle ${diagnostics.length}`],
                        ["error", `Fehler ${diagnosticCounts.error}`],
                        ["warning", `Warnungen ${diagnosticCounts.warning}`],
                        ["info", `Hinweise ${diagnosticCounts.info}`],
                      ] as Array<[string, string]>).map(([id, label]) => (
                        <button
                          key={id}
                          className={diagnosticFilter === id ? "active" : ""}
                          onClick={() => setDiagnosticFilter(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {groupedDiagnostics.length === 0 ? (
                      <div className="empty-problems"><CircleCheck size={20} /><span>{t("Keine Probleme gefunden.")}</span></div>
                    ) : (
                      <div className="problem-groups">
                        {groupedDiagnostics.map(([file, items]) => (
                          <div className="problem-group" key={file}>
                            <div className="problem-group-header">
                              <FileCode2 size={13} />
                              <strong>{basename(file)}</strong>
                              <small>{relativePath(workspaceRoot, file) || file}</small>
                              <span>{items.length}</span>
                            </div>
                            {items.map((diagnostic, index) => (
                              <button key={`${diagnostic.path}:${diagnostic.line}:${index}`} onClick={() => selectDiagnostic(diagnostic)}>
                                {diagnostic.severity === "error"
                                  ? <CircleX size={15} className="severity-error" />
                                  : diagnostic.severity === "warning"
                                    ? <CircleAlert size={15} className="severity-warning" />
                                    : <Info size={15} className="severity-info" />}
                                <span className="problem-message">{diagnostic.message}</span>
                                {diagnostic.source && <span className="problem-source">{diagnostic.source}</span>}
                                <span className="problem-location">[{diagnostic.line}, {diagnostic.column}]</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {floating && (
                <span
                  className="panel-float-resizer"
                  role="separator"
                  aria-label={t("Größe des Fensters ändern")}
                  aria-orientation="vertical"
                  tabIndex={0}
                  onPointerDown={beginFloatingResize}
                  onKeyDown={(event) => {
                    const horizontal = event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0;
                    const vertical = event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0;
                    if (!horizontal && !vertical) return;
                    event.preventDefault();
                    setFloatingBounds((bounds) => resizedFloatingBounds(bounds, horizontal, vertical, effectiveViewport()));
                  }}
                />
              )}
            </section>
    );
  };

  /**
   * What a detached tool window has to draw.
   *
   * Built from the very state the workbench renders from, so the window on the
   * other monitor shows the same thing by construction rather than by a second
   * implementation that has to be kept in step.
   */
  const panelSnapshot = (): PanelWindowSnapshot => ({
    projectRoot: workspaceRoot,
    projectName,
    view: panel,
    tabs: panelTabs.filter(([id]) => id !== "tailer").map(([id, label]) => ({ id, label })),
    running,
    theme: settings.theme,
    settings,
    roundness: settings.uiRoundness,
    problems: {
      filter: diagnosticFilter,
      counts: { all: diagnostics.length, ...diagnosticCounts },
      groups: groupedDiagnostics.map(([file, items]) => ({
        file,
        name: basename(file),
        relative: relativePath(workspaceRoot, file) || file,
        items,
      })),
    },
    todos: taskComments.map((comment) => ({
      path: comment.path,
      name: basename(comment.path),
      line: comment.line,
      column: comment.column,
      kind: comment.kind,
      text: comment.text,
    })),
    output: {
      kind: panel === "run" ? "run" : panel === "build" ? "build" : "output",
      text: output,
      exitCode: lastProcessExitCode,
    },
    debug: {
      status: debugStatus,
      output: debugOutput,
      variables: debugVariables,
      threads: debugThreads,
      frames: debugStack,
      watches: debugWatches.map((watch) => ({ expression: watch.expression, value: watch.value })),
    },
    tests: testReports,
    http: httpResponses.map((response) => ({
      id: response.id,
      method: response.request.method,
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      durationMs: response.durationMs,
      body: response.body.slice(0, 200_000),
    })),
    terminal: { sessions: terminalSessions, active: activeTerminalId, output: terminalOutput },
  });
  panelSnapshotRef.current = panelSnapshot;

  /**
   * The row under the editor.
   *
   * Only the middle place lives here now. The two corners sit at the foot of
   * the Explorer and build tool columns instead, where they take their width
   * from a column that already exists rather than from the file being edited.
   */
  const renderBottomRow = () => {
    const windows = [renderToolWindow("bottom")].filter(Boolean);
    if (!windows.length) return null;
    return (
      <div className="bottom-row" style={{ height: panelHeight, flexBasis: panelHeight }}>
        <div
          className="workbench-resizer panel-resizer"
          role="separator"
          aria-label={t("Höhe des unteren Panels ändern")}
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={(event) => beginWorkbenchResize("panel", event, "bottom")}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") setPanelHeight((value) => resizedPanelHeight(value, -10, effectiveViewport().height));
            else if (event.key === "ArrowDown") setPanelHeight((value) => resizedPanelHeight(value, 10, effectiveViewport().height));
            else return;
            event.preventDefault();
          }}
        />
        <div className="bottom-row-windows">{windows}</div>
      </div>
    );
  };

  /**
   * Side outputs share the real tab strip of the column they land in.
   *
   * The old layout put Explorer above Terminal and Gradle above Problems. That
   * was two independently headed panes inside one narrow column. A side dock is
   * now a sibling tab of those tools and therefore owns the complete column
   * while selected. Bottom, floating and detached windows keep their previous
   * layout unchanged.
   */
  // A tool window docked to a corner sits at the foot of a column that is
  // already there — the Explorer's on the left, the build tool's on the right
  // — and owns a height inside it. The middle keeps the row under the editor.
  // Nothing takes width away from the file being edited any more.
  const bottomLeftWindow = renderToolWindow("bottom-left");
  const bottomRightWindow = renderToolWindow("bottom-right");

  return (
    <div
      className={`app-shell density-${settings.uiDensity} ${settings.sidebarPosition === "right" ? "sidebar-right" : ""} ${backgroundImageData ? "has-workspace-background" : ""} ${settings.compactMode ? "compact-ui" : ""} ${focusMode ? "focus-mode" : ""} ${settings.reducedMotion ? "reduced-motion" : ""} ${settings.screenReaderMode ? "screen-reader-mode" : ""} ${settings.enhancedFocus ? "enhanced-focus" : ""}`}
      style={shellStyle}
      onClick={() => {
        if (topMenu) setTopMenu(null);
        if (toolbarMenuOpen) setToolbarMenuOpen(false);
        if (tabContext) setTabContext(null);
        if (activityBarMenu) setActivityBarMenu(null);
        if (railMenu) setRailMenu(null);
        if (projectSwitcherOpen) setProjectSwitcherOpen(false);
      }}
    >
      {projectLoading && (
        <div className="workspace-loading-overlay">
          <BusyIndicator label={projectLoading.label} detail={projectLoading.detail} progress={projectLoading.progress} />
        </div>
      )}
      <UpdateProgress state={updateRuntime} />
      <header className="titlebar">
        <div className="brand">
          <KiwiLogo size={23} />
          <strong>{t("Kiwi")}</strong>
        </div>
        {/* IntelliJ-style project switcher, left of the menus. */}
        <div className="project-switcher" onClick={(event) => event.stopPropagation()}>
          <button
            className={projectSwitcherOpen ? "active" : ""}
            aria-haspopup="menu"
            aria-expanded={projectSwitcherOpen}
            title={workspaceRoot || "Kein Projekt geöffnet"}
            onClick={() => setProjectSwitcherOpen((value) => !value)}
          >
            <FolderOpen size={13} />
            <span>{workspaceRoot ? projectName : t("Kein Projekt")}</span>
            <ChevronDown size={12} />
          </button>
          {projectSwitcherOpen && (
            <div className="project-switcher-menu" role="menu">
              {switcherProjects.map((project) => (
                <button
                  key={project.root}
                  role="menuitem"
                  className={project.root === workspaceRoot ? "active" : ""}
                  disabled={!project.exists}
                  title={project.root}
                  onClick={() => {
                    setProjectSwitcherOpen(false);
                    if (project.root !== workspaceRoot) void loadWorkspace(project.root);
                  }}
                >
                  <FolderOpen size={13} />
                  <span><strong>{project.name}</strong><small>{project.root}</small></span>
                  {/* How far it has been prepared, when there is something to
                      say. Never a reason not to open it — a project that could
                      not be prepared is one that opens the slow way. */}
                  {projectReadiness.get(project.root) && projectReadiness.get(project.root) !== "not-loaded" ? (
                    <em className={`project-readiness ${projectReadiness.get(project.root)}`}>
                      {t(readinessLabel(projectReadiness.get(project.root)!))}
                    </em>
                  ) : null}
                  {project.root === workspaceRoot && <Check size={13} />}
                </button>
              ))}
              <div className="context-separator" />
              <button role="menuitem" onClick={() => { setProjectSwitcherOpen(false); void openWorkspace(); }}>
                <Plus size={13} /><span>{t("Projekt öffnen …")}</span>
              </button>
              <button role="menuitem" onClick={() => { setProjectSwitcherOpen(false); void window.kiwi?.app.showWelcome(); }}>
                <LayoutGrid size={13} /><span>{t("Projekt-Hub")}</span>
              </button>
            </div>
          )}
        </div>
        <nav className="menu-nav" aria-label={t("Hauptmenü")} onClick={(event) => event.stopPropagation()}>
          {Object.entries(menuDefinitions).map(([menu, items]) => (
            <div className="menu-item-wrap" key={menu}>
              <button className={topMenu === menu ? "active" : ""} onClick={() => setTopMenu(topMenu === menu ? null : menu)}>{t(menu)}</button>
              {topMenu === menu && (
                <div className="menu-dropdown">
                  {items.map((item) => (
                    <button key={item.label} onClick={() => { item.action?.(); setTopMenu(null); }}>
                      <span>{t(item.label)}</span><kbd>{item.shortcut}</kbd>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <button
          className="command-center"
          onClick={() => {
            setPaletteMode("everywhere");
            setPaletteQuery("");
            setPaletteOpen(true);
          }}
        >
          <Search size={13} />
          <span>{workspaceRoot ? projectName : "Datei oder Befehl suchen"}</span>
          <kbd>{t("Ctrl P")}</kbd>
        </button>
        <div className="title-project">{activeFile ? `${activeFile.name} — ` : ""}{projectName}</div>
        <div className="window-controls">
          <button onClick={() => window.kiwi?.app.minimize()} aria-label={t("Minimieren")}><Minus size={15} /></button>
          <button onClick={() => window.kiwi?.app.maximize()} aria-label={t("Maximieren")}><Maximize2 size={13} /></button>
          <button className="close" onClick={() => window.kiwi?.app.close()} aria-label={t("Schließen")}><X size={15} /></button>
        </div>
      </header>

      <div className="main-toolbar">
        <div className="toolbar-run">
          <select
            value={activeRunConfigId}
            onChange={(event) => {
              if (event.target.value === "__edit") {
                setEditingRunConfig(activeRunConfiguration);
                setRunConfigOpen(true);
              } else setActiveRunConfigId(event.target.value);
            }}
            disabled={!workspaceRoot}
            aria-label={t("Run-Konfiguration")}
          >
            <option value="">{t("Aktuelle Java-Datei")}</option>
            {runConfigurations
              .slice()
              .sort((left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) || (left.group || "").localeCompare(right.group || "") || left.name.localeCompare(right.name))
              .map((configuration) => <option value={configuration.id} key={configuration.id}>{configuration.favorite ? "★ " : ""}{configuration.group ? `${configuration.group} · ` : ""}{configuration.name}</option>)}
            <option value="__edit">{t("Konfigurationen bearbeiten…")}</option>
          </select>
          {settings.toolbarActions.includes("run") && <button className="toolbar-run-button" onClick={() => void runJava("run")} disabled={!workspaceRoot || running} title={t("Run (F5)")}><Play size={15} fill="currentColor" /></button>}
          {settings.toolbarActions.includes("debug") && <button className="toolbar-debug-button" onClick={() => void startDebug()} disabled={!workspaceRoot || debugStatus !== "stopped"} title={t("Debug")}><Bug size={15} /></button>}
          {settings.toolbarActions.includes("stop") && <button className="toolbar-stop" disabled={!running && debugStatus === "stopped"} onClick={() => { void stopJava(); void window.kiwi?.debug.stop(); }} title={t("Stop")}><Square size={13} fill="currentColor" /></button>}
        </div>
        {settings.toolbarActions.includes("search") && <button className="toolbar-search" onClick={() => { setPaletteMode("everywhere"); setPaletteQuery(""); setPaletteOpen(true); }}><Search size={14} /><span>{t("Überall suchen")}</span><kbd>{t("Ctrl P")}</kbd></button>}
        <div className="context-toolbar">
          {activeFile?.language === "java" && (
            <button title={t("Quick Fix und Intentionen (Alt+Enter)")} onClick={() => editorRef.current?.trigger("toolbar", "editor.action.quickFix", {})}>
              <WandSparkles size={14} /><span>{t("Quick Fix")}</span>
            </button>
          )}
          {activeFile && /(?:pom\.xml|build\.gradle(?:\.kts)?)$/i.test(activeFile.name) && (
            <button title={t("Build-Projekt synchronisieren")} onClick={() => void scheduleProjectSync(workspaceRoot, activeFile.path)}>
              <RefreshCw size={14} /><span>{t("Synchronisieren")}</span>
            </button>
          )}
        </div>
        <div className="toolbar-overflow">
          <button className={toolbarMenuOpen ? "active" : ""} onClick={(event) => {
            event.stopPropagation();
            setToolbarMenuOpen((value) => !value);
          }} title={t("Weitere Aktionen")}><Ellipsis size={17} /></button>
          {toolbarMenuOpen && (
            <div className="toolbar-overflow-menu" onClick={(event) => event.stopPropagation()}>
              <label className="overflow-project-select">
                <span>{t("Projekt")}</span>
                <select value={workspaceRoot} onChange={(event) => void loadWorkspace(event.target.value)}>
                  {workspaceState.projects.filter((project) => project.exists).map((project) => <option key={project.root} value={project.root}>{project.name}</option>)}
                </select>
              </label>
              <button onClick={() => { void openWorkspace(); setToolbarMenuOpen(false); }}><FolderOpen size={14} /><span>{t("Projekt öffnen…")}</span></button>
              <button onClick={() => { openNewProject(); setToolbarMenuOpen(false); }}><Plus size={14} /><span>{t("Neues Projekt…")}</span></button>
              <div className="context-separator" />
              <button onClick={() => { void runJava("build"); setToolbarMenuOpen(false); }}><Hammer size={14} /><span>{t("Projekt bauen")}</span><kbd>{t("Ctrl Shift B")}</kbd></button>
              <button onClick={() => { void runTest(); setToolbarMenuOpen(false); }}><TestTube2 size={14} /><span>{t("Tests ausführen")}</span></button>
              <button onClick={() => { setEditingRunConfig(activeRunConfiguration); setRunConfigOpen(true); setToolbarMenuOpen(false); }}><Play size={14} /><span>{t("Run-Konfigurationen…")}</span></button>
              <div className="context-separator" />
              {builtInLayouts.map((layout) => (
                <button key={layout.id} onClick={() => {
                  applyWorkbenchLayout(layout);
                  if (layout.id === "git-review") setActiveDocument("git-commit");
                  setToolbarMenuOpen(false);
                }}><PanelBottom size={14} /><span>Profil: {layout.name}</span></button>
              ))}
              {layoutProfiles.map((layout) => <button key={layout.id} onClick={() => { applyWorkbenchLayout(layout); setToolbarMenuOpen(false); }}><Columns2 size={14} /><span>{layout.name}</span></button>)}
              <button onClick={() => { saveWorkbenchLayout(); setToolbarMenuOpen(false); }}><Save size={14} /><span>{t("Aktuelles Layout speichern…")}</span></button>
              <button onClick={() => { resetWorkbenchViews(); setToolbarMenuOpen(false); }}><RotateCcw size={14} /><span>{t("Ansicht zurücksetzen")}</span></button>
              <button onClick={() => { setFocusMode((value) => !value); setToolbarMenuOpen(false); }}><Focus size={14} /><span>{focusMode ? "Fokusmodus beenden" : "Fokusmodus"}</span><kbd>{t("Ctrl Shift F11")}</kbd></button>
              <div className="context-separator" />
              <button onClick={() => { void repairProject(); setToolbarMenuOpen(false); }}><WandSparkles size={14} /><span>{t("Projekt reparieren")}</span></button>
              <button onClick={() => { openSettingsDocument(); setToolbarMenuOpen(false); }}><Settings size={14} /><span>{t("Einstellungen")}</span><kbd>{t("Ctrl ,")}</kbd></button>
            </div>
          )}
        </div>
      </div>

      {operations.length > 0 && (
        <button className="background-progress" onClick={() => setOperationsOpen((value) => !value)} aria-label={t("Hintergrundvorgänge anzeigen")}>
          <LoaderCircle size={13} className="kiwi-spinner" />
          <span><strong>{operations[0].label}</strong><small>{operations[0].detail || basename(operations[0].projectRoot)}</small></span>
          {operations.length > 1 && <b>+{operations.length - 1}</b>}
          <progress />
        </button>
      )}

      {operationsOpen && (
        <div className="operation-center" role="region" aria-label={t("Hintergrundvorgänge und Leistungswerte")}>
          <header><strong>{t("Hintergrundvorgänge")}</strong><button onClick={() => setOperationsOpen(false)}><X size={14} /></button></header>
          {operations.length === 0 ? <div className="operation-empty"><CircleCheck size={17} /> {t("Alle Vorgänge abgeschlossen")}</div> : operations.map((operation) => (
            <div className="operation-row" key={operation.id}>
              <RefreshCw size={14} className="spin" />
              <span>
                <strong>
                  {operation.label}
                  {operation.progress && <em className="operation-count">{operation.progress.done}/{operation.progress.total}</em>}
                </strong>
                <small>{operation.detail || basename(operation.projectRoot)}</small>
                {operation.progress && (
                  <span
                    className="operation-progress"
                    role="progressbar"
                    aria-valuenow={operation.progress.done}
                    aria-valuemin={0}
                    aria-valuemax={operation.progress.total}
                  >
                    <span style={{ width: `${Math.round((operation.progress.done / operation.progress.total) * 100)}%` }} />
                  </span>
                )}
              </span>
              {operation.cancellable && <button title={t("Abbrechen")} onClick={() => {
                if (operation.kind === "index" || operation.kind === "sync") void window.kiwi?.language.stop(operation.projectRoot);
                else if (operation.kind === "debug") void window.kiwi?.debug.stop();
                else void window.kiwi?.java.stop(operation.projectRoot);
                completeOperation(operation.id);
              }}><Square size={12} fill="currentColor" /></button>}
            </div>
          ))}
          {performanceMetrics.length > 0 && (
            <section className="performance-metrics" aria-label={t("Letzte Leistungswerte")}>
              <header><strong>{t("Leistung")}</strong><small>{t("dauerhaft lokal gespeichert")}</small></header>
              {performanceMetrics.slice(-5).reverse().map((metric) => (
                <div key={`${metric.timestamp}:${metric.kind}`}>
                  <span>{metric.kind === "startup" ? "Start" : metric.kind === "project" ? "Projekt laden" : metric.kind === "index" ? "Indexierung" : "RAM"}</span>
                  <strong>{metric.value} {metric.unit}</strong>
                </div>
              ))}
              {/* What this machine usually does, so the numbers above mean
                  something. A single measurement says what happened; only the
                  history says whether it was normal. */}
              {performanceBaselines.length > 0 && (
                <div className="performance-baselines">
                  <small>{t("Üblich auf diesem Rechner")}</small>
                  {performanceBaselines.map((line) => <small key={line}>{line}</small>)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <div className={`workspace tool-dock-${rightToolDock}`}>
        <aside
          className="activitybar"
          aria-label={t("Toolfenster")}
          onContextMenu={(event) => {
            event.preventDefault();
            setActivityBarMenu({
              x: Math.min(event.clientX, window.innerWidth - 250),
              y: Math.min(event.clientY, window.innerHeight - 40 - activityEntries.length * 30),
            });
          }}
        >
          <div className="activity-top">
            {visibleActivityEntries.map(({ id, label, icon }) => (
              <button
                key={id}
                className={activity === id ? "active" : ""}
                title={label}
                aria-label={label}
                aria-pressed={activity === id && sidebarVisible}
                draggable
                onDragStart={(event) => {
                  draggedActivityRef.current = id;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", id);
                }}
                onDragOver={(event) => {
                  if (!draggedActivityRef.current) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = draggedActivityRef.current || event.dataTransfer.getData("text/plain");
                  draggedActivityRef.current = "";
                  if (from) moveActivityEntry(from, id);
                }}
                onDragEnd={() => { draggedActivityRef.current = ""; }}
                onClick={() => {
                  if (activity === id && sidebarVisible) setSidebarVisible(false);
                  else {
                    setActivity(id as ActivityView);
                    setSidebarVisible(true);
                  }
                }}
              >
                {icon}
                {id === "source" && sourceChanges.length > 0 && <span className="activity-badge">{sourceChanges.length}</span>}
              </button>
            ))}
          </div>
          <div className="activity-bottom">
            <button
              title={t("Projektstruktur")}
              disabled={!workspaceRoot}
              onClick={() => void window.kiwi?.app.openStructure(workspaceRoot || undefined)}
            >
              <Blocks size={21} />
            </button>
            <button title={t("Einstellungen")} onClick={openSettingsDocument}><Settings size={21} /></button>
          </div>
        </aside>

        {(sidebarVisible || bottomLeftWindow) && (
          <aside className="sidebar">
            {sidebarVisible && <div className="sidebar-views">{sidebarContent()}</div>}
            {bottomLeftWindow}
            <div
              className="workbench-resizer sidebar-resizer"
              role="separator"
              aria-label={t("Breite der Seitenleiste ändern")}
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(event) => beginWorkbenchResize("sidebar", event)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") setSidebarWidth((value) => Math.max(180, value - 10));
                if (event.key === "ArrowRight") setSidebarWidth((value) => Math.min(520, value + 10));
              }}
            />
          </aside>
        )}

        <main className="main-area">
          {/* Editor and the two side tool windows share one row; the bottom
              tool window spans all three, the way IntelliJ arranges them. */}
          <div className="editor-row">
          <div className="editor-stack">
          <div className="editor-toolbar">
            <div className={`breadcrumbs ${settings.breadcrumbs ? "" : "hidden"}`}>
              {activeDocument ? (
                <>
                  <span>{projectName}</span><ChevronRight size={12} />
                  {documentTitles[activeDocument].icon}<strong>{documentTitles[activeDocument].label}</strong>
                </>
              ) : activeFile ? (
                <>
                  <span>{projectName}</span><ChevronRight size={12} />
                  {activeModule && <><span>{activeModule.name}</span><ChevronRight size={12} /></>}
                  {javaBreadcrumb?.packageName && <><span>{javaBreadcrumb.packageName}</span><ChevronRight size={12} /></>}
                  {(() => {
                    const rel = relativePath(workspaceRoot, activeFile.path);
                    const segments = relativePathBreadcrumbs(rel);
                    const folders = segments.slice(0, -1);
                    const symbol = enclosingCodeSymbol(activeFile.content, cursor.line, activeFile.language);
                    return (
                      <>
                        {folders.map((folder) => (
                          <Fragment key={folder.path}>
                            <span>{folder.label}</span>
                            <ChevronRight size={12} />
                          </Fragment>
                        ))}
                        <FileTypeIcon name={activeFile.name} size={13} />
                        <strong>{javaBreadcrumb?.className || activeFile.name}</strong>
                        {(javaBreadcrumb?.methodName || symbol?.name) && (
                          <>
                            <ChevronRight size={12} />
                            <span style={{ color: "var(--accent-color, #4ec9b0)" }}>
                              {javaBreadcrumb?.methodName ? `${javaBreadcrumb.methodName}()` : symbol?.name}
                            </span>
                          </>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : null}
            </div>
            <div className="editor-actions">
              {(activeFile?.language === "java" || isPolyglotLanguage(activeFile?.language || "")) && (
                <>
                  <button
                    onClick={() => void runJava("run")}
                    disabled={running}
                    title={runActionTitle}
                  >
                    <Play size={14} fill="currentColor" /><span>{t("Run")}</span>
                  </button>
                  <button
                    onClick={() => void runJava("debug")}
                    disabled={running}
                    title={t("Debug starten")}
                  >
                    <Bug size={14} /><span>{t("Debug")}</span>
                  </button>
                </>
              )}
              {running && <button className="danger" onClick={() => void stopJava()} title={t("Prozess beenden")}><Square size={13} fill="currentColor" /></button>}
              <button
                onClick={() => setActiveDocument("web-preview")}
                title={t("Live Web-Preview öffnen")}
                className={activeDocument === "web-preview" ? "active" : ""}
              >
                <Globe size={14} /><span>Preview</span>
              </button>
              {(projectInfo.type === "JavaScript" || projectInfo.type === "TypeScript" || projectInfo.type === "Node.js" || activeFile?.name === "package.json") && (
                <button
                  onClick={() => setActiveDocument("npm-packages")}
                  title={t("NPM-Pakete verwalten")}
                  className={activeDocument === "npm-packages" ? "active" : ""}
                >
                  <Package size={14} /><span>NPM</span>
                </button>
              )}
              <button
                onClick={() => setActiveDocument("scratchpad")}
                title={t("Scratchpad & Projekt-Notizen öffnen")}
                className={activeDocument === "scratchpad" ? "active" : ""}
              >
                <FileText size={14} /><span>Notes</span>
              </button>
              <button title={t("Dateiaktionen")} className={editorMenuOpen ? "active" : ""} onClick={() => setEditorMenuOpen((value) => !value)}><Ellipsis size={15} /></button>
              {editorMenuOpen && (
                <div className="editor-actions-menu">
                  <button onClick={() => { setSplitPath((current) => current ? null : openFiles.find((file) => file.path !== activePath)?.path || activePath); setEditorMenuOpen(false); }}><Columns2 size={14} /><span>{t("Editor teilen")}</span></button>
                  <button onClick={() => { editorRef.current?.trigger("toolbar", "editor.action.formatDocument", {}); setEditorMenuOpen(false); }}><Braces size={14} /><span>{t("Datei formatieren")}</span></button>
                  <button onClick={() => { setActiveDocument("web-preview"); setEditorMenuOpen(false); }}><Globe size={14} /><span>{t("Live Web-Preview")}</span></button>
                  <button onClick={() => { setActiveDocument("npm-packages"); setEditorMenuOpen(false); }}><Package size={14} /><span>{t("NPM-Pakete")}</span></button>
                  <button onClick={() => { setActiveDocument("database"); setEditorMenuOpen(false); }}><Database size={14} /><span>{t("Datenbank-Browser")}</span></button>
                  <button onClick={() => { setActiveDocument("docker"); setEditorMenuOpen(false); }}><Container size={14} /><span>{t("Docker & Container")}</span></button>
                  <button onClick={() => { setActiveDocument("git-graph"); setEditorMenuOpen(false); }}><GitBranch size={14} /><span>{t("Visueller Git-Graph")}</span></button>
                  <button onClick={() => { setActiveDocument("scratchpad"); setEditorMenuOpen(false); }}><FileText size={14} /><span>{t("Scratchpad & Notizen")}</span></button>
                  {activeFile?.language === "java" && (
                    <>
                      <button onClick={() => { const model = editorRef.current?.getModel(); if (model) void languageProviderRef.current?.organizeImports(model); setEditorMenuOpen(false); }}><ListTree size={14} /><span>{t("Imports organisieren")}</span></button>
                      <button onClick={() => { void runTest(); setEditorMenuOpen(false); }}><TestTube2 size={14} /><span>{t("Tests ausführen")}</span></button>
                    </>
                  )}
                  <button onClick={() => { void showLocalHistory(); setEditorMenuOpen(false); }}><History size={14} /><span>{t("Lokale Historie")}</span></button>
                  <button onClick={() => { void window.kiwi?.file.reveal(activeFile?.path || workspaceRoot); setEditorMenuOpen(false); }}><FolderOpen size={14} /><span>{t("Im Explorer anzeigen")}</span></button>
                </div>
              )}
            </div>
          </div>

          {(openFiles.length > 0 || activeDocument) && (
            <div className="tab-strip">
            <div className="tabs" ref={tabStripRef}>
              {openFiles.map((file) => {
                const dirty = isUnsaved(file);
                const tabModule = moduleInfos
                  .filter((module) => isPathWithin(file.path, module.root))
                  .sort((left, right) => right.root.length - left.root.length)[0];
                return (
                  <button
                    className={`tab ${file.preview ? "preview" : ""} ${file.pinned ? "pinned" : ""} ${!activeDocument && activePath === file.path ? "active" : ""}`}
                    key={file.path}
                    onClick={() => {
                      setActiveDocument(null);
                      setActivePath(file.path);
                    }}
                    onDoubleClick={() => {
                      // Makes a preview tab permanent and nothing more. It used
                      // to pin as well, which is a different thing entirely — a
                      // pinned tab does not close with the others — and it was
                      // far too easy to hit by accident. Pinning has the tab's
                      // own button and its context menu.
                      setOpenFiles((files) => files.map((item) =>
                        item.path === file.path ? { ...item, preview: false } : item,
                      ));
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveDocument(null);
                      setActivePath(file.path);
                      setTabContext({
                        x: Math.min(event.clientX, window.innerWidth - 270),
                        y: Math.min(event.clientY, window.innerHeight - 230),
                        path: file.path,
                      });
                    }}
                    draggable
                    onDragStart={(event) => {
                      draggedTabRef.current = file.path;
                      event.dataTransfer.effectAllowed = "move";
                      // Firefox refuses to start a drag without payload, and
                      // the path is the identity the drop needs anyway.
                      event.dataTransfer.setData("text/plain", file.path);
                    }}
                    onDragOver={(event) => {
                      if (!draggedTabRef.current) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = draggedTabRef.current || event.dataTransfer.getData("text/plain");
                      draggedTabRef.current = "";
                      if (from) moveTab(from, file.path);
                    }}
                    onDragEnd={() => { draggedTabRef.current = ""; }}
                    data-file-path={file.path}
                    title={file.path}
                  >
                    {tabModule && <span className="tab-module-dot" style={{ "--tab-module-hue": stableHue(tabModule.id) } as CSSProperties} title={`Modul ${tabModule.name}`} />}
                    <FileTypeIcon name={file.name} />
                    <span className="tab-label">{file.name}</span>
                    {file.pinned && (
                      <span
                        className="tab-pin"
                        title={t("Tab lösen")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenFiles((files) => files.map((item) => item.path === file.path
                            ? { ...item, pinned: false, preview: true }
                            : item));
                        }}
                      ><Pin size={10} /></span>
                    )}
                    <span
                      className={`tab-close ${dirty ? "dirty" : ""}`}
                      onClick={(event) => { event.stopPropagation(); closeFile(file.path); }}
                    >
                      {dirty ? <span className="dirty-dot" /> : <X size={13} />}
                    </span>
                  </button>
                );
              })}
              {activeDocument && (
                <button className="tab workbench-tab active" onClick={() => void 0}>
                  {documentTitles[activeDocument].icon}
                  <span>{documentTitles[activeDocument].label}</span>
                  <span className="tab-close" onClick={(event) => {
                    event.stopPropagation();
                    if (activeDocument === "refactor-preview") completeRefactorPreview(false);
                    else {
                      setActiveDocument(null);
                      if (activeDocument === "git-merge") setMergeEditor(null);
                      if (activeDocument === "java-refactor") setJavaRefactorPlan(null);
                    }
                  }}><X size={13} /></span>
                </button>
              )}
              <div className="tabs-spacer" />
            </div>
            {hiddenTabs.length > 0 && (
            <div className="tab-overflow">
              <button
                className={`tab-overflow-button ${tabOverflowOpen ? "active" : ""}`}
                title={`${hiddenTabs.length} ${hiddenTabs.length === 1 ? "weiterer Tab" : "weitere Tabs"}`}
                aria-label={t("Weitere Tabs")}
                aria-expanded={tabOverflowOpen}
                onClick={() => setTabOverflowOpen((open) => !open)}
              >
                <ChevronDown size={14} />
                <span className="tab-overflow-count">{hiddenTabs.length}</span>
              </button>
              {tabOverflowOpen && (
                <div className="tab-overflow-menu" role="menu">
                  {openFiles
                    .filter((file) => hiddenTabs.some((path) => samePath(path, file.path)))
                    .map((file) => {
                      const dirty = isUnsaved(file);
                      return (
                        <div
                          key={file.path}
                          className={`tab-overflow-item ${!activeDocument && activePath === file.path ? "active" : ""}`}
                        >
                          <button
                            className="tab-overflow-open"
                            title={file.path}
                            onClick={() => {
                              setActiveDocument(null);
                              setActivePath(file.path);
                              setTabOverflowOpen(false);
                              // Chosen from the list, so it belongs in view:
                              // otherwise it stays hidden and the click looks
                              // as though it did nothing.
                              window.requestAnimationFrame(() => {
                                tabStripRef.current
                                  ?.querySelector<HTMLElement>(`.tab[data-file-path="${CSS.escape(file.path)}"]`)
                                  ?.scrollIntoView({ block: "nearest", inline: "nearest" });
                              });
                            }}
                            // The same menu the tab itself offers, so nothing
                            // is out of reach just because the strip is full.
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setTabOverflowOpen(false);
                              setActiveDocument(null);
                              setActivePath(file.path);
                              setTabContext({
                                x: Math.min(event.clientX, window.innerWidth - 270),
                                y: Math.min(event.clientY, window.innerHeight - 230),
                                path: file.path,
                              });
                            }}
                          >
                            <FileTypeIcon name={file.name} />
                            <span className="tab-overflow-name">{file.name}</span>
                            <small>{relativePath(workspaceRoot, file.path)}</small>
                          </button>
                          <span
                            className="tab-overflow-pin"
                            title={file.pinned ? t("Tab lösen") : t("Tab anheften")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenFiles((files) => files.map((item) => samePath(item.path, file.path)
                                ? { ...item, pinned: !file.pinned, preview: file.pinned }
                                : item));
                            }}
                          ><Pin size={11} /></span>
                          <span
                            className={`tab-overflow-close ${dirty ? "dirty" : ""}`}
                            title={t("Schließen")}
                            onClick={(event) => { event.stopPropagation(); closeFile(file.path); }}
                          >
                            {dirty ? <span className="dirty-dot" /> : <X size={12} />}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            )}
            </div>
          )}

          <div className="editor-container">
            {activeDocument ? renderWorkbenchDocument() : activeFile ? (
              <div className={`editor-grid ${splitFile ? "split" : ""}`}>
                {renderCodeEditor(activeFile, true)}
                {splitFile && renderCodeEditor(splitFile, false)}
              </div>
            ) : (
              <section className="editor-empty-state" aria-label={t("Keine Datei geöffnet")}>
                <KiwiLogo size={112} className="editor-empty-logo" />
              </section>
            )}
            {loadingFiles.size > 0 && (
              <div className="editor-loading-overlay">
                <BusyIndicator label="Datei wird geöffnet" detail={basename([...loadingFiles][0])} />
              </div>
            )}
          </div>
          </div>
          </div>

          {panelDropEdge && (
            <div
              className={`panel-drop-hint panel-drop-${panelDropEdge}`}
              style={panelDropHintStyle(panelDropEdge)}
              aria-hidden="true"
            >
              {panelDropEdge === "window" && <span>{t("Eigenes Fenster")}</span>}
            </div>
          )}
          {renderBottomRow()}
        </main>
        {/* The build tool window's column. A tool window docked right joins it
            rather than opening a second narrow column beside it, and holds the
            column open on its own when the build tool is closed. */}
        {((workspaceRoot && rightTool) || bottomRightWindow) && (
          <aside className="right-tool-window" data-right-tool={rightTool || undefined}>
            <div
              className={`workbench-resizer right-tool-resizer ${rightToolDock}`}
              role="separator"
              aria-label={t("Größe des rechten Toolfensters ändern")}
              aria-orientation={rightToolDock === "bottom" ? "horizontal" : "vertical"}
              tabIndex={0}
              onPointerDown={(event) => beginWorkbenchResize("rightTool", event)}
              onKeyDown={(event) => {
                const grow = event.key === "ArrowLeft" || event.key === "ArrowUp";
                const shrink = event.key === "ArrowRight" || event.key === "ArrowDown";
                if (grow) setRightToolSize((value) => Math.min(620, value + 10));
                if (shrink) setRightToolSize((value) => Math.max(rightToolDock === "bottom" ? 150 : 220, value - 10));
              }}
            />
            {workspaceRoot && rightTool && (<>
            <div
              className="right-tool-header"
              draggable
              title={t("Ziehen, um das Toolfenster links, rechts oder unten anzudocken")}
              onDragEnd={(event) => {
                const nextDock = event.clientY > window.innerHeight * 0.72
                  ? "bottom"
                  : event.clientX < window.innerWidth * 0.42 ? "left" : "right";
                setRightToolDock(nextDock);
                localStorage.setItem("kiwi.workbench.dock", nextDock);
              }}
            >
              <span>
                {rightTool === "build" ? <Blocks size={13} /> : rightTool === "dependencies" ? <Network size={13} /> : <Users size={13} />}
                {rightTool === "build" ? projectInfo.type : rightTool === "dependencies" ? t("Abhängigkeiten") : "CodeToGetter"}
              </span>
              <div>
                <IconButton label="Aktionen" active={rightToolMenuOpen} onClick={() => setRightToolMenuOpen((value) => !value)}><Ellipsis size={15} /></IconButton>
                <IconButton label="Schließen" onClick={() => { setRightToolMenuOpen(false); setRightTool(null); }}><X size={14} /></IconButton>
              </div>
              {rightToolMenuOpen && (
                <div className="right-tool-menu" role="menu">
                  {rightTool !== "collab" && <>
                    <button onClick={() => { void refreshProjectTools(); setRightToolMenuOpen(false); }}><RefreshCw size={13} /><span>{t("Neu laden")}</span></button>
                    <button onClick={() => {
                      if (workspaceRoot && projectInfo.buildFile) void scheduleProjectSync(workspaceRoot, `${workspaceRoot}\\${projectInfo.buildFile}`);
                      setRightToolMenuOpen(false);
                    }} disabled={!projectInfo.buildFile}><RotateCcw size={13} /><span>{t("Projekt synchronisieren")}</span></button>
                  </>}
                  {rightTool === "build" ? (
                    <>
                      <div className="context-separator" />
                      {["build", "test", "clean"].map((name) => <button key={name} onClick={() => {
                        void runProjectTask({ name, description: `${projectInfo.type} ${name}` });
                        setRightToolMenuOpen(false);
                      }}><Play size={12} /><span>{name}</span></button>)}
                      <button onClick={() => {
                        void updateProjectSettings(projectInfo.type === "Maven"
                          ? { mavenOffline: !projectInfo.mavenOffline }
                          : { gradleOffline: !projectInfo.gradleOffline });
                        setRightToolMenuOpen(false);
                      }}><Download size={13} /><span>{t("Offline-Modus")}</span><kbd>{(projectInfo.type === "Maven" ? projectInfo.mavenOffline : projectInfo.gradleOffline) ? "An" : "Aus"}</kbd></button>
                      <button onClick={() => void updateProjectSettings({ autoSyncBuild: !projectInfo.autoSyncBuild })}>
                        <RefreshCw size={13} /><span>{t("Autosynchronisierung")}</span><kbd>{projectInfo.autoSyncBuild ? "An" : "Aus"}</kbd>
                      </button>
                      <button onClick={() => void updateProjectSettings({ preferWrapper: !projectInfo.preferWrapper })}>
                        <Package size={13} /><span>{t("Projekt-Wrapper bevorzugen")}</span><kbd>{projectInfo.preferWrapper ? "An" : "Aus"}</kbd>
                      </button>
                      <button onClick={() => void updateProjectSettings({ parallelBuilds: !projectInfo.parallelBuilds })}>
                        <Network size={13} /><span>{t("Parallele Builds")}</span><kbd>{projectInfo.parallelBuilds ? "An" : "Aus"}</kbd>
                      </button>
                    </>
                  ) : rightTool === "dependencies" && dependencyAudit ? (
                    <>
                      <div className="context-separator" />
                      <button onClick={() => { void runProjectTask({ name: dependencyAudit.updatesTask, description: "Dependency Updates" }); setRightToolMenuOpen(false); }}><RefreshCw size={12} /><span>{t("Updates prüfen")}</span></button>
                      <button onClick={() => { void runProjectTask({ name: dependencyAudit.securityTask, description: "Dependency Security Audit" }); setRightToolMenuOpen(false); }}><CircleAlert size={12} /><span>{t("Sicherheitsprüfung")}</span></button>
                      <button onClick={() => { void runProjectTask({ name: dependencyAudit.unusedTask, description: "Unused Dependencies" }); setRightToolMenuOpen(false); }}><Search size={12} /><span>{t("Unbenutzte Abhängigkeiten")}</span></button>
                    </>
                  ) : null}
                  {rightTool !== "collab" && <>
                    <div className="context-separator" />
                    <button onClick={() => { openSettingsDocument(); setRightToolMenuOpen(false); }}><Settings size={13} /><span>{t("Build-Einstellungen")}</span></button>
                  </>}
                  <div className="context-separator" />
                  <button onClick={() => {
                    const nextDock = rightToolDock === "right" ? "bottom" : rightToolDock === "bottom" ? "left" : "right";
                    setRightToolDock(nextDock);
                    localStorage.setItem("kiwi.workbench.dock", nextDock);
                    setRightToolMenuOpen(false);
                  }}><Columns2 size={13} /><span>Andocken: {nextDockLabel(rightToolDock)}</span></button>
                  <button onClick={() => { saveWorkbenchLayout(); setRightToolMenuOpen(false); }}><Save size={13} /><span>{t("Layout als Profil speichern…")}</span></button>
                  {layoutProfiles.map((layout) => (
                    <button key={layout.id} onClick={() => { applyWorkbenchLayout(layout); setRightToolMenuOpen(false); }}>
                      <PanelBottom size={13} /><span>Layout: {layout.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {rightTool === "build" ? (
              renderBuildTool()
            ) : rightTool === "dependencies" ? (
              <div className="dependency-tool">
                <DependencyEditor
                  workspaceRoot={workspaceRoot}
                  model={dependencyEditorModel}
                  loading={dependencyEditorLoading}
                  error={dependencyEditorError}
                  onAdd={() => setDependencyDialogOpen(true)}
                  onRefresh={() => void refreshDependencyEditor()}
                  onUpdate={(dependency: EditableDependency, version: string) => performDependencyMutation(
                    () => window.kiwi!.project.updateDependency(workspaceRoot, {
                      id: dependency.id,
                      groupId: dependency.groupId,
                      artifactId: dependency.artifactId,
                      buildFile: dependency.buildFile,
                      configuration: dependency.configuration || dependency.scope,
                      managed: dependency.managed,
                      catalogAlias: dependency.catalogAlias,
                    }, version),
                    `${dependency.artifactId} auf ${version} aktualisiert`,
                  )}
                  onRemove={(selector: DependencySelector) => performDependencyMutation(
                    () => window.kiwi!.project.removeDependency(workspaceRoot, selector),
                    "Abhängigkeit entfernt",
                  )}
                  onUpdateCatalog={(catalogPath, key, version) => performDependencyMutation(
                    () => window.kiwi!.project.updateVersionCatalog(workspaceRoot, catalogPath, key, version),
                    `${key} auf ${version} aktualisiert`,
                  )}
                />
                {dependencyAudit && (
                  <>
                    {dependencyAudit.warnings.length > 0 && (
                      <div className="dependency-warnings">
                        {dependencyAudit.warnings.map((warning, index) => (
                          <div key={`${warning.coordinate}:${index}`}><CircleAlert size={12} /><span><strong>{warning.coordinate}:{warning.version || "verwaltet"}</strong><small>{warning.message}</small></span></div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <details className="dependency-resolved-view">
                  <summary><Network size={12} /> {t("Aufgelöster Dependency-Baum")}</summary>
                <div className="dependency-view dependency-tree-view">
                  {dependencyTree?.conflicts.length ? (
                    <div className="dependency-conflict-summary"><CircleAlert size={13} /> {dependencyTree.conflicts.length} Versionskonflikt(e) erkannt</div>
                  ) : null}
                  {dependencyTree?.configurations.map((configuration) => (
                    <details className="dependency-configuration" key={configuration.name} open={dependencyTree.configurations.length === 1}>
                      <summary><Network size={12} /><strong>{configuration.name}</strong><span>{configuration.nodes.length}</span></summary>
                      {configuration.description && <small>{configuration.description}</small>}
                      <DependencyNodeTree nodes={configuration.nodes} />
                    </details>
                  ))}
                  {!dependencyTree?.configurations.length && <div className="empty-sidebar">{t("Keine auflösbaren Abhängigkeiten gefunden.")}</div>}
                  <details className="dependency-raw"><summary>{t("Rohausgabe")}</summary><pre>{dependencies}</pre></details>
                </div>
                </details>
              </div>
            ) : (
              <CodeToGetter
                workspaceRoot={workspaceRoot}
                onNotice={toast}
                onHostingChange={handleCollabHostingChange}
                followedPeer={followedPeer}
                onFollowPeer={setFollowedPeer}
                onJoined={(root) => void loadWorkspace(root)}
              />
            )}
            </>)}
            {bottomRightWindow}
          </aside>
        )}
        <aside
          className="right-rail"
          onContextMenu={(event) => {
            event.preventDefault();
            setRailMenu({
              x: Math.min(event.clientX, window.innerWidth - 250),
              y: Math.min(event.clientY, window.innerHeight - 40 - rightRailEntries.length * 30),
            });
          }}
        >
          {visibleRightRailEntries.map((entry) => (
            <button
              key={entry.id}
              className={rightTool === entry.id ? "active" : ""}
              title={entry.title}
              draggable
              onDragStart={(event) => {
                draggedRailRef.current = entry.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", entry.id);
              }}
              onDragOver={(event) => {
                if (!draggedRailRef.current) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = draggedRailRef.current || event.dataTransfer.getData("text/plain");
                draggedRailRef.current = "";
                if (from) moveRightRailEntry(from, entry.id);
              }}
              onDragEnd={() => { draggedRailRef.current = ""; }}
              onClick={() => setRightTool(rightTool === entry.id ? null : entry.id as typeof rightTool)}
            >
              {entry.icon}<span>{entry.label}</span>
            </button>
          ))}
        </aside>
      </div>

      {/* A window of its own floats above the whole workbench, so it can be put
          anywhere — including over the editor and the sidebar. */}
      {renderToolWindow("floating")}

      <footer className="statusbar">
        <div>
          <select
            className="layout-profile-switcher"
            value={activeLayoutId}
            onChange={(event) => {
              if (event.target.value === "kiwi-reset") {
                resetWorkbenchViews();
                return;
              }
              const layout = [...builtInLayouts, ...layoutProfiles].find((item) => item.id === event.target.value);
              if (layout) applyWorkbenchLayout(layout);
            }}
            aria-label={t("Workbench-Profil")}
            title={t("Workbench-Profil wechseln")}
          >
            {/* The built-in profiles are Kiwi's own words and get translated;
                a profile the user named keeps the name they gave it. */}
            {builtInLayouts.map((layout) => <option key={layout.id} value={layout.id}>{t(layout.name)}</option>)}
            {layoutProfiles.length > 0 && <optgroup label={t("Eigene Profile")}>
              {layoutProfiles.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
            </optgroup>}
            <option value="kiwi-reset">{t("Standardansicht")}</option>
          </select>
          <button onClick={() => { setActivity("source"); setSidebarVisible(true); }}><GitBranch size={13} /> {branch}</button>
          {activeModule && <button onClick={() => { setActivity("modules"); setSidebarVisible(true); }}><Blocks size={12} /> {activeModule.name}</button>}
          <button onClick={() => { setPanel("problems"); setPanelVisible(true); }}>
            <CircleX size={13} /> {diagnostics.filter((item) => item.severity === "error").length}
          </button>
        </div>
        <div>
          {/* The detail text is set in a dozen places — sync progress, index
              state, explained failures — and used to be displayed nowhere. */}
          {activeEditorLanguage !== "java" ? (
            <button className={`language-compact ${polyglotStatus[activeEditorLanguage]?.available ? "ready" : "idle"}`} title={polyglotStatus[activeEditorLanguage]?.reason || t("Integrierter Sprachdienst")}>
              <span className="status-dot" /> {languageDisplayName(activeEditorLanguage)} · {isPolyglotLanguage(activeEditorLanguage) ? (polyglotStatus[activeEditorLanguage]?.available ? "LSP" : t("Lokal")) : t("Integriert")}
            </button>
          ) : (languageStatus === "indexing" || languageStatus === "starting") ? (
            <button className="indexing-status" title={languageDetail} onClick={() => setOperationsOpen(true)}>
              <RefreshCw size={12} className="spin" /> {languageDetail || "Indexierung"}
            </button>
          ) : (
            <button
              className={`language-compact ${languageStatus}`}
              title={languageDetail || t("Java-Sprachserver")}
              onClick={() => setOperationsOpen(true)}
            >
              <span className="status-dot" /> {languageStatus === "ready" ? t("Index bereit") : languageStatus === "error" ? t("Indexfehler") : t("Java")}
            </button>
          )}
          {activeEditorLanguage === "java" && <button className="java-runtime" onClick={openSettingsDocument} title={projectInfo.jdkPath || "Kein JDK erkannt"}>
            JDK {projectInfo.languageLevel || projectInfo.jdkMajor || "fehlt"}
          </button>}
        </div>
      </footer>

      {paletteOpen && (
        <div className="overlay" onMouseDown={() => setPaletteOpen(false)}>
          <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
            <div className="palette-input">
              {paletteMode === "commands" ? <Command size={18} /> : paletteMode === "run" ? <Play size={18} /> : paletteMode === "structure" ? <ListTree size={18} /> : paletteMode === "surround" ? <Code2 size={18} /> : ["symbols", "classes"].includes(paletteMode) ? <Braces size={18} /> : paletteMode === "recent" ? <History size={18} /> : paletteMode === "bookmarks" ? <Bookmark size={18} /> : <Search size={18} />}
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                placeholder={
                  paletteMode === "structure" ? t("Datei-Struktur durchsuchen (Methoden, Felder)…")
                  : paletteMode === "surround" ? t("Auswahl umschließen (Template wählen)…")
                  : paletteMode === "run" ? "Run-Konfiguration, Task oder Befehl…"
                  : paletteMode === "commands" ? "Befehl eingeben…"
                    : paletteMode === "symbols" ? "Symbol im Projekt suchen…"
                      : paletteMode === "classes" ? "Klasse, Interface oder Enum suchen…"
                        : paletteMode === "recent" ? "Zuletzt verwendete Datei suchen…"
                          : paletteMode === "bookmarks" ? "Lesezeichen suchen…"
                            : paletteMode === "everywhere" ? "Dateien, Klassen, Symbole, Einstellungen und Aktionen…"
                              : "Datei nach Name suchen…"
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && paletteItems[0]) {
                    paletteItems[0].action?.();
                    setPaletteOpen(false);
                  }
                }}
              />
              <kbd>{t("esc")}</kbd>
            </div>
            <div className="palette-switch">
              <button className={paletteMode === "everywhere" ? "active" : ""} onClick={() => setPaletteMode("everywhere")}>{t("Überall")}</button>
              <button className={paletteMode === "files" ? "active" : ""} onClick={() => setPaletteMode("files")}>{t("Dateien")}</button>
              <button className={paletteMode === "classes" ? "active" : ""} onClick={() => setPaletteMode("classes")}>{t("Klassen")}</button>
              <button className={paletteMode === "structure" ? "active" : ""} onClick={() => setPaletteMode("structure")}>{t("Struktur")}</button>
              <button className={paletteMode === "symbols" ? "active" : ""} onClick={() => setPaletteMode("symbols")}>{t("Symbole")}</button>
              <button className={paletteMode === "recent" ? "active" : ""} onClick={() => setPaletteMode("recent")}>{t("Zuletzt")}</button>
              <button className={paletteMode === "bookmarks" ? "active" : ""} onClick={() => setPaletteMode("bookmarks")}>{t("Lesezeichen")}</button>
              <button className={paletteMode === "commands" ? "active" : ""} onClick={() => setPaletteMode("commands")}>{t("Befehle")}</button>
              <button className={paletteMode === "run" ? "active" : ""} onClick={() => setPaletteMode("run")}>{t("Ausführen")}</button>
            </div>
            <div className="palette-results">
              {paletteItems.map((item, index) => (
                <button
                  key={`${item.label}:${item.detail}`}
                  className={index === 0 ? "selected" : ""}
                  onClick={() => { item.action?.(); setPaletteOpen(false); }}
                >
                  {item.icon}<span><strong>{item.label}</strong><small>{item.detail}</small></span>
                </button>
              ))}
              {paletteItems.length === 0 && <div className="palette-empty">{t("Keine passenden Einträge.")}</div>}
            </div>
          </div>
        </div>
      )}

      {railMenu && createPortal((
        <div
          className="explorer-context-menu activity-context-menu"
          ref={clampPopupToViewport}
          style={{ left: railMenu.x, top: railMenu.y }}
          role="menu"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="context-heading">{t("Werkzeuge anzeigen")}</div>
          {orderedRightRailEntries.map((entry) => {
            const hidden = (settings.rightRailHidden || []).includes(entry.id);
            return (
              <button
                key={entry.id}
                role="menuitemcheckbox"
                aria-checked={!hidden}
                onClick={() => toggleRightRailEntry(entry.id)}
              >
                {hidden ? <Square size={14} /> : <SquareCheck size={14} />}
                <span>{entry.title}</span>
              </button>
            );
          })}
          <div className="context-separator" />
          <button onClick={() => void window.kiwi?.settings.update({ rightRailOrder: [], rightRailHidden: [] })}>
            <RefreshCw size={14} /><span>{t("Standard wiederherstellen")}</span>
          </button>
        </div>
      ), document.body)}

      {activityBarMenu && createPortal((
        <div
          className="explorer-context-menu activity-context-menu"
          ref={clampPopupToViewport}
          style={{ left: activityBarMenu.x, top: activityBarMenu.y }}
          role="menu"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="context-heading">{t("Toolfenster anzeigen")}</div>
          {orderedActivityEntries.map((entry) => {
            const hidden = (settings.activityHidden || []).includes(entry.id);
            return (
              <button
                key={entry.id}
                role="menuitemcheckbox"
                aria-checked={!hidden}
                onClick={() => toggleActivityEntry(entry.id)}
              >
                {hidden ? <Square size={14} /> : <SquareCheck size={14} />}
                <span>{entry.label}</span>
              </button>
            );
          })}
          <div className="context-separator" />
          <button onClick={() => void window.kiwi?.settings.update({ activityOrder: [], activityHidden: [] })}>
            <RefreshCw size={14} /><span>{t("Standard wiederherstellen")}</span>
          </button>
        </div>
      ), document.body)}

      {tabContext && createPortal((
        <div
          className="explorer-context-menu tab-context-menu"
          ref={clampPopupToViewport}
          style={{ left: tabContext.x, top: tabContext.y }}
          data-context-path={tabContext.path}
          role="menu"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => closeTabGroup(tabContext.path, "current")}><X size={14} /><span>{t("Fenster schließen")}</span><kbd>{t("Ctrl+F4")}</kbd></button>
          <button onClick={() => closeTabGroup(tabContext.path, "others")}><X size={14} /><span>{t("Alle anderen Fenster schließen")}</span></button>
          <div className="context-separator" />
          <button
            disabled={openFiles.findIndex((file) => file.path === tabContext.path) <= 0}
            onClick={() => closeTabGroup(tabContext.path, "left")}
          ><X size={14} /><span>{t("Alle linken Fenster schließen")}</span></button>
          <button
            disabled={openFiles.findIndex((file) => file.path === tabContext.path) >= openFiles.length - 1}
            onClick={() => closeTabGroup(tabContext.path, "right")}
          ><X size={14} /><span>{t("Alle rechten Fenster schließen")}</span></button>
          <div className="context-separator" />
          <button onClick={() => closeTabGroup(tabContext.path, "all")}><X size={14} /><span>{t("Alle Fenster schließen")}</span></button>
        </div>
      ), document.body)}

      {explorerContext && (
        <>
          {createPortal((
            <div
          ref={(node) => {
            explorerMenuRef.current = node;
            clampPopupToViewport(node);
          }}
          className="explorer-context-menu"
          style={{ left: explorerContext.x, top: explorerContext.y }}
          role="menu"
          tabIndex={-1}
          data-context-node={explorerContext.node.path}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
              .filter((button) => button.offsetParent !== null);
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === "Escape") {
              setExplorerSubmenu(null);
              setExplorerContext(null);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              buttons[(current + 1) % buttons.length]?.focus();
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              buttons[(current - 1 + buttons.length) % buttons.length]?.focus();
            }
            if (event.key === "ArrowRight") {
              const trigger = (document.activeElement as HTMLElement | null)?.closest<HTMLButtonElement>("[data-explorer-submenu]");
              const submenu = trigger?.dataset.explorerSubmenu as ExplorerSubmenu | undefined;
              if (submenu) {
                event.preventDefault();
                openExplorerSubmenu(submenu);
                window.requestAnimationFrame(() => {
                  explorerSubmenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
                });
              }
            }
          }}
        >
          <div
            className="context-submenu-host"
            onPointerEnter={() => openExplorerSubmenu("new")}
            onPointerLeave={scheduleExplorerSubmenuClose}
          >
            <button
              data-explorer-submenu="new"
              aria-haspopup="menu"
              aria-expanded={explorerSubmenu === "new"}
              onClick={() => openExplorerSubmenu("new")}
            >
              <Plus size={15} /><span>{t("Neu")}</span><kbd>{t("Alt+Einfg")}</kbd><ChevronRight size={14} />
            </button>
          </div>
          <div className="context-separator" />
          {/*
            * Adding a dependency from where the module is, rather than from a
            * dialog that then has to be told which module was meant. The build
            * file is the one at or above what was clicked, which is exactly
            * how Gradle and Maven decide it too.
            */}
          <button
            disabled={projectInfo.type !== "Maven" && projectInfo.type !== "Gradle"}
            onClick={() => {
              setDependencyDialogTarget(buildFileForNode(explorerContext.node));
              setDependencyDialogOpen(true);
              setExplorerContext(null);
            }}
          >
            <Package size={15} /><span>{t("Abhängigkeit hinzufügen…")}</span>
          </button>
          <div className="context-separator" />
          <button
            disabled={explorerContext.node.type !== "file"}
            onClick={() => { void openFile(explorerContext.node); setExplorerContext(null); }}
          >
            <FolderOpen size={15} /><span>{t("Öffnen")}</span><kbd>{t("Enter")}</kbd>
          </button>
          <button
            disabled={explorerContext.node.type !== "file"}
            onClick={() => { void openFile(explorerContext.node); setSplitPath(explorerContext.node.path); setExplorerContext(null); }}
          >
            <SplitSquareHorizontal size={15} /><span>{t("Im rechten Split öffnen")}</span>
          </button>
          {isRunnableFileNode(explorerContext.node) && (
            <button
              onClick={() => {
                void runFileFromExplorer(explorerContext.node);
                setExplorerContext(null);
              }}
            >
              <Play size={15} /><span>{t("Ausführen")} ({explorerContext.node.name})</span><kbd>{keys.run || "F5"}</kbd>
            </button>
          )}
          <div className="context-separator" />
          <button
            disabled={explorerContext.node.path === explorerContext.projectRoot}
            onClick={() => { updateExplorerClipboard({ nodes: getExplorerSelection(explorerContext.node), move: true }); setExplorerContext(null); }}
          >
            <Scissors size={15} /><span>{t("Ausschneiden")}</span><kbd>{keys.explorerCut}</kbd>
          </button>
          <button
            disabled={explorerContext.node.path === explorerContext.projectRoot}
            onClick={() => { updateExplorerClipboard({ nodes: getExplorerSelection(explorerContext.node), move: false }); setExplorerContext(null); }}
          >
            <ClipboardCopy size={15} /><span>{t("Kopieren")}</span><kbd>{keys.explorerCopy}</kbd>
          </button>
          <button
            disabled={!explorerClipboard}
            onClick={() => { void pasteExplorerEntry(explorerContext.node); setExplorerContext(null); }}
          >
            <ClipboardPaste size={15} /><span>{t("Einfügen")}</span><kbd>{keys.explorerPaste}</kbd>
          </button>
          <div className="context-separator" />
          <div
            className="context-submenu-host"
            onPointerEnter={() => openExplorerSubmenu("refactor")}
            onPointerLeave={scheduleExplorerSubmenuClose}
          >
            <button data-explorer-submenu="refactor" aria-haspopup="menu" aria-expanded={explorerSubmenu === "refactor"} onClick={() => openExplorerSubmenu("refactor")}>
              <WandSparkles size={15} /><span>{t("Refactor")}</span><ChevronRight size={14} />
            </button>
          </div>
          <div
            className="context-submenu-host"
            onPointerEnter={() => openExplorerSubmenu("clipboard")}
            onPointerLeave={scheduleExplorerSubmenuClose}
          >
            <button data-explorer-submenu="clipboard" aria-haspopup="menu" aria-expanded={explorerSubmenu === "clipboard"} onClick={() => openExplorerSubmenu("clipboard")}>
              <ClipboardCopy size={15} /><span>{t("Pfad kopieren")}</span><ChevronRight size={14} />
            </button>
          </div>
          <button onClick={() => {
            const query = explorerContext.node.type === "file"
              ? explorerContext.node.name.replace(/\.[^.]+$/, "")
              : explorerContext.node.name;
            setSearchQuery(query);
            setActivity("search");
            setSidebarVisible(true);
            setExplorerContext(null);
            if (explorerContext.projectRoot && window.kiwi) {
              setSearching(true);
              void window.kiwi.workspace.search(explorerContext.projectRoot, query)
                .then(setSearchResults)
                .finally(() => setSearching(false));
            }
          }}>
            <Search size={15} /><span>{t("Im Projekt suchen")}</span><kbd>{t("Ctrl+Shift+F")}</kbd>
          </button>
          <div
            className="context-submenu-host"
            onPointerEnter={() => openExplorerSubmenu("git")}
            onPointerLeave={scheduleExplorerSubmenuClose}
          >
            <button
              data-explorer-submenu="git"
              aria-haspopup="menu"
              aria-expanded={explorerSubmenu === "git"}
              onClick={() => openExplorerSubmenu("git")}
            >
              <GitBranch size={15} /><span>{t("Git")}</span><ChevronRight size={14} />
            </button>
          </div>
          <div
            className="context-submenu-host"
            onPointerEnter={() => openExplorerSubmenu("more")}
            onPointerLeave={scheduleExplorerSubmenuClose}
          >
            <button data-explorer-submenu="more" aria-haspopup="menu" aria-expanded={explorerSubmenu === "more"} onClick={() => openExplorerSubmenu("more")}>
              <Ellipsis size={15} /><span>{t("Weitere Aktionen")}</span><ChevronRight size={14} />
            </button>
          </div>
          <div className="context-separator" />
          <button className="danger" disabled={explorerContext.node.path === explorerContext.projectRoot} onClick={() => { void deleteEntry(explorerContext.node); setExplorerContext(null); }}>
            <Trash2 size={15} /><span>{t("Löschen")}</span><kbd>{t("Entf")}</kbd>
          </button>
        </div>
          ), document.body)}

          {explorerSubmenu && createPortal((
            <div
              ref={explorerSubmenuRef}
              className="context-submenu explorer-submenu-portal"
              style={{ left: 0, top: 0 }}
              role="menu"
              tabIndex={-1}
              data-submenu={explorerSubmenu}
              onPointerEnter={cancelExplorerSubmenuClose}
              onPointerLeave={scheduleExplorerSubmenuClose}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  buttons[(current + 1) % buttons.length]?.focus();
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  buttons[(current - 1 + buttons.length) % buttons.length]?.focus();
                }
                if (event.key === "Escape" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const trigger = explorerMenuRef.current?.querySelector<HTMLButtonElement>(
                    `[data-explorer-submenu="${explorerSubmenu}"]`,
                  );
                  setExplorerSubmenu(null);
                  window.requestAnimationFrame(() => trigger?.focus());
                }
              }}
            >
              {explorerSubmenu === "new" ? (() => {
                const contextLanguage = (explorerContext.node.type === "file" ? languageFromPath(explorerContext.node.path) : undefined)
                  || projectInfo.language
                  || activeFile?.language
                  || "java";
                const { languageItems, webItems } = getProjectNewTemplates(contextLanguage);
                const isJava = contextLanguage === "java" || (!projectInfo.language && !activeFile?.language);

                return (
                  <>
                    {isJava ? (
                      <>
                        <button onClick={() => { void createJavaElement("class", explorerContext.node); setExplorerContext(null); }}><Braces size={15} /><span>{t("Java Class")}</span><kbd>{t("Klasse, Enum, …")}</kbd></button>
                        <button onClick={() => { void createJavaElement("package", explorerContext.node); setExplorerContext(null); }}><Package size={15} /><span>{t("Package")}</span></button>
                        <button onClick={() => { void createEntry(false, explorerContext.node); setExplorerContext(null); }}><FilePlus2 size={15} /><span>{t("Datei")}</span></button>
                        <button onClick={() => { void createEntry(true, explorerContext.node); setExplorerContext(null); }}><FolderPlus size={15} /><span>{t("Verzeichnis")}</span></button>
                        <div className="context-separator" />
                        <button onClick={() => { createModuleInfo(explorerContext.node); setExplorerContext(null); }}><Braces size={15} /><span>{t("module-info.java")}</span></button>
                        <button onClick={() => { setModuleDialogOpen(true); setExplorerContext(null); }}><Blocks size={15} /><span>{t("Modul")}</span></button>
                      </>
                    ) : (
                      <>
                        {languageItems.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              createTemplateEntry(item, explorerContext.node);
                              setExplorerContext(null);
                            }}
                          >
                            {item.isPackage ? <FolderPlus size={15} /> : item.icon === "test" ? <TestTube2 size={15} /> : item.icon === "class" ? <Braces size={15} /> : <FileCode2 size={15} />}
                            <span>{t(item.label)}</span>
                            {item.detail && <kbd>{item.detail}</kbd>}
                          </button>
                        ))}
                        <button onClick={() => { void createEntry(false, explorerContext.node); setExplorerContext(null); }}><FilePlus2 size={15} /><span>{t("Datei")}</span></button>
                        <button onClick={() => { void createEntry(true, explorerContext.node); setExplorerContext(null); }}><FolderPlus size={15} /><span>{t("Verzeichnis")}</span></button>
                      </>
                    )}

                    <div className="context-separator" />
                    {webItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          createTemplateEntry(item, explorerContext.node);
                          setExplorerContext(null);
                        }}
                      >
                        {item.id === "html" ? <Globe size={15} /> : item.id === "json" ? <FileJson size={15} /> : <FileCode2 size={15} />}
                        <span>{t(item.label)}</span>
                        {item.detail && <kbd>{item.detail}</kbd>}
                      </button>
                    ))}
                  </>
                );
              })() : explorerSubmenu === "clipboard" ? (
                <>
                  <button disabled={explorerContext.node.path === explorerContext.projectRoot} onClick={() => { void duplicateEntry(explorerContext.node); setExplorerContext(null); }}><Files size={15} /><span>{t("Duplizieren")}</span><kbd>{t("Ctrl+D")}</kbd></button>
                  <div className="context-separator" />
                  <button onClick={() => { void copyExplorerPath(explorerContext.node); setExplorerContext(null); }}><span>{t("Absoluten Pfad kopieren")}</span><kbd>{t("Ctrl+Shift+C")}</kbd></button>
                  <button onClick={() => { void copyExplorerPath(explorerContext.node, true); setExplorerContext(null); }}><span>{t("Relativen Pfad kopieren")}</span></button>
                  <button onClick={() => { void navigator.clipboard.writeText(explorerContext.node.name); setExplorerContext(null); }}><span>{t("Dateinamen kopieren")}</span></button>
                </>
              ) : explorerSubmenu === "refactor" ? (
                <>
                  <button disabled={explorerContext.node.path === explorerContext.projectRoot} onClick={() => { void renameEntry(explorerContext.node); setExplorerContext(null); }}><Pencil size={15} /><span>{t("Umbenennen")}</span><kbd>{t("Shift+F6")}</kbd></button>
                  <button disabled={activeFile?.language !== "java"} onClick={() => {
                    editorRef.current?.trigger("explorer", "editor.action.codeAction", { kind: "refactor.extract.function", apply: "never" });
                    setExplorerContext(null);
                  }}><WandSparkles size={15} /><span>{t("Methode extrahieren")}</span></button>
                  <button disabled={activeFile?.language !== "java"} onClick={() => {
                    editorRef.current?.trigger("explorer", "editor.action.codeAction", { kind: "refactor.extract.variable", apply: "never" });
                    setExplorerContext(null);
                  }}><WandSparkles size={15} /><span>{t("Variable / Parameter einführen")}</span></button>
                  <button disabled={activeFile?.language !== "java"} onClick={() => {
                    void openChangeSignature();
                    setExplorerContext(null);
                  }}><Braces size={15} /><span>{t("Signatur ändern…")}</span></button>
                  <button onClick={() => { void analyzeUnusedPrivate(false); setExplorerContext(null); }}><CircleAlert size={15} /><span>{t("Ungenutzten privaten Code analysieren")}</span></button>
                  <button onClick={() => { void showLocalHistory(explorerContext.node.path); setExplorerContext(null); }}><History size={15} /><span>{t("Lokale Historie")}</span></button>
                  <button onClick={() => { void undoLastProjectOperation(); setExplorerContext(null); }}><RotateCcw size={15} /><span>{t("Letzte Projektänderung rückgängig")}</span></button>
                </>
              ) : explorerSubmenu === "git" ? (
                <>
                  <button disabled={!gitStatus.available} onClick={async () => {
                    if (!window.kiwi) return;
                    setGitStatus(await window.kiwi.git.stage(explorerContext.projectRoot, [explorerContext.node.path]));
                    toast("Für Commit vorgemerkt", "success");
                    setExplorerContext(null);
                  }}><GitCommitHorizontal size={15} /><span>{t("Stage")}</span></button>
                  <button disabled={!gitStatus.available || explorerContext.node.type !== "file"} onClick={async () => {
                    if (!window.kiwi) return;
                    const diff = await window.kiwi.git.diff(explorerContext.projectRoot, explorerContext.node.path);
                    setGitDiff(diff || "Keine Änderungen.");
                    setPanel("build");
                    setPanelVisible(true);
                    setExplorerContext(null);
                  }}><FileCog size={15} /><span>{t("Diff anzeigen")}</span></button>
                </>
              ) : (
                <>
                  <button onClick={() => { void window.kiwi?.file.reveal(explorerContext.node.path); setExplorerContext(null); }}><FolderOpen size={15} /><span>{t("Im Explorer anzeigen")}</span></button>
                  <button onClick={() => {
                    const directory = explorerContext.node.type === "directory" ? explorerContext.node.path : dirname(explorerContext.node.path);
                    const command = window.kiwi?.platform === "win32"
                      ? `Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'`
                      : `cd '${directory.replace(/'/g, "'\\''")}'`;
                    setPanelVisible(true);
                    setPanel("terminal");
                    void window.kiwi?.terminal.execute({ root: explorerContext.projectRoot, command });
                    setExplorerContext(null);
                  }}><SquareTerminal size={15} /><span>{t("Terminal hier öffnen")}</span></button>
                  <button onClick={() => { void refreshTree(); setExplorerContext(null); }}><RefreshCw size={15} /><span>{t("Vom Datenträger neu laden")}</span></button>
                  <button onClick={() => { void toggleFavorite(explorerContext.node.path); setExplorerContext(null); }}><Star size={15} /><span>{workflow.favorites.includes(explorerContext.node.path) ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}</span></button>
                </>
              )}
            </div>
          ), document.body)}
        </>
      )}

      {dependencyDialogOpen && workspaceRoot && (
        <DependencyDialog
          buildType={projectInfo.type}
          onSearch={searchDependencies}
          onVersions={dependencyVersions}
          buildFiles={dependencyEditorModel?.buildFiles}
          // Without a file in mind, the module being worked in is the one
          // meant — not the first build file of the project, which in a
          // multi-project build is the root and governs no source.
          initialBuildFile={dependencyDialogTarget || buildFileForPath(activePath || "")}
          workspaceRoot={workspaceRoot}
          catalogs={dependencyEditorModel?.catalogs}
          onAdd={async (coordinates, scope, options) => {
            const result = await window.kiwi!.project.addDependency(workspaceRoot, coordinates, scope, options);
            if (!result.added && !result.changed) {
              toast(result.reason || "Die Abhängigkeit ist bereits eingetragen.", "info");
              return;
            }
            // Named by its module, not by its file name. Every build file in a
            // multi-project build is called the same thing, so "build.gradle.kts"
            // does not say which one the library went into — which is the whole
            // question when it looks as though nothing happened.
            toast(`${coordinates.artifactId} eingetragen · ${buildFileLabel(result.file, workspaceRoot)}`, "success");
            // The library is written to the file on disk, and a build file that
            // is open kept showing the version without it. From the editor that
            // is indistinguishable from nothing having happened — and saving
            // that buffer afterwards wrote the library straight back out again.
            await adoptDiskContent((result.files?.length ? result.files : [result.file]).filter(Boolean));
            await refreshTree(workspaceRoot);
            await refreshDependencyEditor();
            void refreshProjectTools();
            void refreshConfigDiagnostics(workspaceRoot);
            for (const file of result.files?.length ? result.files : [result.file]) {
              if (file) void window.kiwi!.language.refresh(workspaceRoot, file).catch(() => false);
            }
          }}
          onClose={() => { setDependencyDialogOpen(false); setDependencyDialogTarget(""); }}
        />
      )}
      {deployOpen && workspaceRoot && (
        <DeployDialog workspaceRoot={workspaceRoot} onClose={() => setDeployOpen(false)} />
      )}
      {projectWizardOpen && (
        <div className="project-wizard-backdrop" onClick={() => setProjectWizardOpen(false)}>
          <div className="project-wizard-modal" onClick={(e) => e.stopPropagation()}>
            <ProjectWizard
              initialLocation={workspaceRoot ? dirname(workspaceRoot) : ""}
              chooseLocation={() => window.kiwi?.project.chooseLocation() || Promise.resolve(null)}
              chooseJdk={() => window.kiwi?.project.selectJdk() || Promise.resolve(null)}
              onCreate={createProject}
              onClose={() => setProjectWizardOpen(false)}
            />
          </div>
        </div>
      )}
      {(runConfigOpen || moduleDialogOpen) && (
        <aside className="assistant-side-panel" aria-label={t("Assistent")}>
          {runConfigOpen && (
            <RunConfigurationDialog
              embedded
              configuration={editingRunConfig}
              workspaceRoot={workspaceRoot}
              modules={moduleInfos}
              configurations={runConfigurations}
              onSave={saveRunConfiguration}
              onDelete={deleteRunConfiguration}
              onClose={() => {
                setRunConfigOpen(false);
                setEditingRunConfig(undefined);
              }}
            />
          )}
          <ModuleDialog
            embedded
            open={moduleDialogOpen}
            projectRoot={workspaceRoot}
            modules={moduleInfos}
            onClose={() => setModuleDialogOpen(false)}
            onPreview={previewModule}
            onApply={applyModulePlan}
          />
        </aside>
      )}

      <JavaTypeDialog
        open={Boolean(javaTypeRequest)}
        initialKind={javaTypeRequest?.initialKind || "class"}
        packageName={javaTypeRequest?.packageName || ""}
        onCancel={() => setJavaTypeRequest(null)}
        onCreate={createJavaType}
      />

      {projectStructureOpen && (
        <ProjectStructureDialog
          workspaceRoot={workspaceRoot}
          project={projectInfo}
          projectSettings={projectInfo.projectSettings || {
            jdkPath: projectInfo.projectJdkPath || "",
            languageLevel: projectInfo.languageLevel || "21",
            encoding: projectInfo.encoding || "UTF-8",
            compilerArgs: projectInfo.compilerArgs || "",
            mavenOffline: Boolean(projectInfo.mavenOffline),
            gradleOffline: Boolean(projectInfo.gradleOffline),
            annotationProcessing: true,
            generatedSources: true,
            lombokSupport: true,
            unusedAnalysis: true,
            previewFeatures: false,
            autoSyncBuild: true,
            preferWrapper: true,
            parallelBuilds: true,
            cleanBeforeTest: true,
            excludedPaths: [],
            excludedLibraries: [],
            buildProfiles: [],
            backgroundImage: "",
            fontFamily: "",
            fontFallbacks: "",
          }}
          modules={moduleInfos}
          jdks={structureJdks}
          audit={dependencyAudit}
          onProjectChange={(patch) => {
            if (!workspaceRoot || !window.kiwi) return;
            void window.kiwi.project.updateSettings(workspaceRoot, patch)
              .then((next) => setProjectInfo((current) => ({ ...current, ...next, projectSettings: next })))
              .catch((error) => toast(error instanceof Error ? error.message : "Projekteinstellung fehlgeschlagen.", "error"));
          }}
          onModuleChange={(moduleId, patch) => {
            if (!workspaceRoot || !window.kiwi) return;
            void window.kiwi.modules.updateSettings(workspaceRoot, moduleId, patch)
              .then((updated) => setModuleInfos((items) => items.map((item) => item.id === updated.id ? updated : item)))
              .catch((error) => toast(error instanceof Error ? error.message : "Moduleinstellung fehlgeschlagen.", "error"));
          }}
          onClose={() => setProjectStructureOpen(false)}
        />
      )}

      {githubSignInOpen && (
        <GitHubSignInDialog
          onCancel={() => setGithubSignInOpen(false)}
          onSignedIn={(session) => {
            setGithubSession(session);
            setGithubSignInOpen(false);
            toast(`Als ${session.login} bei GitHub angemeldet`, "success");
          }}
        />
      )}

      {changeSignatureRequest && (
        <ChangeSignatureDialog
          signature={changeSignatureRequest.signature}
          onCancel={() => setChangeSignatureRequest(null)}
          onPreview={async ({ name, returnType, parameters }) => {
            if (!window.kiwi || !workspaceRoot) return;
            try {
              const plan = await window.kiwi.refactor.previewChangeSignature(workspaceRoot, {
                file: changeSignatureRequest.file,
                position: changeSignatureRequest.position,
                newName: name,
                returnType,
                parameters,
              });
              setChangeSignatureRequest(null);
              setJavaRefactorPlan(plan);
              setActiveDocument("java-refactor");
            } catch (error) {
              toast(error instanceof Error ? error.message : "Change-Signature-Vorschau fehlgeschlagen.", "error");
            }
          }}
        />
      )}

      {generateRequest && (
        <GenerateMembersDialog
          source={generateRequest.source}
          initialKind={generateRequest.kind}
          onClose={() => setGenerateRequest(null)}
          onGenerate={(kind, fields) => {
            setGenerateRequest(null);
            generateMembers(kind, fields);
          }}
        />
      )}

      {confirmRequest && (
        <KiwiConfirmDialog
          open
          title={confirmRequest.title}
          description={confirmRequest.description}
          details={confirmRequest.details}
          confirmLabel={confirmRequest.confirmLabel}
          onCancel={() => confirmRequest.answer(false)}
          onConfirm={() => confirmRequest.answer(true)}
        />
      )}
      {inputRequest && (
        <KiwiInputDialog
          open
          title={inputRequest.title}
          description={inputRequest.description}
          label={inputRequest.label}
          initialValue={inputRequest.initialValue}
          placeholder={inputRequest.placeholder}
          confirmLabel={inputRequest.confirmLabel}
          variant={inputRequest.variant}
          validate={inputRequest.validate}
          onCancel={() => setInputRequest(null)}
          onConfirm={inputRequest.action}
        />
      )}

      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="true">
        {toasts.map((item) => (
          <div className={`toast ${item.kind}`} key={item.id}>
            {item.kind === "success" ? <CircleCheck size={16} /> : item.kind === "error" ? <CircleX size={16} /> : <CircleAlert size={16} />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const windowKind = new URLSearchParams(window.location.search).get("window");
  if (windowKind === "wizard" || windowKind === "newProject") {
    return <Suspense fallback={<div className="window-lazy-loading"><span /> {t("Neues Projekt")}…</div>}><ProjectWizardWindowApp /></Suspense>;
  }
  if (windowKind === "settings") {
    return <Suspense fallback={<div className="window-lazy-loading"><span /> {t("Einstellungen werden geladen …")}</div>}><SettingsWindowApp /></Suspense>;
  }
  if (windowKind === "structure") {
    return <Suspense fallback={<div className="window-lazy-loading"><span /> {t("Projektstruktur wird geladen …")}</div>}><ProjectStructureWindowApp /></Suspense>;
  }
  if (windowKind === "terminal") {
    return <Suspense fallback={<div className="window-lazy-loading"><span /> {t("Terminal wird geladen …")}</div>}><TerminalWindowApp /></Suspense>;
  }
  if (windowKind === "panel") {
    return <Suspense fallback={<div className="window-lazy-loading"><span /> {t("Werkzeugfenster wird geladen …")}</div>}><PanelWindowApp /></Suspense>;
  }
  return <IdeApp />;
}

export default App;
