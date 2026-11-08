import React, { useState, useEffect, useCallback } from "react";
import {
  Container,
  Play,
  Square,
  RotateCw,
  Trash2,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Box,
  Terminal,
  ExternalLink,
  X,
  HardDrive,
} from "lucide-react";
import { t } from "../i18n";

interface DockerPanelProps {
  workspaceRoot: string;
  onClose?: () => void;
  onExecuteInTerminal?: (cmd: string) => void;
}

interface DockerContainerItem {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

interface DockerImageItem {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export function DockerPanel({ workspaceRoot, onClose, onExecuteInTerminal }: DockerPanelProps) {
  const [activeTab, setActiveTab] = useState<"containers" | "images">("containers");
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [dockerVersion, setDockerVersion] = useState("");
  const [containers, setContainers] = useState<DockerContainerItem[]>([]);
  const [images, setImages] = useState<DockerImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const checkDocker = useCallback(async () => {
    if (!window.kiwi?.docker) return;
    setLoading(true);
    try {
      const check = await window.kiwi.docker.check();
      setDockerAvailable(check.available);
      setDockerVersion(check.version || "");
      if (check.available) {
        const [cList, iList] = await Promise.all([
          window.kiwi.docker.containers(true),
          window.kiwi.docker.images(),
        ]);
        setContainers(cList || []);
        setImages(iList || []);
      }
    } catch {
      setDockerAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkDocker();
  }, [checkDocker]);

  const handleContainerAction = async (id: string, action: string) => {
    if (!window.kiwi?.docker) return;
    setActionInProgress(id);
    setStatusMessage(`Container ${id} (${action})…`);
    try {
      await window.kiwi.docker.containerAction(id, action);
      setTimeout(async () => {
        await checkDocker();
        setActionInProgress(null);
        setStatusMessage(null);
      }, 1000);
    } catch (err) {
      setActionInProgress(null);
      setStatusMessage(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleComposeAction = async (action: string) => {
    if (!window.kiwi?.docker) return;
    setStatusMessage(`Docker Compose ${action}…`);
    try {
      if (onExecuteInTerminal) {
        onExecuteInTerminal(`docker compose ${action === "up" ? "up -d" : action}`);
      } else {
        await window.kiwi.docker.composeAction(workspaceRoot, action);
      }
      setTimeout(async () => {
        await checkDocker();
        setStatusMessage(null);
      }, 1500);
    } catch (err) {
      setStatusMessage(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg-editor, #1e1e1e)",
        color: "var(--text-main, #cccccc)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          background: "var(--bg-secondary, #252526)",
          borderBottom: "1px solid var(--border-color, #333)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Container size={16} color="var(--accent-color, #0ea5e9)" />
          <strong style={{ fontSize: "13px" }}>Docker & Container Explorer</strong>
          {dockerAvailable && (
            <span style={{ fontSize: "11px", opacity: 0.6 }}>{dockerVersion}</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {dockerAvailable && (
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                onClick={() => handleComposeAction("up")}
                style={{
                  background: "var(--bg-button, #3a3a3a)",
                  border: "none",
                  color: "#fff",
                  borderRadius: "3px",
                  padding: "3px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Play size={10} fill="currentColor" />
                <span>Compose Up</span>
              </button>
              <button
                type="button"
                onClick={() => handleComposeAction("down")}
                style={{
                  background: "var(--bg-button, #3a3a3a)",
                  border: "none",
                  color: "#f48771",
                  borderRadius: "3px",
                  padding: "3px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Square size={10} fill="currentColor" />
                <span>Compose Down</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={checkDocker}
            title={t("Aktualisieren")}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <RefreshCw size={14} className={loading ? "spinning" : ""} />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t("Schließen")}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: "4px",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "2px",
          padding: "4px 16px 0",
          background: "var(--bg-secondary, #252526)",
          borderBottom: "1px solid var(--border-color, #333)",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("containers")}
          style={{
            background: activeTab === "containers" ? "var(--bg-editor, #1e1e1e)" : "transparent",
            color: activeTab === "containers" ? "#fff" : "var(--text-muted, #888)",
            border: "none",
            borderBottom: activeTab === "containers" ? "2px solid #0ea5e9" : "none",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Container ({containers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("images")}
          style={{
            background: activeTab === "images" ? "var(--bg-editor, #1e1e1e)" : "transparent",
            color: activeTab === "images" ? "#fff" : "var(--text-muted, #888)",
            border: "none",
            borderBottom: activeTab === "images" ? "2px solid #0ea5e9" : "none",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Images ({images.length})
        </button>
      </div>

      {/* Status bar */}
      {statusMessage && (
        <div style={{ padding: "6px 16px", background: "rgba(14, 165, 233, 0.15)", fontSize: "11px", borderBottom: "1px solid var(--border-color, #333)" }}>
          {statusMessage}
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {dockerAvailable === false ? (
          <div style={{ textAlign: "center", padding: "40px", opacity: 0.7 }}>
            <AlertTriangle size={32} color="#e5c07b" style={{ marginBottom: "12px" }} />
            <h3 style={{ margin: "0 0 6px 0", fontSize: "14px" }}>Docker ist nicht verfügbar</h3>
            <p style={{ margin: 0, fontSize: "12px", opacity: 0.8 }}>
              Stelle sicher, dass Docker Desktop installiert und gestartet ist.
            </p>
          </div>
        ) : activeTab === "containers" ? (
          <div>
            {containers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>
                <Box size={32} style={{ marginBottom: "8px" }} />
                <div>Keine Container vorhanden.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {containers.map((c) => {
                  const isRunning = c.state === "running" || (c.status && c.status.startsWith("Up"));
                  return (
                    <div
                      key={c.id}
                      style={{
                        background: "var(--bg-secondary, #252526)",
                        border: "1px solid var(--border-color, #333)",
                        borderRadius: "6px",
                        padding: "10px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: isRunning ? "#4ec9b0" : "#f48771",
                            display: "inline-block",
                          }}
                        />
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <strong style={{ fontSize: "13px" }}>{c.names.replace(/^\//, "") || c.id.slice(0, 12)}</strong>
                            <span style={{ fontSize: "11px", opacity: 0.6 }}>({c.image})</span>
                          </div>
                          <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "2px" }}>
                            {c.status} {c.ports ? `· ${c.ports}` : ""}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "6px" }}>
                        {isRunning ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleContainerAction(c.id, "restart")}
                              disabled={actionInProgress === c.id}
                              title="Neustarten"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "inherit",
                                borderRadius: "3px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <RotateCw size={11} />
                              <span>Restart</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleContainerAction(c.id, "stop")}
                              disabled={actionInProgress === c.id}
                              title="Stoppen"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "#f48771",
                                borderRadius: "3px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <Square size={11} fill="currentColor" />
                              <span>Stop</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleContainerAction(c.id, "start")}
                              disabled={actionInProgress === c.id}
                              title="Starten"
                              style={{
                                background: "var(--accent-color, #0ea5e9)",
                                border: "none",
                                color: "#fff",
                                borderRadius: "3px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <Play size={11} fill="currentColor" />
                              <span>Start</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleContainerAction(c.id, "rm")}
                              disabled={actionInProgress === c.id}
                              title="Löschen"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "#f48771",
                                borderRadius: "3px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            {images.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>
                <HardDrive size={32} style={{ marginBottom: "8px" }} />
                <div>Keine Images gefunden.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {images.map((img) => (
                  <div
                    key={`${img.id}-${img.repository}-${img.tag}`}
                    style={{
                      background: "var(--bg-secondary, #252526)",
                      border: "1px solid var(--border-color, #333)",
                      borderRadius: "6px",
                      padding: "10px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <strong style={{ fontSize: "13px" }}>{img.repository}</strong>
                        <span style={{ fontSize: "11px", opacity: 0.7, background: "rgba(0,0,0,0.2)", padding: "1px 5px", borderRadius: "3px" }}>
                          {img.tag}
                        </span>
                      </div>
                      <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "2px" }}>
                        Größe: {img.size} {img.created ? `· Erstellt: ${img.created}` : ""}
                      </div>
                    </div>
                    <code style={{ fontSize: "11px", opacity: 0.5 }}>{img.id.slice(0, 12)}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
