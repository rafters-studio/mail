// Every test of a case compares the written bytes with its golden (form 01a18fda, Tests):
// "Every test of a case compares the written bytes with its golden."
import { readFileSync } from "node:fs";
import { expect } from "vite-plus/test";
import {
  createMail,
  type Mail,
  MailWriteError,
  type MailWriteCode,
  type Written,
} from "../src/message/index.ts";
import { createRandom, now } from "./env.ts";
import * as asciiFilename from "./fixtures/write/ascii-filename.ts";
import * as attachment from "./fixtures/write/attachment.ts";
import * as docx from "./fixtures/write/docx.ts";
import * as forward from "./fixtures/write/forward.ts";
import * as intl from "./fixtures/write/intl.ts";
import * as link from "./fixtures/write/link.ts";
import * as longFilename from "./fixtures/write/long-filename.ts";
import * as plain from "./fixtures/write/plain.ts";
import * as reply from "./fixtures/write/reply.ts";
import * as rich from "./fixtures/write/rich.ts";
import * as rtl from "./fixtures/write/rtl.ts";

const CASES: Record<string, { run(mail: Mail): Written }> = {
  plain,
  link,
  attachment,
  intl,
  "long-filename": longFilename,
  "ascii-filename": asciiFilename,
  docx,
  rich,
  rtl,
  reply,
  forward,
};

/** The cases, in the order the form's case table gives them. */
export const CASE_NAMES = Object.keys(CASES);

/** The mail every test writes with: rafters.studio, the counting random and the fixed clock. */
export function testMail(random = createRandom()): Mail {
  return createMail({ domain: "rafters.studio", random, now });
}

/** Writes a case with a fresh test mail and fails unless its bytes equal its golden. */
export function writeCase(name: string): Written {
  const fixture = CASES[name];
  if (fixture === undefined) throw new Error(`${name} is not a case`);
  const written = fixture.run(testMail());
  const golden = readFileSync(new URL(`./fixtures/write/${name}.expected.eml`, import.meta.url));
  expect(text(written), name).toBe(golden.toString("latin1"));
  return written;
}

/** The written message as text: it is 7-bit, so each byte is one character. */
export function text(written: Written): string {
  return Buffer.from(written.bytes).toString("latin1");
}

/** Fails unless writing is refused with this code, field and message, having drawn no entropy. */
export function expectRefused(
  write: (mail: Mail) => unknown,
  code: MailWriteCode,
  field: string,
  said: string,
): void {
  let drawn = 0;
  const random = createRandom();
  const mail = testMail((into) => {
    drawn += into.length;
    return random(into);
  });
  let refusal: unknown;
  try {
    write(mail);
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(MailWriteError);
  expect(refusal).toMatchObject({
    name: "MailWriteError",
    code,
    field,
    message: `${field}: ${said}`,
  });
  expect(drawn).toBe(0);
}
