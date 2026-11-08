const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * What the compiler made of a class.
 *
 * `javap` ships with every JDK, so nothing is bundled and nothing is parsed
 * here beyond finding the tool and giving it a classpath. The reading of its
 * answer lives in the renderer, where the result is shown.
 *
 * The classpath comes from the language server, which already knows it — it
 * resolves one per source file for exactly this kind of question, and building
 * a second one out of guesses about target/classes would disagree with it the
 * first time a project had two modules.
 */
class BytecodeService {
  constructor(pathGuard, projects, language) {
    this.pathGuard = pathGuard;
    this.projects = projects;
    this.language = language;
  }

  /**
   * Disassembles one class.
   *
   * Answers stdout and stderr rather than judging them: which of javap's
   * failures is worth reporting, and how, is a question about what the reader
   * can do next.
   */
  async disassemble(root, binaryName, sourceFile = "") {
    root = this.pathGuard.assertWorkspace(root);
    const name = String(binaryName || "").trim();
    if (!name) return { stdout: "", stderr: "Kein Klassenname angegeben.", tool: "" };

    const jdk = await this.projects.detectJdk(root);
    if (!jdk?.available) {
      return { stdout: "", stderr: "Kein JDK gefunden. Wähle eines unter Einstellungen › Java & SDKs.", tool: "" };
    }
    const javap = jdk.path
      ? path.join(jdk.path, "bin", process.platform === "win32" ? "javap.exe" : "javap")
      : process.platform === "win32" ? "javap.exe" : "javap";

    // The language server resolved this project's classpath already; without
    // one javap finds only what is on the JDK's own path.
    const entries = await this.language?.runtimeClasspath?.(root, sourceFile).catch(() => null);
    const classpath = [...new Set([
      ...(Array.isArray(entries) ? entries : entries?.classpath || []),
      // The usual output directories, for a project the server has not
      // answered for yet. Harmless when they do not exist.
      path.join(root, "target", "classes"),
      path.join(root, "target", "test-classes"),
      path.join(root, "build", "classes", "java", "main"),
      path.join(root, "build", "classes", "java", "test"),
    ])].filter(Boolean);

    const args = ["-c", "-p", "-l", "-cp", classpath.join(path.delimiter), name];
    const result = await run(javap, args, root);
    return { ...result, tool: javap };
  }

  /** Whether anything on the classpath could hold this class yet. */
  async isCompiled(root, binaryName) {
    root = this.pathGuard.assertWorkspace(root);
    const relative = `${String(binaryName || "").replace(/\./g, path.sep)}.class`;
    const candidates = [
      path.join(root, "target", "classes", relative),
      path.join(root, "build", "classes", "java", "main", relative),
    ];
    for (const candidate of candidates) {
      if (await fs.stat(candidate).then(() => true).catch(() => false)) return true;
    }
    return false;
  }
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ stdout: "", stderr: String(error?.message || error) });
      return;
    }
    // Bounded: a classpath with a thousand entries can make javap think for a
    // while, and a window waiting for ever on a disassembly is worse than one
    // that says it gave up.
    const timer = setTimeout(() => {
      try { child.kill(); } catch { }
      resolve({ stdout, stderr: stderr || "javap hat nicht rechtzeitig geantwortet." });
    }, 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: String(error?.message || error) });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
  });
}

module.exports = { BytecodeService };
