const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

let DatabaseSync = null;
try {
  DatabaseSync = require("node:sqlite").DatabaseSync;
} catch {
  // Not available in this Node/Electron version
}

function runPythonSqlite(dbPath, action, sql = "") {
  return new Promise((resolve, reject) => {
    const pyScript = `import sqlite3, json, sys
db_path = sys.argv[1]
action = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
try:
    if action == "schema":
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
        tables = []
        for row in cur.fetchall():
            tname = row["name"]
            info_cur = conn.cursor()
            info_cur.execute(f'PRAGMA table_info("{tname}")')
            cols = []
            for c in info_cur.fetchall():
                cols.append({
                    "cid": c["cid"],
                    "name": c["name"],
                    "type": c["type"] or "ANY",
                    "notnull": bool(c["notnull"]),
                    "dflt_value": c["dflt_value"],
                    "pk": bool(c["pk"])
                })
            cnt_cur = conn.cursor()
            try:
                cnt_cur.execute(f'SELECT count(*) as count FROM "{tname}"')
                cnt = cnt_cur.fetchone()["count"]
            except:
                cnt = 0
            tables.append({"name": tname, "rowCount": cnt, "columns": cols})
        print(json.dumps({"tables": tables}))
    elif action == "query":
        sql = sys.argv[3]
        cur = conn.cursor()
        cur.execute(sql)
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = [dict(r) for r in cur.fetchall()]
            print(json.dumps({"columns": cols, "rows": rows, "rowCount": len(rows), "isSelect": True}))
        else:
            conn.commit()
            print(json.dumps({"columns": [], "rows": [], "rowCount": 0, "isSelect": False}))
finally:
    conn.close()
`;

    const pyCmd = process.platform === "win32" ? "python" : "python3";
    const child = spawn(pyCmd, ["-c", pyScript, dbPath, action, sql], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => reject(new Error("SQLite-Treiber nicht verfügbar. Weder node:sqlite noch python vorhanden: " + err.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `SQLite Fehler (Code ${code})`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error("Ungültige Antwort vom SQLite-Prozess: " + stdout));
      }
    });
  });
}

class DatabaseService {
  constructor(guard) {
    this.guard = guard;
  }

  /**
   * Scans workspace root for sqlite database files.
   */
  async findDatabases(root) {
    if (this.guard) root = this.guard.assertWorkspace(root);
    const results = [];
    const maxDepth = 4;
    const ignore = new Set([".git", "node_modules", "target", "build", "dist", ".gradle", "venv", ".venv"]);

    function walk(dir, depth) {
      if (depth > maxDepth || results.length >= 30) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !ignore.has(entry.name)) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3" || ext === ".db3") {
            results.push(full);
          }
        }
      }
    }

    walk(root, 0);
    return results;
  }

  /**
   * Retrieves all user tables and column schemas for a given SQLite database file.
   */
  async getSchema(dbPath) {
    if (this.guard) this.guard.assertAllowed(dbPath);
    if (!fs.existsSync(dbPath)) throw new Error("Datenbankdatei existiert nicht.");

    if (DatabaseSync) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all();
        const tables = [];

        for (const tRow of tableRows) {
          const tableName = tRow.name;
          const columns = db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all();
          let count = 0;
          try {
            const countRow = db.prepare(`SELECT count(*) as count FROM "${tableName.replace(/"/g, '""')}"`).get();
            count = countRow ? Number(countRow.count) : 0;
          } catch {}

          tables.push({
            name: tableName,
            rowCount: count,
            columns: columns.map((col) => ({
              cid: col.cid,
              name: col.name,
              type: col.type || "ANY",
              notnull: Boolean(col.notnull),
              dflt_value: col.dflt_value,
              pk: Boolean(col.pk),
            })),
          });
        }

        return { path: dbPath, tables };
      } finally {
        db.close();
      }
    }

    // Fallback via Python sqlite3
    const data = await runPythonSqlite(dbPath, "schema");
    return { path: dbPath, tables: data.tables || [] };
  }

  /**
   * Executes a SQL statement or query and returns rows, column names and timing.
   */
  async executeQuery(dbPath, sql) {
    if (this.guard) this.guard.assertAllowed(dbPath);
    if (!fs.existsSync(dbPath)) throw new Error("Datenbankdatei existiert nicht.");
    const query = String(sql || "").trim();
    if (!query) throw new Error("Keine SQL-Abfrage angegeben.");

    const startTime = performance.now();
    const isSelect = /^(SELECT|PRAGMA|EXPLAIN)\b/i.test(query);

    if (DatabaseSync) {
      const db = new DatabaseSync(dbPath, { readOnly: isSelect });
      try {
        if (isSelect) {
          const stmt = db.prepare(query);
          const rawRows = stmt.all();
          const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
          const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];

          return {
            columns,
            rows: rawRows,
            rowCount: rawRows.length,
            executionTimeMs: durationMs,
            isSelect: true,
          };
        } else {
          db.exec(query);
          const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
          return {
            columns: [],
            rows: [],
            rowCount: 0,
            executionTimeMs: durationMs,
            isSelect: false,
          };
        }
      } finally {
        db.close();
      }
    }

    // Fallback via Python sqlite3
    const res = await runPythonSqlite(dbPath, "query", query);
    const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
    return {
      columns: res.columns || [],
      rows: res.rows || [],
      rowCount: res.rowCount || 0,
      executionTimeMs: durationMs,
      isSelect: res.isSelect !== false,
    };
  }
}

module.exports = { DatabaseService };
