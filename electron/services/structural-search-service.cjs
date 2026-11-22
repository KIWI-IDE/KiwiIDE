const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { compilePattern, findStructuralMatches, replacementText } = require("./structural-search.cjs");
const extensions = { java: [".java"], javascript: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"], kotlin: [".kt", ".kts"], python: [".py", ".pyi"], c: [".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".rs", ".go"] };
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
class StructuralSearchService {
  constructor(guard, workspace) { Object.assign(this, { guard, workspace }); this.plans = new Map(); this.applying = new Set(); }
  async preview(root, options = {}) {
    root = this.guard.assertWorkspace(root);
    const language = String(options.language || "java");
    if (!extensions[language]) throw new Error("Diese Sprache wird von der strukturellen Suche noch nicht unterstützt.");
    const pattern = compilePattern(String(options.pattern || ""), language);
    const replacement = String(options.replacement ?? "");
    if (replacement.length > 16_000) throw new Error("Der Ersetzungstext ist zu groß.");
    replacementText(replacement, Object.fromEntries(pattern.filter(token => token.kind === "hole").map(token => [token.value, { text: "" }])));
    const blocked = new Set((options.dirtyFiles || []).map(file => this.guard.assertAllowed(file, root)));
    const files = await this.workspace.collectFiles(root, file => extensions[language].includes(path.extname(file).toLowerCase()) && !/(?:^|[\\/])(?:build|target|out|dist|generated)(?:[\\/])/.test(path.relative(root, file)));
    const snapshots = []; const matches = []; const skipped = []; let bytes = 0; let readBytes = 0; let truncated = false; let scanned = 0;
    const startedAt = Date.now();
    for (const file of files) {
      if (matches.length >= 500 || snapshots.length >= 100 || scanned >= 3000 || bytes >= 10_000_000 || readBytes >= 30_000_000 || Date.now() - startedAt > 8000) { truncated = true; break; }
      this.guard.assertAllowed(file, root);
      if (blocked.has(file)) { skipped.push({ file, reason: "unsaved" }); continue; }
      const stat = await fs.stat(file);
      if (stat.size > 1_000_000) { skipped.push({ file, reason: "size" }); continue; }
      const content = await fs.readFile(file, "utf8"); scanned++; readBytes += stat.size;
      if (content.includes("\0")) continue;
      const result = findStructuralMatches(content, pattern, replacement, language, 500 - matches.length);
      truncated ||= result.truncated;
      if (!result.matches.length) continue;
      snapshots.push({ file, content, hash: hash(content) }); bytes += Buffer.byteLength(content);
      matches.push(...result.matches.map(match => ({ ...match, id: crypto.randomUUID(), file, relative: path.relative(root, file) })));
    }
    for (const [key, plan] of this.plans) if (Date.now() - plan.createdAt > 900_000) this.plans.delete(key);
    if (this.plans.size >= 8) this.plans.delete(this.plans.keys().next().value);
    const planId = crypto.randomUUID();
    this.plans.set(planId, { root, snapshots, matches, createdAt: Date.now() });
    return { planId, matches, scanned, skipped, truncated };
  }
  async apply(root, planId, selectedIds, dirtyFiles = []) {
    root = this.guard.assertWorkspace(root);
    const plan = this.plans.get(planId);
    if (!plan || plan.root !== root || Date.now() - plan.createdAt > 900_000) throw new Error("Die Vorschau ist abgelaufen. Suche erneut.");
    if (this.applying.has(root)) throw new Error("Eine Ersetzung für dieses Projekt läuft bereits.");
    const selected = new Set(selectedIds || []);
    if (!selected.size || [...selected].some(id => !plan.matches.some(match => match.id === id))) throw new Error("Wähle gültige Treffer aus der Vorschau aus.");
    const blocked = new Set(dirtyFiles.map(file => this.guard.assertAllowed(file, root)));
    const changes = plan.snapshots.flatMap(snapshot => {
      const matches = plan.matches.filter(match => match.file === snapshot.file && selected.has(match.id));
      if (!matches.length) return [];
      if (blocked.has(snapshot.file)) throw new Error("Speichere zuerst die offenen Änderungen in den ausgewählten Dateien.");
      let after = snapshot.content;
      for (const match of matches.sort((a, b) => b.start - a.start)) after = after.slice(0, match.start) + match.after + after.slice(match.end);
      return after === snapshot.content ? [] : [{ ...snapshot, after }];
    });
    this.applying.add(root); const written = [];
    try {
      for (const change of changes) {
        this.guard.assertAllowed(change.file, root);
        if (hash(await fs.readFile(change.file, "utf8")) !== change.hash) throw new Error("Eine Datei wurde seit der Vorschau geändert. Suche erneut; es wurde nichts ersetzt.");
      }
      if (changes.length) await this.workspace.capture(root, "Strukturell ersetzen", changes.map(change => change.file));
      for (const change of changes) {
        if (hash(await fs.readFile(change.file, "utf8")) !== change.hash) throw new Error("Eine Datei wurde während der Ersetzung geändert.");
        const temporary = this.guard.assertAllowed(`${change.file}.kiwi-${crypto.randomBytes(6).toString("hex")}.tmp`, root);
        try {
          const mode = (await fs.stat(change.file)).mode;
          await fs.writeFile(temporary, change.after, { mode });
          if (hash(await fs.readFile(change.file, "utf8")) !== change.hash) throw new Error("Eine Datei wurde während der Ersetzung geändert.");
          await fs.rename(temporary, change.file); written.push(change);
        } finally { await fs.unlink(temporary).catch(() => undefined); }
      }
      this.plans.delete(planId); this.workspace.invalidate(root);
      return { files: changes.map(change => ({ file: change.file, content: change.after })), replacements: plan.matches.filter(match => selected.has(match.id)).length };
    } catch (error) {
      for (const change of written.reverse()) {
        if (await fs.readFile(change.file, "utf8").catch(() => null) === change.after) await fs.writeFile(change.file, change.content);
      }
      throw error;
    } finally { this.applying.delete(root); }
  }
}
module.exports = { StructuralSearchService };
