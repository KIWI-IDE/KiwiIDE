const { spawnCapture } = require("./process-utils.cjs");

class DockerService {
  constructor(guard, options = {}) {
    this.guard = guard;
    this.run = options.run || spawnCapture;
  }

  async checkInstalled() {
    try {
      const result = await this.run("docker", ["--version"]);
      return { available: result.code === 0, version: (result.stdout || "").trim() };
    } catch {
      return { available: false, version: "" };
    }
  }

  async listContainers(all = true) {
    try {
      const args = ["ps", "--format", "{{json .}}"];
      if (all) args.push("-a");
      const result = await this.run("docker", args);
      if (result.code !== 0) return [];
      const lines = (result.stdout || "").split(/\r?\n/).filter(Boolean);
      return lines.map((line) => {
        try {
          const item = JSON.parse(line);
          return {
            id: item.ID || item.Id || "",
            names: item.Names || "",
            image: item.Image || "",
            status: item.Status || "",
            state: item.State || (item.Status && item.Status.startsWith("Up") ? "running" : "exited"),
            ports: item.Ports || "",
            created: item.CreatedAt || item.RunningFor || "",
          };
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async listImages() {
    try {
      const result = await this.run("docker", ["images", "--format", "{{json .}}"]);
      if (result.code !== 0) return [];
      const lines = (result.stdout || "").split(/\r?\n/).filter(Boolean);
      return lines.map((line) => {
        try {
          const item = JSON.parse(line);
          return {
            id: item.ID || "",
            repository: item.Repository || "",
            tag: item.Tag || "",
            size: item.Size || "",
            created: item.CreatedSince || item.CreatedAt || "",
          };
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async containerAction(containerId, action) {
    const valid = ["start", "stop", "restart", "rm", "pause", "unpause"];
    if (!valid.includes(action)) throw new Error(`Ungültige Docker-Aktion: ${action}`);
    const id = String(containerId || "").trim();
    if (!id || /[^A-Za-z0-9_-]/.test(id)) throw new Error("Ungültige Container-ID.");

    const result = await this.run("docker", [action, id]);
    return { success: result.code === 0, output: result.stdout || result.stderr };
  }

  async composeAction(root, action) {
    if (this.guard) root = this.guard.assertWorkspace(root);
    const valid = ["up", "down", "restart", "ps", "build"];
    if (!valid.includes(action)) throw new Error(`Ungültige Compose-Aktion: ${action}`);

    const args = ["compose"];
    if (action === "up") args.push("up", "-d");
    else args.push(action);

    const result = await this.run("docker", args, { cwd: root });
    return { success: result.code === 0, output: result.stdout || result.stderr };
  }
}

module.exports = { DockerService };
