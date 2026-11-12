// Sending raw through the binding, and the socket as a Connection (FR-MAIL-029).
import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vite-plus/test";
import { criterion } from "../../core/tests/criterion.ts";
import { bindingTransport, type Connect, socketConnection } from "../src/index.ts";

const BYTES = new TextEncoder().encode("Subject: hi\r\n\r\nbody\r\n");
const MESSAGE = { bytes: BYTES, envelope: { from: "me@example.com", to: ["a@x.example"] } };
const make = (from: string, to: string, raw: string) => ({ from, to, raw });

/** The one outcome of a binding that throws this value. */
async function thrown(value: unknown) {
  const transport = bindingTransport(
    {
      send: () => {
        throw value;
      },
    },
    make,
  );
  const [outcome] = await transport.send(MESSAGE);
  return outcome;
}

const fail = (code: unknown, message = "said no") => ({ code, message });

criterion("FR-MAIL-029-c1", async () => {
  const seen: unknown[] = [];
  const transport = bindingTransport(
    {
      send: async (message) => {
        seen.push(message);
        if (seen.length === 1) throw fail("E_RECIPIENT_SUPPRESSED");
      },
    },
    make,
  );
  const outcomes = await transport.send({
    bytes: BYTES,
    envelope: { from: "me@example.com", to: ["a@x.example", "b@x.example"] },
  });
  const raw = "Subject: hi\r\n\r\nbody\r\n";
  expect(transport.name).toBe("cloudflare");
  expect(seen).toEqual([
    { from: "me@example.com", to: "a@x.example", raw },
    { from: "me@example.com", to: "b@x.example", raw },
  ]);
  expect(outcomes.map(({ recipient, kind }) => [recipient, kind])).toEqual([
    ["a@x.example", "refused"],
    ["b@x.example", "accepted"],
  ]);
});

criterion("FR-MAIL-029-c2", async () => {
  for (const code of [
    "E_RECIPIENT_SUPPRESSED",
    "E_VALIDATION_ERROR",
    "E_FIELD_MISSING",
    "E_TOO_MANY_RECIPIENTS",
    "E_TOO_MANY_ATTACHMENTS",
    "E_CONTENT_TOO_LARGE",
    "E_HEADER_NOT_ALLOWED",
  ]) {
    expect(await thrown(fail(code))).toEqual({
      recipient: "a@x.example",
      kind: "refused",
      final: true,
      stage: "provider",
      code: null,
      text: `${code}: said no`,
    });
  }
});

criterion("FR-MAIL-029-c3", async () => {
  for (const code of [
    "E_RECIPIENT_NOT_ALLOWED",
    "E_RATE_LIMIT_EXCEEDED",
    "E_DAILY_LIMIT_EXCEEDED",
    "E_SENDER_NOT_VERIFIED",
    "E_SENDER_DOMAIN_NOT_AVAILABLE",
    "E_ACCOUNT_SUSPENDED",
  ]) {
    expect(await thrown(fail(code))).toMatchObject({ kind: "refused", final: false });
  }
});

criterion("FR-MAIL-029-c4", async () => {
  const unknown = (detail: string) => ({ recipient: "a@x.example", kind: "unknown", detail });
  for (const code of ["E_DELIVERY_FAILED", "E_INTERNAL_SERVER_ERROR", "E_NEW", "constructor"]) {
    expect(await thrown(fail(code))).toEqual(unknown(`${code}: said no`));
  }
  expect(await thrown(fail(500))).toEqual(unknown("no code: said no"));
  expect(await thrown(new Error("said no"))).toEqual(unknown("no code: said no"));
  expect(await thrown("just text")).toEqual(unknown("no code: just text"));
});

criterion("FR-MAIL-029-c5", async () => {
  const ids = [];
  for (const result of [{ messageId: "m1" }, { messageId: "" }, { messageId: 7 }, undefined]) {
    const [outcome] = await bindingTransport({ send: async () => result }, make).send(MESSAGE);
    ids.push(outcome);
  }
  const accepted = (providerId: string | null) => ({
    recipient: "a@x.example",
    kind: "accepted",
    providerId,
    text: null,
  });
  expect(ids).toEqual([accepted("m1"), accepted(null), accepted(null), accepted(null)]);
});

criterion("FR-MAIL-029-c6", async () => {
  let sent = 0;
  const transport = bindingTransport(
    {
      send: async () => {
        sent += 1;
      },
    },
    () => {
      throw new Error("bad address");
    },
  );
  expect(await transport.send(MESSAGE)).toEqual([
    {
      recipient: "a@x.example",
      kind: "refused",
      final: false,
      stage: "provider",
      code: null,
      text: "bad address",
    },
  ]);
  expect(sent).toBe(0);
});

criterion("FR-MAIL-029-c7", async () => {
  const options: unknown[] = [];
  let closed = 0;
  const fake =
    (opened: Promise<unknown>): Connect =>
    (_address, given) => {
      options.push(given);
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      return {
        readable,
        writable,
        opened,
        close: async () => {
          closed += 1;
        },
      };
    };
  const address = { hostname: "smtp.resend.com", port: 465 };
  const conn = await socketConnection(fake(Promise.resolve()), address);
  const line = conn.line();
  await conn.write(new TextEncoder().encode("220 ready\r\n"));
  expect(await line).toBe("220 ready");
  await conn.close();
  expect(closed).toBe(1);
  expect(options[0]).toEqual({ secureTransport: "on", allowHalfOpen: false });

  await expect(socketConnection(fake(Promise.reject(new Error("no"))), address)).rejects.toThrow(
    "no",
  );
  const never = new Promise(() => {});
  await expect(socketConnection(fake(never), address, { timeoutMs: 5 })).rejects.toThrow(
    "within 5 ms",
  );
});

criterion("FR-MAIL-029-c8", () => {
  for (const pkg of ["../src/", "../../resend/src/"]) {
    const folder = new URL(pkg, import.meta.url);
    for (const file of readdirSync(folder)) {
      const source = readFileSync(new URL(file, folder), "utf8");
      expect(source, file).not.toMatch(/from\s+"cloudflare:(email|sockets)"/);
      expect(source, file).not.toMatch(/import\(\s*"cloudflare:(email|sockets)"/);
    }
  }
});
