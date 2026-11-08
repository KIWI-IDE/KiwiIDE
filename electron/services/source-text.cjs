/**
 * Reading source without being fooled by what is written inside it.
 *
 * Every writer that edits a build file or a Java file has to answer the same
 * question first: is this keyword code, or is it inside a comment or a string?
 * Answered with a plain regular expression it goes wrong in ways nobody sees
 * until a build breaks — an import written into a comment, a dependency added
 * to a `buildscript` block, a `<dependency>` in `<dependencyManagement>` read
 * as one that is actually declared.
 *
 * Everything here blanks rather than cuts: the answer is the same length as
 * what went in, so an index found in it points at the same character of the
 * original and can be used to splice the original text.
 */

/**
 * The same run of text with every character except the line breaks replaced.
 *
 * The Explorer reads the first 64 KB of every Java file it shows to pick its
 * icon, and most of what gets blanked is a short string or a one-line comment
 * with no line break in it at all. Repeating a space is far cheaper than a
 * regular expression, so the common case skips it.
 */
function blank(text) {
  return text.includes("\n") ? text.replace(/[^\n]/g, " ") : " ".repeat(text.length);
}

/**
 * Java, Kotlin and Groovy source with comments and literals blanked out.
 *
 * The three languages share the forms that matter here: `//` to the end of the
 * line, `/* *\/` across lines, single and double quotes with backslash escapes,
 * and the triple-quoted block — Java's text block and Kotlin's raw string are
 * both `"""`, Groovy has `'''` as well.
 */
function maskJavaSource(source, { literals = true } = {}) {
  // Collected in pieces and joined once. Growing a string one character at a
  // time is what made this show up in the Explorer's timings at all.
  const pieces = [];
  let plain = 0;
  let index = 0;
  const flush = (until) => {
    if (until > plain) pieces.push(source.slice(plain, until));
  };
  while (index < source.length) {
    const character = source[index];
    let stop = -1;
    let isLiteral = false;
    if (character === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index);
      stop = end === -1 ? source.length : end;
    } else if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      stop = end === -1 ? source.length : end + 2;
    } else if (source.startsWith('"""', index) || source.startsWith("'''", index)) {
      const fence = source.slice(index, index + 3);
      const end = source.indexOf(fence, index + 3);
      stop = end === -1 ? source.length : end + 3;
      isLiteral = true;
    } else if (character === '"' || character === "'") {
      // An unterminated quote ends at its line. Running to the end of the file
      // would blank every declaration below a single typo.
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") { cursor += 2; continue; }
        if (source[cursor] === character || source[cursor] === "\n") break;
        cursor += 1;
      }
      stop = Math.min(cursor + 1, source.length);
      isLiteral = true;
    }
    if (stop === -1) {
      index += 1;
      continue;
    }
    flush(index);
    // A literal is still read to its end even when it is being kept, or a
    // "//" inside one would start a comment that never existed.
    const run = source.slice(index, stop);
    pieces.push(isLiteral && !literals ? run : blank(run));
    index = stop;
    plain = stop;
  }
  flush(source.length);
  return pieces.join("");
}

/**
 * The same source with only its comments blanked out.
 *
 * For questions whose answer is written inside a string — whether this script
 * already names `project(":web")` — where blanking the literals would take the
 * answer away with the noise.
 */
function maskSourceComments(source) {
  return maskJavaSource(source, { literals: false });
}

/** XML with its comments blanked out. */
function maskXmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, blank);
}

/**
 * Whether a pom is intact enough to be read at all.
 *
 * Not a validating parser — every reader here works with regular expressions
 * and would go on doing so. This catches the case that matters: a file that
 * was truncated or half-written, whose elements never close. Kiwi read one of
 * those, found the goals it always offers, and reported the project ready to
 * build; the first build then failed on a pom Maven refuses to parse.
 */
function xmlLooksIntact(source) {
  const text = maskXmlComments(String(source || ""));
  if (!text.trim()) return false;
  const stack = [];
  // Elements only: declarations, processing instructions and CDATA carry no
  // nesting and would otherwise be counted as opening tags.
  const cleaned = text
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<![^>]*>/g, " ");
  for (const match of cleaned.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  // An unterminated tag at the end never matched above, so the text has to end
  // where the last element did.
  if (/<[^>]*$/.test(cleaned)) return false;
  return stack.length === 0;
}

/**
 * XML with one element and everything inside it blanked out.
 *
 * For looking past a section that contains the same tags as the one being
 * looked for: `<dependencyManagement>` holds `<dependency>` elements that are
 * versions rather than dependencies, and a `<profile>` holds dependencies that
 * only apply when it is switched on.
 */
function maskXmlElement(source, name) {
  return source.replace(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, "g"), blank);
}

/**
 * Where the body of a top-level block begins, or -1.
 *
 * "Top-level" is the whole point: a Gradle script can carry a `dependencies`
 * block inside `buildscript`, inside `subprojects`, inside a `plugins` block's
 * neighbours — and a dependency written into any of those is not a dependency
 * of the project. The index returned is the first character after the brace.
 */
function topLevelBlockBody(source, name) {
  const code = maskJavaSource(source);
  const pattern = new RegExp(`\\b${name}\\s*\\{|[{}]`, "g");
  let depth = 0;
  for (const match of code.matchAll(pattern)) {
    if (match[0] === "{") {
      depth += 1;
      continue;
    }
    if (match[0] === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) return match.index + match[0].length;
    depth += 1;
  }
  return -1;
}

/**
 * Where the brace that closes a block sits, or -1.
 *
 * `bodyStart` is the index just after the opening brace — what
 * `topLevelBlockBody` hands back. Counted on masked source, so a brace inside a
 * string or a comment does not close anything.
 */
function matchingBrace(source, bodyStart) {
  const code = maskJavaSource(source);
  let depth = 1;
  for (let index = bodyStart; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

module.exports = {
  maskJavaSource,
  xmlLooksIntact,
  matchingBrace,
  maskSourceComments,
  maskXmlComments,
  maskXmlElement,
  topLevelBlockBody,
};
