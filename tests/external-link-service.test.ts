import { describe, expect, it } from "vitest";

const { assertExternalLinkUrl } = require("../electron/services/external-link-service.cjs");
const { assertUpdateDownloadUrl } = require("../electron/services/update-service.cjs");

describe("external documentation links", () => {
  it.each([
    "http://example.com/docs",
    "https://example.com/docs#building",
    "mailto:dev@example.com?subject=Kiwi%20IDE",
  ])("opens %s without applying update-download restrictions", (url) => {
    expect(assertExternalLinkUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Windows/system32/cmd.exe",
    "ms-settings:privacy",
    "./README.md",
    "https://user:password@example.com/",
    "java\tscript:alert(1)",
  ])("refuses %s", (url) => {
    expect(() => assertExternalLinkUrl(url)).toThrow();
  });

  it("keeps the update-download validator restricted", () => {
    expect(() => assertUpdateDownloadUrl("http://example.com/setup.exe")).toThrow();
    expect(() => assertUpdateDownloadUrl("https://example.com/setup.exe#fragment")).toThrow();
  });
});
