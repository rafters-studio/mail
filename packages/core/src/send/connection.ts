// A byte stream as lines, with timeouts (RFC 5321 4.5.3.2): "It MUST use per-command timeouts
// rather than somehow trying to time the entire mail transaction." So one timeout bounds each read
// of a line and each write, not each chunk, and a server trickling bytes cannot hold a line open.
// A TCP read can end anywhere, so this is the one place that turns chunks into lines. The default
// is ten minutes, RFC 5321 4.5.3.2's longest timer, DATA Termination.

/** A connection that already speaks TLS. */
export type Connection = {
  write: (bytes: Uint8Array) => Promise<void>;
  // The next full line without CRLF; null once closed, timed out or over-long.
  line: () => Promise<string | null>;
  close: () => Promise<void>;
};
export type Streams = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close: () => Promise<void>;
};

const CR = 0x0d;
const LF = 0x0a;

/** Form 01a19d25: only CRLF ends a line, so a bare LF stays inside one; -1 when none has arrived. */
function crlfAt(bytes: Uint8Array): number {
  return bytes.findIndex((byte, i) => byte === CR && bytes[i + 1] === LF);
}

/** Form 01a19d25: one chunk joined to what was held, so a chunk boundary can fall anywhere. */
function joined(held: Uint8Array, chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(held.length + chunk.length);
  out.set(held);
  out.set(chunk, held.length);
  return out;
}

/** Research 01a1ae1d: a bound behind a port, so a test fires it instead of waiting for it. */
export type Deadline = (
  ms: number,
  reason: string,
) => { readonly signal: AbortSignal; clear(): void };

/** The real bound: a timer, cleared once the work ends, so it keeps nothing awake. Its callback stays on this line. */
export const timer: Deadline = (ms, reason) => {
  const abort = new AbortController();
  const id = setTimeout(() => abort.abort(new Error(reason)), ms);
  return { signal: abort.signal, clear: () => clearTimeout(id) };
};

/** RFC 5321 4.5.3.2: the work's result, or a rejection once the deadline fires. */
async function within<T>(deadline: Deadline, timeoutMs: number, work: Promise<T>): Promise<T> {
  const bound = deadline(timeoutMs, `no answer within ${timeoutMs} ms`);
  const { promise, reject } = Promise.withResolvers<never>();
  bound.signal.addEventListener("abort", () => reject(bound.signal.reason), { once: true });
  try {
    return await Promise.race([work, promise]);
  } finally {
    bound.clear();
  }
}

/**
 * RFC 5321 4.5.3.2 and form 01a19d25: a byte stream as lines ending at CRLF, each read and each
 * write bounded by one timeout. A timeout or a line over `maxLine` bytes, not counting its CRLF,
 * counts as closed, and closed stays closed. The line buffer is the one mutable closure state, an
 * exception to the writer's Craft that `imap/session.ts` already makes.
 */
export function streamConnection(
  streams: Streams,
  options: { timeoutMs?: number; maxLine?: number; deadline?: Deadline } = {},
): Connection {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maxLine = options.maxLine ?? 65_536;
  const { deadline = timer } = options;
  const reader = streams.readable.getReader();
  const writer = streams.writable.getWriter();
  // Form 01a19d25: "a byte that does not decode cannot throw", so not `fatal`.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let held: Uint8Array = new Uint8Array(0);
  let closed = false;

  const readLine = async (): Promise<string | null> => {
    for (;;) {
      const end = crlfAt(held);
      // With no CRLF yet, the last byte held may be its CR, so it does not count.
      if ((end === -1 ? held.length - 1 : end) > maxLine) return null;
      if (end !== -1) {
        const text = decoder.decode(held.subarray(0, end));
        held = held.subarray(end + 2);
        return text;
      }
      const { done, value } = await reader.read();
      if (done) return null;
      held = joined(held, value);
    }
  };

  return {
    write: (bytes) => within(deadline, timeoutMs, writer.write(bytes)),
    line: async () => {
      if (closed) return null;
      const text = await within(deadline, timeoutMs, readLine()).catch(() => null);
      if (text === null) closed = true;
      return text;
    },
    close: () => streams.close(),
  };
}
