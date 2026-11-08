import type { Diagnostic, FileNode } from "./types";
import { editorLanguageFromPath } from "./language/language-catalog";

export function languageFromPath(path: string): string {
  return editorLanguageFromPath(path);
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join(path.includes("\\") ? "\\" : "/");
}

export function relativePath(root: string, path: string): string {
  if (!root) return path;
  return path.slice(root.length).replace(/^[\\/]/, "") || basename(path);
}

export function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) =>
    node.type === "directory"
      ? flattenFiles(node.children || [])
      : [node],
  );
}

export function treeExpansionKey(node: FileNode): string {
  return node.treeKey || node.path;
}

/**
 * Extensions the Explorer can hide, the way IntelliJ drops `.java` from the
 * project view. Only source types where the icon already carries the file kind.
 */
export const hideableExtensions = [".java", ".kt", ".kts", ".py", ".pyw", ".rs", ".php", ".phtml", ".lua", ".go", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".cs", ".csx", ".m", ".mm", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".scss", ".less"];

export function explorerLabel(node: FileNode, hideExtensions: boolean): string {
  const label = node.displayName || node.name;
  if (!hideExtensions || node.type === "directory") return label;
  const extension = hideableExtensions.find((candidate) =>
    label.toLocaleLowerCase().endsWith(candidate));
  // Never strip the whole name: a file called ".java" keeps its label.
  if (!extension || label.length === extension.length) return label;
  const shortened = label.slice(0, -extension.length);
  // Hiding ".kts" turned build.gradle.kts into "build.gradle" — the name of a
  // different, equally real build file, and two of them side by side became
  // one row twice. An extension is only dropped when what is left cannot be
  // mistaken for a file name of its own.
  return shortened.includes(".") ? label : shortened;
}

export function isTreeNodeExpanded(node: FileNode, expanded: Set<string>): boolean {
  if (expanded.has(treeExpansionKey(node)) || expanded.has(node.path)) return true;
  // A compacted chain regroups as soon as a package gains or loses a sibling —
  // creating one is enough — and the row it becomes has a different key. The
  // physical directories behind it do not change, so they are what expansion is
  // remembered by. Without this the branch silently collapsed after every
  // package that was created inside it.
  return (node.treePaths || []).some((physicalPath) => expanded.has(physicalPath));
}

/**
 * Every identity a node may be remembered as expanded under.
 *
 * Opening has to record all of them, not just the current key, or the next
 * regrouping loses the state — closing already removed all of them, and that
 * asymmetry was the bug.
 */
export function treeExpansionPaths(node: FileNode): string[] {
  return [treeExpansionKey(node), node.path, ...(node.treePaths || [])]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
}

/**
 * Combines a single-child Java package chain without changing its expansion
 * identity. The stable key prevents a lazily loaded `de` node from suddenly
 * becoming a collapsed `de.example` node after its children arrive.
 */
export function compactPackageNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map((original) => {
    let node = original.children?.length
      ? { ...original, children: compactPackageNodes(original.children) }
      : { ...original };
    const normalized = node.path.replace(/\\/g, "/").toLocaleLowerCase();
    const insideJavaRoot = /\/src\/(?:main|test)\/java\/.+/.test(normalized);
    if (!insideJavaRoot || node.type !== "directory") return node;
    const stableKey = node.treeKey || node.path;
    let compactPaths = node.treePaths || [node.path];
    while (node.children?.length === 1 && node.children[0].type === "directory") {
      const child = node.children[0];
      compactPaths = [...compactPaths, ...(child.treePaths || [child.path])]
        .filter((value, index, values) => values.indexOf(value) === index);
      node = {
        ...child,
        name: `${node.name}.${child.name}`,
        id: stableKey,
        path: child.path,
        treeKey: stableKey,
        treePaths: compactPaths,
        children: child.children,
        childrenLoaded: child.childrenLoaded,
      };
    }
    return node;
  });
}

/**
 * Every directory between `root` and `target`, `root` itself included.
 *
 * Compact package nodes split apart as soon as a chain gains a second entry:
 * `de.app.spigot` becomes `de.app` with a separate `spigot` child. Holding all
 * physical directories of the path open keeps the branch visible no matter how
 * the compaction regroups it.
 */
/**
 * Puts a relative path back onto its root, in the root's own spelling.
 *
 * The project index stores forward slashes so one file has one name whatever
 * wrote it; the workbench speaks the platform's separator, and on Windows the
 * two disagree.
 */
export function joinPath(root: string, relative: string): string {
  const base = String(root || "").replace(/[\/]+$/, "");
  const separator = base.includes("\\") ? "\\" : "/";
  const tail = String(relative || "").replace(/^[\/]+/, "").replace(/[\/]/g, separator);
  return base ? `${base}${separator}${tail}` : tail;
}

export function ancestorDirectories(root: string, target: string): string[] {
  if (!root || !target || !isPathWithin(target, root)) return [];
  const separator = target.includes("\\") ? "\\" : "/";
  const rootDepth = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).length;
  const segments = target.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  const prefix = target.match(/^[\\/]{1,2}/)?.[0].replace(/[\\/]/g, separator) || "";
  const result: string[] = [];
  for (let depth = rootDepth; depth <= segments.length; depth += 1) {
    result.push(prefix + segments.slice(0, depth).join(separator));
  }
  return result;
}

function comparablePath(value: string): string {
  const windows = /^\/?[a-z]:(?:[\\/]|$)/i.test(value) || /^\\\\/.test(value) || globalThis.window?.kiwi?.platform === "win32";
  const normalized = windows ? value.replace(/^\/([a-z]:)/i, "$1").replace(/[\\/]+/g, "/").toLocaleLowerCase() : value;
  return normalized.replace(/\/+$/, "");
}

export function isPathWithin(path: string, parent: string): boolean {
  const candidate = comparablePath(path);
  const root = comparablePath(parent);
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function remapExpandedExplorerPaths(
  expanded: Set<string>,
  transfers: Array<{ source: string; target: string; move: boolean }>,
  targetDirectory?: string,
): Set<string> {
  const moves = transfers
    .filter((transfer) => transfer.move)
    .sort((left, right) => right.source.length - left.source.length);
  const next = new Set<string>();
  for (const expandedPath of expanded) {
    const move = moves.find((candidate) => isPathWithin(expandedPath, candidate.source));
    next.add(move ? `${move.target}${expandedPath.slice(move.source.length)}` : expandedPath);
  }
  if (targetDirectory) next.add(targetDirectory);
  return next;
}

/**
 * Whether two paths name the same file.
 *
 * Windows cares about neither case nor which slash was used, and the parts of
 * Kiwi that produce a path do not agree about either: a watcher reports what
 * the filesystem reported, an editor knows its file through a Monaco URI.
 * Compared as plain text those are different files, and a buffer would not
 * recognise its own path.
 */
export function samePath(left: string, right: string): boolean {
  return comparablePath(left || "") === comparablePath(right || "");
}

/**
 * Replaces one directory's children with a freshly listed set.
 *
 * The new listing is merged with what was there, not swapped in: a listing
 * carries no loaded grandchildren, so overwriting closed every open package
 * below the directory. That is what made an Explorer update trigged by any
 * single saved file collapse whole branches.
 */
export function withLoadedChildren(
  nodes: FileNode[],
  directory: string,
  children: FileNode[],
  expanded: Set<string> = new Set(),
): FileNode[] {
  return nodes.map((node) => {
    if (samePath(node.path, directory)) {
      return {
        ...node,
        children: mergeLoadedTreeState(children, node.children || [], expanded),
        childrenLoaded: true,
      };
    }
    if (!node.children?.length) return node;
    const nextChildren = withLoadedChildren(node.children, directory, children, expanded);
    return nextChildren === node.children ? node : { ...node, children: nextChildren };
  });
}

/**
 * Keeps children that were already loaded when a refresh returns a shallow tree.
 *
 * The Explorer loads directories lazily, so a rebuild only brings the top
 * level. Dropping the loaded children of an open branch would close it on every
 * file the watcher reports — including files somewhere else entirely.
 */
export function mergeLoadedTreeState(fresh: FileNode[], previous: FileNode[], expanded: Set<string>): FileNode[] {
  const previousByPath = new Map(previous.map((node) => [node.path.toLowerCase(), node]));
  return fresh.map((node) => {
    if (node.type !== "directory") return node;
    const oldNode = previousByPath.get(node.path.toLowerCase());
    if (node.childrenLoaded) {
      return {
        ...node,
        children: mergeLoadedTreeState(node.children || [], oldNode?.children || [], expanded),
      };
    }
    const branchExpanded = [...expanded].some((expandedPath) => isPathWithin(expandedPath, node.path));
    if (oldNode?.childrenLoaded && branchExpanded) {
      return {
        ...node,
        childrenLoaded: true,
        children: oldNode.children || [],
      };
    }
    return node;
  });
}

export function removeTreeNode(nodes: FileNode[], targetPath: string): FileNode[] {
  return nodes
    .filter((node) => !isPathWithin(node.path, targetPath))
    .map((node) => node.children?.length
      ? { ...node, children: removeTreeNode(node.children, targetPath) }
      : node);
}

/**
 * Markers the editor badge and the TODO tool window both recognise.
 *
 * The same list lives in electron/services/task-comment-scanner.cjs for the
 * project-wide scan; the tests pin the two against one fixture.
 */
export const taskMarkers = ["TODO", "FIXME", "HACK", "XXX", "BUG", "NOTE"] as const;

export type TaskMarker = typeof taskMarkers[number];

export interface TaskComment {
  line: number;
  column: number;
  kind: TaskMarker;
  text: string;
}

/**
 * Finds task markers in comments.
 *
 * Only comment text is considered, so a string literal like "TODO: ship it"
 * does not raise a task. The marker has to start a word to keep identifiers
 * such as `todoList` out of the results.
 */
export function findTaskComments(source: string): TaskComment[] {
  const result: TaskComment[] = [];
  const marker = new RegExp(String.raw`\b(${taskMarkers.join("|")})\b\s*:?\s*(.*)$`, "i");
  const lines = String(source || "").split(/\r?\n/);
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let comment = "";
    let offset = 0;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      comment = end < 0 ? line : line.slice(0, end);
      if (end >= 0) inBlockComment = false;
    } else {
      // Ignore // and /* that sit inside a string literal.
      const stripped = line.replace(/"(?:[^"\\]|\\.)*"/g, (match) => " ".repeat(match.length));
      const lineComment = stripped.indexOf("//");
      const blockComment = stripped.indexOf("/*");
      if (lineComment >= 0 && (blockComment < 0 || lineComment < blockComment)) {
        offset = lineComment;
        comment = line.slice(lineComment);
      } else if (blockComment >= 0) {
        offset = blockComment;
        const end = stripped.indexOf("*/", blockComment + 2);
        comment = end < 0 ? line.slice(blockComment) : line.slice(blockComment, end + 2);
        inBlockComment = end < 0;
      }
    }
    if (!comment) continue;
    const hit = comment.match(marker);
    if (!hit) continue;
    result.push({
      line: index + 1,
      column: offset + (hit.index || 0) + 1,
      kind: hit[1].toUpperCase() as TaskMarker,
      text: hit[2].trim().replace(/\s*\*\/$/, "").trim(),
    });
  }
  return result;
}

export function fuzzyScore(value: string, query: string): number {
  const source = value.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 1;
  let score = 0;
  let cursor = 0;
  let streak = 0;
  for (const character of needle) {
    const index = source.indexOf(character, cursor);
    if (index < 0) return -1;
    streak = index === cursor ? streak + 1 : 0;
    score += 10 + streak * 3 - index;
    cursor = index + 1;
  }
  if (source.includes(needle)) score += 80;
  if (source.startsWith(needle)) score += 40;
  return score;
}

export function parseJavaDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/);
  const javacPattern = /^(.+?\.java):(\d+):\s*(?:(\d+):\s*)?(error|warning|fehler|warnung):\s*(.+)$/i;
  const mavenPattern = /^(.+?\.java):\[(\d+),(\d+)]\s*(?:error|warning)?\s*(.*)$/i;
  const cleanLine = (value: string) => value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/^\s*\[(?:ERROR|WARNING|WARN)]\s*/i, "");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = cleanLine(rawLine);
    const match = line.match(javacPattern);
    const maven = match ? null : line.match(mavenPattern);
    if (!match && !maven) continue;
    const detailLines: string[] = [];
    for (let detailIndex = index + 1; detailIndex < lines.length; detailIndex += 1) {
      const detail = cleanLine(lines[detailIndex]).trim();
      if (!detail) {
        if (detailLines.length) break;
        continue;
      }
      if (detail.match(javacPattern) || detail.match(mavenPattern) || /^\[?INFO]|^-{4,}|^\[?ERROR]\s*->/i.test(detail)) break;
      if (/^(?:symbol|location|Symbol|Ort):\s*/.test(detail)) {
        detailLines.push(detail);
        continue;
      }
      break;
    }
    const diagnostic = {
      path: normalizeBuildPath((match || maven)![1]),
      line: Number((match || maven)![2]),
      column: Number((match || maven)![3] || 1),
      severity: (/^(?:warning|warnung)$/i.test(match?.[4] || "") || /\[(?:WARNING|WARN)]/i.test(rawLine) ? "warning" : "error") as Diagnostic["severity"],
      message: [match?.[5] || maven?.[4] || "Build-Fehler", ...detailLines].join("\n"),
    };
    const key = `${diagnostic.path.toLocaleLowerCase()}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

export interface BuildQuickFix {
  kind: "implement-interface";
  sourceType: string;
  targetType: string;
  label: string;
}

export interface BuildReport {
  status: "idle" | "running" | "success" | "failed";
  tool: "Maven" | "Gradle" | "Java";
  title: string;
  detail: string;
  command: string;
  duration: string;
  finishedAt: string;
  diagnostics: Diagnostic[];
  raw: string;
}

export interface BuildOutputGroup {
  module: string;
  output: string;
  errors: number;
}

export function groupBuildOutputByModule(output: string): BuildOutputGroup[] {
  const groups = new Map<string, string[]>();
  let current = "Projekt";
  const append = (module: string, line: string) => {
    const lines = groups.get(module) || [];
    lines.push(line);
    groups.set(module, lines);
  };
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const maven = line.match(/^\[INFO]\s+Building\s+(.+?)(?:\s+\d[\w.-]*)?\s*$/);
    const gradle = line.match(/^>\s*Task\s+:([^:\s]+)(?::[^\s]+)?/);
    const plain = line.match(/^\[([^\]]+)]\s+(?:javac|java)\b/);
    if (maven) current = maven[1].trim();
    else if (gradle) current = gradle[1].trim();
    else if (plain) current = plain[1].trim();
    append(current, line);
  }
  return [...groups.entries()]
    .filter(([, lines]) => lines.some((line) => line.trim()))
    .map(([module, lines]) => ({
      module,
      output: lines.join("\n").trim(),
      errors: lines.filter((line) => /\b(?:ERROR|error|Fehler)\b/.test(line)).length,
    }));
}

export function parseBuildReport(
  output: string,
  options: { running?: boolean; exitCode?: number | null } = {},
): BuildReport {
  const raw = stripAnsi(output).trim();
  const diagnostics = parseJavaDiagnostics(raw);
  const tool = /\bmvn(?:\.cmd)?\b|Scanning for projects|maven-/i.test(raw)
    ? "Maven"
    : /\bgradle(?:w|\.bat)?\b|Gradle Daemon|Task :/i.test(raw)
      ? "Gradle"
      : "Java";
  const failed = options.exitCode !== undefined && options.exitCode !== null
    ? options.exitCode !== 0
    : /BUILD FAILURE|COMPILATION ERROR|\berror:\s/i.test(raw);
  const succeeded = options.exitCode === 0 || /BUILD SUCCESS|BUILD SUCCESSFUL/i.test(raw);
  const status: BuildReport["status"] = options.running
    ? "running"
    : failed
      ? "failed"
      : succeeded
        ? "success"
        : raw
          ? "idle"
          : "idle";
  const duration = raw.match(/Total time:\s*(.+)$/im)?.[1]?.trim()
    || raw.match(/BUILD SUCCESSFUL in\s+(.+)$/im)?.[1]?.trim()
    || "";
  const finishedAt = raw.match(/Finished at:\s*(.+)$/im)?.[1]?.trim() || "";
  const command = raw.match(/^>\s*(.+)$/m)?.[1]?.trim() || "";
  const firstDiagnostic = diagnostics[0];
  const title = status === "running"
    ? "Build läuft"
    : status === "success"
      ? "Build erfolgreich"
      : status === "failed"
        ? diagnostics.length === 1 ? "1 Compilerfehler" : diagnostics.length > 1 ? `${diagnostics.length} Compilerfehler` : "Build fehlgeschlagen"
        : "Noch kein Build";
  const detail = firstDiagnostic
    ? explainJavaDiagnostic(firstDiagnostic)
    : status === "success"
      ? "Das Projekt wurde ohne Fehler gebaut."
      : status === "running"
        ? `${tool} verarbeitet das Projekt …`
        : status === "failed"
          ? "Öffne die Details oder das Problems-Toolfenster für weitere Informationen."
          : "Starte einen Build mit Ctrl+Shift+B.";
  return { status, tool, title, detail, command, duration, finishedAt, diagnostics, raw };
}

export function buildQuickFixForDiagnostic(diagnostic: Diagnostic): BuildQuickFix | null {
  const patterns = [
    /(?:Inkompatible Typen:\s*)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s+kann nicht in\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s+konvertiert werden/i,
    /(?:incompatible types:\s*)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s+cannot be converted to\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/i,
  ];
  const match = patterns.map((pattern) => diagnostic.message.match(pattern)).find(Boolean);
  if (!match) return null;
  const sourceType = match[1];
  const targetType = match[2];
  // "int implementieren" is not a fix anyone can apply: a primitive or a final
  // JDK type can never be the interface the source is missing.
  const unimplementable = new Set([
    "boolean", "byte", "char", "short", "int", "long", "float", "double", "void",
    "String", "java.lang.String", "Integer", "java.lang.Integer",
  ]);
  if (unimplementable.has(targetType) || unimplementable.has(simpleJavaName(targetType))) return null;
  return {
    kind: "implement-interface",
    sourceType,
    targetType,
    label: `${simpleJavaName(targetType)} implementieren`,
  };
}

export function explainJavaDiagnostic(diagnostic: Diagnostic): string {
  const quickFix = buildQuickFixForDiagnostic(diagnostic);
  if (quickFix) {
    return `${simpleJavaName(quickFix.sourceType)} erfüllt das erwartete Interface ${simpleJavaName(quickFix.targetType)} nicht.`;
  }
  if (/cannot find symbol|Symbol (?:kann nicht gefunden|nicht gefunden)/i.test(diagnostic.message)) {
    const method = diagnostic.message.match(/(?:symbol:\s*method|Symbol:\s*Methode)\s+([^\r\n]+)/i)?.[1];
    const owner = diagnostic.message.match(/(?:location:\s*(?:variable\s+\w+\s+of\s+type|class)|Ort:\s*(?:Variable\s+\w+\s+von\s+Typ|Klasse))\s+([^\s\r\n]+)/i)?.[1];
    if (method) {
      return `${owner ? `${owner} stellt` : "Der Typ stellt"} die Methode ${method} nicht bereit. Prüfe die Deklaration oder aktivierte Annotation Processors wie Lombok.`;
    }
    return "Java kann einen verwendeten Typ, eine Methode oder Variable nicht auflösen. Prüfe Namen und Imports.";
  }
  if (/does not override|muss .* implementieren|is not abstract and does not override/i.test(diagnostic.message)) {
    return "Eine erforderliche Interface- oder Basisklassenmethode wurde noch nicht implementiert.";
  }
  // The remaining entries cover the compiler messages that come up most often
  // and read least like an instruction of what to do next.
  if (/';' expected|Semikolon erwartet/i.test(diagnostic.message)) {
    return "Hier fehlt ein Semikolon — meist am Ende der vorherigen Zeile.";
  }
  if (/not a statement|Keine Anweisung/i.test(diagnostic.message)) {
    return "Dieser Ausdruck ist keine eigenständige Java-Anweisung. Ein ternärer Ausdruck (? :) oder Methodenaufruf muss einem Wert zugewiesen (z. B. var x = ...), per return zurückgegeben oder als Parameter übergeben werden.";
  }
  if (/syntax error on token[s]? ["']\?["']|Syntaxfehler bei Token ["']\?["']/i.test(diagnostic.message)) {
    return "Ternärer Operator (? :) unvollständig oder an dieser Stelle ungültig. Stelle sicher, dass Bedingung, ? und : zusammenstehen und das Ergebnis zugewiesen oder zurückgegeben wird.";
  }
  if (/reached end of file while parsing|Dateiende beim Parsen erreicht/i.test(diagnostic.message)) {
    return "Die Datei endet mitten in einem Block. Eine schließende geschweifte Klammer fehlt.";
  }
  if (/class, interface, enum, or record expected/i.test(diagnostic.message)) {
    return "Auf oberster Ebene steht Code außerhalb einer Klasse — oft eine geschweifte Klammer zu viel.";
  }
  if (/incompatible types|inkompatible Typen/i.test(diagnostic.message)) {
    const [, from, to] = diagnostic.message.match(/incompatible types:\s*(\S+)\s+cannot be converted to\s+(\S+)/i) || [];
    return from && to
      ? `${simpleJavaName(from)} passt nicht zu ${simpleJavaName(to)}. Konvertiere den Wert oder passe den Typ an.`
      : "Die Typen passen nicht zusammen. Prüfe Zuweisung und Rückgabetyp.";
  }
  if (/unreported exception|nicht gemeldete Ausnahme/i.test(diagnostic.message)) {
    const type = diagnostic.message.match(/unreported exception\s+(\S+)/i)?.[1];
    return `${type ? simpleJavaName(type) : "Eine geprüfte Ausnahme"} muss gefangen oder mit throws deklariert werden.`;
  }
  if (/might not have been initialized|möglicherweise nicht initialisiert/i.test(diagnostic.message)) {
    return "Die Variable wird gelesen, bevor ihr auf jedem Pfad ein Wert zugewiesen wurde.";
  }
  if (/is already defined|ist bereits definiert/i.test(diagnostic.message)) {
    return "Dieser Name existiert im selben Gültigkeitsbereich schon einmal.";
  }
  if (/package .* does not exist|Paket .* existiert nicht/i.test(diagnostic.message)) {
    const packageName = diagnostic.message.match(/package\s+([\w.]+)\s+does not exist/i)?.[1];
    return `Das Paket ${packageName || "aus dem Import"} liegt nicht im Classpath. Fehlt eine Abhängigkeit im Build?`;
  }
  if (/cannot be applied to given types|kann nicht auf die angegebenen Typen angewendet werden/i.test(diagnostic.message)) {
    return "Die Methode gibt es, aber nicht mit diesen Parametern. Prüfe Anzahl und Reihenfolge der Argumente.";
  }
  if (/has private access|hat privaten Zugriff/i.test(diagnostic.message)) {
    return "Auf dieses Member darf von hier aus nicht zugegriffen werden — es ist private.";
  }
  return diagnostic.message || "Der Java-Compiler hat einen Fehler gemeldet.";
}

export function implementJavaInterface(source: string, sourceType: string, targetType: string): string | null {
  const className = simpleJavaName(sourceType);
  const interfaceName = simpleJavaName(targetType);
  const escapedClass = escapeRegExp(className);
  const declaration = new RegExp(`(\\bclass\\s+${escapedClass}(?:\\s+extends\\s+[^\\s{]+)?)(\\s+implements\\s+([^\\{]+))?(\\s*\\{)`);
  const match = source.match(declaration);
  if (!match) return null;
  const existing = (match[3] || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (existing.some((item) => simpleJavaName(item.replace(/<.*>/, "")) === interfaceName)) return source;
  const replacement = match[2]
    ? `${match[1]} implements ${[...existing, interfaceName].join(", ")}${match[4]}`
    : `${match[1]} implements ${interfaceName}${match[4]}`;
  let updated = source.replace(declaration, replacement);

  const targetPackage = targetType.includes(".") ? targetType.slice(0, targetType.lastIndexOf(".")) : "";
  const sourcePackage = updated.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
  const needsImport = targetPackage
    && targetPackage !== sourcePackage
    && targetPackage !== "java.lang"
    && !new RegExp(`^\\s*import\\s+${escapeRegExp(targetType)}\\s*;`, "m").test(updated);
  if (!needsImport) return updated;

  const newline = updated.includes("\r\n") ? "\r\n" : "\n";
  const imports = [...updated.matchAll(/^[ \t]*import\s+[\w.*]+\s*;[ \t]*$/gm)];
  if (imports.length) {
    const last = imports.at(-1)!;
    const index = (last.index || 0) + last[0].length;
    updated = `${updated.slice(0, index)}${newline}import ${targetType};${updated.slice(index)}`;
  } else {
    const packageMatch = updated.match(/^[ \t]*package\s+[\w.]+\s*;[ \t]*$/m);
    if (packageMatch) {
      const index = (packageMatch.index || 0) + packageMatch[0].length;
      updated = `${updated.slice(0, index)}${newline}${newline}import ${targetType};${updated.slice(index)}`;
    } else {
      updated = `import ${targetType};${newline}${newline}${updated}`;
    }
  }
  return updated;
}

export function normalizeBuildPath(value: string): string {
  const trimmed = String(value || "").trim();
  return /^\/[A-Za-z]:[\\/]/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

function simpleJavaName(value: string): string {
  return value.split(".").at(-1) || value;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function javaTemplate(className: string): string {
  const safeName = className.replace(/\.java$/i, "").replace(/\W/g, "") || "Main";
  return `public class ${safeName} {
    public static void main(String[] args) {
        System.out.println("Hello from Kiwi IDE!");
    }
}
`;
}

/**
 * Counts a fixed set of steps as their promises settle.
 *
 * A rejected step still counts: the progress display must not stall at 4/8
 * because one lookup failed, and the failure is reported by the caller anyway.
 */
export function trackSteps(total: number, report: (done: number, label: string) => void) {
  let done = 0;
  const advance = (label: string) => {
    done = Math.min(done + 1, total);
    report(done, label);
  };
  return <T>(label: string, work: Promise<T>): Promise<T> =>
    work.then(
      (value) => { advance(label); return value; },
      (error) => { advance(label); throw error; },
    );
}

/**
 * The next scale one zoom step away, clamped to the offered range.
 *
 * Extracted so the step order is testable: Chromium's own zoom is bound to the
 * US layout's plus and minus keys, so on a German keyboard shrinking worked and
 * enlarging did not, and its state is separate from this scale anyway.
 */
export const UI_SCALE_STEPS = [0.85, 0.9, 1, 1.1, 1.25, 1.5];

export function nextUiScale(current: number, direction: "in" | "out" | "reset"): number {
  if (direction === "reset") return 1;
  const known = UI_SCALE_STEPS.indexOf(current);
  // An unknown stored value starts from 100 % rather than jumping to an end.
  const index = known < 0 ? UI_SCALE_STEPS.indexOf(1) : known;
  const moved = index + (direction === "in" ? 1 : -1);
  return UI_SCALE_STEPS[Math.max(0, Math.min(UI_SCALE_STEPS.length - 1, moved))];
}

/**
 * The same colour, thinned so a wallpaper shows through it.
 *
 * Monaco takes colours as hex and nothing else, so an existing alpha channel
 * is replaced rather than multiplied. A colour that is already fully
 * transparent stays that way — thinning nothing produces nothing.
 */
export function translucent(color: string, alpha = 0.45): string {
  const text = String(color || "").trim();
  const match = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (!match) return text;
  const digits = match[1];
  const expand = (value: string) => value.split("").map((part) => part + part).join("");
  const rgb = digits.length <= 4 ? expand(digits.slice(0, 3)) : digits.slice(0, 6);
  const existing = digits.length === 4
    ? Number.parseInt(expand(digits.slice(3, 4)), 16)
    : digits.length === 8
      ? Number.parseInt(digits.slice(6, 8), 16)
      : 255;
  if (existing === 0) return `#${rgb}00`;
  const thinned = Math.max(0, Math.min(255, Math.round((existing / 255) * alpha * 255)));
  return `#${rgb}${thinned.toString(16).padStart(2, "0")}`;
}

/**
 * Where a JDK came from, read off its own location.
 *
 * A machine with six of them lists six lines that differ only in a path, and
 * picking the right one means reading it character by character. The
 * distribution is the thing people actually know a JDK by — "the Corretto
 * one", "the one Kiwi downloaded" — so that is what the entry says.
 *
 * Derived from the path rather than from `java -version`, which names the
 * vendor on a line the probe does not keep.
 */
export function jdkSourceLabel(jdkPath: string): string {
  const path = String(jdkPath || "").replace(/[\\/]+/g, "/").toLocaleLowerCase();
  if (!path) return "";
  if (/\/kiwi-ide\/jdks\//.test(path)) return "von Kiwi geladen";
  if (path.includes("corretto")) return "Amazon Corretto";
  if (path.includes("adoptium") || path.includes("temurin")) return "Eclipse Temurin";
  if (path.includes("zulu")) return "Azul Zulu";
  if (path.includes("liberica") || path.includes("bellsoft")) return "BellSoft Liberica";
  if (path.includes("graalvm")) return "GraalVM";
  if (path.includes("semeru") || path.includes("/ibm/")) return "IBM Semeru";
  if (path.includes("/microsoft/")) return "Microsoft Build of OpenJDK";
  if (path.includes("/oracle/") || /\/program files\/java\//.test(path)) return "Oracle";
  if (path.includes("jbrsdk") || path.includes("jetbrains")) return "JetBrains Runtime";
  return "";
}

/** How one JDK reads in a list of them: version, where it came from, where it is. */
export function jdkChoiceLabel(jdk: { major: number; path: string }): string {
  const source = jdkSourceLabel(jdk.path);
  return [`Java ${jdk.major || "?"}`, source, jdk.path].filter(Boolean).join(" · ");
}


/**
 * The project a Gradle task belongs to, "" for the root project.
 *
 * Gradle addresses a subproject's task as `modul:task`, and the tool window
 * used to list every one of them beside the root's own — so `assemble` and
 * `honeymc-cloud:assemble` sat next to each other in the same folder, and the
 * list was twice as long as the build has tasks.
 */
export function taskProjectPath(name: string): string {
  const trimmed = String(name || "").replace(/^:+/, "");
  const cut = trimmed.lastIndexOf(":");
  return cut < 0 ? "" : trimmed.slice(0, cut);
}

/** A task's name without the project in front of it. */
export function taskShortName(name: string): string {
  const trimmed = String(name || "").replace(/^:+/, "");
  return trimmed.slice(trimmed.lastIndexOf(":") + 1);
}

/**
 * The tasks that belong to one project, each named once.
 *
 * A build whose tasks carry no project at all — Maven's lifecycle, a
 * single-project Gradle build — is handed back whole, because there is nothing
 * to split and every task applies to whatever module it is run for.
 */
export function tasksForProject<T extends { name: string }>(tasks: T[], projectPath: string): T[] {
  if (!tasks.some((task) => taskProjectPath(task.name))) return tasks;
  const seen = new Set<string>();
  const result: T[] = [];
  for (const task of tasks) {
    if (taskProjectPath(task.name) !== projectPath) continue;
    const short = taskShortName(task.name);
    if (seen.has(short)) continue;
    seen.add(short);
    result.push(task);
  }
  return result;
}

/** The Gradle path of a module, as its tasks are named: "dienste/web" → "dienste:web". */
export function moduleTaskPath(relativePath: string): string {
  const normalized = String(relativePath || "").replace(/^[.\\/]+|[\\/]+$/g, "");
  return normalized === "." ? "" : normalized.replace(/[\\/]+/g, ":");
}
