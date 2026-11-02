// The directory and the delivery log (Cloudflare D1 Workers API): first "Runs the prepared query
// (or queries), and returns the first row of the query result as an object." Each row is mapped
// to the core's fields by name and parsed with its schema, so a row written wrong throws instead
// of delivering mail to the wrong place.
import {
  type Deliveries,
  type Directory,
  domainSchema,
  mailboxAddressSchema,
} from "@rafters/mail/receive";

/** The parts of D1Database the ports use. */
export type D1Like = {
  prepare(sql: string): {
    bind(...values: (string | null)[]): {
      first(): Promise<Record<string, unknown> | null>;
      run(): Promise<unknown>;
    };
  };
};

/** Cloudflare D1 Workers API: the first row of a bound query, read by `read`, or null for none. */
async function one<T>(
  db: D1Like,
  sql: string,
  values: string[],
  read: (row: Record<string, unknown>) => T,
): Promise<T | null> {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first();
  return row === null ? null : read(row);
}

/**
 * Form 01a19a5c, Storage on Cloudflare: one domain or one address per query, `0`/`1` read as
 * false/true and the three `mask_*` columns as one `mask`, parsed with the core's schemas.
 */
export function d1Directory(db: D1Like): Directory {
  return {
    domain: (name) =>
      one(
        db,
        "SELECT name, postmaster, catch_all, masking FROM domains WHERE name = ?",
        [name],
        ({ catch_all: catchAll, masking, ...rest }) =>
          domainSchema.parse({ ...rest, catchAll, masking: masking === 1 }),
      ),
    address: (local, domain) =>
      one(
        db,
        "SELECT local, domain, mailbox, enabled, mask_shown, mask_label, mask_created_at FROM addresses WHERE local = ? AND domain = ?",
        [local, domain],
        ({ enabled, mask_shown: shown, mask_label: label, mask_created_at: at, ...rest }) =>
          mailboxAddressSchema.parse({
            ...rest,
            enabled: enabled === 1,
            mask: shown === null ? null : { shown, label, createdAt: new Date(String(at)) },
          }),
      ),
  };
}

/**
 * Form 01a19a5c, Storage on Cloudflare: a second row for the same (blob, mailbox) does nothing,
 * so any number of invocations for one reception store one record.
 */
export function d1Deliveries(db: D1Like): Deliveries {
  return {
    record: async (row) => {
      await db
        .prepare(
          "INSERT INTO deliveries (id, blob, mailbox, mail_from, rcpt_to, received_at, via) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (blob, mailbox) DO NOTHING",
        )
        .bind(
          row.id,
          row.blob,
          row.mailbox,
          row.mailFrom,
          row.rcptTo,
          row.receivedAt.toISOString(),
          row.via,
        )
        .run();
    },
  };
}
