import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { germanKeys, hasTranslation, locales, setActiveLocale, t } from "./i18n";

/**
 * Example values carry no language of their own: a compiler flag, a sample
 * coordinate, a JDK path. Translating them would be wrong, so they are named
 * here rather than left to look like an oversight.
 */
const withoutTranslation = new Set([
  "CODETOGETTER",
  // The two kinds of template, written the same in every language Kiwi offers.
  "Live",
  "Postfix",
  "Rename",
  "Continue",
  "Pause",
  "Replace",
  "Run",
  "Stage all",
  "Stop",
  "-Xlint:all",
  "-Xlint:all -parameters",
  "-Xmx1G -Dspring.profiles.active=dev",
  "2 Spaces",
  "4 Spaces",
  "8 Spaces",
  "Aa",
  "Alt + Enter",
  "Annotate / Blame",
  "Artifact ID",
  "BaseService",
  "Beta",
  "C:\\Program Files\\Java\\jdk-21",
  "CLI Application · Picocli",
  "CPU · JFR 60 s",
  "Code",
  "Commit & Push",
  "Commits",
  "Core API 2.0 + Tools",
  "Ctrl ,",
  "Ctrl P",
  "Ctrl Shift B",
  "Ctrl Shift F11",
  "Ctrl+D",
  "Ctrl+F4",
  "Ctrl+Shift+C",
  "Ctrl+Shift+F",
  "Deps",
  "Docker",
  "Docker Compose",
  "Enter",
  "Exception Breakpoint",
  "F2",
  "Frameworks",
  "Git",
  "GitHub Token",
  "Gradle",
  "Gradle Task",
  "Group ID",
  "ISO-8859-1",
  "Inline",
  "JUnit",
  "Jakarta Persistence",
  "Java Application",
  "JavaFX Desktop",
  "Javadoc",
  "Kiwi",
  "Kiwi IDE",
  "Maven Goal",
  "Modifier",
  "Name",
  "Nested",
  "PROFILE=dev;PORT=8080",
  "PS",
  "Packages",
  "Parameter",
  "PowerShell",
  "Profiler",
  "Profiler…",
  "Pull",
  "Pull Requests",
  "Push",
  "REST API · Spring Boot",
  "Resources",
  "Reviews",
  "Run to Cursor",
  "Runnable, Serializable",
  "Shift+F6",
  "Sources",
  "Spring Boot Web",
  "Stable",
  "Stage",
  "Step Into",
  "Step Out",
  "Step Over",
  "Stop process",
  "Test-Resources",
  "Thread Dump",
  "Threads & Call Stack",
  "Token",
  "UTF-8",
  "Version",
  "Watch expression",
  "Windows-1252",
  "abstract",
  "caught",
  "dependencyManagement",
  "dev.kiwi.core",
  "dist, legacy-cache",
  "esc",
  "final",
  "generated-legacy, vendor",
  "https://updates.example.org/kiwi.json",
  "libs/legacy.jar",
  "module-info.java",
  "public",
  "uncaught",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name) || name.includes(".test.")) return [];
    return [path];
  });
}

describe("interface language", () => {
  it("has an English text for everything the translator is asked for", () => {
    // The German text stays in the components, so a label only becomes
    // English if the dictionary knows it. Without this, adding a control
    // leaves a German word in the English interface and nothing says so.
    setActiveLocale("en");
    // Two shapes reach the dictionary: an explicit t("…") call, and the plain
    // German a settings row hands to the wrapper that translates it. The second
    // was invisible here, so a new row could quietly stay German.
    const patterns = [
      /\bt\("([^"]+)"\)/g,
      /<(?:SettingsRow|SettingsSection|ToggleRow)[^>]*?\s(?:title|description)="([^"]+)"/gs,
    ];
    const untranslated: string[] = [];
    for (const path of sourceFiles("src")) {
      const source = readFileSync(path, "utf8");
      const values = patterns.flatMap((expression) => [...source.matchAll(expression)].map((match) => match[1]));
      // The same prop written as an expression — description={open ? "a" : "b"}
      // — reads past the pattern above and can hold several texts. Each of them
      // is shown on its own, so each of them needs a translation of its own.
      for (const branch of source.matchAll(/\s(?:title|description)=\{([^}]*)\}/gs)) {
        values.push(...[...branch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
      }
      for (const value of values) {
        if (!/[A-Za-zÄÖÜäöüß]/.test(value)) continue;
        if (withoutTranslation.has(value)) continue;
        if (!hasTranslation(value)) untranslated.push(`${path}: ${value}`);
      }
    }
    expect(untranslated).toEqual([]);
  });

  it("falls back to the German source rather than showing a blank", () => {
    setActiveLocale("en");
    expect(t("Ein Text, den niemand übersetzt hat")).toBe("Ein Text, den niemand übersetzt hat");
    setActiveLocale("de");
    expect(t("Speichern")).toBe("Speichern");
    expect(locales.map((entry) => entry.id)).toContain("en");
  });

  it("lets every language it offers survive the trip through settings", () => {
    // The main process validates the stored settings and cannot import this
    // module across the process boundary, so it keeps the list a second time.
    // A language missing there is reset to German on the way back, which looks
    // from the outside exactly like a dictionary nobody filled in — the symptom
    // that sent this hunting once already.
    const service = readFileSync("electron/services/settings-service.cjs", "utf8");
    const declared = /const LOCALES = \[([^\]]*)\]/.exec(service)?.[1] || "";
    const accepted = [...declared.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    expect(accepted).toEqual(locales.map((entry) => entry.id));
  });

  it("offers every language the dictionaries were written for", () => {
    expect(locales.map((entry) => entry.id))
      .toEqual(["de", "en", "fr", "es", "it", "nl", "pl", "pt", "hu", "tr", "ru"]);
    // The label is what the dropdown shows, and a language names itself in its
    // own words — a Russian speaker looks for Русский, not for "Russisch".
    expect(locales.find((entry) => entry.id === "ru")?.label).toBe("Русский");
  });

  /** Every language that is not the German source, and not English. */
  const later = ["fr", "es", "ru", "it", "nl", "pl", "pt", "hu", "tr"] as const;

  it("translates rather than repeats the German in every language", () => {
    for (const locale of later) {
      setActiveLocale(locale);
      expect(t("Speichern")).not.toBe("Speichern");
      expect(t("Einstellungen")).not.toBe("Einstellungen");
    }
    setActiveLocale("de");
  });

  it("shows English, not German, where a later language has no word yet", () => {
    // Untranslated German would be the one language a reader who picked Russian
    // is least likely to know, so the chain passes through English first.
    setActiveLocale("fr");
    expect(hasTranslation("Dokumentation", "fr")).toBe(false);
    expect(t("Dokumentation")).toBe("Documentation");
    // Past English the chain ends, and the German source is what is left.
    expect(t("Ein Text, den niemand übersetzt hat")).toBe("Ein Text, den niemand übersetzt hat");
    setActiveLocale("de");
  });

  it("keeps the later dictionaries anchored to keys English actually has", () => {
    // A typo in a German key is silent: the entry simply never matches. Held
    // against English — which the guard above keeps complete — it is visible.
    for (const locale of later) {
      const stray = germanKeys(locale).filter((key) => !hasTranslation(key, "en"));
      expect({ locale, stray }).toEqual({ locale, stray: [] });
    }
  });

  it("covers most of the interface in every language", () => {
    // Not every key needs an entry — Terminal, Java and Package are written the
    // same — but a language that has drifted far behind English is a defect the
    // interface would show as a patchwork.
    const english = germanKeys("en").length;
    for (const locale of later) {
      expect({ locale, share: germanKeys(locale).length / english > 0.93 })
        .toEqual({ locale, share: true });
    }
  });
});
