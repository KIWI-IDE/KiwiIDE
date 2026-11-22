import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { DependencyService } = require("../electron/services/dependency-service.cjs");
const { GradleEditorService } = require("../electron/services/gradle-editor-service.cjs");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const model = { schema: 1, gradleVersion: "test", projects: [{ path: ":", directory: "test", tasks: [], extensions: [], configurations: [] }], types: {} };
async function harness(run: any) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-gradle-model-"))); roots.push(root);
  await fs.writeFile(path.join(root, "build.gradle.kts"), 'plugins { java }');
  const guard = new PathGuard(); guard.register(root);
  const projects = { detect: async () => ({ type: "Gradle" }), detectJdk: async () => ({ available: true, path: "C:/test-jdk" }) };
  const events: any[] = [];
  const service = new GradleEditorService(guard, projects, { resolveBuildTool: () => "gradle" }, new DependencyService(guard, projects), (_channel: string, state: any) => events.push(state), run);
  return { root, service, events, guard, projects };
}
describe("Gradle editor model imports", () => {
  it("answers immediately and coalesces background imports", async () => {
    let finish!: (value: any) => void;
    const run = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const { root, service } = await harness(run);
    expect((await service.get(root)).state).toBe("loading");
    await service.get(root);
    expect(run).toHaveBeenCalledOnce();
    finish({ code: 0, stdout: `KIWI_GRADLE_MODEL:${JSON.stringify(model)}` });
    await service.jobs.get(root);
    expect((await service.get(root)).state).toBe("ready");
    expect(run).toHaveBeenCalledOnce();
    const saved = JSON.parse(await fs.readFile(path.join(root, ".kiwi", "gradle-editor-model.json"), "utf8"));
    expect(saved.model).toEqual(model);
  });
  it("keeps a previous model when the updated build fails without exposing process output", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: `KIWI_GRADLE_MODEL:${JSON.stringify(model)}` }));
    const { root, service } = await harness(run);
    await service.get(root); await service.jobs.get(root);
    run.mockResolvedValueOnce({ code: 1, stdout: "private-password-is-not-a-diagnostic" });
    await fs.appendFile(path.join(root, "build.gradle.kts"), "\nbroken");
    await service.get(root); await service.jobs.get(root);
    const state = await service.get(root);
    expect(state.state).toBe("error"); expect(state.model).toEqual(model);
    expect(state.reason).not.toContain("private-password");
  });
  it("discards results for a build changed while Gradle was configuring", async () => {
    let finish!: (value: any) => void;
    const { root, service } = await harness(() => new Promise(resolve => { finish = resolve; }));
    await service.get(root); await Promise.resolve();
    await fs.appendFile(path.join(root, "build.gradle.kts"), "\nversion = \"changed\"");
    finish({ code: 0, stdout: `KIWI_GRADLE_MODEL:${JSON.stringify(model)}` });
    await service.jobs.get(root);
    expect(service.states.get(root).state).toBe("outdated");
    await expect(fs.stat(path.join(root, ".kiwi", "gradle-editor-model.json"))).rejects.toThrow();
  });
});
