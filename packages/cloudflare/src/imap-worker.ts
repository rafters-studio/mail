// The Worker in front of the session objects (Cloudflare WebSockets docs): "WebSockets allow you to
// communicate in real time with your Cloudflare Workers serverless functions." Only the bridge may
// open one, by its secret. It is a second Worker from the receiving one, since Email Routing lists
// only a Worker with `email` alone.
import { sameText } from "./imap-logins.ts";
import type { NamespaceOf, SessionStub } from "./imap-objects.ts";

/** What the Worker reads; the secret may be unset, and then nothing is authorized. */
type WorkerBindings = {
  IMAP_SESSION: NamespaceOf<Pick<SessionStub, "fetch">>;
  SUBMIT_SESSION?: NamespaceOf<Pick<SessionStub, "fetch">>;
  BRIDGE_SECRET?: string;
};

const refuse = (status: number) => new Response(null, { status });

/**
 * Form 01a19daa, The Worker: another path answers 404; a wrong, missing or unset secret 401, compared
 * through an HMAC, and an empty one authorizes nothing, or the header "Bearer undefined" would pass;
 * no upgrade 426; otherwise it goes to a new session object, one per connection. Form 01a19de8: `/submit`
 * is gated the same way and reaches a submission object, and with no such object bound it is another path.
 */
export function imapWorker(): {
  fetch(request: Request, env: WorkerBindings): Promise<Response>;
} {
  return {
    fetch: async (request, env) => {
      const { pathname } = new URL(request.url);
      const paths = new Map([
        ["/imap", env.IMAP_SESSION],
        ["/submit", env.SUBMIT_SESSION],
      ]);
      const sessions = paths.get(pathname);
      if (sessions === undefined) return refuse(404);
      const given = request.headers.get("authorization") ?? "";
      if (!env.BRIDGE_SECRET || !(await sameText(`Bearer ${env.BRIDGE_SECRET}`, given)))
        return refuse(401);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return refuse(426);
      return sessions.get(sessions.newUniqueId()).fetch(request);
    },
  };
}
