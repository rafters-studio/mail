// A message's identity (RFC 5322 3.6.4): "The message identifier (msg-id) itself MUST be a
// globally unique identifier for a message." Replies thread by it, so it is a branded value
// only this schema makes.
import { z } from "zod";
import { DOT_ATOM_TEXT } from "../encoding/chars.ts";

/** RFC 5322 3.6.4: an id-left "@" id-right, each dot-atom text, written without angle brackets. */
export const messageIdSchema = z
  .string()
  .regex(new RegExp(`^${DOT_ATOM_TEXT}@${DOT_ATOM_TEXT}$`))
  .brand<"MessageId">();

export type MessageId = z.infer<typeof messageIdSchema>;
