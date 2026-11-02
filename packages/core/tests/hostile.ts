// The 25 MiB shapes of FR-MAIL-045 and FR-MAIL-046. Each builds its bytes alone, so a child process
// with a small heap holds no more than one shape's text at a time.

export const SHAPES = ["fields", "folded", "parts", "plain", "empty", "attachment"] as const;
export type Shape = (typeof SHAPES)[number];

const SIZE = 25 * 1024 * 1024;

/** A message of `shape`, its Message-ID the shape's name at x.test. */
export function hostile(shape: Shape): Uint8Array {
  const head = `From: a@x.test\r\nMessage-ID: <${shape}@x.test>\r\n`;
  const fill = (line: string) => line.repeat(Math.ceil(SIZE / line.length));
  if (shape === "fields") return new TextEncoder().encode(`${head}${fill("X: y\r\n")}\r\nbody\r\n`);
  if (shape === "folded")
    return new TextEncoder().encode(`${head}X: y\r\n${fill(" z\r\n")}\r\nbody\r\n`);
  if (shape === "parts")
    return new TextEncoder().encode(
      `${head}Content-Type: multipart/mixed; boundary="b"\r\n\r\n${fill("--b\r\n\r\n\r\n")}--b--\r\n`,
    );
  if (shape === "empty") return new TextEncoder().encode(`${head}\r\n${fill("\r\n")}`);
  if (shape === "attachment")
    return new TextEncoder().encode(
      `${head}Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\n\r\nhello\r\n--b\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${fill(`${"a".repeat(76)}\r\n`)}--b--\r\n`,
    );
  return new TextEncoder().encode(`${head}\r\n${fill(`${"a".repeat(70)}\r\n`)}`);
}
