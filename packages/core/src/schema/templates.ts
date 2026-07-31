import { z } from "zod";
import { templateSourceTypeSchema } from "./enums.js";

/**
 * A value that survives a JSON round-trip unchanged.
 *
 * `z.unknown()` would be the looser reading of "editor hints", but it admits values the
 * blob cannot actually hold: `JSON.stringify` throws on a bigint and silently drops
 * symbols, functions, and `undefined`. Since the documented write path is
 * `blob.put(key, JSON.stringify(templateSchema.parse(template)))`, a schema that accepts
 * those would hand back a "valid" template that crashes or corrupts on write. Validating
 * at the JSON boundary is the whole job of this schema, so it describes JSON.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * The JSON shape stored at `templates/<mailboxId|"global">/<name>.json` in R2 or S3.
 *
 * Templates are files, not database rows. This schema is the entire contract between
 * the editor that writes the blob and any consumer that reads it:
 *
 *   read:  templateSchema.parse(JSON.parse(await (await blob.get(key)).text()))
 *   write: blob.put(key, JSON.stringify(templateSchema.parse(template)))
 *
 * Timestamps are ISO strings rather than Date because the blob is JSON -- JSON has no
 * date type, and round-tripping through it must be lossless.
 */
export const templateSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid().nullable(),
  name: z.string().min(1).max(120),
  sourceType: templateSourceTypeSchema,
  bodySource: z.string(),
  bodyCompiled: z.string(),
  bodyCompiledText: z.string().nullable(),
  variablesSchema: z.record(z.string(), jsonValueSchema).nullable(),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Template = z.infer<typeof templateSchema>;
