import { Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IdeSettings, ProjectInfo, ProjectSettings } from "../types";
import { findTheme } from "../themes";
import { SettingsDialog } from "./SettingsDialog";
import { createSettingsBundle, mergeLayouts, readSettingsBundle } from "../settings-transfer";
import { StandaloneWindowFrame } from "./StandaloneWindowLayout";
import { WindowRequestEpoch } from "./window-request-epoch";
import { t } from "../i18n";

const emptyProject: ProjectInfo = {
  type: "Java",
  buildFile: null,
  javaVersion: "",
};

export function SettingsWindowApp() {
  const initialRoot = new URLSearchParams(window.location.search).get("projectRoot") || "";
  const requests = useRef(new WindowRequestEpoch(initialRoot));
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [project, setProject] = useState<ProjectInfo>(emptyProject);
  const [workspaceRoot, setWorkspaceRoot] = useState(initialRoot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [backgroundImageData, setBackgroundImageData] = useState("");

  // The settings window is its own BrowserWindow, so it carries its own theme
  // attribute rather than inheriting one from the workbench.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", findTheme(settings?.theme || "").id);
    document.documentElement.style.setProperty("--roundness", String(Math.max(0, Math.min(250, settings?.uiRoundness ?? 100)) / 100));
  }, [settings?.theme]);

  const loadProject = useCallback(async (root: string) => {
    const request = requests.current.begin(root);
    setLoading(true);
    setError("");
    setWorkspaceRoot(root);
    setProject(emptyProject);
    try {
      const nextSettings = await window.kiwi!.settings.get();
      if (!requests.current.isCurrent(request)) return;
      const nextProject = root ? await window.kiwi!.project.detect(root) : emptyProject;
      if (!requests.current.isCurrent(request)) return;
      setSettings(nextSettings);
      setProject(nextProject);
    } catch (reason) {
      if (!requests.current.isCurrent(request)) return;
      setError(reason instanceof Error ? reason.message : "Einstellungen konnten nicht geladen werden.");
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.kiwi) {
      setError("Kiwi API ist nicht verfügbar.");
      setLoading(false);
      return;
    }
    void loadProject(initialRoot);
    const removeContext = window.kiwi.app.onSettingsContext(({ projectRoot }) => {
      void loadProject(projectRoot || "");
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      window.kiwi?.app.close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      requests.current.invalidate();
      removeContext();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [initialRoot, loadProject]);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    const removeGlobal = window.kiwi.settings.onChanged(({ settings: next }) => setSettings(next));
    const removeProject = window.kiwi.project.onSettingsChanged(({ root }) => {
      if (!workspaceRoot || !requests.current.matchesRoot(root)) return;
      const request = requests.current.capture();
      void window.kiwi!.project.detect(workspaceRoot)
        .then((next) => {
          if (requests.current.isCurrent(request)) setProject(next);
        })
        .catch(() => undefined);
    });
    return () => {
      removeGlobal();
      removeProject();
    };
  }, [workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    if (!settings?.backgroundImage || !window.kiwi) {
      setBackgroundImageData("");
      return;
    }
    void window.kiwi.settings.backgroundImageData(settings.backgroundImage)
      .then((data) => {
        if (!cancelled) setBackgroundImageData(data);
      })
      .catch(() => {
        if (!cancelled) setBackgroundImageData("");
      });
    return () => {
      cancelled = true;
    };
  }, [settings?.backgroundImage]);

  const saveGlobalSettings = async (patch: Partial<IdeSettings>) => {
    const request = requests.current.capture();
    const next = await window.kiwi!.settings.update(patch);
    if (requests.current.isCurrent(request)) setSettings(next);
    return next;
  };

  const saveProjectSettings = async (patch: Partial<ProjectSettings>) => {
    if (!workspaceRoot) return undefined;
    const root = workspaceRoot;
    const request = requests.current.capture();
    const next = await window.kiwi!.project.updateSettings(root, patch);
    if (!requests.current.isCurrent(request)) return next;
    const detected = await window.kiwi!.project.detect(root);
    if (requests.current.isCurrent(request)) setProject(detected);
    return next;
  };

  return (
    <StandaloneWindowFrame
      title={t("Einstellungen")}
      projectRoot={workspaceRoot}
      settings={settings}
      backgroundImageData={backgroundImageData}
    >
      {loading ? (
        <div className="settings-window-state">
          <span className="kiwi-spinner"><Settings size={26} /></span>
          <strong>{t("Einstellungen werden geladen …")}</strong>
          <p>{t("Kiwi liest die IDE- und Projekteinstellungen ein.")}</p>
        </div>
      ) : error || !settings ? (
        <div className="settings-window-state error">
          <Settings size={34} />
          <strong>{t("Einstellungen konnten nicht geöffnet werden")}</strong>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void loadProject(workspaceRoot)}>{t("Erneut versuchen")}</button>
        </div>
      ) : (
        <SettingsDialog
          key={`${workspaceRoot}:${project.javaVersion}:${project.projectJdkPath || ""}`}
          embedded
          settings={settings}
          project={project}
          workspaceRoot={workspaceRoot}
          onClose={() => window.kiwi?.app.close()}
          onGlobalChange={saveGlobalSettings}
          onProjectChange={saveProjectSettings}
          onSelectGlobalJdk={() => window.kiwi!.project.selectJdk()}
          onSelectProjectJdk={() => window.kiwi!.project.selectJdk()}
          onResetGlobal={async () => {
            const request = requests.current.capture();
            const next = await window.kiwi!.settings.reset();
            if (requests.current.isCurrent(request)) setSettings(next);
            return next;
          }}
          onExportSettings={async () => {
            // The layouts live in the workbench's own storage, and the settings
            // window is a separate one — so it reads them from there rather
            // than from a state it does not have.
            const layouts = JSON.parse(localStorage.getItem("kiwi.workbench.layouts.v1") || "[]");
            const bundle = createSettingsBundle(settings, Array.isArray(layouts) ? layouts : []);
            await window.kiwi!.settings.exportBundle(JSON.stringify(bundle, null, 2));
          }}
          onImportSettings={async () => {
            const text = await window.kiwi!.settings.importBundle();
            if (!text) return null;
            const { settings: incoming, layouts } = readSettingsBundle(text);
            const next = await window.kiwi!.settings.update(incoming);
            if (layouts.length) {
              const existing = JSON.parse(localStorage.getItem("kiwi.workbench.layouts.v1") || "[]");
              localStorage.setItem(
                "kiwi.workbench.layouts.v1",
                JSON.stringify(mergeLayouts(Array.isArray(existing) ? existing : [], layouts)),
              );
            }
            setSettings(next);
            return next;
          }}
          onCheckUpdates={() => window.kiwi!.app.checkForUpdates()}
          onOpenUpdate={async (url) => {
            await window.kiwi!.app.openUpdate(url);
          }}
        />
      )}
    </StandaloneWindowFrame>
  );
}
