import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { findJavaTestTargets } from "./java-tests";

const require = createRequire(import.meta.url);
const { discoverTestsInSource } = require("../../electron/services/test-service.cjs");

const fixture = [
  "package de.demo;",
  "",
  "import org.junit.jupiter.api.Nested;",
  "import org.junit.jupiter.api.Test;",
  "",
  "class OrderTest {",
  "    @Test",
  "    void placesAnOrder() {}",
  "",
  "    void helper() {}",
  "",
  "    @org.junit.jupiter.params.ParameterizedTest",
  "    void acceptsEveryCurrency(String code) {}",
  "",
  "    @Nested",
  "    class Refunds {",
  "        @Test",
  "        void refundsFully() {}",
  "    }",
  "}",
].join("\n");

describe("test targets in the open buffer", () => {
  it("puts the icon on the signature, not on the annotation", () => {
    const targets = findJavaTestTargets(fixture, "OrderTest.java");
    expect(targets.find((target) => target.label === "placesAnOrder")).toEqual({
      line: 8,
      kind: "method",
      id: "de.demo.OrderTest#placesAnOrder",
      label: "placesAnOrder",
    });
  });

  it("offers the class as its own target", () => {
    const classes = findJavaTestTargets(fixture, "OrderTest.java").filter((target) => target.kind === "class");
    expect(classes.map((target) => target.id)).toEqual(["de.demo.OrderTest", "de.demo.OrderTest$Refunds"]);
  });

  it("skips methods without a test annotation", () => {
    const targets = findJavaTestTargets(fixture, "OrderTest.java");
    expect(targets.some((target) => target.label === "helper")).toBe(false);
  });

  it("covers parameterized tests and nested classes", () => {
    const ids = findJavaTestTargets(fixture, "OrderTest.java")
      .filter((target) => target.kind === "method")
      .map((target) => target.id);
    expect(ids).toEqual([
      "de.demo.OrderTest#placesAnOrder",
      "de.demo.OrderTest#acceptsEveryCurrency",
      "de.demo.OrderTest$Refunds#refundsFully",
    ]);
  });

  // The gutter has to start exactly the test the tool window would, or the
  // icon runs something other than what it sits next to.
  it("agrees with the discovery in the main process on every identifier", () => {
    const fromGutter = findJavaTestTargets(fixture, "OrderTest.java")
      .filter((target) => target.kind === "method")
      .map((target) => target.id)
      .sort();
    const fromDiscovery = discoverTestsInSource(fixture, "OrderTest.java")
      .flatMap((suite: any) => suite.methods.map((method: any) => method.id))
      .sort();
    expect(fromGutter).toEqual(fromDiscovery);
  });

  it("stays empty for a file without tests", () => {
    expect(findJavaTestTargets("package de.demo;\npublic class Plain { void run() {} }", "Plain.java")).toEqual([]);
  });
});
