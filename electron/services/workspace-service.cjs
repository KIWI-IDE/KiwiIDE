const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { scanTaskComments } = require("./task-comment-scanner.cjs");
const { validateContent, validateFiles, validatorFor } = require("./file-validators.cjs");
const { maskJavaSource } = require("./source-text.cjs");
const { isCollectableFile, isSkippedBuildDirectory, relativeTo } = require("./generated-sources.cjs");

const ignoredDirectories = new Set([
  ".git", ".idea", ".kiwi", "node_modules", ".gradle", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", "vendor", ".dart_tool",
]);
const buildDirectories = new Set(["target", "build", "out"]);
const generatedDirectories = new Set(["generated", "generated-sources", "generated-test-sources"]);
const textExtensions = new Set([
  ".kt", ".pyi", ".rs", ".php", ".phtml", ".lua", ".go", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hxx", ".hh", ".cs", ".csx", ".m", ".mm", ".cmake", ".csproj", ".sln",
  ".java", ".xml", ".gradle", ".kts", ".properties", ".json", ".md", ".txt",
  ".yaml", ".yml", ".gitignore", ".html", ".css", ".js", ".ts", ".sql", ".sh", ".bat",
  // Formats a Java project carries that the search used to walk straight past.
  // A Gradle version catalogue is a .toml, and a search for a library that is
  // declared in one came back empty rather than saying it had not looked.
  // Kiwi's own request files are .http, which had the same problem.
  ".toml", ".http", ".cfg", ".conf", ".ini", ".env",
  ".tsx", ".jsx", ".mjs", ".cjs", ".jsonc",
  ".scss", ".less", ".svg", ".csv", ".tsv", ".log", ".mf",
  ".ps1", ".cmd", ".py", ".adoc",
]);

/**
 * Files with no extension that are still text.
 *
 * `Dockerfile` and `gradlew` carry no extension at all, so the search skipped
 * them — and a wrapper script is exactly the kind of file somebody searches
 * for a flag in.
 */
const textFileNames = new Set([
  "dockerfile", "makefile", "gradlew", "mvnw", "readme", "license", "notice",
  "changelog", "codeowners", "procfile",
]);

/**
 * How large a file the search will open.
 *
 * Eight megabytes is far past any source file and still small enough that one
 * of them cannot matter. What it protects against is the generated end of the
 * list — a build log, an exported table, a bundled minified script.
 */
const MAX_SEARCHABLE_BYTES = 8 * 1024 * 1024;

/** Whether the project-wide search should read this file. */
function isSearchableTextFile(file) {
  const name = path.basename(String(file || "")).toLowerCase();
  if (name.startsWith(".")) return true;
  if (textFileNames.has(name)) return true;
  return textExtensions.has(path.extname(name));
}

// What the renderer shows when a file operation fails. Node's own text is
// English and names the syscall — "ENOENT: no such file or directory, open
// 'C:\...'" says nothing to someone using a German IDE. Only the codes that
// actually reach a user are translated; anything else keeps its original error,
// because inventing a sentence for an unknown cause hides more than it helps.
const fileSystemTexts = {
  ENOENT: (name) => `„${name}“ wurde nicht gefunden.`,
  EACCES: (name) => `Kein Zugriff auf „${name}“.`,
  EPERM: (name) => `Kein Zugriff auf „${name}“.`,
  EBUSY: (name) => `„${name}“ wird von einem anderen Programm benutzt.`,
  EISDIR: (name) => `„${name}“ ist ein Ordner, keine Datei.`,
  ENOTDIR: (name) => `„${name}“ liegt nicht in einem Ordner.`,
  EEXIST: (name) => `„${name}“ gibt es bereits.`,
  ENOTEMPTY: (name) => `Der Ordner „${name}“ ist nicht leer.`,
  ENOSPC: () => "Auf dem Datenträger ist kein Platz mehr.",
  EMFILE: () => "Es sind zu viele Dateien gleichzeitig geöffnet.",
};

/** Turns a Node file-system error into a sentence the workbench can show. */
function describeFileSystemError(error, fallbackPath = "") {
  const text = fileSystemTexts[error?.code];
  if (!text) return error;
  // Node names the file it tripped over; the caller's path is the fallback for
  // the rare error that carries none.
  const translated = new Error(text(path.basename(error?.path || fallbackPath)));
  translated.code = error.code;
  return translated;
}

/** Sources whose comment syntax the task scanner understands. */
const commentExtensions = new Set([
  ".java", ".gradle", ".kts", ".js", ".ts", ".tsx", ".jsx", ".css", ".sql",
  ".properties", ".sh", ".yaml", ".yml",
  // The scanner reads //, /* */ and #, which is every comment these use. A
  // note left in a version catalogue or a request file belongs in the TODO
  // list with the rest of them.
  ".toml", ".http", ".ini", ".cfg", ".conf", ".mjs", ".cjs", ".ps1", ".scss", ".less",
]);

class WorkspaceService {
  constructor(pathGuard, shell, send, settings = null) {
    this.pathGuard = pathGuard;
    this.shell = shell;
    this.send = send;
    this.settings = settings;
    this.watchers = new Map();
    this.watchTimers = new Map();
    this.watchChanges = new Map();
    this.undoStacks = new Map();
    this.treeCache = new Map();
    this.activeCaptures = new Map();
  }

  async readTree(root, current = root, depth = 0, maxDepth = 1) {
    // Cache under the registered root so `invalidate()` reliably hits the same
    // key even when the renderer passes a differently normalized path.
    const registered = this.pathGuard.assertWorkspace(root);
    if (depth === 0 && samePath(current, root)) current = registered;
    root = registered;
    const cacheable = depth === 0 && samePath(current, root);
    if (cacheable && this.treeCache.has(root)) {
      return structuredClone(this.treeCache.get(root));
    }
    if (depth > 24) return [];
    const entries = await fsp.readdir(current, { withFileTypes: true });
    const sorted = entries
      .filter((entry) => !entry.isDirectory() || !this.isIgnoredDirectory(entry.name))
      .sort((a, b) => {
        const aBuild = a.isDirectory() && buildDirectories.has(a.name.toLocaleLowerCase());
        const bBuild = b.isDirectory() && buildDirectories.has(b.name.toLocaleLowerCase());
        if (aBuild !== bBuild) return aBuild ? -1 : 1;
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    const tree = await Promise.all(sorted.map(async (entry) => {
      const entryPath = path.join(current, entry.name);
      const node = {
        id: entryPath,
        name: entry.name,
        ...(entry.isDirectory() && entry.name.toLocaleLowerCase() === "target" ? { displayName: "build" } : {}),
        path: entryPath,
        type: entry.isDirectory() ? "directory" : "file",
      };
      if (entry.isDirectory()) {
        node.childrenLoaded = depth < maxDepth;
        node.children = depth < maxDepth
          ? await this.readTree(root, entryPath, depth + 1, maxDepth)
          : [];
      } else if (entry.name.toLocaleLowerCase().endsWith(".java")) {
        node.javaKind = await readJavaSourceKind(entryPath);
      }
      return node;
    }));
    if (cacheable) this.treeCache.set(root, structuredClone(tree));
    return tree;
  }

  async readChildren(root, directory) {
    root = this.pathGuard.assertWorkspace(root);
    directory = this.pathGuard.assertAllowed(directory, root);
    const stat = await fsp.stat(directory);
    if (!stat.isDirectory()) throw new Error("Explorer-Kinder können nur für Verzeichnisse geladen werden.");
    return this.readTree(root, directory, 0, 0);
  }

  invalidate(root) {
    if (!root) {
      this.treeCache.clear();
      return;
    }
    for (const key of [...this.treeCache.keys()]) {
      if (samePath(key, root)) this.treeCache.delete(key);
    }
  }

  isIgnoredDirectory(name) {
    if (ignoredDirectories.has(name)) return true;
    const settings = this.settings?.get?.() || {};
    if (settings.explorerHideDotDirectories !== false && String(name).startsWith(".")) return true;
    if (settings.explorerHideBuild !== false && buildDirectories.has(name)) return true;
    if (settings.explorerHideGenerated !== false && generatedDirectories.has(name.toLocaleLowerCase())) return true;
    return (settings.explorerExcludedPatterns || []).some((pattern) => {
      const normalized = String(pattern || "").trim().replace(/^\*\*?[\\/]/, "").replace(/[\\/]\*\*?$/, "");
      return normalized && normalized.toLocaleLowerCase() === name.toLocaleLowerCase();
    });
  }

  isIgnoredWatchPath(relativePath, root = "") {
    const segments = String(relativePath || "").split(/[\\/]/).filter(Boolean);
    return segments.some((segment, index) => {
      if (!this.isIgnoredDirectory(segment)) return false;
      if (!segment.startsWith(".")) return true;
      if (index < segments.length - 1) return true;
      if (!root) return ignoredDirectories.has(segment);
      try {
        return fs.statSync(path.join(root, ...segments.slice(0, index + 1))).isDirectory();
      } catch {
        return false;
      }
    });
  }

  async beginOperation(root, label, paths) {
    root = this.pathGuard.assertWorkspace(root);
    if (this.activeCaptures.has(root)) return this.activeCaptures.get(root);
    const id = await this.capture(root, label || "Projektweite Änderung", paths || []);
    this.activeCaptures.set(root, id || true);
    return id;
  }

  endOperation(root) {
    root = this.pathGuard.assertWorkspace(root);
    this.activeCaptures.delete(root);
    return true;
  }

  async collectFiles(root, predicate, current = root, result = []) {
    this.pathGuard.assertWorkspace(root);
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      // A build directory is still skipped, except along the paths where a
      // build tool puts generated Java. Those classes are compiled against and
      // stepped through, and were unfindable by name.
      if (entry.isDirectory() && (entry.name.startsWith(".")
        || ignoredDirectories.has(entry.name)
        || (buildDirectories.has(entry.name) && isSkippedBuildDirectory(entry.name, relativeTo(root, entryPath))))) continue;
      if (entry.isDirectory()) await this.collectFiles(root, predicate, entryPath, result);
      // Entering a build directory to reach the generated sources under it
      // does not make everything else in there a project file.
      else if (predicate(entryPath) && isCollectableFile(relativeTo(root, entryPath))) result.push(entryPath);
    }
    return result;
  }

  /**
   * Collects TODO/FIXME markers across the whole project.
   *
   * Comment markers are only worth acting on when they can be seen together —
   * a badge on the file currently open says nothing about the four other
   * classes that still carry the same unfinished thought.
   */
  async taskComments(root) {
    this.pathGuard.assertWorkspace(root);
    const files = await this.collectFiles(root, (file) => {
      const extension = path.extname(file).toLowerCase();
      return commentExtensions.has(extension);
    });
    return scanTaskComments(files);
  }

  /**
   * Checks the project's configuration files.
   *
   * Only Java was ever validated, so a broken pom.xml or a tab in a workflow
   * file only showed up once a build failed. Scanning them alongside the
   * sources puts those mistakes in the same list as everything else.
   */
  async validateProject(root) {
    this.pathGuard.assertWorkspace(root);
    const files = await this.collectFiles(root, (file) => Boolean(validatorFor(file)));
    return validateFiles(files);
  }

  /**
   * Checks one buffer's content without touching the disk, so the editor can
   * report while typing rather than only after a save.
   */
  validateBuffer(root, file, content) {
    root = this.pathGuard.assertWorkspace(root);
    return validateContent(this.pathGuard.assertAllowed(file, root), content);
  }

  async search(root, query, options = {}) {
    const text = String(query || "");
    if (!text) return [];
    const pattern = searchPattern(text, options);
    const candidates = await this.collectFiles(root, isSearchableTextFile);
    const matches = [];
    for (const file of candidates.slice(0, 2500)) {
      let content;
      try {
        // A build log or an exported table is text and belongs in the search,
        // and either can be hundreds of megabytes. Read whole and split into
        // lines, one such file is the whole search's memory.
        const { size } = await fsp.stat(file);
        if (size > MAX_SEARCHABLE_BYTES) continue;
        content = await fsp.readFile(file, "utf8");
      } catch { continue; }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        pattern.lastIndex = 0;
        let hit;
        while ((hit = pattern.exec(lines[index])) !== null) {
          matches.push({
            path: file,
            line: index + 1,
            column: hit.index + 1,
            preview: lines[index].trim().slice(0, 200),
          });
          // A pattern like `\b` or `x*` can match the empty string; without
          // this the loop would never leave the position.
          if (hit[0].length === 0) pattern.lastIndex += 1;
          if (matches.length >= 500) return matches;
        }
      }
    }
    return matches;
  }

  async replacePreview(root, query, replacement, options = {}) {
    const matches = await this.search(root, query, options);
    return matches.map((match) => ({
      ...match,
      replacement: match.preview.replace(searchPattern(query, options), replacement),
    }));
  }

  async replaceAll(root, query, replacement, paths, options = {}) {
    if (!query) throw new Error("Der Suchtext darf nicht leer sein.");
    const targets = paths?.length
      ? [...new Set(paths.map((candidate) => this.pathGuard.assertAllowed(candidate, root)))]
      : [...new Set((await this.search(root, query, options)).map((match) => match.path))];
    await this.capture(root, `Ersetzen: ${query}`, targets);
    let replacements = 0;
    for (const file of targets) {
      const content = await fsp.readFile(file, "utf8");
      const pattern = searchPattern(query, options);
      const next = content.replace(pattern, (...args) => {
        replacements += 1;
        // Regex replacements keep $1 style group references usable.
        if (!options.regex) return replacement;
        const groups = args.slice(0, -2);
        return replacement.replace(/\$(\d)/g, (_all, digit) => groups[Number(digit)] ?? "");
      });
      if (next !== content) await fsp.writeFile(file, next, "utf8");
    }
    this.invalidate(root);
    return { files: targets.length, replacements };
  }

  async readFile(filePath) {
    const file = this.pathGuard.assertAllowed(filePath);
    try {
      return await fsp.readFile(file, "utf8");
    } catch (error) {
      throw describeFileSystemError(error, file);
    }
  }

  async writeFile(filePath, content) {
    filePath = this.pathGuard.assertAllowed(filePath);
    const root = this.pathGuard.workspaceFor(filePath);
    const current = await fsp.readFile(filePath, "utf8").catch(() => null);
    if (current !== content) await this.capture(root, `Datei speichern: ${path.basename(filePath)}`, [filePath]);
    try {
      await fsp.writeFile(filePath, content, "utf8");
    } catch (error) {
      throw describeFileSystemError(error, filePath);
    }
    this.invalidate(root);
    return true;
  }

  async create(parent, name, directory) {
    this.pathGuard.assertAllowed(parent);
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      throw new Error("Ungültiger Name.");
    }
    const target = this.pathGuard.assertAllowed(path.join(parent, name));
    await this.capture(this.pathGuard.workspaceFor(parent), `${directory ? "Ordner" : "Datei"} erstellen: ${name}`, [target]);
    try {
      if (directory) await fsp.mkdir(target, { recursive: false });
      else await fsp.writeFile(target, "", { flag: "wx" });
    } catch (error) {
      throw describeFileSystemError(error, target);
    }
    this.invalidate(this.pathGuard.workspaceFor(parent));
    return target;
  }

  async rename(oldPath, name) {
    try {
      return await this.performRename(oldPath, name);
    } catch (error) {
      throw describeFileSystemError(error, oldPath);
    }
  }

  async performRename(oldPath, name) {
    oldPath = this.pathGuard.assertAllowed(oldPath);
    if (!name || name.includes("/") || name.includes("\\")) throw new Error("Ungültiger Name.");
    const target = this.pathGuard.assertAllowed(path.join(path.dirname(oldPath), name));
    const root = this.pathGuard.workspaceFor(oldPath);
    let relatedFiles = [];
    let updatedJavaSource = null;
    if (/\.java$/i.test(oldPath) && /\.java$/i.test(target)) {
      const oldTypeName = path.basename(oldPath, path.extname(oldPath));
      const newTypeName = path.basename(target, path.extname(target));
      if (/^[A-Za-z_$][\w$]*$/.test(oldTypeName) && /^[A-Za-z_$][\w$]*$/.test(newTypeName)) {
        const source = await fsp.readFile(oldPath, "utf8");
        updatedJavaSource = renameTopLevelJavaType(source, oldTypeName, newTypeName);
        relatedFiles = await this.collectFiles(root, (candidate) => candidate.endsWith(".java"));
        await this.capture(root, `Java-Typ umbenennen: ${oldTypeName} → ${newTypeName}`, [...relatedFiles, target]);
      }
    }
    if (!relatedFiles.length) {
      const stat = await fsp.stat(oldPath);
      if (stat.isDirectory()) {
        const oldPackage = packageForDirectory(root, oldPath);
        const newPackage = packageForDirectory(root, target);
        relatedFiles = oldPackage && newPackage && oldPackage !== newPackage
          ? await this.collectFiles(root, (candidate) => candidate.endsWith(".java"))
          : await this.collectFiles(root, (candidate) => candidate.endsWith(".java"), oldPath);
      }
      await this.capture(root, `Umbenennen: ${path.basename(oldPath)} → ${name}`, [...relatedFiles, oldPath, target]);
    }
    await fsp.rename(oldPath, target);
    if (updatedJavaSource !== null) {
      const oldTypeName = path.basename(oldPath, path.extname(oldPath));
      const newTypeName = path.basename(target, path.extname(target));
      for (const file of relatedFiles) {
        const actual = samePath(file, oldPath) ? target : file;
        let source = samePath(file, oldPath) ? updatedJavaSource : await fsp.readFile(file, "utf8");
        source = source.replace(new RegExp(`\\b${escapeRegExp(oldTypeName)}\\b`, "g"), newTypeName);
        await fsp.writeFile(actual, source, "utf8");
      }
    } else {
      const oldPackage = packageForDirectory(root, oldPath);
      const newPackage = packageForDirectory(root, target);
      if (oldPackage && newPackage && oldPackage !== newPackage) {
        const projectFiles = await this.collectFiles(root, (candidate) => candidate.endsWith(".java"));
        for (const file of projectFiles) {
          const source = await fsp.readFile(file, "utf8");
          const next = source.replace(new RegExp(`\\b${escapeRegExp(oldPackage)}(?=\\b|\\.)`, "g"), newPackage);
          if (next !== source) await fsp.writeFile(file, next, "utf8");
        }
      }
    }
    this.invalidate(root);
    this.send("workspace:refactored", { root, oldPath, path: target });
    return target;
  }

  async transfer(source, targetDirectory, move = false) {
    source = this.pathGuard.assertAllowed(source);
    targetDirectory = this.pathGuard.assertAllowed(targetDirectory);
    const target = this.pathGuard.assertAllowed(path.join(targetDirectory, path.basename(source)));
    if (fs.existsSync(target)) throw new Error("Am Ziel existiert bereits ein Element mit diesem Namen.");
    const root = this.pathGuard.workspaceFor(source);
    const sourceStat = await fsp.stat(source);
    const sourceFiles = sourceStat.isDirectory()
      ? await this.collectFiles(root, (candidate) => candidate.endsWith(".java"), source)
      : /\.java$/i.test(source) ? [source] : [];
    const projectJavaFiles = sourceFiles.length
      ? await this.collectFiles(root, (candidate) => candidate.endsWith(".java"))
      : [];
    await this.capture(root, `${move ? "Verschieben" : "Kopieren"}: ${path.basename(source)}`, [
      source,
      target,
      ...(move ? projectJavaFiles : []),
    ]);
    if (move) await fsp.rename(source, target);
    // `errorOnExist` is only honoured while `force` is false, so both flags
    // have to be set or an existing target would be overwritten silently.
    else await fsp.cp(source, target, { recursive: true, force: false, errorOnExist: true });
    if (move && sourceFiles.length === 1 && /\.java$/i.test(source)) {
      await this.updateMovedJavaFile(root, source, target, projectJavaFiles);
      this.send("workspace:refactored", { root, oldPath: source, path: target });
    } else if (move && sourceStat.isDirectory() && sourceFiles.length) {
      const oldPackage = packageForDirectory(root, source);
      const newPackage = packageForDirectory(root, target);
      if (oldPackage && newPackage && oldPackage !== newPackage) {
        const currentProjectFiles = await this.collectFiles(root, (candidate) => candidate.endsWith(".java"));
        const packagePattern = new RegExp(`\\b${escapeRegExp(oldPackage)}(?=\\b|\\.)`, "g");
        for (const file of currentProjectFiles) {
          const content = await fsp.readFile(file, "utf8");
          const updated = content.replace(packagePattern, newPackage);
          if (updated !== content) await fsp.writeFile(file, updated, "utf8");
        }
      }
      this.send("workspace:refactored", { root, oldPath: source, path: target });
    }
    this.invalidate(root);
    return target;
  }

  async importExternal(sources, targetDirectory) {
    targetDirectory = this.pathGuard.assertAllowed(targetDirectory);
    const root = this.pathGuard.workspaceFor(targetDirectory);
    const imported = [];
    for (const rawSource of [...new Set((sources || []).map((item) => path.resolve(String(item || ""))))].slice(0, 100)) {
      const stat = await fsp.lstat(rawSource).catch(() => null);
      if (!stat) throw new Error(`Die abgelegte Datei existiert nicht mehr: ${path.basename(rawSource)}`);
      if (stat.isSymbolicLink()) throw new Error("Symbolische Verknüpfungen können nicht in ein Projekt importiert werden.");
      if (stat.isDirectory() && this.pathGuard.isInside(targetDirectory, rawSource)) {
        throw new Error("Ein Ordner kann nicht in sich selbst kopiert werden.");
      }
      const target = await availableImportTarget(targetDirectory, path.basename(rawSource));
      await this.capture(root, `Importieren: ${path.basename(rawSource)}`, [target]);
      await fsp.cp(rawSource, target, { recursive: true, force: false, errorOnExist: true, dereference: false });
      imported.push(target);
    }
    if (imported.length) {
      this.invalidate(root);
      this.send("workspace:changed", {
        root,
        path: imported.at(-1),
        paths: imported,
        kind: "import",
      });
    }
    return imported;
  }

  async duplicate(source) {
    source = this.pathGuard.assertAllowed(source);
    const extension = path.extname(source);
    const stem = path.basename(source, extension);
    const parent = path.dirname(source);
    let index = 1;
    let target;
    do {
      target = path.join(parent, `${stem} Copy${index === 1 ? "" : ` ${index}`}${extension}`);
      index += 1;
    } while (fs.existsSync(target));
    await this.capture(this.pathGuard.workspaceFor(source), `Duplizieren: ${path.basename(source)}`, [target]);
    await fsp.cp(source, this.pathGuard.assertAllowed(target), { recursive: true });
    this.invalidate(this.pathGuard.workspaceFor(source));
    return target;
  }

  reveal(filePath) {
    const target = this.pathGuard.assertAllowed(filePath);
    this.shell.showItemInFolder(target);
    return true;
  }

  async delete(filePath) {
    const target = this.pathGuard.assertAllowed(filePath);
    const root = this.pathGuard.workspaceFor(target);
    await this.capture(root, `Löschen: ${path.basename(target)}`, [target]);
    await this.shell.trashItem(target);
    if (fs.existsSync(target)) {
      throw new Error(`„${path.basename(target)}“ konnte nicht in den Papierkorb verschoben werden.`);
    }
    this.invalidate(root);
    this.send("workspace:changed", { root, path: target, paths: [target], kind: "delete" });
    return true;
  }

  async updateMovedJavaFile(root, oldPath, target, projectFiles) {
    const oldSource = await fsp.readFile(target, "utf8");
    const oldPackage = oldSource.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || packageForDirectory(root, path.dirname(oldPath));
    const newPackage = packageForDirectory(root, path.dirname(target));
    if (!newPackage || oldPackage === newPackage) return;
    const typeName = path.basename(target, ".java");
    const oldQualified = oldPackage ? `${oldPackage}.${typeName}` : typeName;
    const newQualified = `${newPackage}.${typeName}`;
    const movedSource = oldSource.match(/^\s*package\s+[\w.]+\s*;/m)
      ? oldSource.replace(/^\s*package\s+[\w.]+\s*;/m, `package ${newPackage};`)
      : `package ${newPackage};\n\n${oldSource}`;
    await fsp.writeFile(target, movedSource, "utf8");
    for (const file of projectFiles.filter((candidate) => !samePath(candidate, oldPath))) {
      let source = await fsp.readFile(file, "utf8");
      let next = source.replace(new RegExp(`\\b${escapeRegExp(oldQualified)}\\b`, "g"), newQualified);
      const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
      if (packageName === oldPackage
        && new RegExp(`\\b${escapeRegExp(typeName)}\\b`).test(source)
        && !new RegExp(`\\bimport\\s+${escapeRegExp(newQualified)}\\s*;`).test(source)) {
        next = addJavaImport(next, newQualified);
      }
      if (next !== source) await fsp.writeFile(file, next, "utf8");
    }
  }

  async capture(root, label, candidates) {
    root = this.pathGuard.assertWorkspace(root);
    if (this.activeCaptures.has(root)) return this.activeCaptures.get(root);
    const entries = [];
    const seen = new Set();
    for (const candidate of candidates || []) {
      const target = this.pathGuard.assertAllowed(candidate, root);
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      if (seen.has(key) || target.includes(`${path.sep}.kiwi${path.sep}history${path.sep}`)) continue;
      seen.add(key);
      const stat = await fsp.stat(target).catch(() => null);
      if (!stat) {
        entries.push({ path: path.relative(root, target), existed: false });
        continue;
      }
      if (stat.isDirectory()) {
        entries.push({ path: path.relative(root, target), existed: true, directory: true });
        const files = await this.collectFiles(root, () => true, target).catch(() => []);
        for (const file of files.slice(0, 500)) {
          const content = await fsp.readFile(file).catch(() => null);
          if (content && content.length <= 2_000_000) {
            entries.push({ path: path.relative(root, file), existed: true, content: content.toString("base64") });
          }
        }
      } else {
        const content = await fsp.readFile(target).catch(() => null);
        if (content && content.length <= 2_000_000) {
          entries.push({ path: path.relative(root, target), existed: true, content: content.toString("base64") });
        }
      }
    }
    if (!entries.length) return null;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = { id, label, timestamp: new Date().toISOString(), entries };
    const historyDirectory = path.join(root, ".kiwi", "history");
    await fsp.mkdir(historyDirectory, { recursive: true });
    await fsp.writeFile(path.join(historyDirectory, `${id}.json`), JSON.stringify(record), "utf8");
    const stack = this.undoStacks.get(root) || [];
    this.undoStacks.set(root, [...stack, id].slice(-50));
    const old = (await fsp.readdir(historyDirectory)).filter((name) => name.endsWith(".json")).sort().reverse().slice(80);
    await Promise.all(old.map((name) => fsp.unlink(path.join(historyDirectory, name)).catch(() => undefined)));
    this.send("workspace:history", { root, id, label, timestamp: record.timestamp });
    return id;
  }

  async history(root, file = "") {
    root = this.pathGuard.assertWorkspace(root);
    const directory = path.join(root, ".kiwi", "history");
    const names = await fsp.readdir(directory).catch(() => []);
    const records = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort().reverse().slice(0, 80)) {
      try {
        const record = JSON.parse(await fsp.readFile(path.join(directory, name), "utf8"));
        if (!file || record.entries.some((entry) => samePath(path.join(root, entry.path), file))) {
          records.push({
            id: record.id,
            label: record.label,
            timestamp: record.timestamp,
            files: record.entries.length,
            undone: Boolean(record.undoneAt),
          });
        }
      } catch {}
    }
    return records;
  }

  async undo(root, requestedId = "") {
    root = this.pathGuard.assertWorkspace(root);
    const directory = path.join(root, ".kiwi", "history");
    const stack = this.undoStacks.get(root) || [];
    let id = requestedId || stack.at(-1) || "";
    if (!id) {
      const names = (await fsp.readdir(directory).catch(() => []))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .reverse();
      for (const name of names) {
        try {
          const candidate = JSON.parse(await fsp.readFile(path.join(directory, name), "utf8"));
          if (!candidate.undoneAt) {
            id = candidate.id || name.replace(/\.json$/, "");
            break;
          }
        } catch {}
      }
    }
    if (!id) throw new Error("Keine Dateioperation zum Rückgängigmachen vorhanden.");
    const historyFile = path.join(directory, `${id}.json`);
    const record = JSON.parse(await fsp.readFile(historyFile, "utf8"));
    if (record.undoneAt) throw new Error("Diese Dateioperation wurde bereits rückgängig gemacht.");
    for (const entry of [...record.entries].reverse()) {
      const target = this.pathGuard.assertAllowed(path.join(root, entry.path), root);
      if (!entry.existed) {
        await fsp.rm(target, { recursive: true, force: true });
      } else if (entry.directory) {
        await fsp.mkdir(target, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, Buffer.from(entry.content, "base64"));
      }
    }
    record.undoneAt = new Date().toISOString();
    await fsp.writeFile(historyFile, JSON.stringify(record), "utf8");
    this.undoStacks.set(root, stack.filter((candidate) => candidate !== id));
    this.invalidate(root);
    this.send("workspace:changed", { root, path: root });
    return { restored: true, id, label: record.label };
  }

  watch(root) {
    this.pathGuard.assertWorkspace(root);
    this.unwatch(root);
    try {
      const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename || this.isIgnoredWatchPath(filename, root)) return;
        this.invalidate(root);
        const changes = this.watchChanges.get(root) || new Map();
        const key = String(filename);
        const nextKind = eventType === "rename" ? "rename" : "change";
        // Windows commonly emits rename followed by change for a newly
        // created file. Never downgrade that structural event to a content
        // change or the renderer will not rebuild the Explorer tree.
        changes.set(key, changes.get(key) === "rename" || nextKind === "rename" ? "rename" : "change");
        this.watchChanges.set(root, changes);
        clearTimeout(this.watchTimers.get(root));
        this.watchTimers.set(root, setTimeout(() => {
          const pending = [...(this.watchChanges.get(root) || new Map()).entries()];
          this.watchChanges.delete(root);
          if (!pending.length) return;
          const paths = pending.map(([relative]) => path.join(root, relative));
          this.send("workspace:changed", {
            root,
            path: paths.at(-1),
            paths,
            kind: pending.some(([, kind]) => kind === "rename") ? "rename" : "change",
          });
        }, 240));
      });
      this.watchers.set(root, watcher);
      return true;
    } catch {
      return false;
    }
  }

  unwatch(root) {
    this.watchers.get(root)?.close();
    this.watchers.delete(root);
    clearTimeout(this.watchTimers.get(root));
    this.watchTimers.delete(root);
    this.watchChanges.delete(root);
  }

  dispose() {
    for (const root of this.watchers.keys()) this.unwatch(root);
    this.treeCache.clear();
  }
}

async function availableImportTarget(directory, name) {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  let target = path.join(directory, name);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${stem} (${index})${extension}`);
    index += 1;
  }
  return target;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the pattern for one search. Plain queries stay literal; `regex` hands
 * the query to the engine, and an invalid expression is reported instead of
 * silently returning no hits.
 */
function searchPattern(query, options = {}) {
  const flags = `g${options.caseSensitive ? "" : "i"}`;
  if (!options.regex) {
    const body = escapeRegExp(query);
    return new RegExp(options.wholeWord ? `\\b${body}\\b` : body, flags);
  }
  try {
    return new RegExp(options.wholeWord ? `\\b(?:${query})\\b` : query, flags);
  } catch (error) {
    throw new Error(`Ungültiger regulärer Ausdruck: ${error.message}`);
  }
}

function renameTopLevelJavaType(source, oldName, newName) {
  const escaped = escapeRegExp(oldName);
  const declaration = new RegExp(
    `(\\b(?:public\\s+)?(?:(?:abstract|final|sealed|non-sealed)\\s+)?(?:class|interface|enum|record)\\s+)${escaped}\\b`,
  );
  const annotation = new RegExp(`(\\b(?:public\\s+)?@interface\\s+)${escaped}\\b`);
  const constructor = new RegExp(`(\\b(?:public|protected|private)\\s+)${escaped}(\\s*\\()`, "g");
  return source
    .replace(declaration, `$1${newName}`)
    .replace(annotation, `$1${newName}`)
    .replace(constructor, `$1${newName}$2`);
}

function packageForDirectory(root, directory) {
  const normalized = path.resolve(directory).replace(/\\/g, "/");
  const normalizedRoot = path.resolve(root).replace(/\\/g, "/").replace(/\/+$/, "");
  const markers = ["/src/main/java", "/src/test/java", "/src"];
  const match = markers
    .map((marker) => ({ marker, index: normalized.toLowerCase().lastIndexOf(marker) }))
    .filter((candidate) => candidate.index >= normalizedRoot.length)
    .sort((left, right) => right.index - left.index || right.marker.length - left.marker.length)[0];
  if (!match) return "";
  return normalized.slice(match.index + match.marker.length).split("/").filter(Boolean).join(".");
}

/**
 * What a Java file declares, as the Explorer draws it.
 *
 * Only the type the file is named after counts, so the search stops at the
 * first declaration outside every brace. Reading the first keyword anywhere
 * gave a class holding a nested `enum` the enum's icon, and a class holding a
 * nested `@interface` the annotation's — the two nested forms that are most
 * common are exactly the two that were misread.
 */
function topLevelJavaKind(source) {
  const code = maskJavaSource(source);
  if (/\b(?:org\.junit|junit\.framework)\b|@\s*(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b/.test(code)) {
    return "junit";
  }
  const pattern = /@interface\s+[A-Za-z_$][\w$]*|\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)|([{}])/g;
  let depth = 0;
  for (const match of code.matchAll(pattern)) {
    if (match[3]) {
      depth += match[3] === "{" ? 1 : -1;
      if (depth < 0) depth = 0;
      continue;
    }
    if (depth > 0) continue;
    if (!match[1]) return "annotation";
    if (match[1] !== "class") return match[1];
    return /(?:Exception|Error)$/.test(match[2]) ? "exception" : "class";
  }
  return "class";
}

function addJavaImport(source, qualifiedName) {
  const importLine = `import ${qualifiedName};`;
  // Read the imports off the masked source: a commented-out import begins its
  // line like any other, and appending after one puts the new import inside
  // the comment, where the compiler never sees it.
  //
  // The line ends at its own end. Written as \s* the trailing part ran on
  // through every blank line that followed — and through a blanked-out comment,
  // which is nothing but blank lines — so the import landed several lines down,
  // glued to whatever stood there.
  const line = /^[ \t]*import[ \t]+[^;\n]+;[ \t]*$/gm;
  const masked = maskJavaSource(source);
  if (masked.includes(`import ${qualifiedName};`)) return source;
  const imports = [...masked.matchAll(line)];
  if (imports.length) {
    const last = imports.at(-1);
    const index = last.index + last[0].length;
    return `${source.slice(0, index)}\n${importLine}${source.slice(index)}`;
  }
  const packageMatch = masked.match(/^[ \t]*package[ \t]+[\w.]+[ \t]*;[ \t]*$/m);
  if (packageMatch) {
    const index = packageMatch.index + packageMatch[0].length;
    return `${source.slice(0, index)}\n\n${importLine}${source.slice(index)}`;
  }
  return `${importLine}\n\n${source}`;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readJavaSourceKind(file) {
  let handle;
  try {
    handle = await fsp.open(file, "r");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return topLevelJavaKind(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "class";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

module.exports = {
  WorkspaceService,
  addJavaImport,
  describeFileSystemError,
  ignoredDirectories,
  isSearchableTextFile,
  MAX_SEARCHABLE_BYTES,
  maskJavaSource,
  packageForDirectory,
  readJavaSourceKind,
  topLevelJavaKind,
  renameTopLevelJavaType,
  textExtensions,
  commentExtensions,
};
