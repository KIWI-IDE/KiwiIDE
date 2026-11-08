import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { CollabHost } = require("../electron/services/collab-session.cjs");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 })));
});

async function host() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-collab-tree-"));
  temporaryDirectories.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "Alpha.java"), "class Alpha {}\n", "utf8");
  return { root, session: new CollabHost({ root, projectName: "demo" }) };
}

/**
 * A guest asking the host to change the project on disk.
 *
 * Every path in one of these is a request, not a fact: it arrives from another
 * machine over a socket. The share boundary is the whole of what stands between
 * a shared folder and the rest of the host's disk, so it is what these check.
 */
describe("changing the shared project from a session", () => {
  it("creates a file and a folder", async () => {
    const { root, session } = await host();

    await session.mutateTree({ type: "createEntry", path: "src/Beta.java", text: "class Beta {}\n" });
    await session.mutateTree({ type: "createEntry", path: "src/util", directory: true });

    expect(await fs.readFile(path.join(root, "src", "Beta.java"), "utf8")).toBe("class Beta {}\n");
    expect((await fs.stat(path.join(root, "src", "util"))).isDirectory()).toBe(true);
  });

  it("renames and moves in one step", async () => {
    const { root, session } = await host();

    await session.mutateTree({ type: "renameEntry", path: "src/Alpha.java", target: "src/Gamma.java" });
    expect(await fs.readFile(path.join(root, "src", "Gamma.java"), "utf8")).toBe("class Alpha {}\n");
    expect(await fs.stat(path.join(root, "src", "Alpha.java")).then(() => true).catch(() => false)).toBe(false);

    await session.mutateTree({ type: "createEntry", path: "lib", directory: true });
    await session.mutateTree({ type: "moveEntry", path: "src/Gamma.java", target: "lib/Gamma.java" });
    expect(await fs.readFile(path.join(root, "lib", "Gamma.java"), "utf8")).toBe("class Alpha {}\n");
  });

  it("deletes what it is asked to delete", async () => {
    const { root, session } = await host();

    await session.mutateTree({ type: "deleteEntry", path: "src/Alpha.java" });

    expect(await fs.stat(path.join(root, "src", "Alpha.java")).then(() => true).catch(() => false)).toBe(false);
  });

  it("stays inside the shared folder", async () => {
    const { root, session } = await host();
    const outside = path.join(path.dirname(root), "nicht-geteilt.txt");
    await fs.writeFile(outside, "unberührt", "utf8");
    temporaryDirectories.push(outside);

    for (const request of [
      { type: "createEntry", path: "../nicht-geteilt.txt", text: "überschrieben" },
      { type: "deleteEntry", path: "../nicht-geteilt.txt" },
      { type: "renameEntry", path: "src/Alpha.java", target: "../entwischt.java" },
      { type: "createEntry", path: "..\\\\nicht-geteilt.txt", text: "überschrieben" },
    ]) {
      await expect(session.mutateTree(request)).rejects.toThrow();
    }

    // The file outside the share is exactly as it was.
    expect(await fs.readFile(outside, "utf8")).toBe("unberührt");
    expect(await fs.readFile(path.join(root, "src", "Alpha.java"), "utf8")).toBe("class Alpha {}\n");
  });

  it("refuses to write over something that is already there", async () => {
    const { root, session } = await host();
    await fs.writeFile(path.join(root, "src", "Belegt.java"), "wichtig", "utf8");

    await expect(session.mutateTree({
      type: "createEntry", path: "src/Belegt.java", text: "neu",
    })).rejects.toThrow(/bereits/);
    await expect(session.mutateTree({
      type: "renameEntry", path: "src/Alpha.java", target: "src/Belegt.java",
    })).rejects.toThrow(/bereits/);

    expect(await fs.readFile(path.join(root, "src", "Belegt.java"), "utf8")).toBe("wichtig");
  });
});
