const fsp = require("node:fs/promises");
const path = require("node:path");

/**
 * Markers the TODO tool window collects, in the order it groups them.
 *
 * Kept in sync with findTaskComments in src/utils.ts, which does the same job
 * for the buffer that is currently open — the tests pin both against one
 * fixture so the tool window and the editor never disagree about a file.
 */
const TASK_MARKERS = ["TODO", "FIXME", "HACK", "XXX", "BUG", "NOTE"];

const markerPattern = new RegExp(`\\b(${TASK_MARKERS.join("|")})\\b\\s*:?\\s*(.*)$`, "i");

/**
 * Finds task markers that really sit in a comment.
 *
 * A plain line search would also report `String s = "TODO";` and every URL
 * containing the word, which is what makes such lists useless.
 */
function findTaskComments(source) {
  const result = [];
  const lines = String(source || "").split(/\r?\n/);
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let comment = "";
    let offset = 0;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      comment = end < 0 ? line : line.slice(0, end);
      if (end >= 0) inBlockComment = false;
    } else {
      // Blank out string literals so a "//" inside one cannot open a comment.
      const stripped = line.replace(/"(?:[^"\\]|\\.)*"/g, (match) => " ".repeat(match.length));
      const lineComment = stripped.indexOf("//");
      const blockComment = stripped.indexOf("/*");
      const hashComment = stripped.search(/(^|\s)#/);
      const starts = [lineComment, blockComment, hashComment].filter((value) => value >= 0);
      if (!starts.length) continue;
      const first = Math.min(...starts);
      if (first === lineComment) {
        offset = lineComment;
        comment = line.slice(lineComment);
      } else if (first === blockComment) {
        offset = blockComment;
        const end = stripped.indexOf("*/", blockComment + 2);
        comment = end < 0 ? line.slice(blockComment) : line.slice(blockComment, end + 2);
        inBlockComment = end < 0;
      } else {
        offset = hashComment;
        comment = line.slice(hashComment);
      }
    }
    if (!comment) continue;
    const hit = comment.match(markerPattern);
    if (!hit) continue;
    result.push({
      line: index + 1,
      column: offset + (hit.index || 0) + 1,
      kind: hit[1].toUpperCase(),
      text: hit[2].trim().replace(/\s*\*\/$/, "").trim(),
    });
  }
  return result;
}

/**
 * Scans a whole project.
 *
 * `collectFiles` already skips build output and dot directories, so the caller
 * only has to say which extensions carry comments worth reading.
 */
async function scanTaskComments(files, { limit = 2000, fileLimit = 4000 } = {}) {
  const results = [];
  for (const file of files.slice(0, fileLimit)) {
    let content;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const comment of findTaskComments(content)) {
      results.push({ ...comment, path: file, name: path.basename(file) });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

module.exports = { TASK_MARKERS, findTaskComments, scanTaskComments };
