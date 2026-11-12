import { expect } from "vite-plus/test";
import { ZodError } from "zod";
import { createReceiver } from "../src/receive/index.ts";
import { criterion } from "./criterion.ts";
import { createRandom, now } from "./env.ts";
import {
  delivery,
  golden,
  goldens,
  memoryStore,
  plain,
  runCase,
  seedDirectory,
} from "./fixtures/receive.ts";

criterion("FR-MAIL-001-c1", async () => {
  const { store } = await runCase("plain");
  const [stored] = store.blobs.values();
  expect(stored).toEqual(plain);
});

criterion("FR-MAIL-001-c2", async () => {
  const { store } = await runCase("plain");
  expect([...store.blobs.keys()]).toEqual([
    "sha256/56256d5ce9ab71f847f0e609fe1aed13f3e4b59aec4740424fbb26991d9ab30b",
  ]);
});

criterion("FR-MAIL-001-c3", async () => {
  expect(await golden("plain")).toEqual(goldens.plain);
  const { store } = await runCase("plain");
  expect([...store.blobs.values()]).toEqual([plain]);
});

criterion("FR-MAIL-001-c4", async () => {
  expect(await golden("same-bytes-twice")).toEqual(goldens["same-bytes-twice"]);
});

criterion("FR-MAIL-001-c5", async () => {
  expect(await golden("retry-new-bytes")).toEqual(goldens["retry-new-bytes"]);
});

criterion("FR-MAIL-001-c6", async () => {
  const store = memoryStore();
  const failure = new Error("the log is down");
  const receive = createReceiver({
    directory: seedDirectory(),
    blobs: store.ports.blobs,
    deliveries: { record: () => Promise.reject(failure) },
  });
  await expect(receive(delivery(["sean@rafters.studio"]))).rejects.toBe(failure);
  expect(store.blobs.size).toBe(1);
  expect(store.rows.size).toBe(0);
});

criterion("FR-MAIL-015-c1", async () => {
  const garbage = new Uint8Array([0x00, 0x01, 0x1b, 0x07, 0x7f, 0x0d, 0x0a, ...plain]);
  const store = memoryStore();
  const receive = createReceiver({ directory: seedDirectory(), ...store.ports });
  expect(await receive(delivery(["sean@rafters.studio"], garbage))).toEqual({
    kind: "accept",
    mailboxes: ["mbx-sean"],
  });
});

criterion("FR-MAIL-015-c2", async () => {
  expect(await golden("unknown")).toEqual(goldens.unknown);
});

criterion("FR-MAIL-015-c3", async () => {
  expect(await golden("masked-off-drops")).toEqual(goldens["masked-off-drops"]);
});

criterion("FR-MAIL-015-c4", async () => {
  expect(await golden("two-mailboxes")).toEqual(goldens["two-mailboxes"]);
  expect(await golden("masked-off-and-on")).toEqual(goldens["masked-off-and-on"]);
});

criterion("FR-MAIL-015-c5", async () => {
  const result = await golden("alias-once");
  expect(result).toEqual(goldens["alias-once"]);
  expect(result.rows.map((r) => r.rcpt_to)).toEqual(["sean@rafters.studio"]);
});

criterion("FR-MAIL-015-c6", async () => {
  const result = await golden("bounce");
  expect(result).toEqual(goldens.bounce);
  expect(result.rows[0]?.mail_from).toBeNull();
});

criterion("FR-MAIL-015-c7", async () => {
  const { rows } = await runCase("plain", createRandom());
  expect(rows.map((r) => r.id)).toEqual(["019caf7e-0e80-7001-8203-040506070809"]);
});

criterion("FR-MAIL-015-c8", async () => {
  const { rows } = await runCase("plain", null);
  const id = rows[0]?.id ?? "";
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(now().getTime());
});

criterion("FR-MAIL-015-c9", async () => {
  const store = memoryStore();
  const receive = createReceiver({ directory: seedDirectory(), ...store.ports });
  await expect(receive(delivery([]))).rejects.toBeInstanceOf(ZodError);
  expect(store.blobs.size).toBe(0);
  expect(store.rows.size).toBe(0);
});
