const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { fileURLToPath } = require("node:url");
const { dependencyClosure, splitArgs, topologicalSortModules } = require("./build-service.cjs");
const { discoverJavaProjectModel } = require("./java-project-model.cjs");
const { spawnCapture, terminateProcessTree } = require("./process-utils.cjs");

class DebugService {
  constructor(pathGuard, workspace, projects, builds, send, classpathProvider = null) {
    this.pathGuard = pathGuard;
    this.workspace = workspace;
    this.projects = projects;
    this.builds = builds;
    this.classpathProvider = classpathProvider;
    this.root = "";
    this.moduleId = "";
    this.send = (channel, payload) => send(channel, {
      ...payload,
      projectRoot: this.root || payload.projectRoot,
      moduleId: this.moduleId || payload.moduleId,
    });
    this.vm = null;
    this.adapter = null;
    this.adapterBuffer = "";
    this.adapterReady = null;
    /** True while the session is attached to a JVM Kiwi did not start. */
    this.attached = false;
    this.breakpoints = [];
    this.variableScopes = new Map();
    this.stackFrames = [];
    this.threads = [];
    this.targetJdk = null;
    this.classpath = "";
    this.outputDirectory = "";
    this.activeSource = "";
    this.mainClass = "";
    this.debugProject = null;
    this.debugModule = null;
    this.debugEnv = null;
    this.hotReplaceCompilerArgs = [];
    // javac writes several files for nested/anonymous classes. Keep HotSwap
    // jobs serial and coalesce repeated saves of the same source so two fast
    // saves can never race in the output directory.
    this.hotReplaceQueue = Promise.resolve();
    this.hotReplacePending = new Map();
    this.hotReplaceVersions = new Map();
    this.hotReplaceRequests = new Map();
    this.hotReplaceOutputs = new Map();
    // A submitted revision becomes the comparison baseline only after the JDI
    // adapter confirms redefineClasses(). Compiler success alone is not enough.
    this.hotReplaceRevisions = new Map();
    // For files not captured at launch, retain the earliest renderer baseline
    // until an adapter success establishes a confirmed VM revision.
    this.hotReplaceFallbackSources = new Map();
    this.hotReplaceCancellation = 0;
    this.hotReplaceSequence = 0;
    // A normal JDI redefine changes method bytecode, but deliberately keeps
    // object state. Remember how Kiwi launched the current application so a
    // smart HotSwap can restart startup/initialisation code without asking the
    // user to stop, rebuild and debug again. Attached JVMs are never restarted.
    this.launchRequest = null;
    this.hotReplaceSources = new Map();
    this.sessionEpoch = 0;
  }

  health() {
    return {
      active: Boolean(this.root),
      root: this.root,
      adapterPid: this.adapter?.pid || 0,
      vmPid: this.vm?.pid || 0,
      scopes: this.variableScopes.size,
      frames: this.stackFrames.length,
      threads: this.threads.length,
    };
  }

  async start(payload) {
    this.stop({
      silent: payload?.__smartRelaunch === true,
      preserveHotReplace: payload?.__smartRelaunch === true,
    });
    const epoch = this.sessionEpoch;
    const root = this.pathGuard.assertWorkspace(payload.root);
    const config = payload.configuration || {};
    this.root = root;
    try {
    const project = await this.projects.detect(root);
    this.assertSession(epoch);
    const modules = await this.builds.modules.list(root);
    this.assertSession(epoch);
    const main = await this.builds.mainClass(payload.file, root, config.mainClass);
    this.assertSession(epoch);
    // Capture before the build starts. Reading after launch can race with an
    // editor save and incorrectly mark source the VM never compiled as active.
    const launchMainSource = await fs.readFile(main.entry, "utf8").catch(() => null);
    this.assertSession(epoch);
    const module = config.moduleId
      ? modules.find((item) => item.id === config.moduleId)
      : await this.builds.moduleOwning(root, main.entry);
    if (config.moduleId && !module) throw new Error(`Das konfigurierte Modul „${config.moduleId}“ wurde nicht gefunden.`);
    this.moduleId = module?.id || "";
    const jdk = await this.projects.detectJdk(root, config.jdkPath || module?.jdkPath);
    this.assertSession(epoch);
    if (!jdk.available) throw new Error("Kein JDK für den Debugger gefunden.");
    const env = {
      ...process.env,
      JAVA_HOME: jdk.path,
      PATH: `${path.join(jdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}`,
      ORG_GRADLE_PROJECT_kiwiJavaVersion: module?.languageLevel || project.languageLevel || String(jdk.major),
      ...(config.env || {}),
    };
    const languageLevel = Number(module?.languageLevel || project.languageLevel || jdk.major);
    if (languageLevel > jdk.major) throw new Error(`Das Project SDK ${jdk.major} kann Java ${languageLevel} nicht debuggen.`);
    const workingDirectory = config.workingDirectory
      ? this.pathGuard.assertAllowed(config.workingDirectory, root)
      : root;
    const workingDirectoryStat = await fs.stat(workingDirectory).catch(() => null);
    if (!workingDirectoryStat?.isDirectory()) throw new Error("Der Arbeitsordner der Debug-Konfiguration existiert nicht.");
    this.debugProject = project;
    this.debugModule = module;
    this.debugEnv = env;
    this.hotReplaceCompilerArgs = [
      "-g",
      "-encoding", project.encoding || "UTF-8",
      ...(Number.isFinite(languageLevel) ? ["--release", String(languageLevel)] : []),
      ...(project.previewFeatures ? ["--enable-preview"] : []),
      ...splitArgs(project.compilerArgs || ""),
    ];
    if (project.type !== "Java") {
      this.send("debug:output", { text: `Bereite ${project.type}-Projekt für Debug vor…\n` });
      const command = this.builds.resolveBuildTool(root, project.type, project.preferWrapper !== false);
      const args = project.type === "Maven"
        ? [
            ...(project.mavenOffline ? ["-o"] : []),
            ...(module && module.relativePath !== "." ? ["-am", "-pl", module.relativePath.replace(/\\/g, "/")] : []),
            "test-compile",
            "-q",
            `-Dmaven.compiler.release=${languageLevel}`,
            ...(project.annotationProcessing === false ? ["-Dmaven.compiler.proc=none"] : ["-Dmaven.compiler.proc=full"]),
            ...(project.previewFeatures ? ["-Dmaven.compiler.enablePreview=true"] : []),
          ]
        : [
            ...(module && module.relativePath !== "."
              ? [`:${module.relativePath.replace(/[\\/]/g, ":")}:classes`, `:${module.relativePath.replace(/[\\/]/g, ":")}:testClasses`]
              : ["classes", "testClasses"]),
            "--console=plain",
            "--no-daemon",
            ...(project.gradleOffline ? ["--offline"] : []),
          ];
      await spawnCapture(command, args, { cwd: root, env, rejectOnError: true });
      this.assertSession(epoch);
    }

    const output = path.join(root, ".kiwi", "debug-out");
    let classpath;
    if (project.type === "Java") {
      await fs.rm(output, { recursive: true, force: true });
      await fs.mkdir(output, { recursive: true });
      let debugSources = main.sources;
      if (module) {
        const ordered = topologicalSortModules(modules);
        const required = dependencyClosure(module.id, ordered);
        debugSources = [];
        for (const candidate of ordered.filter((item) => required.has(item.id))) {
          for (const sourceRoot of candidate.sourceRoots) {
            try {
              await this.workspace.collectFiles(root, (file) => file.endsWith(".java"), sourceRoot, debugSources);
            } catch {}
          }
        }
      }
      const libraries = await this.plainLibraries(root, project);
      await spawnCapture(jdk.javac, [
        "-g",
        "-encoding", project.encoding || "UTF-8",
        "--release", String(languageLevel),
        ...(project.previewFeatures ? ["--enable-preview"] : []),
        ...(libraries.length ? ["-classpath", libraries.join(path.delimiter)] : []),
        ...splitArgs(project.compilerArgs || ""),
        "-d", output,
        ...debugSources,
      ], { cwd: root, env, rejectOnError: true });
      await this.copyPlainResources(root, module, modules, output);
      classpath = uniqueClasspath([output, ...libraries]).join(path.delimiter);
    } else {
      await fs.mkdir(output, { recursive: true });
      classpath = await this.managedRuntimeClasspath(root, project, module, modules, main.entry, env);
    }
    this.assertSession(epoch);

    const qualifiedName = config.mainClass || main.qualifiedName;
    if (!await classExists(qualifiedName, classpath)) {
      throw new Error(
        `Die Main Class ${qualifiedName} wurde vom ${project.type}-Build nicht erzeugt. `
        + "Prüfe die Modulzuordnung und die Build-Konfiguration.",
      );
    }
    const port = await freePort();
    this.assertSession(epoch);
    const vmArgs = debugVmArgs(config, project, port, classpath, qualifiedName);
    this.breakpoints = (payload.breakpoints || []).filter((item) => item.enabled !== false);
    this.targetJdk = jdk;
    this.classpath = classpath;
    this.outputDirectory = output;
    this.activeSource = main.entry;
    this.mainClass = qualifiedName;
    this.send("debug:state", { status: "starting", engine: "JDI/JDWP", port, mainClass: qualifiedName });
    const vm = spawn(jdk.java, vmArgs, { cwd: workingDirectory, env, windowsHide: true });
    this.vm = vm;
    vm.stdout.on("data", (data) => {
      if (epoch === this.sessionEpoch) this.send("debug:output", { text: data.toString(), stream: "stdout" });
    });
    vm.stderr.on("data", (data) => {
      if (epoch === this.sessionEpoch) this.send("debug:output", { text: data.toString(), stream: "stderr" });
    });
    vm.on("close", (code) => {
      if (epoch !== this.sessionEpoch || this.vm !== vm) return;
      this.send("debug:state", { status: "stopped", engine: "JDI/JDWP", code: code ?? 0 });
      this.root = "";
      this.stop();
    });

    await waitForDebugger(vm, 7000);
    this.assertSession(epoch);
    const adapterJdk = await this.resolveAdapterJdk(jdk);
    this.assertSession(epoch);
    if (!adapterJdk.available || adapterJdk.major < 21) {
      throw new Error("Der Kiwi-JDI-Adapter benötigt ein separates JDK 21 oder neuer.");
    }
    const adapterJar = resolveAdapterJar();
    if (!fsSync.existsSync(adapterJar)) {
      throw new Error(`Kiwi-JDI-Adapter fehlt: ${adapterJar}`);
    }

    await this.startAdapter(root, "127.0.0.1", port, adapterJdk, epoch);
    this.assertSession(epoch);
    this.configureBreakpoints();
    this.writeAdapter("continue");
    this.send("debug:state", { status: "running", engine: "JDI/JDWP", port, mainClass: qualifiedName });
    this.launchRequest = cloneLaunchRequest({
      ...payload,
      root,
      file: payload.file || main.entry,
      configuration: config,
      breakpoints: this.breakpoints,
    });
    // This is now a confirmed VM baseline: the build and launch above both
    // succeeded using a source revision no older than this conservative
    // pre-build snapshot. Other files use the renderer's exact savedContent
    // until their first adapter-confirmed replacement.
    if (launchMainSource !== null) {
      this.hotReplaceSources.set(path.normalize(main.entry), launchMainSource);
    }
    return { started: true, engine: "JDI/JDWP", port, mainClass: qualifiedName };
    } catch (error) {
      if (epoch === this.sessionEpoch) this.stop();
      throw error;
    }
  }

  assertSession(epoch) {
    if (epoch !== this.sessionEpoch) {
      throw new Error("Diese Debug-Anfrage wurde durch eine neuere Sitzung ersetzt.");
    }
  }

  async resolveAdapterJdk(projectJdk = null) {
    if (projectJdk?.available && projectJdk.major >= 21) return projectJdk;
    const configured = await this.projects.detectJdk("");
    if (configured.available && configured.major >= 21) return configured;
    if (typeof this.projects.listJdks === "function") {
      const candidate = (await this.projects.listJdks()).find((jdk) => jdk.available && jdk.major >= 21);
      if (candidate) return this.projects.detectJdk("", candidate.path);
    }
    return configured;
  }

  async plainLibraries(root, project) {
    const model = await discoverJavaProjectModel(root, "Java");
    const excluded = (project.excludedLibraries || []).map((entry) => String(entry).replace(/\\/g, "/").toLocaleLowerCase());
    return uniqueClasspath(model.referencedLibraries
      .map((entry) => path.resolve(root, entry))
      .filter((entry) => {
        const relative = path.relative(root, entry).replace(/\\/g, "/").toLocaleLowerCase();
        return !excluded.some((pattern) => pattern && (relative === pattern || relative.endsWith(`/${pattern}`)));
      }));
  }

  async copyPlainResources(root, module, modules, output) {
    const selected = module || modules.find((candidate) => candidate.relativePath === ".");
    let candidates = selected ? [selected] : [];
    if (selected) {
      const ordered = topologicalSortModules(modules);
      const required = dependencyClosure(selected.id, ordered);
      candidates = ordered.filter((candidate) => required.has(candidate.id));
    }
    const resourceRoots = candidates.length
      ? candidates.flatMap((candidate) => [...(candidate.resourceRoots || []), ...(candidate.testResourceRoots || [])])
      : [path.join(root, "src", "main", "resources"), path.join(root, "src", "test", "resources")];
    for (const resourceRoot of uniqueClasspath(resourceRoots)) {
      const stat = await fs.stat(resourceRoot).catch(() => null);
      if (stat?.isDirectory()) await fs.cp(resourceRoot, output, { recursive: true, force: true });
    }
  }

  async managedRuntimeClasspath(root, project, module, modules, sourceFile, env) {
    const outputEntries = managedOutputEntries(project.type, module, modules, root);
    let resolved = [];
    if (typeof this.classpathProvider === "function") {
      try {
        resolved = classpathEntries(await this.classpathProvider(root, sourceFile));
      } catch (error) {
        this.send("debug:output", {
          text: `Java-Index-Classpath nicht verfügbar: ${conciseFailure(error)}\n`,
          stream: "stderr",
        });
      }
    }
    if (!resolved.some((entry) => /\.jar$/i.test(entry))) {
      try {
        const queried = project.type === "Maven"
          ? await this.mavenRuntimeClasspath(root, project, module, env)
          : await this.gradleRuntimeClasspath(root, project, module, env);
        resolved.push(...queried);
      } catch (error) {
        this.send("debug:output", {
          text: `${project.type}-Runtime-Classpath konnte nicht vollständig abgefragt werden: ${conciseFailure(error)}\n`,
          stream: "stderr",
        });
      }
    }
    return uniqueClasspath([...outputEntries, ...resolved]).join(path.delimiter);
  }

  async mavenRuntimeClasspath(root, project, module, env) {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-debug-maven-"));
    const outputFile = path.join(temporaryRoot, "classpath.txt");
    try {
      const command = this.builds.resolveBuildTool(root, "Maven", project.preferWrapper !== false);
      const args = [
        ...(project.mavenOffline ? ["-o"] : []),
        ...(module && module.relativePath !== "." ? ["-pl", module.relativePath.replace(/\\/g, "/")] : []),
        "dependency:build-classpath",
        "-q",
        "-Dmdep.includeScope=test",
        `-Dmdep.outputFile=${outputFile}`,
      ];
      await spawnCapture(command, args, { cwd: root, env, rejectOnError: true, timeoutMs: 45_000 });
      return classpathEntries(await fs.readFile(outputFile, "utf8"));
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async gradleRuntimeClasspath(root, project, module, env) {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-debug-gradle-"));
    const initScript = path.join(temporaryRoot, "classpath.gradle");
    try {
      await fs.writeFile(initScript, [
        "allprojects { targetProject ->",
        "  tasks.register('kiwiDebugClasspath') {",
        "    doLast {",
        "      def sets = targetProject.extensions.findByName('sourceSets')",
        "      def selected = sets == null ? null : (sets.findByName('test') ?: sets.findByName('main'))",
        "      if (selected != null) println('KIWI_DEBUG_CLASSPATH=' + selected.runtimeClasspath.asPath)",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"), "utf8");
      const command = this.builds.resolveBuildTool(root, "Gradle", project.preferWrapper !== false);
      const task = module && module.relativePath !== "."
        ? `:${module.relativePath.replace(/[\\/]/g, ":")}:kiwiDebugClasspath`
        : "kiwiDebugClasspath";
      const result = await spawnCapture(command, [
        "-I", initScript,
        task,
        "-q",
        "--console=plain",
        "--no-daemon",
        ...(project.gradleOffline ? ["--offline"] : []),
      ], { cwd: root, env, rejectOnError: true, timeoutMs: 45_000 });
      const marker = `${result.stdout}\n${result.stderr}`.split(/\r?\n/)
        .find((line) => line.startsWith("KIWI_DEBUG_CLASSPATH="));
      if (!marker) throw new Error("Gradle hat keinen Runtime-Classpath geliefert.");
      return classpathEntries(marker.slice("KIWI_DEBUG_CLASSPATH=".length));
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Starts the JDI adapter against an address that is already listening.
   *
   * Shared by launching and attaching: the two only differ in who opened the
   * JDWP port, which is exactly the part above this method.
   */
  async startAdapter(root, host, port, adapterJdk, epoch = this.sessionEpoch) {
    const adapterJar = resolveAdapterJar();
    if (!fsSync.existsSync(adapterJar)) throw new Error(`Kiwi-JDI-Adapter fehlt: ${adapterJar}`);
    let rejectReady;
    let readySettled = false;
    let readyTimeout;
    const ready = new Promise((resolve, reject) => {
      rejectReady = reject;
      readyTimeout = setTimeout(() => {
        if (readySettled) return;
        readySettled = true;
        this.adapterReady = null;
        reject(new Error("Der Kiwi-JDI-Adapter konnte nicht gestartet werden."));
      }, 10_000);
      this.adapterReady = () => {
        if (readySettled) return;
        readySettled = true;
        clearTimeout(readyTimeout);
        resolve();
      };
    });
    const adapter = spawn(adapterJdk.java, [
      "--add-modules", "jdk.jdi",
      "-cp", adapterJar,
      "dev.kiwi.debug.KiwiDebugAdapter",
      host,
      String(port),
    ], {
      cwd: root,
      env: {
        ...process.env,
        JAVA_HOME: adapterJdk.path,
        PATH: `${path.join(adapterJdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}`,
      },
      windowsHide: true,
    });
    this.adapter = adapter;
    adapter.stdout.on("data", (data) => {
      if (epoch === this.sessionEpoch && this.adapter === adapter) this.consumeAdapter(data.toString());
    });
    adapter.stderr.on("data", (data) => {
      if (epoch === this.sessionEpoch && this.adapter === adapter) {
        this.send("debug:output", { text: data.toString(), stream: "stderr" });
      }
    });
    adapter.on("error", (error) => {
      if (!readySettled) {
        readySettled = true;
        clearTimeout(readyTimeout);
        this.adapterReady = null;
        rejectReady(error);
      }
      if (epoch === this.sessionEpoch && this.adapter === adapter) {
        this.send("debug:output", { text: `${error.message}\n`, stream: "stderr" });
      }
    });
    adapter.on("close", (code) => {
      if (!readySettled) {
        readySettled = true;
        clearTimeout(readyTimeout);
        this.adapterReady = null;
        rejectReady(new Error(`Der Kiwi-JDI-Adapter wurde vor READY beendet (${code ?? 0}).`));
      }
      if (epoch !== this.sessionEpoch || this.adapter !== adapter) return;
      if (this.vm || this.attached) {
        this.send("debug:output", { text: `JDI-Adapter beendet (${code ?? 0}).\n`, stream: code ? "stderr" : "stdout" });
      }
      this.adapter = null;
      if (this.root && (this.vm || this.attached)) this.stop();
    });
    await ready;
  }

  /**
   * Attaches to a JVM that is already running with JDWP enabled.
   *
   * Launching the process was the only way in before, which rules out every
   * server that is started by something else — a container, a service manager,
   * a colleague's machine. The JVM has to have been started with
   * `-agentlib:jdwp=transport=dt_socket,server=y,address=…`; nothing here can
   * add that after the fact, so an unreachable port says so plainly.
   */
  async attach(payload) {
    this.stop();
    const epoch = this.sessionEpoch;
    const root = this.pathGuard.assertWorkspace(payload.root);
    const host = String(payload.host || "127.0.0.1").trim();
    const port = Number(payload.port);
    if (!/^[\w.-]+$/.test(host)) throw new Error("Ungültiger Host für das Andocken.");
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Der Debug-Port muss zwischen 1 und 65535 liegen.");

    const config = payload.configuration || {};
    const projectJdk = await this.projects.detectJdk(root, config.jdkPath);
    const usable = await this.resolveAdapterJdk(projectJdk);
    this.assertSession(epoch);
    if (!usable.available || usable.major < 21) {
      throw new Error("Der Kiwi-JDI-Adapter benötigt ein separates JDK 21 oder neuer.");
    }
    const debugProject = await this.projects.detect(root);
    this.assertSession(epoch);
    const modules = typeof this.builds.modules?.list === "function"
      ? await this.builds.modules.list(root)
      : [];
    this.assertSession(epoch);
    const configuredModuleId = config.moduleId || payload.moduleId;
    const debugModule = configuredModuleId
      ? modules.find((candidate) => candidate.id === configuredModuleId)
      : modules.find((candidate) => candidate.relativePath === ".") || null;
    if (configuredModuleId && !debugModule) {
      throw new Error(`Das konfigurierte Modul „${configuredModuleId}“ wurde nicht gefunden.`);
    }

    this.root = root;
    this.moduleId = debugModule?.id || "";
    this.attached = true;
    this.launchRequest = null;
    // The adapter itself needs Java 21+, but edited sources must be compiled
    // with the project's JDK/language level (which may intentionally be 8/11/17).
    this.targetJdk = projectJdk.available ? projectJdk : usable;
    this.debugProject = debugProject;
    this.debugModule = debugModule;
    this.debugEnv = {
      ...process.env,
      JAVA_HOME: this.targetJdk.path,
      PATH: `${path.join(this.targetJdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}`,
    };
    const attachedLevel = Number(debugModule?.languageLevel || this.debugProject.languageLevel || this.targetJdk.major);
    this.hotReplaceCompilerArgs = [
      "-g",
      "-encoding", this.debugProject.encoding || "UTF-8",
      ...(Number.isFinite(attachedLevel) ? ["--release", String(attachedLevel)] : []),
      ...(this.debugProject.previewFeatures ? ["--enable-preview"] : []),
      ...splitArgs(this.debugProject.compilerArgs || ""),
    ];
    try {
      if (debugProject.type === "Java") {
        let indexed = [];
        if (typeof this.classpathProvider === "function") {
          try {
            indexed = classpathEntries(await this.classpathProvider(root, ""));
          } catch (error) {
            this.send("debug:output", {
              text: `Java-Index-Classpath nicht verfügbar: ${conciseFailure(error)}\n`,
              stream: "stderr",
            });
          }
        }
        const libraries = await this.plainLibraries(root, debugProject);
        const outputs = plainOutputEntries(root, debugModule, modules);
        this.classpath = uniqueClasspath([...outputs, ...indexed, ...libraries]).join(path.delimiter);
        this.outputDirectory = outputs[0] || "";
      } else {
        this.classpath = await this.managedRuntimeClasspath(
          root,
          debugProject,
          debugModule,
          modules,
          "",
          this.debugEnv,
        );
        this.outputDirectory = managedOutputEntries(debugProject.type, debugModule, modules, root)[0] || "";
      }
      this.assertSession(epoch);
    } catch (error) {
      if (epoch === this.sessionEpoch) this.stop();
      throw error;
    }
    this.mainClass = `${host}:${port}`;
    this.breakpoints = (payload.breakpoints || []).filter((item) => item.enabled !== false);
    this.send("debug:state", { status: "starting", engine: "JDI/JDWP", attached: true, port, mainClass: this.mainClass });
    this.send("debug:output", { text: `Andocken an ${host}:${port} …\n` });

    try {
      await this.startAdapter(root, host, port, usable, epoch);
      this.assertSession(epoch);
    } catch (error) {
      if (epoch === this.sessionEpoch) this.stop();
      throw new Error(
        `Andocken an ${host}:${port} fehlgeschlagen. Läuft dort eine JVM mit`
        + ` -agentlib:jdwp=transport=dt_socket,server=y,address=${port}? (${error.message})`,
      );
    }

    this.configureBreakpoints();
    // An attached JVM is already running; resuming it is the caller's choice,
    // and suspending everything on connect would freeze a live server.
    this.send("debug:state", { status: "running", engine: "JDI/JDWP", attached: true, port, mainClass: this.mainClass });
    return { started: true, engine: "JDI/JDWP", attached: true, port, mainClass: this.mainClass };
  }

  configureBreakpoints() {
    this.writeAdapter("clearBreakpoints");
    this.writeAdapter("clearExceptions");
    this.writeAdapter("clearWatchpoints");
    this.writeAdapter("clearMethodBreakpoints");
    for (const breakpoint of this.breakpoints) {
      if (breakpoint.type === "field") {
        // A field breakpoint answers "who wrote that value", which no line
        // breakpoint can: the write may be in a class nobody suspected.
        if (!breakpoint.className || !breakpoint.fieldName) continue;
        this.writeAdapter(
          "watch",
          encode(breakpoint.className),
          encode(breakpoint.fieldName),
          String(breakpoint.onWrite !== false),
          String(breakpoint.onRead === true),
        );
      } else if (breakpoint.type === "method") {
        if (!breakpoint.className || !breakpoint.methodName) continue;
        this.writeAdapter(
          "methodBreak",
          encode(breakpoint.className),
          encode(breakpoint.methodName),
          String(breakpoint.onEntry !== false),
          String(breakpoint.onExit === true),
        );
      } else if (breakpoint.type === "exception") {
        this.writeAdapter(
          "exception",
          encode(breakpoint.className || "java.lang.Throwable"),
          String(breakpoint.caught !== false),
          String(breakpoint.uncaught !== false),
        );
      } else if (breakpoint.className && breakpoint.line) {
        this.writeAdapter(
          "break",
          encode(breakpoint.className),
          String(breakpoint.line),
          encode(breakpoint.condition || ""),
          encode(breakpoint.hitCondition || ""),
          encode(breakpoint.logMessage || ""),
        );
      }
    }
  }

  consumeAdapter(text) {
    this.adapterBuffer += text;
    const lines = this.adapterBuffer.split(/\r?\n/);
    this.adapterBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("KIWI\t")) {
        if (line) this.send("debug:output", { text: `${line}\n`, stream: "stdout" });
        continue;
      }
      const parts = line.split("\t");
      const type = parts[1];
      if (type === "READY") {
        this.adapterReady?.();
        this.adapterReady = null;
      } else if (type === "STATE") {
        this.send("debug:state", {
          status: parts[2],
          engine: "JDI/JDWP",
          threadId: Number(parts[3]) || undefined,
          className: decode(parts[4]),
          line: Number(parts[5]) || undefined,
          reason: parts[6] || "",
        });
      } else if (type === "OUTPUT") {
        this.send("debug:output", { text: decode(parts[2]), stream: "stdout" });
      } else if (type === "ERROR") {
        this.send("debug:output", { text: `JDI: ${decode(parts[2])}\n`, stream: "stderr" });
      } else if (type === "VAR") {
        const scope = parts[2];
        const items = this.variableScopes.get(scope) || [];
        items.push({
          name: decode(parts[3]),
          value: decode(parts[4]),
          type: decode(parts[5]),
          referenceId: Number(parts[6]) || 0,
          hasChildren: parts[7] === "true",
        });
        this.variableScopes.set(scope, items);
      } else if (type === "VARS_END") {
        const scope = parts[2];
        const variables = this.variableScopes.get(scope) || [];
        this.variableScopes.delete(scope);
        this.send("debug:variables", { scope, variables });
      } else if (type === "STACK") {
        this.stackFrames.push({
          id: Number(parts[2]),
          threadId: Number(parts[3]),
          className: decode(parts[4]),
          methodName: decode(parts[5]),
          sourceName: decode(parts[6]),
          line: Number(parts[7]),
        });
      } else if (type === "STACK_END") {
        this.send("debug:stack", { threadId: Number(parts[2]), frames: this.stackFrames });
        this.stackFrames = [];
      } else if (type === "THREAD") {
        this.threads.push({
          id: Number(parts[2]),
          name: decode(parts[3]),
          status: Number(parts[4]),
          suspended: parts[5] === "true",
          selected: parts[6] === "true",
        });
      } else if (type === "THREADS_END") {
        this.send("debug:threads", { threads: this.threads });
        this.threads = [];
      } else if (type === "WATCH") {
        this.send("debug:watch", {
          expression: decode(parts[2]),
          value: decode(parts[3]),
          type: decode(parts[4]),
          referenceId: Number(parts[5]) || 0,
        });
      } else if (type === "HOT_REPLACE") {
        const operationId = decode(parts[3]);
        const message = decode(parts[4]);
        const success = parts[2] === "ok";
        const temporaryOutput = this.hotReplaceOutputs.get(operationId);
        const revision = this.hotReplaceRevisions.get(operationId);
        this.hotReplaceOutputs.delete(operationId);
        this.hotReplaceRevisions.delete(operationId);
        if (temporaryOutput) void fs.rm(temporaryOutput, { recursive: true, force: true }).catch(() => undefined);
        // Only confirmed VM state is a valid future comparison baseline. On
        // adapter errors (unsupported schema change, disconnected VM, ...),
        // retaining the previous baseline lets Smart HotSwap make the correct
        // decision on the next save.
        if (success && revision) {
          this.hotReplaceSources.set(revision.file, revision.source);
          this.hotReplaceFallbackSources.delete(revision.file);
        }
        this.send("debug:hotReplace", { success, message });
        this.send("debug:output", { text: `Hot Code Replace: ${message}\n`, stream: success ? "stdout" : "stderr" });
      } else if (type === "EXCEPTION") {
        this.send("debug:exception", { className: decode(parts[2]), value: decode(parts[3]) });
      } else if (type === "BREAKPOINT") {
        this.send("debug:breakpoint", { className: decode(parts[2]), line: Number(parts[3]), status: parts[4] });
      } else if (type === "WATCHPOINT" || type === "METHODBREAK") {
        this.send("debug:breakpoint", {
          className: decode(parts[2]),
          member: decode(parts[3]),
          type: type === "WATCHPOINT" ? "field" : "method",
          status: parts[4],
          problem: decode(parts[5]),
        });
      } else if (type === "FIELDHIT") {
        // The value it is about to take is the reason to stop here at all, and
        // it is gone by the time the next line runs.
        this.send("debug:fieldHit", {
          className: decode(parts[2]),
          fieldName: decode(parts[3]),
          access: parts[4],
          value: decode(parts[5]),
          newValue: decode(parts[6]),
        });
      } else if (type === "METHODEXIT") {
        this.send("debug:methodExit", {
          className: decode(parts[2]),
          methodName: decode(parts[3]),
          returnValue: decode(parts[4]),
        });
      }
    }
  }

  async command(command, argument) {
    // Saves can arrive while Smart HotSwap is replacing the VM. Accept and
    // version them here; the queue waits until the new adapter is ready.
    if (command === "hotReplace") {
      if (!this.root) throw new Error("Der JDI-Debugger ist nicht aktiv.");
      return this.enqueueHotReplace(argument || this.activeSource);
    }
    if (!this.adapter) throw new Error("Der JDI-Debugger ist nicht aktiv.");
    if (command === "relaunch") return this.relaunchForHotReplace(this.activeSource, null, this.sessionEpoch);
    if (command.startsWith("profile")) return this.profile(command);
    if (command === "variables") {
      this.writeAdapter("variables", String(Number(argument) || 0));
      return true;
    }
    if (command === "selectThread") {
      this.writeAdapter("selectThread", String(Number(argument) || 0));
      return true;
    }
    if (command === "runToCursor") {
      const target = typeof argument === "string" ? JSON.parse(argument) : argument;
      if (!target?.className || !Number(target.line)) throw new Error("Run to Cursor benötigt Klasse und Zeile.");
      this.writeAdapter("runToCursor", encode(target.className), String(Number(target.line)));
      return true;
    }
    const commands = new Set(["continue", "stepInto", "stepOver", "stepOut", "pause", "stack", "locals", "threads", "restartFrame"]);
    if (commands.has(command)) {
      this.writeAdapter(command);
      return true;
    }
    if (command === "evaluate" && String(argument || "").trim()) {
      this.writeAdapter("evaluate", encode(String(argument).trim()));
      return true;
    }
    // Changing a value takes two halves — what to change and what to change it
    // to — so the argument is an object rather than a string.
    if (command === "setVariable") {
      const request = typeof argument === "string" ? JSON.parse(argument) : argument;
      const target = String(request?.target || "").trim();
      const value = String(request?.value ?? "").trim();
      if (!target) throw new Error("Es wurde keine Variable angegeben.");
      if (!value) throw new Error("Es wurde kein neuer Wert angegeben.");
      this.writeAdapter("setVariable", encode(target), encode(value));
      return true;
    }
    throw new Error("Unbekannter Debug-Befehl.");
  }

  async profile(command) {
    const pid = this.vm?.pid;
    if (!pid || !this.targetJdk) throw new Error("Keine aktive Java-VM für den Profiler.");
    const jcmd = path.join(this.targetJdk.path, "bin", process.platform === "win32" ? "jcmd.exe" : "jcmd");
    const profileDirectory = path.join(this.root, ".kiwi", "profiles");
    await fs.mkdir(profileDirectory, { recursive: true });
    const recording = path.join(profileDirectory, `kiwi-${new Date().toISOString().replace(/[:.]/g, "-")}.jfr`);
    const args = command === "profileThreads"
      ? [String(pid), "Thread.print", "-l"]
      : command === "profileHeap"
        ? [String(pid), "GC.class_histogram"]
        : command === "profileMemory"
          ? [String(pid), "GC.heap_info"]
          : command === "profileCpu"
            ? [String(pid), "JFR.start", "name=Kiwi", "settings=profile", `filename=${recording}`, "duration=60s"]
            : null;
    if (!args) throw new Error("Unbekannte Profiler-Aktion.");
    const result = await spawnCapture(jcmd, args, { cwd: this.root, rejectOnError: true });
    const heading = command === "profileCpu" ? `CPU-Aufzeichnung: ${recording}` : command.replace("profile", "Profiler ");
    this.send("debug:output", { text: `\n=== ${heading} ===\n${result.output}\n`, stream: "stdout" });
    return { output: result.output, recording: command === "profileCpu" ? recording : "" };
  }

  enqueueHotReplace(request) {
    const options = normalizeHotReplaceRequest(request, this.activeSource);
    const file = this.pathGuard.assertAllowed(options.file, this.root);
    if (!file.toLowerCase().endsWith(".java")) throw new Error("Hot Code Replace benötigt eine Java-Quelldatei.");
    const version = (this.hotReplaceVersions.get(file) || 0) + 1;
    this.hotReplaceVersions.set(file, version);
    // Keep the complete newest request, not just a counter. In particular the
    // earliest still-unconfirmed previousSource must survive coalescing: if
    // v0→v1 changed main() and v1→v2 changed a helper, comparing only v1→v2
    // would incorrectly choose plain redefine instead of a relaunch.
    const existingRequest = this.hotReplaceRequests.get(file);
    this.hotReplaceRequests.set(file, {
      ...options,
      ...(existingRequest && typeof existingRequest.previousSource === "string"
        ? { previousSource: existingRequest.previousSource }
        : {}),
      file,
      version,
    });
    const pending = this.hotReplacePending.get(file);
    if (pending) return pending;

    const cancellation = this.hotReplaceCancellation;
    let handledVersion = 0;
    let job;
    const queued = this.hotReplaceQueue.then(async () => {
      let result = true;
      while (cancellation === this.hotReplaceCancellation && handledVersion !== this.hotReplaceVersions.get(file)) {
        const latest = this.hotReplaceRequests.get(file);
        if (!latest) break;
        const targetVersion = latest.version;
        try {
          await this.waitForHotReplaceReady(cancellation);
          result = await this.hotReplace(
            file,
            this.sessionEpoch,
            latest.mode,
            latest.previousSource,
          );
          handledVersion = targetVersion;
        } catch (error) {
          handledVersion = targetVersion;
          const newerVersion = this.hotReplaceVersions.get(file) || 0;
          if (cancellation === this.hotReplaceCancellation && newerVersion > targetVersion) {
            this.send("debug:output", {
              text: `HotSwap-Revision ${targetVersion} fehlgeschlagen; neuere Revision ${newerVersion} wird verarbeitet. ${conciseFailure(error)}\n`,
              stream: "stderr",
            });
            continue;
          }
          throw error;
        }
      }
      return result;
    });
    job = queued.finally(() => {
      const ownsPendingSlot = this.hotReplacePending.get(file) === job;
      if (ownsPendingSlot) this.hotReplacePending.delete(file);
      // A cancelled old-session job must never delete an identically numbered
      // request that already belongs to a newly started debug session.
      if (ownsPendingSlot && this.hotReplaceVersions.get(file) === handledVersion) {
        this.hotReplaceVersions.delete(file);
        this.hotReplaceRequests.delete(file);
      }
    });
    this.hotReplacePending.set(file, job);
    this.hotReplaceQueue = job.catch(() => undefined);
    return job;
  }

  async waitForHotReplaceReady(cancellation, timeoutMs = 60_000) {
    const started = Date.now();
    while (!this.adapter || !this.targetJdk || !this.root) {
      if (cancellation !== this.hotReplaceCancellation || !this.root) {
        throw new Error("Die Debug-Sitzung wurde während HotSwap beendet.");
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error("Die neue Debug-VM wurde für HotSwap nicht rechtzeitig bereit.");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async hotReplace(file, epoch = this.sessionEpoch, mode = "smart", requestedPreviousSource) {
    if (!this.adapter || !this.targetJdk || !this.root) throw new Error("Der JDI-Debugger ist nicht aktiv.");
    const source = await fs.readFile(file, "utf8");
    const sourceKey = path.normalize(file);
    const confirmedSource = this.hotReplaceSources.get(sourceKey);
    if (confirmedSource === undefined
      && !this.hotReplaceFallbackSources.has(sourceKey)
      && typeof requestedPreviousSource === "string") {
      this.hotReplaceFallbackSources.set(sourceKey, requestedPreviousSource);
    }
    // A renderer baseline can describe a save that the adapter rejected. Once
    // Kiwi knows a confirmed VM revision, it always wins. Otherwise retain the
    // earliest renderer baseline rather than advancing it on every save.
    const previousSource = confirmedSource
      ?? this.hotReplaceFallbackSources.get(sourceKey)
      ?? (typeof requestedPreviousSource === "string" ? requestedPreviousSource : undefined);
    const simpleClassName = path.basename(file, ".java");
    const shouldRelaunch = mode === "relaunch"
      || (mode === "smart"
        && previousSource !== undefined
        && smartHotSwapRequiresRelaunch(previousSource, source, simpleClassName));
    if (shouldRelaunch && !this.attached && this.launchRequest) {
      return this.relaunchForHotReplace(file, source, epoch);
    }
    if (shouldRelaunch && this.attached) {
      this.send("debug:output", {
        text: "Smart HotSwap: Die JVM wurde extern gestartet und wird deshalb nicht automatisch neu gestartet; Kiwi ersetzt nur den Bytecode.\n",
        stream: "stdout",
      });
    }
    const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
    const className = `${packageName ? `${packageName}.` : ""}${path.basename(file, ".java")}`;
    const operationId = `${Date.now().toString(36)}-${(++this.hotReplaceSequence).toString(36)}`;
    const output = path.join(
      this.root,
      ".kiwi",
      "hot-replace",
      operationId,
    );
    await fs.mkdir(output, { recursive: true });
    this.send("debug:output", { text: `HotSwap: ${path.basename(file)} wird inkrementell kompiliert …\n`, stream: "stdout" });

    let classOutput = output;
    try {
      await spawnCapture(this.targetJdk.javac, [
        ...this.hotReplaceCompilerArgs,
        ...(this.classpath ? ["-classpath", this.classpath] : []),
        "-d", output,
        file,
      ], { cwd: this.root, env: this.debugEnv || process.env, rejectOnError: true });
    } catch (directFailure) {
      // A single-file javac has no knowledge of dependency jars in every
      // Maven/Gradle layout. Fall back to the build tool's incremental compile;
      // the normal path remains the fast single-file compile.
      if (!this.debugProject || this.debugProject.type === "Java") {
        await fs.rm(output, { recursive: true, force: true }).catch(() => undefined);
        throw new Error(
          `Instant HotSwap konnte ${path.basename(file)} nicht kompilieren. ${conciseFailure(directFailure)}`,
        );
      }
      try {
        classOutput = await this.compileHotReplaceWithBuildTool(file, directFailure);
      } catch (buildFailure) {
        await fs.rm(output, { recursive: true, force: true }).catch(() => undefined);
        throw buildFailure;
      }
    }

    if (epoch !== this.sessionEpoch || !this.adapter) {
      await fs.rm(output, { recursive: true, force: true }).catch(() => undefined);
      throw new Error("Die Debug-Sitzung wurde während HotSwap beendet.");
    }
    let classFiles = await hotReplaceClassFiles(classOutput, className);
    if (!classFiles.length) {
      await fs.rm(output, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Die kompilierte Klasse ${className} wurde nicht gefunden.`);
    }
    if (classOutput !== output) {
      classFiles = await stageHotReplaceClassFiles(classFiles, output, className);
    }
    const commandParts = classFiles.flatMap((entry) => [encode(entry.className), encode(entry.file)]);
    this.hotReplaceOutputs.set(operationId, output);
    this.hotReplaceRevisions.set(operationId, { file: sourceKey, source });
    if (!this.writeAdapter("hotReplace", encode(operationId), ...commandParts)) {
      this.hotReplaceOutputs.delete(operationId);
      this.hotReplaceRevisions.delete(operationId);
      await fs.rm(output, { recursive: true, force: true }).catch(() => undefined);
      throw new Error("Der JDI-Debugger konnte HotSwap nicht entgegennehmen.");
    }
    return { queued: true, className, classes: classFiles.length };
  }

  async relaunchForHotReplace(file, source = null, epoch = this.sessionEpoch) {
    this.assertSession(epoch);
    if (this.attached || !this.launchRequest) {
      throw new Error("Eine extern gestartete JVM kann Kiwi nicht automatisch neu starten.");
    }
    const request = cloneLaunchRequest({
      ...this.launchRequest,
      // Preserve conditional, exception and log breakpoints in the new VM.
      breakpoints: this.breakpoints,
    });
    const className = path.basename(file || this.activeSource, ".java");
    this.send("debug:output", {
      text: `Smart HotSwap: ${className} enthält bereits ausgeführten Start- oder Initialisierungscode. Anwendung wird automatisch neu geladen …\n`,
      stream: "stdout",
    });
    this.send("debug:state", { status: "restarting", engine: "JDI/JDWP", mainClass: this.mainClass });

    // start() owns the full lifecycle: it closes the old VM/adapter, rebuilds
    // with the same module/JDK/arguments and reinstalls all breakpoints. No
    // manual pause is needed; stale process events are guarded by the epoch.
    const result = await this.start({ ...request, __smartRelaunch: true });
    if (source !== null && file) this.hotReplaceSources.set(path.normalize(file), source);
    const message = `${className} neu geladen. Startcode wurde erneut ausgeführt; Breakpoints und Run-Konfiguration wurden beibehalten.`;
    this.send("debug:hotReplace", { success: true, restarted: true, message });
    this.send("debug:output", { text: `Smart HotSwap: ${message}\n`, stream: "stdout" });
    return { queued: false, restarted: true, className, ...result };
  }

  async compileHotReplaceWithBuildTool(file, directFailure) {
    const project = this.debugProject;
    const detectedModule = typeof this.builds.moduleOwning === "function"
      ? await this.builds.moduleOwning(this.root, file).catch(() => null)
      : null;
    const module = detectedModule || this.debugModule;
    const moduleRoot = module?.root || this.root;
    this.send("debug:output", {
      text: `HotSwap: Abhängigkeiten erfordern einen inkrementellen ${project.type}-Compile.\n`,
      stream: "stdout",
    });
    try {
      const command = this.builds.resolveBuildTool(this.root, project.type, project.preferWrapper !== false);
      if (project.type === "Maven") {
        const args = [
          ...(project.mavenOffline ? ["-o"] : []),
          ...(module && module.relativePath !== "." ? ["-am", "-pl", module.relativePath.replace(/\\/g, "/")] : []),
          "compile",
          "-q",
          `-Dmaven.compiler.release=${module?.languageLevel || project.languageLevel || this.targetJdk.major}`,
          ...(project.annotationProcessing === false ? ["-Dmaven.compiler.proc=none"] : []),
        ];
        await spawnCapture(command, args, { cwd: this.root, env: this.debugEnv || process.env, rejectOnError: true });
        return path.join(moduleRoot, "target", "classes");
      }
      const task = module && module.relativePath !== "."
        ? `:${module.relativePath.replace(/[\\/]/g, ":")}:classes`
        : "classes";
      await spawnCapture(command, [
        task,
        "--console=plain",
        "--no-daemon",
        ...(project.gradleOffline ? ["--offline"] : []),
      ], { cwd: this.root, env: this.debugEnv || process.env, rejectOnError: true });
      return path.join(moduleRoot, "build", "classes", "java", "main");
    } catch (buildFailure) {
      const wrapped = new Error(
        `HotSwap-Compile fehlgeschlagen. Build-Werkzeug: ${conciseFailure(buildFailure)} `
        + `Direkter Compile: ${conciseFailure(directFailure)}`,
      );
      wrapped.cause = buildFailure;
      throw wrapped;
    }
  }

  writeAdapter(command, ...parts) {
    if (!this.adapter?.stdin?.writable) return false;
    this.adapter.stdin.write(`${[command, ...parts].join("\t")}\n`);
    return true;
  }

  stop(options = {}) {
    this.sessionEpoch += 1;
    if (!options.preserveHotReplace) this.hotReplaceCancellation += 1;
    // "exit" makes the adapter call VirtualMachine.dispose(), which resumes
    // and releases the target instead of killing it — exactly what detaching
    // needs. Only a JVM Kiwi started itself is terminated as well; one that was
    // already running was never Kiwi's to stop.
    try { this.adapter?.stdin?.write("exit\n"); } catch {}
    void terminateProcessTree(this.adapter);
    if (!this.attached) void terminateProcessTree(this.vm);
    this.attached = false;
    this.adapter = null;
    this.vm = null;
    this.adapterReady = null;
    this.adapterBuffer = "";
    this.variableScopes.clear();
    this.stackFrames = [];
    this.threads = [];
    if (this.root && !options.silent) this.send("debug:state", { status: "stopped", engine: "JDI/JDWP" });
    // Release the session identity as well, otherwise `app:health` keeps
    // reporting a long-finished debug session as active.
    this.root = "";
    this.moduleId = "";
    this.targetJdk = null;
    this.classpath = "";
    this.outputDirectory = "";
    this.activeSource = "";
    this.mainClass = "";
    this.debugProject = null;
    this.debugModule = null;
    this.debugEnv = null;
    this.hotReplaceCompilerArgs = [];
    this.launchRequest = null;
    this.hotReplaceSources.clear();
    this.hotReplaceFallbackSources.clear();
    if (!options.preserveHotReplace) {
      this.hotReplacePending.clear();
      this.hotReplaceVersions.clear();
      this.hotReplaceRequests.clear();
    }
    for (const temporaryOutput of this.hotReplaceOutputs.values()) {
      // Give an adapter that is currently reading bytecode a moment to finish
      // before temporary output from a stopped session is removed.
      const cleanup = setTimeout(
        () => void fs.rm(temporaryOutput, { recursive: true, force: true }).catch(() => undefined),
        2_000,
      );
      cleanup.unref?.();
    }
    this.hotReplaceOutputs.clear();
    this.hotReplaceRevisions.clear();
    if (!options.preserveHotReplace) this.hotReplaceQueue = Promise.resolve();
    this.breakpoints = [];
    return true;
  }
}

function resolveAdapterJar() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, "debug-adapter", "kiwi-debug-adapter.jar"),
    path.join(__dirname, "..", "..", "resources", "debug-adapter", "kiwi-debug-adapter.jar"),
  ].filter(Boolean);
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || candidates.at(-1);
}

function managedOutputEntries(type, selectedModule, modules, root) {
  const candidates = [];
  if (selectedModule) candidates.push(selectedModule);
  for (const module of modules || []) {
    if (!selectedModule || module.id !== selectedModule.id) candidates.push(module);
  }
  if (!candidates.length) candidates.push({ root });
  return candidates.flatMap((module) => {
    const moduleRoot = module.root || root;
    if (type === "Maven") {
      return [
        path.join(moduleRoot, "target", "test-classes"),
        path.join(moduleRoot, "target", "classes"),
      ];
    }
    return [
      path.join(moduleRoot, "build", "classes", "java", "test"),
      path.join(moduleRoot, "build", "classes", "java", "main"),
      path.join(moduleRoot, "build", "resources", "test"),
      path.join(moduleRoot, "build", "resources", "main"),
    ];
  });
}

function plainOutputEntries(root, selectedModule, modules) {
  let candidates = selectedModule ? [selectedModule] : [];
  if (selectedModule) {
    try {
      const ordered = topologicalSortModules(modules || []);
      const required = dependencyClosure(selectedModule.id, ordered);
      candidates = ordered.filter((candidate) => required.has(candidate.id));
    } catch {
      // A cycle is already reported by the module model. Keeping the selected
      // module on the classpath still lets a user attach and inspect a JVM.
    }
  }
  if (!candidates.length) candidates = modules?.length ? modules : [{ root }];
  return uniqueClasspath([
    path.join(root, ".kiwi", "debug-out"),
    path.join(root, ".kiwi", "jdt-out"),
    ...candidates.flatMap((module) => {
      const moduleRoot = module.root || root;
      return [
        module.outputPath,
        path.join(moduleRoot, "build", "test-classes"),
        path.join(moduleRoot, "build", "classes"),
      ];
    }),
  ]);
}

function classpathEntries(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) classpathEntries(entry, result);
    return uniqueClasspath(result);
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) classpathEntries(entry, result);
    return uniqueClasspath(result);
  }
  if (typeof value !== "string") return uniqueClasspath(result);
  for (const part of value.split(path.delimiter)) {
    let entry = part.trim().replace(/^['"]|['"]$/g, "");
    if (!entry) continue;
    try {
      if (/^file:/i.test(entry)) entry = fileURLToPath(entry);
    } catch {
      continue;
    }
    // JDT command responses contain metadata as well as path arrays. Only
    // absolute filesystem entries can belong on java's classpath.
    if (path.isAbsolute(entry)) result.push(path.normalize(entry));
  }
  return uniqueClasspath(result);
}

function uniqueClasspath(entries) {
  const result = [];
  const seen = new Set();
  for (const entry of entries || []) {
    if (!entry) continue;
    const normalized = path.normalize(String(entry));
    const key = process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

async function classExists(className, classpath) {
  const relative = `${className.replaceAll(".", path.sep)}.class`;
  for (const entry of classpathEntries(classpath)) {
    const stat = await fs.stat(entry).catch(() => null);
    if (stat?.isDirectory() && fsSync.existsSync(path.join(entry, relative))) return true;
  }
  return false;
}

async function hotReplaceClassFiles(output, className) {
  const segments = className.split(".");
  const simpleName = segments.pop();
  const packageName = segments.join(".");
  const directory = path.join(output, ...segments);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile()
      && entry.name.endsWith(".class")
      && (entry.name === `${simpleName}.class` || entry.name.startsWith(`${simpleName}$`)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const binaryName = entry.name.slice(0, -".class".length);
      return {
        className: packageName ? `${packageName}.${binaryName}` : binaryName,
        file: path.join(directory, entry.name),
      };
    });
}

async function stageHotReplaceClassFiles(classFiles, output, className) {
  const packageSegments = className.split(".").slice(0, -1);
  const directory = path.join(output, ...packageSegments);
  await fs.mkdir(directory, { recursive: true });
  return Promise.all(classFiles.map(async (entry) => {
    const target = path.join(directory, path.basename(entry.file));
    await fs.copyFile(entry.file, target);
    return { ...entry, file: target };
  }));
}

function conciseFailure(failure) {
  const message = String(failure?.message || failure || "Unbekannter Compilerfehler").trim();
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
}

function normalizeHotReplaceRequest(request, fallbackFile = "") {
  if (typeof request === "string") return { file: request || fallbackFile, mode: "smart" };
  const requestedMode = String(request?.mode || "smart").toLowerCase();
  const mode = ["smart", "redefine", "relaunch"].includes(requestedMode) ? requestedMode : "smart";
  return {
    file: request?.file || fallbackFile,
    mode,
    ...(typeof request?.previousSource === "string" ? { previousSource: request.previousSource } : {}),
  };
}

function cloneLaunchRequest(payload) {
  return {
    root: payload.root,
    file: payload.file,
    configuration: {
      ...(payload.configuration || {}),
      env: { ...(payload.configuration?.env || {}) },
    },
    breakpoints: (payload.breakpoints || []).map((breakpoint) => ({ ...breakpoint })),
  };
}

/**
 * Determines whether bytecode replacement alone would be visibly incomplete.
 *
 * JDI cannot replay main(), a constructor or an initializer and it intentionally
 * does not mutate objects that already exist. A regular method body, however,
 * can stay on the fast redefine path because its next invocation uses the new
 * bytecode. This deliberately conservative source analysis is not a Java
 * parser: uncertainty results in a relaunch, which is safer than claiming that
 * an already executed UI setup changed when it did not.
 */
function smartHotSwapRequiresRelaunch(previousSource, nextSource, simpleClassName = "") {
  if (previousSource === nextSource) return false;
  if (javaWithoutTrivia(previousSource) === javaWithoutTrivia(nextSource)) return false;

  const previousChange = changedSpan(previousSource, nextSource);
  const nextChange = changedSpan(nextSource, previousSource);
  const previousScope = executableScopeAt(previousSource, previousChange, simpleClassName);
  const nextScope = executableScopeAt(nextSource, nextChange, simpleClassName);

  // Field/static/instance initializers and structural edits are outside a
  // method range. They need a fresh VM/object graph to become observable.
  if (!previousScope || !nextScope) return true;
  if (previousScope.kind !== "method" || nextScope.kind !== "method") return true;
  // A renamed method or changed parameter/throws signature is a schema change
  // and is outside standard HotSwap capabilities even if the edit happens to
  // be textually contained by the method range.
  return previousScope.name !== nextScope.name
    || previousScope.signature !== nextScope.signature;
}

function changedSpan(source, other) {
  const limit = Math.min(source.length, other.length);
  let start = 0;
  while (start < limit && source[start] === other[start]) start += 1;
  let sourceEnd = source.length;
  let otherEnd = other.length;
  while (sourceEnd > start && otherEnd > start && source[sourceEnd - 1] === other[otherEnd - 1]) {
    sourceEnd -= 1;
    otherEnd -= 1;
  }
  return { start, end: Math.max(start, sourceEnd) };
}

function executableScopeAt(source, span, simpleClassName) {
  const ranges = javaExecutableRanges(source, simpleClassName)
    .filter((range) => span.start >= range.start && span.end <= range.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start));
  return ranges[0] || null;
}

function javaExecutableRanges(source, simpleClassName = "") {
  const masked = maskJava(source);
  const declaredTypes = new Set(
    [...masked.matchAll(/\b(?:class|record|enum)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]),
  );
  if (simpleClassName) declaredTypes.add(simpleClassName);
  const controls = new Set(["if", "for", "while", "switch", "catch", "synchronized", "try", "new"]);
  const ranges = [];
  const pattern = /([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^;{}]+)?\s*\{/g;
  for (const match of masked.matchAll(pattern)) {
    const name = match[1];
    if (controls.has(name)) continue;
    const open = match.index + match[0].lastIndexOf("{");
    const boundary = Math.max(
      masked.lastIndexOf("{", match.index - 1),
      masked.lastIndexOf("}", match.index - 1),
      masked.lastIndexOf(";", match.index - 1),
    );
    const prefix = masked.slice(boundary + 1, match.index).trim();
    // Exclude calls followed by a lambda/anonymous body. A declaration has a
    // return type/modifier prefix, except a constructor whose name is a type.
    if (!declaredTypes.has(name) && (!prefix || /(?:\.|=|->|\bnew\b|\breturn\b)/.test(prefix))) continue;
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    const isMain = name === "main" && /\bstatic\b/.test(prefix) && /\bvoid\b/.test(prefix);
    const kind = isMain ? "main" : declaredTypes.has(name) ? "constructor" : "method";
    const signature = match[0]
      .slice(0, match[0].lastIndexOf("{"))
      .replace(/\s+/g, " ")
      .trim();
    ranges.push({ name, kind, signature, start: match.index, end: close + 1 });
  }
  return ranges;
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

/** Replaces comments and literal contents with spaces while preserving offsets. */
function maskJava(source) {
  const result = source.split("");
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n" || char === "\r") state = "code";
      else result[index] = " ";
    } else if (state === "block") {
      result[index] = " ";
      if (char === "*" && next === "/") {
        result[index + 1] = " ";
        index += 1;
        state = "code";
      }
    } else if (state === "string" || state === "character") {
      result[index] = " ";
      if (char === "\\") {
        if (index + 1 < source.length) result[++index] = " ";
      } else if ((state === "string" && char === '"') || (state === "character" && char === "'")) {
        state = "code";
      }
    } else if (char === "/" && next === "/") {
      result[index] = result[index + 1] = " ";
      index += 1;
      state = "line";
    } else if (char === "/" && next === "*") {
      result[index] = result[index + 1] = " ";
      index += 1;
      state = "block";
    } else if (char === '"') {
      result[index] = " ";
      state = "string";
    } else if (char === "'") {
      result[index] = " ";
      state = "character";
    }
  }
  return result.join("");
}

/** Removes only comments/formatting, retaining literal values as code changes. */
function javaWithoutTrivia(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n" || char === "\r") state = "code";
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        index += 1;
        state = "code";
      }
    } else if (state === "string" || state === "character") {
      result += char;
      if (char === "\\" && index + 1 < source.length) result += source[++index];
      else if ((state === "string" && char === '"') || (state === "character" && char === "'")) state = "code";
    } else if (char === "/" && next === "/") {
      index += 1;
      state = "line";
    } else if (char === "/" && next === "*") {
      index += 1;
      state = "block";
    } else if (char === '"') {
      result += char;
      state = "string";
    } else if (char === "'") {
      result += char;
      state = "character";
    } else if (!/\s/.test(char)) {
      result += char;
    }
  }
  return result;
}

function debugVmArgs(config, project, port, classpath, qualifiedName) {
  return [
    ...splitArgs(config?.vmArgs || ""),
    ...(project?.previewFeatures ? ["--enable-preview"] : []),
    `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:${port}`,
    "-cp", classpath,
    qualifiedName,
    ...splitArgs(config?.programArgs || ""),
  ];
}

function encode(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function decode(value) {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function waitForDebugger(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Die Java-Debug-VM konnte nicht rechtzeitig gestartet werden."));
    }, timeoutMs);
    const onData = (data) => {
      if (/Listening for transport dt_socket/i.test(data.toString())) {
        cleanup();
        resolve();
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Die Java-Debug-VM wurde vor dem Start beendet."));
    };
    const onError = (error) => {
      cleanup();
      reject(new Error(`Die Java-Debug-VM konnte nicht gestartet werden: ${error.message}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      child.stdout.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
    };
    child.stderr.on("data", onData);
    child.stdout.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });
}

module.exports = {
  DebugService,
  debugVmArgs,
  normalizeHotReplaceRequest,
  smartHotSwapRequiresRelaunch,
};
