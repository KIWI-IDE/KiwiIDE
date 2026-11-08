const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const defaults = {
  recentFiles: [],
  favorites: [],
  bookmarks: [],
  terminalTasks: [],
};

class WorkflowService {
  constructor(pathGuard) {
    this.pathGuard = pathGuard;
  }

  file(root) {
    root = this.pathGuard.assertWorkspace(root);
    return path.join(root, ".kiwi", "workflow.json");
  }

  async get(root) {
    root = this.pathGuard.assertWorkspace(root);
    try {
      return normalizeState(root, JSON.parse(await fs.readFile(this.file(root), "utf8")), this.pathGuard);
    } catch {
      return structuredClone(defaults);
    }
  }

  async update(root, patch) {
    root = this.pathGuard.assertWorkspace(root);
    const current = await this.get(root);
    const next = normalizeState(root, { ...current, ...(patch || {}) }, this.pathGuard);
    const file = this.file(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`, "utf8");
    return next;
  }

  async rememberFile(root, file) {
    root = this.pathGuard.assertWorkspace(root);
    file = this.pathGuard.assertAllowed(file, root);
    const current = await this.get(root);
    return this.update(root, {
      recentFiles: [file, ...current.recentFiles.filter((candidate) => !samePath(candidate, file))].slice(0, 40),
    });
  }

  async createScratch(root, requestedName = "Scratch.java") {
    root = this.pathGuard.assertWorkspace(root);
    const clean = String(requestedName || "Scratch.java").trim().replace(/\.java$/i, "");
    if (!/^[A-Za-z_$][\w$]*$/.test(clean)) throw new Error("Ungültiger Scratch-Name.");
    const directory = path.join(root, ".kiwi", "scratches");
    await fs.mkdir(directory, { recursive: true });
    let index = 1;
    let file = path.join(directory, `${clean}.java`);
    while (await exists(file)) {
      index += 1;
      file = path.join(directory, `${clean}${index}.java`);
    }
    const typeName = path.basename(file, ".java");
    await fs.writeFile(
      file,
      `class ${typeName} {\n    public static void main(String[] args) {\n        System.out.println("Scratch");\n    }\n}\n`,
      "utf8",
    );
    await this.rememberFile(root, file);
    return file;
  }
}

function normalizeState(root, raw, pathGuard) {
  const paths = (values, limit) => [...new Set((Array.isArray(values) ? values : [])
    .filter((candidate) => {
      try {
        pathGuard.assertAllowed(candidate, root);
        return true;
      } catch {
        return false;
      }
    }))].slice(0, limit);
  return {
    recentFiles: paths(raw.recentFiles, 40),
    favorites: paths(raw.favorites, 80),
    bookmarks: (Array.isArray(raw.bookmarks) ? raw.bookmarks : [])
      .filter((item) => item && typeof item.path === "string" && Number(item.line) > 0)
      .filter((item) => {
        try {
          pathGuard.assertAllowed(item.path, root);
          return true;
        } catch {
          return false;
        }
      })
      .map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        path: path.resolve(item.path),
        line: Math.max(1, Number(item.line)),
        label: String(item.label || path.basename(item.path)),
      }))
      .slice(0, 100),
    terminalTasks: (Array.isArray(raw.terminalTasks) ? raw.terminalTasks : [])
      .filter((item) => item && String(item.command || "").trim())
      .map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        name: String(item.name || item.command).trim().slice(0, 80),
        command: String(item.command).trim(),
      }))
      .slice(0, 50),
  };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

module.exports = { WorkflowService, defaults };
