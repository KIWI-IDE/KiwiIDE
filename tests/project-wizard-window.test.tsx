import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StandaloneWindowFrame } from "../src/components/StandaloneWindowLayout";

describe("New Project and Project Structure standalone windows", () => {
  it("renders the standalone window frame for New Project", () => {
    const html = renderToStaticMarkup(
      <StandaloneWindowFrame title="Neues Projekt">
        <div className="wizard-standalone-container">
          <div className="project-wizard">Wizard Content</div>
        </div>
      </StandaloneWindowFrame>,
    );

    expect(html).toContain("standalone-window-shell");
    expect(html).toContain("Neues Projekt");
    expect(html).toContain("wizard-standalone-container");
    expect(html).toContain('aria-label="Schließen"');
  });

  it("registers wizard in windowKinds and IPC in main.cjs and preload.cjs", () => {
    const mainSource = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
    const preloadSource = readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");

    expect(mainSource).toContain('wizard: { width: 1100, height: 760');
    expect(mainSource).toContain('ipcMain.handle("app:openNewProject"');
    expect(preloadSource).toContain('openNewProject: (initialLocation) => invoke("app:openNewProject", initialLocation)');
  });

  it("keeps ProjectWizard out of assistant-side-panel", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    // ProjectWizard must not be inside assistant-side-panel
    expect(appSource).not.toMatch(/<aside className="assistant-side-panel"[^>]*>\s*\{projectWizardOpen/);
    expect(appSource).toContain('windowKind === "wizard" || windowKind === "newProject"');
    expect(appSource).toContain('window.kiwi.app?.openStructure');
    expect(appSource).toContain('window.kiwi?.app?.openNewProject');
  });

  it("provides import project options in Datei menu and ProjectHub", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const hubSource = readFileSync(new URL("../src/components/ProjectHub.tsx", import.meta.url), "utf8");

    expect(appSource).toContain('label: "Projekt importieren…"');
    expect(hubSource).toContain('{t("Importieren")}');
  });
});
