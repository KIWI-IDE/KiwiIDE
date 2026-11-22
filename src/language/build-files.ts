/**
 * Completion for `pom.xml` and Gradle build scripts.
 *
 * Build files are edited by hand far more often than they are generated, and
 * getting an element name or a configuration wrong costs a full build cycle to
 * find out. Everything here is derived from where the caret sits, so a
 * suggestion is only offered where it would actually be valid.
 *
 * Coordinates are not listed here: those come from Maven Central at request
 * time. This module only decides *that* a coordinate is being typed, and which
 * part of it.
 */

export interface BuildSuggestion {
  label: string;
  /** What is written; defaults to the label. */
  insertText?: string;
  detail: string;
  /** Marks a snippet with placeholders, in Monaco's syntax. */
  snippet?: boolean;
}

/** Which coordinate part the caret is in, and what is already known. */
export interface CoordinateQuery {
  field: "groupId" | "artifactId" | "version";
  term: string;
  groupId: string;
  artifactId: string;
}

const MAVEN_CHILDREN: Record<string, Array<[string, string]>> = {
  "": [["project", "Wurzelelement eines Maven-Projekts"]],
  project: [
    ["modelVersion", "Immer 4.0.0"],
    ["groupId", "Gruppe des Artefakts"],
    ["artifactId", "Name des Artefakts"],
    ["version", "Version des Artefakts"],
    ["packaging", "jar, war oder pom"],
    ["name", "Anzeigename"],
    ["description", "Beschreibung"],
    ["parent", "Übergeordnetes Projekt"],
    ["properties", "Eigenschaften des Builds"],
    ["dependencies", "Abhängigkeiten"],
    ["dependencyManagement", "Versionen für untergeordnete Module"],
    ["modules", "Module eines Aggregators"],
    ["build", "Plugins und Verzeichnisse"],
    ["profiles", "Build-Profile"],
    ["repositories", "Zusätzliche Repositories"],
  ],
  dependencies: [["dependency", "Eine Abhängigkeit"]],
  dependency: [
    ["groupId", "Gruppe"],
    ["artifactId", "Artefakt"],
    ["version", "Version"],
    ["scope", "compile, provided, runtime, test oder system"],
    ["optional", "true blockiert die Weitergabe an Nutzer"],
    ["classifier", "Zusatzkennung, etwa sources"],
    ["exclusions", "Ausgeschlossene transitive Abhängigkeiten"],
  ],
  parent: [
    ["groupId", "Gruppe"],
    ["artifactId", "Artefakt"],
    ["version", "Version"],
    ["relativePath", "Pfad zur übergeordneten pom.xml"],
  ],
  build: [
    ["finalName", "Name der erzeugten Datei"],
    ["sourceDirectory", "Quellverzeichnis"],
    ["testSourceDirectory", "Testquellverzeichnis"],
    ["plugins", "Build-Plugins"],
    ["pluginManagement", "Plugin-Versionen für Module"],
    ["resources", "Ressourcenverzeichnisse"],
  ],
  plugins: [["plugin", "Ein Build-Plugin"]],
  plugin: [
    ["groupId", "Gruppe"],
    ["artifactId", "Artefakt"],
    ["version", "Version"],
    ["configuration", "Einstellungen des Plugins"],
    ["executions", "Ausführungen im Lebenszyklus"],
  ],
  modules: [["module", "Ein Modulverzeichnis"]],
  profiles: [["profile", "Ein Build-Profil"]],
  profile: [
    ["id", "Name des Profils"],
    ["activation", "Wann das Profil greift"],
    ["properties", "Eigenschaften des Profils"],
    ["dependencies", "Abhängigkeiten des Profils"],
    ["build", "Build-Abschnitt des Profils"],
  ],
  properties: [
    ["maven.compiler.source", "Quell-Sprachstand"],
    ["maven.compiler.target", "Ziel-Sprachstand"],
    ["maven.compiler.release", "Sprachstand als release-Flag"],
    ["project.build.sourceEncoding", "Zeichensatz der Quellen"],
  ],
  exclusions: [["exclusion", "Eine ausgeschlossene Abhängigkeit"]],
  exclusion: [["groupId", "Gruppe"], ["artifactId", "Artefakt"]],
  dependencyManagement: [["dependencies", "Verwaltete Abhängigkeiten"]],
};

/** Values a Maven element accepts, where the set is small and fixed. */
const MAVEN_VALUES: Record<string, Array<[string, string]>> = {
  scope: [
    ["compile", "Standard, überall auf dem Klassenpfad"],
    ["provided", "Zur Übersetzung da, zur Laufzeit von außen"],
    ["runtime", "Nur zur Laufzeit"],
    ["test", "Nur für Tests"],
    ["system", "Lokale Datei, veraltet"],
    ["import", "Nur in dependencyManagement für eine BOM"],
  ],
  packaging: [["jar", "Bibliothek oder Anwendung"], ["war", "Webanwendung"], ["pom", "Aggregator oder BOM"], ["maven-plugin", "Maven-Plugin"]],
  optional: [["true", "Nicht an Nutzer weitergeben"], ["false", "Weitergeben"]],
  modelVersion: [["4.0.0", "Einzige gültige Modellversion"]],
};

const GRADLE_BLOCKS: Record<string, Array<[string, string, boolean]>> = {
  "": [
    ["plugins", "plugins {\n    $0\n}", true],
    ["dependencies", "dependencies {\n    $0\n}", true],
    ["repositories", "repositories {\n    mavenCentral()$0\n}", true],
    ["java", "java {\n    $0\n}", true],
    ["tasks", "tasks {\n    $0\n}", true],
    ["subprojects", "subprojects {\n    $0\n}", true],
    ["allprojects", "allprojects {\n    $0\n}", true],
    ["group", "group = \"$0\"", true],
    ["version", "version = \"$0\"", true],
    ["test", "test {\n    useJUnitPlatform()$0\n}", true],
  ],
  dependencies: [
    ["implementation", "implementation(\"$0\")", true],
    ["api", "api(\"$0\")", true],
    ["compileOnly", "compileOnly(\"$0\")", true],
    ["runtimeOnly", "runtimeOnly(\"$0\")", true],
    ["testImplementation", "testImplementation(\"$0\")", true],
    ["testRuntimeOnly", "testRuntimeOnly(\"$0\")", true],
    ["annotationProcessor", "annotationProcessor(\"$0\")", true],
    ["testAnnotationProcessor", "testAnnotationProcessor(\"$0\")", true],
    ["platform", "platform(\"$0\")", true],
    ["project", "project(\":$0\")", true],
  ],
  repositories: [
    ["mavenCentral", "mavenCentral()", false],
    ["mavenLocal", "mavenLocal()", false],
    ["gradlePluginPortal", "gradlePluginPortal()", false],
    ["google", "google()", false],
    ["maven", "maven { url = uri(\"$0\") }", true],
  ],
  plugins: [
    ["java", "java", false],
    ["application", "application", false],
    ["java-library", "`java-library`", false],
    ["id", "id(\"$0\")", true],
  ],
  java: [
    ["sourceCompatibility", "sourceCompatibility = JavaVersion.VERSION_$0", true],
    ["targetCompatibility", "targetCompatibility = JavaVersion.VERSION_$0", true],
    ["toolchain", "toolchain {\n        languageVersion = JavaLanguageVersion.of($0)\n    }", true],
    ["withSourcesJar", "withSourcesJar()", false],
    ["withJavadocJar", "withJavadocJar()", false],
  ],
};

/** Configurations that take a coordinate, so a lookup is worth offering. */
const GRADLE_CONFIGURATIONS = new Set(GRADLE_BLOCKS.dependencies.map(([name]) => name));

/** Whether a path is a build file this module knows anything about. */
export function buildFileKind(path: string): "maven" | "gradle" | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (name === "pom.xml") return "maven";
  if (name.endsWith(".gradle") || name.endsWith(".gradle.kts")) return "gradle";
  return null;
}

/**
 * Whether a file is one a dependency can be written into.
 *
 * Narrower than buildFileKind, which answers for every Gradle script. A
 * settings file lists the projects and a `gradle.properties` holds values;
 * neither carries a dependency block, and offering to add a library to one
 * promises something the file cannot hold.
 */
export function acceptsDependencies(path: string): boolean {
  const name = String(path || "").split(/[\\/]/).pop()?.toLowerCase() || "";
  return name === "pom.xml" || name === "build.gradle" || name === "build.gradle.kts";
}

/**
 * The chain of still-open XML elements at an offset.
 *
 * Deliberately not a parser: a build file being edited is usually not
 * well-formed, and a strict parse would give up exactly when help is needed.
 */
export function mavenElementPath(text: string, offset: number): string[] {
  const before = text.slice(0, offset);
  const stack: string[] = [];
  for (const match of before.matchAll(/<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.length = index;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  return stack;
}

/** Suggestions for a Maven build file at the caret. */
export function mavenCompletions(text: string, offset: number): BuildSuggestion[] {
  const before = text.slice(0, offset);
  const path = mavenElementPath(text, offset);
  const parent = path[path.length - 1] || "";

  // Inside an element's text content the values matter, not the element names.
  const openTagStart = before.lastIndexOf("<");
  const openTagEnd = before.lastIndexOf(">");
  const insideTag = openTagStart > openTagEnd;
  if (!insideTag) {
    const values = MAVEN_VALUES[parent];
    if (values) return values.map(([label, detail]) => ({ label, detail }));
  }

  const children = MAVEN_CHILDREN[parent] || [];
  return children.map(([label, detail]) => ({
    label,
    // The closing tag comes along: forgetting it is the most common mistake in
    // a hand-edited pom, and the build only complains much later.
    insertText: MAVEN_CHILDREN[label] ? `${label}>\n    $0\n</${label}>` : `${label}>$0</${label}>`,
    detail,
    snippet: true,
  }));
}

/**
 * The chain of open Gradle blocks at an offset.
 *
 * Counts braces and remembers the identifier that opened each one, which is all
 * that is needed to tell `dependencies { }` from `repositories { }`.
 */
function gradleContext(text: string, offset: number): { path: string[]; code: boolean } {
  const before = text.slice(0, offset);
  const stack: string[] = [];
  let index = 0;
  let lastName = "";
  while (index < before.length) {
    const character = before[index];
    if (character === "\"" || character === "'") {
      const quote = character;
      if (before.slice(index, index + 3) === quote.repeat(3)) {
        const end = before.indexOf(quote.repeat(3), index + 3);
        if (end < 0) return { path: stack.filter(Boolean), code: false };
        index = end + 3;
        continue;
      }
      index += 1;
      while (index < before.length && before[index] !== quote) {
        if (before[index] === "\\") index += 1;
        index += 1;
      }
      if (index >= before.length) return { path: stack.filter(Boolean), code: false };
      index += 1;
      continue;
    }
    if (character === "/" && before[index + 1] === "/") {
      while (index < before.length && before[index] !== "\n") index += 1;
      if (index >= before.length) return { path: stack.filter(Boolean), code: false };
      continue;
    }
    if (character === "/" && before[index + 1] === "*") {
      let depth = 1;
      index += 2;
      while (index < before.length && depth) {
        if (before.slice(index, index + 2) === "/*") { depth += 1; index += 2; }
        else if (before.slice(index, index + 2) === "*/") { depth -= 1; index += 2; }
        else index += 1;
      }
      if (depth) return { path: stack.filter(Boolean), code: false };
      continue;
    }
    if (character === "{") {
      const line = before.slice(before.lastIndexOf("\n", index - 1) + 1, index);
      const typed = /(?:withType|configure|named|register)\s*<\s*([A-Za-z_][\w.]*)\s*>[^{}]*$/.exec(line);
      const applied = /\bas\s+([A-Za-z_]\w*)\s*\)\s*\.apply\s*$/.exec(line);
      const invocation = /\b([A-Za-z_]\w*)\s*\([^{}]*\)\s*$/.exec(line);
      const dependency = invocation && GRADLE_CONFIGURATIONS.has(invocation[1]) ? invocation[1] : "";
      stack.push(typed?.[1] || applied?.[1] || dependency || lastName);
      lastName = "";
      index += 1;
      continue;
    }
    if (character === "}") {
      stack.pop();
      lastName = "";
      index += 1;
      continue;
    }
    const identifier = /^[A-Za-z_][\w.]*/.exec(before.slice(index));
    if (identifier) {
      lastName = identifier[0];
      index += identifier[0].length;
      continue;
    }
    if (character === "\n") lastName = "";
    index += 1;
  }
  return { path: stack.filter(Boolean), code: true };
}

export function gradleBlockPath(text: string, offset: number): string[] {
  return gradleContext(text, offset).path;
}
export function isGradleCode(text: string, offset: number): boolean { return gradleContext(text, offset).code; }

/** The complete accessor is replaced, including text beyond the caret. */
export function gradleCatalogQueryAt(text: string, offset: number, configurations: string[] = []): { catalog: string; accessor: string; start: number; end: number } | null {
  if (!gradleContext(text, offset).code) return null;
  const match = /\b([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]*)+)$/.exec(text.slice(0, offset));
  if (!match) {
    const argument = /\b([A-Za-z_]\w*)\s*\(\s*([A-Za-z0-9_]*)$/.exec(text.slice(0, offset));
    if (!argument || (!GRADLE_CONFIGURATIONS.has(argument[1]) && !configurations.includes(argument[1]))) return null;
    const term = argument[2];
    const rest = /^[A-Za-z0-9_.]*/.exec(text.slice(offset))?.[0] || "";
    return { catalog: "", accessor: term, start: offset - term.length, end: offset + rest.length };
  }
  const rest = /^[A-Za-z0-9_.]*/.exec(text.slice(offset))?.[0] || "";
  return { catalog: match[1], accessor: match[0], start: offset - match[0].length, end: offset + rest.length };
}

const GRADLE_MEMBERS: Record<string, Array<[string, string, boolean]>> = {
  dependency: [
    ["isTransitive", "isTransitive = false", false],
    ["exclude", "exclude(group = \"${1:group}\", module = \"${2:module}\")", true],
    ["because", "because(\"$0\")", true],
  ],
  JavaPluginExtension: GRADLE_BLOCKS.java,
  JavaCompile: [
    ["options", "options.$0", true], ["dependsOn", "dependsOn($0)", true], ["setSource", "setSource($0)", true],
    ["sourceCompatibility", "sourceCompatibility = \"$0\"", true], ["targetCompatibility", "targetCompatibility = \"$0\"", true],
  ],
  JavaCompileOptions: [
    ["encoding", "encoding = \"UTF-8\"", false], ["release", "release.set($0)", true],
    ["compilerArgs", "compilerArgs.add(\"$0\")", true], ["isFork", "isFork = true", false],
  ],
  Javadoc: [["options", "options", false], ["source", "source($0)", true], ["classpath", "classpath", false]],
  SourceSetContainer: [["named", "named(\"${1:main}\") {\n    $0\n}", true]],
  StandardJavadocDocletOptions: [["encoding", "encoding = \"UTF-8\"", false], ["addStringOption", "addStringOption(\"${1:option}\", \"${2:value}\")", true]],
  tasks: [["withType", "withType<${1:JavaCompile}>().configureEach {\n    $0\n}", true], ["named", "named<${1:JavaCompile}>(\"${2:compileJava}\") {\n    $0\n}", true], ["register", "register<${1:Sync}>(\"${2:taskName}\") {\n    $0\n}", true], ["test", "test {\n    useJUnitPlatform()$0\n}", true], ["processResources", "processResources {\n    $0\n}", true]],
  extensions: [["configure", "configure<${1:JavaPluginExtension}> {\n    $0\n}", true]],
  layout: [["projectDirectory", "projectDirectory", false], ["buildDirectory", "buildDirectory", false]],
  inputs: [["properties", "properties($0)", true], ["property", "property(\"${1:name}\", ${2:value})", true]],
  toolchain: [["languageVersion", "languageVersion.set(JavaLanguageVersion.of($0))", true], ["vendor", "vendor", false]],
  Sync: [["from", "from($0)", true], ["into", "into($0)", true], ["inputs", "inputs.$0", true], ["filter", "filter<${1:ReplaceTokens}>(\"tokens\" to ${2:tokens})", true]],
  test: [["useJUnitPlatform", "useJUnitPlatform()", false]],
  processResources: [["inputs", "inputs.$0", true], ["filesMatching", "filesMatching(listOf(\"${1:**/*.yml}\")) {\n    $0\n}", true]],
  credentials: [["username", "username = System.getenv(\"$0\")", true], ["password", "password = System.getenv(\"$0\")", true]],
  maven: [["name", "name = \"$0\"", true], ["url", "url = uri(\"$0\")", true], ["credentials", "credentials {\n    $0\n}", true]],
};

/** Suggestions for a Gradle build script at the caret. */
export function gradleCompletions(text: string, offset: number): BuildSuggestion[] {
  const context = gradleContext(text, offset);
  if (!context.code) return [];
  const path = context.path;
  const block = path[path.length - 1] || "";
  const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
  const options = /\boptions\.[A-Za-z_]*$/.test(line) && (path.includes("JavaCompile") || path.includes("compileJava"));
  const receiver = /\b(tasks|extensions|layout|inputs|toolchain)\.[A-Za-z_]*$/.exec(line)?.[1];
  const entries = receiver ? GRADLE_MEMBERS[receiver] : options ? GRADLE_MEMBERS.JavaCompileOptions
    : GRADLE_CONFIGURATIONS.has(block) ? GRADLE_MEMBERS.dependency
    : GRADLE_MEMBERS[block] || GRADLE_MEMBERS[block.split(".").at(-1) || ""] || GRADLE_BLOCKS[block] || (path.length ? [] : GRADLE_BLOCKS[""]);
  return entries.map(([label, insertText, snippet]) => ({
    label,
    insertText,
    detail: block ? `${block} { … }` : "Build-Skript",
    snippet,
  }));
}

/**
 * Whether the caret sits in a dependency coordinate, and which part.
 *
 * The answer drives a Maven Central lookup, so it has to be precise: offering
 * artifact names while someone types a version is worse than offering nothing.
 */
export function coordinateQueryAt(text: string, offset: number, kind: "maven" | "gradle", configurations: string[] = []): CoordinateQuery | null {
  if (kind === "maven") {
    const path = mavenElementPath(text, offset);
    const element = path[path.length - 1] || "";
    if (!["groupId", "artifactId", "version"].includes(element)) return null;
    const parent = path[path.length - 2] || "";
    if (!["dependency", "plugin", "parent", "exclusion"].includes(parent)) return null;
    const term = text.slice(text.lastIndexOf(">", offset - 1) + 1, offset).trim();
    const block = enclosingMavenBlock(text, offset);
    return {
      field: element as CoordinateQuery["field"],
      term,
      groupId: element === "groupId" ? term : elementText(block, "groupId"),
      artifactId: element === "artifactId" ? term : elementText(block, "artifactId"),
    };
  }

  // Gradle: inside the string of a dependency configuration, "group:name:version".
  const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
  const call = /\b([A-Za-z][\w]*)\s*[( ]\s*["']([^"']*)$/.exec(line);
  if (!call || (!GRADLE_CONFIGURATIONS.has(call[1]) && !configurations.includes(call[1]))) return null;
  const [groupId = "", artifactId = "", version = ""] = call[2].split(":");
  const parts = call[2].split(":").length;
  return {
    field: parts >= 3 ? "version" : parts === 2 ? "artifactId" : "groupId",
    term: parts >= 3 ? version : parts === 2 ? artifactId : groupId,
    groupId,
    artifactId,
  };
}

/** The `<dependency>` or `<plugin>` element the caret is in. */
function enclosingMavenBlock(text: string, offset: number): string {
  const start = Math.max(
    text.lastIndexOf("<dependency>", offset),
    text.lastIndexOf("<plugin>", offset),
    text.lastIndexOf("<parent>", offset),
  );
  return start < 0 ? "" : text.slice(start, offset);
}

function elementText(block: string, element: string): string {
  return new RegExp(`<${element}>([^<]*)<`).exec(block)?.[1].trim() || "";
}


/**
 * One artifact, reduced to what writing it into a build file needs.
 *
 * Deliberately narrower than the search result the main process returns, so
 * these rules can be exercised without inventing a packaging and a timestamp.
 */
export interface ArtifactCoordinate {
  groupId: string;
  artifactId: string;
  version: string;
  packaging?: string;
}

/** A stretch of the file a completion replaces, as offsets. */
export interface TextSpan {
  start: number;
  end: number;
}

/** An edit somewhere else in the file that belongs with the completion. */
export interface CoordinateEdit extends TextSpan {
  newText: string;
}

/**
 * The page a human would open to read about an artifact.
 *
 * mvnrepository.com has no API — it answers a machine with a Cloudflare
 * challenge, so nothing can be searched there — but it is the page people mean
 * when they say "look it up", and every proposal carries the link to it.
 */
export function mvnRepositoryUrl(groupId: string, artifactId: string, version = ""): string {
  const part = (value: string) => encodeURIComponent(String(value || "").trim());
  if (!groupId || !artifactId) {
    return `https://mvnrepository.com/search?q=${part(`${groupId} ${artifactId}`.trim())}`;
  }
  const base = `https://mvnrepository.com/artifact/${part(groupId)}/${part(artifactId)}`;
  return version ? `${base}/${part(version)}` : base;
}

/**
 * The part of the file a coordinate completion overwrites.
 *
 * Returned as offsets rather than a Monaco range so the rule can be tested
 * without an editor. Null where the caret is not in a coordinate at all.
 */
export function coordinateSpanAt(text: string, offset: number, kind: "maven" | "gradle", configurations: string[] = []): TextSpan | null {
  if (!coordinateQueryAt(text, offset, kind, configurations)) return null;
  if (kind === "maven") {
    const start = text.lastIndexOf(">", offset - 1) + 1;
    return start > 0 ? { start, end: offset } : null;
  }
  // Everything back to the quote that opened the string.
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const line = text.slice(lineStart, offset);
  const quote = Math.max(line.lastIndexOf('"'), line.lastIndexOf("'"));
  return quote < 0 ? null : { start: lineStart + quote + 1, end: offset };
}

/**
 * The whole coordinate, written the way this file writes coordinates.
 *
 * Gradle keeps it in the string that is already open; Maven has one element per
 * part, so the artifactId is written where the caret is and the other two are
 * filled in around it.
 */
export function gradleCoordinateText(candidate: ArtifactCoordinate): string {
  return [candidate.groupId, candidate.artifactId, candidate.version].filter(Boolean).join(":");
}

/**
 * The edits that complete a Maven `<dependency>` block from one proposal.
 *
 * Completing only the artifactId left `<groupId>` and `<version>` empty, and a
 * pom with an empty groupId does not build — so the useful half of the answer
 * was always left to be typed by hand. Only empty elements are filled: a
 * version somebody chose on purpose is never overwritten.
 */
export function mavenDependencyEdits(
  text: string,
  offset: number,
  candidate: ArtifactCoordinate,
): CoordinateEdit[] {
  const span = coordinateSpanAt(text, offset, "maven");
  const query = coordinateQueryAt(text, offset, "maven");
  if (!span || !query) return [];
  const edits: CoordinateEdit[] = [];
  const value = query.field === "groupId"
    ? candidate.groupId
    : query.field === "version" ? candidate.version : candidate.artifactId;
  edits.push({ ...span, newText: value });

  const dependencyStart = text.lastIndexOf("<dependency>", offset);
  const pluginStart = text.lastIndexOf("<plugin>", offset);
  const blockStart = Math.max(dependencyStart, pluginStart);
  if (blockStart < 0) return edits;
  // To the end of the element, not to the next closing tag: the version
  // usually sits below the caret, and stopping at </artifactId> left it out —
  // which is exactly the element this is here to fill.
  const closingTag = dependencyStart >= pluginStart ? "</dependency>" : "</plugin>";
  const closing = text.indexOf(closingTag, blockStart);
  const block = text.slice(blockStart, closing < 0 ? text.length : closing + closingTag.length);

  for (const [element, filled] of [
    ["groupId", candidate.groupId],
    ["artifactId", candidate.artifactId],
    ["version", candidate.version],
  ] as Array<[string, string]>) {
    if (element === query.field || !filled) continue;
    const match = new RegExp(`<${element}>([^<]*)</${element}>`).exec(block);
    // Only an element that is there and empty: adding one would need to guess
    // where it belongs, and replacing one would throw away a deliberate choice.
    if (!match || match[1].trim()) continue;
    const start = blockStart + match.index + `<${element}>`.length;
    edits.push({ start, end: start + match[1].length, newText: filled });
  }
  return edits;
}

/**
 * What a build file is called when several of them are on offer.
 *
 * A multi-project build has one per module, and every one of them is named
 * build.gradle.kts — a list of identical entries is not a choice. The module
 * is what tells them apart, so the module is what the entry says.
 */
export function buildFileLabel(file: string, root: string): string {
  const normalise = (value: string) => String(value || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const full = normalise(file);
  const base = normalise(root);
  const name = full.split("/").pop() || full;
  const inside = base && full.toLocaleLowerCase().startsWith(`${base.toLocaleLowerCase()}/`)
    ? full.slice(base.length + 1)
    : full;
  const directory = inside.split("/").slice(0, -1).join(" › ");
  return directory ? `${directory} · ${name}` : `Projekt · ${name}`;
}

