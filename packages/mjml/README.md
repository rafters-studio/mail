# @rafters/mail-mjml

MJML support for `@rafters/mail`, split across two entry points that never meet in a bundle.

| Import                       | Runtime                        | Pulls in `mjml`? |
| ---------------------------- | ------------------------------ | ---------------- |
| `@rafters/mail-mjml`         | Edge (Workers, Deno, browsers) | No               |
| `@rafters/mail-mjml/compile` | Node only                      | Yes              |

The split is the point. MJML's compiler is large and Node-bound; email rendering at request time is just string substitution against HTML that was compiled earlier. Compile at build time or on save, ship the result, substitute at the edge.

## Install

```bash
pnpm add @rafters/mail-mjml
pnpm add -D mjml   # only if you compile; it is an optional peer dependency
```

`mjml` is an optional peer dependency, so installing this package without it is supported and is the normal case for a Worker that only renders.

## Rendering (edge-safe)

`createMjmlRenderer` returns a `TemplateRenderer` from `@rafters/mail`.

```typescript
import { createMjmlRenderer } from "@rafters/mail-mjml";

const renderer = createMjmlRenderer({
  welcome: { html: "<p>Hi {{name}}</p>", text: "Hi {{name}}" },
});

// or register later
renderer.register("receipt", { html: compiledReceiptHtml });

const { html, text } = await renderer.render("welcome", { name: "Sean" });
```

`render` throws if the template name was never registered. That is a programmer error and distinct from a missing variable, which is not.

## Substitution rules

Deliberately minimal. There are no conditionals, no loops, and no expressions -- anything needing logic belongs in a code-authored React Email template, not a string templating language reinvented badly.

| Syntax          | Behavior                                          |
| --------------- | ------------------------------------------------- |
| `{{name}}`      | Interpolated, HTML-escaped                        |
| `{{{name}}}`    | Interpolated raw, no escaping                     |
| `{{user.name}}` | Dotted paths resolve through nested objects       |
| `{{missing}}`   | Renders as an empty string. Never throws          |
| `{{ name }}`    | Whitespace inside braces is ignored               |
| `{{#if x}}`     | Not supported. Left in the output as literal text |

Details worth knowing:

- **Escaping covers `& < > " '`.** Enough to stop an interpolated value from being read as markup or from breaking out of an attribute.
- **The text part is never escaped.** Escaping protects against a value being read as markup, and a `text/plain` body has no markup to be read as. Escaping there would only mean the recipient sees a literal `&lt;` instead of `<`. So in the text part, `{{x}}` and `{{{x}}}` behave identically.
- **Member access is not expression evaluation.** `{{name.length}}` on a string renders empty rather than `4`. Only plain objects are traversed, so a template cannot reach into string or array internals.
- **Missing means empty, at every depth.** `{{user.address.city}}` renders empty when `user.address` is absent, rather than throwing.
- **Non-primitive values render empty.** Objects, arrays, and functions substitute to an empty string rather than `[object Object]`.

## Compiling (Node only)

```typescript
import { compileMjmlTemplate } from "@rafters/mail-mjml/compile";

const { html, text, errors } = await compileMjmlTemplate(source, {
  validationLevel: "strict", // default
  minify: true, // default
  keepComments: false, // default
});
```

Placeholders survive compilation, so the usual flow is: author MJML containing `{{name}}`, compile once, store `html` and `text`, then substitute per send at the edge.

**Errors are returned, not thrown.** MJML reports per-tag problems while still producing usable HTML, so an editor's save flow wants the output _and_ the diagnostics. Input that is not parseable as markup at all does throw.

**The `text` fallback is crude by design.** It strips tags, drops `<style>` and `<script>` bodies, converts block boundaries to newlines, and decodes the five escaped entities. It does not lay out tables, preserve link targets, or wrap at 78 columns. Templates that need a good plain-text part should author one rather than rely on this.

## Why `mjml` is an optional peer dependency

A Worker that renders but never compiles should not install a Node-only compiler, and `pnpm` would otherwise warn on every install. Marked optional, the render path installs clean and the compile path fails loudly with a missing-module error if you forgot it -- which is the correct time to find out.
