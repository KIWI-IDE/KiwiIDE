/** Logical Python statements: indentation belongs to the first physical line. */
export function pythonLogicalLines(source: string) {
  const statements: Array<{ line: number; code: string; rawLine: string; indent: number; badBackslashes: Array<{ line: number; column: number; length: number }> }> = [];
  const lines = source.split(/\r\n|\r|\n/);
  let quote = "";
  let depth = 0;
  let code = "";
  let start = -1;
  let badBackslashes: Array<{ line: number; column: number; length: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    let clean = "";
    let escapedNewline = false;
    for (let cursor = 0; cursor < raw.length;) {
      const ch = raw[cursor];
      if (quote) {
        if (ch === "\\") {
          escapedNewline = cursor === raw.length - 1;
          clean += " ".repeat(Math.min(2, raw.length - cursor));
          cursor += 2;
        } else if (raw.startsWith(quote, cursor)) {
          clean += " ".repeat(quote.length);
          cursor += quote.length;
          quote = "";
        } else { clean += " "; cursor++; }
        continue;
      }
      if (ch === "#") break;
      if (ch === '"' || ch === "'") {
        quote = raw.startsWith(ch.repeat(3), cursor) ? ch.repeat(3) : ch;
        // A literal is a real statement (including a docstring), not a blank
        // line. Its contents must not influence headers, brackets or keywords.
        clean += "s" + " ".repeat(quote.length - 1);
        cursor += quote.length;
        continue;
      }
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      clean += ch;
      cursor++;
    }
    const invalid = /\\[ \t]+$/.exec(clean);
    if (invalid) badBackslashes.push({ line: index + 1, column: invalid.index + 1, length: invalid[0].length });
    const continuation = !quote && clean.endsWith("\\");
    if (continuation) clean = clean.slice(0, -1);
    if (start < 0 && clean.trim()) start = index;
    code += (code ? "\n" : "") + clean;
    if (quote.length === 1 && !escapedNewline) quote = ""; // Lexer reports the unterminated string.
    if (depth > 0 || quote || continuation) continue;
    if (start >= 0) {
      const rawLine = lines[start];
      let indent = 0;
      for (const ch of rawLine) {
        if (ch === " ") indent++;
        else if (ch === "\t") indent += 8 - indent % 8;
        else if (ch === "\f") indent = 0;
        else break;
      }
      statements.push({ line: start + 1, code, rawLine, indent, badBackslashes });
    }
    code = ""; start = -1; badBackslashes = [];
  }
  // Unclosed brackets/strings are handled by the lexical check; don't invent
  // indentation errors for a statement that is still being typed.
  return statements;
}

export function pythonHeaderColon(code: string) {
  let depth = 0;
  for (let index = 0; index < code.length; index++) {
    if ("([{".includes(code[index])) depth++;
    else if (")]}".includes(code[index])) depth--;
    else if (code[index] === ":" && code[index + 1] !== "=" && depth === 0) return index;
  }
  return -1;
}
