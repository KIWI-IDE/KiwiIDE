import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCustomTemplates } from "../src/language/custom-templates";

const { TemplateService } = require("../electron/services/template-service.cjs");
const { PathGuard } = require("../electron/services/path-guard.cjs");

let root = "";
let service: {
  file: (root: string) => string;
  read: (root: string) => Promise<{ path: string; text: string; exists: boolean }>;
  write: (root: string, text: string) => Promise<{ path: string; text: string; exists: boolean }>;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kiwi-templates-"));
  const guard = new PathGuard();
  guard.register(root);
  service = new TemplateService(guard);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("where a project keeps its templates", () => {
  it("puts them beside the project, so they are committed with it", () => {
    expect(service.file(root)).toBe(path.join(root, ".kiwi", "templates.json"));
  });

  it("refuses a directory that is not an open project", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "kiwi-fremd-"));
    try {
      expect(() => service.file(outside)).toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe("reading and writing the file", () => {
  it("treats a project without one as having no templates", async () => {
    const read = await service.read(root);
    expect(read).toMatchObject({ text: "", exists: false });
  });

  it("creates .kiwi on the first write", async () => {
    await service.write(root, '{ "templates": [] }');
    expect(await readFile(path.join(root, ".kiwi", "templates.json"), "utf8")).toContain("templates");
  });

  it("hands back exactly what was written", async () => {
    const text = '{\n  "templates": [\n    { "key": "logd", "source": "live", "insertText": "log.debug();" }\n  ]\n}\n';
    await service.write(root, text);
    const read = await service.read(root);
    expect(read.text).toBe(text);
    expect(read.exists).toBe(true);
    expect(parseCustomTemplates(read.text).templates).toHaveLength(1);
  });

  it("hands back a broken file rather than swallowing it", async () => {
    // The renderer says what is wrong with it. A service that returned nothing
    // here would turn a typo into a feature that silently does not work.
    await writeFile(path.join(root, ".kiwi", "templates.json"), "{ kaputt", "utf8")
      .catch(async () => {
        await service.write(root, "{ kaputt");
      });
    const read = await service.read(root);
    expect(read.text).toContain("kaputt");
    expect(parseCustomTemplates(read.text).problems).toHaveLength(1);
  });
});
