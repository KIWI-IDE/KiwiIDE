const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Every file in the project, written down.
 *
 * The file palette searched the Explorer's tree, which loads one level at a
 * time, so a file in a folder nobody had expanded to was not findable at all.
 * This walks the project once, keeps the list in `.kiwi/index/files.json`, and
 * hands it back on the next open without walking again.
 *
 * The stored list is a cache. Anything unreadable, from another version or
 * belonging to another project is rebuilt rather than reported: the disk is
 * the truth and this is only a note about it.
 */
class IndexService {
  constructor(pathGuard, workspace) {
    this.pathGuard = pathGuard;
    this.workspace = workspace;
    /** One walk per project at a time; a second caller waits for the first. */
    this.building = new Map();
  }

  file(root) {
    this.pathGuard.assertWorkspace(root);
    return path.join(root, ".kiwi", "index", "files.json");
  }

  /**
   * The stored list, exactly as it was written.
   *
   * Never walks. The caller decides whether what it gets back is fresh enough,
   * because that decision belongs where somebody is waiting for a window to
   * paint rather than down here.
   */
  async load(root) {
    root = this.pathGuard.assertWorkspace(root);
    try {
      return { root, text: await fs.readFile(this.file(root), "utf8") };
    } catch {
      return { root, text: "" };
    }
  }

  /**
   * Walks the project and writes the list down.
   *
   * Deliberately serialised per project: two walks of a large tree at once
   * cost twice the disk and produce the same answer.
   */
  async build(root) {
    root = this.pathGuard.assertWorkspace(root);
    const running = this.building.get(root);
    if (running) return running;
    const walk = (async () => {
      const found = await this.workspace.collectFiles(root, () => true);
      const files = [];
      for (const absolute of found) {
        const relative = path.relative(root, absolute).replace(/\\/g, "/");
        if (!relative || relative.startsWith("..")) continue;
        // The modification time is read where the entry is made rather than in
        // a second pass, so a file that vanishes between the two cannot appear
        // in the list without one.
        const modified = await fs.stat(absolute).then((info) => info.mtimeMs).catch(() => 0);
        // Java files are read while they are being walked past anyway. Without
        // their types and methods the class and symbol searches answer nothing
        // until the language server has finished indexing, which on a large
        // project is the first minute of every session.
        const symbols = relative.toLowerCase().endsWith(".java")
          ? await fs.readFile(absolute, "utf8").then(declaredSymbols).catch(() => [])
          : [];
        files.push({ path: relative, modified, ...(symbols.length ? { symbols } : {}) });
      }
      const index = { version: 2, root, builtAt: Date.now(), files };
      await this.write(root, index);
      return index;
    })().finally(() => this.building.delete(root));
    this.building.set(root, walk);
    return walk;
  }

  async write(root, index) {
    const target = this.file(root);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Written beside and renamed over: a half-written index is one that fails
    // to parse on the next open, which costs a walk nobody asked for.
    const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(index)}\n`, "utf8");
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    return true;
  }

  /** Throws the stored list away, so the next build starts from nothing. */
  async clear(root) {
    root = this.pathGuard.assertWorkspace(root);
    await fs.rm(this.file(root), { force: true }).catch(() => undefined);
    return true;
  }
}

/**
 * The types and methods a Java file declares.
 *
 * A reader, not a compiler, and it says so: it works on the text with the
 * comments and strings blanked out, so a brace in a string cannot close a
 * class and `// class Foo` declares nothing. What it cannot do is resolve
 * anything — no supertypes, no imports, no generics. That is the language
 * server's work, and this exists only to answer during the minute before the
 * server has finished starting.
 */
function declaredSymbols(source) {
  const text = maskLiterals(String(source || ""));
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const packageName = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
  const symbols = [];
  const types = [];

  const typePattern = /\b(?:class|interface|enum|record|@interface)\s+([A-Z][\w$]*)/g;
  for (const match of text.matchAll(typePattern)) {
    types.push({ name: match[1], index: match.index || 0 });
    symbols.push({ name: match[1], kind: "class", line: lineOf(match.index || 0), owner: packageName });
  }

  // A method is a name followed by a parameter list and then a brace or a
  // semicolon. The keywords share that shape, which is why they are named.
  const notMethods = new Set([
    "if", "for", "while", "switch", "catch", "synchronized", "return", "new",
    "do", "try", "assert", "yield", "super", "this", "record", "enum",
  ]);
  const methodPattern = /(?:^|[;{}\s])((?:[\w$<>,.[\]?]+\s+)+)([a-zA-Z_$][\w$]*)\s*\([^;{}()]*\)\s*(?:throws\s+[\w$.,\s]+)?[{;]/g;
  for (const match of text.matchAll(methodPattern)) {
    const name = match[2];
    if (notMethods.has(name)) continue;
    // What stands immediately before the name decides what this is.
    // `new IllegalStateException("…");` has a method's exact shape, and read as
    // one it put every constructor call anybody wrote into the symbol search.
    // A type header does too, and those are already collected above.
    const preceding = (match[1] || "").trim().split(/\s+/).at(-1) || "";
    if (["new", "class", "interface", "enum", "record", "@interface"].includes(preceding)) continue;
    // A declaration is not the right-hand side of anything.
    if (/[=(,]\s*$/.test(match[1] || "")) continue;
    const at = match.index || 0;
    // The innermost type declared above it is the one it belongs to.
    const owner = [...types].reverse().find((type) => type.index < at);
    symbols.push({ name, kind: "method", line: lineOf(at), owner: owner?.name || packageName });
  }
  return symbols;
}

/**
 * Blanks comments and string literals, keeping every offset.
 *
 * Replacing rather than removing means a position in the masked text still
 * means the same position in the file, which is what makes the line numbers
 * point at the declaration rather than near it.
 */
function maskLiterals(source) {
  let state = "code";
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    const blank = character === "\n" ? "\n" : " ";
    if (state === "code") {
      if (character === "/" && next === "/") { state = "line"; result += "  "; index += 1; continue; }
      if (character === "/" && next === "*") { state = "block"; result += "  "; index += 1; continue; }
      if (character === '"') { state = "string"; result += blank; continue; }
      if (character === "'") { state = "char"; result += blank; continue; }
      result += character;
      continue;
    }
    if (state === "line") {
      if (character === "\n") state = "code";
      result += blank;
      continue;
    }
    if (state === "block") {
      if (character === "*" && next === "/") { state = "code"; result += "  "; index += 1; continue; }
      result += blank;
      continue;
    }
    // Inside a literal: a backslash hides whatever follows it.
    if (character === "\\") { result += "  "; index += 1; continue; }
    if ((state === "string" && character === '"') || (state === "char" && character === "'")) state = "code";
    result += blank;
  }
  return result;
}

module.exports = { IndexService, declaredSymbols };
