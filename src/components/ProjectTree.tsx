/**
 * The file tree in the Explorer.
 *
 * A row, the icon on it, and the window of rows that is actually rendered — a
 * project with ten thousand files draws thirty of them. It reads what it is
 * handed and reports what was clicked; the workbench decides what that means.
 */
import { Blocks, ChevronDown, ChevronRight, Code2, File, FileCode2, FileJson, Folder, FolderOpen, LoaderCircle } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FileNode, JavaSourceKind } from "../types";
import { explorerLabel, isTreeNodeExpanded, treeExpansionKey } from "../utils";
import { fileKind } from "../workbench/workbench-helpers";
import { editorLanguageFromPath, isPolyglotLanguage, languageDisplayName } from "../language/language-catalog";

export function FileTypeIcon({ name, javaKind, size = 15 }: { name: string; javaKind?: JavaSourceKind; size?: number }) {
  const kind = fileKind(name);
  if (kind === "java") {
    const sourceKind = javaKind || "class";
    const glyphs: Record<JavaSourceKind, string> = {
      class: "C",
      interface: "I",
      enum: "E",
      record: "R",
      annotation: "@",
      exception: "X",
      junit: "T",
    };
    const labels: Record<JavaSourceKind, string> = {
      class: "Klasse",
      interface: "Interface",
      enum: "Enum",
      record: "Record",
      annotation: "Annotation",
      exception: "Exception",
      junit: "JUnit-Test",
    };
    return (
      <span
        className={`java-glyph java-${sourceKind}-glyph`}
        style={{ fontSize: Math.max(8, size - 7) }}
        title={`Java ${labels[sourceKind]}`}
        aria-label={`Java ${labels[sourceKind]}`}
      >
        {glyphs[sourceKind]}
      </span>
    );
  }
  if (kind === "json") return <FileJson size={size} className="file-json" />;
  if (kind === "gradle") return <Blocks size={size} className="file-gradle" />;
  if (kind === "maven" || kind === "xml") return <Code2 size={size} className="file-xml" />;
  if (kind === "markdown") return <FileCode2 size={size} className="file-markdown" />;
  if (kind === "tsx") {
    return (
      <span
        className="file-glyph file-tsx-glyph"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          fontSize: Math.max(9, size - 5),
          fontWeight: 700,
          color: "#00d8ff",
          lineHeight: 1,
        }}
        title="React TypeScript (TSX)"
        aria-label="React TypeScript (TSX)"
      >
        ⚛
      </span>
    );
  }
  if (kind === "jsx") {
    return (
      <span
        className="file-glyph file-jsx-glyph"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          fontSize: Math.max(9, size - 5),
          fontWeight: 700,
          color: "#61dafb",
          lineHeight: 1,
        }}
        title="React JavaScript (JSX)"
        aria-label="React JavaScript (JSX)"
      >
        ⚛
      </span>
    );
  }
  if (kind === "typescript") {
    return (
      <span
        className="file-glyph file-ts-glyph"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          fontSize: Math.max(7, size - 7),
          fontWeight: 800,
          color: "#3178c6",
          lineHeight: 1,
        }}
        title="TypeScript"
        aria-label="TypeScript"
      >
        TS
      </span>
    );
  }
  if (kind === "javascript") {
    return (
      <span
        className="file-glyph file-js-glyph"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          fontSize: Math.max(7, size - 7),
          fontWeight: 800,
          color: "#f7df1e",
          lineHeight: 1,
        }}
        title="JavaScript"
        aria-label="JavaScript"
      >
        JS
      </span>
    );
  }
  const language = editorLanguageFromPath(name);
  if (isPolyglotLanguage(language)) return <FileCode2 size={size} aria-label={languageDisplayName(language)} style={{ color: "var(--accent)" }} />;
  return <File size={size} className="file-default" />;
}

export function TreeItemRow({
  node,
  depth,
  expanded,
  selectedPaths,
  onToggle,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDrop,
  gitState,
  openMode,
  indent,
  loading = false,
  moduleRoots,
  hideExtensions,
  style,
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  selectedPaths: Set<string>;
  onToggle: (node: FileNode) => void;
  onSelect: (event: React.MouseEvent, node: FileNode) => void;
  onOpen: (node: FileNode, permanent: boolean) => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  onDragStart: (event: React.DragEvent, node: FileNode) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent, node: FileNode) => void;
  gitState?: "conflict" | "modified" | "staged" | "untracked";
  openMode: "single" | "double";
  indent: number;
  loading?: boolean;
  moduleRoots: Set<string>;
  hideExtensions: boolean;
  style?: CSSProperties;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dragInProgress = useRef(false);
  const isDirectory = node.type === "directory";
  const isExpanded = isTreeNodeExpanded(node, expanded);
  const normalizedPath = node.path.replace(/\\/g, "/").toLocaleLowerCase();
  const isModule = isDirectory && moduleRoots.has(node.path.toLocaleLowerCase());
  const directoryKind = !isDirectory
    ? ""
    : isModule
      ? "module"
      : /\/src\/test\/java$/.test(normalizedPath)
        ? "test-source"
        : /\/src\/main\/java$/.test(normalizedPath)
        ? "java-source"
        : /\/src\/(?:main|test)\/resources$/.test(normalizedPath)
          ? "resources"
          : /\/(?:generated|generated-sources|generated-test-sources)$/.test(normalizedPath)
            ? "generated"
            : /\/(?:build|target|out)$/.test(normalizedPath)
              ? "build-output"
              : node.name === "src"
                ? "source-container"
                : "folder";
  return (
      <button
        className={`tree-row ${selectedPaths.has(node.path) ? "selected" : ""} ${dragOver ? "drag-over" : ""} ${gitState ? `git-${gitState}` : ""} ${directoryKind ? `tree-${directoryKind}` : ""}`}
        data-node-kind={isDirectory ? directoryKind : node.javaKind ? `java-${node.javaKind}` : fileKind(node.name)}
        style={{ ...style, paddingLeft: 8 + depth * indent }}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selectedPaths.has(node.path)}
        aria-expanded={isDirectory ? isExpanded : undefined}
        draggable
        onClick={(event) => {
          if (dragInProgress.current) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onSelect(event, node);
          if (isDirectory) {
            if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onToggle(node);
          } else if (openMode === "single") {
            onOpen(node, false);
          }
        }}
        onDoubleClick={() => {
          if (!isDirectory) onOpen(node, true);
        }}
        onContextMenu={(event) => onContextMenu(event, node)}
        onDragStart={(event) => {
          dragInProgress.current = true;
          // The grab cursor belongs to a drag that has begun, not to
          // every row somebody's pointer happens to be over.
          document.body.classList.add("kiwi-dragging");
          onDragStart(event, node);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = event.dataTransfer.types.some((type) =>
            type === "application/x-kiwi-explorer-path" || type === "application/x-kiwi-explorer-paths") ? "move" : "copy";
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          onDrop(event, node);
        }}
        onDragEnd={() => {
          setDragOver(false);
          document.body.classList.remove("kiwi-dragging");
          onDragEnd();
          window.requestAnimationFrame(() => {
            dragInProgress.current = false;
          });
        }}
        title={node.path}
      >
        <span className="tree-chevron">
          {loading
            ? <LoaderCircle size={12} className="kiwi-spinner" />
            : isDirectory && (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        </span>
        {isDirectory ? (
          <span className={`tree-folder-symbol ${directoryKind}`}>
            {isExpanded ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}
            {(isModule || ["java-source", "resources", "test-source", "generated"].includes(directoryKind)) && <i />}
          </span>
        ) : (
          <FileTypeIcon name={node.name} javaKind={node.javaKind} />
        )}
        <span className="tree-label" title={node.name}>{explorerLabel(node, hideExtensions)}</span>
        {gitState && (
          <span className={`tree-git-state ${gitState}`} title={`Git: ${gitState}`}>
            {gitState === "conflict" ? "!" : gitState === "untracked" ? "?" : gitState === "staged" ? "+" : "M"}
          </span>
        )}
      </button>
  );
}

/**
 * Explorer rows are the bulk of every Explorer render. Scrolling and typing
 * both re-render the workbench, so each visible row would rebuild without this
 * guard. The callbacks below are stable, which is what makes the memo hold.
 */
export const TreeItem = memo(TreeItemRow);

export type VisibleTreeEntry = { node: FileNode; depth: number };

/** Stable empty tree so an unloaded project does not hand VirtualProjectTree a new array each render. */
export const emptyTree: FileNode[] = [];

export function flattenVisibleTree(nodes: FileNode[], expanded: Set<string>, depth = 0, result: VisibleTreeEntry[] = []) {
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.type === "directory" && isTreeNodeExpanded(node, expanded) && node.children?.length) {
      flattenVisibleTree(node.children, expanded, depth + 1, result);
    }
  }
  return result;
}

export function flattenTreeNodes(nodes: FileNode[], result: FileNode[] = []) {
  for (const node of nodes) {
    result.push(node);
    if (node.children?.length) flattenTreeNodes(node.children, result);
  }
  return result;
}

export function VirtualProjectTree({
  projectRoot,
  nodes,
  expanded,
  loadingDirectories,
  selectedPaths,
  onToggle,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDrop,
  getGitState,
  openMode,
  indent,
  rowHeight,
  moduleRoots,
  hideExtensions,
}: {
  projectRoot: string;
  nodes: FileNode[];
  expanded: Set<string>;
  loadingDirectories: Set<string>;
  selectedPaths: Set<string>;
  onToggle: (root: string, node: FileNode) => void;
  onSelect: (root: string, event: React.MouseEvent, node: FileNode) => void;
  onOpen: (root: string, node: FileNode, pinned: boolean) => void;
  onContextMenu: (root: string, event: React.MouseEvent, node: FileNode) => void;
  onDragStart: (event: React.DragEvent, node: FileNode) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent, node: FileNode) => void;
  getGitState: (node: FileNode) => "conflict" | "modified" | "staged" | "untracked" | undefined;
  openMode: "single" | "double";
  indent: number;
  rowHeight: number;
  moduleRoots: Set<string>;
  hideExtensions: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animationFrame = useRef<number | null>(null);
  const [windowRange, setWindowRange] = useState({ start: 0, end: 80 });
  const entries = useMemo(() => flattenVisibleTree(nodes, expanded), [expanded, nodes]);
  // Bind the project root once so every row keeps the same callback identity.
  const bound = useMemo(() => ({
    onToggle: (node: FileNode) => onToggle(projectRoot, node),
    onSelect: (event: React.MouseEvent, node: FileNode) => onSelect(projectRoot, event, node),
    onOpen: (node: FileNode, permanent: boolean) => onOpen(projectRoot, node, permanent),
    onContextMenu: (event: React.MouseEvent, node: FileNode) => onContextMenu(projectRoot, event, node),
  }), [onContextMenu, onOpen, onSelect, onToggle, projectRoot]);
  const updateWindow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const overscan = 14;
    const start = Math.max(0, Math.min(entries.length, Math.floor(viewport.scrollTop / rowHeight) - overscan));
    const end = Math.min(entries.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / rowHeight) + overscan);
    setWindowRange((current) => current.start === start && current.end === end ? current : { start, end });
  }, [entries.length, rowHeight]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      const maxScrollTop = Math.max(0, entries.length * rowHeight - viewport.clientHeight);
      if (viewport.scrollTop > maxScrollTop) viewport.scrollTop = maxScrollTop;
    }
    updateWindow();
    if (!viewport) return undefined;
    const observer = new ResizeObserver(updateWindow);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [entries.length, rowHeight, updateWindow]);
  useEffect(() => () => {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
  }, []);
  return (
    <div
      className="virtual-tree-viewport"
      ref={viewportRef}
      onScroll={() => {
        if (animationFrame.current !== null) return;
        animationFrame.current = window.requestAnimationFrame(() => {
          animationFrame.current = null;
          updateWindow();
        });
      }}
    >
      <div className="virtual-tree-canvas" style={{ height: entries.length * rowHeight }}>
        {entries.slice(windowRange.start, windowRange.end).map(({ node, depth }, offset) => {
          const index = windowRange.start + offset;
          return (
            <TreeItem
              key={treeExpansionKey(node)}
              node={node}
              depth={depth}
              expanded={expanded}
              selectedPaths={selectedPaths}
              onToggle={bound.onToggle}
              onSelect={bound.onSelect}
              onOpen={bound.onOpen}
              onContextMenu={bound.onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              gitState={getGitState(node)}
              openMode={openMode}
              indent={indent}
              loading={loadingDirectories.has(node.path)}
              moduleRoots={moduleRoots}
              hideExtensions={hideExtensions}
              style={{ position: "absolute", top: index * rowHeight, left: 0, height: rowHeight }}
            />
          );
        })}
      </div>
    </div>
  );
}
