// The session goldens (form 01a19de8, Tests): "Exact client and server bytes for each row of each
// table above and the outcome table, whole and one byte at a time, with fixed `random` and `now`."
// Written by hand from the form's tables, never captured from the session.

/** One turn: what the client sends, what the server answers, and whether a resume may follow it. */
export type Turn = { client: string; server: string; inside?: true };
export type Golden = { name: string; turns: Turn[] };

/** A client's command and the reply lines it gets, each line with its CRLF. */
function turn(client: string, ...server: string[]): Turn {
  return { client: `${client}\r\n`, server: server.map((line) => `${line}\r\n`).join("") };
}

/** A turn ending inside AUTH's continuation or DATA, which a session does not save. */
function inside(client: string, ...server: string[]): Turn {
  return { ...turn(client, ...server), inside: true };
}

export const HOST = "submit.example";
// RFC 4616's NUL, user, NUL, password, and RFC 4954's username and password, as base64.
export const PLAIN = "AHVzZXIAcGFzc3dvcmQ=";
export const USER = "dXNlcg==";
export const PASSWORD = "cGFzc3dvcmQ=";

/** A message the fake ports accept, with both fields a session would otherwise write. */
const MESSAGE =
  "From: Sean <sean@rafters.studio>\r\n" +
  "To: mary@example.net\r\n" +
  "Subject: Hello\r\n" +
  "Date: Mon, 2 Mar 2026 10:00:00 -0700\r\n" +
  "Message-ID: <golden@rafters.studio>\r\n" +
  "\r\n" +
  ".lead\r\n" +
  "body\r\n";
/** The same message as a client writes it after DATA: the period doubled, the terminator added. */
const STUFFED = MESSAGE.replace("\r\n.lead", "\r\n..lead");

const LOGGED_IN = turn(`AUTH PLAIN ${PLAIN}`, "235 Ok");
const EHLO = turn(
  "EHLO client.example",
  `250-${HOST}`,
  "250-SIZE 26214000",
  "250 AUTH PLAIN LOGIN",
);

export const GOLDENS: Golden[] = [
  {
    name: "in any state",
    turns: [
      turn("NOOP", "250 Ok"),
      turn("VRFY sean", "252 Cannot verify"),
      turn("TURN", "502 Not implemented"),
      turn("constructor", "502 Not implemented"),
      turn("", "502 Not implemented"),
      turn("HELO client.example", `250 ${HOST}`),
      turn("RSET", "250 Ok"),
      EHLO,
      turn("ehlo client.example", `250-${HOST}`, "250-SIZE 26214000", "250 AUTH PLAIN LOGIN"),
      turn("EHLO", "501 Bad syntax"),
      turn("noop", "250 Ok"),
      turn("QUIT", "221 Bye"),
    ],
  },
  {
    name: "not authenticated",
    turns: [
      EHLO,
      turn("MAIL FROM:<sean@rafters.studio>", "530 Authentication required"),
      turn("RCPT TO:<mary@example.net>", "503 Bad sequence"),
      turn("DATA", "503 Bad sequence"),
      turn("AUTH", "501 Bad syntax"),
      turn("AUTH CRAM-MD5", "504 Unknown mechanism"),
      turn("AUTH PLAIN a b", "501 Bad syntax"),
      turn("QUIT", "221 Bye"),
    ],
  },
  {
    name: "AUTH PLAIN on its line",
    turns: [EHLO, LOGGED_IN, turn(`AUTH PLAIN ${PLAIN}`, "503 Already authenticated")],
  },
  {
    name: "AUTH PLAIN after a prompt",
    turns: [inside("AUTH PLAIN", "334 "), turn(PLAIN, "235 Ok"), turn("NOOP", "250 Ok")],
  },
  {
    name: "AUTH LOGIN with no username",
    turns: [
      inside("AUTH LOGIN", "334 VXNlcm5hbWU6"),
      inside(USER, "334 UGFzc3dvcmQ6"),
      turn(PASSWORD, "235 Ok"),
    ],
  },
  {
    name: "AUTH LOGIN with a username",
    turns: [inside(`auth login ${USER}`, "334 UGFzc3dvcmQ6"), turn(PASSWORD, "235 Ok")],
  },
  {
    name: "ready",
    turns: [
      LOGGED_IN,
      turn("RCPT TO:<mary@example.net>", "503 Bad sequence"),
      turn("DATA", "503 Bad sequence"),
      turn("MAIL FROM: <sean@rafters.studio>", "501 Bad syntax"),
      turn("MAIL FROM:sean@rafters.studio", "501 Bad syntax"),
      turn("MAIL", "501 Bad syntax"),
      turn("MAIL FROM:<sean@rafters.studio>", "250 Ok"),
    ],
  },
  {
    name: "envelope",
    turns: [
      LOGGED_IN,
      turn("MAIL FROM:<sean@rafters.studio>", "250 Ok"),
      turn("MAIL FROM:<sean@rafters.studio>", "503 Bad sequence"),
      turn("DATA", "503 Bad sequence"),
      turn("RCPT TO: <mary@example.net>", "501 Bad syntax"),
      turn("RCPT TO:<mary@example.net>", "250 Ok"),
      turn("RSET", "250 Ok"),
      turn("RCPT TO:<mary@example.net>", "503 Bad sequence"),
      turn("MAIL FROM:<sean@rafters.studio>", "250 Ok"),
      turn("HELO client.example", `250 ${HOST}`),
      turn("RCPT TO:<mary@example.net>", "503 Bad sequence"),
      turn("MAIL FROM:<sean@rafters.studio>", "250 Ok"),
      EHLO,
      turn("RCPT TO:<mary@example.net>", "503 Bad sequence"),
    ],
  },
  {
    name: "a message",
    turns: [
      EHLO,
      LOGGED_IN,
      turn("MAIL FROM:<sean@rafters.studio>", "250 Ok"),
      turn("RCPT TO:<mary@example.net>", "250 Ok"),
      inside("DATA", "354 End data with <CR><LF>.<CR><LF>"),
      { client: `${STUFFED}.\r\n`, server: "250 Ok\r\n" },
      turn("RCPT TO:<mary@example.net>", "503 Bad sequence"),
      turn("QUIT", "221 Bye"),
    ],
  },
];
