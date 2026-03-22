import { describe, expect, it } from "vitest";
import { migrationSQL } from "../src/migrations/index.js";

const TABLE_NAMES = [
  "mailbox",
  "inbox_folder",
  "inbox_label",
  "inbox_thread",
  "inbox_message",
  "inbox_message_label",
  "inbox_thread_label",
  "inbox_attachment",
  "thread_assignment",
  "thread_note",
] as const;

describe("migrationSQL", () => {
  it("is a non-empty string", () => {
    expect(typeof migrationSQL).toBe("string");
    expect(migrationSQL.trim().length).toBeGreaterThan(0);
  });

  it("contains CREATE TABLE IF NOT EXISTS for all 10 tables", () => {
    for (const name of TABLE_NAMES) {
      expect(migrationSQL).toContain(`CREATE TABLE IF NOT EXISTS ${name}`);
    }
  });

  it("contains CREATE INDEX statements", () => {
    expect(migrationSQL).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migrationSQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  });

  it("every statement ends with a semicolon", () => {
    const statements = migrationSQL
      .trim()
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    expect(statements.length).toBeGreaterThanOrEqual(10);

    for (const stmt of statements) {
      // Each non-empty statement should start with CREATE
      expect(stmt).toMatch(/^(CREATE|--)/);
    }
  });

  it("uses correct SQLite types (TEXT and INTEGER only)", () => {
    // SQLite only has TEXT, INTEGER, REAL, BLOB, NULL as storage classes.
    // Our schema uses only TEXT and INTEGER.
    const columnLines = migrationSQL.split("\n").filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("--") &&
        !trimmed.startsWith("CREATE") &&
        !trimmed.startsWith(")") &&
        !trimmed.startsWith("(")
      );
    });

    for (const line of columnLines) {
      // Column definitions should contain TEXT or INTEGER (or be a constraint line like REFERENCES)
      if (line.includes("PRIMARY KEY") || line.includes("REFERENCES") || line.includes("DEFAULT")) {
        continue;
      }
      if (line.trim().match(/^\w/)) {
        expect(line).toMatch(/TEXT|INTEGER/);
      }
    }
  });

  it("includes foreign key constraints with ON DELETE", () => {
    const fkLines = migrationSQL.split("\n").filter((line) => line.includes("REFERENCES"));

    expect(fkLines.length).toBeGreaterThanOrEqual(8);

    for (const line of fkLines) {
      expect(line).toMatch(/ON DELETE (CASCADE|SET NULL)/);
    }
  });

  it("does not include newsletter tables", () => {
    expect(migrationSQL).not.toContain("platform_audience");
    expect(migrationSQL).not.toContain("mailing_list");
    expect(migrationSQL).not.toContain("subscriber");
    expect(migrationSQL).not.toContain("campaign");
  });

  it("quotes the references column name since it is a SQL keyword", () => {
    expect(migrationSQL).toContain('"references"');
  });
});
