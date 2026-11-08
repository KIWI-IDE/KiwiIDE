import React, { useState, useEffect, useRef } from "react";
import {
  Globe,
  RotateCw,
  ExternalLink,
  Smartphone,
  Tablet,
  Monitor,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { t } from "../i18n";

interface WebPreviewProps {
  initialUrl?: string;
  workspaceRoot?: string;
  onClose?: () => void;
}

type DeviceMode = "responsive" | "tablet" | "mobile";

export function WebPreviewPanel({ initialUrl = "http://localhost:5173", workspaceRoot, onClose }: WebPreviewProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("responsive");
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setInputUrl(url);
    setLoadError(false);
    setIsLoading(true);
  }, [url]);

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target) return;
    if (!target.startsWith("http://") && !target.startsWith("https://") && !target.startsWith("file://")) {
      target = `http://${target}`;
    }
    setUrl(target);
    setInputUrl(target);
  };

  const handleReload = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      setLoadError(false);
      try {
        iframeRef.current.src = url;
      } catch {
        // Fallback
        const current = url;
        setUrl("");
        setTimeout(() => setUrl(current), 50);
      }
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleOpenExternal = () => {
    if ((window.kiwi as any)?.window?.openExternal) {
      void (window.kiwi as any).window.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };

  const getContainerWidth = () => {
    switch (deviceMode) {
      case "mobile":
        return "375px";
      case "tablet":
        return "768px";
      default:
        return "100%";
    }
  };

  return (
    <div className="web-preview-container" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "var(--bg-editor, #1e1e1e)", color: "var(--text-main, #cccccc)" }}>
      {/* Navigation Toolbar */}
      <div
        className="web-preview-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          background: "var(--bg-secondary, #252526)",
          borderBottom: "1px solid var(--border-color, #333)",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            onClick={handleReload}
            title={t("Neu laden")}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <RotateCw size={14} className={isLoading ? "spinning" : ""} />
          </button>
        </div>

        <form onSubmit={handleNavigate} style={{ flex: 1, display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              background: "var(--bg-input, #3c3c3c)",
              border: "1px solid var(--border-input, #555)",
              borderRadius: "4px",
              padding: "2px 8px",
              gap: "6px",
            }}
          >
            <Globe size={13} style={{ opacity: 0.6 }} />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://localhost:5173"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "inherit",
                fontSize: "12px",
                outline: "none",
              }}
            />
          </div>
        </form>

        {/* Preset quick links */}
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            onClick={() => { setUrl("http://localhost:5173"); setInputUrl("http://localhost:5173"); }}
            title="Vite Dev Server (Port 5173)"
            style={{
              background: url.includes("5173") ? "var(--accent-color, #0e639c)" : "var(--bg-button, #3a3a3a)",
              border: "none",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: "3px",
              fontSize: "10px",
              cursor: "pointer",
            }}
          >
            :5173
          </button>
          <button
            type="button"
            onClick={() => { setUrl("http://localhost:3000"); setInputUrl("http://localhost:3000"); }}
            title="React / Node Port 3000"
            style={{
              background: url.includes("3000") ? "var(--accent-color, #0e639c)" : "var(--bg-button, #3a3a3a)",
              border: "none",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: "3px",
              fontSize: "10px",
              cursor: "pointer",
            }}
          >
            :3000
          </button>
          <button
            type="button"
            onClick={() => { setUrl("http://localhost:8080"); setInputUrl("http://localhost:8080"); }}
            title="Express / Java Port 8080"
            style={{
              background: url.includes("8080") ? "var(--accent-color, #0e639c)" : "var(--bg-button, #3a3a3a)",
              border: "none",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: "3px",
              fontSize: "10px",
              cursor: "pointer",
            }}
          >
            :8080
          </button>
        </div>

        {/* Device Mode Switcher */}
        <div style={{ display: "flex", background: "var(--bg-input, #333)", borderRadius: "4px", padding: "2px" }}>
          <button
            type="button"
            onClick={() => setDeviceMode("responsive")}
            title={t("Desktop / Responsiv")}
            style={{
              background: deviceMode === "responsive" ? "var(--accent-color, #0e639c)" : "transparent",
              border: "none",
              color: "#fff",
              padding: "3px 6px",
              borderRadius: "3px",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <Monitor size={13} />
          </button>
          <button
            type="button"
            onClick={() => setDeviceMode("tablet")}
            title={t("Tablet (768px)")}
            style={{
              background: deviceMode === "tablet" ? "var(--accent-color, #0e639c)" : "transparent",
              border: "none",
              color: "#fff",
              padding: "3px 6px",
              borderRadius: "3px",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <Tablet size={13} />
          </button>
          <button
            type="button"
            onClick={() => setDeviceMode("mobile")}
            title={t("Mobile (375px)")}
            style={{
              background: deviceMode === "mobile" ? "var(--accent-color, #0e639c)" : "transparent",
              border: "none",
              color: "#fff",
              padding: "3px 6px",
              borderRadius: "3px",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <Smartphone size={13} />
          </button>
        </div>

        {/* Copy & External Browser */}
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            onClick={handleCopyUrl}
            title={copied ? t("Kopiert!") : t("URL kopieren")}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {copied ? <Check size={14} color="#4ec9b0" /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={handleOpenExternal}
            title={t("Im externen Browser öffnen")}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* Frame Area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "stretch",
          background: deviceMode === "responsive" ? "var(--bg-editor, #1e1e1e)" : "#111111",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: getContainerWidth(),
            height: "100%",
            transition: "width 0.2s ease-in-out",
            background: "#ffffff",
            boxShadow: deviceMode !== "responsive" ? "0 4px 20px rgba(0,0,0,0.5)" : "none",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {url ? (
            <iframe
              ref={iframeRef}
              src={url}
              title="Web Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                background: "#ffffff",
              }}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setLoadError(true);
              }}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666" }}>
              {t("Keine URL geladen")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
