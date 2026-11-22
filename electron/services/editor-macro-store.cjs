const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
function validateMacro(raw) {
  if (!raw || !String(raw.name || "").trim() || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 500 || JSON.stringify(raw).length > 500_000) throw new Error("Ungültiges oder zu großes Makro.");
  const point = value => value && Number.isInteger(value.line) && Math.abs(value.line) <= 100_000 && Number.isInteger(value.column) && Math.abs(value.column) <= 1_000_000 && typeof value.relative === "boolean" && (!value.edge || ["start", "end", "top", "bottom"].includes(value.edge));
  const selection = value => value && point(value.anchor) && point(value.head);
  for (const step of raw.steps) {
    if (step.kind === "move") { if (!selection(step.selection)) throw new Error("Ungültige Cursorbewegung im Makro."); }
    else if (step.kind !== "edit" || !Array.isArray(step.edits) || !step.edits.length || step.edits.length > 100 || step.edits.some(edit => !point(edit.start) || !point(edit.end) || typeof edit.text !== "string") || (step.after && !selection(step.after))) throw new Error("Ungültiger Bearbeitungsschritt im Makro.");
  }
  const shortcut = String(raw.shortcut || "").trim();
  if (shortcut && (!/^(?:(?:Ctrl|Alt|Shift|Meta)\+)+[A-Za-z0-9]+$/.test(shortcut) || !/(?:^|\+)(?:Ctrl|Alt|Meta)\+/.test(shortcut))) throw new Error("Verwende ein Tastenkürzel mit Strg oder Alt.");
  return { id: /^[a-f0-9-]{36}$/.test(raw.id || "") ? raw.id : crypto.randomUUID(), name: String(raw.name).trim().slice(0, 80), shortcut, steps: raw.steps, updatedAt: Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? raw.updatedAt : Date.now() };
}
class EditorMacroStore {
  constructor(directory) { this.file = path.join(directory, "editor-macros.json"); this.queue = Promise.resolve(); }
  async list() {
    try { const parsed = JSON.parse(await fs.readFile(this.file, "utf8")); return Array.isArray(parsed) ? parsed.map(validateMacro).slice(0, 30) : []; }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
  write(action) {
    const job = this.queue.catch(() => undefined).then(async () => {
      const values = action(await this.list());
      if (values.length > 30 || JSON.stringify(values).length > 2_000_000) throw new Error("Der Makro-Speicher ist voll. Lösche zuerst ein nicht benötigtes Makro.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${crypto.randomBytes(5).toString("hex")}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(values), { mode: 0o600 }); await fs.rename(temporary, this.file); }
      finally { await fs.unlink(temporary).catch(() => undefined); }
      return values;
    }); this.queue = job; return job;
  }
  async save(raw) {
    const macro = validateMacro({ ...raw, updatedAt: Date.now() });
    return this.write(values => {
      if (macro.shortcut && values.some(value => value.id !== macro.id && value.shortcut.toLowerCase() === macro.shortcut.toLowerCase())) throw new Error("Dieses Tastenkürzel wird bereits von einem Makro verwendet.");
      return [...values.filter(value => value.id !== macro.id), macro];
    });
  }
  remove(id) { return this.write(values => values.filter(value => value.id !== id)); }
}
module.exports = { EditorMacroStore, validateMacro };
