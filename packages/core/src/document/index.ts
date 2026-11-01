// The closed vocabulary (research 01a194af): "An inline style attribute on an ordinary element is
// the only styling that survives on every client surface." So a person's mail is a document of
// a few plain elements, rendered once as text and once as HTML every client keeps.
import { z } from "zod";
import { noControls } from "../encoding/chars.ts";

export type Inline =
  | string
  | { a: string; href: string }
  | { em: Inline[] }
  | { strong: Inline[] }
  | { br: true };
export type Block =
  | { p: Inline[] }
  | { ul: Inline[][] }
  | { quote: { attribution: string; blocks: Block[] } };
export type Doc = Block[];
export type Content = { doc: Doc } | { html: string; text: string };

/** Research 01a194af: text, a link, emphasis, strong emphasis and a line break, the inline elements every client keeps. */
export const inlineSchema: z.ZodType<Inline> = z.lazy(() =>
  z.union([
    noControls,
    z.strictObject({ a: noControls.min(1), href: noControls.min(1) }),
    z.strictObject({ em: z.array(inlineSchema) }),
    z.strictObject({ strong: z.array(inlineSchema) }),
    z.strictObject({ br: z.literal(true) }),
  ]),
);

/** Research 01a194af: a paragraph, a list or a quote, the blocks of one column every client keeps. */
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.union([
    z.strictObject({ p: z.array(inlineSchema).min(1) }),
    z.strictObject({ ul: z.array(z.array(inlineSchema).min(1)).min(1) }),
    z.strictObject({
      quote: z.strictObject({ attribution: noControls, blocks: z.array(blockSchema) }),
    }),
  ]),
);

/** A document is at least one block. */
export const docSchema = z.array(blockSchema).min(1);

/**
 * What a message says: a document mail renders both ways, or a template plugin's HTML and text,
 * written as given (form 01a18fda: "A template engine hands the writer `{ html, text }`").
 */
export const contentSchema = z.union([
  z.strictObject({ doc: docSchema }),
  z.strictObject({ html: z.string(), text: z.string() }),
]);
