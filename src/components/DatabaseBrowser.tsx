import React, { useState, useEffect, useCallback } from "react";
import {
  Database,
  Table as TableIcon,
  Play,
  RotateCw,
  Columns,
  Key,
  Clock,
  Rows,
  Download,
  AlertCircle,
  FileCode,
  X,
  Plus,
} from "lucide-react";
import { t } from "../i18n";

interface DatabaseBrowserProps {
  workspaceRoot: string;
  onClose?: () => void;
}

interface TableColumn {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: any;
  pk: boolean;
}

interface TableInfo {
  name: string;
  rowCount: number;
  columns: TableColumn[];
}

interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  executionTimeMs: number;
  isSelect: boolean;
}

export function DatabaseBrowser({ workspaceRoot, onClose }: DatabaseBrowserProps) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [sqlQuery, setSqlQuery] = useState("SELECT * FROM sqlite_master WHERE type='table';");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const findDatabases = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi?.database) return;
    try {
      const found = await window.kiwi.database.find(workspaceRoot);
      setDatabases(found);
      if (found.length > 0 && !selectedDb) {
        setSelectedDb(found[0]);
      }
    } catch {
      // ignore
    }
  }, [workspaceRoot, selectedDb]);

  useEffect(() => {
    findDatabases();
  }, [findDatabases]);

  const loadSchema = useCallback(async (dbPath: string) => {
    if (!dbPath || !window.kiwi?.database) return;
    setLoadingSchema(true);
    try {
      const schema = await window.kiwi.database.schema(dbPath);
      setTables(schema.tables || []);
      if (schema.tables?.length > 0 && !selectedTable) {
        setSelectedTable(schema.tables[0].name);
        setSqlQuery(`SELECT * FROM "${schema.tables[0].name}" LIMIT 100;`);
      }
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSchema(false);
    }
  }, [selectedTable]);

  useEffect(() => {
    if (selectedDb) {
      loadSchema(selectedDb);
    }
  }, [selectedDb, loadSchema]);

  const runQuery = async (customSql?: string) => {
    if (!selectedDb || !window.kiwi?.database) return;
    const sql = customSql || sqlQuery;
    setExecuting(true);
    setQueryError(null);
    try {
      const result = await window.kiwi.database.query(selectedDb, sql);
      setQueryResult(result);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
      setQueryResult(null);
    } finally {
      setExecuting(false);
    }
  };

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    const query = `SELECT * FROM "${tableName}" LIMIT 100;`;
    setSqlQuery(query);
    runQuery(query);
  };

  const exportCsv = () => {
    if (!queryResult || !queryResult.rows.length) return;
    const header = queryResult.columns.join(",");
    const body = queryResult.rows
      .map((row) =>
        queryResult.columns
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return "";
            const str = String(val).replace(/"/g, '""');
            return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedTable || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      {/* Header Toolbar */}
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
          <Database size={16} color="var(--accent-color, #0e639c)" />
          <strong style={{ fontSize: "13px" }}>Datenbank-Browser & SQL-Editor</strong>

          {/* Database Selector */}
          <select
            value={selectedDb}
            onChange={(e) => setSelectedDb(e.target.value)}
            style={{
              background: "var(--bg-input, #3c3c3c)",
              border: "1px solid var(--border-input, #555)",
              color: "inherit",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "12px",
            }}
          >
            {databases.length === 0 ? (
              <option value="">Keine .sqlite / .db Datei gefunden</option>
            ) : (
              databases.map((db) => {
                const name = db.split(/[\\/]/).pop() || db;
                return (
                  <option key={db} value={db}>
                    {name} ({db})
                  </option>
                );
              })
            )}
          </select>

          <button
            type="button"
            onClick={findDatabases}
            title={t("Datenbanken neu scannen")}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <RotateCw size={13} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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

      {/* Main Grid: Sidebar + Editor/Result */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Sidebar: Tables */}
        <div
          style={{
            width: "240px",
            borderRight: "1px solid var(--border-color, #333)",
            background: "var(--bg-secondary, #252526)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
              opacity: 0.7,
              borderBottom: "1px solid var(--border-color, #333)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Tabellen ({tables.length})</span>
            {loadingSchema && <RotateCw size={12} className="spinning" />}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
            {tables.length === 0 ? (
              <div style={{ padding: "12px", fontSize: "12px", opacity: 0.6, fontStyle: "italic" }}>
                Keine Tabellen gefunden.
              </div>
            ) : (
              tables.map((tbl) => {
                const isSelected = selectedTable === tbl.name;
                return (
                  <div key={tbl.name} style={{ marginBottom: "4px" }}>
                    <button
                      type="button"
                      onClick={() => handleSelectTable(tbl.name)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 8px",
                        background: isSelected ? "var(--bg-selected, rgba(255,255,255,0.08))" : "transparent",
                        border: "none",
                        borderRadius: "4px",
                        color: isSelected ? "#fff" : "inherit",
                        cursor: "pointer",
                        fontSize: "12px",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <TableIcon size={13} color="var(--accent-color, #4ec9b0)" />
                        <strong>{tbl.name}</strong>
                      </div>
                      <span style={{ fontSize: "10px", opacity: 0.6, background: "rgba(0,0,0,0.2)", padding: "1px 5px", borderRadius: "10px" }}>
                        {tbl.rowCount}
                      </span>
                    </button>

                    {isSelected && (
                      <div style={{ paddingLeft: "22px", marginTop: "2px", fontSize: "11px", opacity: 0.8 }}>
                        {tbl.columns.map((col) => (
                          <div key={col.cid} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "1px 0" }}>
                            {col.pk ? <Key size={10} color="#e5c07b" /> : <Columns size={10} opacity={0.5} />}
                            <span>{col.name}</span>
                            <small style={{ opacity: 0.5 }}>{col.type}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Area: SQL Query + Results */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Query Editor Bar */}
          <div
            style={{
              padding: "10px 14px",
              background: "var(--bg-editor, #1e1e1e)",
              borderBottom: "1px solid var(--border-color, #333)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600 }}>
                <FileCode size={14} />
                <span>SQL Abfrage</span>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => runQuery()}
                  disabled={executing || !selectedDb}
                  style={{
                    background: "var(--accent-color, #0e639c)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "4px 12px",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Play size={12} fill="currentColor" />
                  <span>{executing ? "Läuft…" : "Ausführen (Ctrl+Enter)"}</span>
                </button>
                {queryResult && queryResult.rows.length > 0 && (
                  <button
                    type="button"
                    onClick={exportCsv}
                    title="Als CSV herunterladen"
                    style={{
                      background: "transparent",
                      color: "inherit",
                      border: "1px solid var(--border-input, #555)",
                      borderRadius: "4px",
                      padding: "4px 8px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Download size={12} />
                    <span>CSV</span>
                  </button>
                )}
              </div>
            </div>

            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  runQuery();
                }
              }}
              rows={3}
              style={{
                width: "100%",
                background: "var(--bg-input, #2d2d2d)",
                border: "1px solid var(--border-input, #444)",
                color: "#d4d4d4",
                fontFamily: "var(--editor-font, monospace)",
                fontSize: "12px",
                padding: "8px",
                borderRadius: "4px",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>

          {/* Error Banner */}
          {queryError && (
            <div
              style={{
                background: "rgba(244, 135, 113, 0.15)",
                color: "#f48771",
                padding: "8px 14px",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                borderBottom: "1px solid var(--border-color, #333)",
              }}
            >
              <AlertCircle size={14} />
              <span>{queryError}</span>
            </div>
          )}

          {/* Results Summary Bar */}
          {queryResult && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                padding: "6px 14px",
                background: "var(--bg-secondary, #252526)",
                fontSize: "11px",
                borderBottom: "1px solid var(--border-color, #333)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Rows size={12} opacity={0.6} />
                <span>{queryResult.rowCount} Zeile(n)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Clock size={12} opacity={0.6} />
                <span>{queryResult.executionTimeMs} ms</span>
              </div>
            </div>
          )}

          {/* Results Data Grid */}
          <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
            {!queryResult || queryResult.columns.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.5, fontSize: "12px" }}>
                {queryResult && !queryResult.isSelect ? "Befehl erfolgreich ausgeführt." : "Keine Abfrageergebnisse."}
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "12px",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr style={{ background: "var(--bg-secondary, #252526)", position: "sticky", top: 0, zIndex: 1 }}>
                    <th style={{ padding: "6px 10px", borderBottom: "1px solid var(--border-color, #444)", width: "40px", opacity: 0.5 }}>#</th>
                    {queryResult.columns.map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: "6px 10px",
                          borderBottom: "1px solid var(--border-color, #444)",
                          fontWeight: 600,
                          color: "var(--accent-color, #4ec9b0)",
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queryResult.rows.map((row, index) => (
                    <tr
                      key={index}
                      style={{
                        background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <td style={{ padding: "6px 10px", opacity: 0.4 }}>{index + 1}</td>
                      {queryResult.columns.map((col) => {
                        const val = row[col];
                        return (
                          <td key={col} style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                            {val === null || val === undefined ? (
                              <span style={{ opacity: 0.4, fontStyle: "italic" }}>NULL</span>
                            ) : typeof val === "object" ? (
                              JSON.stringify(val)
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
