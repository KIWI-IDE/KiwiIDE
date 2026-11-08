import { describe, expect, it } from "vitest";
import { DatabaseService } from "../electron/services/database-service.cjs";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

describe("DatabaseService", () => {
  it("creates a test sqlite db, inspects schema, and executes query", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-db-test-"));
    const dbPath = path.join(tmpDir, "test.sqlite");

    // Initialize database
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
      INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@kiwi.test');
      INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@kiwi.test');
    `);
    db.close();

    const service = new DatabaseService(null);

    // 1. Find databases
    const found = await service.findDatabases(tmpDir);
    expect(found.some((p: string) => p.endsWith("test.sqlite"))).toBe(true);

    // 2. Get schema
    const schema = await service.getSchema(dbPath);
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].name).toBe("users");
    expect(schema.tables[0].rowCount).toBe(2);
    expect(schema.tables[0].columns.map((c: any) => c.name)).toEqual(["id", "name", "email"]);

    // 3. Execute SELECT query
    const result = await service.executeQuery(dbPath, "SELECT * FROM users ORDER BY id ASC");
    expect(result.columns).toEqual(["id", "name", "email"]);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0].name).toBe("Alice");
    expect(result.rows[1].name).toBe("Bob");

    // Clean up
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
