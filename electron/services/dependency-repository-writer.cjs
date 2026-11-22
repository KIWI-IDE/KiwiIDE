const { maskSourceComments, maskXmlComments, maskXmlElement, topLevelBlockBody, matchingBrace } = require("./source-text.cjs");

function gradleRepository(source, repository, management = false) {
  let start = 0;
  let end = source.length;
  if (management) {
    start = topLevelBlockBody(source, "dependencyResolutionManagement");
    end = matchingBrace(source, start);
    if (start < 0 || end < 0) throw new Error("Der dependencyResolutionManagement-Abschnitt ist unvollständig.");
  }
  const section = source.slice(start, end);
  const body = topLevelBlockBody(section, "repositories");
  const close = body < 0 ? -1 : matchingBrace(section, body);
  if (body >= 0 && close < 0) throw new Error("Der repositories-Abschnitt ist unvollständig.");
  const content = body < 0 ? "" : section.slice(body, close);
  const live = maskSourceComments(content);
  const normalized = repository.url.replace(/\/$/, "");
  const declared = [...live.matchAll(/["'](https:\/\/[^"']+)["']/g)].some(match => match[1].replace(/\/$/, "") === normalized);
  if (declared || (repository.id === "central" && /\bmavenCentral\s*\(/.test(live)) || (repository.id === "google" && /\bgoogle\s*\(/.test(live))) return source;
  const baseIndent = management ? "    " : "";
  const declaration = repository.id === "central" ? "mavenCentral()" : repository.id === "google" ? "google()" : `maven { url = uri("${repository.url}") }`;
  let updated;
  if (body < 0) {
    // Append inside dependencyResolutionManagement, or at the end of a build
    // script, keeping plugins/imports at the beginning of a Kotlin script.
    updated = `${section.replace(/\s*$/, "")}\n\n${baseIndent}repositories {\n${baseIndent}    ${declaration}\n${baseIndent}}\n`;
  } else {
    updated = `${section.slice(0, body)}\n${baseIndent}    ${declaration}\n${section.slice(body)}`;
  }
  return `${source.slice(0, start)}${updated}${source.slice(end)}`;
}

function mavenRepository(source, repository) {
  if (repository.id === "central") return source;
  // A plugin repository does not resolve ordinary dependencies.
  const live = maskXmlElement(maskXmlElement(maskXmlComments(source), "pluginRepositories"), "profiles");
  const section = /<repositories\b[^>]*>([\s\S]*?)<\/repositories>/i.exec(live);
  const urls = [...(section?.[1] || "").matchAll(/<url>\s*([^<]+)\s*<\/url>/g)].map(match => match[1].trim().replace(/\/$/, ""));
  if (urls.includes(repository.url.replace(/\/$/, ""))) return source;
  const block = `    <repository>\n      <id>kiwi-${repository.id}</id>\n      <url>${repository.url}</url>\n    </repository>`;
  if (section) {
    const at = section.index + section[0].lastIndexOf("</repositories>");
    return `${source.slice(0, at)}\n${block}\n  ${source.slice(at)}`;
  }
  const empty = /<repositories\s*\/>/i.exec(live);
  if (empty) return `${source.slice(0, empty.index)}<repositories>\n${block}\n  </repositories>${source.slice(empty.index + empty[0].length)}`;
  const closing = live.lastIndexOf("</project>");
  if (closing < 0) throw new Error("Die Maven-Builddatei ist unvollständig.");
  return `${source.slice(0, closing)}  <repositories>\n${block}\n  </repositories>\n${source.slice(closing)}`;
}

module.exports = { gradleRepository, mavenRepository };
