import { describe, expect, it } from "vitest";
import {
  assertSendableUrl,
  expandHttpVariables,
  parseHttpFile,
  parseHttpVariables,
  requestAtLine,
} from "./http-file";

const file = [
  "@host = https://api.example.test",
  "@token = secret-123",
  "",
  "### Alle Bestellungen",
  "GET {{host}}/orders",
  "Accept: application/json",
  "Authorization: Bearer {{token}}",
  "",
  "### Bestellung anlegen",
  "POST {{host}}/orders HTTP/1.1",
  "Content-Type: application/json",
  "",
  "{",
  '  "item": "Kiwi"',
  "}",
  "",
  "###",
  "# nur ein Kommentar, keine Anfrage",
  "DELETE {{host}}/orders/1",
].join("\n");

describe("reading .http files", () => {
  it("splits the file into its requests", () => {
    const requests = parseHttpFile(file);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET https://api.example.test/orders",
      "POST https://api.example.test/orders",
      "DELETE https://api.example.test/orders/1",
    ]);
  });

  it("keeps the name from the separator line", () => {
    expect(parseHttpFile(file).map((request) => request.name)).toEqual([
      "Alle Bestellungen",
      "Bestellung anlegen",
      // Without a name the request line itself is the label.
      "DELETE https://api.example.test/orders/1",
    ]);
  });

  it("resolves variables in the URL, the headers and the body", () => {
    const [list, create] = parseHttpFile(file);
    expect(list.headers).toEqual([
      { name: "Accept", value: "application/json" },
      { name: "Authorization", value: "Bearer secret-123" },
    ]);
    expect(create.body).toBe('{\n  "item": "Kiwi"\n}');
  });

  it("lets a later variable build on an earlier one", () => {
    const variables = parseHttpVariables("@base = https://a.test\n@url = {{base}}/v1\n");
    expect(variables.url).toBe("https://a.test/v1");
    // An unknown name stays visible instead of turning into an empty string.
    expect(expandHttpVariables("{{missing}}/x", variables)).toBe("{{missing}}/x");
  });

  it("ignores comments and lines that are not requests", () => {
    const requests = parseHttpFile([
      "# a comment",
      "// another one",
      "not a request at all",
      "FETCH https://example.test",
      "### real",
      "GET https://example.test/ok",
    ].join("\n"));
    // FETCH is not an HTTP method, so it must not become a request.
    expect(requests.map((request) => request.url)).toEqual(["https://example.test/ok"]);
  });

  it("reports the line so the gutter can point at the request", () => {
    const requests = parseHttpFile(file);
    expect(requests.map((request) => request.line)).toEqual([5, 10, 19]);
  });

  it("finds the request the cursor sits in", () => {
    const requests = parseHttpFile(file);
    expect(requestAtLine(requests, 6)?.name).toBe("Alle Bestellungen");
    expect(requestAtLine(requests, 14)?.name).toBe("Bestellung anlegen");
    expect(requestAtLine(requests, 1)).toBeNull();
  });

  it("sends only http and https", () => {
    expect(assertSendableUrl("https://example.test/a").host).toBe("example.test");
    expect(assertSendableUrl("http://example.test").protocol).toBe("http:");
    // One keystroke sends these, so anything that could read the disk or reach
    // a different subsystem is refused before a request is built.
    expect(() => assertSendableUrl("file:///C:/Windows/win.ini")).toThrow(/Schema/);
    expect(() => assertSendableUrl("/orders")).toThrow(/vollständige URL/);
    expect(() => assertSendableUrl("javascript:alert(1)")).toThrow(/Schema/);
  });

  it("survives an empty or malformed file", () => {
    expect(parseHttpFile("")).toEqual([]);
    expect(parseHttpFile("###\n###\n")).toEqual([]);
  });
});
