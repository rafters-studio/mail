// Drives createImapSession directly, with no socket, through one session's steps (form 01a19ba8,
// Tests): "each step's server octets are everything the session returned for that step". The
// first entry is the greeting; a step with `change` is another client's change, then changed().
import { binary } from "../../src/read/index.ts";
import { createImapSession } from "../../src/imap/index.ts";
import { readCommand } from "../../src/imap/reader.ts";
import { memoryStore } from "./store.ts";

/** One step a client takes: octets it sends, or a change another client makes. */
export type Step = string | { change: string };

/** One recorded step: what the client sent and the octets the session answered with. */
export type Entry = { client: string; server: string; change?: string };

/** A binary string as its octets, one per character. */
export const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** What is left of octets once their whole commands are read: a partial command, or nothing. */
function partial(fed: string): string {
  const r = readCommand(fed);
  if (r.kind === "more") return fed;
  return r.kind === "fatal" ? "" : partial(fed.slice(r.end));
}

/**
 * One session's transcript; with `bytewise`, each step's octets are fed one at a time; with
 * `resuming`, the session is discarded and resumed from its snapshot, as JSON a host would store,
 * after everything fed, except inside a command while not authenticated (form 01a19daa).
 */
export async function record(steps: Step[], bytewise = false, resuming = false): Promise<Entry[]> {
  const store = memoryStore();
  let session = createImapSession({ store });
  let pending = "";
  const resume = (fed: string): void => {
    if (!resuming) return;
    pending = partial(pending + fed);
    const saved = session.snapshot();
    if (saved.phase.name === "not-authenticated" && pending !== "") return;
    session = createImapSession({ store, resume: JSON.parse(JSON.stringify(saved)) });
  };
  const out: Entry[] = [{ client: "", server: binary(session.greeting()) }];
  resume("");
  const send = async (octets: string): Promise<string> => {
    const server = binary(await session.receive(latin1(octets)));
    resume(octets);
    return server;
  };
  const feed = async (step: string): Promise<string> => {
    if (!bytewise) return send(step);
    let server = "";
    for (const c of step) server += await send(c);
    return server;
  };
  for (const step of steps) {
    if (typeof step === "string") out.push({ client: step, server: await feed(step) });
    else {
      store.other(step.change);
      out.push({ client: "", server: binary(await session.changed()), change: step.change });
      resume("");
    }
  }
  if (!session.closed()) throw new Error("session did not close");
  return out;
}
