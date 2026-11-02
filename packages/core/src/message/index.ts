// `createMail` and its closures (form 01a18fda): "`createMail` binds the sending domain and the
// two impure inputs, entropy and the clock." Everything beneath these closures is a pure function
// of its arguments, so a test that fixes entropy and the clock gets the same bytes every time.
import { z } from "zod";
import type { Content } from "../document/index.ts";
import { DOT_ATOM } from "../encoding/chars.ts";
import { forward, type forwardSchema } from "./forward.ts";
import type { parentSchema } from "./parent.ts";
import { replySchema, replyTo } from "./reply.ts";
import { headSchema, type Random, type Written, writeMessage } from "./write.ts";

export { forwardSchema } from "./forward.ts";
export { parentSchema } from "./parent.ts";
export { replySchema } from "./reply.ts";
export { headSchema, MAIL_WRITE_CODES, MailWriteError } from "./write.ts";
export type { Envelope, MailWriteCode, Random, Written } from "./write.ts";

export type Mail = {
  compose(head: z.input<typeof headSchema>): (content: Content) => Written;
  replyTo(parent: z.input<typeof parentSchema>): (r: z.input<typeof replySchema>) => Written;
  forward(parent: z.input<typeof parentSchema>): (f: z.input<typeof forwardSchema>) => Written;
};

/**
 * Form 01a18fda: binds the domain every Message-ID is at, with entropy defaulting to the
 * platform's and the clock to the system's. A domain that is not dot-atom text throws its
 * ZodError here, when called.
 */
export function createMail(env: { domain: string; random?: Random; now?: () => Date }): Mail {
  const bound = {
    domain: z.string().regex(DOT_ATOM).parse(env.domain),
    random: env.random ?? ((into: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(into)),
    now: env.now ?? (() => new Date()),
  };
  return {
    compose: (head) => (content) =>
      writeMessage(bound, head, content, { inReplyTo: [], references: [] }),
    replyTo: (parent) => replyTo(bound, parent),
    forward: (parent) => forward(bound, parent),
  };
}
