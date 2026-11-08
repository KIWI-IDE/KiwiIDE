import { useEffect, useState } from "react";
import type { IdeSettings, ProjectSpec } from "../types";
import { StandaloneWindowFrame } from "./StandaloneWindowLayout";
import { ProjectWizard } from "./ProjectWizard";
import { t } from "../i18n";

export function ProjectWizardWindowApp() {
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [initialLocation, setInitialLocation] = useState<string>("");

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const loc = searchParams.get("initialLocation") || "";
    setInitialLocation(loc);

    window.kiwi?.settings.get().then(setSettings).catch(() => undefined);

    const removeContext = window.kiwi?.app?.onWizardContext?.((context) => {
      if (context.initialLocation) setInitialLocation(context.initialLocation);
    });

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.kiwi?.app.close();
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      removeContext?.();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const handleCreate = async (spec: ProjectSpec) => {
    if (!window.kiwi) return;
    const project = await window.kiwi.project.create(spec);
    if (project?.root) {
      await window.kiwi.app.openEditor(project.root);
    }
    window.kiwi.app.close();
  };

  return (
    <StandaloneWindowFrame
      title={t("Neues Projekt")}
      settings={settings}
      className="wizard-window-frame"
    >
      <div className="wizard-standalone-container">
        <ProjectWizard
          embedded={false}
          initialLocation={initialLocation}
          chooseLocation={() => window.kiwi?.project.chooseLocation() || Promise.resolve(null)}
          chooseJdk={() => window.kiwi?.project.selectJdk() || Promise.resolve(null)}
          onCreate={handleCreate}
          onClose={() => window.kiwi?.app.close()}
        />
      </div>
    </StandaloneWindowFrame>
  );
}
