const fs = require("node:fs");
const path = require("node:path");

class PathGuard {
  constructor() {
    this.roots = new Map();
  }

  normalize(candidate) {
    if (!candidate || typeof candidate !== "string") throw new Error("Ungültiger Dateipfad.");
    const resolved = path.resolve(candidate);
    return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
  }

  register(root) {
    const resolved = path.resolve(root);
    const real = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
    this.roots.set(this.normalize(real), real);
    return real;
  }

  unregister(root) {
    this.roots.delete(this.normalize(root));
  }

  clear() {
    this.roots.clear();
  }

  isRegistered(root) {
    return this.roots.has(this.normalize(root));
  }

  assertWorkspace(root) {
    if (!this.isRegistered(root)) throw new Error("Der Projektordner ist nicht registriert.");
    return this.roots.get(this.normalize(root));
  }

  workspaceFor(candidate) {
    if (!candidate || typeof candidate !== "string") throw new Error("Ungültiger Dateipfad.");
    const resolved = path.resolve(candidate);
    const matched = [...this.roots.values()].find((root) => this.isInside(resolved, root));
    if (!matched) throw new Error("Der Pfad gehört zu keinem geöffneten Projekt.");
    return matched;
  }

  isInside(candidate, root) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  assertAllowed(candidate, root) {
    if (!candidate || typeof candidate !== "string") throw new Error("Ungültiger Dateipfad.");
    const resolved = path.resolve(candidate);
    const roots = root ? [this.assertWorkspace(root)] : [...this.roots.values()];
    const matchedRoot = roots.find((allowedRoot) => this.isInside(resolved, allowedRoot));
    if (!matchedRoot) throw new Error("Zugriff außerhalb des geöffneten Projekts wurde blockiert.");

    const existingParent = fs.existsSync(resolved) ? resolved : path.dirname(resolved);
    if (fs.existsSync(existingParent)) {
      const realParent = fs.realpathSync.native(existingParent);
      if (!this.isInside(realParent, matchedRoot)) {
        throw new Error("Symbolische Verknüpfungen außerhalb des Projekts sind nicht erlaubt.");
      }
    }
    return resolved;
  }
}

module.exports = { PathGuard };
