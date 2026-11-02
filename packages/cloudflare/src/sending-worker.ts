// The Worker that hears what happened (Cloudflare Queues docs): "You can also call `retry()` to
// explicitly force a message to be redelivered in a subsequent batch." So one bad event does not
// redeliver its batch. Email Routing lists a Worker only when it has `email` alone, so events cannot
// live in the receiving Worker: this is a second one, with `fetch` and `queue` and no `email`.
import type { SendEvent } from "@rafters/mail/send";
import type { D1Like } from "./d1.ts";
import { fromCloudflare } from "./events.ts";
import { d1Events } from "./send-log.ts";

export type QueueBatch = {
  readonly messages: readonly { readonly body: unknown; ack(): void; retry(): void }[];
};
export type SendingBindings = { MAIL_DB: D1Like };
// Each webhook handles its own path, /webhooks/<key>, and returns the events to record,
// or null when the request is not authentic. E is the Worker's own env, so a handler
// can read its secret.
export type Webhooks<E extends SendingBindings> = Record<
  string,
  (request: Request, env: E) => Promise<SendEvent[] | null>
>;

const PREFIX = "/webhooks/";

/**
 * Form 01a19d25: `fetch` runs the handler a POST names, and a throw is not caught, so the provider
 * sees a failure and retries, which recording's ignored repeats make safe. `queue` retries only the
 * message that failed.
 */
export function sendingWorker<E extends SendingBindings>(
  webhooks: Webhooks<E>,
): {
  fetch(request: Request, env: E): Promise<Response>;
  queue(batch: QueueBatch, env: E): Promise<void>;
} {
  return {
    fetch: async (request, env) => {
      const { pathname } = new URL(request.url);
      const key = pathname.slice(PREFIX.length);
      const handler =
        request.method === "POST" && pathname.startsWith(PREFIX) && Object.hasOwn(webhooks, key)
          ? webhooks[key]
          : undefined;
      if (handler === undefined) return new Response(null, { status: 404 });
      const events = await handler(request, env);
      if (events === null) return new Response(null, { status: 401 });
      const { record } = d1Events(env.MAIL_DB);
      for (const event of events) await record(event);
      return new Response(null, { status: 200 });
    },
    queue: async (batch, env) => {
      const { record } = d1Events(env.MAIL_DB);
      for (const message of batch.messages) {
        try {
          const event = fromCloudflare(message.body);
          if (event !== null) await record(event);
          message.ack();
        } catch {
          message.retry();
        }
      }
    },
  };
}
