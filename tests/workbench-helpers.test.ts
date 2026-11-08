import { describe, expect, it } from "vitest";
import { fileKind } from "../src/workbench/workbench-helpers";

describe("workbench helpers - fileKind", () => {
  it("recognizes .tsx files as tsx", () => {
    expect(fileKind("App.tsx")).toBe("tsx");
    expect(fileKind("components/Button.tsx")).toBe("tsx");
  });

  it("recognizes .jsx files as jsx", () => {
    expect(fileKind("index.jsx")).toBe("jsx");
    expect(fileKind("Widget.jsx")).toBe("jsx");
  });

  it("recognizes .ts files as typescript and .js as javascript", () => {
    expect(fileKind("main.ts")).toBe("typescript");
    expect(fileKind("bundle.js")).toBe("javascript");
    expect(fileKind("helper.mjs")).toBe("javascript");
    expect(fileKind("config.cjs")).toBe("javascript");
  });

  it("recognizes Java and Gradle files", () => {
    expect(fileKind("Main.java")).toBe("java");
    expect(fileKind("build.gradle")).toBe("gradle");
    expect(fileKind("build.gradle.kts")).toBe("gradle");
  });
});
