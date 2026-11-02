// Templates are a plugin (form 01a18fda): "A template engine hands the writer `{ html, text }`;
// the core never imports a plugin." React Email renders one component both ways, and mail writes
// the two as given.
import type { Content } from "@rafters/mail/document";
import { render } from "@react-email/components";
import { createElement, type ReactElement } from "react";

// React's server-rendering markers: the Suspense boundaries `$`, `/$`, `$?` and `$!`, the text
// separator `<!-- -->` and lowercase-word markers. They mean nothing to a mail client, and the
// template golden holds none of them (research 01a19885: "raw React Email output kept 10 marker
// comments").
const REACT_COMMENTS = /<!--(\$[?!]?|\/\$|[a-z]+|\s*)-->/g;

/**
 * Form 01a18fda, The template plugin: a component rendered as HTML, without React's comments,
 * and as plain text, for the writer to write as given.
 */
export async function renderTemplate<P extends object>(
  component: (props: P) => ReactElement,
  props: P,
): Promise<Content> {
  const element = createElement(component, props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html: html.replace(REACT_COMMENTS, ""), text };
}
