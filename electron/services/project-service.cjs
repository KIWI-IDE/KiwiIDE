const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { spawnCapture } = require("./process-utils.cjs");
const { listDownloadedJdks } = require("./jdk-download-service.cjs");
const { PolyglotProjectService, detectPolyglotProject } = require("./polyglot-project-service.cjs");

/**
 * The words Java will not let a name be.
 *
 * Reserved words, the three literals, and the lone underscore Java took back in
 * 9. A name that survives the character filter can still be one of these, and
 * the result is a project that does not compile — with the reason buried in a
 * generated file the user did not write.
 */
const JAVA_RESERVED = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const",
  "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float",
  "for", "goto", "if", "implements", "import", "instanceof", "int", "interface", "long", "native",
  "new", "package", "private", "protected", "public", "return", "short", "static", "strictfp",
  "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "void",
  "volatile", "while", "true", "false", "null", "_",
]);

/**
 * A name Java will accept, or the fallback.
 *
 * The trailing underscore is the conventional escape and keeps the name
 * recognisable: a package the user asked to call "class" becomes "class_"
 * rather than something they cannot connect to what they typed.
 */
function safeJavaIdentifier(value, fallback) {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9_$]/g, "");
  if (!/^[A-Za-z_$]/.test(cleaned)) return fallback;
  return JAVA_RESERVED.has(cleaned.toLowerCase()) ? `${cleaned}_` : cleaned;
}

function safePackage(value) {
  return String(value || "com.example")
    .split(".")
    .map((part) => safeJavaIdentifier(part, "app").toLowerCase())
    .join(".");
}

/**
 * The Java releases a project may be set to compile against.
 *
 * The same list the dropdowns offer, in src/language-levels.ts. It was written
 * out as a regular expression in two places here and as an array in six files
 * over there, and it went out of date: a project set to a release this had not
 * heard of was put back to 21 without a word, while the dropdown went on
 * showing what had been asked for. A test pins the two lists together.
 */
const JAVA_LANGUAGE_LEVELS = ["8", "11", "17", "21", "22", "23", "24", "25", "26"];
const SUPPORTED_LANGUAGE_LEVEL = new RegExp(`^(?:${JAVA_LANGUAGE_LEVELS.join("|")})$`);

const CURRENT_PROJECT_SETTINGS_VERSION = 2;

const projectDefaults = {
  jdkPath: "",
  languageLevel: "21",
  encoding: "UTF-8",
  compilerArgs: "",
  mavenOffline: false,
  gradleOffline: false,
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
  /** Maven profiles or Gradle project properties the build runs with. */
  buildProfiles: [],
  backgroundImage: "",
  fontFamily: "",
  fontFallbacks: "",
};

function migrateProjectSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const allowed = Object.fromEntries(
    Object.entries(source).filter(([key]) => Object.hasOwn(projectDefaults, key)),
  );
  const languageLevel = String(allowed.languageLevel || projectDefaults.languageLevel);
  return {
    ...projectDefaults,
    ...allowed,
    jdkPath: String(allowed.jdkPath || ""),
    languageLevel: SUPPORTED_LANGUAGE_LEVEL.test(languageLevel) ? languageLevel : "21",
    encoding: String(allowed.encoding || "UTF-8"),
    compilerArgs: String(allowed.compilerArgs || ""),
    excludedPaths: Array.isArray(allowed.excludedPaths) ? allowed.excludedPaths.map(String) : [],
    excludedLibraries: Array.isArray(allowed.excludedLibraries) ? allowed.excludedLibraries.map(String) : [],
    // A profile id reaches the command line, so only plain names are kept.
    buildProfiles: Array.isArray(allowed.buildProfiles)
      ? [...new Set(allowed.buildProfiles.map(String).filter((entry) => /^[\w.-]+$/.test(entry)))].slice(0, 20)
      : [],
  };
}

async function writeProjectSettingsFile(file, settings) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(
      temporary,
      `${JSON.stringify({ version: CURRENT_PROJECT_SETTINGS_VERSION, ...migrateProjectSettings(settings) }, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

class ProjectService {
  /**
   * @param downloadedJdkRoot where JDKs Kiwi fetched itself are unpacked. They
   *   live outside Program Files, so without this the IDE would download a
   *   runtime and then report that no JDK is installed.
   */
  constructor(pathGuard, settings, toolchainRoot, downloadedJdkRoot = "") {
    this.pathGuard = pathGuard;
    this.settings = settings;
    this.toolchainRoot = toolchainRoot;
    this.downloadedJdkRoot = downloadedJdkRoot;
    this.jdkProbeCache = new Map();
  }

  async detect(root) {
    this.pathGuard.assertWorkspace(root);
    const has = (name) => fsSync.existsSync(path.join(root, name));
    const gradle = has("build.gradle") || has("build.gradle.kts") || has("settings.gradle") || has("settings.gradle.kts");
    const maven = has("pom.xml");
    const projectSettings = await this.readProjectSettings(root);
    const polyglot = detectPolyglotProject(root);
    if (polyglot) {
      return {
        ...projectSettings,
        ...polyglot,
        javaVersion: "",
        jdkPath: projectSettings.jdkPath || "",
        projectJdkPath: projectSettings.jdkPath || "",
        jdkMajor: 0,
        languageServerReady: false,
        hasWrapper: polyglot.language === "kotlin" && has(process.platform === "win32" ? "gradlew.bat" : "gradlew"),
        projectSettings,
      };
    }
    const jdk = await this.detectJdk(root);
    return {
      ...projectSettings,
      type: gradle ? "Gradle" : maven ? "Maven" : "Java",
      language: "java",
      buildFile: gradle ? (has("build.gradle.kts") ? "build.gradle.kts" : "build.gradle") : maven ? "pom.xml" : null,
      javaVersion: jdk.version,
      jdkPath: jdk.path,
      projectJdkPath: projectSettings.jdkPath || "",
      languageLevel: projectSettings.languageLevel,
      encoding: projectSettings.encoding,
      compilerArgs: projectSettings.compilerArgs,
      mavenOffline: projectSettings.mavenOffline,
      gradleOffline: projectSettings.gradleOffline,
      projectSettings,
      jdkMajor: jdk.major,
      languageServerReady: jdk.major >= 21,
      hasWrapper: gradle ? has(process.platform === "win32" ? "gradlew.bat" : "gradlew") : maven ? has(process.platform === "win32" ? "mvnw.cmd" : "mvnw") : false,
    };
  }

  async readProjectSettings(root) {
    if (!root) return { ...projectDefaults };
    try {
      const file = path.join(root, ".kiwi", "project.json");
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      const migrated = migrateProjectSettings(parsed);
      if (Number(parsed.version || 0) !== CURRENT_PROJECT_SETTINGS_VERSION) {
        await writeProjectSettingsFile(file, migrated);
      }
      return migrated;
    } catch {
      return { ...projectDefaults };
    }
  }

  async updateProjectSettings(root, patch) {
    root = this.pathGuard.assertWorkspace(root);
    const current = await this.readProjectSettings(root);
    const allowed = Object.fromEntries(
      Object.entries(patch || {}).filter(([key]) => Object.hasOwn(projectDefaults, key)),
    );
    if (allowed.jdkPath) {
      const jdk = await this.detectJdk("", String(allowed.jdkPath));
      if (!jdk.available) throw new Error("Das ausgewählte Project SDK ist kein gültiges JDK.");
    }
    if (allowed.languageLevel && !SUPPORTED_LANGUAGE_LEVEL.test(String(allowed.languageLevel))) {
      throw new Error("Nicht unterstütztes Java Language Level.");
    }
    const next = {
      ...current,
      ...allowed,
      jdkPath: String(allowed.jdkPath ?? current.jdkPath ?? ""),
      languageLevel: String(allowed.languageLevel ?? current.languageLevel ?? "21"),
      encoding: String(allowed.encoding ?? current.encoding ?? "UTF-8"),
      compilerArgs: String(allowed.compilerArgs ?? current.compilerArgs ?? ""),
      mavenOffline: Boolean(allowed.mavenOffline ?? current.mavenOffline),
      gradleOffline: Boolean(allowed.gradleOffline ?? current.gradleOffline),
      annotationProcessing: Boolean(allowed.annotationProcessing ?? current.annotationProcessing),
      generatedSources: Boolean(allowed.generatedSources ?? current.generatedSources),
      lombokSupport: Boolean(allowed.lombokSupport ?? current.lombokSupport),
      unusedAnalysis: Boolean(allowed.unusedAnalysis ?? current.unusedAnalysis),
      previewFeatures: Boolean(allowed.previewFeatures ?? current.previewFeatures),
      autoSyncBuild: Boolean(allowed.autoSyncBuild ?? current.autoSyncBuild),
      preferWrapper: Boolean(allowed.preferWrapper ?? current.preferWrapper),
      parallelBuilds: Boolean(allowed.parallelBuilds ?? current.parallelBuilds),
      cleanBeforeTest: Boolean(allowed.cleanBeforeTest ?? current.cleanBeforeTest),
      excludedPaths: Array.isArray(allowed.excludedPaths) ? allowed.excludedPaths.map(String) : current.excludedPaths,
      excludedLibraries: Array.isArray(allowed.excludedLibraries) ? allowed.excludedLibraries.map(String) : current.excludedLibraries,
    };
    const file = path.join(root, ".kiwi", "project.json");
    await writeProjectSettingsFile(file, next);
    return next;
  }

  async detectJdk(root, override) {
    const projectSettings = root ? await this.readProjectSettings(root) : {};
    const globalJdkPath = this.settings.get().jdkPath || "";
    const explicit = override || projectSettings.jdkPath || globalJdkPath || "";
    const configured = explicit || process.env.JAVA_HOME || "";
    const detected = await this.probeJdk(configured);
    const targetLanguageLevel = root ? Number(projectSettings.languageLevel || 0) : 0;
    if (!explicit && targetLanguageLevel > 0 && (!detected.available || detected.major < targetLanguageLevel)) {
      const installed = await Promise.all(this.installedJdkHomes().map((home) => this.probeJdk(home)));
      const compatible = installed
        .filter((jdk) => jdk.available && jdk.major >= targetLanguageLevel)
        .sort((left, right) => left.major - right.major);
      if (compatible.length) return compatible[0];
    }
    return detected;
  }

  async probeJdk(configured) {
    const resolved = configured ? path.resolve(configured) : "";
    const cacheKey = (process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved) || "<path>";
    const cached = this.jdkProbeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60_000) return { ...cached.value };
    const java = configured
      ? path.join(configured, "bin", process.platform === "win32" ? "java.exe" : "java")
      : process.platform === "win32" ? "java.exe" : "java";
    const javac = configured
      ? path.join(configured, "bin", process.platform === "win32" ? "javac.exe" : "javac")
      : process.platform === "win32" ? "javac.exe" : "javac";
    try {
      const result = await spawnCapture(java, ["-XshowSettings:properties", "-version"], { rejectOnError: true });
      const output = `${result.stderr}\n${result.stdout}`;
      const firstLine = output.split(/\r?\n/).find((line) => /^(?:openjdk|java) version\s/.test(line)) || "";
      const version = firstLine.match(/version\s+"([^"]+)/)?.[1] || firstLine;
      const majorText = version.startsWith("1.") ? version.split(".")[1] : version.split(".")[0];
      const runtimeHome = output.match(/^\s*java\.home = (.+)$/m)?.[1]?.trim() || "";
      const runtimeArch = output.match(/^\s*os\.arch = (.+)$/m)?.[1]?.trim();
      const arch = runtimeArch === "aarch64" ? "arm64" : runtimeArch === "amd64" || runtimeArch === "x86_64" ? "x64" : runtimeArch;
      const home = configured || (path.basename(runtimeHome) === "jre" ? path.dirname(runtimeHome) : runtimeHome);
      const compiler = home ? path.join(home, "bin", path.basename(javac)) : javac;
      const value = { available: Boolean(firstLine && home && fsSync.existsSync(compiler)), version: firstLine, major: Number(majorText) || 0, path: home, java, javac: compiler, arch };
      this.jdkProbeCache.set(cacheKey, { timestamp: Date.now(), value });
      return { ...value };
    } catch {
      const value = { available: false, version: "", major: 0, path: configured, java, javac };
      this.jdkProbeCache.set(cacheKey, { timestamp: Date.now(), value });
      return { ...value };
    }
  }

  installedJdkHomes() {
    // Both folders: Kiwi's own, and whichever one somebody pointed the
    // downloader at. Installing into a chosen folder and then not finding the
    // JDK there would look like the download had failed.
    const chosen = String(this.settings?.get?.().jdkInstallRoot || "");
    const downloadRoots = [this.downloadedJdkRoot, chosen].filter(Boolean);
    const seen = new Set();
    const downloaded = [];
    for (const root of downloadRoots) {
      const key = path.resolve(root).toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      downloaded.push(...listDownloadedJdks(root));
    }
    if (process.platform !== "win32") return downloaded;
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const roots = [
      path.join(programFiles, "Java"),
      path.join(programFiles, "Zulu"),
      path.join(programFiles, "Eclipse Adoptium"),
      path.join(programFiles, "Microsoft"),
      path.join(programFiles, "Amazon Corretto"),
    ];
    const homes = new Set();
    for (const candidateRoot of roots) {
      if (!fsSync.existsSync(candidateRoot)) continue;
      for (const entry of fsSync.readdirSync(candidateRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const home = path.join(candidateRoot, entry.name);
        if (fsSync.existsSync(path.join(home, "bin", "java.exe"))
          && fsSync.existsSync(path.join(home, "bin", "javac.exe"))) homes.add(home);
      }
    }
    return [...downloaded, ...homes];
  }

  async listJdks() {
    const candidates = new Set(this.installedJdkHomes());
    const globalJdk = String(this.settings.get().jdkPath || "").trim();
    const javaHome = String(process.env.JAVA_HOME || "").trim();
    if (globalJdk) candidates.add(globalJdk);
    if (javaHome) candidates.add(javaHome);
    const detected = await this.probeJdk("");
    if (detected.available && detected.path) candidates.add(detected.path);
    const jdks = await Promise.all([...candidates].map((home) => this.probeJdk(home)));
    const unique = new Map();
    for (const jdk of jdks) {
      if (!jdk.available || !jdk.path) continue;
      unique.set(path.resolve(jdk.path).toLocaleLowerCase(), {
        available: true,
        version: jdk.version,
        major: jdk.major,
        path: jdk.path,
      });
    }
    return [...unique.values()].sort((left, right) =>
      right.major - left.major || left.path.localeCompare(right.path));
  }

  async create(spec) {
    if (spec.language && spec.language !== "java") {
      return new PolyglotProjectService(this.pathGuard, { settings: this.settings }).create(spec);
    }
    const parent = this.pathGuard.assertWorkspace(spec.location);
    const projectName = String(spec.name || "").trim();
    if (!/^[A-Za-z0-9._-]+$/.test(projectName)) throw new Error("Der Projektname enthält ungültige Zeichen.");
    const root = path.join(parent, projectName);
    if (fsSync.existsSync(root)) throw new Error("Der Zielordner existiert bereits.");

    const template = ["standard", "cli", "spring", "rest", "javafx", "jakarta", "modular", "docker"].includes(spec.template)
      ? spec.template
      : "standard";
    const requestedType = ["Java", "Maven", "Gradle"].includes(spec.type) ? spec.type : "Java";
    const requiresBuildTool = ["cli", "spring", "rest", "javafx", "jakarta", "docker"].includes(template);
    const type = requiresBuildTool && requestedType === "Java" ? "Gradle" : requestedType;
    const groupId = safePackage(spec.groupId || "com.example");
    const artifactId = String(spec.artifactId || projectName).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
    const packageName = safePackage(spec.packageName || `${groupId}.${safeJavaIdentifier(projectName, "app").toLowerCase()}`);
    const packagePath = packageName.replace(/\./g, path.sep);
    const javaRoot = path.join(root, "src", "main", "java");
    const testRoot = path.join(root, "src", "test", "java");
    const resourceRoot = path.join(root, "src", "main", "resources");
    const testResourceRoot = path.join(root, "src", "test", "resources");
    await Promise.all([
      fs.mkdir(path.join(javaRoot, packagePath), { recursive: true }),
      fs.mkdir(path.join(testRoot, packagePath), { recursive: true }),
      fs.mkdir(resourceRoot, { recursive: true }),
      fs.mkdir(testResourceRoot, { recursive: true }),
    ]);

    // The sample class is a convenience, not a requirement: someone adding an
    // existing codebase or starting from a template of their own does not want
    // a Main.java to delete first.
    const withSampleClass = spec?.sampleClass !== false;
    if (withSampleClass) {
      await fs.writeFile(path.join(javaRoot, packagePath, "Main.java"), mainSource(packageName, template), "utf8");
    }
    if (template === "modular") {
      const moduleName = safePackage(`${groupId}.${artifactId.replace(/[-_]+/g, ".")}`);
      await fs.writeFile(path.join(javaRoot, "module-info.java"), `module ${moduleName} {\n    exports ${packageName};\n}\n`, "utf8");
    }
    if (template === "javafx") {
      await fs.writeFile(path.join(javaRoot, packagePath, "MainController.java"), javafxControllerSource(packageName), "utf8");
      await fs.writeFile(path.join(resourceRoot, "main.fxml"), javafxFxml(packageName), "utf8");
    }
    if (template === "jakarta") {
      await fs.writeFile(path.join(javaRoot, packagePath, "Book.java"), jakartaEntitySource(packageName), "utf8");
      await fs.writeFile(path.join(javaRoot, packagePath, "BookRepository.java"), jakartaRepositorySource(packageName), "utf8");
      await fs.mkdir(path.join(resourceRoot, "META-INF"), { recursive: true });
      await fs.writeFile(path.join(resourceRoot, "META-INF", "persistence.xml"), persistenceXml(packageName), "utf8");
    }
    if (template === "spring" || template === "rest") {
      await fs.writeFile(path.join(resourceRoot, "application.properties"), "spring.application.name=kiwi-app\nserver.port=8080\n", "utf8");
    }
    if (template === "docker") {
      await fs.writeFile(path.join(root, "Dockerfile"), dockerfile(projectName), "utf8");
      await fs.writeFile(path.join(root, "compose.yaml"), composeFile(artifactId), "utf8");
    }
    await fs.writeFile(path.join(root, ".gitignore"), ".kiwi/\ntarget/\nbuild/\nout/\n.gradle/\n.idea/\n*.class\n", "utf8");
    const desc = spec.description ? `\n\n${spec.description}` : "\n\nCreated with Kiwi IDE.";
    await fs.writeFile(path.join(root, "README.md"), `# ${projectName}${desc}\n`, "utf8");

    if (type === "Maven") {
      await fs.writeFile(path.join(root, "pom.xml"), mavenPom(groupId, artifactId, spec.languageLevel || "21", template, packageName), "utf8");
      await fs.writeFile(path.join(testRoot, packagePath, "MainTest.java"), testSource(packageName), "utf8");
    }
    if (type === "Gradle") {
      await fs.writeFile(path.join(root, "settings.gradle.kts"), `rootProject.name = "${projectName}"\n`, "utf8");
      await fs.writeFile(path.join(root, "build.gradle.kts"), gradleBuild(packageName, spec.languageLevel || "21", template), "utf8");
      await fs.writeFile(path.join(testRoot, packagePath, "MainTest.java"), testSource(packageName), "utf8");
    }
    await fs.mkdir(path.join(root, ".kiwi"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kiwi", "project.json"),
      `${JSON.stringify({
        version: CURRENT_PROJECT_SETTINGS_VERSION,
        ...projectDefaults,
        jdkPath: String(spec.jdkPath || ""),
        languageLevel: String(spec.languageLevel || "21"),
      }, null, 2)}\n`,
      "utf8",
    );

    if (spec.initGit) {
      try {
        await spawnCapture("git", ["init", "-b", "main"], { cwd: root });
      } catch {
        try {
          await spawnCapture("git", ["init"], { cwd: root });
        } catch {}
      }
    }

    this.pathGuard.register(root);
    await this.settings.rememberWorkspace(root);
    return { root, mainFile: withSampleClass ? path.join(javaRoot, packagePath, "Main.java") : "", type };
  }

  async createSourceElement(root, parent, kind, requestedName, options = {}) {
    root = this.pathGuard.assertWorkspace(root);
    parent = this.pathGuard.assertAllowed(parent || root, root);
    const parentStat = await fs.stat(parent);
    if (!parentStat.isDirectory()) parent = path.dirname(parent);
    const selectedParent = parent;
    const project = await this.detect(root);
    const standardMainRoot = path.join(root, "src", "main", "java");
    const defaultMainRoot = project.type === "Java" && !fsSync.existsSync(standardMainRoot)
      ? path.join(root, "src")
      : standardMainRoot;
    const configuredRoots = await readConfiguredSourceRoots(root);
    const selectedRoot = configuredRoots
      .filter((candidate) => isInside(parent, candidate.path))
      .sort((left, right) => right.path.length - left.path.length)[0]
      || inferStandardSourceRoot(root, parent, project.type);
    const mainRoot = selectedRoot && !selectedRoot.test ? selectedRoot.path : defaultMainRoot;
    const testRoot = selectedRoot?.test
      ? selectedRoot.path
      : pairedTestRoot(mainRoot, root);
    const sourceRoot = kind === "junit"
      ? testRoot
      : selectedRoot?.path || [mainRoot, testRoot].find((candidate) => isInside(parent, candidate)) || mainRoot;
    await fs.mkdir(sourceRoot, { recursive: true });
    if (kind !== "junit" && !isInside(parent, sourceRoot)) parent = sourceRoot;

    if (kind === "package") {
      const packageName = String(requestedName || "").trim();
      if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(packageName)) {
        throw new Error("Ungültiger Package-Name.");
      }
      const currentPackage = isInside(parent, sourceRoot)
        ? path.relative(sourceRoot, parent).split(path.sep).filter(Boolean).join(".")
        : "";
      let target;
      if (currentPackage && packageName.startsWith(`${currentPackage}.`)) {
        const suffix = packageName.slice(currentPackage.length + 1);
        target = path.join(parent, ...suffix.split("."));
      } else if (!packageName.includes(".")) {
        target = path.join(parent, packageName);
      } else {
        target = path.join(sourceRoot, ...packageName.split("."));
      }
      if (fsSync.existsSync(target)) throw new Error("Dieses Package existiert bereits.");
      await fs.mkdir(target, { recursive: true });
      return { path: target, type: "directory", kind };
    }

    const name = String(requestedName || "").replace(/\.java$/i, "").trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error("Ungültiger Java-Typname.");
    const targetParent = kind === "junit"
      ? isInside(selectedParent, testRoot)
        ? selectedParent
        : isInside(selectedParent, mainRoot)
          ? path.join(testRoot, path.relative(mainRoot, selectedParent))
          : testRoot
      : parent;
    await fs.mkdir(targetParent, { recursive: true });
    const file = path.join(targetParent, `${name}.java`);
    if (fsSync.existsSync(file)) throw new Error("Ein Java-Typ mit diesem Namen existiert bereits.");
    const relativePackage = path.relative(kind === "junit" ? testRoot : sourceRoot, targetParent);
    const packageName = relativePackage && relativePackage !== "."
      ? relativePackage.split(path.sep).filter(Boolean).join(".")
      : "";
    await fs.writeFile(file, javaTypeSource(kind, name, packageName, options), "utf8");
    return { path: file, type: "file", kind };
  }

  async frameworkInfo(root) {
    root = this.pathGuard.assertWorkspace(root);
    const files = [];
    await collectFrameworkFiles(root, files);
    const javaFiles = files.filter((file) => file.endsWith(".java"));
    const javaByClass = new Map(javaFiles.map((file) => [path.basename(file, ".java"), file]));
    const symbols = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8").catch(() => "");
      if (!source) continue;
      const lines = source.split(/\r?\n/);
      if (file.endsWith(".java")) {
        lines.forEach((line, index) => {
          const endpoint = line.match(/@(Get|Post|Put|Delete|Patch|Request)Mapping(?:\s*\(([^)]*)\))?/);
          if (endpoint) {
            const route = endpoint[2]?.match(/["']([^"']+)["']/)?.[1] || "/";
            symbols.push({ kind: "endpoint", name: `${endpoint[1].toUpperCase()} ${route}`, detail: "Spring Boot", path: file, line: index + 1 });
          }
          const bean = line.match(/@(Component|Service|Repository|Controller|RestController|Configuration|Bean)\b/);
          if (bean) {
            const declaration = lines.slice(index, index + 4).join(" ").match(/\b(?:class|interface|record)\s+([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*)\s*\(/);
            symbols.push({ kind: "bean", name: declaration?.[1] || declaration?.[2] || bean[1], detail: `@${bean[1]}`, path: file, line: index + 1 });
          }
          if (/@Entity\b/.test(line)) {
            const entity = lines.slice(index, index + 5).join(" ").match(/\bclass\s+([A-Za-z_$][\w$]*)/)?.[1] || path.basename(file, ".java");
            symbols.push({ kind: "entity", name: entity, detail: "Jakarta Persistence", path: file, line: index + 1 });
          }
          const repository = line.match(/\binterface\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:JpaRepository|CrudRepository|PagingAndSortingRepository)\b/);
          if (repository) symbols.push({ kind: "repository", name: repository[1], detail: "Persistence Repository", path: file, line: index + 1 });
        });
      } else if (/\.fxml$/i.test(file)) {
        const controller = source.match(/\bfx:controller\s*=\s*"([^"]+)"/)?.[1] || "";
        const simpleName = controller.split(".").at(-1) || "";
        symbols.push({
          kind: "fxml",
          name: path.basename(file),
          detail: controller ? `Controller: ${controller}` : "JavaFX FXML",
          path: file,
          line: 1,
          targetPath: javaByClass.get(simpleName) || "",
        });
      } else if (/application(?:-[^.]+)?\.properties$/i.test(file)) {
        lines.forEach((line, index) => {
          const property = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)?.[1];
          if (property) symbols.push({ kind: "property", name: property, detail: "Spring Property", path: file, line: index + 1 });
        });
      }
      if (symbols.length >= 2_000) break;
    }
    // What the build file declares outranks what the sources happen to show:
    // a project states its frameworks there before the first bean exists.
    const buildFile = ["pom.xml", "build.gradle", "build.gradle.kts"]
      .map((name) => path.join(root, name))
      .find((candidate) => fsSync.existsSync(candidate));
    const buildSource = buildFile ? await fs.readFile(buildFile, "utf8").catch(() => "") : "";
    const moduleInfo = javaFiles.find((file) => path.basename(file) === "module-info.java");
    const declared = frameworksFromBuildFile(
      buildSource,
      moduleInfo ? await fs.readFile(moduleInfo, "utf8").catch(() => "") : "",
    );
    const fromSymbols = symbols.map((symbol) =>
      symbol.kind === "endpoint" || symbol.kind === "bean" || symbol.kind === "property"
        ? "Spring Boot"
        : symbol.kind === "fxml"
          ? "JavaFX"
          : "Jakarta Persistence");
    return {
      frameworks: [...new Set([...declared.map((entry) => entry.name), ...fromSymbols])],
      declared,
      symbols: symbols.slice(0, 2_000),
    };
  }

  toolPath(id) {
    const executable = id === "maven"
      ? path.join(this.toolchainRoot, "maven", "bin", process.platform === "win32" ? "mvn.cmd" : "mvn")
      : path.join(this.toolchainRoot, "gradle", "bin", process.platform === "win32" ? "gradle.bat" : "gradle");
    return fsSync.existsSync(executable) ? executable : null;
  }
}

/**
 * Frameworks a project declares, read from the build file.
 *
 * Detection used to look only at annotations and .fxml files, so a Spring Boot
 * project reported nothing until someone had written a bean, and a JavaFX
 * project without FXML was never recognised at all. The build file states the
 * intent directly and is the same place Maven and Gradle read it from.
 */
function frameworksFromBuildFile(source, moduleInfo = "") {
  const text = String(source || "");
  const modules = String(moduleInfo || "");
  const found = [];
  const add = (name, evidence) => {
    if (!found.some((entry) => entry.name === name)) found.push({ name, evidence });
  };

  const springBoot = [
    [/<artifactId>\s*spring-boot-starter-parent\s*<\/artifactId>/, "spring-boot-starter-parent"],
    [/<artifactId>\s*spring-boot-maven-plugin\s*<\/artifactId>/, "spring-boot-maven-plugin"],
    [/<artifactId>\s*spring-boot-starter[\w-]*\s*<\/artifactId>/, "spring-boot-starter"],
    [/id\s*\(?\s*["']org\.springframework\.boot["']/, "Gradle-Plugin org.springframework.boot"],
    [/["']org\.springframework\.boot:spring-boot-starter[\w-]*/, "spring-boot-starter"],
  ].find(([pattern]) => pattern.test(text));
  if (springBoot) add("Spring Boot", springBoot[1]);

  // Plain Spring only counts when Boot has not already claimed the project.
  if (!springBoot && /org\.springframework(?![\w.]*boot)/.test(text)) add("Spring", "org.springframework");

  const javafx = [
    [/<artifactId>\s*javafx-maven-plugin\s*<\/artifactId>/, "javafx-maven-plugin"],
    [/<groupId>\s*org\.openjfx\s*<\/groupId>/, "org.openjfx"],
    [/id\s*\(?\s*["']org\.openjfx\.javafxplugin["']/, "Gradle-Plugin org.openjfx.javafxplugin"],
    [/["']org\.openjfx:javafx-[\w-]+/, "org.openjfx"],
  ].find(([pattern]) => pattern.test(text));
  if (javafx) add("JavaFX", javafx[1]);
  else if (/requires\s+javafx\./.test(modules)) add("JavaFX", "requires javafx in module-info.java");

  // Jakarta and the javax packages it replaced are different worlds; reporting
  // them as one hides exactly the migration state someone needs to know.
  if (/<groupId>\s*jakarta\.[\w.]+\s*<\/groupId>|["']jakarta\.[\w.]+:/.test(text)) {
    add("Jakarta EE", "jakarta.* Abhängigkeit");
  }
  if (/<groupId>\s*javax\.[\w.]+\s*<\/groupId>|["']javax\.[\w.]+:/.test(text)) {
    add("Java EE (javax)", "javax.* Abhängigkeit");
  }
  if (/<artifactId>\s*jakarta\.persistence-api\s*<\/artifactId>|["']jakarta\.persistence:/.test(text)) {
    add("Jakarta Persistence", "jakarta.persistence");
  }
  if (/<artifactId>\s*hibernate-core\s*<\/artifactId>|["']org\.hibernate[\w.]*:hibernate-core/.test(text)) {
    add("Hibernate", "hibernate-core");
  }
  return found;
}

async function collectFrameworkFiles(directory, result) {
  const ignored = new Set([".git", ".gradle", ".kiwi", "node_modules", "target", "build", "out"]);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (result.length >= 10_000) return;
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFrameworkFiles(target, result);
    else if (/\.(?:java|fxml|properties)$/i.test(entry.name)) result.push(target);
  }
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readConfiguredSourceRoots(root) {
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(root, ".kiwi", "modules.json"), "utf8"));
    return (metadata.modules || []).flatMap((module) => [
      ...(module.sourceRoots || []).map((candidate) => ({ path: path.resolve(root, candidate), test: false })),
      ...(module.testRoots || []).map((candidate) => ({ path: path.resolve(root, candidate), test: true })),
    ]).filter((candidate) => isInside(candidate.path, root));
  } catch {
    return [];
  }
}

function inferStandardSourceRoot(root, parent, projectType) {
  let current = path.resolve(parent);
  const boundary = path.resolve(root);
  while (isInside(current, boundary)) {
    const normalized = current.replace(/\\/g, "/").toLowerCase();
    if (normalized.endsWith("/src/main/java")) return { path: current, test: false };
    if (normalized.endsWith("/src/test/java")) return { path: current, test: true };
    if (projectType === "Java" && path.basename(current).toLowerCase() === "src") {
      return { path: current, test: false };
    }
    if (current === boundary) break;
    current = path.dirname(current);
  }
  return null;
}

function pairedTestRoot(mainRoot, root) {
  const normalized = mainRoot.replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith("/src/main/java")) {
    return path.resolve(mainRoot, "..", "..", "test", "java");
  }
  return path.join(root, "src", "test", "java");
}

function javaTypeSource(kind, name, packageName, rawOptions = {}) {
  const prefix = packageName ? `package ${packageName};\n\n` : "";
  const options = normalizeJavaTypeOptions(rawOptions);
  const visibility = options.isPublic ? "public " : "";
  const interfaces = options.interfaces.length ? options.interfaces.join(", ") : "";
  if (kind === "interface") {
    const extended = interfaces ? ` extends ${interfaces}` : "";
    return `${prefix}${visibility}interface ${name}${extended} {\n}\n`;
  }
  if (kind === "enum") {
    const implemented = interfaces ? ` implements ${interfaces}` : "";
    return `${prefix}${visibility}enum ${name}${implemented} {\n    VALUE\n}\n`;
  }
  if (kind === "record") {
    const implemented = interfaces ? ` implements ${interfaces}` : "";
    return `${prefix}${visibility}record ${name}()${implemented} {\n}\n`;
  }
  if (kind === "annotation") return `${prefix}${visibility}@interface ${name} {\n}\n`;
  if (kind === "exception") {
    return `${prefix}${visibility}class ${name} extends Exception {\n`
      + `    public ${name}(String message) {\n`
      + `        super(message);\n`
      + `    }\n`
      + `}\n`;
  }
  if (kind === "junit") {
    return `${prefix}import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.assertTrue;\n\nclass ${name} {\n    @Test\n    void testSomething() {\n        assertTrue(true);\n    }\n}\n`;
  }
  const modifier = options.modifier ? `${options.modifier} ` : "";
  const extended = options.extendsType ? ` extends ${options.extendsType}` : "";
  const implemented = interfaces ? ` implements ${interfaces}` : "";
  return `${prefix}${visibility}${modifier}class ${name}${extended}${implemented} {\n}\n`;
}

function normalizeJavaTypeOptions(rawOptions) {
  const validType = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:<[^;\n{}]+>)?$/;
  const extendsType = String(rawOptions?.extendsType || "").trim();
  const interfaces = (Array.isArray(rawOptions?.interfaces)
    ? rawOptions.interfaces
    : String(rawOptions?.interfaces || "").split(","))
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (extendsType && !validType.test(extendsType)) throw new Error("Ungültige Basisklasse.");
  if (interfaces.some((value) => !validType.test(value))) throw new Error("Ungültiger Interface-Name.");
  const modifier = ["abstract", "final"].includes(rawOptions?.modifier) ? rawOptions.modifier : "";
  return {
    isPublic: rawOptions?.isPublic !== false,
    modifier,
    extendsType,
    interfaces,
  };
}

function mainSource(packageName, template = "standard") {
  if (template === "cli") {
    return `package ${packageName};

import picocli.CommandLine;
import picocli.CommandLine.Command;

@Command(name = "kiwi-app", mixinStandardHelpOptions = true, description = "A Kiwi CLI application")
public class Main implements Runnable {
    public static void main(String[] args) {
        System.exit(new CommandLine(new Main()).execute(args));
    }

    @Override
    public void run() {
        System.out.println("Hello from Kiwi CLI!");
    }
}
`;
  }
  if (template === "spring" || template === "rest") {
    return `package ${packageName};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class Main {
    public static void main(String[] args) {
        SpringApplication.run(Main.class, args);
    }

    @GetMapping("${template === "rest" ? "/api/hello" : "/"}")
    String home() {
        return "Hello from Kiwi ${template === "rest" ? "REST API" : "Spring"}!";
    }
}
`;
  }
  if (template === "javafx") {
    return `package ${packageName};

import javafx.application.Application;
import javafx.fxml.FXMLLoader;
import javafx.scene.Scene;
import javafx.stage.Stage;

public class Main extends Application {
    public static void main(String[] args) {
        launch(args);
    }

    @Override
    public void start(Stage stage) throws Exception {
        var view = new FXMLLoader(Main.class.getResource("/main.fxml"));
        stage.setScene(new Scene(view.load(), 420, 240));
        stage.setTitle("Kiwi JavaFX");
        stage.show();
    }
}
`;
  }
  return `package ${packageName};

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Kiwi IDE!");
    }
}
`;
}

function testSource(packageName) {
  return `package ${packageName};

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MainTest {
    @Test
    void kiwiIsReady() {
        assertTrue(true);
    }
}
`;
}

function javafxControllerSource(packageName) {
  return `package ${packageName};

import javafx.fxml.FXML;
import javafx.scene.control.Label;

public class MainController {
    @FXML
    private Label message;

    @FXML
    private void sayHello() {
        message.setText("Hello from Kiwi JavaFX!");
    }
}
`;
}

function javafxFxml(packageName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?import javafx.scene.control.Button?>
<?import javafx.scene.control.Label?>
<?import javafx.scene.layout.VBox?>
<VBox xmlns:fx="http://javafx.com/fxml" fx:controller="${packageName}.MainController"
      alignment="CENTER" spacing="12">
    <Label fx:id="message" text="Kiwi JavaFX"/>
    <Button text="Hallo" onAction="#sayHello"/>
</VBox>
`;
}

function jakartaEntitySource(packageName) {
  return `package ${packageName};

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;

@Entity
public class Book {
    @Id
    @GeneratedValue
    private Long id;
    private String title;

    protected Book() {}

    public Book(String title) {
        this.title = title;
    }
}
`;
}

function jakartaRepositorySource(packageName) {
  return `package ${packageName};

import java.util.List;

public interface BookRepository {
    List<Book> findAll();
}
`;
}

function persistenceXml(packageName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<persistence xmlns="https://jakarta.ee/xml/ns/persistence" version="3.0">
  <persistence-unit name="kiwi">
    <class>${packageName}.Book</class>
  </persistence-unit>
</persistence>
`;
}

function dockerfile(projectName) {
  return `FROM gradle:9-jdk21 AS build
WORKDIR /workspace
COPY . .
RUN gradle installDist --no-daemon && cp -r build/install/${projectName} /opt/app

FROM eclipse-temurin:21-jre
COPY --from=build /opt/app /opt/app
ENTRYPOINT ["/opt/app/bin/${projectName}"]
`;
}

function composeFile(artifactId) {
  return `services:
  app:
    build: .
    image: ${artifactId}:local
`;
}

/**
 * The POM a new Maven project starts from.
 *
 * Laid out the way a POM people write by hand is laid out: the coordinates
 * first with a name and a description beside them, then the properties that
 * pin the Java version and the encoding, then repositories, dependencies and
 * plugins. Four spaces, one element per line — a file somebody is going to
 * edit should not read like something a program produced.
 */
function mavenPom(groupId, artifactId, languageLevel = "21", template = "standard", packageName = "com.example.app") {
  const templateDependencies = template === "cli"
    ? `        <dependency>
            <groupId>info.picocli</groupId>
            <artifactId>picocli</artifactId>
            <version>4.7.7</version>
        </dependency>\n`
    : template === "spring" || template === "rest"
      ? `        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
            <version>3.5.3</version>
        </dependency>\n`
      : template === "jakarta"
        ? `        <dependency>
            <groupId>jakarta.persistence</groupId>
            <artifactId>jakarta.persistence-api</artifactId>
            <version>3.2.0</version>
        </dependency>\n`
      : template === "javafx"
        ? `        <dependency>
            <groupId>org.openjfx</groupId>
            <artifactId>javafx-controls</artifactId>
            <version>21.0.8</version>
        </dependency>
        <dependency>
            <groupId>org.openjfx</groupId>
            <artifactId>javafx-fxml</artifactId>
            <version>21.0.8</version>
        </dependency>\n`
        : "";
  const templatePlugin = template === "spring" || template === "rest"
    ? `            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <version>3.5.3</version>
            </plugin>\n`
    : template === "javafx"
      ? `            <plugin>
                <groupId>org.openjfx</groupId>
                <artifactId>javafx-maven-plugin</artifactId>
                <version>0.0.8</version>
                <configuration>
                    <mainClass>${packageName}.Main</mainClass>
                </configuration>
            </plugin>\n`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
                             http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>${groupId}</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <name>${artifactId}</name>
    <description>Java-Projekt ${artifactId}</description>

    <properties>
        <java.version>${languageLevel}</java.version>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <maven.compiler.source>${languageLevel}</maven.compiler.source>
        <maven.compiler.target>${languageLevel}</maven.compiler.target>
    </properties>

    <repositories>
    </repositories>

    <dependencies>
${templateDependencies}        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.12.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
${templatePlugin}            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.5.3</version>
            </plugin>
            <plugin>
                <groupId>org.codehaus.mojo</groupId>
                <artifactId>exec-maven-plugin</artifactId>
                <version>3.5.0</version>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

/**
 * The build file a new Gradle project starts from.
 *
 * The shape is the one every Gradle tutorial shows, so a project made here
 * looks like a project made anywhere else. Two blocks are Kiwi's and carry a
 * choice the wizard asked for: the toolchain follows the language level that
 * was picked, and the preview switch follows the setting of the same name.
 * Both read a Gradle property, so the build file works unchanged outside Kiwi.
 */
function gradleBuild(packageName, languageLevel = "21", template = "standard") {
  const plugins = template === "spring" || template === "rest"
    ? `    id("org.springframework.boot") version "3.5.3"\n    id("io.spring.dependency-management") version "1.1.7"\n`
    : template === "javafx"
      ? `    id("org.openjfx.javafxplugin") version "0.1.0"\n`
      : "";
  // Only a project that is meant to be started gets the application plugin;
  // without it Gradle has no "run" task and the Run button has nothing to call.
  const application = template === "spring" || template === "rest"
    ? ""
    : `\napplication {\n    mainClass = "${packageName}.Main"\n}\n`;
  const dependencies = template === "cli"
    ? `    implementation("info.picocli:picocli:4.7.7")\n`
    : template === "spring" || template === "rest"
      ? `    implementation("org.springframework.boot:spring-boot-starter-web")\n`
      : template === "jakarta"
        ? `    implementation("jakarta.persistence:jakarta.persistence-api:3.2.0")\n`
      : "";
  const javafx = template === "javafx"
    ? `\njavafx {\n    version = "21.0.8"\n    modules("javafx.controls", "javafx.fxml")\n}\n`
    : "";
  return `plugins {
    id("java")
    id("application")
${plugins}}

group = "${packageName}"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
${dependencies}    testImplementation(platform("org.junit:junit-bom:5.10.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(providers.gradleProperty("kiwiJavaVersion").getOrElse("${languageLevel}"))
    }
}
${application}${javafx}
val kiwiPreview = providers.gradleProperty("kiwiEnablePreview").map(String::toBoolean).getOrElse(false)
if (kiwiPreview) {
    tasks.withType<JavaCompile>().configureEach {
        options.compilerArgs.add("--enable-preview")
    }
    tasks.withType<JavaExec>().configureEach {
        jvmArgs("--enable-preview")
    }
}

tasks.test {
    useJUnitPlatform()
    if (kiwiPreview) jvmArgs("--enable-preview")
}
`;
}

module.exports = {
  JAVA_LANGUAGE_LEVELS,
  JAVA_RESERVED,
  ProjectService,
  javaTypeSource,
  projectDefaults,
  safeJavaIdentifier,
  safePackage,
  migrateProjectSettings,
  CURRENT_PROJECT_SETTINGS_VERSION,
  frameworksFromBuildFile,
};
