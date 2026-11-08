import { Maximize2, Minus, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { IdeSettings } from "../types";
import { personalizationVariables } from "../themes";
import { KiwiLogo } from "./KiwiLogo";
import { t } from "../i18n";

type WindowTone = "default" | "success" | "error";

export function StandaloneWindowFrame({
  title,
  projectRoot,
  settings,
  backgroundImageData = "",
  className = "",
  children,
}: {
  title: string;
  projectRoot?: string;
  settings?: IdeSettings | null;
  backgroundImageData?: string;
  className?: string;
  children: ReactNode;
}) {
  const projectName = projectRoot?.split(/[\\/]/).filter(Boolean).at(-1) || "";
  const shellStyle = settings ? {
    ...personalizationVariables(settings),
    "--workspace-background-image": backgroundImageData ? `url(${JSON.stringify(backgroundImageData)})` : "none",
    "--workspace-background-opacity": String(settings.backgroundOpacity / 100),
    zoom: settings.uiScale,
  } as CSSProperties : undefined;
  const shellClasses = [
    "app-shell",
    "standalone-window-shell",
    "settings-window-shell",
    className,
    backgroundImageData ? "has-workspace-background" : "",
    `density-${settings?.uiDensity || "compact"}`,
    settings?.reducedMotion ? "reduced-motion" : "",
    settings?.screenReaderMode ? "screen-reader-mode" : "",
    settings?.enhancedFocus ? "enhanced-focus" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClasses} style={shellStyle}>
      <header className="titlebar settings-window-titlebar standalone-window-titlebar">
        <div className="brand">
          <KiwiLogo size={22} />
          <strong>{t("Kiwi")}</strong>
          <span>{t(title)}{projectName ? ` · ${projectName}` : ""}</span>
        </div>
        <div className="window-controls">
          <button onClick={() => window.kiwi?.app.minimize()} aria-label={t("Minimieren")}><Minus size={15} /></button>
          <button onClick={() => window.kiwi?.app.maximize()} aria-label={t("Maximieren")}><Maximize2 size={13} /></button>
          <button className="close" onClick={() => window.kiwi?.app.close()} aria-label={t("Schließen")}><X size={15} /></button>
        </div>
      </header>
      <main className="settings-window-content standalone-window-content">{children}</main>
    </div>
  );
}

export function StandaloneDocumentHeader({
  id,
  icon,
  title,
  description,
  actions,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="settings-header standalone-document-header">
      <div>{icon}<span><strong id={id}>{t(title)}</strong><small>{t(description)}</small></span></div>
      {actions && <div className="settings-header-actions">{actions}</div>}
    </header>
  );
}

export function StandaloneWindowNavigation({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav className={`settings-categories standalone-window-navigation ${className}`.trim()} aria-label={label}>
      {children}
    </nav>
  );
}

export function StandaloneWindowFooter({
  status,
  tone = "default",
  className = "",
  children,
}: {
  status: ReactNode;
  tone?: WindowTone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <footer className={`settings-apply-bar standalone-window-footer ${className}`.trim()}>
      <span
        className={tone === "error" ? "settings-apply-error" : tone === "success" ? "standalone-window-success" : ""}
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
      <div>{children}</div>
    </footer>
  );
}
