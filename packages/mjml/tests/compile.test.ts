import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileMjmlTemplate, htmlToText } from "../src/compile.js";

const VALID = `<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{name}}</mj-text></mj-column></mj-section></mj-body></mjml>`;

describe("compileMjmlTemplate", () => {
  it("compiles valid MJML to HTML", async () => {
    const result = await compileMjmlTemplate(VALID);
    expect(result.html).toContain("<html");
    expect(result.errors).toEqual([]);
  });

  it("preserves placeholders through compilation so the renderer can substitute later", async () => {
    const result = await compileMjmlTemplate(VALID);
    expect(result.html).toContain("{{name}}");
  });

  it("derives a plain-text fallback from the compiled HTML", async () => {
    const result = await compileMjmlTemplate(VALID);
    expect(result.text).toContain("Hi {{name}}");
    expect(result.text).not.toContain("<");
  });

  it("surfaces compiler errors for an unknown tag rather than throwing", async () => {
    const result = await compileMjmlTemplate(
      `<mjml><mj-body><mj-nonsense>x</mj-nonsense></mj-body></mjml>`,
      { validationLevel: "soft" },
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty("line");
    expect(result.errors[0]).toHaveProperty("tagName");
    expect(result.errors[0]).toHaveProperty("formattedMessage");
  });

  it("skips validation entirely when asked to", async () => {
    const result = await compileMjmlTemplate(
      `<mjml><mj-body><mj-nonsense>x</mj-nonsense></mj-body></mjml>`,
      { validationLevel: "skip" },
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects input that is not MJML at all", async () => {
    await expect(compileMjmlTemplate("this is not markup")).rejects.toThrow();
  });
});

describe("htmlToText", () => {
  it("strips tags", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("drops style and script bodies rather than inlining their source", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi");
    expect(htmlToText("<script>var x=1</script><p>Hi</p>")).toBe("Hi");
  });

  it("turns block boundaries into newlines", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\ntwo");
  });

  it("turns br into a newline", () => {
    expect(htmlToText("a<br/>b")).toBe("a\nb");
  });

  it("decodes the entities the renderer escapes, so a round-trip is readable", () => {
    expect(htmlToText("<p>a &amp; b &lt; c &quot;d&quot;</p>")).toBe('a & b < c "d"');
  });

  it("collapses a run of empty blocks to a single blank line, keeping the paragraph break", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  it("does not introduce a blank line between adjacent non-empty blocks", () => {
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\nb");
  });
});

describe("subpath isolation", () => {
  function read(relative: string): string {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  }

  // The whole point of the two-entry split is that the root entry stays edge-safe.
  // A stray `import "mjml"` in either of these files would pull the compiler into a
  // Workers bundle, and nothing else in the test suite would notice.
  it("keeps the root entry free of any mjml import", () => {
    expect(read("../src/index.ts")).not.toMatch(/from\s+["']mjml["']/);
  });

  it("keeps the renderer free of any mjml import", () => {
    expect(read("../src/renderer.ts")).not.toMatch(/from\s+["']mjml["']/);
  });

  it("confines the mjml import to the compile entry", () => {
    expect(read("../src/compile.ts")).toMatch(/from\s+["']mjml["']/);
  });
});
