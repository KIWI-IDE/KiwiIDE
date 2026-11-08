const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * The templates a project brings with it.
 *
 * Kept beside the project rather than in the machine's settings, so they are
 * committed with it and everybody working on it has them. The file is handed
 * back as text: what a template means is the renderer's business, and a file
 * somebody typed by hand has to survive being unreadable long enough for the
 * problem to be shown rather than swallowed.
 */
class TemplateService {
  constructor(pathGuard) {
    this.pathGuard = pathGuard;
  }

  file(root) {
    this.pathGuard.assertWorkspace(root);
    return path.join(root, ".kiwi", "templates.json");
  }

  async read(root) {
    const file = this.file(root);
    try {
      return { path: file, text: await fs.readFile(file, "utf8"), exists: true };
    } catch {
      // A project without the file is the ordinary case, not a failure.
      return { path: file, text: "", exists: false };
    }
  }

  async write(root, text) {
    const file = this.file(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(text ?? ""), "utf8");
    return { path: file, text: String(text ?? ""), exists: true };
  }
}

module.exports = { TemplateService };
