import React, { useState, useEffect, useCallback } from "react";
import {
  Package,
  Search,
  Download,
  Trash2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Plus,
  Loader2,
  X,
} from "lucide-react";
import { t } from "../i18n";

interface NpmPackageManagerProps {
  workspaceRoot: string;
  onClose?: () => void;
  onExecuteCommand?: (cmd: string) => void;
}

interface PackageJsonData {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NpmSearchResult {
  name: string;
  version: string;
  description: string;
  keywords?: string[];
  publisher?: { username: string };
  links?: { npm?: string; repository?: string };
}

export function NpmPackageManager({ workspaceRoot, onClose, onExecuteCommand }: NpmPackageManagerProps) {
  const [activeTab, setActiveTab] = useState<"installed" | "search">("installed");
  const [packageJson, setPackageJson] = useState<PackageJsonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NpmSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const loadPackageJson = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const pkgPath = `${workspaceRoot.replace(/\\/g, "/")}/package.json`;
      const content = await window.kiwi.file.read(pkgPath);
      const parsed = JSON.parse(content);
      setPackageJson(parsed);
    } catch {
      setPackageJson(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    loadPackageJson();
  }, [loadPackageJson]);

  const runNpmCommand = async (cmd: string, packageName: string) => {
    setInstallingPackage(packageName);
    setMessage({ text: `Führe „${cmd}“ aus…`, type: "info" });
    try {
      if (onExecuteCommand) {
        onExecuteCommand(cmd);
      } else if (window.kiwi?.terminal) {
        await window.kiwi.terminal.execute({ root: workspaceRoot, command: cmd });
      }
      setTimeout(async () => {
        await loadPackageJson();
        setInstallingPackage(null);
        setMessage({ text: `„${cmd}“ erfolgreich abgeschlossen.`, type: "success" });
      }, 1500);
    } catch (err) {
      setInstallingPackage(null);
      setMessage({ text: `Fehler: ${err instanceof Error ? err.message : String(err)}`, type: "error" });
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setSearching(true);
    try {
      const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=12`);
      if (res.ok) {
        const data = await res.json();
        const results = (data.objects || []).map((obj: any) => ({
          name: obj.package.name,
          version: obj.package.version,
          description: obj.package.description || "",
          keywords: obj.package.keywords || [],
          publisher: obj.package.publisher,
          links: obj.package.links,
        }));
        setSearchResults(results);
      }
    } catch {
      setMessage({ text: "Konnte npm Registry nicht erreichen.", type: "error" });
    } finally {
      setSearching(false);
    }
  };

  const deps = Object.entries(packageJson?.dependencies || {});
  const devDeps = Object.entries(packageJson?.devDependencies || {});

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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Package size={16} color="var(--accent-color, #0e639c)" />
          <strong style={{ fontSize: "13px" }}>NPM Package Manager</strong>
          {packageJson?.name && (
            <span style={{ fontSize: "11px", opacity: 0.6 }}>
              ({packageJson.name} {packageJson.version ? `v${packageJson.version}` : ""})
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={loadPackageJson}
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
          onClick={() => setActiveTab("installed")}
          style={{
            background: activeTab === "installed" ? "var(--bg-editor, #1e1e1e)" : "transparent",
            color: activeTab === "installed" ? "var(--text-main, #ffffff)" : "var(--text-muted, #888)",
            border: "none",
            borderBottom: activeTab === "installed" ? "2px solid var(--accent-color, #0e639c)" : "none",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {t("Installierte Pakete")} ({deps.length + devDeps.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("search")}
          style={{
            background: activeTab === "search" ? "var(--bg-editor, #1e1e1e)" : "transparent",
            color: activeTab === "search" ? "var(--text-main, #ffffff)" : "var(--text-muted, #888)",
            border: "none",
            borderBottom: activeTab === "search" ? "2px solid var(--accent-color, #0e639c)" : "none",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {t("Pakete durchsuchen (npm)")}
        </button>
      </div>

      {/* Status Alert */}
      {message && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: "11px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background:
              message.type === "success"
                ? "rgba(78, 201, 176, 0.15)"
                : message.type === "error"
                ? "rgba(244, 135, 113, 0.15)"
                : "rgba(50, 150, 250, 0.15)",
            borderBottom: "1px solid var(--border-color, #333)",
          }}
        >
          {message.type === "success" ? (
            <CheckCircle2 size={13} color="#4ec9b0" />
          ) : message.type === "error" ? (
            <AlertCircle size={13} color="#f48771" />
          ) : (
            <Loader2 size={13} className="spinning" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Tab Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {activeTab === "installed" ? (
          <div>
            {!packageJson && !loading ? (
              <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>
                <Package size={32} style={{ marginBottom: "8px" }} />
                <div>Keine <code>package.json</code> im Projekt gefunden.</div>
              </div>
            ) : (
              <div>
                {/* Dependencies */}
                <div style={{ marginBottom: "20px" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", opacity: 0.7 }}>
                    Dependencies ({deps.length})
                  </h4>
                  {deps.length === 0 ? (
                    <div style={{ fontSize: "12px", opacity: 0.5, fontStyle: "italic" }}>Keine Produktions-Abhängigkeiten definiert.</div>
                  ) : (
                    <div style={{ display: "grid", gap: "6px" }}>
                      {deps.map(([name, ver]) => (
                        <div
                          key={name}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "var(--bg-secondary, #252526)",
                            padding: "6px 10px",
                            borderRadius: "4px",
                            border: "1px solid var(--border-color, #333)",
                            fontSize: "12px",
                          }}
                        >
                          <div>
                            <strong>{name}</strong>
                            <span style={{ marginLeft: "8px", color: "var(--accent-color, #4ec9b0)", fontSize: "11px" }}>{ver}</span>
                          </div>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              type="button"
                              onClick={() => runNpmCommand(`npm install ${name}@latest`, name)}
                              disabled={installingPackage === name}
                              title="Auf neueste Version aktualisieren"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "inherit",
                                borderRadius: "3px",
                                padding: "2px 6px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              onClick={() => runNpmCommand(`npm uninstall ${name}`, name)}
                              disabled={installingPackage === name}
                              title="Deinstallieren"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "#f48771",
                                borderRadius: "3px",
                                padding: "2px 6px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* DevDependencies */}
                <div>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", opacity: 0.7 }}>
                    DevDependencies ({devDeps.length})
                  </h4>
                  {devDeps.length === 0 ? (
                    <div style={{ fontSize: "12px", opacity: 0.5, fontStyle: "italic" }}>Keine Entwicklungs-Abhängigkeiten definiert.</div>
                  ) : (
                    <div style={{ display: "grid", gap: "6px" }}>
                      {devDeps.map(([name, ver]) => (
                        <div
                          key={name}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "var(--bg-secondary, #252526)",
                            padding: "6px 10px",
                            borderRadius: "4px",
                            border: "1px solid var(--border-color, #333)",
                            fontSize: "12px",
                          }}
                        >
                          <div>
                            <strong>{name}</strong>
                            <span style={{ marginLeft: "8px", color: "var(--accent-color, #4ec9b0)", fontSize: "11px" }}>{ver}</span>
                          </div>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              type="button"
                              onClick={() => runNpmCommand(`npm install --save-dev ${name}@latest`, name)}
                              disabled={installingPackage === name}
                              title="Auf neueste Version aktualisieren"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "inherit",
                                borderRadius: "3px",
                                padding: "2px 6px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              onClick={() => runNpmCommand(`npm uninstall ${name}`, name)}
                              disabled={installingPackage === name}
                              title="Deinstallieren"
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-input, #555)",
                                color: "#f48771",
                                borderRadius: "3px",
                                padding: "2px 6px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Search Form */}
            <form onSubmit={handleSearch} style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  background: "var(--bg-input, #3c3c3c)",
                  border: "1px solid var(--border-input, #555)",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  gap: "6px",
                }}
              >
                <Search size={14} style={{ opacity: 0.6 }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Paketname suchen (z. B. express, lodash, tailwindcss, axios)…"
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
              <button
                type="submit"
                disabled={searching}
                style={{
                  background: "var(--accent-color, #0e639c)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {searching ? <Loader2 size={13} className="spinning" /> : <Search size={13} />}
                <span>Suchen</span>
              </button>
            </form>

            {/* Results */}
            <div style={{ display: "grid", gap: "10px" }}>
              {searchResults.map((pkg) => {
                const isInstalled = packageJson?.dependencies?.[pkg.name] || packageJson?.devDependencies?.[pkg.name];
                return (
                  <div
                    key={pkg.name}
                    style={{
                      background: "var(--bg-secondary, #252526)",
                      border: "1px solid var(--border-color, #333)",
                      borderRadius: "6px",
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <strong style={{ fontSize: "13px" }}>{pkg.name}</strong>
                          <span style={{ fontSize: "11px", opacity: 0.6 }}>v{pkg.version}</span>
                          {isInstalled && (
                            <span
                              style={{
                                background: "rgba(78, 201, 176, 0.2)",
                                color: "#4ec9b0",
                                fontSize: "10px",
                                padding: "1px 6px",
                                borderRadius: "3px",
                              }}
                            >
                              Installiert
                            </span>
                          )}
                        </div>
                        <p style={{ margin: "4px 0 6px 0", fontSize: "12px", opacity: 0.8 }}>{pkg.description}</p>
                      </div>

                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => runNpmCommand(`npm install ${pkg.name}`, pkg.name)}
                          disabled={installingPackage === pkg.name}
                          style={{
                            background: "var(--accent-color, #0e639c)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "3px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Download size={12} />
                          <span>Install</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => runNpmCommand(`npm install --save-dev ${pkg.name}`, pkg.name)}
                          disabled={installingPackage === pkg.name}
                          style={{
                            background: "transparent",
                            color: "inherit",
                            border: "1px solid var(--border-input, #555)",
                            borderRadius: "3px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Plus size={12} />
                          <span>Dev</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
