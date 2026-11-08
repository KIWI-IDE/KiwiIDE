import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const { PathGuard } = require("../electron/services/path-guard.cjs");
const { GitService, assertCloneUrl, repositoryFolderName } = require("../electron/services/git-service.cjs");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 })));
});

async function sourceRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-clone-source-"));
  temporaryDirectories.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  await fs.writeFile(path.join(root, "README.md"), "# Demo\n", "utf8");
  git("add", ".");
  git("commit", "-q", "-m", "erster Stand");
  // Handed to the clone as a file:// URL, which is what the validator accepts
  // and what a real address looks like to it.
  return { root, url: pathToFileURL(root).toString() };
}

/**
 * Cloning is the one Git command that runs before there is a workspace, so it
 * cannot go through the guard the others do — which makes what it accepts its
 * own responsibility.
 */
describe("cloning a repository", () => {
  it("refuses the transports that run a command", () => {
    // "ext::" is a documented git transport that executes what follows it, on
    // the machine doing the clone, and the address comes from a text field.
    for (const url of [
      "ext::sh -c whoami",
      "ext::git-upload-pack",
      // git would read a leading dash as an option rather than an address.
      "--upload-pack=evil",
      "-u evil",
      "",
      "   ",
    ]) {
      expect(() => assertCloneUrl(url)).toThrow();
    }
  });

  it("accepts the ordinary ones", () => {
    for (const url of [
      "https://github.com/user/repo.git",
      "http://gitlab.local/team/repo",
      "git@github.com:user/repo.git",
      "ssh://git@host:22/team/repo.git",
      "git://host/team/repo.git",
      "file:///C:/repos/demo",
    ]) {
      expect(assertCloneUrl(url)).toBe(url);
    }
  });

  it("names the folder the way the repository is named", () => {
    expect(repositoryFolderName("https://github.com/user/repo.git")).toBe("repo");
    expect(repositoryFolderName("git@github.com:user/repo.git")).toBe("repo");
    expect(repositoryFolderName("https://github.com/user/repo/")).toBe("repo");
    expect(repositoryFolderName("https://github.com/user/repo?tab=readme")).toBe("repo");
  });

  it("clones into a folder that is not a workspace yet", async () => {
    const source = await sourceRepository();
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-clone-target-"));
    temporaryDirectories.push(parent);
    const service = new GitService(new PathGuard());

    const result = await service.clone(source.url, parent, "geklont");

    expect(path.resolve(result.path)).toBe(path.resolve(path.join(parent, "geklont")));
    expect(await fs.readFile(path.join(result.path, "README.md"), "utf8")).toContain("# Demo");
    // A clone that is not a repository is not a clone.
    expect(await fs.stat(path.join(result.path, ".git")).then(() => true)).toBe(true);
  }, 60_000);

  it("refuses to write over a folder that is already there", async () => {
    const source = await sourceRepository();
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-clone-busy-"));
    temporaryDirectories.push(parent);
    await fs.mkdir(path.join(parent, "belegt"));
    await fs.writeFile(path.join(parent, "belegt", "wichtig.txt"), "nicht verlieren", "utf8");
    const service = new GitService(new PathGuard());

    await expect(service.clone(source.url, parent, "belegt")).rejects.toThrow(/schon/);
    // Whatever was there is still there.
    expect(await fs.readFile(path.join(parent, "belegt", "wichtig.txt"), "utf8")).toBe("nicht verlieren");
  }, 60_000);

  it("leaves nothing behind when the clone fails", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-clone-fail-"));
    temporaryDirectories.push(parent);
    const service = new GitService(new PathGuard());

    await expect(service.clone("https://example.invalid/nichts.git", parent, "leer")).rejects.toThrow();
    // A half-written directory looks like a project and is not one.
    expect(await fs.stat(path.join(parent, "leer")).then(() => true).catch(() => false)).toBe(false);
  }, 120_000);
});
