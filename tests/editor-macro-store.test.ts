import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const { EditorMacroStore } = require("../electron/services/editor-macro-store.cjs");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const macro = (name: string, shortcut = '') => ({ name, shortcut, steps: [{ kind: 'edit', edits: [{ start: { line: 0, column: 0, relative: true }, end: { line: 0, column: 0, relative: true }, text: '!' }] }] });
describe('persistent editor macros', () => {
  it('serializes concurrent saves, preserves updates and deletes by id', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kiwi-macros-')); roots.push(root);
    const store = new EditorMacroStore(root);
    await Promise.all([store.save(macro('first')), store.save(macro('second'))]);
    const saved = await new EditorMacroStore(root).list(); expect(saved).toHaveLength(2);
    const updated = await store.save({ ...saved[0], name: 'renamed' }); expect(updated).toHaveLength(2);
    expect((await store.remove(saved[1].id)).map((item: any) => item.name)).toEqual(['renamed']);
  });
  it('rejects executable commands, invalid steps and duplicate shortcuts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kiwi-macros-')); roots.push(root);
    const store = new EditorMacroStore(root);
    await expect(store.save({ name: 'shell', steps: [{ kind: 'command', command: 'run anything' }] })).rejects.toThrow();
    await store.save(macro('first', 'Ctrl+Alt+K'));
    await expect(store.save(macro('second', 'Ctrl+Alt+K'))).rejects.toThrow('Tastenkürzel');
    await expect(store.save(macro('bare', 'Shift+A'))).rejects.toThrow();
  });
});
