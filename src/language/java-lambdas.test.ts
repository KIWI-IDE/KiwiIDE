import { describe, expect, it } from "vitest";
import { findJavaSyntaxProblems } from "./java-syntax";
import { findJavaTestTargets } from "./java-tests";
import { classifyJavaWord, javaLanguageDefinition } from "./java-tokenizer";

const lambdaSource = [
  "package de.demo;",
  "import org.junit.jupiter.api.Test;",
  "class ServiceTest {",
  "    private final Runnable task = () -> System.out.println(\"x\");",
  "    private final Comparator<String> byLength = (a, b) -> a.length() - b.length();",
  "    @Test",
  "    void handlesLambdas() {",
  "        items.forEach(item -> {",
  "            process(item);",
  "        });",
  "        var mapped = items.stream().map(String::valueOf).toList();",
  "        String label = switch (kind) {",
  "            case A -> \"a\";",
  "            default -> \"b\";",
  "        };",
  "    }",
  "}",
].join("\n");

describe("lambdas, method references and switch expressions", () => {
  it("does not mistake a lambda body for unbalanced structure", () => {
    expect(findJavaSyntaxProblems(lambdaSource)).toEqual([]);
  });
  it("test discovery finds exactly the annotated method", () => {
    expect(findJavaTestTargets(lambdaSource, "ServiceTest.java")
      .filter((t) => t.kind === "method").map((t) => t.id))
      .toEqual(["de.demo.ServiceTest#handlesLambdas"]);
  });
  // "var" is lowercase, so the convention rule would otherwise call it a name.
  it("treats var as a keyword", () => {
    expect(classifyJavaWord("var")).toBe("keyword");
  });

  it("colours the target of a method reference as a method", () => {
    const root = javaLanguageDefinition().tokenizer.root as unknown[];
    const rules = root.filter((entry): entry is [RegExp, string[]] =>
      Array.isArray(entry) && entry[0] instanceof RegExp && Array.isArray(entry[1]));
    const forReference = rules.filter(([pattern]) => pattern.source.includes("::"));
    // One rule for the constructor form, one for an ordinary method.
    expect(forReference.map(([, tokens]) => tokens[2])).toEqual(["keyword.java.new", "method"]);
    const [constructor, method] = forReference;
    expect(method[0].test("::valueOf")).toBe(true);
    // The boundary keeps "::newValue" from being split into "::new" and "Value".
    expect(constructor[0].test("::new")).toBe(true);
    expect(constructor[0].test("::newValue")).toBe(false);
  });
});
