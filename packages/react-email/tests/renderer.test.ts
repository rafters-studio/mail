import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { Text } from "@react-email/components";
import { createReactEmailRenderer } from "../src/renderer.js";

function SimpleTemplate(props: Record<string, unknown>) {
  return createElement(Text, null, `Hello ${props.name}`);
}

describe("createReactEmailRenderer", () => {
  it("renders a registered template by name", async () => {
    const renderer = createReactEmailRenderer({ simple: SimpleTemplate });
    const result = await renderer.render("simple", { name: "World" });

    expect(result.html).toContain("Hello World");
    expect(result.text).toBeDefined();
    expect(result.text).toContain("Hello World");
  });

  it("accepts templates registered after creation", async () => {
    const renderer = createReactEmailRenderer();
    renderer.register("simple", SimpleTemplate);

    const result = await renderer.render("simple", { name: "Late" });
    expect(result.html).toContain("Hello Late");
  });

  it("throws when rendering an unregistered template", async () => {
    const renderer = createReactEmailRenderer();

    await expect(renderer.render("missing", {})).rejects.toThrow('Template "missing" not found');
  });

  it("lists registered template names in the error message", async () => {
    const renderer = createReactEmailRenderer({ alpha: SimpleTemplate });
    renderer.register("beta", SimpleTemplate);

    await expect(renderer.render("gamma", {})).rejects.toThrow("alpha, beta");
  });

  it("returns HTML output containing the rendered content", async () => {
    const renderer = createReactEmailRenderer({ simple: SimpleTemplate });
    const result = await renderer.render("simple", { name: "Test" });

    expect(result.html).toContain("<!DOCTYPE html");
    expect(result.html).toContain("Hello Test");
  });
});
