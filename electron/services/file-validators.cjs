const fsp = require("node:fs/promises");
const path = require("node:path");

/**
 * Validation for the files a Java project is configured with.
 *
 * Only Java was ever checked, so a typo in pom.xml or a tab in a YAML file
 * surfaced as a failed build minutes later — or, for the Maven aggregator
 * packaging, as a build that silently produced no output at all. Everything
 * here is deliberately precise: a check that fires on a valid file is worse
 * than no check, so nothing guesses at semantics it cannot see.
 */

/** Turns a character offset into the line/column a diagnostic needs. */
function positionAt(content, offset) {
  const safe = Math.max(0, Math.min(offset, content.length));
  const before = content.slice(0, safe);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function problem(content, offset, message, { length = 1, severity = "error" } = {}) {
  const start = positionAt(content, offset);
  const end = positionAt(content, offset + length);
  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    severity,
    message,
  };
}

/**
 * JSON, using the platform parser so the verdict matches what every tool that
 * reads the file will do, with the position dug out of the error message.
 */
function validateJson(content) {
  if (!content.trim()) return [];
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = String(error?.message || error);
    // Node states the spot two ways and not always both: "at position N" and
    // "(line X column Y)". The explicit line/column is preferred because it
    // needs no recounting; the offset is the fallback, 1:1 the last resort.
    const spot = message.match(/\(line (\d+) column (\d+)\)/);
    const offset = Number(message.match(/at position (\d+)/)?.[1]);
    const readable = message
      .replace(/\s*in JSON at position \d+.*$/s, "")
      .replace(/,\s*"[\s\S]*?"\s*is not valid JSON$/, "")
      .replace(/\s*is not valid JSON$/, "")
      .trim();
    if (spot) {
      return [{
        line: Number(spot[1]),
        column: Number(spot[2]),
        endLine: Number(spot[1]),
        endColumn: Number(spot[2]) + 1,
        severity: "error",
        message: `Ungültiges JSON: ${readable}`,
      }];
    }
    return [problem(content, Number.isFinite(offset) ? offset : 0, `Ungültiges JSON: ${readable}`)];
  }
}

const selfClosing = /\/>$/;

/**
 * Comments, CDATA, declarations and processing instructions blanked out.
 *
 * Length-preserving, so every offset still points at the same character of the
 * file. Every rule reads this rather than the original: a `<modules>` somebody
 * commented out is not a `<modules>`, and reporting it as one is how a file
 * that builds fine ends up covered in errors.
 */
function maskXml(content) {
  return String(content || "")
    .replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\r\n]/g, " "))
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) => match.replace(/[^\r\n]/g, " "))
    .replace(/<\?[\s\S]*?\?>/g, (match) => match.replace(/[^\r\n]/g, " "))
    .replace(/<!DOCTYPE[^>]*>/gi, (match) => match.replace(/[^\r\n]/g, " "));
}

/**
 * XML well-formedness: the mistakes that make a POM unreadable.
 *
 * This is not a schema check — it reports unclosed and crossed tags, stray
 * closing tags and unescaped ampersands, which is what actually breaks a build
 * file people edit by hand.
 */
function validateXml(content) {
  const problems = [];
  const stack = [];
  const tagPattern = /<(\/)?([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g;
  const masked = maskXml(content);

  let match;
  while ((match = tagPattern.exec(masked)) !== null) {
    const [tag, closing, name, , empty] = match;
    if (empty || selfClosing.test(tag)) continue;
    if (closing) {
      const open = stack.pop();
      if (!open) {
        problems.push(problem(content, match.index, `Schließendes </${name}> ohne öffnendes Tag.`, { length: tag.length }));
      } else if (open.name !== name) {
        problems.push(problem(content, match.index,
          `</${name}> schließt <${open.name}> aus Zeile ${positionAt(content, open.index).line}.`,
          { length: tag.length }));
      }
    } else {
      stack.push({ name, index: match.index });
    }
  }
  for (const open of stack) {
    problems.push(problem(content, open.index, `<${open.name}> wird nie geschlossen.`, { length: open.name.length + 2 }));
  }

  for (const hit of masked.matchAll(/&(?!(?:[a-zA-Z][\w.-]*|#\d+|#x[0-9a-fA-F]+);)/g)) {
    problems.push(problem(content, hit.index, "Ungeschütztes „&“ — als &amp; schreiben.", { length: 1 }));
  }
  return problems;
}

const mavenPackagings = new Set(["jar", "war", "ear", "pom", "maven-plugin", "ejb", "rar", "bundle"]);

/**
 * Maven rules on top of well-formedness.
 *
 * The aggregator rule is the one that matters most: a POM that lists modules
 * but is not packaged as "pom" makes Maven refuse the whole reactor, and the
 * message it prints does not say which file to edit.
 */
function validateMavenPom(content) {
  const problems = validateXml(content);
  if (problems.length) return problems;

  // Everything below asks what the POM declares, and a comment declares
  // nothing. The masked copy is the same length, so a position found in it
  // still points at the right place in the file.
  const live = maskXml(content);
  const projectStart = live.search(/<project[\s>]/);
  if (projectStart < 0) return problems;

  const value = (tag) => live.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`))?.[1];
  const offsetOf = (pattern, fallback = projectStart) => {
    const index = live.search(pattern);
    return index < 0 ? fallback : index;
  };

  if (!/<modelVersion>/.test(live)) {
    problems.push(problem(content, projectStart, "<modelVersion> fehlt; Maven erwartet 4.0.0.", { length: 8 }));
  }

  const hasParent = /<parent>/.test(live);
  for (const tag of ["groupId", "artifactId", "version"]) {
    // A child POM inherits groupId and version from its parent.
    if (tag !== "artifactId" && hasParent) continue;
    const before = live.indexOf("<dependencies>");
    const declared = new RegExp(`<${tag}>`).test(live.slice(0, before < 0 ? live.length : before));
    if (!declared && !new RegExp(`<${tag}>`).test(live)) {
      problems.push(problem(content, projectStart, `<${tag}> fehlt in den Projektkoordinaten.`, { length: 8 }));
    }
  }

  const packaging = value("packaging");
  if (packaging && !mavenPackagings.has(packaging)) {
    problems.push(problem(content, offsetOf(/<packaging>/), `Unbekanntes Packaging „${packaging}“.`, { length: 11 }));
  }
  if (/<modules>/.test(live) && (packaging || "jar") !== "pom") {
    problems.push(problem(content, offsetOf(/<packaging>|<modules>/),
      `Ein Projekt mit <modules> muss <packaging>pom</packaging> haben, hier steht „${packaging || "jar"}“.`,
      { length: 11 }));
  }
  for (const hit of live.matchAll(/<version>\s*([^<]*?)\s*<\/version>/g)) {
    if (!/^(?:LATEST|RELEASE)$/i.test(hit[1])) continue;
    problems.push(problem(content, hit.index, `Version „${hit[1]}“ ist nicht reproduzierbar; feste Version angeben.`,
      { length: hit[0].length, severity: "warning" }));
  }
  return problems;
}

/**
 * YAML, limited to the mistakes that are unambiguous without a full parser:
 * tab indentation (which the spec forbids outright), a mapping key without the
 * space after its colon, and a key repeated at the same indentation.
 */
function validateYaml(content) {
  const problems = [];
  const lines = content.split(/\r?\n/);
  const seen = new Map();
  let offset = 0;
  let inBlockScalar = false;
  let blockIndent = 0;

  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (inBlockScalar) {
      if (trimmed && indent <= blockIndent) inBlockScalar = false;
      else {
        offset += line.length + 1;
        continue;
      }
    }

    if (trimmed && !trimmed.startsWith("#")) {
      const tab = line.slice(0, indent).indexOf("\t");
      if (tab >= 0) {
        problems.push(problem(content, offset + tab, "YAML erlaubt keine Tabs zur Einrückung; Leerzeichen verwenden."));
      }

      const key = trimmed.match(/^(-\s*)?([^\s#][^:#]*):(\S)/);
      if (key && !/^https?$/i.test(key[2].trim())) {
        const column = line.indexOf(`:${key[3]}`);
        problems.push(problem(content, offset + column, "Nach dem Doppelpunkt fehlt ein Leerzeichen."));
      }

      const mappingKey = trimmed.match(/^([^\s#-][^:#]*):(?:\s|$)/);
      if (mappingKey) {
        const name = mappingKey[1].trim();
        const scope = `${indent}:${name}`;
        // Only a repeat at the same depth is certainly a duplicate; the same
        // name under a different parent is perfectly normal.
        for (const [key2, at] of [...seen.entries()]) {
          if (Number(key2.split(":")[0]) > indent) seen.delete(key2);
          else void at;
        }
        if (seen.has(scope)) {
          problems.push(problem(content, offset + indent,
            `Schlüssel „${name}“ ist auf dieser Ebene schon in Zeile ${seen.get(scope)} definiert.`,
            { length: name.length, severity: "warning" }));
        } else {
          seen.set(scope, positionAt(content, offset).line);
        }
      }

      if (/[|>][-+]?\s*$/.test(trimmed)) {
        inBlockScalar = true;
        blockIndent = indent;
      }
    }
    offset += line.length + 1;
  }
  return problems;
}

/**
 * Gradle build scripts are Groovy or Kotlin, so only their structure is
 * checked: unbalanced brackets and unterminated strings, which is what leaves
 * the script unparseable.
 */
function validateGradle(content) {
  const problems = [];
  const stack = [];
  const openers = { "{": "}", "(": ")", "[": "]" };
  const closers = { "}": "{", ")": "(", "]": "[" };
  let state = "code";
  let quote = "";
  let openedAt = 0;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "string") {
      // The closing delimiter is as long as the opening one. Comparing a
      // single character against """ never matched, so every triple-quoted
      // block in a Kotlin build script was reported as an unterminated string
      // — and everything after it was read as if it were still inside one,
      // which turned each brace in the rest of the file into a complaint.
      if (content.startsWith(quote, index)) {
        state = "code";
        index += quote.length - 1;
        continue;
      }
      // A backslash escapes inside a plain string; a raw string has no escapes.
      if (quote.length === 1 && character === "\\") index += 1;
      else if (character === "\n" && quote.length === 1) {
        problems.push(problem(content, openedAt, "Zeichenkette wird nicht geschlossen.", { length: Math.max(1, index - openedAt) }));
        state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") { state = "line-comment"; index += 1; continue; }
    if (character === "/" && next === "*") { state = "block-comment"; index += 1; continue; }
    if (character === '"' || character === "'") {
      const triple = content.slice(index, index + 3);
      quote = triple === '"""' || triple === "'''" ? triple : character;
      if (quote.length === 3) index += 2;
      state = "string";
      openedAt = index;
      continue;
    }
    if (openers[character]) { stack.push({ character, index }); continue; }
    if (closers[character]) {
      const open = stack.pop();
      if (!open) {
        problems.push(problem(content, index, `„${character}“ schließt eine Klammer, die nie geöffnet wurde.`));
      } else if (openers[open.character] !== character) {
        problems.push(problem(content, index,
          `„${character}“ passt nicht zu „${open.character}“ aus Zeile ${positionAt(content, open.index).line}.`));
      }
    }
  }
  if (state === "string") {
    problems.push(problem(content, openedAt, "Zeichenkette wird nicht geschlossen."));
  }
  if (state === "block-comment") {
    problems.push(problem(content, openedAt, "Blockkommentar wird nie geschlossen."));
  }
  for (const open of stack) {
    problems.push(problem(content, open.index, `„${open.character}“ wird nie geschlossen.`));
  }
  return problems.sort((left, right) => left.line - right.line || left.column - right.column);
}

/** Picks the validator for a path, or null when the file is not covered. */
function validatorFor(filePath) {
  const name = path.basename(String(filePath || "")).toLowerCase();
  const extension = path.extname(name);
  if (name === "pom.xml") return { source: "Maven", validate: validateMavenPom };
  if (extension === ".xml") return { source: "XML", validate: validateXml };
  if (extension === ".json") return { source: "JSON", validate: validateJson };
  if (extension === ".yaml" || extension === ".yml") return { source: "YAML", validate: validateYaml };
  if (extension === ".gradle" || name.endsWith(".gradle.kts")) return { source: "Gradle", validate: validateGradle };
  return null;
}

/** Validates one file's content; returns [] for anything not covered. */
function validateContent(filePath, content) {
  const validator = validatorFor(filePath);
  if (!validator) return [];
  return validator.validate(String(content || ""))
    .slice(0, 50)
    .map((entry) => ({ ...entry, path: filePath, source: validator.source }));
}

/** Validates every covered file in a list of paths. */
async function validateFiles(files, { limit = 200 } = {}) {
  const results = [];
  for (const file of files) {
    if (!validatorFor(file)) continue;
    let content;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    results.push(...validateContent(file, content));
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

module.exports = {
  validateContent,
  validateFiles,
  validatorFor,
  validateJson,
  validateXml,
  validateMavenPom,
  validateYaml,
  validateGradle,
};
