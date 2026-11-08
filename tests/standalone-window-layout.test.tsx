import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  StandaloneDocumentHeader,
  StandaloneWindowFooter,
  StandaloneWindowFrame,
  StandaloneWindowNavigation,
} from "../src/components/StandaloneWindowLayout";

describe("standalone Kiwi window layout", () => {
  it("renders the shared window chrome with a compact project title", () => {
    const html = renderToStaticMarkup(
      <StandaloneWindowFrame title="Einstellungen" projectRoot="C:\\workspace\\demo">
        <div>Inhalt</div>
      </StandaloneWindowFrame>,
    );

    expect(html).toContain("standalone-window-shell");
    expect(html).toContain("Einstellungen · demo");
    expect(html).toContain('aria-label="Minimieren"');
    expect(html).toContain('aria-label="Maximieren"');
    expect(html).toContain('aria-label="Schließen"');
  });

  it("keeps header, navigation and save state accessible in both windows", () => {
    const html = renderToStaticMarkup(
      <section className="standalone-window-document">
        <StandaloneDocumentHeader id="window-title" icon={<span>i</span>} title="Projektstruktur" description="Projektmodell" />
        <StandaloneWindowNavigation label="Bereiche"><button>Projekt</button></StandaloneWindowNavigation>
        <StandaloneWindowFooter status="Alle Projekteinstellungen sind gespeichert" tone="success">
          <button disabled>Anwenden</button>
        </StandaloneWindowFooter>
      </section>,
    );

    expect(html).toContain('id="window-title"');
    expect(html).toContain('aria-label="Bereiche"');
    expect(html).toContain('role="status"');
    expect(html).toContain("standalone-window-success");
    expect(html).toContain("disabled");
  });

  it("uses the shared document components in settings and project structure", () => {
    const settingsSource = readFileSync(new URL("../src/components/SettingsDialog.tsx", import.meta.url), "utf8");
    const structureSource = readFileSync(new URL("../src/components/ProjectStructureWindowApp.tsx", import.meta.url), "utf8");

    for (const component of ["StandaloneDocumentHeader", "StandaloneWindowNavigation", "StandaloneWindowFooter"]) {
      expect(settingsSource).toContain(component);
      expect(structureSource).toContain(component);
    }
    expect(structureSource).toContain('className="standalone-window-document structure-window-document"');
  });

  it("clears project-bound drafts before reading a reused window context", () => {
    const settingsSource = readFileSync(new URL("../src/components/SettingsWindowApp.tsx", import.meta.url), "utf8");
    const structureSource = readFileSync(new URL("../src/components/ProjectStructureWindowApp.tsx", import.meta.url), "utf8");
    const firstStructureRead = structureSource.indexOf("await window.kiwi!.settings.get()");

    expect(structureSource.indexOf("setDraft(null)")).toBeGreaterThan(-1);
    expect(structureSource.indexOf("setDraft(null)")).toBeLessThan(firstStructureRead);
    expect(structureSource.indexOf("setModules([])")).toBeLessThan(firstStructureRead);
    expect(structureSource.indexOf("setAudit(null)")).toBeLessThan(firstStructureRead);
    expect(structureSource).toContain("requests.current.isCurrent(request)");
    expect(settingsSource).toContain("requests.current.isCurrent(request)");
    expect(settingsSource.indexOf("setProject(emptyProject)")).toBeLessThan(settingsSource.indexOf("await window.kiwi!.settings.get()"));
  });
});
