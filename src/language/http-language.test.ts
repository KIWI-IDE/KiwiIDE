import { describe, expect, it } from "vitest";
import {
  HTTP_EXTENSIONS,
  HTTP_LANGUAGE_ID,
  httpLanguageDefinition,
  installHttpLanguage,
  resetHttpLanguageForTests,
} from "./http-language";
import { parseHttpFile } from "./http-file";
import { languageFromPath } from "../utils";

type Rule = [RegExp, unknown];

const rules = (state: string): Rule[] => {
  const tokenizer = httpLanguageDefinition().tokenizer as Record<string, unknown[]>;
  return tokenizer[state].filter((entry): entry is Rule =>
    Array.isArray(entry) && entry[0] instanceof RegExp);
};

const matches = (state: string, text: string) => rules(state).filter(([pattern]) => pattern.test(text));

describe("highlighting .http files", () => {
  it("is the language a request file resolves to", () => {
    expect(languageFromPath("orders.http")).toBe(HTTP_LANGUAGE_ID);
    expect(languageFromPath("orders.rest")).toBe(HTTP_LANGUAGE_ID);
    expect(HTTP_EXTENSIONS).toEqual([".http", ".rest"]);
  });

  it("recognises every method the parser accepts", () => {
    const methodRule = rules("root").find(([pattern]) => pattern.source.includes("POST"));
    expect(methodRule).toBeDefined();
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]) {
      expect(methodRule![0].test(`${method} https://a.test`)).toBe(true);
    }
    // The grammar must not colour what the parser refuses to send.
    expect(methodRule![0].test("FETCH https://a.test")).toBe(false);
    expect(parseHttpFile("FETCH https://a.test")).toEqual([]);
  });

  it("separates the name line from an ordinary comment", () => {
    const separator = matches("root", "### Alle Bestellungen");
    expect(separator[0][1]).toBe("comment.doc");
    expect(matches("root", "# nur ein Kommentar")[0][1]).toBe("comment");
    expect(matches("root", "// auch einer")[0][1]).toBe("comment");
  });

  it("colours a variable definition and a placeholder differently", () => {
    const definition = matches("root", "@host = https://api.test");
    expect((definition[0][1] as string[])[0]).toBe("variable");
    // A placeholder survives into the URL, so it needs its own colour there.
    expect(matches("url", "{{host}}").length).toBeGreaterThan(0);
    expect(matches("headerValue", "{{token}}").length).toBeGreaterThan(0);
  });

  it("does not mistake a header for a request line", () => {
    const headerRule = rules("root").find(([pattern]) => pattern.source.includes("A-Za-z0-9-]+)(\\s*:"));
    expect(headerRule![0].test("Content-Type: application/json")).toBe(true);
    // A URL contains a colon too, but the method rule is listed first and the
    // header pattern must not swallow a line that starts with one.
    expect(headerRule![0].test("GET https://a.test")).toBe(false);
  });
});

describe("installing the HTTP language", () => {
  const fakeMonaco = () => {
    const calls = { commands: [] as string[], lensProviders: 0, languages: [] as string[] };
    const providers: any[] = [];
    return {
      calls,
      providers,
      monaco: {
        Range: class { constructor(public a: number, public b: number, public c: number, public d: number) {} },
        languages: {
          register: (entry: any) => calls.languages.push(entry.id),
          setMonarchTokensProvider: () => undefined,
          setLanguageConfiguration: () => undefined,
          registerCodeLensProvider: (_id: string, provider: any) => {
            calls.lensProviders += 1;
            providers.push(provider);
          },
        },
        editor: {
          registerCommand: (id: string, handler: any) => {
            calls.commands.push(id);
            (fakeMonaco as any).handler = handler;
          },
        },
      } as never,
    };
  };

  it("registers the send command globally, not on one editor", () => {
    resetHttpLanguageForTests();
    const { calls, providers, monaco } = fakeMonaco();
    const sent: number[] = [];
    installHttpLanguage(monaco, (line) => sent.push(line));

    // The lens names a command id; unless that exact id is in Monaco's global
    // registry the click resolves to nothing and the request is never sent.
    // `editor.addAction` registers under an editor-scoped id, which is why it
    // is not enough on its own.
    const lens = providers[0].provideCodeLenses({ getValue: () => "### Test\nGET https://a.test\n" }).lenses[0];
    expect(calls.commands).toContain(lens.command.id);
    (fakeMonaco as any).handler(null, ...lens.command.arguments);
    expect(sent).toEqual([2]);
  });

  it("installs once so a second editor does not double every lens", () => {
    resetHttpLanguageForTests();
    const { calls, monaco } = fakeMonaco();
    installHttpLanguage(monaco, () => undefined);
    const second: number[] = [];
    installHttpLanguage(monaco, (line) => second.push(line));
    expect(calls.lensProviders).toBe(1);
    expect(calls.languages).toEqual([HTTP_LANGUAGE_ID]);
    // The newest handler still wins, so a remount does not leave a stale one.
    (fakeMonaco as any).handler(null, 7);
    expect(second).toEqual([7]);
  });
});
