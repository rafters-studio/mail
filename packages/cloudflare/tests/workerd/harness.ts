import { fileURLToPath } from "node:url";
import { unstable_startWorker } from "wrangler";
import WebSocket from "ws";

export type Fixture = Awaited<ReturnType<typeof unstable_startWorker>>;
type Plain = Record<string, { type: "plain_text"; value: string }>;

/** A fixture Worker on local workerd, on a free port. The caller disposes it. */
export async function startFixture(config: URL, bindings: Plain = {}): Promise<Fixture> {
  const worker = await unstable_startWorker({
    config: fileURLToPath(config),
    dev: { server: { hostname: "127.0.0.1", port: 0 }, inspector: false, logLevel: "error" },
    bindings,
  });
  await worker.ready;
  return worker;
}

/** A route's JSON. */
export async function route(worker: Fixture, path: string): Promise<unknown> {
  return (await worker.fetch(`http://fixture${path}`)).json();
}

/** One client connection, as the bridge opens it, with what it has received as binary text. */
export async function client(worker: Fixture, path: "/imap" | "/submit", address: string) {
  const { host } = await worker.url;
  const ws = new WebSocket(`ws://${host}${path}`, {
    headers: { authorization: "Bearer fixture-secret", "x-client-address": address },
    perMessageDeflate: false,
  });
  let received = "";
  const waiting = new Set<() => void>();
  ws.on("message", (data: Buffer) => {
    received += data.toString("latin1");
    for (const check of Array.from(waiting)) check();
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code: number) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  /**
   * Research 01a1ae1d: waits on `text` arriving at or after offset `from` of what was received, an event.
   * A close first rejects; a hang is the runner's timeout to end. Pass `received().length` as `from`
   * to wait for the answer to the line sent next, not for one already received.
   */
  const until = (text: string, from = 0): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (received.indexOf(text, from) < 0) return;
        waiting.delete(check);
        resolve();
      };
      waiting.add(check);
      check();
      void closed.then(() => {
        if (received.indexOf(text, from) >= 0) return;
        waiting.delete(check);
        reject(new Error(`closed with no ${text} in: ${received}`));
      });
    });
  return {
    ws,
    closed,
    until,
    received: () => received,
    send: (line: string) => ws.send(Buffer.from(line, "latin1")),
  };
}

/**
 * Research 01a1ae1d: evicts one session object as the runtime does, its socket kept hibernating.
 * Call it only after the session's last reply was read.
 */
export async function evictSession(
  worker: Fixture,
  kind: "imap" | "submit",
  id: string,
): Promise<void> {
  const answer = await route(worker, `/fixture/evict?kind=${kind}&id=${id}`);
  if (answer !== true) throw new Error(`evicting ${kind} ${id} gave ${JSON.stringify(answer)}`);
}
