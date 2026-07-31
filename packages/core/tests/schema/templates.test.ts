import { describe, expect, it } from "vitest";
import { zocker } from "zocker";
import { templateSchema } from "../../src/schema/templates.js";
import { templateSourceTypeSchema } from "../../src/schema/enums.js";

function validTemplate() {
  return {
    id: "0195e2a0-1c3d-7000-8000-000000000001",
    mailboxId: "0195e2a0-1c3d-7000-8000-000000000002",
    name: "Welcome email",
    sourceType: "mjml" as const,
    bodySource: "<mjml><mj-body><mj-text>Hi {{name}}</mj-text></mj-body></mjml>",
    bodyCompiled: "<html><body>Hi {{name}}</body></html>",
    bodyCompiledText: "Hi {{name}}",
    variablesSchema: { name: { type: "string" } },
    ownerId: "user_01H8",
    createdAt: "2026-07-31T20:00:00.000Z",
    updatedAt: "2026-07-31T20:00:00.000Z",
  };
}

describe("templateSourceTypeSchema", () => {
  it("accepts every declared source type", () => {
    for (const value of templateSourceTypeSchema.options) {
      expect(templateSourceTypeSchema.parse(value)).toBe(value);
    }
  });

  it("rejects a source type the compiler has no path for", () => {
    expect(() => templateSourceTypeSchema.parse("handlebars")).toThrow();
  });
});

describe("templateSchema", () => {
  it("parses a fully populated template", () => {
    expect(templateSchema.parse(validTemplate())).toEqual(validTemplate());
  });

  it("treats a null mailboxId as the global template scope", () => {
    const parsed = templateSchema.parse({ ...validTemplate(), mailboxId: null });
    expect(parsed.mailboxId).toBeNull();
  });

  it("accepts a null plain-text body for html templates that have no text fallback", () => {
    const parsed = templateSchema.parse({
      ...validTemplate(),
      sourceType: "html",
      bodyCompiledText: null,
    });
    expect(parsed.bodyCompiledText).toBeNull();
  });

  it("accepts a null variablesSchema when the editor supplied no hints", () => {
    const parsed = templateSchema.parse({ ...validTemplate(), variablesSchema: null });
    expect(parsed.variablesSchema).toBeNull();
  });

  it("preserves arbitrary nested values inside variablesSchema", () => {
    const variablesSchema = { user: { name: { type: "string" }, tiers: [1, 2, 3] } };
    const parsed = templateSchema.parse({ ...validTemplate(), variablesSchema });
    expect(parsed.variablesSchema).toEqual(variablesSchema);
  });

  it("rejects a bigint in variablesSchema, which JSON.stringify would throw on", () => {
    const template = { ...validTemplate(), variablesSchema: { count: 1n } };
    expect(() => templateSchema.parse(template)).toThrow();
    expect(() => JSON.stringify(template)).toThrow();
  });

  it("rejects a symbol in variablesSchema, which JSON.stringify would silently drop", () => {
    const template = { ...validTemplate(), variablesSchema: { marker: Symbol("x") } };
    expect(() => templateSchema.parse(template)).toThrow();
    expect(JSON.parse(JSON.stringify(template)).variablesSchema).toEqual({});
  });

  it("rejects a non-finite number in variablesSchema, which JSON.stringify turns into null", () => {
    const template = { ...validTemplate(), variablesSchema: { ratio: Number.POSITIVE_INFINITY } };
    expect(() => templateSchema.parse(template)).toThrow();
    expect(JSON.parse(JSON.stringify(template)).variablesSchema).toEqual({ ratio: null });
  });

  it("rejects an id that is not a uuid", () => {
    expect(() => templateSchema.parse({ ...validTemplate(), id: "template-1" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => templateSchema.parse({ ...validTemplate(), name: "" })).toThrow();
  });

  it("rejects a name longer than 120 characters", () => {
    expect(() => templateSchema.parse({ ...validTemplate(), name: "a".repeat(121) })).toThrow();
  });

  it("accepts a name of exactly 120 characters", () => {
    const name = "a".repeat(120);
    expect(templateSchema.parse({ ...validTemplate(), name }).name).toBe(name);
  });

  it("rejects a timestamp that is not ISO 8601", () => {
    expect(() => templateSchema.parse({ ...validTemplate(), createdAt: "2026-07-31" })).toThrow();
  });

  it("rejects a missing mailboxId rather than defaulting it to global", () => {
    const { mailboxId: _omitted, ...withoutMailboxId } = validTemplate();
    expect(() => templateSchema.parse(withoutMailboxId)).toThrow();
  });
});

describe("templateSchema JSON round-trip", () => {
  it("survives the blob write-then-read cycle unchanged", () => {
    const template = templateSchema.parse(validTemplate());
    const roundTripped = templateSchema.parse(JSON.parse(JSON.stringify(template)));
    expect(roundTripped).toEqual(template);
  });

  it("round-trips generated templates, so no field type is lossy through JSON", () => {
    const generate = zocker(templateSchema);
    for (let i = 0; i < 20; i++) {
      const generated = generate.generate();
      const roundTripped = templateSchema.parse(JSON.parse(JSON.stringify(generated)));
      expect(roundTripped).toEqual(generated);
    }
  });
});
