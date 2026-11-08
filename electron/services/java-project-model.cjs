const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { isCollectableFile, isSkippedBuildDirectory, relativeTo } = require("./generated-sources.cjs");

const ignoredDirectories = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".kiwi",
  "build",
  "node_modules",
  "out",
  "target",
]);

async function discoverJavaProjectModel(root, projectType = detectBuildSystem(root)) {
  root = path.resolve(root);
  const buildSystem = normalizeBuildSystem(projectType);
  const managedByBuildTool = buildSystem === "Maven" || buildSystem === "Gradle";
  const javaFiles = [];
  const jarFiles = [];
  await collectProjectFiles(root, root, javaFiles, jarFiles, 0, createLimiter(12));

  const metadata = await readModuleMetadata(root);
  const configuredSourceRoots = metadata.modules
    .flatMap((module) => [...(module.sourceRoots || []), ...(module.testRoots || [])])
    .map((candidate) => path.resolve(root, candidate))
    .filter((candidate) => isInside(candidate, root) && fsSync.existsSync(candidate));
  const inferredSourceRoots = managedByBuildTool
    ? []
    : await inferSourceRoots(root, javaFiles);
  const sourceRoots = uniquePaths([...configuredSourceRoots, ...inferredSourceRoots])
    .filter((candidate) => !managedByBuildTool || configuredSourceRoots.includes(candidate));
  const referencedLibraries = uniquePaths([
    ...jarFiles,
    ...metadata.modules
      .flatMap((module) => module.libraries || [])
      .map((candidate) => path.resolve(root, candidate))
      .filter((candidate) => isInside(candidate, root) && fsSync.existsSync(candidate)),
  ])
    .filter((candidate) => !/(?:-sources|-javadoc|-tests)\.jar$/i.test(candidate))
    .map((candidate) => toWorkspacePath(root, candidate));

  return {
    buildSystem,
    managedByBuildTool,
    sourcePaths: sourceRoots.map((candidate) => toWorkspacePath(root, candidate)),
    referencedLibraries,
    javaFiles,
    jarFiles,
    outputPath: ".kiwi/jdt-out",
  };
}

function detectBuildSystem(root) {
  const has = (name) => fsSync.existsSync(path.join(root, name));
  if (has("pom.xml")) return "Maven";
  if (has("build.gradle") || has("build.gradle.kts") || has("settings.gradle") || has("settings.gradle.kts")) {
    return "Gradle";
  }
  if (has(".classpath") || has(".project")) return "Eclipse";
  return "Java";
}

async function collectProjectFiles(root, current, javaFiles, jarFiles, depth = 0, limit = createLimiter(12)) {
  if (depth > 32 || javaFiles.length >= 10_000) return;
  let entries;
  try {
    entries = await limit(() => fs.readdir(current, { withFileTypes: true }));
  } catch {
    return;
  }
  const directories = [];
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    // Generated sources live under target/ and build/, which are otherwise
    // skipped whole. Without this the count of them was always zero.
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)
      && isSkippedBuildDirectory(entry.name, relativeTo(root, target))) continue;
    if (!isInside(target, root)) continue;
    if (entry.isDirectory()) {
      directories.push(target);
      continue;
    }
    if (entry.isFile() && !isCollectableFile(relativeTo(root, target))) continue;
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".java")) javaFiles.push(target);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".jar") && jarFiles.length < 2_000) jarFiles.push(target);
  }
  // Directory reads are independent and dominate cold multi-module imports.
  // A small limiter keeps SSDs busy without flooding network drives or the
  // Electron main process with thousands of simultaneous operations.
  await Promise.all(directories.map((directory) =>
    collectProjectFiles(root, directory, javaFiles, jarFiles, depth + 1, limit),
  ));
}

async function inferSourceRoots(projectRoot, javaFiles) {
  const roots = (await mapConcurrent(javaFiles, 16, async (file) => {
    let source = "";
    let handle;
    try {
      handle = await fs.open(file, "r");
      const buffer = Buffer.alloc(16_384);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      source = buffer.subarray(0, bytesRead).toString("utf8");
    } catch {
      return "";
    } finally {
      await handle?.close().catch(() => undefined);
    }
    const packageName = source.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1] || "";
    let sourceRoot = path.dirname(file);
    if (packageName) {
      const segments = packageName.split(".");
      const directorySegments = path.relative(projectRoot, path.dirname(file)).split(path.sep).filter(Boolean);
      const suffix = directorySegments.slice(-segments.length);
      if (suffix.length === segments.length && suffix.every((part, index) => part === segments[index])) {
        sourceRoot = path.resolve(projectRoot, ...directorySegments.slice(0, -segments.length));
      }
    }
    return isInside(sourceRoot, projectRoot) ? sourceRoot : "";
  })).filter(Boolean);
  return minimizeSourceRoots(uniquePaths(roots));
}

function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const advance = () => {
    if (active >= concurrency || !queue.length) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        advance();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    advance();
  });
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function minimizeSourceRoots(roots) {
  return roots.filter((candidate) => !roots.some((other) =>
    other !== candidate && isInside(other, candidate),
  ));
}

async function readModuleMetadata(root) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, ".kiwi", "modules.json"), "utf8"));
    return { modules: Array.isArray(parsed.modules) ? parsed.modules : [] };
  } catch {
    return { modules: [] };
  }
}

function normalizeBuildSystem(value) {
  const name = String(value || "").toLowerCase();
  if (name === "maven") return "Maven";
  if (name === "gradle") return "Gradle";
  if (name === "eclipse") return "Eclipse";
  return "Java";
}

function uniquePaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.filter(Boolean)) {
    const resolved = path.resolve(value);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function toWorkspacePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (relative || ".").split(path.sep).join("/");
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

module.exports = {
  createLimiter,
  detectBuildSystem,
  discoverJavaProjectModel,
  inferSourceRoots,
  mapConcurrent,
};
