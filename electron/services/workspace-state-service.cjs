const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

class WorkspaceStateService {
  constructor(userDataPath, settings) {
    this.file = path.join(userDataPath, "workspace-state.json");
    this.settings = settings;
    this.state = { version: 3, projects: [], resumableProjects: [], activeRoot: null, profiles: [] };
  }

  async load() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.file, "utf8"));
      const projects = Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProject).filter(Boolean) : [];
      const resumableProjects = Array.isArray(parsed.resumableProjects)
        ? parsed.resumableProjects.map(normalizeProject).filter(Boolean)
        : [];
      for (const project of projects) upsertProject(resumableProjects, project);
      for (const root of this.settings.get().recentProjects || []) {
        if (!resumableProjects.some((project) => samePath(project.root, root))) {
          resumableProjects.push(projectEntry(root, ""));
        }
      }
      this.state = {
        version: 3,
        projects,
        resumableProjects,
        activeRoot: typeof parsed.activeRoot === "string" ? path.resolve(parsed.activeRoot) : null,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles.map(normalizeProfile).filter(Boolean) : [],
      };
      await this.persist();
    } catch {
      const legacy = this.settings.get().lastWorkspace;
      const recent = (this.settings.get().recentProjects || [])
        .filter((root) => typeof root === "string")
        .map((root) => projectEntry(root, ""));
      const projects = legacy && fs.existsSync(legacy) ? [projectEntry(legacy)] : [];
      for (const project of projects) upsertProject(recent, project);
      this.state = {
        version: 3,
        projects,
        resumableProjects: recent,
        activeRoot: legacy && fs.existsSync(legacy) ? path.resolve(legacy) : null,
        profiles: [],
      };
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      version: 3,
      projects: this.state.projects.map((project) => ({
        ...project,
        name: project.label || project.name,
        exists: fs.existsSync(project.root),
      })),
      resumableProjects: this.state.resumableProjects.map((project) => ({
        ...project,
        name: project.label || project.name,
        exists: fs.existsSync(project.root),
      })),
      activeRoot: this.state.activeRoot,
      profiles: this.state.profiles.map((profile) => ({ ...profile, roots: [...profile.roots] })),
    };
  }

  async add(roots, activate = true) {
    const now = new Date().toISOString();
    for (const candidate of roots || []) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const root = fs.realpathSync.native(path.resolve(candidate));
      const current = this.state.projects.find((project) => samePath(project.root, root));
      const remembered = this.state.resumableProjects.find((project) => samePath(project.root, root));
      if (current) {
        current.lastOpenedAt = now;
        current.name = path.basename(root);
        current.pinned = remembered?.pinned ?? current.pinned;
      } else {
        const project = projectEntry(root, now);
        project.pinned = remembered?.pinned || false;
        this.state.projects.push(project);
      }
      upsertProject(this.state.resumableProjects, this.state.projects.find((project) => samePath(project.root, root)));
      await this.settings.rememberWorkspace(root);
      if (activate) this.state.activeRoot = root;
    }
    if (!this.state.activeRoot && this.state.projects.length) {
      this.state.activeRoot = this.state.projects.find((item) => fs.existsSync(item.root))?.root || null;
    }
    await this.persist();
    return this.snapshot();
  }

  async activate(root) {
    const project = this.state.projects.find((item) => samePath(item.root, root));
    if (!project || !fs.existsSync(project.root)) throw new Error("Das Projekt ist nicht mehr verfügbar.");
    project.lastOpenedAt = new Date().toISOString();
    upsertProject(this.state.resumableProjects, project);
    this.state.activeRoot = project.root;
    await this.settings.rememberWorkspace(project.root);
    await this.persist();
    return this.snapshot();
  }

  /**
   * A name of one's own for a project.
   *
   * The folder is left where it is. Two checkouts of the same repository are
   * two folders called the same thing, and telling those apart in a list is
   * what this is for. The folder's name stays in `name` underneath, so an
   * empty name hands it straight back.
   */
  async rename(root, label) {
    const typed = String(label == null ? "" : label).trim().slice(0, 80);
    // Typing the folder's own name back is how one stops having a chosen name:
    // the dialog will not take an empty field, and storing a name identical to
    // the folder's would only be a copy that stops following it.
    const wanted = sameName(typed, path.basename(path.resolve(root))) ? "" : typed;
    let found = false;
    for (const list of [this.state.projects, this.state.resumableProjects]) {
      const project = list.find((item) => samePath(item.root, root));
      if (!project) continue;
      found = true;
      if (wanted) project.label = wanted;
      else delete project.label;
    }
    if (!found) throw new Error("Das Projekt steht nicht in der Liste.");
    await this.persist();
    return this.snapshot();
  }

  async remove(root) {
    this.state.projects = this.state.projects.filter((item) => !samePath(item.root, root));
    this.state.resumableProjects = this.state.resumableProjects.filter((item) => !samePath(item.root, root));
    if (this.state.activeRoot && samePath(this.state.activeRoot, root)) {
      this.state.activeRoot = this.state.projects.find((item) => fs.existsSync(item.root))?.root || null;
    }
    await this.settings.forgetWorkspace?.(root);
    await this.persist();
    return this.snapshot();
  }

  async closeAll() {
    for (const project of this.state.projects) upsertProject(this.state.resumableProjects, project);
    this.state = { ...this.state, version: 3, projects: [], activeRoot: null };
    await this.persist();
    return this.snapshot();
  }

  async recoverRecent(roots) {
    const currentSettings = this.settings.get();
    if (currentSettings.workspaceHistoryMigrated) return this.snapshot();

    const recovered = [];
    for (const candidate of Array.isArray(roots) ? roots : []) {
      if (typeof candidate !== "string" || !candidate.trim() || !path.isAbsolute(candidate)) continue;
      const root = path.resolve(candidate);
      if (recovered.some((item) => samePath(item, root))) continue;
      recovered.push(root);
      if (!this.state.resumableProjects.some((project) => samePath(project.root, root))) {
        this.state.resumableProjects.push(projectEntry(root, ""));
      }
    }

    const recentProjects = [];
    for (const root of [...recovered, ...(currentSettings.recentProjects || [])]) {
      if (typeof root !== "string" || !root.trim() || !path.isAbsolute(root)) continue;
      if (!recentProjects.some((item) => samePath(item, root))) recentProjects.push(path.resolve(root));
    }
    await this.settings.update({
      workspaceHistoryMigrated: true,
      recentProjects: recentProjects.slice(0, 12),
      lastWorkspace: currentSettings.lastWorkspace || recovered[0] || "",
    });
    await this.persist();
    return this.snapshot();
  }

  async setPinned(root, pinned) {
    let recent = this.state.resumableProjects.find((item) => samePath(item.root, root));
    if (!recent) {
      recent = projectEntry(root, "");
      this.state.resumableProjects.push(recent);
    }
    recent.pinned = Boolean(pinned);
    const project = this.state.projects.find((item) => samePath(item.root, root));
    if (project) project.pinned = recent.pinned;
    await this.persist();
    return this.snapshot();
  }

  async saveProfile(name) {
    name = String(name || "").trim();
    if (!name) throw new Error("Der Workspace benötigt einen Namen.");
    const roots = this.state.projects.map((project) => project.root);
    if (!roots.length) throw new Error("Der Workspace enthält keine Projekte.");
    const current = this.state.profiles.find((profile) => profile.name.toLowerCase() === name.toLowerCase());
    if (current) {
      current.roots = roots;
      current.activeRoot = this.state.activeRoot;
      current.updatedAt = new Date().toISOString();
    } else {
      this.state.profiles.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        roots,
        activeRoot: this.state.activeRoot,
        updatedAt: new Date().toISOString(),
      });
    }
    await this.persist();
    return this.snapshot();
  }

  async openProfile(id) {
    const profile = this.state.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Der gespeicherte Workspace wurde nicht gefunden.");
    const roots = profile.roots.filter((root) => fs.existsSync(root));
    this.state.projects = roots.map((root) => {
      const project = projectEntry(root);
      const remembered = this.state.resumableProjects.find((item) => samePath(item.root, project.root));
      if (remembered?.label) project.label = remembered.label;
      return project;
    });
    for (const project of this.state.projects) upsertProject(this.state.resumableProjects, project);
    this.state.activeRoot = roots.find((root) => samePath(root, profile.activeRoot)) || roots[0] || null;
    profile.updatedAt = new Date().toISOString();
    await this.persist();
    return this.snapshot();
  }

  async deleteProfile(id) {
    this.state.profiles = this.state.profiles.filter((profile) => profile.id !== id);
    await this.persist();
    return this.snapshot();
  }

  async persist() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}

function projectEntry(root, timestamp = new Date().toISOString()) {
  const resolved = path.resolve(root);
  return {
    root: resolved,
    name: path.basename(resolved),
    addedAt: timestamp,
    lastOpenedAt: timestamp,
    pinned: false,
  };
}

function normalizeProject(project) {
  if (!project || typeof project.root !== "string") return null;
  const entry = projectEntry(project.root, project.addedAt);
  entry.name = String(project.name || entry.name);
  entry.lastOpenedAt = String(project.lastOpenedAt || entry.addedAt);
  entry.pinned = Boolean(project.pinned);
  if (typeof project.label === "string" && project.label.trim()) entry.label = project.label.trim();
  return entry;
}

function normalizeProfile(profile) {
  if (!profile || typeof profile.name !== "string" || !Array.isArray(profile.roots)) return null;
  return {
    id: String(profile.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name: profile.name.trim() || "Workspace",
    roots: profile.roots.filter((root) => typeof root === "string").map((root) => path.resolve(root)),
    activeRoot: typeof profile.activeRoot === "string" ? path.resolve(profile.activeRoot) : null,
    updatedAt: String(profile.updatedAt || new Date().toISOString()),
  };
}

function upsertProject(projects, project) {
  if (!project) return;
  const current = projects.find((item) => samePath(item.root, project.root));
  if (current) Object.assign(current, project);
  else projects.push({ ...project });
}

function samePath(left, right) {
  // Profiles and legacy state files can carry a null activeRoot; path.resolve
  // would throw on it and take the whole workspace snapshot down.
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLocaleLowerCase() === b.toLocaleLowerCase()
    : a === b;
}

/** Two names the file system would not tell apart on this platform. */
function sameName(left, right) {
  return process.platform === "win32"
    ? String(left).toLocaleLowerCase() === String(right).toLocaleLowerCase()
    : String(left) === String(right);
}

module.exports = { WorkspaceStateService, samePath };
