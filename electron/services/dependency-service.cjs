const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  maskSourceComments,
  maskXmlComments,
  maskXmlElement,
  matchingBrace,
  topLevelBlockBody,
} = require("./source-text.cjs");

const SEARCH_HOST = "https://search.maven.org";
const MAVEN_SCOPES = ["compile", "provided", "runtime", "test", "system", "import"];
const GRADLE_CONFIGURATIONS = [
  "implementation",
  "api",
  "compileOnly",
  "runtimeOnly",
  "annotationProcessor",
  "testImplementation",
  "testCompileOnly",
  "testRuntimeOnly",
  "testAnnotationProcessor",
];
/**
 * Said when the build file came back byte for byte as it went in.
 *
 * The caller used to receive nothing but added:false, and the dialog turns a
 * bare no into "the dependency is already there" — which is the one reading
 * that is certainly wrong here, and it hid every genuine failure to write.
 */
const UNCHANGED_REASON = "Die Abhängigkeit konnte nicht in die Builddatei eingetragen werden. Bitte prüfe, ob die Datei einen dependencies-Abschnitt hat.";
const IGNORED_BUILD_DIRECTORIES = new Set([
  ".git", ".gradle", ".idea", ".kiwi", "build", "target", "out", "node_modules",
]);

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function unescapeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What may stand inside a `${…}` in a version.
 *
 * A version is written into a Gradle file inside a double-quoted string, and
 * Groovy evaluates `${…}` when it reads that file. The character set below has
 * to allow placeholders — `${junitVersion}`, `${project.version}` — and those
 * are the only shape that belongs there. Anything else is an expression, and an
 * expression in a build file runs.
 *
 * That matters more since a session can have a guest: somebody with edit rights
 * could add a dependency whose version executes on the host's machine the next
 * time it builds.
 */
function assertVersionPlaceholders(version) {
  for (const match of String(version).matchAll(/\$\{([^}]*)\}/g)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(match[1])) {
      throw new Error("Ungültige Version: Ein Platzhalter darf nur einen Namen enthalten.");
    }
  }
}

function assertCoordinates({ groupId, artifactId, version }) {
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!valid.test(String(groupId || ""))) throw new Error("Ungültige groupId.");
  if (!valid.test(String(artifactId || ""))) throw new Error("Ungültige artifactId.");
  if (!/^[A-Za-z0-9._+${}\[\](),-]+$/.test(String(version || ""))) throw new Error("Ungültige Version.");
  assertVersionPlaceholders(version);
  return { groupId: String(groupId), artifactId: String(artifactId), version: String(version) };
}

function assertVersion(version) {
  const text = String(version || "").trim();
  if (!/^[A-Za-z0-9._+${}\[\](),-]+$/.test(text)) throw new Error("Ungültige Version.");
  assertVersionPlaceholders(text);
  return text;
}

function assertCatalogKey(value, label = "Catalog-Schlüssel") {
  const text = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(text)) throw new Error(`Ungültiger ${label}.`);
  return text;
}

/**
 * Whether two paths name the same file.
 *
 * Windows does not care about case and the parts of Kiwi that produce a path
 * do not agree about it: an editor knows its file by a Monaco URI, and Monaco
 * writes the drive letter in lower case. Compared as text, "c:\projekt" and
 * "C:\projekt" are two different files — so adding a library from the editor
 * was refused as "not a build file of this project", by the very file that was
 * open.
 */
function samePath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function tagValue(source, tag) {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match ? unescapeXml(match[1].trim()) : "";
}

function lineRange(source, start, end) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = source.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = source.length;
  else lineEnd += 1;
  if (source.slice(lineStart, start).trim() || source.slice(end, lineEnd).trim()) {
    return { start, end };
  }
  return { start: lineStart, end: lineEnd };
}

function replaceXmlTag(source, blockStart, blockEnd, tag, value) {
  const block = source.slice(blockStart, blockEnd);
  const pattern = new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(</${tag}>)`, "i");
  if (pattern.test(block)) {
    const updated = block.replace(pattern, `$1${escapeXml(value)}$3`);
    return `${source.slice(0, blockStart)}${updated}${source.slice(blockEnd)}`;
  }
  const closing = block.lastIndexOf("</dependency>");
  if (closing < 0) throw new Error("Der Maven-Abhängigkeitsblock ist beschädigt.");
  const indentMatch = block.match(/(?:^|\n)([ \t]*)<dependency\b/i);
  const indent = `${indentMatch?.[1] || ""}  `;
  const insertion = `${indent}<${tag}>${escapeXml(value)}</${tag}>\n`;
  return `${source.slice(0, blockStart)}${block.slice(0, closing)}${insertion}${block.slice(closing)}${source.slice(blockEnd)}`;
}

function parseMavenProperties(source, file) {
  const block = source.match(/<properties\b[^>]*>([\s\S]*?)<\/properties>/i);
  const properties = new Map();
  if (!block) return properties;
  const contentOffset = (block.index || 0) + block[0].indexOf(block[1]);
  const entry = /<([A-Za-z_][A-Za-z0-9_.-]*)\b[^>]*>\s*([^<]*?)\s*<\/\1>/g;
  let match;
  while ((match = entry.exec(block[1])) !== null) {
    properties.set(match[1], {
      key: match[1],
      value: unescapeXml(match[2].trim()),
      file,
      start: contentOffset + match.index,
      end: contentOffset + match.index + match[0].length,
    });
  }
  return properties;
}

function parseMavenFile(source, file, root) {
  // Scan the pom with its comments blanked out. A commented-out <dependency>
  // is what a pom looks like while somebody is trying a version out, and it
  // used to be listed as a real one — with a remove button that edited inside
  // the comment. Blanking keeps the length, so every index below still points
  // at the same character of the file on disk.
  const live = maskXmlComments(source);
  const properties = parseMavenProperties(live, file);
  const managementRanges = [];
  const managementPattern = /<dependencyManagement\b[^>]*>[\s\S]*?<\/dependencyManagement>/gi;
  let management;
  while ((management = managementPattern.exec(live)) !== null) {
    managementRanges.push({ start: management.index, end: management.index + management[0].length });
  }

  const dependencies = [];
  const pattern = /<dependency\b[^>]*>[\s\S]*?<\/dependency>/gi;
  let match;
  let ordinal = 0;
  while ((match = pattern.exec(live)) !== null) {
    const groupId = tagValue(match[0], "groupId");
    const artifactId = tagValue(match[0], "artifactId");
    if (!groupId || !artifactId) continue;
    const declaredVersion = tagValue(match[0], "version");
    const scope = tagValue(match[0], "scope") || "compile";
    const managed = managementRanges.some((range) => match.index > range.start && match.index < range.end);
    const propertyMatch = declaredVersion.match(/^\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/);
    const property = propertyMatch ? properties.get(propertyMatch[1]) : null;
    const relativeFile = path.relative(root, file).replaceAll("\\", "/") || "pom.xml";
    const range = lineRange(source, match.index, match.index + match[0].length);
    dependencies.push({
      id: `maven:${relativeFile}:${managed ? "managed" : "direct"}:${groupId}:${artifactId}:${scope}:${ordinal++}`,
      ecosystem: "maven",
      groupId,
      artifactId,
      coordinate: `${groupId}:${artifactId}`,
      version: property?.value || declaredVersion,
      declaredVersion,
      editableVersion: propertyMatch ? Boolean(property) : Boolean(declaredVersion),
      versionSource: propertyMatch ? (property ? "property" : "missing") : declaredVersion ? "literal" : "missing",
      versionKey: propertyMatch?.[1],
      scope,
      configuration: scope,
      managed,
      direct: !managed,
      buildFile: file,
      sourceFile: property?.file || file,
      catalogAlias: undefined,
      catalogPath: undefined,
      _blockStart: match.index,
      _blockEnd: match.index + match[0].length,
      _removeStart: range.start,
      _removeEnd: range.end,
    });
  }
  return { file, source, properties, dependencies };
}

function applyMavenManagement(files) {
  const inheritedProperties = new Map();
  for (const file of files) {
    for (const [key, property] of file.properties) {
      if (!inheritedProperties.has(key)) inheritedProperties.set(key, property);
    }
  }
  for (const file of files) {
    for (const entry of file.dependencies.filter((candidate) => candidate.versionKey)) {
      const property = file.properties.get(entry.versionKey) || inheritedProperties.get(entry.versionKey);
      if (!property) continue;
      entry.version = property.value;
      entry.versionSource = "property";
      entry.sourceFile = property.file;
      entry.editableVersion = true;
    }
  }
  const managedEntries = files.flatMap((file) => file.dependencies.filter((entry) => entry.managed));
  const rootManaged = new Map();
  for (const entry of managedEntries) {
    const key = `${entry.groupId}:${entry.artifactId}`;
    // Build files are discovered root-first. The first declaration therefore
    // represents the inherited project-level management source; a module's
    // own management still wins through the local map below.
    if (!rootManaged.has(key)) rootManaged.set(key, entry);
  }
  for (const file of files) {
    const local = new Map(file.dependencies.filter((entry) => entry.managed).map((entry) => [`${entry.groupId}:${entry.artifactId}`, entry]));
    for (const entry of file.dependencies.filter((candidate) => !candidate.managed && !candidate.declaredVersion)) {
      const managed = local.get(entry.coordinate) || rootManaged.get(entry.coordinate);
      if (!managed) continue;
      entry.version = managed.version;
      entry.versionSource = "management";
      entry.versionKey = managed.versionKey;
      entry.sourceFile = managed.sourceFile;
      entry.managedBy = managed.id;
      entry.editableVersion = Boolean(managed.version);
    }
  }
}

function insertMavenDependency(source, coordinates, scope = "compile", options = {}) {
  const { groupId, artifactId, version } = assertCoordinates(coordinates);
  // What the pom really declares: not the managed versions, and not the block
  // somebody commented out while trying something. Reading a comment as a
  // declaration made adding the library do nothing and report it as present.
  // Blanking keeps the length, so every index below still points into `source`.
  const declared = maskXmlElement(maskXmlComments(source), "dependencyManagement");
  const dependencyPattern = /<dependency\b[^>]*>[\s\S]*?<\/dependency>/gi;
  let dependencyMatch;
  while ((dependencyMatch = dependencyPattern.exec(declared)) !== null) {
    if (tagValue(dependencyMatch[0], "groupId") === groupId
      && tagValue(dependencyMatch[0], "artifactId") === artifactId) return source;
  }

  const scopeLine = scope && scope !== "compile" ? `\n      <scope>${escapeXml(scope)}</scope>` : "";
  const versionLine = options.omitVersion ? "" : `\n      <version>${escapeXml(version)}</version>`;
  const block = [
    "    <dependency>",
    `      <groupId>${escapeXml(groupId)}</groupId>`,
    `      <artifactId>${escapeXml(artifactId)}</artifactId>${versionLine}${scopeLine}`,
    "    </dependency>",
  ].join("\n");

  // A pom generated with nothing in it writes <dependencies/>, which has no
  // closing tag to insert before. Adding a second <dependencies> section
  // instead is not a pom Maven will read.
  const selfClosing = declared.match(/([ \t]*)<dependencies\s*\/>/);
  if (selfClosing) {
    const indent = selfClosing[1] || "  ";
    return `${source.slice(0, selfClosing.index)}${indent}<dependencies>\n${block}\n${indent}</dependencies>`
      + source.slice(selfClosing.index + selfClosing[0].length);
  }
  const pattern = /([ \t]*)<\/dependencies>/g;
  let match;
  while ((match = pattern.exec(declared)) !== null) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    // The closing tag on a line of its own: put the element above that line and
    // it keeps its own indentation. Sharing the line with <dependencies> — an
    // empty section written on one line — it needs a line break first, or the
    // element ends up glued to the opening tag.
    if (source.slice(lineStart, match.index).trim()) {
      return `${source.slice(0, match.index)}\n${block}\n${match[1] || "  "}${source.slice(match.index)}`;
    }
    return `${source.slice(0, lineStart)}${block}\n${source.slice(lineStart)}`;
  }
  return source.replace(/([ \t]*)<\/project>\s*$/i, `  <dependencies>\n${block}\n  </dependencies>\n</project>\n`);
}

function insertGradleDependency(source, coordinates, configuration = "implementation", kotlin = false, notation = "") {
  const checked = assertCoordinates(coordinates);
  const dependencyNotation = notation || `${checked.groupId}:${checked.artifactId}:${checked.version}`;
  // Comments blanked, quotes kept: the coordinate being looked for lives
  // inside a string. A library somebody had commented out counted as declared,
  // so adding it back did nothing at all and said it was already there.
  const declared = maskSourceComments(source);
  if (notation) {
    if (new RegExp(`\\b${escapeRegex(notation)}\\b`).test(declared)) return source;
  } else if (new RegExp(`["']${escapeRegex(checked.groupId)}:${escapeRegex(checked.artifactId)}:`).test(declared)) {
    return source;
  }

  const value = notation ? (notation.startsWith("libs.") ? notation : `libs.${notation}`) : `"${dependencyNotation}"`;
  const line = kotlin ? `    ${configuration}(${value})` : `    ${configuration} ${value}`;
  const opened = `${source.replace(/\s*$/, "")}\n\ndependencies {\n${line}\n}\n`;

  // The project's own block, not the first one in the file. A script that
  // configures its own plugins opens with `buildscript { dependencies { } }`,
  // and a library written in there is on the build's classpath rather than the
  // project's — Gradle stops at an `implementation` it does not know.
  const body = topLevelBlockBody(source, "dependencies");
  if (body < 0) return opened;
  const close = matchingBrace(source, body);
  if (close < 0) return opened;

  // `dependencies {}` is what a generated build file looks like, and the
  // insert used to go to the start of the line holding the closing brace —
  // which for an empty block is the line the whole block is on, so the new
  // entry landed above `dependencies {}` instead of inside it.
  if (!source.slice(body, close).trim()) {
    return `${source.slice(0, body)}\n${line}\n${source.slice(close)}`;
  }
  const lineStart = source.lastIndexOf("\n", close) + 1;
  if (source.slice(lineStart, close).trim()) {
    // The closing brace shares its line with a dependency. Give the new one a
    // line of its own rather than appending to that one.
    return `${source.slice(0, close).replace(/[ \t]+$/, "")}\n${line}\n${source.slice(close)}`;
  }
  return `${source.slice(0, lineStart)}${line}\n${source.slice(lineStart)}`;
}

function tomlSectionRange(source, section) {
  const pattern = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/gm;
  let match;
  let current = null;
  while ((match = pattern.exec(source)) !== null) {
    if (current && current.name === section) return { ...current, end: match.index };
    current = { name: match[1].trim(), start: match.index, contentStart: pattern.lastIndex, end: source.length };
  }
  return current?.name === section ? current : null;
}

function parseTomlAssignments(source, section) {
  const range = tomlSectionRange(source, section);
  if (!range) return [];
  const body = source.slice(range.contentStart, range.end);
  const pattern = /^\s*("[^"]+"|[A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/gm;
  const result = [];
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const key = match[1].replace(/^"|"$/g, "");
    const value = match[2].trim();
    const start = range.contentStart + match.index;
    result.push({ key, value, start, end: start + match[0].length, line: match[0] });
  }
  return result;
}

function tomlString(value) {
  const match = String(value || "").match(/^['"]([\s\S]*)['"]$/);
  return match ? match[1] : "";
}

function tomlVersion(value) {
  const direct = tomlString(value);
  if (direct) return direct;
  const rich = String(value || "").match(/(?:strictly|require|prefer)\s*=\s*["']([^"']+)["']/);
  return rich?.[1] || "";
}

function parseVersionCatalog(source, file) {
  const versions = parseTomlAssignments(source, "versions").map((entry) => ({
    key: entry.key,
    version: tomlVersion(entry.value),
    editable: Boolean(tomlVersion(entry.value)),
    _start: entry.start,
    _end: entry.end,
  }));
  const versionMap = new Map(versions.map((entry) => [entry.key, entry.version]));
  const libraries = parseTomlAssignments(source, "libraries").map((entry) => {
    const compact = tomlString(entry.value);
    if (compact) {
      const [groupId = "", artifactId = "", version = ""] = compact.split(":");
      return { alias: entry.key, groupId, artifactId, version, declaredVersion: version, _start: entry.start, _end: entry.end };
    }
    const fields = new Map();
    const fieldPattern = /([A-Za-z][A-Za-z0-9_.-]*)\s*=\s*["']([^"']*)["']/g;
    let field;
    while ((field = fieldPattern.exec(entry.value)) !== null) fields.set(field[1], field[2]);
    const moduleParts = String(fields.get("module") || "").split(":");
    const groupId = fields.get("group") || moduleParts[0] || "";
    const artifactId = fields.get("name") || moduleParts[1] || "";
    const versionKey = fields.get("version.ref") || "";
    const richVersion = entry.value.match(/version\s*=\s*\{[^}]*?(?:strictly|require|prefer)\s*=\s*["']([^"']+)["'][^}]*}/)?.[1] || "";
    const declaredVersion = fields.get("version") || richVersion;
    return {
      alias: entry.key,
      groupId,
      artifactId,
      version: versionKey ? versionMap.get(versionKey) || "" : declaredVersion,
      declaredVersion,
      versionKey: versionKey || undefined,
      _start: entry.start,
      _end: entry.end,
    };
  }).filter((entry) => entry.groupId && entry.artifactId);
  const fileName = path.basename(file, ".toml");
  const name = fileName.endsWith(".versions") ? fileName.slice(0, -".versions".length) : fileName;
  return { name, path: file, source, versions, libraries };
}

function catalogAccessor(alias) {
  return String(alias).replace(/[-_]+/g, ".");
}

function normalizedAlias(alias) {
  return String(alias).replace(/[-_.]+/g, "").toLowerCase();
}

/**
 * Blanks out block comments so their contents are not read as declarations.
 *
 * A dependency somebody commented out was listed as if it were active, and the
 * editor would then have rewritten lines inside a comment when asked to change
 * its version. Line comments already fall out on their own, because every
 * pattern here needs a line to begin with an identifier.
 *
 * The bodies are replaced with spaces rather than removed: every offset this
 * file records points into the real source, and shortening it would move each
 * one of them somewhere else.
 */
function maskBlockComments(source) {
  return String(source || "").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function parseGradleFile(source, file, root, catalogs) {
  const dependencies = [];
  // Read from a copy with the comments blanked out, while every offset
  // recorded below still refers to the file as it is on disk.
  const scannable = maskBlockComments(source);
  const relativeFile = path.relative(root, file).replaceAll("\\", "/");
  let ordinal = 0;
  const literal = /(^|\n)([ \t]*)([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*(?:\([ \t]*)?["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^"'\r\n)]+)["'][ \t]*\)?/g;
  let match;
  while ((match = literal.exec(scannable)) !== null) {
    const version = match[6].trim();
    if (!version || /\s/.test(version)) continue;
    const range = lineRange(source, match.index + match[1].length, match.index + match[0].length);
    const versionOffset = match[0].lastIndexOf(match[6]) + (match.index || 0);
    dependencies.push({
      id: `gradle:${relativeFile}:direct:${match[4]}:${match[5]}:${match[3]}:${ordinal++}`,
      ecosystem: "gradle",
      groupId: match[4], artifactId: match[5], coordinate: `${match[4]}:${match[5]}`,
      version, declaredVersion: version, editableVersion: true, versionSource: "literal",
      scope: match[3], configuration: match[3], managed: false, direct: true,
      buildFile: file, sourceFile: file,
      _versionStart: versionOffset, _versionEnd: versionOffset + match[6].length,
      _removeStart: range.start, _removeEnd: range.end,
    });
  }

  // Gradle's other way of writing the same thing:
  //
  //   implementation group: 'org.x', name: 'lib', version: '1.0'
  //
  // Missing it meant the editor showed fewer dependencies than the project has,
  // with nothing saying so — the reader had to know to distrust the list. Only
  // this order is read, which is the order Gradle's own documentation uses;
  // anything else still falls through, and silently, which is worth knowing.
  const mapNotation = /(^|\n)([ \t]*)([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*\(?[ \t]*group[ \t]*:[ \t]*["']([A-Za-z0-9_.-]+)["'][ \t]*,[ \t]*name[ \t]*:[ \t]*["']([A-Za-z0-9_.-]+)["'][ \t]*,[ \t]*version[ \t]*:[ \t]*["']([^"'\r\n]+)["']/g;
  while ((match = mapNotation.exec(scannable)) !== null) {
    const version = match[6].trim();
    if (!version || /\s/.test(version)) continue;
    const range = lineRange(source, match.index + match[1].length, match.index + match[0].length);
    const versionOffset = match.index + match[0].lastIndexOf(match[6]);
    dependencies.push({
      id: `gradle:${relativeFile}:direct:${match[4]}:${match[5]}:${match[3]}:${ordinal++}`,
      ecosystem: "gradle",
      groupId: match[4], artifactId: match[5], coordinate: `${match[4]}:${match[5]}`,
      version, declaredVersion: version, editableVersion: true, versionSource: "literal",
      scope: match[3], configuration: match[3], managed: false, direct: true,
      buildFile: file, sourceFile: file,
      _versionStart: versionOffset, _versionEnd: versionOffset + match[6].length,
      _removeStart: range.start, _removeEnd: range.end,
    });
  }

  const catalogByAlias = new Map();
  for (const catalog of catalogs) {
    for (const library of catalog.libraries) {
      catalogByAlias.set(`${catalog.name.toLowerCase()}:${normalizedAlias(library.alias)}`, { catalog, library });
    }
  }
  const reference = /(^|\n)([ \t]*)([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*(?:\([ \t]*)?(?:platform\([ \t]*)?([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_.-]+)[ \t]*\)?[ \t]*\)?/g;
  while ((match = reference.exec(scannable)) !== null) {
    const found = catalogByAlias.get(`${match[4].toLowerCase()}:${normalizedAlias(match[5])}`);
    if (!found) continue;
    const { catalog, library } = found;
    const range = lineRange(source, match.index + match[1].length, match.index + match[0].length);
    dependencies.push({
      id: `gradle:${relativeFile}:catalog:${library.alias}:${match[3]}:${ordinal++}`,
      ecosystem: "gradle",
      groupId: library.groupId, artifactId: library.artifactId,
      coordinate: `${library.groupId}:${library.artifactId}`,
      version: library.version, declaredVersion: library.declaredVersion,
      editableVersion: Boolean(library.version || library.versionKey),
      versionSource: "catalog", versionKey: library.versionKey,
      scope: match[3], configuration: match[3], managed: true, direct: true,
      buildFile: file, sourceFile: catalog.path,
      catalogAlias: library.alias, catalogName: catalog.name, catalogPath: catalog.path,
      _removeStart: range.start, _removeEnd: range.end,
    });
  }
  return { file, source, dependencies };
}

function insertTomlAssignment(source, section, key, value) {
  const existing = parseTomlAssignments(source, section).find((entry) => entry.key === key);
  if (existing) return source;
  const range = tomlSectionRange(source, section);
  const line = `${key} = ${value}\n`;
  if (!range) return `${source.replace(/\s*$/, "")}\n\n[${section}]\n${line}`;
  const prefix = source.slice(0, range.end).replace(/\s*$/, "");
  return `${prefix}\n${line}${source.slice(range.end)}`;
}

function publicDependency(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_")));
}

async function discoverBuildFiles(root, names) {
  const result = [];
  async function visit(directory) {
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_BUILD_DIRECTORIES.has(entry.name)) await visit(target);
      } else if (typeof names === "function" ? names(entry.name) : names.has(entry.name)) result.push(target);
    }
  }
  await visit(root);
  return result.sort((left, right) => {
    const leftDepth = path.relative(root, left).split(path.sep).length;
    const rightDepth = path.relative(root, right).split(path.sep).length;
    return leftDepth - rightDepth || left.localeCompare(right);
  });
}

/**
 * Turns what somebody typed into a query Maven Central understands.
 *
 * The text went into Solr's `q` untouched, and Solr reads it as query syntax.
 * A colon is the field separator there, so the most natural thing a Java
 * developer can type — `com.google.guava:guava` — asked Solr for a field
 * called "com.google.guava", which exists nowhere, and the search came back
 * empty. A stray bracket or a `+` from a version answered 400 instead.
 *
 * So a coordinate is recognised and asked for by field, and anything else is
 * quoted term by term. Quoting is what makes a colon, a bracket or a plus sign
 * ordinary text again rather than syntax.
 */
function mavenSearchQuery(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  // A quoted Solr term ends at the first unescaped quote or backslash.
  const quote = (value) => `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
  const coordinate = trimmed.match(/^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)(?::([A-Za-z0-9._+-]+))?$/);
  if (coordinate) {
    const parts = [`g:${quote(coordinate[1])}`, `a:${quote(coordinate[2])}`];
    if (coordinate[3]) parts.push(`v:${quote(coordinate[3])}`);
    return parts.join(" AND ");
  }
  // A single group id, typed while reaching for a coordinate.
  if (/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){2,}$/.test(trimmed)) return `g:${quote(trimmed)}`;
  return trimmed.split(/\s+/).filter(Boolean).map(quote).join(" AND ");
}

function selectDependency(dependencies, selector = {}) {
  const entry = selector.id
    ? dependencies.find((candidate) => candidate.id === selector.id)
    : dependencies.filter((candidate) => (
      candidate.groupId === String(selector.groupId || "")
      && candidate.artifactId === String(selector.artifactId || "")
      && (selector.buildFile ? path.resolve(candidate.buildFile) === path.resolve(selector.buildFile) : true)
      && (selector.configuration ? candidate.configuration === selector.configuration : true)
      && (typeof selector.managed === "boolean" ? candidate.managed === selector.managed : true)
      && (selector.catalogAlias ? candidate.catalogAlias === selector.catalogAlias : true)
    )).sort((left, right) => Number(left.managed) - Number(right.managed))[0];
  if (!entry) throw new Error("Die Abhängigkeit wurde nicht mehr gefunden. Bitte synchronisieren Sie das Projekt.");
  return entry;
}

class DependencyService {
  constructor(pathGuard, projects, fetchImpl = globalThis.fetch) {
    this.pathGuard = pathGuard;
    this.projects = projects;
    this.fetchImpl = fetchImpl;
    this.mutations = new Map();
  }

  async search(query, limit = 25) {
    const text = mavenSearchQuery(query);
    if (!text) return [];
    const url = new URL("/solrsearch/select", SEARCH_HOST);
    url.searchParams.set("q", text);
    // The default core lists one row per artifact and answers with its latest
    // version. A query that names a version has to ask the core that holds
    // every version, or it matches nothing.
    if (text.includes("v:")) url.searchParams.set("core", "gav");
    url.searchParams.set("rows", String(Math.min(50, Math.max(1, Number(limit) || 25))));
    url.searchParams.set("wt", "json");
    let response;
    try {
      response = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new Error(`Maven Central ist nicht erreichbar: ${error?.message || error}`);
    }
    if (!response.ok) throw new Error(`Maven Central antwortete mit ${response.status}.`);
    const payload = await response.json();
    return (payload?.response?.docs || [])
      .map((entry) => ({
        groupId: String(entry.g || ""), artifactId: String(entry.a || ""),
        version: String(entry.latestVersion || entry.v || ""), packaging: String(entry.p || "jar"),
        updatedAt: Number(entry.timestamp) || 0,
      }))
      .filter((entry) => entry.groupId && entry.artifactId && entry.version);
  }

  async versions(groupId, artifactId, limit = 40) {
    const coordinates = assertCoordinates({ groupId, artifactId, version: "1" });
    const url = new URL("/solrsearch/select", SEARCH_HOST);
    url.searchParams.set("q", `g:"${coordinates.groupId}" AND a:"${coordinates.artifactId}"`);
    url.searchParams.set("core", "gav");
    url.searchParams.set("rows", String(Math.min(100, Math.max(1, Number(limit) || 40))));
    url.searchParams.set("wt", "json");
    let response;
    try { response = await this.fetchImpl(url, { headers: { accept: "application/json" } }); }
    catch (error) { throw new Error(`Maven Central ist nicht erreichbar: ${error?.message || error}`); }
    if (!response.ok) throw new Error(`Maven Central antwortete mit ${response.status}.`);
    const payload = await response.json();
    return [...new Set((payload?.response?.docs || []).map((entry) => String(entry.v || "")).filter(Boolean))];
  }

  async collect(root) {
    root = this.pathGuard.assertWorkspace(root);
    const project = await this.projects.detect(root);
    if (project.type === "Maven") {
      const files = [];
      for (const file of await discoverBuildFiles(root, new Set(["pom.xml"]))) {
        this.pathGuard.assertAllowed(file, root);
        files.push(parseMavenFile(await fsp.readFile(file, "utf8"), file, root));
      }
      applyMavenManagement(files);
      return { root, type: "Maven", files, catalogs: [], dependencies: files.flatMap((file) => file.dependencies) };
    }
    if (project.type === "Gradle") {
      const catalogFiles = await discoverBuildFiles(root, (name) => name.endsWith(".versions.toml"));
      const catalogs = [];
      for (const file of catalogFiles) {
        this.pathGuard.assertAllowed(file, root);
        catalogs.push(parseVersionCatalog(await fsp.readFile(file, "utf8"), file));
      }
      const files = [];
      for (const file of await discoverBuildFiles(root, new Set(["build.gradle", "build.gradle.kts"]))) {
        this.pathGuard.assertAllowed(file, root);
        files.push(parseGradleFile(await fsp.readFile(file, "utf8"), file, root, catalogs));
      }
      return { root, type: "Gradle", files, catalogs, dependencies: files.flatMap((file) => file.dependencies) };
    }
    throw new Error("Der Dependency-Editor unterstützt Maven- und Gradle-Projekte.");
  }

  async list(root) {
    const model = await this.collect(root);
    return {
      type: model.type,
      buildFiles: model.files.map((entry) => entry.file),
      dependencies: model.dependencies.map(publicDependency),
      catalogs: model.catalogs.map((catalog) => ({
        name: catalog.name,
        path: catalog.path,
        versions: catalog.versions.map(({ key, version, editable }) => ({ key, version, editable })),
        libraries: catalog.libraries.map(({ alias, groupId, artifactId, version, declaredVersion, versionKey }) => ({
          alias, groupId, artifactId, version, declaredVersion, versionKey,
        })),
      })),
    };
  }

  withMutation(root, operation) {
    const key = path.resolve(root);
    const previous = this.mutations.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.mutations.set(key, next);
    return next.finally(() => {
      if (this.mutations.get(key) === next) this.mutations.delete(key);
    });
  }

  async writeChecked(file, original, updated) {
    if (updated === original) return false;
    const current = await fsp.readFile(file, "utf8");
    if (current !== original) throw new Error("Die Builddatei wurde zwischenzeitlich geändert. Bitte synchronisieren und erneut versuchen.");
    await fsp.writeFile(file, updated, "utf8");
    return true;
  }

  /**
   * The build file a library is to be written into.
   *
   * Both halves used to refuse rather than answer, and a refusal here reads
   * from outside exactly like "adding a dependency does nothing":
   *
   * The root was matched with string equality while every other comparison in
   * this file goes through samePath. One project opened by a path that differs
   * only in case — which Windows hands out freely — and no build file was
   * found in a project root that plainly had one.
   *
   * And a file that was asked for by name had to appear in the model, which is
   * a scan taken a moment earlier. A module created since, or one below a
   * directory the scan skips, was rejected as "not a build file of this
   * project" while sitting open in the editor. If it is really there and it is
   * really a build file, it is the answer.
   */
  async targetBuildFile(root, model, requested) {
    const accepted = model.type === "Maven" ? ["pom.xml"] : ["build.gradle.kts", "build.gradle"];
    if (!requested) {
      const found = model.files.find((entry) =>
        samePath(path.dirname(entry.file), root) && accepted.includes(path.basename(entry.file).toLowerCase()));
      if (!found) throw new Error("Im Projektstamm wurde keine Builddatei gefunden.");
      return found;
    }
    const file = this.pathGuard.assertAllowed(requested, root);
    const found = model.files.find((entry) => samePath(entry.file, file));
    if (found) return found;
    if (!accepted.includes(path.basename(file).toLowerCase())) {
      throw new Error(`Eine Abhängigkeit lässt sich nur in ${accepted.join(" oder ")} eintragen.`);
    }
    let source;
    try { source = await fsp.readFile(file, "utf8"); }
    catch { throw new Error("Die gewählte Builddatei wurde nicht gefunden."); }
    return model.type === "Maven"
      ? parseMavenFile(source, file, root)
      : parseGradleFile(source, file, root, model.catalogs);
  }

  async add(root, coordinates, scope = "", options = {}) {
    root = this.pathGuard.assertWorkspace(root);
    const checked = assertCoordinates(coordinates);
    return this.withMutation(root, async () => {
      const model = await this.collect(root);
      const target = await this.targetBuildFile(root, model, options.buildFile);
      if (model.dependencies.some((entry) => !entry.managed && entry.buildFile === target.file && entry.coordinate === `${checked.groupId}:${checked.artifactId}`)) {
        return { file: target.file, files: [], added: false, changed: false, reason: "Die Abhängigkeit ist bereits eingetragen." };
      }
      if (model.type === "Maven") {
        const managed = model.dependencies.find((entry) => entry.managed && entry.coordinate === `${checked.groupId}:${checked.artifactId}`);
        const updated = insertMavenDependency(target.source, checked, MAVEN_SCOPES.includes(scope) ? scope : "compile", { omitVersion: Boolean(managed) });
        const changed = await this.writeChecked(target.file, target.source, updated);
        return { file: target.file, files: changed ? [target.file] : [], added: changed, changed, managed: Boolean(managed), ...(changed ? {} : { reason: UNCHANGED_REASON }) };
      }

      const configuration = GRADLE_CONFIGURATIONS.includes(scope) ? scope : "implementation";
      if (!options.useVersionCatalog) {
        const updated = insertGradleDependency(target.source, checked, configuration, target.file.endsWith(".kts"));
        const changed = await this.writeChecked(target.file, target.source, updated);
        return { file: target.file, files: changed ? [target.file] : [], added: changed, changed, ...(changed ? {} : { reason: UNCHANGED_REASON }) };
      }

      const alias = assertCatalogKey(options.alias || checked.artifactId, "Catalog-Alias");
      const versionKey = assertCatalogKey(options.versionKey || `${alias}-version`, "Versionsschlüssel");
      const catalog = options.catalogPath
        ? model.catalogs.find((entry) => path.resolve(entry.path) === this.pathGuard.assertAllowed(options.catalogPath, root))
        : model.catalogs[0];
      if (!catalog) throw new Error("Es wurde kein Gradle-Version-Catalog (libs.versions.toml) gefunden.");
      if (catalog.libraries.some((entry) => entry.alias === alias)) throw new Error(`Der Catalog-Alias '${alias}' ist bereits vergeben.`);
      let catalogUpdated = insertTomlAssignment(catalog.source, "versions", versionKey, `"${checked.version}"`);
      catalogUpdated = insertTomlAssignment(catalogUpdated, "libraries", alias, `{ module = "${checked.groupId}:${checked.artifactId}", version.ref = "${versionKey}" }`);
      const notation = `${catalog.name}.${catalogAccessor(alias)}`;
      const buildUpdated = insertGradleDependency(target.source, checked, configuration, target.file.endsWith(".kts"), notation);
      const catalogCurrent = await fsp.readFile(catalog.path, "utf8");
      const buildCurrent = await fsp.readFile(target.file, "utf8");
      if (catalogCurrent !== catalog.source || buildCurrent !== target.source) throw new Error("Eine Builddatei wurde zwischenzeitlich geändert. Bitte synchronisieren und erneut versuchen.");
      await fsp.writeFile(catalog.path, catalogUpdated, "utf8");
      try { await fsp.writeFile(target.file, buildUpdated, "utf8"); }
      catch (error) {
        await fsp.writeFile(catalog.path, catalog.source, "utf8").catch(() => undefined);
        throw error;
      }
      return { file: target.file, files: [catalog.path, target.file], added: true, changed: true, catalogAlias: alias, versionKey };
    });
  }

  async remove(root, selector) {
    root = this.pathGuard.assertWorkspace(root);
    return this.withMutation(root, async () => {
      const model = await this.collect(root);
      const entry = selectDependency(model.dependencies, selector);
      const fileData = model.files.find((candidate) => candidate.file === entry.buildFile);
      if (!fileData) throw new Error("Die Builddatei der Abhängigkeit wurde nicht gefunden.");
      const updated = `${fileData.source.slice(0, entry._removeStart)}${fileData.source.slice(entry._removeEnd)}`;
      if (updated === fileData.source) return { file: fileData.file, files: [], removed: false, changed: false };

      if (selector?.removeCatalogEntry && entry.catalogAlias && entry.catalogPath) {
        const catalog = model.catalogs.find((candidate) => candidate.path === entry.catalogPath);
        const library = catalog?.libraries.find((candidate) => candidate.alias === entry.catalogAlias);
        if (catalog && library) {
          const [buildCurrent, catalogCurrent] = await Promise.all([
            fsp.readFile(fileData.file, "utf8"),
            fsp.readFile(catalog.path, "utf8"),
          ]);
          if (buildCurrent !== fileData.source || catalogCurrent !== catalog.source) {
            throw new Error("Eine Builddatei wurde zwischenzeitlich geändert. Bitte synchronisieren und erneut versuchen.");
          }
          const catalogUpdated = `${catalog.source.slice(0, library._start)}${catalog.source.slice(library._end)}`;
          await fsp.writeFile(fileData.file, updated, "utf8");
          try { await fsp.writeFile(catalog.path, catalogUpdated, "utf8"); }
          catch (error) {
            await fsp.writeFile(fileData.file, fileData.source, "utf8").catch(() => undefined);
            throw error;
          }
          return { file: fileData.file, files: [fileData.file, catalog.path], removed: true, changed: true };
        }
      }
      const changed = await this.writeChecked(fileData.file, fileData.source, updated);
      const files = changed ? [fileData.file] : [];
      return { file: fileData.file, files, removed: changed, changed };
    });
  }

  async update(root, selector, version) {
    root = this.pathGuard.assertWorkspace(root);
    const checkedVersion = assertVersion(version);
    return this.withMutation(root, async () => {
      const model = await this.collect(root);
      let entry = selectDependency(model.dependencies, selector);

      if (entry.versionSource === "management" && entry.managedBy) {
        entry = selectDependency(model.dependencies, { id: entry.managedBy });
      }
      if (entry.ecosystem === "maven") {
        if (entry.versionSource === "property" && entry.versionKey) {
          const sourceData = model.files.find((candidate) => candidate.file === entry.sourceFile);
          const property = sourceData?.properties.get(entry.versionKey);
          if (!sourceData || !property) throw new Error(`Die Maven-Property '${entry.versionKey}' wurde nicht gefunden.`);
          const originalBlock = sourceData.source.slice(property.start, property.end);
          const updatedBlock = originalBlock.replace(/(>\s*)[^<]*(\s*<\/)/, `$1${escapeXml(checkedVersion)}$2`);
          const updated = `${sourceData.source.slice(0, property.start)}${updatedBlock}${sourceData.source.slice(property.end)}`;
          const changed = await this.writeChecked(sourceData.file, sourceData.source, updated);
          return { file: sourceData.file, files: changed ? [sourceData.file] : [], updated: changed, changed, versionKey: entry.versionKey };
        }
        const sourceData = model.files.find((candidate) => candidate.file === entry.buildFile);
        if (!sourceData) throw new Error("Die Maven-Builddatei wurde nicht gefunden.");
        const updated = replaceXmlTag(sourceData.source, entry._blockStart, entry._blockEnd, "version", checkedVersion);
        const changed = await this.writeChecked(sourceData.file, sourceData.source, updated);
        return { file: sourceData.file, files: changed ? [sourceData.file] : [], updated: changed, changed };
      }

      if (entry.versionSource === "catalog" && entry.catalogPath) {
        return this.updateCatalogInternal(root, model, entry.catalogPath, entry.versionKey || entry.catalogAlias, checkedVersion, entry.catalogAlias);
      }
      const sourceData = model.files.find((candidate) => candidate.file === entry.buildFile);
      if (!sourceData || !Number.isInteger(entry._versionStart)) throw new Error("Die Gradle-Version kann nicht sicher bearbeitet werden.");
      const updated = `${sourceData.source.slice(0, entry._versionStart)}${checkedVersion}${sourceData.source.slice(entry._versionEnd)}`;
      const changed = await this.writeChecked(sourceData.file, sourceData.source, updated);
      return { file: sourceData.file, files: changed ? [sourceData.file] : [], updated: changed, changed };
    });
  }

  async updateCatalogInternal(root, model, catalogPath, key, version, alias = "") {
    const safePath = this.pathGuard.assertAllowed(catalogPath, root);
    const catalog = model.catalogs.find((candidate) => path.resolve(candidate.path) === safePath);
    if (!catalog) throw new Error("Der Version-Catalog gehört nicht zu diesem Projekt.");
    let assignment = catalog.versions.find((entry) => entry.key === key);
    if (assignment) {
      const line = catalog.source.slice(assignment._start, assignment._end);
      const updatedLine = /(?:strictly|require|prefer)\s*=/.test(line)
        ? line.replace(/((?:strictly|require|prefer)\s*=\s*["'])[^"']*(["'])/, `$1${version}$2`)
        : line.replace(/(=\s*["'])[^"']*(["'])/, `$1${version}$2`);
      const updated = `${catalog.source.slice(0, assignment._start)}${updatedLine}${catalog.source.slice(assignment._end)}`;
      const changed = await this.writeChecked(catalog.path, catalog.source, updated);
      return { file: catalog.path, files: changed ? [catalog.path] : [], updated: changed, changed, versionKey: key };
    }
    const library = catalog.libraries.find((entry) => entry.alias === (alias || key));
    if (!library) throw new Error(`Der Catalog-Eintrag '${key}' wurde nicht gefunden.`);
    const line = catalog.source.slice(library._start, library._end);
    let updatedLine;
    if (/^\s*[^=]+\s*=\s*["']/.test(line)) {
      updatedLine = line.replace(/(["'])([^:"']+):([^:"']+):([^"']+)\1/, (_all, quote, group, artifact) => `${quote}${group}:${artifact}:${version}${quote}`);
    } else if (/version\s*=\s*["']/.test(line)) {
      updatedLine = line.replace(/(version\s*=\s*["'])[^"']*(["'])/, `$1${version}$2`);
    } else if (/version\s*=\s*\{/.test(line)) {
      updatedLine = line.replace(/((?:strictly|require|prefer)\s*=\s*["'])[^"']*(["'])/, `$1${version}$2`);
    } else {
      updatedLine = line.replace(/}\s*$/, `, version = "${version}" }`);
    }
    const updated = `${catalog.source.slice(0, library._start)}${updatedLine}${catalog.source.slice(library._end)}`;
    const changed = await this.writeChecked(catalog.path, catalog.source, updated);
    return { file: catalog.path, files: changed ? [catalog.path] : [], updated: changed, changed, catalogAlias: library.alias };
  }

  async updateCatalog(root, catalogPath, key, version) {
    root = this.pathGuard.assertWorkspace(root);
    const checkedKey = assertCatalogKey(key);
    const checkedVersion = assertVersion(version);
    return this.withMutation(root, async () => this.updateCatalogInternal(root, await this.collect(root), catalogPath, checkedKey, checkedVersion));
  }
}

module.exports = {
  mavenSearchQuery,
  maskBlockComments,
  assertVersion,
  assertVersionPlaceholders,
  DependencyService,
  insertMavenDependency,
  insertGradleDependency,
  parseMavenFile,
  parseVersionCatalog,
  parseGradleFile,
  assertCoordinates,
  MAVEN_SCOPES,
  GRADLE_CONFIGURATIONS,
};
