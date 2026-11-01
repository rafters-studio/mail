// Long header fields (RFC 5322 2.2.3): "Each header field should be treated in its unfolded form
// for further syntactic and semantic evaluation." So a field may be broken into lines at any
// space, and a reader joins them again; mail breaks them to keep lines within 78 characters.

/**
 * RFC 5322 2.1.1 and 2.2.3: words after a start, each after one space, a line folded before a
 * non-empty word that would take it past 78 characters. A word that alone passes 78 stays whole.
 */
export function fold(start: string, words: readonly string[]): string[] {
  const lines: string[] = [];
  let line = start;
  for (const word of words) {
    if (word !== "" && line.length + 1 + word.length > 78) {
      lines.push(line);
      line = "";
    }
    line += ` ${word}`;
  }
  lines.push(line);
  return lines;
}
