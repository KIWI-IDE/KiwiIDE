import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { BuildService, mavenProfiles } = require("../electron/services/build-service.cjs");

/**
 * What the Maven tool window offers.
 *
 * The list is read off the poms, and it used to be read off the root's alone
 * with its comments included. Both are wrong in the same direction: they offer
 * a goal that is not there. In an aggregator the root pom carries the module
 * list and almost nothing else, so the plugin that builds the artifact — the
 * one somebody is looking for — sits one directory down.
 */
describe("the tasks a Maven build reports", () => {
  let root = "";

  const service = () => new BuildService(
    { assertWorkspace: (value: string) => value, assertAllowed: (value: string) => value },
    {},
    { detect: async () => ({ type: "Maven" }) },
    {},
    () => undefined,
  );

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "kiwi-maven-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  const pom = (...lines: string[]) => `${["<project>", ...lines, "</project>"].join("\n")}\n`;
  const names = (tasks: { name: string }[]) => tasks.map((task) => task.name);

  it("always offers the Maven lifecycle", async () => {
    await writeFile(path.join(root, "pom.xml"), pom("  <artifactId>kern</artifactId>"), "utf8");
    const listed = await service().listTasks(root);
    expect(listed.type).toBe("Maven");
    expect(names(listed.tasks)).toEqual(expect.arrayContaining(["clean", "package", "install", "clean package"]));
  });

  it("offers a plugin goal when the plugin is declared", async () => {
    await writeFile(path.join(root, "pom.xml"), pom(
      "  <build><plugins><plugin>",
      "    <artifactId>maven-shade-plugin</artifactId>",
      "  </plugin></plugins></build>",
    ), "utf8");
    expect(names((await service().listTasks(root)).tasks)).toContain("shade:shade");
  });

  it("does not offer a goal whose plugin is commented out", async () => {
    // The goal would fail with "no plugin descriptor found", from a tool window
    // that gave every impression of knowing what the project can do.
    await writeFile(path.join(root, "pom.xml"), pom(
      "  <build><plugins>",
      "    <!-- <plugin><artifactId>maven-shade-plugin</artifactId></plugin> -->",
      "  </plugins></build>",
    ), "utf8");
    expect(names((await service().listTasks(root)).tasks)).not.toContain("shade:shade");
  });

  it("finds the plugin in a module rather than only in the root pom", async () => {
    // The aggregator pattern: the root lists modules, the module builds the jar.
    await writeFile(path.join(root, "pom.xml"), pom(
      "  <artifactId>eltern</artifactId>",
      "  <modules><module>dienst</module></modules>",
    ), "utf8");
    await mkdir(path.join(root, "dienst"), { recursive: true });
    await writeFile(path.join(root, "dienst", "pom.xml"), pom(
      "  <artifactId>dienst</artifactId>",
      "  <build><plugins><plugin>",
      "    <artifactId>spring-boot-maven-plugin</artifactId>",
      "  </plugin></plugins></build>",
    ), "utf8");
    const listed = await service().listTasks(root);
    expect(listed.modules).toEqual(["dienst"]);
    expect(names(listed.tasks)).toContain("spring-boot:run");
  });

  it("does not list a module that is commented out", async () => {
    await writeFile(path.join(root, "pom.xml"), pom(
      "  <modules>",
      "    <module>dienst</module>",
      "    <!-- <module>abgeschaltet</module> -->",
      "  </modules>",
    ), "utf8");
    expect((await service().listTasks(root)).modules).toEqual(["dienst"]);
  });

  it("survives a module directory that is not there", async () => {
    await writeFile(path.join(root, "pom.xml"), pom("  <modules><module>fehlt</module></modules>"), "utf8");
    const listed = await service().listTasks(root);
    expect(listed.modules).toEqual(["fehlt"]);
    expect(names(listed.tasks)).toContain("package");
  });

  it("reports the profiles the pom declares", async () => {
    await writeFile(path.join(root, "pom.xml"), pom(
      "  <profiles>",
      "    <profile><id>schnell</id><activation><activeByDefault>true</activeByDefault></activation></profile>",
      "    <profile><id>vollstaendig</id></profile>",
      "  </profiles>",
    ), "utf8");
    const listed = await service().listTasks(root);
    expect(listed.profiles).toEqual([
      { id: "schnell", active: true, description: "" },
      { id: "vollstaendig", active: false, description: "" },
    ]);
  });

  it("does not report a profile that is commented out", async () => {
    await writeFile(path.join(root, "pom.xml"), pom(
      "  <profiles>",
      "    <profile><id>echt</id></profile>",
      "    <!-- <profile><id>alt</id></profile> -->",
      "  </profiles>",
    ), "utf8");
    expect((await service().listTasks(root)).profiles.map((entry: { id: string }) => entry.id)).toEqual(["echt"]);
  });

  it("reads profiles straight out of a pom", () => {
    expect(mavenProfiles("<profile><id>a</id><properties><x>1</x></properties></profile>")).toEqual([
      { id: "a", active: false, description: "setzt Properties" },
    ]);
  });
});
