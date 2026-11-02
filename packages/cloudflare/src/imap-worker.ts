// The Worker in front of the session objects (Cloudflare WebSockets docs): "WebSockets allow you to
// communicate in real time with your Cloudflare Workers serverless functions." Only the bridge may
// open one, by its secret. It is a second Worker from the receiving one, since Email Routing lists
// only a Worker with `email` alone.
import { sameText } from "./imap-logins.ts";
import type { NamespaceOf, SessionStub } from "./imap-objects.ts";

/** What the Worker reads; the secret may be unset, and then nothing is authorized. */
type WorkerBindings = { IMAP_SESSION: NamespaceOf<SessionStub>; BRIDGE_SECRET?: string };

const refuse = (status: number) => new Response(null, { status });

/**
 * Form 01a19daa, The Worker: another path answers 404; a wrong, missing or unset secret 401, compared
 * through an HMAC, and an empty one authorizes nothing, or the header "Bearer undefined" would pass;
 * no upgrade 426; otherwise it goes to a new session object, one per connection.
 */
export function imapWorker(): {
  fetch(request: Request, env: WorkerBindings): Promise<Response>;
} {
  return {
    fetch: async (request, env) => {
      if (new URL(request.url).pathname !== "/imap") return refuse(404);
      const given = request.headers.get("authorization") ?? "";
      if (!env.BRIDGE_SECRET || !(await sameText(`Bearer ${env.BRIDGE_SECRET}`, given)))
        return refuse(401);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return refuse(426);
      const sessions = env.IMAP_SESSION;
      return sessions.get(sessions.newUniqueId()).fetch(request);
    },
  };
}
