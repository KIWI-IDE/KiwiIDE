import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  RotateCw,
  Copy,
  Check,
  Tag,
  User,
  Calendar,
  X,
  FileDiff,
  ExternalLink,
} from "lucide-react";
import { t } from "../i18n";

interface GitGraphViewProps {
  workspaceRoot: string;
  onClose?: () => void;
  onSelectCommit?: (hash: string) => void;
}

interface GitCommitItem {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  parents?: string[];
  refs?: string[];
}

export function GitGraphView({ workspaceRoot, onClose, onSelectCommit }: GitGraphViewProps) {
  const [commits, setCommits] = useState<GitCommitItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const loadCommits = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi?.git) return;
    setLoading(true);
    try {
      const log = await window.kiwi.git.log(workspaceRoot, 100);
      setCommits((log as GitCommitItem[]) || []);
      if (log?.length > 0 && !selectedHash) {
        setSelectedHash((log[0] as GitCommitItem).hash);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot, selectedHash]);

  useEffect(() => {
    loadCommits();
  }, [loadCommits]);

  const handleCopy = (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === selectedHash) || null,
    [commits, selectedHash]
  );

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
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
          <GitBranch size={16} color="var(--accent-color, #e5c07b)" />
          <strong style={{ fontSize: "13px" }}>Visueller Git-Graph & Historie</strong>
          <span style={{ fontSize: "11px", opacity: 0.6 }}>({commits.length} Commits)</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={loadCommits}
            title={t("Aktualisieren")}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <RotateCw size={14} className={loading ? "spinning" : ""} />
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

      {/* Main Container: Graph list + Details */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Commit list with graph track */}
        <div style={{ flex: 1, overflowY: "auto", borderRight: "1px solid var(--border-color, #333)" }}>
          {commits.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>
              {loading ? "Lade Git-Historie…" : "Keine Git-Commits gefunden."}
            </div>
          ) : (
            commits.map((c, idx) => {
              const isSelected = selectedHash === c.hash;
              const hasRefs = c.refs && c.refs.length > 0;
              const nodeColors = ["#4ec9b0", "#e5c07b", "#61afef", "#c678dd", "#e06c75"];
              const nodeColor = nodeColors[idx % nodeColors.length];

              return (
                <div
                  key={c.hash}
                  onClick={() => {
                    setSelectedHash(c.hash);
                    if (onSelectCommit) onSelectCommit(c.hash);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 14px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: isSelected ? "var(--bg-selected, rgba(255,255,255,0.08))" : "transparent",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  {/* Visual Node & Line */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "16px" }}>
                    <div
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: nodeColor,
                        border: isSelected ? "2px solid #fff" : "none",
                        boxShadow: isSelected ? `0 0 6px ${nodeColor}` : "none",
                      }}
                    />
                  </div>

                  {/* Commit Details */}
                  <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {hasRefs &&
                        c.refs!.map((ref) => (
                          <span
                            key={ref}
                            style={{
                              background: ref.includes("HEAD")
                                ? "rgba(97, 175, 239, 0.25)"
                                : "rgba(229, 192, 123, 0.25)",
                              color: ref.includes("HEAD") ? "#61afef" : "#e5c07b",
                              fontSize: "10px",
                              padding: "1px 6px",
                              borderRadius: "10px",
                              fontWeight: 600,
                            }}
                          >
                            {ref}
                          </span>
                        ))}
                      <strong style={{ color: isSelected ? "#fff" : "inherit" }}>{c.subject}</strong>
                    </div>
                    <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "2px", display: "flex", gap: "10px" }}>
                      <span>{c.author}</span>
                      <span>·</span>
                      <span>{formatDate(c.date)}</span>
                    </div>
                  </div>

                  {/* Hash */}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <code style={{ fontSize: "11px", opacity: 0.6 }}>{c.shortHash}</code>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(c.hash, e)}
                      title="Commit-Hash kopieren"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        padding: "2px 4px",
                        opacity: 0.6,
                      }}
                    >
                      {copiedHash === c.hash ? <Check size={11} color="#4ec9b0" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Selected Commit Inspection */}
        {selectedCommit && (
          <div
            style={{
              width: "320px",
              background: "var(--bg-secondary, #252526)",
              display: "flex",
              flexDirection: "column",
              padding: "16px",
              gap: "12px",
              overflowY: "auto",
            }}
          >
            <div>
              <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", opacity: 0.6 }}>
                Commit-Details
              </span>
              <h4 style={{ margin: "6px 0", fontSize: "13px", lineHeight: "1.4" }}>{selectedCommit.subject}</h4>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", opacity: 0.8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <User size={13} opacity={0.6} />
                <span>{selectedCommit.author}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={13} opacity={0.6} />
                <span>{formatDate(selectedCommit.date)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <GitCommitHorizontal size={13} opacity={0.6} />
                <code style={{ fontSize: "11px" }}>{selectedCommit.hash}</code>
              </div>
            </div>

            {selectedCommit.parents && selectedCommit.parents.length > 0 && (
              <div style={{ fontSize: "11px" }}>
                <span style={{ opacity: 0.6 }}>Eltern-Commits: </span>
                {selectedCommit.parents.map((p) => (
                  <code key={p} style={{ marginRight: "4px", opacity: 0.8 }}>
                    {p.slice(0, 7)}
                  </code>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
