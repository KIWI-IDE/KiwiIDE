const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

class ModuleService {
  constructor(pathGuard, projects) {
    this.pathGuard = pathGuard;
    this.projects = projects;
    this.plans = new Map();
  }

  async list(root) {
    root = this.pathGuard.assertWorkspace(root);
    const project = await this.projects.detect(root);
    const metadata = await this.readMetadata(root);
    const candidates = project.type === "Maven"
      ? await this.mavenModules(root)
      : project.type === "Gradle"
        ? await this.gradleModules(root)
        : await this.plainModules(root, metadata);
    return Promise.all(candidates.map(async (candidate) => {
      const override = metadata.modules.find((item) => item.id === candidate.id || item.path === candidate.relativePath) || {};
      const descriptorPath = [
        ...candidate.sourceRoots,
        path.join(candidate.root, "src"),
      ].map((sourceRoot) => path.join(sourceRoot, "module-info.java")).find((file) => fsSync.existsSync(file));
      const jpms = descriptorPath ? parseModuleInfo(await fs.readFile(descriptorPath, "utf8")) : null;
      return {
        ...candidate,
        jdkPath: String(override.jdkPath || ""),
        languageLevel: String(override.languageLevel || ""),
        dependencies: unique([...(candidate.dependencies || []), ...(override.dependencies || [])]),
        descriptorPath: descriptorPath || null,
        jpms,
      };
    }));
  }

  async previewCreate(root, spec) {
    root = this.pathGuard.assertWorkspace(root);
    const project = await this.projects.detect(root);
    const name = normalizeModuleDisplayName(spec?.name);
    const relativePath = normalizeRelativePath(spec?.relativePath || safeModuleSegment(name));
    const moduleId = stableModuleId(name, relativePath);
    const buildId = safeBuildIdentifier(name);
    const jpmsName = normalizeJpmsName(spec?.jpms && typeof spec.jpms === "object" && spec.jpms.name
      ? spec.jpms.name
      : name);
    const moduleRoot = this.pathGuard.assertAllowed(path.join(root, relativePath), root);
    if (fsSync.existsSync(moduleRoot)) throw new Error("Der Modulordner existiert bereits.");
    const sourceRoot = path.join(moduleRoot, "src", "main", "java");
    const testRoot = path.join(moduleRoot, "src", "test", "java");
    const resourceRoot = path.join(moduleRoot, "src", "main", "resources");
    const testResourceRoot = path.join(moduleRoot, "src", "test", "resources");
    const files = [];

    const moves = [];
    const rootSources = path.join(root, "src");
    const adoptRootSources = Boolean(spec?.adoptRootSources) && await hasJavaSources(rootSources);
    if (adoptRootSources) {
      // The project's own sources move into the module, which is the only way
      // an aggregator can keep building them.
      moves.push({ from: rootSources, to: path.join(moduleRoot, "src") });
    }


    if (project.type === "Maven") {
      const parentPom = path.join(root, "pom.xml");
      const before = await fs.readFile(parentPom, "utf8");
      const after = addMavenModule(before, relativePath);
      files.push(change(parentPom, before, after));
      files.push(change(
        path.join(moduleRoot, "pom.xml"),
        null,
        mavenModulePom(before, buildId, spec?.languageLevel || project.languageLevel || "21"),
      ));
    } else if (project.type === "Gradle") {
      const settingsFile = ["settings.gradle.kts", "settings.gradle"]
        .map((file) => path.join(root, file))
        .find((file) => fsSync.existsSync(file)) || path.join(root, "settings.gradle.kts");
      const before = fsSync.existsSync(settingsFile) ? await fs.readFile(settingsFile, "utf8") : "";
      files.push(change(settingsFile, before, addGradleModule(before, relativePath)));
      files.push(change(
        path.join(moduleRoot, "build.gradle.kts"),
        null,
        gradleModuleBuild(spec?.languageLevel || project.languageLevel || "21"),
      ));
    }

    const metadataFile = path.join(root, ".kiwi", "modules.json");
    const metadataBefore = fsSync.existsSync(metadataFile) ? await fs.readFile(metadataFile, "utf8") : null;
    const metadata = metadataBefore ? JSON.parse(metadataBefore) : { version: 1, modules: [] };
    metadata.modules = Array.isArray(metadata.modules) ? metadata.modules : [];
    metadata.modules.push({
      id: moduleId,
      name,
      path: relativePath,
      type: project.type.toLowerCase(),
      sourceRoots: [path.relative(root, sourceRoot)],
      testRoots: [path.relative(root, testRoot)],
      resourceRoots: [path.relative(root, resourceRoot)],
      testResourceRoots: [path.relative(root, testResourceRoot)],
      dependencies: Array.isArray(spec?.dependencies) ? spec.dependencies : [],
      jdkPath: String(spec?.jdkPath || ""),
      languageLevel: String(spec?.languageLevel || ""),
    });
    files.push(change(metadataFile, metadataBefore, `${JSON.stringify(metadata, null, 2)}\n`));

    if (spec?.jpms !== false && !adoptRootSources) {
      files.push(change(
        path.join(sourceRoot, "module-info.java"),
        null,
        moduleInfoSource(jpmsName, spec?.jpms || {}, (spec?.dependencies || []).map(normalizeJpmsName)),
      ));
    }
    // A module that adopts existing sources already has code; a placeholder
    // class would only be noise in it. The same goes for anyone who asked not
    // to have one.
    if (!adoptRootSources && spec?.sampleClass !== false) {
      const packageName = normalizePackage(spec?.packageName || `dev.kiwi.${safeJavaIdentifier(name)}.api`);
      files.push(change(
        path.join(sourceRoot, ...packageName.split("."), "ModuleApi.java"),
        null,
        `package ${packageName};\n\npublic final class ModuleApi {\n    private ModuleApi() {}\n}\n`,
      ));
    }

    const warnings = [];
    if (!adoptRootSources && project.type === "Maven" && !/<packaging>\s*pom\s*<\/packaging>/i.test(
      fsSync.existsSync(path.join(root, "pom.xml")) ? await fs.readFile(path.join(root, "pom.xml"), "utf8") : "",
    ) && await hasJavaSources(path.join(root, "src"))) {
      warnings.push(
        "Das Projekt bekommt packaging=pom, weil Maven das für Aggregatoren verlangt. "
        + "Die Quellen direkt unter src/ werden danach nicht mehr mitgebaut — "
        + "lege für sie ebenfalls ein Modul an und verschiebe sie dorthin.",
      );
    }

    return this.storePlan(root, "create", {
      id: moduleId,
      name,
      root: moduleRoot,
      projectRoot: root,
      buildSystem: project.type,
      sourceRoots: [sourceRoot],
      testRoots: [testRoot],
      resourceRoots: [resourceRoot],
      testResourceRoots: [testResourceRoot],
    }, files, warnings, moves);
  }

  async previewRemove(root, moduleId) {
    root = this.pathGuard.assertWorkspace(root);
    const modules = await this.list(root);
    const module = modules.find((item) => item.id === moduleId);
    if (!module || module.relativePath === ".") throw new Error("Dieses Modul kann nicht getrennt werden.");
    const project = await this.projects.detect(root);
    const files = [];
    if (project.type === "Maven") {
      const file = path.join(root, "pom.xml");
      const before = await fs.readFile(file, "utf8");
      files.push(change(file, before, removeMavenModule(before, module.relativePath)));
    } else if (project.type === "Gradle") {
      const file = ["settings.gradle.kts", "settings.gradle"].map((name) => path.join(root, name)).find((candidate) => fsSync.existsSync(candidate));
      if (file) {
        const before = await fs.readFile(file, "utf8");
        files.push(change(file, before, removeGradleModule(before, module.relativePath)));
      }
    }
    const metadataFile = path.join(root, ".kiwi", "modules.json");
    const metadataBefore = fsSync.existsSync(metadataFile) ? await fs.readFile(metadataFile, "utf8") : null;
    const metadata = metadataBefore ? JSON.parse(metadataBefore) : { version: 1, modules: [] };
    metadata.modules = (metadata.modules || []).filter((item) => item.id !== moduleId && item.path !== module.relativePath);
    files.push(change(metadataFile, metadataBefore, `${JSON.stringify(metadata, null, 2)}\n`));
    return this.storePlan(root, "detach", module, files);
  }

  async applyPlan(root, planId) {
    root = this.pathGuard.assertWorkspace(root);
    const plan = this.plans.get(planId);
    if (!plan || plan.root !== root) throw new Error("Der Modulplan ist nicht mehr verfügbar.");
    for (const file of plan.files) {
      const current = fsSync.existsSync(file.path) ? await fs.readFile(file.path, "utf8") : null;
      if (digest(current) !== file.beforeHash) {
        throw new Error(`„${path.basename(file.path)}“ wurde während der Vorbereitung geändert. Bitte führe die Aktion erneut aus.`);
      }
    }
    // Moves run first so the new module already owns the sources when the
    // POM that references them is written.
    for (const move of plan.moves || []) {
      const from = this.pathGuard.assertAllowed(move.from, root);
      const to = this.pathGuard.assertAllowed(move.to, root);
      if (!fsSync.existsSync(from)) continue;
      if (fsSync.existsSync(to)) {
        throw new Error(`„${path.relative(root, to)}“ existiert bereits. Der Plan wurde abgebrochen.`);
      }
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    }
    for (const file of plan.files) {
      this.pathGuard.assertAllowed(file.path, root);
      const current = fsSync.existsSync(file.path) ? await fs.readFile(file.path, "utf8") : null;
      if (digest(current) !== file.beforeHash) {
        throw new Error(`„${path.basename(file.path)}“ wurde während des Anwendens geändert. Der Plan wurde abgebrochen.`);
      }
      await fs.mkdir(path.dirname(file.path), { recursive: true });
      await fs.writeFile(file.path, file.after, "utf8");
    }
    if (plan.action === "create") {
      const directories = [
        ...(plan.module.sourceRoots || []),
        ...(plan.module.testRoots || []),
        ...(plan.module.resourceRoots || []),
        ...(plan.module.testResourceRoots || []),
      ];
      for (const directory of directories) {
        await fs.mkdir(this.pathGuard.assertAllowed(directory, root), { recursive: true });
      }
    }
    this.plans.delete(planId);
    return { applied: true, module: plan.module, files: plan.files.map((file) => file.path) };
  }

  async updateSettings(root, moduleId, patch) {
    root = this.pathGuard.assertWorkspace(root);
    const metadata = await this.readMetadata(root);
    let module = metadata.modules.find((item) => item.id === moduleId);
    if (!module) {
      const detected = (await this.list(root)).find((item) => item.id === moduleId);
      if (!detected) throw new Error("Modul nicht gefunden.");
      module = { id: detected.id, name: detected.name, path: detected.relativePath };
      metadata.modules.push(module);
    }
    for (const key of ["jdkPath", "languageLevel", "dependencies"]) {
      if (Object.hasOwn(patch || {}, key)) module[key] = patch[key];
    }
    await fs.mkdir(path.join(root, ".kiwi"), { recursive: true });
    await fs.writeFile(path.join(root, ".kiwi", "modules.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return (await this.list(root)).find((item) => item.id === moduleId);
  }

  async readMetadata(root) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(root, ".kiwi", "modules.json"), "utf8"));
      return { version: 1, modules: Array.isArray(parsed.modules) ? parsed.modules : [] };
    } catch {
      return { version: 1, modules: [] };
    }
  }

  async mavenModules(root) {
    const pom = await fs.readFile(path.join(root, "pom.xml"), "utf8");
    const relativeModules = [...pom.matchAll(/<module>\s*([^<]+)\s*<\/module>/g)].map((match) => normalizeRelativePath(match[1]));
    return [
      moduleCandidate(root, root, ".", "Maven"),
      ...relativeModules.map((relative) => moduleCandidate(root, path.join(root, relative), relative, "Maven")),
    ];
  }

  async gradleModules(root) {
    const file = ["settings.gradle.kts", "settings.gradle"].map((name) => path.join(root, name)).find((candidate) => fsSync.existsSync(candidate));
    const source = file ? await fs.readFile(file, "utf8") : "";
    const includes = parseGradleIncludes(source);
    return [
      moduleCandidate(root, root, ".", "Gradle"),
      ...includes.map((relative) => moduleCandidate(root, path.join(root, relative), relative, "Gradle")),
    ];
  }

  async plainModules(root, metadata) {
    if (!metadata.modules.length) return [moduleCandidate(root, root, ".", "Java")];
    return metadata.modules.map((item) => moduleCandidate(root, path.join(root, item.path || "."), item.path || ".", "Java", item));
  }

  storePlan(root, action, module, files, warnings = [], moves = []) {
    const id = crypto.randomUUID();
    const plan = {
      id,
      root,
      action,
      module,
      warnings,
      moves,
      createdAt: new Date().toISOString(),
      files: files.filter((file) => file.before !== file.after),
    };
    this.plans.set(id, plan);
    return {
      ...plan,
      moves: plan.moves,
      files: plan.files.map((file) => ({
        path: file.path,
        before: file.before,
        after: file.after,
        beforeHash: file.beforeHash,
      })),
    };
  }
}

function moduleCandidate(projectRoot, moduleRoot, relativePath, buildSystem, override = {}) {
  const standardMain = path.join(moduleRoot, "src", "main", "java");
  const main = buildSystem === "Java" && relativePath === "." && !fsSync.existsSync(standardMain)
    ? path.join(moduleRoot, "src")
    : standardMain;
  return {
    id: String(override.id || (relativePath === "." ? path.basename(projectRoot) : relativePath.replace(/[\\/]/g, "."))),
    name: String(override.name || (relativePath === "." ? path.basename(projectRoot) : path.basename(moduleRoot))),
    root: moduleRoot,
    projectRoot,
    relativePath,
    buildSystem,
    sourceRoots: (override.sourceRoots || [path.relative(projectRoot, main)]).map((item) => path.resolve(projectRoot, item)),
    testRoots: (override.testRoots || [path.join(relativePath === "." ? "" : relativePath, "src", "test", "java")]).map((item) => path.resolve(projectRoot, item)),
    resourceRoots: (override.resourceRoots || [path.join(relativePath === "." ? "" : relativePath, "src", "main", "resources")]).map((item) => path.resolve(projectRoot, item)),
    testResourceRoots: (override.testResourceRoots || [path.join(relativePath === "." ? "" : relativePath, "src", "test", "resources")]).map((item) => path.resolve(projectRoot, item)),
    outputPath: path.join(moduleRoot, "build", "classes"),
    dependencies: override.dependencies || [],
  };
}

function change(file, before, after) {
  return { path: file, before, after, beforeHash: digest(before) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value == null ? "<missing>" : value).digest("hex");
}

function normalizeModuleDisplayName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Der Modulname darf nicht leer sein, höchstens 128 Zeichen haben und keine Steuerzeichen enthalten.");
  }
  return name;
}

function safeModuleSegment(value) {
  let result = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!result) result = "module";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result)) result = `_${result}`;
  return result.slice(0, 96);
}

function safeBuildIdentifier(value) {
  const result = String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return (result || "module").slice(0, 96);
}

function safeJavaIdentifier(value) {
  let result = String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_$]+/gu, "_")
    .replace(/^(\p{N})/u, "_$1");
  if (!result) result = "module";
  return result.toLocaleLowerCase();
}

function normalizeJpmsName(value) {
  const parts = String(value || "")
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}_$]+/u)
    .filter(Boolean)
    .map((part) => part.replace(/^(\p{N})/u, "_$1").replace(/[^\p{L}\p{N}_$]/gu, "_"));
  return parts.length ? parts.join(".").toLocaleLowerCase() : "kiwi.module";
}

function stableModuleId(name, relativePath) {
  if (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) return name;
  const prefix = safeBuildIdentifier(name).replace(/[.-]+/g, "_") || "module";
  return `${prefix}-${digest(`${name}\u0000${relativePath}`).slice(0, 8)}`;
}

function normalizePackage(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name)) throw new Error("Ungültiger Package-Name.");
  return name;
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) =>
    part === "."
    || part === ".."
    || !part
    || /[<>:"|?*\u0000-\u001f]/.test(part)
    || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part)
  )) {
    throw new Error("Ungültiger Modulpfad.");
  }
  return normalized.replace(/\//g, path.sep);
}

/**
 * Maven rejects a POM that declares <modules> unless its packaging is `pom`:
 *   'packaging' with value 'jar' is invalid. Aggregator projects require 'pom'.
 * A generated POM carries no <packaging> at all and therefore defaults to jar,
 * so the element has to be inserted as well as corrected.
 */
/** True when the directory tree holds at least one .java file. */
async function hasJavaSources(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (await hasJavaSources(path.join(directory, entry.name))) return true;
    } else if (entry.name.toLowerCase().endsWith(".java")) return true;
  }
  return false;
}

function ensureAggregatorPackaging(source) {
  if (/<packaging>\s*pom\s*<\/packaging>/i.test(source)) return source;
  if (/<packaging>[^<]*<\/packaging>/i.test(source)) {
    return source.replace(/<packaging>[^<]*<\/packaging>/i, "<packaging>pom</packaging>");
  }
  // Maven's conventional order puts packaging directly after the version.
  const version = source.match(/([ \t]*)<version>[^<]*<\/version>[ \t]*\r?\n/);
  if (version) {
    const indent = version[1] || "  ";
    return source.replace(version[0], `${version[0]}${indent}<packaging>pom</packaging>\n`);
  }
  return source.replace(/<\/project>\s*$/, "  <packaging>pom</packaging>\n</project>\n");
}

function addMavenModule(source, modulePath) {
  const xmlPath = escapeXml(modulePath.replace(/\\/g, "/"));
  if (new RegExp(`<module>\\s*${escapeRegExp(xmlPath)}\\s*</module>`).test(source)) {
    return ensureAggregatorPackaging(source);
  }
  const withPackaging = ensureAggregatorPackaging(source);
  if (/<modules>/.test(withPackaging)) {
    return withPackaging.replace(/<\/modules>/, `  <module>${xmlPath}</module>\n  </modules>`);
  }
  return withPackaging.replace(
    /<\/project>\s*$/,
    `  <modules>\n    <module>${xmlPath}</module>\n  </modules>\n</project>\n`,
  );
}

function removeMavenModule(source, modulePath) {
  const xmlPath = escapeXml(modulePath.replace(/\\/g, "/"));
  return source.replace(new RegExp(`\\s*<module>\\s*${escapeRegExp(xmlPath)}\\s*</module>\\s*`, "g"), "\n");
}

function addGradleModule(source, modulePath) {
  const id = gradleProjectId(modulePath);
  if (new RegExp(`include\\s*\\([^)]*["']${escapeRegExp(id)}["']`).test(source) || source.includes(`include '${id}'`)) return source;
  return `${source.trimEnd()}\ninclude("${id}")\n`;
}

/**
 * Takes one project out of the settings file.
 *
 * `include` takes a list, and both Gradle languages are written that way —
 * `include ':api', ':runner'` in Groovy, `include(":api", ":runner")` in
 * Kotlin. Only a call with exactly one name used to be recognised, so removing
 * a module from a list left it declared: the directory was gone and the next
 * build stopped at "project directory does not exist". The others in the call
 * stay where they are; only the whole statement goes when nothing is left.
 */
function removeGradleModule(source, modulePath) {
  const wanted = gradleProjectId(modulePath).replace(/^:/, "");
  const names = (literal) => literal.slice(1, -1).replace(/^:/, "") === wanted;
  const statement = /^([ \t]*)include(\s*\(\s*|[ \t]+)([^\r\n]*?)([ \t]*\)[ \t]*)?(\r?\n|$)/gm;
  return source.replace(statement, (whole, indent, opener, body, closer, ending) => {
    const literals = body.match(/["'][^"']*["']/g) || [];
    if (!literals.some(names)) return whole;
    const kept = literals.filter((literal) => !names(literal));
    if (!kept.length) return "";
    return `${indent}include${opener}${kept.join(", ")}${closer || ""}${ending}`;
  });
}

// `normalizeRelativePath` returns platform separators, so both variants have to
// be translated or Gradle include ids break outside Windows.
function gradleProjectId(modulePath) {
  return String(modulePath).replace(/[\\/]/g, ":").replace(/^:?/, ":");
}

function parseGradleIncludes(source) {
  const result = [];
  for (const match of source.matchAll(/include\s*\(([^)]+)\)|include\s+([^\r\n]+)/g)) {
    const values = (match[1] || match[2] || "").match(/["']([^"']+)["']/g) || [];
    for (const value of values) {
      const id = value.slice(1, -1).replace(/^:/, "").replace(/:/g, path.sep);
      if (id) result.push(id);
    }
  }
  return unique(result);
}

function mavenModulePom(parentPom, artifactId, languageLevel) {
  const groupId = parentPom.match(/<groupId>\s*([^<]+)\s*<\/groupId>/)?.[1] || "com.example";
  const parentArtifact = parentPom.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/)?.[1] || "parent";
  const version = parentPom.match(/<version>\s*([^<]+)\s*<\/version>/)?.[1] || "1.0-SNAPSHOT";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>${groupId}</groupId>\n    <artifactId>${parentArtifact}</artifactId>\n    <version>${version}</version>\n  </parent>\n  <artifactId>${artifactId.replace(/\./g, "-")}</artifactId>\n  <properties>\n    <maven.compiler.release>${languageLevel}</maven.compiler.release>\n  </properties>\n</project>\n`;
}

function gradleModuleBuild(languageLevel) {
  return `plugins {\n    java\n}\n\nrepositories {\n    mavenCentral()\n}\n\njava {\n    toolchain {\n        languageVersion = JavaLanguageVersion.of(${languageLevel})\n    }\n}\n`;
}

function moduleInfoSource(name, jpms, dependencies) {
  const requires = unique([...(dependencies || []), ...(jpms.requires || [])]);
  const lines = [`module ${name} {`];
  for (const dependency of requires) lines.push(`    requires ${dependency};`);
  for (const dependency of jpms.requiresTransitive || []) lines.push(`    requires transitive ${dependency};`);
  for (const exported of jpms.exports || []) lines.push(`    exports ${exported};`);
  for (const opened of jpms.opens || []) lines.push(`    opens ${opened};`);
  for (const used of jpms.uses || []) lines.push(`    uses ${used};`);
  for (const provided of jpms.provides || []) lines.push(`    provides ${provided.service} with ${(provided.implementations || []).join(", ")};`);
  lines.push("}", "");
  return lines.join("\n");
}

function parseModuleInfo(source) {
  return {
    name: source.match(/\bmodule\s+([\w.]+)\s*\{/)?.[1] || "",
    requires: [...source.matchAll(/\brequires\s+(?!transitive\b)(?:static\s+)?([\w.]+)\s*;/g)].map((match) => match[1]),
    requiresTransitive: [...source.matchAll(/\brequires\s+transitive\s+([\w.]+)\s*;/g)].map((match) => match[1]),
    exports: [...source.matchAll(/\bexports\s+([\w.]+)/g)].map((match) => match[1]),
    opens: [...source.matchAll(/\bopens\s+([\w.]+)/g)].map((match) => match[1]),
    uses: [...source.matchAll(/\buses\s+([\w.]+)\s*;/g)].map((match) => match[1]),
    provides: [...source.matchAll(/\bprovides\s+([\w.]+)\s+with\s+([^;]+);/g)].map((match) => ({
      service: match[1],
      implementations: match[2].split(",").map((item) => item.trim()),
    })),
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

module.exports = {
  ModuleService,
  addGradleModule,
  addMavenModule,
  ensureAggregatorPackaging,
  gradleProjectId,
  removeGradleModule,
  removeMavenModule,
  moduleInfoSource,
  parseGradleIncludes,
  parseModuleInfo,
  normalizeJpmsName,
  safeBuildIdentifier,
  safeModuleSegment,
};
