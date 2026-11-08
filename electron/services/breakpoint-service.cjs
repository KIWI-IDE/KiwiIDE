const fs = require("node:fs/promises");
const path = require("node:path");

class BreakpointService {
  constructor(pathGuard) {
    this.pathGuard = pathGuard;
  }

  file(root) {
    this.pathGuard.assertWorkspace(root);
    return path.join(root, ".kiwi", "breakpoints.json");
  }

  async list(root) {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file(root), "utf8"));
      return Array.isArray(parsed.breakpoints) ? parsed.breakpoints : [];
    } catch {
      return [];
    }
  }

  async save(root, breakpoints) {
    const normalized = (Array.isArray(breakpoints) ? breakpoints : [])
      // The guard starts at "is this an object at all": this filter exists to
      // drop what is not a breakpoint, and it threw on the plainest example
      // of one — taking the whole save with it, and every breakpoint in it.
      .filter((item) =>
        item && typeof item === "object"
        && typeof item.className === "string"
        && (item.type === "exception" || (Number.isInteger(item.line) && item.line > 0)),
      )
      .map((item) => item.type === "exception"
        ? {
            type: "exception",
            className: item.className || "java.lang.Throwable",
            line: 0,
            caught: item.caught !== false,
            uncaught: item.uncaught !== false,
            enabled: item.enabled !== false,
          }
        : {
            type: "line",
            className: item.className,
            // The file, kept across the save. Dropping it here undid the
            // whole point of identifying a breakpoint by its path: the next
            // load handed back a breakpoint with none, matching fell back to
            // the class name, and two files called Beta.java shared one
            // breakpoint again — a gutter click removing the other file's.
            ...(typeof item.path === "string" && item.path ? { path: item.path } : {}),
            line: item.line,
            condition: String(item.condition || ""),
            enabled: item.enabled !== false,
          });
    const file = this.file(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ version: 1, breakpoints: normalized }, null, 2)}\n`, "utf8");
    return normalized;
  }
}

module.exports = { BreakpointService };
