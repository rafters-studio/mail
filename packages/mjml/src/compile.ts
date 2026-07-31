import mjml2html from "mjml";

export interface MjmlCompileError {
  line: number;
  message: string;
  tagName: string;
  formattedMessage: string;
}

export interface MjmlCompileResult {
  html: string;
  text: string;
  errors: MjmlCompileError[];
}

export interface MjmlCompileOptions {
  keepComments?: boolean;
  minify?: boolean;
  validationLevel?: "strict" | "soft" | "skip";
}

/**
 * Strip tags to produce a plain-text fallback.
 *
 * Deliberately crude: it drops <style> and <script> bodies, converts block-level
 * boundaries to newlines, removes the remaining tags, and decodes the five
 * entities `escapeHtml` produces. It does not lay out tables, preserve link
 * targets, or wrap at 78 columns, so it is a readable fallback rather than a
 * faithful rendering. Templates that need a real text part should ship one.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Node-only. Wraps the `mjml` peer dependency, which is why this lives behind the
 * `./compile` subpath rather than the package root -- importing it from a Worker
 * would pull the whole compiler into the bundle.
 *
 * Compiler errors are returned rather than thrown. MJML reports per-tag problems
 * while still producing usable HTML, so a caller saving a draft wants both the
 * output and the diagnostics; throwing would discard the former to report the latter.
 */
export async function compileMjmlTemplate(
  source: string,
  options: MjmlCompileOptions = {},
): Promise<MjmlCompileResult> {
  const { keepComments = false, minify = true, validationLevel = "strict" } = options;

  // MJML 5 made this async; v4 returned the result synchronously.
  const result = await mjml2html(source, { keepComments, minify, validationLevel });

  return {
    html: result.html,
    text: htmlToText(result.html),
    errors: result.errors.map((error) => ({
      line: error.line,
      message: error.message,
      tagName: error.tagName,
      formattedMessage: error.formattedMessage,
    })),
  };
}
