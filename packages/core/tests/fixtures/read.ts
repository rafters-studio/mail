// What the read and IMAP step files both need of the read fixtures (research 01a19b44). It is not a
// step file: importing a step file would run its scenarios twice.
import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vite-plus/test";
import { z } from "zod";
import { readMessage } from "../../src/read/index.ts";

export const FIXTURES = new URL("./read/", import.meta.url);

export const encode = (text: string) => new TextEncoder().encode(text);

/** Every read fixture, against golden.json. */
export function everyFixture(): void {
  const golden = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(new URL("golden.json", FIXTURES), "utf8")));
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith(".eml"));
  expect(Object.keys(golden).sort()).toEqual(names.sort());
  for (const name of names) {
    const r = readMessage(new Uint8Array(readFileSync(new URL(name, FIXTURES))));
    expect(JSON.parse(JSON.stringify(r)), name).toEqual(golden[name]);
  }
}
