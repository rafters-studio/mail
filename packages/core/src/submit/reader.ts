// A command line, a message and its end (RFC 5321 4.1.1): "SMTP commands are character strings
// terminated by <CRLF>." Only CRLF ends anything here: a bare LF or CR is how SMTP smuggling begins
// (RFC 5321 2.3.8), so in a command it closes the session, and in a message it never ends a line.

/** RFC 5321 4.5.3.1.4: a command line, CRLF included. */
const COMMAND_LINE = 512;
/** RFC 4954 3: MAIL may be 500 octets longer, for the AUTH parameter. */
const MAIL_LINE = 1012;
/** RFC 4954 4: an AUTH continuation is not a command, and has its own limit. */
const CONTINUATION_LINE = 12_288;

const CR = 0x0d;
const LF = 0x0a;
const DOT = 0x2e;

/** What the buffer holds at a line's start: a whole line, not enough yet, or a line that closes. */
export type Line =
  | { kind: "line"; text: string; end: number }
  | { kind: "more" }
  | { kind: "bad"; reply: string };

/**
 * RFC 5321 4.1.1: the line at the start of `buffer`. A line is judged by its length before its
 * ending, and by the same rule however much of it has arrived, so one byte at a time closes exactly
 * where a whole line does and nothing after it is read as a command.
 */
export function readLine(buffer: string, continuation: boolean): Line {
  const ending = buffer.search(/[\r\n]/);
  const length = ending === -1 ? buffer.length : ending;
  const limit = continuation
    ? CONTINUATION_LINE
    : /^mail /i.test(buffer)
      ? MAIL_LINE
      : COMMAND_LINE;
  if (length + 2 > limit) return { kind: "bad", reply: "500 line too long" };
  if (ending === -1) return { kind: "more" };
  const next = buffer.charAt(ending + 1);
  if (buffer.charAt(ending) === "\n" || (next !== "" && next !== "\n"))
    return { kind: "bad", reply: "500 bad line ending" };
  return next === ""
    ? { kind: "more" }
    : { kind: "line", text: buffer.slice(0, ending), end: ending + 2 };
}

/** Where a message's bytes are, relative to the end of its last line. */
const MIDDLE = 0;
const AFTER_CR = 1;
const LINE_START = 2;
const AFTER_DOT = 3;
const AFTER_DOT_CR = 4;

/**
 * RFC 5321 4.5.2: a message as it arrives. `read` takes binary text and returns where the terminator
 * ended, or null. Only CRLF, dot, CRLF ends it, the leading period of any other line is undone, and
 * past `maxSize` the bytes are counted and not kept, so the whole message is read before any answer
 * and what is held stays bounded.
 */
export function messageReader(maxSize: number): {
  read: (text: string) => number | null;
  bytes: () => Uint8Array;
  size: () => number;
} {
  let kept = new Uint8Array(Math.min(maxSize, 65_536));
  let size = 0;
  let state = LINE_START;
  /** Keeps one byte of the message while it fits, doubling the store as it is needed. */
  const keep = (byte: number): void => {
    if (size < maxSize) {
      if (size === kept.length) {
        const grown = new Uint8Array(Math.min(maxSize, kept.length * 2));
        grown.set(kept);
        kept = grown;
      }
      kept[size] = byte;
    }
    size++;
  };
  return {
    read: (text) => {
      for (let i = 0; i < text.length; i++) {
        const byte = text.charCodeAt(i);
        if (state === LINE_START && byte === DOT) state = AFTER_DOT;
        else if (state === AFTER_DOT && byte === CR) state = AFTER_DOT_CR;
        else if (state === AFTER_DOT_CR && byte === LF) return i + 1;
        else {
          if (state === AFTER_DOT_CR) keep(CR);
          keep(byte);
          state = byte === CR ? AFTER_CR : state === AFTER_CR && byte === LF ? LINE_START : MIDDLE;
        }
      }
      return null;
    },
    bytes: () => kept.subarray(0, Math.min(size, maxSize)),
    size: () => size,
  };
}
