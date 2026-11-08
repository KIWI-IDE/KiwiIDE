const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnCapture } = require("./process-utils.cjs");

// These servers run on the Node runtime already carried by Electron. Other
// language servers use their toolchain's installer, linked in the settings.
const PACKAGES = Object.freeze({
  python: "pyright",
  php: "intelephense",
  typescript: "typescript-language-server",
  javascript: "typescript-language-server",
  shell: "bash-language-server",
  bash: "bash-language-server",
  sql: "sql-language-server",
  dockerfile: "dockerfile-language-server-nodejs",
  yaml: "yaml-language-server",
});
const queues = new Map();

async function isManagedLanguageServerInstalled(languageId, directory) {
  const packageName = Object.hasOwn(PACKAGES, languageId) ? PACKAGES[languageId] : "";
  if (!packageName) return false;
  const pkgJson = path.join(path.resolve(directory), "node_modules", packageName, "package.json");
  try {
    await fs.access(pkgJson);
    return true;
  } catch {
    return false;
  }
}

async function installManagedLanguageServer(languageId, directory, options = {}) {
  const packageName = Object.hasOwn(PACKAGES, languageId) ? PACKAGES[languageId] : "";
  if (!packageName) throw new Error("Für diese Sprache nutze bitte die verlinkte Installationsanleitung.");
  const root = path.resolve(directory);
  if (options.skipIfInstalled && await isManagedLanguageServerInstalled(languageId, root)) {
    return { installed: true, cached: true };
  }
  const previous = queues.get(root) || Promise.resolve();
  const installation = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(root, { recursive: true });
    const manifest = path.join(root, "package.json");
    try { await fs.access(manifest); } catch {
      await fs.writeFile(manifest, JSON.stringify({ name: "kiwi-language-servers", private: true }, null, 2));
    }
    const run = options.run || spawnCapture;
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    try {
      const result = await run(npm, [
        "install", "--prefix", root, "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", packageName,
      ], { cwd: root, timeoutMs: 180_000 });
      if (result.code !== 0) throw new Error(result.stderr || result.output || "npm install fehlgeschlagen.");
      return { installed: true };
    } catch (error) {
      return {
        installed: false,
        reason: `Sprachserver konnte nicht installiert werden. Node.js mit npm und eine Internetverbindung werden benötigt. ${error.message || error}`,
      };
    }
  });
  queues.set(root, installation);
  try { return await installation; } finally {
    if (queues.get(root) === installation) queues.delete(root);
  }
}

/**
 * Automatically installs language servers for all supported languages.
 * Installs managed npm packages and detects native package managers (rustup, go, dotnet).
 */
async function installAllLanguageServers(directory, options = {}) {
  const root = path.resolve(directory);
  const run = options.run || spawnCapture;
  const results = {};

  // 1. Managed npm language servers
  const npmLangs = ["typescript", "javascript", "python", "php", "shell", "sql"];
  for (const lang of npmLangs) {
    try {
      results[lang] = await installManagedLanguageServer(lang, root, options);
    } catch (err) {
      results[lang] = { installed: false, reason: err.message || String(err) };
    }
  }

  // 2. Rust (rust-analyzer via rustup)
  try {
    const checkRust = await run("rustup", ["--version"], { timeoutMs: 5_000 });
    if (checkRust.code === 0) {
      const rustRes = await run("rustup", ["component", "add", "rust-analyzer"], { timeoutMs: 120_000 });
      results.rust = {
        installed: rustRes.code === 0,
        reason: rustRes.code === 0 ? undefined : rustRes.stderr || "rustup component add fehlgeschlagen",
      };
    } else {
      results.rust = { installed: false, reason: "rustup nicht gefunden." };
    }
  } catch {
    results.rust = { installed: false, reason: "rustup nicht im PATH gefunden." };
  }

  // 3. Go (gopls via go install)
  try {
    const checkGo = await run("go", ["version"], { timeoutMs: 5_000 });
    if (checkGo.code === 0) {
      const goRes = await run("go", ["install", "golang.org/x/tools/gopls@latest"], { timeoutMs: 180_000 });
      results.go = {
        installed: goRes.code === 0,
        reason: goRes.code === 0 ? undefined : goRes.stderr || "go install gopls fehlgeschlagen",
      };
    } else {
      results.go = { installed: false, reason: "Go-Compiler nicht gefunden." };
    }
  } catch {
    results.go = { installed: false, reason: "go nicht im PATH gefunden." };
  }

  // 4. C# (csharp-ls via dotnet tool)
  try {
    const checkDotnet = await run("dotnet", ["--version"], { timeoutMs: 5_000 });
    if (checkDotnet.code === 0) {
      const dotnetRes = await run("dotnet", ["tool", "install", "--global", "csharp-ls"], { timeoutMs: 120_000 });
      results.csharp = {
        installed: dotnetRes.code === 0 || String(dotnetRes.stderr || "").includes("already installed"),
        reason: dotnetRes.code === 0 ? undefined : dotnetRes.stderr || "dotnet tool install fehlgeschlagen",
      };
    } else {
      results.csharp = { installed: false, reason: ".NET SDK nicht gefunden." };
    }
  } catch {
    results.csharp = { installed: false, reason: "dotnet nicht im PATH gefunden." };
  }

  return {
    total: Object.keys(results).length,
    installed: Object.values(results).filter((r) => r.installed).length,
    results,
  };
}

module.exports = { installManagedLanguageServer, installAllLanguageServers, PACKAGES };
