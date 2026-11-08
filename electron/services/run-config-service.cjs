const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const allowedTypes = new Set(["java", "junit", "maven", "gradle", "docker", "compose", "compound"]);

class RunConfigService {
  constructor(pathGuard) {
    this.pathGuard = pathGuard;
  }

  file(root) {
    this.pathGuard.assertWorkspace(root);
    return path.join(root, ".kiwi", "run-configurations.json");
  }

  async list(root) {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file(root), "utf8"));
      return Array.isArray(parsed.configurations) ? parsed.configurations : [];
    } catch {
      return [];
    }
  }

  async save(root, configuration) {
    if (!allowedTypes.has(configuration.type)) throw new Error("Unbekannter Run-Konfigurationstyp.");
    if (!String(configuration.name || "").trim()) throw new Error("Die Run-Konfiguration benötigt einen Namen.");
    const configurations = await this.list(root);
    const next = {
      id: configuration.id || crypto.randomUUID(),
      name: String(configuration.name).trim(),
      type: configuration.type,
      mainClass: String(configuration.mainClass || ""),
      target: String(configuration.target || ""),
      programArgs: String(configuration.programArgs || ""),
      vmArgs: String(configuration.vmArgs || ""),
      workingDirectory: String(configuration.workingDirectory || root),
      jdkPath: String(configuration.jdkPath || ""),
      projectRoot: root,
      moduleId: String(configuration.moduleId || ""),
      env: Object.fromEntries(Object.entries(configuration.env || {}).map(([key, value]) => [key, String(value)])),
      favorite: Boolean(configuration.favorite),
      group: String(configuration.group || "").trim(),
      // Only a compound has members, and only ids of configurations are kept:
      // a whole configuration copied in here would go stale the moment the
      // original changed.
      ...(configuration.type === "compound"
        ? {
            members: (Array.isArray(configuration.members) ? configuration.members : [])
              .map((member) => ({ id: String(member?.id || "") }))
              .filter((member) => member.id),
            compoundMode: configuration.compoundMode === "parallel" ? "parallel" : "sequential",
          }
        : {}),
    };
    const index = configurations.findIndex((item) => item.id === next.id);
    if (index >= 0) configurations[index] = next;
    else configurations.push(next);
    const file = this.file(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ version: 1, configurations }, null, 2)}\n`, "utf8");
    return next;
  }

  async delete(root, id) {
    const configurations = (await this.list(root)).filter((item) => item.id !== id);
    const file = this.file(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ version: 1, configurations }, null, 2)}\n`, "utf8");
    return true;
  }
}

module.exports = { RunConfigService };
