// A date that is a real moment, RFC 5322 3.3: "The date and time-of-day SHOULD express local time."
// It is read with the obsolete forms of RFC 5322 4.3 (two-digit years, named zones) and checked
// as a real moment, not handed to `Date.parse`, which accepts 30 February (research 01a19b3f).

import { lex } from "./lexer.ts";

/** A date read: its instant and zone as written (null when unknown), or why it is no moment. */
export type ReadDate = { instant: Date; zone: string | null } | { instant: null; problem: string };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// RFC 5322 4.3: the named zones and their offsets in hours; military letters and others are unknown.
const ZONES: Record<string, number> = {
  ut: 0,
  gmt: 0,
  est: -5,
  edt: -4,
  cst: -6,
  cdt: -5,
  mst: -7,
  mdt: -6,
  pst: -8,
  pdt: -7,
};

/** The zone's offset east of Universal Time in minutes and whether it is known (RFC 5322 3.3, 4.3). */
function offset(zone: string): { minutes: number; known: boolean } {
  const numeric = /^([+-])(\d\d)(\d\d)$/.exec(zone);
  if (numeric !== null) {
    const minutes = Number(numeric[2]) * 60 + Number(numeric[3]);
    return { minutes: numeric[1] === "-" ? -minutes : minutes, known: zone !== "-0000" };
  }
  const hours = ZONES[zone.toLowerCase()];
  return hours === undefined ? { minutes: 0, known: false } : { minutes: hours * 60, known: true };
}

/** The full year of a two-, three- or four-digit year (RFC 5322 4.3). */
function fullYear(year: string): number {
  const n = Number(year);
  return year.length === 4 ? n : year.length === 3 || n >= 50 ? 1900 + n : 2000 + n;
}

/**
 * Reads a Date field (RFC 5322 3.3, 4.3): an optional weekday, day, month, year, hour, minute,
 * optional second and zone. Problems are checked in order: not a date, zone minutes, time of
 * day, day of the month, weekday; a leap second is the first second of the next minute.
 */
export function readDate(text: string): ReadDate {
  const { tokens, problem } = lex(text);
  const words = tokens
    .filter((t) => !(t.kind === "special" && (t.value === "," || t.value === ":")))
    .map((t) => t.value);
  const weekday = DAYS.includes((words[0] ?? "").toLowerCase()) ? words.shift() : undefined;
  const [day = "", monthName = "", year = "", hour = "", minute = ""] = words;
  const [second = "", zone = ""] = words.length === 7 ? words.slice(5) : ["00", ...words.slice(5)];
  const month = MONTHS.indexOf(monthName.toLowerCase());
  if (
    problem !== null ||
    (words.length !== 6 && words.length !== 7) ||
    !/^\d{1,2}$/.test(day) ||
    month < 0 ||
    !/^\d{2,4}$/.test(year) ||
    ![hour, minute, second].every((w) => /^\d\d$/.test(w)) ||
    (/^[+-]/.test(zone) && !/^[+-]\d{4}$/.test(zone))
  ) {
    return { instant: null, problem: "not a date" };
  }
  if (/^[+-]\d\d[6-9]\d$/.test(zone)) return { instant: null, problem: "zone minutes over 59" };
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60) {
    return { instant: null, problem: "not a time of day" };
  }
  // setUTCFullYear, not Date.UTC, so the years 0 to 99 stay themselves.
  const date = new Date(0);
  date.setUTCFullYear(fullYear(year), month, Number(day));
  if (date.getUTCDate() !== Number(day))
    return { instant: null, problem: "not a day of that month" };
  if (weekday !== undefined && DAYS[date.getUTCDay()] !== weekday.toLowerCase()) {
    return { instant: null, problem: "day of the week does not match" };
  }
  const { minutes, known } = offset(zone);
  const seconds = (Number(hour) * 60 + Number(minute) - minutes) * 60 + Number(second);
  return { instant: new Date(date.getTime() + seconds * 1000), zone: known ? zone : null };
}
