import { describe, expect, it } from "vitest";
import {
  completionOrigin,
  groupOverloads,
  hasImportConflict,
  importPreview,
  overloadLabel,
  qualifiedNameFrom,
} from "../src/language/completion-presentation";
import { narrowCommitCharacters } from "../src/language/monaco-lsp";

/**
 * Where a name comes from.
 *
 * A list mixes the JDK, the project's own code, a library it depends on, and
 * text Kiwi made up. Which one a name belongs to is most of what decides
 * whether it is the one wanted, and all four used to look the same.
 */
describe("saying where a proposal comes from", () => {
  const project = { projectType: "Gradle", projectPackages: ["dev.kiwi"] };

  it("knows the platform", () => {
    expect(completionOrigin({ source: "jdt", qualifiedName: "java.util.List" }, project)).toBe("JDK");
    expect(completionOrigin({ source: "jdt", qualifiedName: "javax.swing.JFrame" }, project)).toBe("JDK");
    expect(completionOrigin({ source: "jdt", detail: "String · java.lang.String" }, project)).toBe("JDK");
  });

  it("knows the project's own code", () => {
    expect(completionOrigin({ source: "jdt", qualifiedName: "dev.kiwi.Player" }, project)).toBe("Projekt");
    // A package that merely starts with the same letters is not the project.
    expect(completionOrigin({ source: "jdt", qualifiedName: "dev.kiwifruit.Other" }, project)).toBe("Gradle");
  });

  it("names the build tool for anything that arrived with a dependency", () => {
    expect(completionOrigin({ source: "jdt", qualifiedName: "org.bukkit.entity.Player" }, project)).toBe("Gradle");
    expect(completionOrigin({ source: "jdt", qualifiedName: "org.bukkit.entity.Player" }, {
      projectType: "Maven", projectPackages: ["dev.kiwi"],
    })).toBe("Maven");
    // Without a build tool there is still an honest word for it.
    expect(completionOrigin({ source: "jdt", qualifiedName: "org.bukkit.entity.Player" }, {})).toBe("Bibliothek");
  });

  it("knows what Kiwi itself made up", () => {
    expect(completionOrigin({ source: "postfix" }, project)).toBe("Template");
    expect(completionOrigin({ source: "live", qualifiedName: "java.util.List" }, project)).toBe("lokal");
  });

  it("reads a qualified name out of a detail line", () => {
    expect(qualifiedNameFrom("void add(int index) · java.util.ArrayList")).toBe("java.util.ArrayList");
    expect(qualifiedNameFrom("keine Typen hier")).toBe("");
    expect(qualifiedNameFrom("")).toBe("");
  });
});

/**
 * Six lines of a list spent on one decision.
 *
 * A method with six overloads filled the window with entries differing only in
 * a parameter list, pushing everything else off the screen — and the parameter
 * lists are what the signature help shows once one is chosen anyway.
 */
describe("folding overloads together", () => {
  const method = (name: string, owner: string) => ({ name, owner, isMethod: true });
  const describe_ = (item: { name: string; owner: string; isMethod: boolean }) => item;

  it("shows one entry and counts the rest", () => {
    const groups = groupOverloads(
      [method("add", "List"), method("add", "List"), method("add", "List"), method("size", "List")],
      describe_,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(3);
    expect(groups[0].hidden).toHaveLength(2);
    expect(groups[1].count).toBe(1);
  });

  it("keeps the one the server ranked highest", () => {
    const first = { name: "add", owner: "List", isMethod: true, marker: "erste" };
    const second = { name: "add", owner: "List", isMethod: true, marker: "zweite" };
    const groups = groupOverloads([first, second], describe_);
    expect((groups[0].item as typeof first).marker).toBe("erste");
  });

  it("does not fold two different types' methods together", () => {
    // List.add and Set.add are not overloads of each other, and folding them
    // would hide a name rather than tidy one.
    const groups = groupOverloads([method("add", "List"), method("add", "Set")], describe_);
    expect(groups).toHaveLength(2);
  });

  it("leaves anything that is not a method alone", () => {
    const groups = groupOverloads(
      [
        { name: "size", owner: "List", isMethod: false },
        { name: "size", owner: "List", isMethod: false },
      ],
      describe_,
    );
    expect(groups).toHaveLength(2);
  });

  it("says nothing when there is only one", () => {
    expect(overloadLabel(1)).toBe("");
    expect(overloadLabel(0)).toBe("");
    expect(overloadLabel(6)).toBe("6 Überladungen");
  });
});

/**
 * What accepting a proposal would add to the file.
 *
 * Accepting a name can quietly add an import, and which one is occasionally
 * the wrong one — two classes with the same name is exactly when a list is
 * being used to choose between them.
 */
describe("showing the import before it is added", () => {
  it("reads the imports out of the edits", () => {
    expect(importPreview([
      { newText: "import java.util.List;\n" },
      { newText: "import static java.util.Map.entry;\n" },
    ])).toEqual(["java.util.List", "java.util.Map.entry"]);
  });

  it("says nothing when nothing would be imported", () => {
    expect(importPreview(undefined)).toEqual([]);
    expect(importPreview([])).toEqual([]);
    expect(importPreview([{ newText: "\n" }])).toEqual([]);
  });

  it("notices when one name would mean two different types", () => {
    expect(hasImportConflict([
      { name: "List", qualifiedName: "java.util.List" },
      { name: "List", qualifiedName: "java.awt.List" },
    ])).toBe(true);
    expect(hasImportConflict([
      { name: "List", qualifiedName: "java.util.List" },
      { name: "Map", qualifiedName: "java.util.Map" },
    ])).toBe(false);
    expect(hasImportConflict([])).toBe(false);
  });
});

/**
 * Which characters accept the highlighted suggestion.
 *
 * Typing one that commits when it was not meant to is the most irritating way
 * for a list to be wrong: the name is taken, the character is swallowed, and
 * what was being typed is gone.
 */
describe("choosing what accepts a suggestion", () => {
  it("keeps only the characters that were asked for", () => {
    expect(narrowCommitCharacters(["(", ".", ";"], "(.")).toEqual(["(", "."]);
    expect(narrowCommitCharacters(["(", ".", ";"], "(.;")).toEqual(["(", ".", ";"]);
  });

  it("never offers one the server did not propose", () => {
    // The server knows where a character makes sense for an item; the setting
    // can only take away from that, never add to it.
    expect(narrowCommitCharacters(["("], "(.;")).toEqual(["("]);
    expect(narrowCommitCharacters([], "(.;")).toBeUndefined();
    expect(narrowCommitCharacters(undefined, "(.;")).toBeUndefined();
  });

  it("commits on nothing when nothing is allowed", () => {
    expect(narrowCommitCharacters(["(", "."], "")).toEqual([]);
    expect(narrowCommitCharacters(["(", "."], "xyz")).toEqual([]);
  });
});

/**
 * A label is a claim.
 *
 * Where the origin cannot be read, this used to answer "Projekt" for anything
 * the language server sent — which put that word beside `getClass()`,
 * `equals(Object o)` and `containsKey(Object key)`. The most used members in
 * the language, labelled as somebody's own code.
 */
describe("saying nothing rather than something wrong", () => {
  it("leaves the origin empty when there is nothing to read it from", () => {
    expect(completionOrigin({ source: "jdt", detail: "clear()" }, {})).toBe("");
    expect(completionOrigin({ source: "jdt" }, {})).toBe("");
    expect(completionOrigin({}, {})).toBe("");
  });

  it("still says where it can", () => {
    expect(completionOrigin({ source: "jdt", detail: "void add(int i) · java.util.List" }, {})).toBe("JDK");
    expect(completionOrigin({ source: "postfix" }, {})).toBe("Template");
    expect(completionOrigin({ source: "live" }, {})).toBe("lokal");
  });
});
