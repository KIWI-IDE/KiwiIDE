import { describe, expect, it } from "vitest";

const SAMPLE = [
  "public class Person {",
  "    private final String name;",
  "    private int age;",
  "    private boolean active;",
  "}",
].join("\n");

describe("selective member generation", () => {
  it("generates a constructor for the chosen fields only", () => {
    const result = generateJavaMembers(SAMPLE, "constructor", { fields: ["name", "age"] });
    expect(result).toContain("public Person(String name, int age)");
    expect(result).not.toContain("boolean active)");
  });

  it("generates getters without setters", () => {
    const result = generateJavaMembers(SAMPLE, "getters");
    expect(result).toContain("public String getName()");
    expect(result).toContain("public boolean isActive()");
    expect(result).not.toContain("void set");
  });

  it("generates setters without getters and skips final fields", () => {
    const result = generateJavaMembers(SAMPLE, "setters");
    expect(result).toContain("public void setAge(int age)");
    expect(result).toContain("public void setActive(boolean active)");
    // `name` is final, so it can never take a setter.
    expect(result).not.toContain("setName");
    expect(result).not.toContain("getAge");
  });

  it("restricts accessors to the selected field", () => {
    const result = generateJavaMembers(SAMPLE, "accessors", { fields: ["age"] });
    expect(result).toContain("public int getAge()");
    expect(result).toContain("public void setAge(int age)");
    expect(result).not.toContain("getName");
    expect(result).not.toContain("isActive");
  });

  it("reports an empty selection instead of generating everything", () => {
    expect(() => generateJavaMembers(SAMPLE, "constructor", { fields: ["missing"] }))
      .toThrow(/kein Feld ausgewählt/);
  });

  it("keeps declaration order regardless of the selection order", () => {
    const result = generateJavaMembers(SAMPLE, "constructor", { fields: ["age", "name"] });
    expect(result).toContain("public Person(String name, int age)");
  });
});
import { generateJavaMembers, parseJavaFields } from "./java-code-generation";

const source = `package dev.kiwi;

public class Person {
    private final String name;
    private int age;
}
`;

describe("Java code generation", () => {
  it("finds instance fields and generates a constructor", () => {
    expect(parseJavaFields(source)).toHaveLength(2);
    const result = generateJavaMembers(source, "constructor");
    expect(result).toContain("public Person(String name, int age)");
    expect(result).toContain("this.name = name;");
  });

  it("generates accessors without a setter for final fields", () => {
    const result = generateJavaMembers(source, "accessors");
    expect(result).toContain("String getName()");
    expect(result).not.toContain("setName");
    expect(result).toContain("void setAge(int age)");
  });

  it("generates equals, hashCode and toString", () => {
    expect(generateJavaMembers(source, "equalsHashCode")).toContain("java.util.Objects.hash(name, age)");
    expect(generateJavaMembers(source, "toString")).toContain('return "Person{"');
  });
});

describe("constructors without fields", () => {
  it("generates a parameterless constructor when nothing is selected", () => {
    const source = "package de.demo;\n\npublic class Entity {\n    private String name;\n}\n";
    const result = generateJavaMembers(source, "constructor", { fields: [] });
    expect(result).toContain("public Entity() {");
    // No assignments and no stray blank line inside the body.
    expect(result).not.toContain("this.name = name;");
    expect(result).toMatch(/public Entity\(\) \{\n {4}\}/);
  });

  it("generates one for a class that has no fields at all", () => {
    const source = "public class Marker {\n}\n";
    // Every other kind still refuses, because there is nothing to work from.
    expect(generateJavaMembers(source, "constructor", {})).toContain("public Marker() {");
    expect(() => generateJavaMembers(source, "getters", {})).toThrow(/Instanzfelder/);
  });

  it("adds a no-arg constructor next to one that takes arguments", () => {
    // The JPA case: an all-args constructor exists and the no-arg one is what
    // is missing. The broad duplicate check would have refused this.
    const source = [
      "public class Order {",
      "    private String id;",
      "    public Order(String id) {",
      "        this.id = id;",
      "    }",
      "}",
    ].join("\n");
    expect(generateJavaMembers(source, "constructor", { fields: [] })).toContain("public Order() {");
  });

  it("refuses a second parameterless constructor", () => {
    const source = "public class Order {\n    public Order() {\n    }\n}\n";
    expect(() => generateJavaMembers(source, "constructor", { fields: [] })).toThrow(/bereits vorhanden/);
  });

  it("still refuses a duplicate all-field constructor", () => {
    const source = [
      "public class Order {",
      "    private String id;",
      "    public Order(String id) {",
      "        this.id = id;",
      "    }",
      "}",
    ].join("\n");
    expect(() => generateJavaMembers(source, "constructor", { fields: ["id"] })).toThrow(/bereits vorhanden/);
  });
});
