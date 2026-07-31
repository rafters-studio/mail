import { describe, expect, it } from "vitest";
import { createMjmlRenderer, substitute } from "../src/renderer.js";

describe("substitute", () => {
  it("interpolates a double-brace placeholder", () => {
    expect(substitute("Hi {{name}}", { name: "Sean" })).toBe("Hi Sean");
  });

  it("HTML-escapes a double-brace placeholder", () => {
    expect(substitute("{{name}}", { name: '<script>"x"</script>' })).toBe(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;",
    );
  });

  it("escapes ampersands without double-escaping the entities it just produced", () => {
    expect(substitute("{{v}}", { v: "a & b < c" })).toBe("a &amp; b &lt; c");
  });

  it("leaves a triple-brace placeholder unescaped", () => {
    expect(substitute("{{{html}}}", { html: "<b>bold</b>" })).toBe("<b>bold</b>");
  });

  it("does not leave a stray brace when a triple-brace placeholder is substituted", () => {
    expect(substitute("[{{{v}}}]", { v: "x" })).toBe("[x]");
  });

  it("renders a missing variable as empty string rather than erroring", () => {
    expect(substitute("Hi {{missing}}!", {})).toBe("Hi !");
  });

  it("renders a null variable as empty string", () => {
    expect(substitute("[{{v}}]", { v: null })).toBe("[]");
  });

  it("resolves a dotted path", () => {
    expect(substitute("{{user.name}}", { user: { name: "Sean" } })).toBe("Sean");
  });

  it("resolves a deeply dotted path", () => {
    expect(substitute("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("renders empty string when an intermediate path segment is missing", () => {
    expect(substitute("[{{user.address.city}}]", { user: {} })).toBe("[]");
  });

  it("does not index into a string, so member access is not expression evaluation", () => {
    expect(substitute("[{{name.length}}]", { name: "Sean" })).toBe("[]");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(substitute("{{  name  }}", { name: "Sean" })).toBe("Sean");
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(substitute("{{a}}-{{a}}-{{a}}", { a: "x" })).toBe("x-x-x");
  });

  it("renders numbers and booleans", () => {
    expect(substitute("{{n}}/{{b}}", { n: 42, b: true })).toBe("42/true");
  });

  it("renders an object as empty rather than [object Object]", () => {
    expect(substitute("[{{v}}]", { v: { a: 1 } })).toBe("[]");
  });

  it("renders an array as empty rather than a comma-joined list", () => {
    expect(substitute("[{{v}}]", { v: [1, 2] })).toBe("[]");
  });

  it("escapes all five characters the README documents", () => {
    expect(substitute("{{v}}", { v: "&<>\"'" })).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("leaves an unrecognized placeholder syntax untouched", () => {
    expect(substitute("{{ not-an-identifier }}", {})).toBe("{{ not-an-identifier }}");
  });

  it("supports no conditionals or loops, leaving block syntax as literal text", () => {
    expect(substitute("{{#if x}}y{{/if}}", { x: true })).toBe("{{#if x}}y{{/if}}");
  });

  it("skips escaping when escape is false, for plain-text bodies", () => {
    expect(substitute("{{v}}", { v: "a & b" }, { escape: false })).toBe("a & b");
  });

  it("treats both brace forms identically when escaping is off", () => {
    const props = { v: "<b>x</b>" };
    expect(substitute("{{v}}", props, { escape: false })).toBe(
      substitute("{{{v}}}", props, { escape: false }),
    );
  });
});

describe("createMjmlRenderer", () => {
  it("renders a template supplied at construction", async () => {
    const renderer = createMjmlRenderer({ welcome: { html: "<p>Hi {{name}}</p>" } });
    const result = await renderer.render("welcome", { name: "Sean" });
    expect(result.html).toBe("<p>Hi Sean</p>");
  });

  it("renders a template supplied via register", async () => {
    const renderer = createMjmlRenderer();
    renderer.register("welcome", { html: "<p>{{name}}</p>" });
    const result = await renderer.render("welcome", { name: "Sean" });
    expect(result.html).toBe("<p>Sean</p>");
  });

  it("substitutes into the text part when the template has one", async () => {
    const renderer = createMjmlRenderer({
      welcome: { html: "<p>Hi {{name}}</p>", text: "Hi {{name}}" },
    });
    const result = await renderer.render("welcome", { name: "Sean" });
    expect(result.text).toBe("Hi Sean");
  });

  it("does not HTML-escape the text part, which a plain-text reader would show literally", async () => {
    const renderer = createMjmlRenderer({
      t: { html: "<p>{{v}}</p>", text: "{{v}}" },
    });
    const result = await renderer.render("t", { v: "Tom & Jerry <fan>" });
    expect(result.text).toBe("Tom & Jerry <fan>");
    expect(result.html).toBe("<p>Tom &amp; Jerry &lt;fan&gt;</p>");
  });

  it("omits text entirely when the template has no text part", async () => {
    const renderer = createMjmlRenderer({ welcome: { html: "<p>x</p>" } });
    const result = await renderer.render("welcome", {});
    expect(result).not.toHaveProperty("text");
  });

  it("throws a named error for an unregistered template", async () => {
    const renderer = createMjmlRenderer();
    await expect(renderer.render("nope", {})).rejects.toThrow(/Unknown template "nope"/);
  });

  it("lets register overwrite a previously registered template", async () => {
    const renderer = createMjmlRenderer({ t: { html: "old" } });
    renderer.register("t", { html: "new" });
    expect((await renderer.render("t", {})).html).toBe("new");
  });

  it("does not let later mutation of the constructor argument affect the registry", async () => {
    const templates = { t: { html: "original" } };
    const renderer = createMjmlRenderer(templates);
    templates.t = { html: "mutated" };
    expect((await renderer.render("t", {})).html).toBe("original");
  });
});
