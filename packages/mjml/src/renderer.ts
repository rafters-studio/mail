import type { TemplateRenderer } from "@rafters/mail";

export interface CompiledTemplate {
  html: string;
  text?: string;
}

export interface MjmlRenderer extends TemplateRenderer {
  register(name: string, compiled: CompiledTemplate): void;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Resolve a dotted path against props. Returns undefined for any missing segment,
 * which the caller renders as an empty string.
 *
 * Only plain objects are traversed. Indexing into a string or a number would
 * otherwise resolve `{{name.length}}` to a value, which is expression evaluation
 * rather than variable substitution and is deliberately out of scope.
 */
function resolvePath(props: Record<string, unknown>, path: string): unknown {
  let current: unknown = props;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

// Triple-brace alternative is listed first so it wins over the double-brace form
// at the same position; a `{{` matcher would otherwise consume the leading two
// braces of `{{{x}}}` and leave a stray brace in the output.
const PLACEHOLDER = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Substitute placeholders into `source`.
 *
 * `escape` controls whether double-brace placeholders are HTML-escaped, and must be
 * false for a plain-text body. Escaping exists to stop a value from being read as
 * markup; in a text/plain part there is no markup to be read as, so escaping there
 * does not protect anything and actively corrupts the output -- the recipient would
 * see a literal `&lt;` instead of `<`. In text mode the two brace forms are therefore
 * equivalent, both interpolating raw.
 */
export function substitute(
  source: string,
  props: Record<string, unknown>,
  { escape = true }: { escape?: boolean } = {},
): string {
  return source.replace(PLACEHOLDER, (_match, rawPath?: string, escapedPath?: string) => {
    const path = rawPath ?? escapedPath;
    if (path === undefined) return "";
    const value = stringify(resolvePath(props, path));
    return escape && rawPath === undefined ? escapeHtml(value) : value;
  });
}

/**
 * Edge-safe renderer. Substitutes variables into HTML that was compiled ahead of
 * time by `@rafters/mail-mjml/compile`; it never invokes the MJML compiler, and
 * this module must not import it -- that separation is what keeps the `.` entry
 * out of the Workers bundle size budget.
 */
export function createMjmlRenderer(
  compiledTemplates: Record<string, CompiledTemplate> = {},
): MjmlRenderer {
  const registry = new Map<string, CompiledTemplate>(Object.entries(compiledTemplates));

  return {
    register(name: string, compiled: CompiledTemplate): void {
      registry.set(name, compiled);
    },

    async render(
      template: string,
      props: Record<string, unknown>,
    ): Promise<{ html: string; text?: string }> {
      const compiled = registry.get(template);
      if (!compiled) {
        throw new Error(
          `Unknown template "${template}". Register it with register(name, compiled) or pass it to createMjmlRenderer.`,
        );
      }

      const result: { html: string; text?: string } = {
        html: substitute(compiled.html, props),
      };
      if (compiled.text !== undefined) {
        result.text = substitute(compiled.text, props, { escape: false });
      }
      return result;
    },
  };
}
