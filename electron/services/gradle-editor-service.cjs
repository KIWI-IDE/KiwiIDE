const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnCapture, terminateProcessTree } = require("./process-utils.cjs");

class GradleEditorService {
  constructor(guard, projects, builds, dependencies, send = () => undefined, run = spawnCapture) {
    Object.assign(this, { guard, projects, builds, dependencies, send, run });
    this.states = new Map(); this.jobs = new Map(); this.children = new Set(); this.stopped = false;
  }

  async fingerprint(root) {
    const model = await this.dependencies.collect(root);
    if (model.type !== "Gradle") throw new Error("Dieses Projekt verwendet kein Gradle.");
    const hash = crypto.createHash("sha256");
    for (const file of [...model.files, ...model.catalogs]) hash.update(file.file || file.path).update(file.source);
    for (const name of ["settings.gradle.kts", "settings.gradle", "gradle.properties", "gradle/wrapper/gradle-wrapper.properties", ".kiwi/project.json"]) {
      const file = path.join(root, name); this.guard.assertAllowed(file, root);
      hash.update(name).update(await fs.readFile(file).catch(error => { if (error.code === "ENOENT") return ""; throw error; }));
    }
    return hash.digest("hex");
  }

  publish(root, state) { this.states.set(root, state); this.send("gradle:editorModel", { root, ...state }); return state; }

  async get(root, refresh = false) {
    root = this.guard.assertWorkspace(root);
    const fingerprint = await this.fingerprint(root);
    let state = this.states.get(root);
    if (!state) {
      const file = this.guard.assertAllowed(path.join(root, ".kiwi", "gradle-editor-model.json"), root);
      try {
        const saved = JSON.parse(await fs.readFile(file, "utf8"));
        if (saved.model?.schema === 1 && Array.isArray(saved.model.projects)) state = { ...saved, state: "ready", reason: "" };
      } catch { /* No previously imported model. */ }
    }
    if (!refresh && state?.fingerprint === fingerprint && state.state === "ready") { this.states.set(root, state); return state; }
    if (!refresh && state?.fingerprint === fingerprint && state.state === "error" && Date.now() - state.updatedAt < 15_000) return state;
    if (!this.jobs.has(root) && !this.stopped) {
      const pending = { ...state, fingerprint, state: "loading", reason: "Gradle-Projektmodell wird geladen.", model: state?.model || null, updatedAt: Date.now() };
      this.publish(root, pending);
      const job = Promise.resolve().then(() => this.import(root, fingerprint, pending.model)).finally(() => this.jobs.delete(root));
      this.jobs.set(root, job);
    }
    return this.states.get(root);
  }

  async import(root, fingerprint, previous) {
    try {
      const project = await this.projects.detect(root);
      const jdk = await this.projects.detectJdk(root);
      if (!jdk.available) throw new Error("Für das Gradle-Projektmodell fehlt ein JDK. Bitte wähle ein JDK in den Einstellungen.");
      const command = this.builds.resolveBuildTool(root, "Gradle", project.preferWrapper !== false);
      const task = `_kiwiEditorModel_${crypto.randomBytes(5).toString("hex")}`;
      const args = [task, "--init-script", path.join(__dirname, "gradle-editor-model.gradle"), `-Dkiwi.editor.task=${task}`, "--console=plain", "--no-daemon", "--no-configuration-cache", ...(project.gradleOffline ? ["--offline"] : [])];
      let child;
      const result = await this.run(command, args, {
        cwd: root, timeoutMs: 120_000,
        env: { ...process.env, JAVA_HOME: jdk.path, PATH: `${path.join(jdk.path, "bin")}${path.delimiter}${process.env.PATH || ""}` },
        onSpawn: value => { child = value; this.children.add(value); if (this.stopped) void terminateProcessTree(value); },
      }).finally(() => this.children.delete(child));
      if (this.stopped) return;
      const payload = result.stdout?.split(/\r?\n/).find(line => line.startsWith("KIWI_GRADLE_MODEL:"));
      if (result.code !== 0 || !payload) throw new Error("Gradle konnte das Projektmodell nicht laden. Prüfe die Build-Fehler im Build-Fenster und synchronisiere das Projekt erneut.");
      const model = JSON.parse(payload.slice("KIWI_GRADLE_MODEL:".length));
      if (model.schema !== 1 || !Array.isArray(model.projects) || !model.types || typeof model.types !== "object") throw new Error("Gradle hat ein ungültiges Projektmodell geliefert.");
      if (await this.fingerprint(root) !== fingerprint) {
        this.publish(root, { state: "outdated", model: previous, fingerprint: "", reason: "Die Builddateien wurden während der Synchronisierung geändert.", updatedAt: Date.now() });
        return;
      }
      const state = { state: "ready", model, fingerprint, reason: "", updatedAt: Date.now() };
      const directory = this.guard.assertAllowed(path.join(root, ".kiwi"), root);
      await fs.mkdir(directory, { recursive: true });
      const file = this.guard.assertAllowed(path.join(directory, "gradle-editor-model.json"), root);
      const temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(state)); await fs.rename(temporary, file); }
      finally { await fs.unlink(temporary).catch(() => undefined); }
      if (!this.stopped) this.publish(root, state);
    } catch (error) {
      if (!this.stopped) this.publish(root, { state: "error", model: previous, fingerprint, reason: error.message, updatedAt: Date.now() });
    }
  }

  async shutdown() { this.stopped = true; await Promise.allSettled([...this.children].map(terminateProcessTree)); }
}
module.exports = { GradleEditorService };
