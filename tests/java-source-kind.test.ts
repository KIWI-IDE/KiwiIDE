import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  addJavaImport,
  maskJavaSource,
  packageForDirectory,
  readJavaSourceKind,
  renameTopLevelJavaType,
  topLevelJavaKind,
} = require("../electron/services/workspace-service.cjs");

/**
 * What the Explorer draws next to a Java file.
 *
 * The icon is read off the source, and it was read off the first keyword found
 * anywhere in it. A class holding a nested `enum` therefore carried the enum's
 * icon, a class holding a nested `@interface` the annotation's, and a class
 * with the word "enum" inside a string carried one for no reason at all. Only
 * the type the file is named after may decide.
 */
describe("the kind of type a Java file declares", () => {
  const source = (...lines: string[]) => `${lines.join("\n")}\n`;

  it("reads a plain class", () => {
    expect(topLevelJavaKind(source("public class Plain {", "  void run() {}", "}"))).toBe("class");
  });

  it("reads an enum, a record and an interface", () => {
    expect(topLevelJavaKind(source("public enum Colour { RED, GREEN }"))).toBe("enum");
    expect(topLevelJavaKind(source("public record Point(int x, int y) {}"))).toBe("record");
    expect(topLevelJavaKind(source("public sealed interface Shape permits Circle {}"))).toBe("interface");
    expect(topLevelJavaKind(source("public @interface Marker { String value(); }"))).toBe("annotation");
  });

  it("keeps a class that holds a nested enum a class", () => {
    expect(topLevelJavaKind(source(
      "public class Settings {",
      "  enum Mode { FAST, SLOW }",
      "  Mode mode = Mode.FAST;",
      "}",
    ))).toBe("class");
  });

  it("keeps a class that holds a nested interface or record a class", () => {
    expect(topLevelJavaKind(source(
      "public class Emitter {",
      "  interface Listener { void happened(); }",
      "  record Event(String name) {}",
      "}",
    ))).toBe("class");
  });

  it("keeps a class that declares its own annotation a class", () => {
    expect(topLevelJavaKind(source(
      "public class Rules {",
      "  @interface Internal {}",
      "}",
    ))).toBe("class");
  });

  it("ignores keywords inside strings and comments", () => {
    expect(topLevelJavaKind(source(
      "/* record Ghost(int a) {} */",
      "public class Quoted {",
      '  String hint = "enum Ghost { A }";',
      "  // interface Ghost {}",
      "}",
    ))).toBe("class");
  });

  it("ignores keywords inside a text block", () => {
    expect(topLevelJavaKind(source(
      "public class Template {",
      '  String sql = """',
      "    enum is a word in this text",
      '    """;',
      "}",
    ))).toBe("class");
  });

  it("is not thrown off by an annotation carrying braces", () => {
    expect(topLevelJavaKind(source(
      '@SuppressWarnings({"unchecked", "rawtypes"})',
      "public class Guarded {}",
    ))).toBe("class");
  });

  it("names a throwable by its name", () => {
    expect(topLevelJavaKind(source("public class ParseException extends RuntimeException {}"))).toBe("exception");
    expect(topLevelJavaKind(source("public class LinkageError extends Error {}"))).toBe("exception");
    expect(topLevelJavaKind(source("public class ExceptionHandler {}"))).toBe("class");
  });

  it("recognises a test before anything else", () => {
    expect(topLevelJavaKind(source(
      "import org.junit.jupiter.api.Test;",
      "public class ThingTest {",
      "  @Test void works() {}",
      "}",
    ))).toBe("junit");
  });

  it("falls back to a class when the file declares nothing", () => {
    expect(topLevelJavaKind("package de.beispiel;\n")).toBe("class");
    expect(topLevelJavaKind("")).toBe("class");
  });

  it("reads the kind off a file on disk", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kiwi-kind-"));
    const file = path.join(directory, "Mode.java");
    writeFileSync(file, source("public enum Mode { ON, OFF }"), "utf8");
    expect(await readJavaSourceKind(file)).toBe("enum");
    expect(await readJavaSourceKind(path.join(directory, "Missing.java"))).toBe("class");
  });
});

describe("blanking out comments and literals", () => {
  it("keeps the text the same length so indices still point at the same place", () => {
    const source = 'class A { String s = "hallo"; /* weg */ }';
    expect(maskJavaSource(source)).toHaveLength(source.length);
  });

  it("keeps the line structure of a block comment", () => {
    const masked = maskJavaSource("class A {\n/* eine\n   zweite */\n}\n");
    expect(masked.split("\n")).toHaveLength(5);
    expect(masked).toContain("class A {");
    expect(masked).not.toContain("zweite");
  });

  it("does not treat an escaped quote as the end of a string", () => {
    const masked = maskJavaSource('String s = "a \\" class B" ;');
    expect(masked).not.toContain("class B");
  });

  it("leaves an unterminated string from swallowing the rest of the file", () => {
    // A quote that is never closed ends at its line. Running to the end of the
    // file instead would blank every declaration below a single typo.
    const masked = maskJavaSource('String broken = "offen\nclass Danach {}\n');
    expect(masked).toContain("class Danach {}");
  });
});

describe("adding an import", () => {
  it("puts the import after the last one", () => {
    const source = "package de.beispiel;\n\nimport java.util.List;\n\nclass A {}\n";
    expect(addJavaImport(source, "java.util.Map")).toContain("import java.util.List;\nimport java.util.Map;");
  });

  it("puts the import after the package when there is none", () => {
    const source = "package de.beispiel;\n\nclass A {}\n";
    const next = addJavaImport(source, "java.util.Map");
    expect(next).toContain("package de.beispiel;\n\nimport java.util.Map;");
  });

  it("puts the import at the top of a file without a package", () => {
    expect(addJavaImport("class A {}\n", "java.util.Map")).toBe("import java.util.Map;\n\nclass A {}\n");
  });

  it("does not write the import into a commented-out one", () => {
    // A block comment holding old imports is what a file looks like while
    // somebody is trying something out. Appending after the last line that
    // begins with "import" put the new one inside the comment, where the
    // compiler never saw it and nobody could see why.
    const source = [
      "package de.beispiel;",
      "",
      "import java.util.List;",
      "",
      "/*",
      "import java.util.Set;",
      "*/",
      "",
      "class A {}",
      "",
    ].join("\n");
    const next = addJavaImport(source, "java.util.Map");
    expect(next.indexOf("import java.util.Map;")).toBeLessThan(next.indexOf("/*"));
  });
});

describe("the package a directory stands for", () => {
  const root = path.resolve("C:/projekt");
  const inside = (...parts: string[]) => path.join(root, ...parts);

  it("reads the package under src/main/java", () => {
    expect(packageForDirectory(root, inside("src", "main", "java", "de", "beispiel"))).toBe("de.beispiel");
  });

  it("reads the package under src/test/java", () => {
    expect(packageForDirectory(root, inside("src", "test", "java", "de", "beispiel"))).toBe("de.beispiel");
  });

  it("falls back to a bare src directory", () => {
    expect(packageForDirectory(root, inside("src", "de", "beispiel"))).toBe("de.beispiel");
  });

  it("answers with nothing for a directory that carries no source root", () => {
    expect(packageForDirectory(root, inside("build", "classes"))).toBe("");
  });

  it("uses the source root of the module, not one above it", () => {
    expect(packageForDirectory(root, inside("modul", "src", "main", "java", "de"))).toBe("de");
  });

  it("answers with nothing at the source root itself", () => {
    expect(packageForDirectory(root, inside("src", "main", "java"))).toBe("");
  });
});

describe("renaming the type a file is named after", () => {
  it("renames the declaration and its constructors", () => {
    const source = [
      "public class Alt {",
      "    public Alt() {}",
      "    private Alt(int wert) {}",
      "}",
      "",
    ].join("\n");
    const next = renameTopLevelJavaType(source, "Alt", "Neu");
    expect(next).toContain("public class Neu {");
    expect(next).toContain("public Neu() {}");
    expect(next).toContain("private Neu(int wert) {}");
  });

  it("renames a record, an enum, an interface and an annotation", () => {
    expect(renameTopLevelJavaType("public record Alt(int x) {}", "Alt", "Neu")).toContain("record Neu(");
    expect(renameTopLevelJavaType("enum Alt { A }", "Alt", "Neu")).toContain("enum Neu {");
    expect(renameTopLevelJavaType("sealed interface Alt {}", "Alt", "Neu")).toContain("interface Neu {");
    expect(renameTopLevelJavaType("public @interface Alt {}", "Alt", "Neu")).toContain("@interface Neu {");
  });

  it("leaves a name that only looks like the old one alone", () => {
    const source = "public class Alt {\n    AltKlasse helfer;\n}\n";
    expect(renameTopLevelJavaType(source, "Alt", "Neu")).toContain("AltKlasse helfer;");
  });
});
