/**
 * Cloudflare Worker entry point for IMAP WebSocket connections.
 *
 * Routes incoming WebSocket upgrades to the correct Durable Object
 * based on the email address (one DO per mailbox).
 *
 * Client connects: wss://imap.example.com/?email=user@example.com&mailboxId=...
 * Worker extracts email, derives DO ID, forwards WebSocket.
 */

export function createImapWorker() {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);

      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("IMAP over WebSocket. Connect with a WebSocket client.", {
          status: 200,
        });
      }

      const email = url.searchParams.get("email");
      if (!email || !email.includes("@")) {
        return new Response("Missing or invalid email parameter", { status: 400 });
      }

      const mailboxId = url.searchParams.get("mailboxId");
      if (!mailboxId) {
        return new Response("Missing mailboxId parameter", { status: 400 });
      }

      const doId = env.IMAP_MAILBOX.idFromName(email);
      const stub = env.IMAP_MAILBOX.get(doId);

      const doUrl = new URL(request.url);
      doUrl.searchParams.set("mailboxId", mailboxId);

      return stub.fetch(new Request(doUrl.toString(), request));
    },
  };
}
