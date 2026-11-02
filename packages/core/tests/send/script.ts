// What the sending tests run against (form 01a19d25, Tests): "The session is checked by exact
// client and server bytes, one golden per row of the session table, each driven through
// `streamConnection` over in-memory streams, whole and one byte at a time".
import { once } from "node:events";
import { connect, createServer, type Server } from "node:net";
import { Duplex } from "node:stream";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Written } from "../../src/message/index.ts";
import { writeCase } from "../cases.ts";
import {
  outcomeSchema,
  streamConnection,
  type Connection,
  type Outcome,
  type Sends,
  type Streams,
} from "../../src/send/index.ts";

/** One turn: what the server says (null: it closes instead), then what the client answers. */
export type Step = { server: string | null; client?: string };

export const FROM = "sean@rafters.studio";
export const MESSAGE = "Subject: x\r\n\r\n.lead\r\nbody\r\n";
export const SETTINGS = { ehlo: "client.example", login: { user: "user", password: "password" } };

const goldensSchema = z.array(
  z.strictObject({
    name: z.string(),
    to: z.array(z.string()),
    steps: z.array(
      z.strictObject({ server: z.string().nullable(), client: z.string().optional() }),
    ),
    outcomes: z.array(outcomeSchema),
  }),
);

export type Golden = z.infer<typeof goldensSchema>[number];

export const GOLDENS = goldensSchema.parse(
  JSON.parse(readFileSync(new URL("../fixtures/send/sessions.json", import.meta.url), "utf8")),
);

/** The golden of this name. */
export function golden(name: string): Golden {
  const found = GOLDENS.find((g) => g.name === name);
  if (found === undefined) throw new Error(`${name} is not a golden`);
  return found;
}

/** A string as its octets, one per character. */
export function octets(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** The client's bytes a list of steps expects. */
export function clientOf(steps: Step[]): string {
  return steps.map((s) => s.client ?? "").join("");
}

/** The message every golden sends, to these recipients. */
export function outgoing(to: string[]) {
  return { bytes: octets(MESSAGE), envelope: { from: FROM, to } };
}

/** In-memory streams playing the server's side: each client write brings the next step. */
export function scripted(
  steps: Step[],
  bytewise = false,
): { streams: Streams; client: () => string } {
  let written = "";
  let at = 0;
  let speak = (): void => undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      speak = () => {
        const step = steps[at++];
        if (step === undefined) return;
        if (step.server === null) return controller.close();
        const bytes = octets(step.server);
        if (!bytewise) return controller.enqueue(bytes);
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      };
      speak();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written += Buffer.from(chunk).toString("latin1");
      speak();
    },
  });
  return { streams: { readable, writable, close: async () => undefined }, client: () => written };
}

/** A Connection over a scripted server. */
export function scriptedConnection(steps: Step[], bytewise = false) {
  const { streams, client } = scripted(steps, bytewise);
  return { conn: streamConnection(streams), client };
}

/** A real socket to a local port, as a Connection. */
export async function dial(port: number, timeoutMs?: number): Promise<Connection> {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => undefined);
  await once(socket, "connect");
  const { readable, writable } = Duplex.toWeb(socket);
  return streamConnection(
    {
      readable,
      writable,
      close: async () => {
        socket.destroy();
      },
    },
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}

/** A node:net server answering every command well, destroying its socket as the message arrives. */
export async function losingServer(
  when: "during" | "after",
): Promise<{ port: number; server: Server }> {
  const server = createServer((socket) => {
    socket.on("error", () => undefined);
    let inMessage = false;
    let held = "";
    socket.write("220 mx\r\n");
    socket.on("data", (chunk) => {
      held += chunk.toString("latin1");
      if (inMessage) {
        if (when === "during" || held.endsWith("\r\n.\r\n")) socket.destroy();
        return;
      }
      const verb = held.slice(0, 4);
      held = "";
      if (verb === "EHLO") socket.write("250-mx\r\n250 AUTH PLAIN\r\n");
      else if (verb === "AUTH") socket.write("235 ok\r\n");
      else if (verb === "DATA") {
        inMessage = true;
        socket.write("354 go\r\n");
      } else socket.write("250 ok\r\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { port: address.port, server };
}

/** One row of a fake send log, keyed by recipient. */
export type Row = { state: "unknown" | "accepted" | "refused"; final?: boolean };

/** A Sends holding its rows in a Map, with claim's rule from the form. */
export function memorySends(
  rows = new Map<string, Row>(),
): Sends & { rows: Map<string, Row>; claims: number } {
  const log = {
    rows,
    claims: 0,
    claim: async ({ recipient }: { recipient: string }) => {
      log.claims++;
      const row = rows.get(recipient);
      if (row !== undefined && !(row.state === "refused" && row.final === false)) return false;
      rows.set(recipient, { state: "unknown" });
      return true;
    },
    settle: async (_messageId: string, outcome: Outcome) => {
      if (outcome.kind === "refused") {
        rows.set(outcome.recipient, { state: "refused", final: outcome.final });
      } else rows.set(outcome.recipient, { state: outcome.kind });
    },
  };
  return log;
}

/** A Written with these bytes and this envelope. */
export function writtenOf(bytes: Uint8Array, from: string, to: string[]): Written {
  return { ...writeCase("plain"), bytes, envelope: { from, to } };
}
