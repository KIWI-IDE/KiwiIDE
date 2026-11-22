import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { installBuildFileCompletion } from "./build-completion";

/**
 * The build-file completion as Monaco sees it.
 *
 * The rules are proven in build-files.test.ts; what is measured here is the
 * half that decides whether a dependency actually lands in the file: the whole
 * coordinate rather than the segment under the caret, and the elements around
 * it for a pom.
 */
const fakeMonaco = () => {
  const providers: any[] = [];
  const commands: Record<string, unknown> = {};
  return {
    providers,
    commands,
    monaco: {
      languages: {
        registerCompletionItemProvider: (_language: string, provider: unknown) => {
          providers.push(provider);
          return { dispose: () => undefined };
        },
        CompletionItemKind: { Property: 9, Module: 8, Value: 12 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      },
      editor: {
        registerCommand: (id: string, handler: unknown) => {
          commands[id] = handler;
          return { dispose: () => undefined };
        },
      },
    } as never,
  };
};

/** A model whose caret sits at the end of the given text. */
const modelFor = (text: string, fsPath: string, offset = text.length) => {
  const lines = text.slice(0, offset).split("\n");
  return {
    uri: { fsPath },
    getValue: () => text,
    getOffsetAt: () => offset,
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
    },
    getWordUntilPosition: () => {
      const word = lines[lines.length - 1].match(/[\w.-]*$/)?.[0] || "";
      return {
        word,
        startColumn: lines[lines.length - 1].length + 1 - word.length,
        endColumn: lines[lines.length - 1].length + 1,
      };
    },
  } as never;
};

const gson = {
  groupId: "com.google.code.gson",
  artifactId: "gson",
  version: "2.14.0",
  packaging: "jar",
  updatedAt: 0,
};

const apiWith = (search: unknown, versions: unknown = async () => []) => ({
  project: { searchDependencies: search, dependencyVersions: versions },
  app: { openArtifactPage: async () => true },
}) as never;

/** Drives one completion request against a freshly installed provider. */
async function complete(text: string, fsPath: string, api: unknown, root = () => "", offset = text.length) {
  const { providers, monaco, commands } = fakeMonaco();
  installBuildFileCompletion(monaco, api as never, root);
  const model = modelFor(text, fsPath, offset);
  const lines = text.slice(0, offset).split("\n");
  const position = { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
  const result = await providers[0].provideCompletionItems(model, position);
  return { ...result, commands, model };
}

describe("completing a dependency from an online search", () => {
  it("writes the whole coordinate into a Gradle script", async () => {
    // Completing "gso" to a group left the artifact and the version to be
    // typed, which is most of the work.
    const { suggestions } = await complete(
      'dependencies {\n    implementation "gso',
      "C:/projekt/build.gradle",
      apiWith(async () => [gson]),
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe("com.google.code.gson:gson");
    expect(suggestions[0].insertText).toBe("com.google.code.gson:gson:2.14.0");
  });

  it("replaces what was already typed instead of appending to it", async () => {
    const text = 'dependencies {\n    implementation("com.google.code.gson:gso';
    const { suggestions } = await complete(text, "C:/projekt/build.gradle.kts", apiWith(async () => [gson]));
    // The range has to cover the half-typed coordinate, or accepting the
    // proposal produces "com.google.code.gson:com.google.code.gson:gson".
    const range = suggestions[0].range;
    const line = text.split("\n")[1];
    expect(line.slice(range.startColumn - 1, range.endColumn - 1)).toBe("com.google.code.gson:gso");
  });

  it("fills the group and the version of a pom, not only the artifact", async () => {
    const pom = [
      "<project>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId></groupId>",
      "      <version></version>",
      "      <artifactId>gso",
    ].join("\n");
    const { suggestions } = await complete(pom, "C:/projekt/pom.xml", apiWith(async () => [gson]));
    expect(suggestions[0].insertText).toBe("gson");
    const written = suggestions[0].additionalTextEdits.map((edit: { text: string }) => edit.text);
    expect(written).toContain("com.google.code.gson");
    expect(written).toContain("2.14.0");
  });

  it("carries the mvnrepository page on every proposal", async () => {
    // The site cannot be searched by a program, but it is the page people mean
    // by "look this dependency up".
    const { suggestions, commands } = await complete(
      'dependencies {\n    implementation "gso',
      "C:/projekt/build.gradle",
      apiWith(async () => [gson]),
    );
    expect(suggestions[0].documentation.value)
      .toContain("mvnrepository.com%2Fartifact%2Fcom.google.code.gson%2Fgson%2F2.14.0");
    // A plain https link would do nothing: the workbench denies every
    // window-open, so the link runs a command instead.
    expect(suggestions[0].documentation.value).toContain("command:kiwi.openArtifactPage");
    expect(typeof commands["kiwi.openArtifactPage"]).toBe("function");
  });

  it("asks once for a query it has already answered", async () => {
    const search = vi.fn(async () => [gson]);
    const api = apiWith(search);
    await complete('dependencies {\n    implementation "einmalig', "C:/projekt/build.gradle", api);
    await complete('dependencies {\n    implementation "einmalig', "C:/projekt/build.gradle", api);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the search fails, rather than reporting it", async () => {
    // A build file has to keep completing elements and blocks on a train.
    const { suggestions } = await complete(
      'dependencies {\n    implementation "offline-test',
      "C:/projekt/build.gradle",
      apiWith(async () => { throw new Error("kein Netz"); }),
    );
    expect(suggestions).toEqual([]);
  });

  it("asks nothing at all for one typed character", async () => {
    const search = vi.fn(async () => [gson]);
    const { suggestions } = await complete(
      'dependencies {\n    implementation "g',
      "C:/projekt/build.gradle",
      apiWith(search),
    );
    expect(search).not.toHaveBeenCalled();
    expect(suggestions).toEqual([]);
  });

  it("leaves a file that is not a build file alone", async () => {
    const search = vi.fn(async () => [gson]);
    const { suggestions } = await complete(
      'dependencies {\n    implementation "gson',
      "C:/projekt/src/Main.java",
      apiWith(search),
    );
    expect(search).not.toHaveBeenCalled();
    expect(suggestions).toEqual([]);
  });

  it("still completes blocks where no coordinate is being typed", async () => {
    const { suggestions } = await complete(
      "dependencies {\n    ",
      "C:/projekt/build.gradle",
      apiWith(async () => [gson]),
    );
    expect(suggestions.some((item: { label: string }) => item.label === "implementation")).toBe(true);
  });
});

describe("Kotlin Gradle scripts with version catalogs", () => {
  const script = readFileSync(new URL("../../tests/fixtures/catalog-build.gradle.kts", import.meta.url), "utf8");
  const aliases = ["lombok", "paperSpigot", "labyMod", "citizens", "effectLib", "modelEngine", "fanyHologram", "dynamicDyalogs", "phoenixCrates", "coreApi", "corePaper", "fastAsyncWorldEditBukkit", "fastAsyncWorldEditCore", "test-library"];
  const catalogs = [{ name: "libs", path: "C:/projekt/gradle/libs.versions.toml", versions: [{ key: "paper-version", version: "test-version", editable: true }], libraries: aliases.map(alias => ({ alias, groupId: "test.group", artifactId: alias, version: "test-version", declaredVersion: "test-version" })) }];
  const localApi = () => ({ project: { listDependencies: vi.fn(async () => ({ catalogs })), searchDependencies: vi.fn(), dependencyVersions: vi.fn() }, app: { openArtifactPage: vi.fn() } });

  it("completes actual aliases in the reported script without contacting a registry", async () => {
    const api = localApi();
    const offset = script.indexOf("libs.paperSpigot") + "libs.pa".length;
    const result = await complete(script, "C:/projekt/build.gradle.kts", api, () => "C:/projekt", offset);
    expect(result.suggestions.map((item: any) => item.label)).toEqual(["libs.paperSpigot"]);
    expect(result.suggestions[0].insertText).toBe("libs.paperSpigot");
    expect(result.suggestions[0].range.endColumn - result.suggestions[0].range.startColumn).toBe("libs.paperSpigot".length);
    expect(api.project.searchDependencies).not.toHaveBeenCalled();
    expect(api.project.dependencyVersions).not.toHaveBeenCalled();
  });

  it("keeps camelCase aliases and converts hyphenated keys to Gradle accessors", async () => {
    for (const [typed, expected] of [["libs.fast", "libs.fastAsyncWorldEditBukkit"], ["libs.test.", "libs.test.library"], ["libs.versions.pa", "libs.versions.paper.version"]]) {
      const result = await complete(`dependencies { compileOnly(${typed}`, "C:/projekt/build.gradle.kts", localApi(), () => "C:/projekt");
      expect(result.suggestions.some((item: any) => item.label === expected)).toBe(true);
    }
  });

  it("offers catalog libraries inside empty dependency arguments", async () => {
    const result = await complete('dependencies { compileOnly(', "C:/projekt/build.gradle.kts", localApi(), () => "C:/projekt");
    expect(result.suggestions.some((item: any) => item.label === "libs.paperSpigot")).toBe(true);
    expect(result.suggestions.some((item: any) => item.label === "libs.fastAsyncWorldEditBukkit")).toBe(true);
  });

  it("completes dependency options and typed task options inside the script", async () => {
    for (const [needle, expected] of [["isTransitive = false", "isTransitive"], ["options.encoding", "encoding"], ["withSourcesJar()", "withSourcesJar"]]) {
      const end = script.indexOf(needle) + (needle.startsWith("options.") ? "options.en".length : 3);
      const result = await complete(script, "C:/projekt/build.gradle.kts", localApi(), () => "C:/projekt", end);
      expect(result.suggestions.some((item: any) => item.label === expected), needle).toBe(true);
    }
  });

  it("does not treat comments, quoted URLs or environment variable names as catalogs", async () => {
    for (const text of ['// libs.pa', '/* { nested /* } */ libs.pa', 'val text = "libs.pa', 'val text = """libs.pa', 'repositories { maven { url = uri("https://libs.pa']) {
      const api = localApi();
      const result = await complete(text, "C:/projekt/build.gradle.kts", api, () => "C:/projekt");
      expect(result.suggestions).toEqual([]);
      expect(api.project.listDependencies).not.toHaveBeenCalled();
    }
  });
});
