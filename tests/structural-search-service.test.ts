import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { WorkspaceService } = require("../electron/services/workspace-service.cjs");
const { StructuralSearchService } = require("../electron/services/structural-search-service.cjs");
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-structural-"))); roots.push(root);
  const guard = new PathGuard(); guard.register(root); const workspace = new WorkspaceService(guard, {}, () => {});
  for (const name of ['A.java', 'B.java']) await fs.writeFile(path.join(root, name), `class ${name[0]} { void f() { System.out.println(1); System.out.println(2); } }`);
  return { root, workspace, service: new StructuralSearchService(guard, workspace) };
}
const options = { language: 'java', pattern: 'System.out.println($x$)', replacement: 'logger.info($x$)' };
describe("reviewed structural replacements", () => {
  it("previews without writes, replaces only selected matches and supports project undo", async () => {
    const { root, workspace, service } = await fixture(); const file = path.join(root, 'A.java');
    const original = await fs.readFile(file, 'utf8'); const preview = await service.preview(root, options);
    expect(preview.matches).toHaveLength(4); expect(await fs.readFile(file, 'utf8')).toBe(original);
    const match = preview.matches.find((item: any) => item.file === file);
    const result = await service.apply(root, preview.planId, [match.id]);
    expect(result.files).toHaveLength(1); expect(await fs.readFile(file, 'utf8')).toContain('logger.info(1); System.out.println(2)');
    await workspace.undo(root); expect(await fs.readFile(file, 'utf8')).toBe(original);
  });
  it("refuses stale previews before writing any file", async () => {
    const { root, service } = await fixture(); const preview = await service.preview(root, options);
    const file = path.join(root, 'B.java'); await fs.appendFile(file, '\n// changed elsewhere');
    await expect(service.apply(root, preview.planId, preview.matches.map((item: any) => item.id))).rejects.toThrow('Vorschau');
    expect(await fs.readFile(path.join(root, 'A.java'), 'utf8')).not.toContain('logger.info');
    expect(await fs.readFile(file, 'utf8')).toContain('changed elsewhere');
  });
  it("skips dirty buffers and rejects files that became dirty after preview", async () => {
    const { root, service } = await fixture(); const file = path.join(root, 'A.java');
    const preview = await service.preview(root, { ...options, dirtyFiles: [file] });
    expect(preview.matches.every((item: any) => item.file !== file)).toBe(true);
    expect(preview.skipped).toContainEqual({ file, reason: 'unsaved' });
    const match = preview.matches[0];
    await expect(service.apply(root, preview.planId, [match.id], [match.file])).rejects.toThrow('Speichere');
  });
  it("rolls back earlier writes when a later file cannot be replaced", async () => {
    const { root, service } = await fixture(); const preview = await service.preview(root, options);
    const rename = fs.rename.bind(fs); let count = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => { if (++count === 2) throw new Error('write denied'); return rename(from, to); });
    await expect(service.apply(root, preview.planId, preview.matches.map((item: any) => item.id))).rejects.toThrow('write denied');
    for (const name of ['A.java', 'B.java']) expect(await fs.readFile(path.join(root, name), 'utf8')).not.toContain('logger.info');
  });
});
