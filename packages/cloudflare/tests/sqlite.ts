// The send log's migration on node:sqlite as a D1Like, the way the ports meet D1 (FR-MAIL-031).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Like } from "../src/index.ts";

const MIGRATION = readFileSync(new URL("../migrations/0002_sending.sql", import.meta.url), "utf8");

/** A fresh database with the sending tables, and the D1Like over it. */
export function sendingDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  const d1: D1Like = {
    prepare: (sql) => ({
      bind: (...values) => ({
        first: async () => {
          const row = db.prepare(sql).get(...values);
          return row === undefined ? null : { ...row };
        },
        run: async () => db.prepare(sql).run(...values),
        all: async () => ({
          results: db
            .prepare(sql)
            .all(...values)
            .map((row) => ({ ...row })),
        }),
      }),
    }),
  };
  const rows = (table: string) =>
    db
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .map((row) => ({ ...row }));
  return { db, d1, rows };
}
