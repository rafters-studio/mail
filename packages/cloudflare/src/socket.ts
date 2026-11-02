// A Workers TCP socket as a Connection (Cloudflare TCP sockets docs): "This allows you to read and
// write data on an ongoing basis, as long as the connection remains open." `connect` is passed in
// because `cloudflare:sockets` exists only in a Worker.
import { streamConnection, type Connection } from "@rafters/mail/send";

export type Connect = (
  address: { hostname: string; port: number },
  options: { secureTransport: "on"; allowHalfOpen: false },
) => {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly opened: Promise<unknown>;
  close(): Promise<void>;
};

/**
 * Form 01a19d25: opens with TLS on and awaits `opened` for at most `timeoutMs`, a timeout rejecting
 * so that smtpTransport's connect rule runs, then gives the socket as lines under the same timeout.
 */
export async function socketConnection(
  connect: Connect,
  address: { hostname: string; port: number },
  options: { timeoutMs?: number } = {},
): Promise<Connection> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const socket = connect(address, { secureTransport: "on", allowHalfOpen: false });
  const { promise: late, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`socket not open within ${timeoutMs} ms`)),
    timeoutMs,
  );
  try {
    await Promise.race([socket.opened, late]);
  } finally {
    clearTimeout(timer);
  }
  return streamConnection(
    { readable: socket.readable, writable: socket.writable, close: () => socket.close() },
    { timeoutMs },
  );
}
