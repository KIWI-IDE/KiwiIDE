/** Token-structure matching, independent of whitespace and comments. Named
 * captures consume balanced expressions; this does not infer semantic types. */
const PLACEHOLDER = /\$\$([A-Za-z_]\w*)\$\$|\$([A-Za-z_]\w*)\$/g;
const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = new Set(Object.values(OPEN));
const STATEMENT_START = new Set(["return", "throw", "yield", "let", "const", "var", "val", "def", "function", "class", "public", "private", "protected", "static", "final", "if", "for", "while", "else", "try", "catch", "import", "package"]);
function tokenize(source, language = "java", pattern = false) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const start = index; const ch = source[index];
    if (/\s/.test(ch)) { index++; continue; }
    if ((language === "python" && ch === "#") || (language !== "python" && source.startsWith("//", index))) {
      index = source.indexOf("\n", index); if (index < 0) break; continue;
    }
    if (language !== "python" && source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2); index = end < 0 ? source.length : end + 2; continue;
    }
    if (pattern && ch === "$") {
      const hole = /^(?:\$\$([A-Za-z_]\w*)\$\$|\$([A-Za-z_]\w*)\$)/.exec(source.slice(index));
      if (hole) { tokens.push({ value: hole[1] || hole[2], kind: "hole", many: Boolean(hole[1]), start, end: index += hole[0].length }); continue; }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = source.startsWith(ch.repeat(3), index) ? ch.repeat(3) : ch;
      index += quote.length;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source.startsWith(quote, index)) { index += quote.length; break; }
        else index++;
      }
      tokens.push({ value: source.slice(start, index), kind: "literal", start, end: index }); continue;
    }
    // JavaScript regex bodies are opaque, just like quoted literals.
    if (language === "javascript" && ch === "/" && (!tokens.length || /^(?:=|\(|\[|,|:|return|=>|!|&&|\|\|)$/.test(tokens.at(-1).value))) {
      index++; let inClass = false;
      while (index < source.length && source[index] !== "\n") {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "/" && !inClass) { index++; while (/[a-z]/i.test(source[index] || "")) index++; break; }
        else { if (source[index] === "[") inClass = true; if (source[index] === "]") inClass = false; index++; }
      }
      tokens.push({ value: source.slice(start, index), kind: "literal", start, end: index }); continue;
    }
    const name = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(source.slice(index));
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[A-Za-z]*/.exec(source.slice(index));
    const operator = /^(?:===|!==|>>>|==|!=|<=|>=|=>|->|::|\?\.|\?\?|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|<<|>>|\*\*|:=)/.exec(source.slice(index));
    const value = name?.[0] || number?.[0] || operator?.[0] || ch;
    index += value.length; tokens.push({ value, kind: name ? "name" : number ? "number" : "punctuation", start, end: index });
    if (tokens.length > 150_000) throw new Error("Die Datei enthält zu viele Code-Tokens für die strukturelle Suche.");
  }
  return tokens;
}
function compilePattern(source, language) {
  if (!String(source).trim() || source.length > 4000) throw new Error("Gib ein Suchmuster mit höchstens 4000 Zeichen ein.");
  const tokens = tokenize(source, language, true);
  if (tokens.length > 128 || tokens.filter(token => token.kind === "hole").length > 8) throw new Error("Das Suchmuster ist zu komplex.");
  if (!tokens.some(token => token.kind === "name" || token.kind === "literal" || token.kind === "number")) throw new Error("Das Muster benötigt mindestens einen festen Namen oder Wert.");
  const stack = [];
  for (const token of tokens) {
    if (OPEN[token.value] && token.kind !== "hole") stack.push(OPEN[token.value]);
    else if (CLOSE.has(token.value) && stack.pop() !== token.value) throw new Error("Die Klammern des Suchmusters sind nicht ausgeglichen.");
  }
  if (stack.length) throw new Error("Die Klammern des Suchmusters sind nicht ausgeglichen.");
  return tokens;
}
function replacementText(template, captures) {
  return String(template).replace(PLACEHOLDER, (_all, many, single) => {
    const name = many || single;
    if (!Object.hasOwn(captures, name)) throw new Error(`Unbekannter Platzhalter: ${name}`);
    return captures[name].text;
  });
}
function findStructuralMatches(source, pattern, replacement, language = "java", limit = 500) {
  const query = Array.isArray(pattern) ? pattern : compilePattern(pattern, language);
  const names = Object.fromEntries(query.filter(token => token.kind === "hole").map(token => [token.value, { text: "" }]));
  replacementText(replacement, names);
  const tokens = tokenize(source, language); const found = []; let budget = 250_000; let truncated = false;
  function match(at, part, captures) {
    if (--budget < 0) { truncated = true; return null; }
    if (part === query.length) return { end: at, captures };
    const token = query[part];
    if (token.kind !== "hole") return tokens[at]?.value === token.value ? match(at + 1, part + 1, captures) : null;
    if (!token.many && STATEMENT_START.has(tokens[at]?.value)) return null;
    const previous = Object.hasOwn(captures, token.value) ? captures[token.value] : null;
    const stack = []; let signature = "";
    for (let end = at; end <= Math.min(tokens.length, at + 2048); end++) {
      if (end > at || token.many) {
        if (!stack.length) {
          const following = query[part + 1];
          if ((!following || following.kind === "hole" || tokens[end]?.value === following.value) && (!previous || previous.signature === signature)) {
            const text = end === at ? "" : source.slice(tokens[at].start, tokens[end - 1].end);
            const result = match(end, part + 1, { ...captures, [token.value]: { text, signature } });
            if (result) return result;
          }
        }
      }
      const next = tokens[end]; if (!next || --budget < 0) { if (budget < 0) truncated = true; break; }
      if (next.value === ";" && !stack.length) break;
      if (!token.many && !stack.length && ["=", "+=", "-=", "*=", "/="].includes(next.value)) break;
      if (next.value === "," && !stack.length && !token.many) break;
      if (OPEN[next.value]) stack.push(OPEN[next.value]);
      else if (CLOSE.has(next.value) && stack.pop() !== next.value) break;
      signature += (end === at ? "" : "\0") + next.value;
    }
    return null;
  }
  for (let at = 0; at < tokens.length && budget > 0; at++) {
    if (query[0].kind !== "hole" && query[0].value !== tokens[at].value) continue;
    const result = match(at, 0, {});
    if (!result || result.end <= at) continue;
    const start = tokens[at].start, end = tokens[result.end - 1].end;
    const before = source.slice(start, end);
    if (before.length > 16_000) { truncated = true; continue; }
    const prefix = source.slice(0, start); const line = prefix.split("\n").length;
    found.push({ start, end, line, column: start - prefix.lastIndexOf("\n"), before, after: replacementText(replacement, result.captures) });
    at = result.end - 1;
    if (found.length >= limit) { truncated = true; break; }
  }
  return { matches: found, truncated: truncated || budget <= 0 };
}
module.exports = { tokenize, compilePattern, findStructuralMatches, replacementText };
