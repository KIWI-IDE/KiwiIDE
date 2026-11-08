const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { spawnCapture, streamProcess, terminateProcessTree } = require("./process-utils.cjs");
const { maskXmlComments, xmlLooksIntact } = require("./source-text.cjs");
const { buildToolFromCommand, retryArgsForBuild } = require("./cache-recovery-service.cjs");
const { BuildTaskCache, buildFilesFor } = require("./build-task-cache.cjs");

class BuildService {
  constructor(pathGuard, workspace, projects, modules, send, cacheRecovery = null, taskCache = null) {
    if (typeof send !== "function") {
      send = modules;
      modules = { list: async () => [] };
    }
    this.pathGuard = pathGuard;
    this.workspace = workspace;
    this.projects = projects;
    this.modules = modules || { list: async () => [] };
    this.send = send;
    this.cacheRecovery = cacheRecovery;
    this.active = new Map();
    this.gradleLaunchers = new Map();
    this.generations = new Map();
    // Asking Gradle for its task list costs a configuration phase, and the
    // answer only changes when a build file does. A cache handed in from
    // outside keeps its entries on disk; one made here does not, which is
    // what a test wants.
    this.taskCache = taskCache || new BuildTaskCache();
  }

  resolveBuildTool(root, type, preferWrapper = true) {
    const wrapper = path.join(root, type === "Maven"
      ? process.platform === "win32" ? "mvnw.cmd" : "mvnw"
      : process.platform === "win32" ? "gradlew.bat" : "gradlew");
    const bundled = this.projects.toolPath(type === "Maven" ? "maven" : "gradle");
    const global = type === "Maven"
      ? process.platform === "win32" ? "mvn.cmd" : "mvn"
      : process.platform === "win32" ? "gradle.bat" : "gradle";
    const candidates = preferWrapper ? [wrapper, bundled, global] : [bundled, global, wrapper];
    const selected = candidates.find((candidate) => candidate && (path.isAbsolute(candidate) ? fsSync.existsSync(candidate) : commandExists(candidate))) || candidates.at(-1);
    if (type === "Gradle" && selected) this.gradleLaunchers.set(selected, root);
    return selected;
  }

  /**
   * The module whose root contains `file`, or null for a single-module project.
   * The deepest match wins so a nested module beats its parent.
   */
  async moduleOwning(root, file) {
    if (!file) return null;
    const modules = await this.modules.list(root).catch(() => []);
    const target = path.resolve(file).toLowerCase();
    return modules
      .filter((module) => module.relativePath !== "."
        && target.startsWith(`${path.resolve(module.root).toLowerCase()}${path.sep}`))
      .sort((left, right) => right.root.length - left.root.length)[0] || null;
  }

  async mainClass(file, root, configuredMainClass = "") {
    const sources = await this.workspace.collectFiles(root, (candidate) => candidate.endsWith(".java"));
    if (!sources.length) throw new Error("Keine Java-Quelldateien im Projekt gefunden.");

    const requestedClass = String(configuredMainClass || "").trim();
    if (requestedClass) {
      const suffix = `${path.sep}${requestedClass.replaceAll(".", path.sep)}.java`.toLocaleLowerCase();
      const matching = sources.find((source) => path.resolve(source).toLocaleLowerCase().endsWith(suffix));
      if (matching) return { entry: matching, qualifiedName: requestedClass, sources };
      // A generated main class may not have a source file. Keep the configured
      // class authoritative, while retaining a safe source anchor for module
      // and classpath discovery.
      const anchor = file && file.endsWith(".java")
        ? this.pathGuard.assertAllowed(file, root)
        : sources[0];
      return { entry: anchor, qualifiedName: requestedClass, sources };
    }

    const active = file && file.endsWith(".java")
      ? this.pathGuard.assertAllowed(file, root)
      : "";
    if (active && await sourceContainsMain(active)) return mainClassFromSource(active, sources);

    // Prefer conventional names, but verify the method instead of blindly
    // trying to launch whichever Java file happens to be active.
    const conventional = sources.filter((source) => /(?:Main|Application|Launcher|Bootstrap)\.java$/i.test(source));
    const candidates = [...conventional, ...sources.filter((source) => !conventional.includes(source) && source !== active)];
    for (const candidate of candidates) {
      if (await sourceContainsMain(candidate)) return mainClassFromSource(candidate, sources);
    }
    throw new Error(
      "Keine startbare Java-Klasse gefunden. Erstelle eine public static void main(String[] args)-Methode "
      + "oder wähle eine Java-Run-Konfiguration mit Main Class. Bibliotheken und Server-Plugins wie "
      + "Bukkit/Spigot können nicht direkt gestartet werden: Starte den Host/Server mit JDWP und verwende "
      + "„An laufende JVM andocken…“.",
    );
  }

  start(root, command, args, cwd, env, label, operationId = cryptoId(), recoveryAttempt = false, expectedGeneration = null) {
    let generation = expectedGeneration;
    if (generation === null) {
      this.stop(root);
      generation = (this.generations.get(root) || 0) + 1;
      this.generations.set(root, generation);
    } else if (this.generations.get(root) !== generation) {
      return null;
    }
    this.send("java:output", { projectRoot: root, operationId, stream: "stdout", text: `> ${label || `${command} ${args.join(" ")}`}\n\n` });
    let capturedOutput = "";
    let processHandle;
    processHandle = streamProcess(command, args, {
      cwd,
      env,
      onOutput: (payload) => {
        capturedOutput = `${capturedOutput}${payload.text}`.slice(-512_000);
        this.send("java:output", { ...payload, projectRoot: root, operationId });
      },
      onExit: async ({ code }) => {
        const isCurrent = this.active.get(root) === processHandle;
        if (isCurrent) this.active.delete(root);
        // Ignore the delayed close event from a process replaced by a newer
        // build. Otherwise the old process could close the new build panel.
        if (!isCurrent && this.active.has(root)) return;
        const tool = buildToolFromCommand(command);
        if (code !== 0 && isCurrent && !recoveryAttempt && tool && this.cacheRecovery
          && this.generations.get(root) === generation) {
          const recovery = await this.cacheRecovery.recoverBuild(root, tool, capturedOutput).catch(() => ({ recovered: false }));
          // A newer build or a user Stop can happen while cache recovery is
          // awaiting filesystem work. Never let the stale retry replace it.
          if (this.generations.get(root) !== generation) return;
          if (recovery.recovered) {
            const retryArgs = retryArgsForBuild(tool, args);
            this.send("java:output", {
              projectRoot: root,
              operationId,
              stream: "stdout",
              text: `\nKiwi hat einen beschädigten ${tool}-Cache erkannt, sicher ausgelagert und startet den Build einmal neu.\n\n`,
            });
            this.start(root, command, retryArgs, cwd, env, `${path.basename(command)} ${retryArgs.join(" ")}`, operationId, true, generation);
            return;
          }
        }
        this.notifyWorkspaceChanged(root);
        this.send("java:exit", { projectRoot: root, operationId, code });
      },
    });
    this.active.set(root, processHandle);
    return processHandle;
  }

  notifyWorkspaceChanged(root) {
    this.workspace.invalidate?.(root);
    this.send("workspace:changed", {
      root,
      path: root,
      paths: [root],
      kind: "build",
    });
  }

  async captureBuildTool(root, tool, command, args, options = {}) {
    const first = await spawnCapture(command, args, options);
    if (first.code === 0 || !this.cacheRecovery) return first;
    const output = `${first.stdout || ""}\n${first.stderr || ""}`;
    const recovery = await this.cacheRecovery.recoverBuild(root, tool, output).catch(() => ({ recovered: false }));
    if (!recovery.recovered) return first;
    const retryArgs = retryArgsForBuild(tool, args);
    this.send("java:output", {
      projectRoot: root,
      operationId: cryptoId(),
      stream: "stdout",
      text: `Kiwi hat den beschädigten ${tool}-Cache sicher ausgelagert. Die Projektsynchronisierung wird einmal neu gestartet.\n`,
    });
    return spawnCapture(command, retryArgs, options);
  }

  async execute(payload) {
    const root = this.pathGuard.assertWorkspace(payload.root);
    const project = await this.projects.detect(root);
    const config = payload.configuration || {};
    const module = config.moduleId
      ? (await this.modules.list(root)).find((item) => item.id === config.moduleId)
      : null;
    const action = payload.action || "run";
    const cwd = config.workingDirectory
      ? this.pathGuard.assertAllowed(config.workingDirectory, root)
      : root;
    const jdk = await this.projects.detectJdk(root, config.jdkPath || module?.jdkPath);
    const languageLevel = module?.languageLevel || project.languageLevel;
    const env = {
      ...process.env,
      ...(jdk.available ? {
        JAVA_HOME: jdk.path,
        PATH: `${path.join(jdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}`,
      } : {}),
      ...(config.env || {}),
    };
    if (languageLevel) env.ORG_GRADLE_PROJECT_kiwiJavaVersion = languageLevel;
    const targetLanguageLevel = Number(languageLevel || 0);
    if (config.type !== "docker" && config.type !== "compose") {
      if (!jdk.available) throw new Error("Kein Project SDK gefunden. Wähle unter Einstellungen ein installiertes JDK aus.");
      if (targetLanguageLevel > 0 && targetLanguageLevel > jdk.major) {
        throw new Error(
          `Das Projekt verwendet Java ${targetLanguageLevel}, das ausgewählte Project SDK unterstützt aber nur Java ${jdk.major}. `
          + `Wähle ein JDK ${targetLanguageLevel} oder neuer unter Einstellungen › Java & SDKs.`,
        );
      }
    }

    if (config.type === "docker" || config.type === "compose") {
      const command = process.platform === "win32" ? "docker.exe" : "docker";
      const targets = splitArgs(config.target || (config.type === "compose" ? "up --build" : "build -t kiwi-app ."));
      const args = config.type === "compose" ? ["compose", ...targets] : targets;
      const operationId = cryptoId();
      this.start(root, command, args, cwd, env, `docker ${args.join(" ")}`, operationId);
      return { command: `docker ${args.join(" ")}`, project, projectRoot: root, operationId };
    }

    if (project.type === "Gradle" || config.type === "gradle") {
      const command = this.resolveBuildTool(root, "Gradle", project.preferWrapper !== false);
      let targets = config.type === "gradle" && config.target
        ? splitArgs(config.target)
        : [action === "test" ? "test" : action === "build" ? "build" : "run"];
      if (module && module.relativePath !== ".") {
        targets = targets.map((target) =>
          target.startsWith("-") || target.startsWith(":")
            ? target
            : `:${module.relativePath.replace(/[\\/]/g, ":")}:${target}`,
        );
      }
      const args = [...targets, "--console=plain", "--no-daemon"];
      // Running one class should not compile the test sources with it. Gradle's
      // run task does not depend on them, but a project that wires extra work
      // into "run" would otherwise pay for it on every start.
      if (action === "run" && !(config.type === "gradle" && config.target)) args.push("-x", "test");
      if (project.gradleOffline) args.push("--offline");
      if (project.parallelBuilds) args.push("--parallel");
      if (project.previewFeatures) args.push("-PkiwiEnablePreview=true");
      if (config.type === "junit" && config.target) args.push("--tests", config.target);
      if (config.programArgs && targets.some((target) => /(?:^|:)run$/.test(target))) args.push(`--args=${config.programArgs}`);
      // A Gradle build has no profiles; the selected variants become the
      // project properties the script checks for.
      for (const variant of selectedProfiles(config, project)) args.push(`-P${variant}=true`);
      const operationId = cryptoId();
      this.start(root, command, args, cwd, env, `${path.basename(command)} ${args.join(" ")}`, operationId);
      return { command: `${path.basename(command)} ${args.join(" ")}`, project, projectRoot: root, operationId };
    }

    if (project.type === "Maven" || config.type === "maven" || config.type === "junit") {
      const command = this.resolveBuildTool(root, "Maven", project.preferWrapper !== false);
      let goals;
      // A run has to happen inside the module that owns the main class. On an
      // aggregator POM exec:java would otherwise execute against the parent,
      // which has no classes at all.
      let runModule = module;
      if (config.type === "maven" && config.target) goals = splitArgs(config.target);
      else if (config.type === "junit") goals = [...(project.cleanBeforeTest ? ["clean"] : []), "test", ...(config.target ? [`-Dtest=${config.target}`] : [])];
      else if (action === "test") goals = [...(project.cleanBeforeTest ? ["clean"] : []), "test"];
      else if (action === "build") goals = ["package"];
      else {
        const main = await this.mainClass(payload.file, root);
        const mainClassName = config.mainClass || main.qualifiedName;
        if (!runModule) runModule = await this.moduleOwning(root, main.entry);
        // "compile" only, never "package" or "test": running one class must not
        // drag the whole lifecycle along. Maven's compiler plugin is already
        // incremental, so an unchanged module recompiles nothing.
        goals = ["compile", "exec:java", `-Dexec.mainClass=${mainClassName}`, "-Dmaven.test.skip=true"];
        if (config.programArgs) goals.push(`-Dexec.args=${config.programArgs}`);
      }
      if (runModule && runModule.relativePath !== ".") {
        // exec:java is a CLI goal and runs for every project in the reactor, so
        // -am would execute it on the aggregator first, where no class exists.
        // Builds still need the dependencies, hence -am only outside a run.
        const alsoMake = action === "run" && !config.target ? [] : ["-am"];
        goals.unshift(...alsoMake, "-pl", runModule.relativePath.replace(/\\/g, "/"));
      }
      if (languageLevel) goals.push(`-Dmaven.compiler.release=${languageLevel}`);
      // Since JDK 23 javac no longer discovers annotation processors implicitly.
      // Keep Maven builds aligned with Kiwi's project-level setting so Lombok
      // and other processors continue to generate their members.
      goals.push(project.annotationProcessing === false
        ? "-Dmaven.compiler.proc=none"
        : "-Dmaven.compiler.proc=full");
      if (project.previewFeatures) goals.push("-Dmaven.compiler.enablePreview=true");
      if (project.parallelBuilds) goals.unshift("-T", "1C");
      if (project.mavenOffline) goals.unshift("-o");
      // Profiles come last so an explicit selection wins over the defaults.
      const profiles = selectedProfiles(config, project);
      if (profiles.length) goals.push(`-P${profiles.join(",")}`);
      const operationId = cryptoId();
      this.start(root, command, goals, cwd, env, `${path.basename(command)} ${goals.join(" ")}`, operationId);
      return { command: `${path.basename(command)} ${goals.join(" ")}`, project, projectRoot: root, operationId };
    }

    const plainModules = await this.modules.list(root);
    if (plainModules.length > 1 || plainModules.some((item) => item.relativePath !== ".")) {
      return this.executePlainModules({ root, project, config, payload, modules: plainModules, action });
    }

    const plainMain = action === "run"
      ? await this.mainClass(payload.file, root, config.mainClass)
      : null;
    const sources = plainMain?.sources
      || await this.workspace.collectFiles(root, (candidate) => candidate.endsWith(".java"));
    const qualifiedName = plainMain?.qualifiedName || "";
    const output = path.join(root, "build", "classes");
    await fs.mkdir(output, { recursive: true });
    if (!jdk.available) throw new Error("Kein JDK gefunden. Wähle unter Einstellungen ein JDK aus.");
    const plainTargetLanguageLevel = Number(languageLevel || jdk.major);
    if (plainTargetLanguageLevel > jdk.major) {
      throw new Error(`Das Modul-SDK ${jdk.major} kann Java ${plainTargetLanguageLevel} nicht kompilieren.`);
    }
    const compileArgs = [
      "-g",
      "-encoding", project.encoding || "UTF-8",
      ...(plainTargetLanguageLevel ? ["--release", String(plainTargetLanguageLevel)] : []),
      ...(project.previewFeatures ? ["--enable-preview"] : []),
      ...splitArgs(project.compilerArgs || ""),
      "-d", output,
      ...sources,
    ];
    await copyResourceRoots([path.join(root, "src", "main", "resources")], output);

    if (action === "build" || action === "test") {
      const operationId = cryptoId();
      this.start(root, jdk.javac, compileArgs, cwd, env, `javac (${sources.length} Dateien)`, operationId);
      return { command: `javac (${sources.length} Dateien)`, project, projectRoot: root, operationId };
    }

    this.stop(root);
    const operationId = cryptoId();
    this.send("java:output", { projectRoot: root, operationId, stream: "stdout", text: `> javac -g (${sources.length} Dateien)\n\n` });
    const compile = spawn(jdk.javac, compileArgs, { cwd, env, windowsHide: true });
    this.active.set(root, compile);
    compile.stdout.on("data", (data) => this.send("java:output", { projectRoot: root, operationId, stream: "stdout", text: data.toString() }));
    compile.stderr.on("data", (data) => this.send("java:output", { projectRoot: root, operationId, stream: "stderr", text: data.toString() }));
    compile.on("error", (error) => this.send("java:output", { projectRoot: root, operationId, stream: "stderr", text: `${error.message}\n` }));
    compile.on("close", (code) => {
      if (code !== 0) {
        this.active.delete(root);
        this.notifyWorkspaceChanged(root);
        this.send("java:exit", { projectRoot: root, operationId, code: code ?? 1 });
        return;
      }
      this.notifyWorkspaceChanged(root);
      const runArgs = [
        ...splitArgs(config.vmArgs || ""),
        ...(project.previewFeatures ? ["--enable-preview"] : []),
        "-cp", output,
        config.mainClass || qualifiedName,
        ...splitArgs(config.programArgs || ""),
      ];
      this.start(root, jdk.java, runArgs, cwd, env, `java ${config.mainClass || qualifiedName}`, operationId);
    });
    return { command: `javac → java ${config.mainClass || qualifiedName}`, project, projectRoot: root, operationId };
  }

  async executePlainModules({ root, project, config, payload, modules, action }) {
    const ordered = topologicalSortModules(modules);
    const selected = config.moduleId
      ? ordered.find((item) => item.id === config.moduleId)
      : ordered.at(-1);
    if (!selected) throw new Error("Kein ausführbares Modul gefunden.");
    const required = dependencyClosure(selected.id, ordered);
    const buildOrder = ordered.filter((item) => required.has(item.id));
    const operationId = cryptoId();
    this.stop(root);
    this.send("java:output", {
      projectRoot: root,
      moduleId: selected.id,
      operationId,
      stream: "stdout",
      text: `> Plain-Java-Modulbuild: ${buildOrder.map((item) => item.name).join(" → ")}\n\n`,
    });

    for (const module of buildOrder) {
      const jdk = await this.projects.detectJdk(root, config.jdkPath || module.jdkPath);
      if (!jdk.available) throw new Error(`Kein JDK für Modul „${module.name}“ gefunden.`);
      const target = Number(module.languageLevel || project.languageLevel || jdk.major);
      if (target > jdk.major) {
        throw new Error(`Modul „${module.name}“ benötigt Java ${target}, sein SDK unterstützt aber nur Java ${jdk.major}.`);
      }
      const sources = [];
      for (const sourceRoot of module.sourceRoots) {
        if (!fsSync.existsSync(sourceRoot)) continue;
        await this.workspace.collectFiles(root, (file) => file.endsWith(".java"), sourceRoot, sources);
      }
      await fs.mkdir(module.outputPath, { recursive: true });
      const dependencies = (module.dependencies || [])
        .map((id) => ordered.find((candidate) => candidate.id === id)?.outputPath)
        .filter(Boolean);
      const modulePathArgs = dependencies.length
        ? [module.descriptorPath ? "--module-path" : "-classpath", dependencies.join(path.delimiter)]
        : [];
      // A run must not rebuild what is already current. "build" and "test" are
      // explicit requests to compile, so those still always do.
      const current = action === "run" && moduleOutputIsCurrent(
        sources.map((file) => fsSync.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? Infinity),
        collectClassTimes(module.outputPath),
      );
      if (current) {
        this.send("java:output", {
          projectRoot: root,
          moduleId: module.id,
          operationId,
          stream: "stdout",
          text: `[${module.name}] unverändert — kein Neubau\n`,
        });
      }
      if (sources.length && !current) {
        const args = [
          "-g",
          "-encoding", project.encoding || "UTF-8",
          "--release", String(target),
          ...(project.previewFeatures ? ["--enable-preview"] : []),
          ...modulePathArgs,
          ...splitArgs(project.compilerArgs || ""),
          "-d", module.outputPath,
          ...sources,
        ];
        this.send("java:output", {
          projectRoot: root,
          moduleId: module.id,
          operationId,
          stream: "stdout",
          text: `[${module.name}] javac --release ${target} (${sources.length} Dateien)\n`,
        });
        const result = await spawnCapture(jdk.javac, args, {
          cwd: module.root,
          rejectOnError: true,
          env: {
            ...process.env,
            JAVA_HOME: jdk.path,
            PATH: `${path.join(jdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}`,
          },
        });
        if (result.output) {
          this.send("java:output", { projectRoot: root, moduleId: module.id, operationId, stream: "stdout", text: result.output });
        }
      }
      await copyResourceRoots(module.resourceRoots || [], module.outputPath);
    }

    if (action === "build" || action === "test") {
      this.notifyWorkspaceChanged(root);
      this.send("java:exit", { projectRoot: root, moduleId: selected.id, operationId, code: 0 });
      return { command: `javac modules (${buildOrder.length})`, project, projectRoot: root, moduleId: selected.id, operationId };
    }

    const selectedJdk = await this.projects.detectJdk(root, config.jdkPath || selected.jdkPath);
    const { qualifiedName } = await this.mainClass(payload.file, root);
    const outputs = buildOrder.map((item) => item.outputPath);
    const runArgs = [
      ...splitArgs(config.vmArgs || ""),
      ...(project.previewFeatures ? ["--enable-preview"] : []),
      ...(selected.jpms?.name
        ? ["--module-path", outputs.join(path.delimiter), "-m", `${selected.jpms.name}/${config.mainClass || qualifiedName}`]
        : ["-classpath", outputs.join(path.delimiter), config.mainClass || qualifiedName]),
      ...splitArgs(config.programArgs || ""),
    ];
    const env = {
      ...process.env,
      JAVA_HOME: selectedJdk.path,
      PATH: `${path.join(selectedJdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}`,
      ...(config.env || {}),
    };
    this.notifyWorkspaceChanged(root);
    this.start(root, selectedJdk.java, runArgs, selected.root, env, `java ${config.mainClass || qualifiedName}`, operationId);
    return { command: `javac modules → java ${config.mainClass || qualifiedName}`, project, projectRoot: root, moduleId: selected.id, operationId };
  }

  /**
   * Every task the project's own build files declare, root and subprojects.
   *
   * The subprojects come from the settings file rather than from whatever
   * directories happen to contain a build file: a build file outside the
   * declared set is not part of this build, and a settings entry that points
   * out of the project is refused rather than followed.
   */
  async gradleDeclaredTasks(root, rootScript) {
    const read = (file) => fs.readFile(file, "utf8").catch(() => "");
    const tasks = gradleScriptTasks(rootScript);
    const settings = await read(path.join(root, "settings.gradle.kts"))
      || await read(path.join(root, "settings.gradle"));
    // Kept beside the tasks: the cache has to watch every build file this
    // answer came from, not only the root's.
    const included = gradleIncludedProjects(settings);
    tasks.subprojects = included;
    for (const name of included) {
      const directory = path.resolve(root, ...name.split(":"));
      if (directory !== root && !directory.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
      const script = await read(path.join(directory, "build.gradle.kts"))
        || await read(path.join(directory, "build.gradle"));
      if (!script) continue;
      for (const task of gradleScriptTasks(script, name)) {
        if (!tasks.some((existing) => existing.name === task.name)) tasks.push(task);
      }
    }
    return tasks;
  }

  /**
   * The tasks of a build, remembered until a build file changes.
   *
   * `refresh` asks Gradle again regardless, which is what the tool window's
   * reload button is for: a cache nobody can overrule is a cache somebody
   * eventually has to restart the IDE to get past.
   */
  async listTasks(root, { refresh = false } = {}) {
    if (!refresh) {
      const stored = await this.taskCache.get(root);
      if (stored) return stored;
    }
    const answer = await this.readTasks(root);
    // Only a real answer is worth keeping. One that came back with a reason —
    // Gradle could not configure, the wrapper is missing — is a fallback
    // list, and remembering it would hide the fix when it arrives.
    if (!answer.reason) {
      const files = buildFilesFor(root, answer.type, answer.subprojects || []);
      // The launcher itself, so replacing the bundled toolchain or letting a
      // wrapper download a new Gradle invalidates the entry as well. Best
      // effort: not knowing where the launcher is costs one more watched
      // file, never the stored answer.
      let launcher = "";
      try {
        if (answer.type !== "Java") launcher = this.resolveBuildTool(root, answer.type, true);
      } catch {
        launcher = "";
      }
      await this.taskCache.set(root, answer, launcher ? [...files, launcher] : files);
    }
    return answer;
  }

  async readTasks(root) {
    const project = await this.projects.detect(root);
    if (project.type === "Maven") {
      // Comments blanked out first. A module or a plugin that somebody has
      // commented out is not part of the build, and offering its goal produces
      // "no plugin descriptor found" from a tool window that looked certain.
      const pom = maskXmlComments(await fs.readFile(path.join(root, "pom.xml"), "utf8"));
      const modules = [...pom.matchAll(/<module>\s*([^<]+)\s*<\/module>/g)].map((match) => match[1]);
      // Read the modules too, the way the Gradle side reads every build file:
      // in an aggregator the root pom carries the module list and little else,
      // and the plugin that produces the artifact sits one directory down.
      const moduleSources = await Promise.all(modules.map((name) =>
        fs.readFile(path.join(root, ...String(name).split(/[\\/]/), "pom.xml"), "utf8")
          .then(maskXmlComments)
          .catch(() => "")));
      return {
        type: "Maven",
        tasks: mavenTasks([pom, ...moduleSources].join("\n")),
        modules,
        // The files this answer was read from, so it can be kept until
        // one of them is written again.
        subprojects: modules,
        profiles: mavenProfiles(pom),
        /*
         * A pom that does not parse still yields the Maven lifecycle: the
         * goals are read with regular expressions, and those find something
         * in any text at all. The list was therefore reported as a working
         * project's, and the first build was the first anybody heard of it.
         */
        reason: xmlLooksIntact(pom)
          ? ""
          : "Die pom.xml ist unvollständig oder nicht wohlgeformt; Maven wird sie ablehnen.",
      };
    }
    if (project.type === "Gradle") {
      const command = this.resolveBuildTool(root, "Gradle", project.preferWrapper !== false);
      const script = await fs.readFile(path.join(root, project.buildFile || "build.gradle"), "utf8").catch(() => "");
      const variants = gradleVariants(script);
      // What the build files themselves say, which is available whether or not
      // Gradle can be run at all — and that means every build file, not just
      // the root's. In a multi-project build the root often declares nothing
      // but the plugins, and the task somebody actually wants lives one
      // directory down.
      const declared = await this.gradleDeclaredTasks(root, script);
      try {
        const result = await this.captureBuildTool(root, "Gradle", command, ["tasks", "--all", "--console=plain", "--no-daemon"], {
          cwd: root,
          // A cold Gradle start is slow, but without a bound a hung daemon
          // would leave the tool window loading forever.
          timeoutMs: 180_000,
        });
        // A non-zero exit is not an exception here — captureBuildTool hands the
        // failed result back — so a Gradle build that refuses to configure used
        // to arrive as an empty stdout, parse to nothing and leave the tool
        // window saying the project has no tasks at all. The standard Java
        // lifecycle is a truthful answer, and the reason belongs with it.
        const discovered = result.code === 0 ? parseGradleTasks(result.stdout) : [];
        if (!discovered.length) {
          return {
            type: "Gradle",
            tasks: mergeGradleTasks(gradleFallbackTasks(), declared),
            modules: [],
            profiles: variants,
            reason: gradleTaskFailureReason(result),
          };
        }
        // Keep the everyday tasks at the top the way IntelliJ does, then the
        // groups Gradle itself reports.
        const listed = mergeGradleTasks(discovered, declared);
        const shortcuts = gradleShortcuts(listed);
        return {
          type: "Gradle",
          tasks: [...shortcuts, ...listed],
          modules: [],
          // Every subproject whose build file this answer depends on.
          subprojects: declared.subprojects || [],
          profiles: variants,
        };
      } catch (error) {
        return {
          type: "Gradle",
          tasks: mergeGradleTasks(gradleFallbackTasks(), declared),
          modules: [],
          profiles: variants,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      type: "Java",
      tasks: [
        { name: "build", description: "Alle Java-Quellen kompilieren", group: "Java" },
        { name: "run", description: "Ausgewählte Main-Klasse starten", group: "Java" },
      ],
      modules: [],
      profiles: [],
    };
  }

  async dependencies(root, projectPath = "") {
    const project = await this.projects.detect(root);
    if (project.type === "Maven") {
      const command = this.resolveBuildTool(root, "Maven", project.preferWrapper !== false);
      return (await this.captureBuildTool(root, "Maven", command, [
        ...(project.mavenOffline ? ["-o"] : []),
        // One module of a reactor, asked for by itself. Without this every
        // module in the tree reported the aggregate, which is the root's
        // answer wearing the module's name.
        ...(projectPath ? ["-pl", projectPath.replace(/:/g, "/")] : []),
        "dependency:tree",
        "-DoutputType=text",
      ], { cwd: root })).output;
    }
    if (project.type === "Gradle") {
      const command = this.resolveBuildTool(root, "Gradle", project.preferWrapper !== false);
      return (await this.captureBuildTool(root, "Gradle", command, [
        projectPath ? `:${projectPath}:dependencies` : "dependencies",
        "--console=plain",
        "--no-daemon",
        ...(project.gradleOffline ? ["--offline"] : []),
      ], { cwd: root })).output;
    }
    return "Plain Java projects do not declare external dependencies.";
  }

  async dependencyTree(root, projectPath = "") {
    root = this.pathGuard.assertWorkspace(root);
    const project = await this.projects.detect(root);
    const raw = await this.dependencies(root, projectPath);
    const parsed = project.type === "Maven"
      ? parseMavenDependencyTree(raw)
      : project.type === "Gradle"
        ? parseGradleDependencyTree(raw)
        : { configurations: [], conflicts: [] };
    for (const configuration of parsed.configurations) {
      attachDependencyArtifacts(configuration.nodes);
    }
    return { type: project.type, projectPath, ...parsed, raw };
  }

  async auditDependencies(root) {
    root = this.pathGuard.assertWorkspace(root);
    const project = await this.projects.detect(root);
    const dependencies = [];
    if (project.type === "Maven") {
      const pom = await fs.readFile(path.join(root, "pom.xml"), "utf8");
      for (const block of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const group = block[1].match(/<groupId>\s*([^<]+)\s*<\/groupId>/)?.[1]?.trim() || "";
        const artifact = block[1].match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/)?.[1]?.trim() || "";
        const version = block[1].match(/<version>\s*([^<]+)\s*<\/version>/)?.[1]?.trim() || "";
        if (group && artifact) dependencies.push({ coordinate: `${group}:${artifact}`, version });
      }
    } else if (project.type === "Gradle") {
      const buildFile = ["build.gradle.kts", "build.gradle"].map((name) => path.join(root, name)).find(fsSync.existsSync);
      const source = buildFile ? await fs.readFile(buildFile, "utf8") : "";
      for (const match of source.matchAll(/(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*["']([^:"']+):([^:"']+):([^"']+)["']/g)) {
        dependencies.push({ coordinate: `${match[1]}:${match[2]}`, version: match[3] });
      }
    }
    const warnings = dependencies.flatMap((dependency) => {
      const issues = [];
      if (!dependency.version) issues.push("Version wird extern verwaltet; Update-Status im Dependency Tree prüfen.");
      if (/[+[\],()]/.test(dependency.version) || /latest|release/i.test(dependency.version)) {
        issues.push("Dynamische oder ungebundene Version erschwert reproduzierbare Builds.");
      }
      if (/snapshot/i.test(dependency.version)) issues.push("Snapshot-Version kann sich ohne Versionswechsel ändern.");
      return issues.map((message) => ({ ...dependency, message }));
    });
    return {
      type: project.type,
      dependencies,
      warnings,
      unusedTask: project.type === "Maven" ? "dependency:analyze" : "dependencies",
      updatesTask: project.type === "Maven" ? "versions:display-dependency-updates" : "dependencyUpdates",
      securityTask: project.type === "Maven"
        ? "org.owasp:dependency-check-maven:check"
        : "dependencyCheckAnalyze",
    };
  }

  stop(root) {
    if (!root) {
      let stopped = false;
      for (const projectRoot of new Set([...this.active.keys(), ...this.generations.keys()])) {
        stopped = this.stop(projectRoot) || stopped;
      }
      return stopped;
    }
    this.generations.set(root, (this.generations.get(root) || 0) + 1);
    const processHandle = this.active.get(root);
    if (!processHandle) return false;
    void terminateProcessTree(processHandle);
    this.active.delete(root);
    return true;
  }

  async shutdown() {
    this.stop();
    const launchers = [...this.gradleLaunchers.entries()];
    this.gradleLaunchers.clear();
    await Promise.allSettled(launchers.map(([command, root]) => spawnCapture(command, ["--stop"], {
      cwd: fsSync.existsSync(root) ? root : process.cwd(),
      timeoutMs: 8_000,
      rejectOnError: false,
    })));
    return true;
  }
}

/**
 * The profiles a build should run with: what the run configuration names, and
 * otherwise what the project has stored as its selection.
 */
function selectedProfiles(config, project) {
  const raw = config.profiles !== undefined ? config.profiles : project.buildProfiles;
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return [...new Set(list.map((entry) => String(entry).trim()).filter((entry) => /^[\w.-]+$/.test(entry)))];
}

function cryptoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function splitArgs(value) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = pattern.exec(String(value)))) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

function commandExists(command) {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { windowsHide: true });
  return probe.status === 0;
}

/**
 * Maven tasks in the shape IntelliJ presents them: the full default lifecycle
 * in its real order, then the goals of plugins the POM actually declares.
 * Offering `deploy` next to `compile` without the phases in between is what
 * made the previous list feel arbitrary.
 */
function mavenTasks(pom = "") {
  const lifecycle = [
    ["clean", "Ausgabeverzeichnis target/ löschen"],
    ["validate", "Projekt und Konfiguration prüfen"],
    ["compile", "Quellcode übersetzen"],
    ["test", "Unit-Tests ausführen"],
    ["package", "Artefakt erzeugen (jar/war)"],
    ["verify", "Integrationstests und Prüfungen"],
    ["install", "Ins lokale Repository legen"],
    ["site", "Projektdokumentation erzeugen"],
    ["deploy", "Ins entfernte Repository veröffentlichen"],
  ].map(([name, description]) => ({ name, description, group: "Lifecycle" }));

  // Common shortcuts; IntelliJ shows the equivalent as run configurations.
  const shortcuts = [
    { name: "clean package", description: "Neu bauen: löschen und Artefakt erzeugen", group: "Häufig verwendet" },
    { name: "clean install", description: "Neu bauen und lokal installieren", group: "Häufig verwendet" },
    { name: "test-compile", description: "Auch Testquellen übersetzen", group: "Häufig verwendet" },
  ];

  const plugins = [
    { name: "dependency:tree", description: "Abhängigkeitsbaum anzeigen", group: "Abhängigkeiten" },
    { name: "dependency:analyze", description: "Ungenutzte und fehlende Abhängigkeiten finden", group: "Abhängigkeiten" },
    { name: "dependency:purge-local-repository", description: "Zwischengespeicherte Artefakte neu laden", group: "Abhängigkeiten" },
    { name: "versions:display-dependency-updates", description: "Verfügbare Versionsaktualisierungen", group: "Abhängigkeiten" },
  ];

  // Only advertise goals whose plugin is present, so nothing in the list fails
  // with "no plugin descriptor found".
  const declared = [];
  if (/<artifactId>\s*spring-boot-maven-plugin\s*<\/artifactId>/.test(pom)) {
    declared.push({ name: "spring-boot:run", description: "Spring-Boot-Anwendung starten", group: "Plugins" });
    declared.push({ name: "spring-boot:build-image", description: "Container-Image bauen", group: "Plugins" });
  }
  if (/<artifactId>\s*exec-maven-plugin\s*<\/artifactId>/.test(pom)) {
    declared.push({ name: "exec:java", description: "Main-Klasse über Maven starten", group: "Plugins" });
  }
  if (/<artifactId>\s*javafx-maven-plugin\s*<\/artifactId>/.test(pom)) {
    declared.push({ name: "javafx:run", description: "JavaFX-Anwendung starten", group: "Plugins" });
  }
  if (/<artifactId>\s*maven-shade-plugin\s*<\/artifactId>/.test(pom)) {
    declared.push({ name: "shade:shade", description: "Fat-Jar erzeugen", group: "Plugins" });
  }
  return [...shortcuts, ...lifecycle, ...plugins, ...declared];
}

/** Everyday Gradle invocations, offered ahead of the reported task groups. */
/**
 * The row of everyday tasks at the top of the tool window.
 *
 * Filtered against what the project has, because offering `run` to a library
 * is an invitation to a build failure. A project whose whole point is a fat jar
 * gets shadowJar up there too, rather than buried under "Other tasks" where the
 * task list puts everything a plugin contributes.
 */
function gradleShortcuts(available = null) {
  const everyday = [
    { name: "clean build", description: "Neu bauen: löschen und bauen", group: "Häufig verwendet" },
    { name: "build", description: "Projekt bauen und testen", group: "Häufig verwendet" },
    { name: "test", description: "Tests ausführen", group: "Häufig verwendet" },
    { name: "run", description: "Anwendung starten", group: "Häufig verwendet" },
    { name: "bootRun", description: "Spring-Boot-Anwendung starten", group: "Häufig verwendet" },
    { name: "shadowJar", description: "Fat-Jar mit allen Abhängigkeiten erzeugen", group: "Häufig verwendet" },
  ];
  if (!available) return everyday.slice(0, 4);
  // Compared on the last segment: ":honeymc-cloud:shadowJar" is a shadowJar,
  // and a build that has one deserves the shortcut for it.
  const names = new Set(available.map((task) => task.name.split(":").filter(Boolean).at(-1)));
  return everyday.filter((shortcut) => shortcut.name.split(" ").every((part) => names.has(part)));
}

/** Two task lists as one, with the first source's answer kept for a name in both. */
/**
 * One entry per task, whichever way its name was written.
 *
 * Gradle prints a subproject's task as `modul:task` and a build file declares
 * the same one as `:modul:task`. Compared as text those are two tasks, and the
 * tool window listed both — the second copy doing exactly what the first does.
 */
function mergeGradleTasks(primary, secondary) {
  const key = (task) => String(task.name || "").replace(/^:+/, "");
  const names = new Set(primary.map(key));
  const merged = [...primary];
  for (const task of secondary) {
    if (names.has(key(task))) continue;
    names.add(key(task));
    merged.push(task);
  }
  return merged;
}

/**
 * Why the task list is the generic one, in a sentence somebody can act on.
 *
 * Gradle puts the useful part of a failure right after "FAILURE:" or "* What
 * went wrong:", and everything around it is a banner. Without this the tool
 * window silently showed the standard lifecycle and the real reason — an
 * unresolvable plugin, a missing wrapper — was never printed anywhere.
 */
function gradleTaskFailureReason(result) {
  const text = [result?.stderr || "", result?.stdout || ""].join("\n");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const wentWrong = lines.findIndex((line) => /^\*\s*What went wrong:/i.test(line));
  const detail = wentWrong >= 0
    ? lines[wentWrong + 1]
    : lines.find((line) => /^FAILURE:/i.test(line))
      || lines.find((line) => /error|exception|not found|konnte nicht/i.test(line));
  const cause = String(detail || "").slice(0, 300);
  return cause
    ? `Gradle konnte die Aufgabenliste nicht lesen: ${cause}`
    : "Gradle konnte die Aufgabenliste nicht lesen; die Standardaufgaben werden angezeigt.";
}

/** Used when `gradle tasks` cannot be reached; mirrors the standard Java plugin. */
function gradleFallbackTasks() {
  return [
    ...gradleShortcuts(),
    { name: "clean", description: "Build-Verzeichnis löschen", group: "Build" },
    { name: "assemble", description: "Artefakte ohne Tests erzeugen", group: "Build" },
    { name: "classes", description: "Hauptquellen übersetzen", group: "Build" },
    { name: "testClasses", description: "Testquellen übersetzen", group: "Build" },
    { name: "jar", description: "Jar-Archiv erzeugen", group: "Build" },
    { name: "check", description: "Alle Prüfungen ausführen", group: "Verification" },
    { name: "dependencies", description: "Abhängigkeiten anzeigen", group: "Help" },
    { name: "projects", description: "Teilprojekte anzeigen", group: "Help" },
    { name: "javadoc", description: "API-Dokumentation erzeugen", group: "Documentation" },
  ];
}

/**
 * Profiles a POM declares, with the ones Maven activates on its own marked.
 *
 * Without this the build always ran the default profile: a project that keeps
 * its integration tests or its production settings behind `-P` could not be
 * built from the IDE at all.
 */
function mavenProfiles(pom = "") {
  const profiles = [];
  for (const match of String(pom).matchAll(/<profile>([\s\S]*?)<\/profile>/g)) {
    const body = match[1];
    const id = body.match(/<id>\s*([^<]+?)\s*<\/id>/)?.[1];
    if (!id) continue;
    profiles.push({
      id,
      // activeByDefault is the only activation Maven resolves without input.
      active: /<activeByDefault>\s*true\s*<\/activeByDefault>/.test(body),
      description: (body.match(/<properties>[\s\S]*?<\/properties>/) ? "setzt Properties" : "")
        || (body.match(/<modules>/) ? "aktiviert Module" : ""),
    });
  }
  return profiles;
}

/**
 * Gradle has no profiles; the closest equivalents are the project properties a
 * build script reads. Those are what a variant selection has to set.
 */
function gradleVariants(script = "") {
  const names = new Set();
  for (const match of String(script).matchAll(/(?:hasProperty|findProperty)\s*\(\s*["']([\w.-]+)["']/g)) names.add(match[1]);
  for (const match of String(script).matchAll(/project\.properties\s*\[\s*["']([\w.-]+)["']/g)) names.add(match[1]);
  return [...names].sort().map((id) => ({ id, active: false, description: "Projekt-Property" }));
}

/** Comments blanked out, so a task inside one is not read as a real task. */
function maskGradleComments(script) {
  return String(script || "")
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\r\n]*/g, (whole, lead) => lead + " ".repeat(whole.length - lead.length));
}

/**
 * What each Gradle plugin adds to a project without anyone writing it down.
 *
 * A build file says `id("com.gradleup.shadow")` and never mentions shadowJar
 * again — the task exists because the plugin is applied. Reading the plugin
 * block is the only way to know about it while Gradle itself cannot be asked.
 */
const GRADLE_PLUGIN_TASKS = [
  { match: /shadow/i, tasks: [
    ["shadowJar", "Fat-Jar mit allen Abhängigkeiten erzeugen", "Build"],
    ["runShadow", "Anwendung aus dem Fat-Jar starten", "Anwendung"],
  ] },
  { match: /^application$/i, tasks: [
    ["run", "Anwendung starten", "Anwendung"],
    ["installDist", "Startskripte und Bibliotheken auslegen", "Verteilung"],
    ["distZip", "Verteilbares Zip erzeugen", "Verteilung"],
  ] },
  { match: /^org\.springframework\.boot$/i, tasks: [
    ["bootRun", "Spring-Boot-Anwendung starten", "Anwendung"],
    ["bootJar", "Ausführbares Spring-Boot-Jar erzeugen", "Build"],
    ["bootBuildImage", "Container-Image bauen", "Build"],
  ] },
  { match: /^jacoco$/i, tasks: [
    ["jacocoTestReport", "Testabdeckung auswerten", "Verifikation"],
    ["jacocoTestCoverageVerification", "Abdeckungsgrenzen prüfen", "Verifikation"],
  ] },
  { match: /^maven-publish$/i, tasks: [
    ["publish", "In alle konfigurierten Repositories veröffentlichen", "Veröffentlichung"],
    ["publishToMavenLocal", "In das lokale Maven-Repository veröffentlichen", "Veröffentlichung"],
  ] },
  { match: /^war$/i, tasks: [["war", "Web-Archiv erzeugen", "Build"]] },
  { match: /^checkstyle$/i, tasks: [["checkstyleMain", "Checkstyle über die Hauptquellen", "Verifikation"]] },
  { match: /^pmd$/i, tasks: [["pmdMain", "PMD über die Hauptquellen", "Verifikation"]] },
  { match: /spotless/i, tasks: [
    ["spotlessApply", "Formatierung anwenden", "Verifikation"],
    ["spotlessCheck", "Formatierung prüfen", "Verifikation"],
  ] },
  { match: /ben-manes\.versions/i, tasks: [["dependencyUpdates", "Neuere Abhängigkeitsversionen suchen", "Hilfe & Diagnose"]] },
  { match: /^com\.google\.protobuf$/i, tasks: [["generateProto", "Protobuf-Quellen erzeugen", "Build"]] },
  { match: /kotlin/i, tasks: [["compileKotlin", "Kotlin-Quellen übersetzen", "Build"]] },
];

/** The Gradle API names that follow `tasks.` and are not tasks themselves. */
const GRADLE_TASK_API = new Set([
  "register", "create", "named", "maybeCreate", "withType", "matching", "all", "configureEach",
  "whenTaskAdded", "getByName", "findByName", "getByPath", "findByPath", "replace", "remove",
  "addRule", "getNames", "names", "forEach", "filter", "toList", "iterator", "each", "asMap",
]);

/**
 * The subprojects a Gradle settings file declares.
 *
 * A multi-project build keeps almost everything in its subprojects — the root
 * file is often four lines — so reading only the root means reading the one
 * file that says the least. `include(":app")` names the directory relative to
 * the root, and a colon in the name is a directory separator.
 */
function gradleIncludedProjects(settings = "") {
  const text = maskGradleComments(settings);
  const found = new Set();
  for (const call of text.matchAll(/\binclude\s*\(?\s*((?:["'][^"']+["']\s*,?\s*)+)/g)) {
    for (const literal of call[1].matchAll(/["']([^"']+)["']/g)) {
      const name = literal[1].replace(/^:+/, "").trim();
      if (name && !name.startsWith("..")) found.add(name);
    }
  }
  return [...found];
}

/**
 * The tasks a build file itself names, plus the ones its plugins bring.
 *
 * Reading the script matters most exactly when Gradle cannot be reached: the
 * fallback list is the standard Java lifecycle and knows nothing about the
 * project, so `shadowJar` — the task the build actually exists to produce —
 * was missing from the tool window entirely.
 */
function gradleScriptTasks(script = "", projectPath = "") {
  const text = maskGradleComments(script);
  const found = new Map();
  const prefix = String(projectPath || "").replace(/^:*/, "").replace(/[\\/]+/g, ":");
  const add = (name, description, group) => {
    if (!name || GRADLE_TASK_API.has(name) || found.has(name)) return;
    // A subproject's task is addressed by its path, so that is what it is
    // called here too: running "shadowJar" from a multi-project build means
    // something else than running ":honeymc-cloud:shadowJar".
    found.set(name, { name: prefix ? `:${prefix}:${name}` : name, description, group });
  };

  const plugins = new Set();
  for (const match of text.matchAll(/\bid\s*(?:\(\s*)?["']([\w.-]+)["']/g)) plugins.add(match[1]);
  for (const match of text.matchAll(/apply\s+plugin\s*:\s*["']([\w.-]+)["']/g)) plugins.add(match[1]);
  // The Kotlin DSL accessors: plugins { application; java }
  for (const match of text.matchAll(/^\s*(application|java-library|java|war|jacoco|checkstyle|pmd|`maven-publish`|kotlin)\b\s*$/gm)) {
    plugins.add(match[1].replace(/`/g, ""));
  }

  for (const plugin of plugins) {
    for (const rule of GRADLE_PLUGIN_TASKS) {
      if (!rule.match.test(plugin)) continue;
      for (const [name, description, group] of rule.tasks) add(name, description, group);
    }
  }
  // After the plugins, so a task that is merely reconfigured here keeps
  // the description the plugin gives it rather than "defined in the script".
  for (const match of text.matchAll(/tasks\.(?:register|create|maybeCreate|named)\s*(?:<[^<>]*>)?\s*\(\s*["']([A-Za-z_][\w-]*)["']/g)) {
    add(match[1], "Im Buildskript definiert", "Weitere Tasks");
  }
  for (const match of text.matchAll(/tasks\.([A-Za-z_]\w*)\s*(?:\{|\.configure\b)/g)) {
    add(match[1], "Im Buildskript konfiguriert", "Weitere Tasks");
  }
  // Kotlin DSL: val jarAll by tasks.registering { … }
  for (const match of text.matchAll(/\bval\s+([A-Za-z_]\w*)\s+by\s+tasks\.(?:registering|creating|existing|getting)/g)) {
    add(match[1], "Im Buildskript definiert", "Weitere Tasks");
  }
  // Groovy: task jarAll(type: Jar) { … }
  for (const match of text.matchAll(/(?:^|[;{}])\s*task\s+([A-Za-z_]\w*)\s*(?:\(|\{|<<)/gm)) {
    add(match[1], "Im Buildskript definiert", "Weitere Tasks");
  }
  for (const match of text.matchAll(/(?:^|[;{}])\s*task\s*\(\s*["']([A-Za-z_][\w-]*)["']/gm)) {
    add(match[1], "Im Buildskript definiert", "Weitere Tasks");
  }

  return [...found.values()];
}

/**
 * The task list `gradle tasks --all` prints.
 *
 * A description is optional in that output, and most projects have a stretch
 * of tasks without one — `compileJava`, `shadowJar` and everything a plugin
 * adds silently. Requiring the `name - description` shape dropped all of them,
 * and a project whose tasks happen to be undocumented ended up with an empty
 * tool window. A bare name only counts underneath a group heading, which keeps
 * the surrounding prose out.
 */
function parseGradleTasks(output) {
  const tasks = [];
  const seen = new Set();
  let group = "";
  const add = (name, description) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    tasks.push({ name, description, group: group || "Weitere Tasks" });
  };
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^(.+?) tasks$/i);
    if (heading && !/\brunnable\b/i.test(line)) {
      group = heading[1].trim();
      continue;
    }
    // Gradle underlines every heading and separates blocks with blank lines;
    // neither ends the group the tasks after it belong to.
    if (!line || /^-+$/.test(line)) continue;
    const described = line.match(/^([:\w][\w:.-]*)\s+-\s+(.+)$/);
    if (described) {
      add(described[1], described[2].trim());
      continue;
    }
    const bare = line.match(/^([:\w][\w:.-]*)$/);
    if (bare && group) add(bare[1], "");
  }
  return tasks;
}

/**
 * Whether a module's compiled output is newer than every one of its sources.
 *
 * Running a class recompiled every source of every module involved, every
 * time, even when nothing had changed — on a project of any size that is the
 * "why is it building again" pause before the program starts. Comparing
 * timestamps skips a module whose classes are already current.
 *
 * Deliberately all-or-nothing per module: compiling only the changed files
 * would miss the callers that need recompiling when a signature changes, so as
 * soon as one source is newer the whole module is built as before.
 */
/**
 * Whether a module's compiled output is newer than every one of its sources.
 *
 * Running a class recompiled every source of every module involved, every
 * time, even when nothing had changed — on a project of any size that is the
 * "why is it building again" pause before the program starts. Comparing
 * timestamps lets a module whose classes are already current be skipped.
 *
 * Deliberately all-or-nothing per module: compiling only the changed files
 * would miss the callers that need recompiling when a signature changes, so as
 * soon as one source is newer the whole module is built exactly as before.
 *
 * Takes plain timestamps rather than paths so the rule can be tested without a
 * filesystem, and so the caller decides how to walk it.
 */
function moduleOutputIsCurrent(sourceTimes, classTimes) {
  if (!sourceTimes.length) return true;
  if (!classTimes.length) return false;
  // Fewer classes than sources means a previous build was partial or a source
  // was added; either way the output cannot be complete.
  if (classTimes.length < sourceTimes.length) return false;
  return Math.min(...classTimes) >= Math.max(...sourceTimes);
}

/** Modification times of every compiled class under a directory. */
function collectClassTimes(outputPath) {
  const times = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = fsSync.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".class")) {
        const stat = fsSync.statSync(full, { throwIfNoEntry: false });
        if (stat) times.push(stat.mtimeMs);
      }
    }
  };
  walk(outputPath);
  return times;
}

function topologicalSortModules(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const temporary = new Set();
  const permanent = new Set();
  const ordered = [];
  const visit = (module, chain = []) => {
    if (permanent.has(module.id)) return;
    if (temporary.has(module.id)) {
      const cycle = [...chain, module.id].join(" → ");
      throw new Error(`Zyklische Modulabhängigkeit: ${cycle}`);
    }
    temporary.add(module.id);
    for (const dependencyId of module.dependencies || []) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency, [...chain, module.id]);
    }
    temporary.delete(module.id);
    permanent.add(module.id);
    ordered.push(module);
  };
  for (const module of modules) visit(module);
  return ordered;
}

function dependencyClosure(moduleId, modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const required = new Set();
  const visit = (id) => {
    if (required.has(id)) return;
    required.add(id);
    for (const dependency of byId.get(id)?.dependencies || []) {
      if (byId.has(dependency)) visit(dependency);
    }
  };
  visit(moduleId);
  return required;
}

async function sourceContainsMain(file) {
  try {
    const source = await fs.readFile(file, "utf8");
    // Java permits annotations and additional modifiers around the canonical
    // entry point. The parameter may use either String[] or varargs.
    return /\bpublic\s+(?:(?:final|synchronized|strictfp)\s+)*static\s+(?:(?:final|synchronized|strictfp)\s+)*void\s+main\s*\(\s*(?:java\.lang\.)?String\s*(?:\[\s*\]|\.\.\.)\s*[A-Za-z_$][\w$]*\s*\)/m.test(source)
      || /\bstatic\s+public\s+void\s+main\s*\(\s*(?:java\.lang\.)?String\s*(?:\[\s*\]|\.\.\.)\s*[A-Za-z_$][\w$]*\s*\)/m.test(source);
  } catch {
    return false;
  }
}

async function mainClassFromSource(entry, sources) {
  const source = await fs.readFile(entry, "utf8");
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
  const className = path.basename(entry, ".java");
  return { entry, qualifiedName: packageName ? `${packageName}.${className}` : className, sources };
}

function parseMavenDependencyTree(output) {
  const roots = [];
  const stack = [];
  const conflicts = [];
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.replace(/^\[(?:INFO|WARNING|DEBUG)\]\s?/, "");
    const branch = line.match(/^((?:\|  |   )*)(?:\+-|\\-)\s+(.+)$/);
    if (!branch) continue;
    const depth = Math.floor(branch[1].length / 3);
    const text = branch[2].trim();
    const coordinateText = text.replace(/\s+\(.+$/, "");
    const parts = coordinateText.split(":");
    if (parts.length < 4) continue;
    const group = parts[0];
    const artifact = parts[1];
    const version = parts[3] || "";
    const scope = parts[4] || "";
    const conflictMatch = text.match(/omitted for conflict with\s+([^)]+)/i);
    const node = {
      id: `${group}:${artifact}:${version}:${depth}:${roots.length}`,
      coordinate: `${group}:${artifact}`,
      group,
      artifact,
      version: conflictMatch?.[1] || version,
      requestedVersion: conflictMatch ? version : "",
      scope,
      conflict: Boolean(conflictMatch),
      omitted: /omitted/i.test(text),
      children: [],
    };
    if (conflictMatch) conflicts.push({ coordinate: node.coordinate, requested: version, selected: conflictMatch[1] });
    while (stack.length > depth) stack.pop();
    if (depth === 0 || !stack.length) roots.push(node);
    else stack.at(-1).children.push(node);
    stack[depth] = node;
    stack.length = depth + 1;
  }
  return { configurations: [{ name: "Dependencies", nodes: roots }], conflicts };
}

function parseGradleDependencyTree(output) {
  const configurations = [];
  const conflicts = [];
  let current = null;
  let stack = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const header = line.match(/^([A-Za-z][\w.-]*)\s+-\s+(.+)$/);
    if (header && !/task|rules/i.test(header[1])) {
      current = { name: header[1], description: header[2], nodes: [] };
      configurations.push(current);
      stack = [];
      continue;
    }
    const branch = line.match(/^((?:\|    |     )*)(?:\+---|\\---)\s+(.+)$/);
    if (!branch || !current) continue;
    const depth = Math.floor(branch[1].length / 5);
    const text = branch[2].replace(/\s+\(\*\)$/, "").trim();
    /*
     * A dependency on another project of the same build.
     *
     * Gradle writes these as `project ':name'` when it resolved them and
     * `project name (n)` when it has not, and neither is a group:artifact:
     * version triple — so the parser below matched nothing and dropped them.
     * In a multi-project build those are the commonest dependencies there are,
     * which left the Dependencies branch empty for modules that plainly had
     * some.
     */
    const projectRef = text.match(/^project\s+'?:?([^'\s]+)'?/);
    const selected = projectRef ? null : text.match(/^([^:\s]+):([^:\s]+):([^\s]+)\s+->\s+([^\s]+)/);
    const plain = projectRef ? null : text.match(/^([^:\s]+):([^:\s]+):([^\s]+)/);
    const match = projectRef || selected || plain;
    if (!match) continue;
    const group = projectRef ? "Projekt" : match[1];
    const artifact = projectRef ? projectRef[1] : match[2];
    const requested = projectRef ? "" : match[3];
    const version = projectRef ? "" : selected ? selected[4] : requested;
    const conflict = Boolean(selected && requested !== version);
    const node = {
      id: `${group}:${artifact}:${version}:${depth}:${current.nodes.length}`,
      // A project has no coordinate of its own, so it is named the way Gradle
      // names it rather than as a group and an artifact that do not exist.
      coordinate: projectRef ? `project :${artifact}` : `${group}:${artifact}`,
      group,
      artifact,
      version,
      requestedVersion: conflict ? requested : "",
      conflict,
      omitted: false,
      children: [],
    };
    if (conflict) conflicts.push({ coordinate: node.coordinate, requested, selected: version });
    while (stack.length > depth) stack.pop();
    if (depth === 0 || !stack.length) current.nodes.push(node);
    else stack.at(-1).children.push(node);
    stack[depth] = node;
    stack.length = depth + 1;
  }
  return { configurations, conflicts };
}

async function copyResourceRoots(roots, output) {
  for (const resourceRoot of roots || []) {
    const source = path.resolve(resourceRoot);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isDirectory()) continue;
    await fs.mkdir(output, { recursive: true });
    await fs.cp(source, output, { recursive: true, force: true });
  }
}

function attachDependencyArtifacts(nodes) {
  for (const node of nodes) {
    const versionRoot = path.join(os.homedir(), ".m2", "repository", ...node.group.split("."), node.artifact, node.version);
    const sources = path.join(versionRoot, `${node.artifact}-${node.version}-sources.jar`);
    const javadocs = path.join(versionRoot, `${node.artifact}-${node.version}-javadoc.jar`);
    if (fsSync.existsSync(sources)) node.sourcePath = sources;
    if (fsSync.existsSync(javadocs)) node.javadocPath = javadocs;
    if (!node.sourcePath) node.sourcePath = findGradleArtifact(node, "sources") || undefined;
    if (!node.javadocPath) node.javadocPath = findGradleArtifact(node, "javadoc") || undefined;
    attachDependencyArtifacts(node.children);
  }
}

function findGradleArtifact(node, classifier) {
  const root = path.join(
    os.homedir(),
    ".gradle",
    "caches",
    "modules-2",
    "files-2.1",
    node.group,
    node.artifact,
    node.version,
  );
  try {
    const expected = `${node.artifact}-${node.version}-${classifier}.jar`;
    for (const hash of fsSync.readdirSync(root, { withFileTypes: true })) {
      if (!hash.isDirectory()) continue;
      const candidate = path.join(root, hash.name, expected);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  } catch {}
  return "";
}

module.exports = {
  BuildService,
  gradleIncludedProjects,
  gradleScriptTasks,
  mergeGradleTasks,
  gradleTaskFailureReason,
  dependencyClosure,
  gradleFallbackTasks,
  mavenTasks,
  mavenProfiles,
  gradleVariants,
  parseGradleTasks,
  parseGradleDependencyTree,
  parseMavenDependencyTree,
  splitArgs,
  topologicalSortModules,
  moduleOutputIsCurrent,
};
