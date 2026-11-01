// A document as text and as HTML (research 01a194af): "An inline style attribute on an ordinary
// element is the only styling that survives on every client surface." Both renderings come from
// one document, so the text part always says what the HTML part says.
import { never } from "../encoding/never.ts";
import type { Block, Doc, Inline } from "./index.ts";

/** HTML 4.1 escaping: text and attribute values cannot open a tag, an entity or end a quote. */
function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Research 01a194af: a link's address follows its text, once when the text is the address. */
export function inlineText(inline: Inline): string {
  if (typeof inline === "string") return inline;
  if ("a" in inline) return inline.a === inline.href ? inline.href : `${inline.a} (${inline.href})`;
  if ("em" in inline) return inline.em.map(inlineText).join("");
  if ("strong" in inline) return inline.strong.map(inlineText).join("");
  /* v8 ignore else -- the compiler proves no member is left (form 01a18fda, Craft) */
  if ("br" in inline) return "\n";
  else return never(inline);
}

/**
 * Research 01a194af: a paragraph's inlines on one line; a list's items each on a line after
 * "- "; a quote's attribution, then its blocks with each line after "> " and an empty one as ">".
 */
function blockText(block: Block): string {
  if ("p" in block) return block.p.map(inlineText).join("");
  if ("ul" in block) return block.ul.map((item) => `- ${item.map(inlineText).join("")}`).join("\n");
  /* v8 ignore else -- the compiler proves no member is left (form 01a18fda, Craft) */
  if ("quote" in block) {
    const quoted = blocksText(block.quote.blocks)
      .split("\n")
      .map((line) => (line === "" ? ">" : `> ${line}`));
    return [block.quote.attribution, ...quoted].join("\n");
  } else return never(block);
}

/** Research 01a194af: blocks are kept apart by an empty line. */
function blocksText(blocks: readonly Block[]): string {
  return blocks.map(blockText).join("\n\n");
}

/** Research 01a194af: the blocks' text, ending in one line break, never wrapped. */
export function toText(doc: Doc): string {
  return `${blocksText(doc)}\n`;
}

/** Research 01a194af: the inline elements, unstyled, so no client strips them. */
function inlineHtml(inline: Inline): string {
  if (typeof inline === "string") return escape(inline);
  if ("a" in inline) return `<a href="${escape(inline.href)}">${escape(inline.a)}</a>`;
  if ("em" in inline) return `<em>${inline.em.map(inlineHtml).join("")}</em>`;
  if ("strong" in inline) return `<strong>${inline.strong.map(inlineHtml).join("")}</strong>`;
  /* v8 ignore else -- the compiler proves no member is left (form 01a18fda, Craft) */
  if ("br" in inline) return "<br>";
  else return never(inline);
}

/**
 * Research 01a194af: blocks spaced by an inline margin, the one styling every client keeps; a
 * quote in the gmail_quote markup Gmail, Apple Mail and Thunderbird all fold as quoted.
 */
function blockHtml(block: Block): string {
  if ("p" in block) return `<p style="margin:1em 0">${block.p.map(inlineHtml).join("")}</p>`;
  if ("ul" in block) {
    const items = block.ul.map((item) => `<li>${item.map(inlineHtml).join("")}</li>`).join("");
    return `<ul style="margin:1em 0">${items}</ul>`;
  }
  /* v8 ignore else -- the compiler proves no member is left (form 01a18fda, Craft) */
  if ("quote" in block) {
    return [
      `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">`,
      `${escape(block.quote.attribution)}<br></div>`,
      `<blockquote class="gmail_quote" type="cite" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">`,
      `${block.quote.blocks.map(blockHtml).join("")}</blockquote></div>`,
    ].join("");
  } else return never(block);
}

/**
 * Research 01a194af: one column inside an article wrapper that declares its language,
 * direction and both colour schemes, with no style block, table or colour.
 */
export function toHtml(
  doc: Doc,
  page: { lang: string; dir: "ltr" | "rtl"; title: string },
): string {
  const lang = `lang="${escape(page.lang)}" dir="${page.dir}"`;
  const title = escape(page.title);
  return [
    `<!DOCTYPE html><html ${lang}><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="color-scheme" content="light dark"><title>${title}</title></head>`,
    `<body style="margin:0"><div role="article" aria-label="${title}" ${lang}`,
    ` style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">`,
    `${doc.map(blockHtml).join("")}</div></body></html>`,
  ].join("");
}
