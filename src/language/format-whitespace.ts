/**
 * How far apart two lines may drift before the walk gives up on realigning.
 *
 * A formatter's changes are local: it wraps a line, joins two, adds a blank
 * one. Fifty lines is far past anything it does in one place, and bounding it
 * keeps this linear on a file of any size — an unbounded search would be the
 * classic quadratic diff, on the save path, on the biggest files.
 */
const RESYNC_WINDOW = 50;

/** A line reduced to what it says, with every space and tab dropped. */
function contentKey(line: string): string {
  return line.replace(/\s+/g, "");
}

function leadingWhitespace(line: string): string {
  return (line.match(/^[ \t]*/) || [""])[0];
}

function trailingWhitespace(line: string): string {
  return (line.match(/[ \t]*$/) || [""])[0];
}

/**
 * One line, formatted, but wearing the whitespace it was typed with.
 *
 * The formatter's version supplies what is between the first and last
 * non-space character — "int c=3;" becoming "int c = 3;" is its business. The
 * indentation and anything after the last character are the author's.
 */
function keepTypedWhitespace(original: string, formatted: string): string {
  const body = formatted.trim();
  // A line the formatter emptied stays exactly as it was typed, which is what
  // keeps an indented blank line between two statements.
  if (!body) return original;
  return `${leadingWhitespace(original)}${body}${trailingWhitespace(original)}`;
}

/**
 * Puts the author's whitespace back into a formatted file.
 *
 * "Format beim Speichern" ran the Eclipse formatter over the file and wrote
 * whatever came back, and that re-indents every line to its own idea of the
 * right depth, strips whatever follows the last character, and empties lines
 * that hold only spaces. Somebody who lines up a block by hand, or leaves an
 * indented blank line to type on next, watched all of it disappear each time
 * they saved — which is the report: "spaces and tabs are deleted on save".
 *
 * So the formatter keeps the part of its work that is about the code — the
 * spacing inside a line, the wrapping, the order of things — and the whitespace
 * around it is taken from the file as it was written. Lines are matched by what
 * they say with all whitespace removed, so a line whose spacing the formatter
 * corrected still matches the line it came from.
 *
 * A line the formatter genuinely removed stays removed, unless it was blank:
 * blank lines are the author's paragraph breaks and it has no business
 * counting them.
 */
export function preserveTypedWhitespace(original: string, formatted: string): string {
  if (!original || !formatted || original === formatted) return formatted;

  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const originalLines = original.split(/\r?\n/);
  const formattedLines = formatted.split(/\r?\n/);
  const originalKeys = originalLines.map(contentKey);
  const formattedKeys = formattedLines.map(contentKey);

  const result: string[] = [];
  let source = 0;
  let target = 0;

  while (source < originalLines.length && target < formattedLines.length) {
    if (originalKeys[source] === formattedKeys[target]) {
      result.push(keepTypedWhitespace(originalLines[source], formattedLines[target]));
      source += 1;
      target += 1;
      continue;
    }

    // The two have come apart. Whichever side has to move the least to line
    // them up again is the side that gained or lost lines.
    let removed = -1;
    let inserted = -1;
    for (let distance = 1; distance <= RESYNC_WINDOW; distance += 1) {
      if (removed < 0 && source + distance < originalLines.length
        && originalKeys[source + distance] === formattedKeys[target]) {
        removed = distance;
      }
      if (inserted < 0 && target + distance < formattedLines.length
        && originalKeys[source] === formattedKeys[target + distance]) {
        inserted = distance;
      }
      if (removed >= 0 || inserted >= 0) break;
    }

    if (removed >= 0 && (inserted < 0 || removed <= inserted)) {
      // The formatter dropped these. Blank ones are put back; anything with
      // content on it was a real change and stays dropped.
      for (let index = source; index < source + removed; index += 1) {
        if (!originalKeys[index]) result.push(originalLines[index]);
      }
      source += removed;
      continue;
    }
    if (inserted >= 0) {
      for (let index = target; index < target + inserted; index += 1) {
        result.push(formattedLines[index]);
      }
      target += inserted;
      continue;
    }

    // Nothing lines up nearby, so this line was rewritten rather than moved.
    // The formatter's version wins, indentation and all.
    result.push(formattedLines[target]);
    source += 1;
    target += 1;
  }

  while (target < formattedLines.length) {
    result.push(formattedLines[target]);
    target += 1;
  }
  // Trailing blank lines the formatter trimmed away are the author's too.
  while (source < originalLines.length) {
    if (!originalKeys[source]) result.push(originalLines[source]);
    source += 1;
  }

  return result.join(newline);
}
