const fs = require("node:fs/promises");
const path = require("node:path");
const { XMLParser } = require("fast-xml-parser");
const { maskSourceComments, maskXmlComments, maskJavaSource } = require("./source-text.cjs");
const { assertCoordinates } = require("./dependency-service.cjs");
const { repositoryById, sourceForGroup } = require("./dependency-sources.cjs");
const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });
const PART = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const VERSION = /^[A-Za-z0-9._+-]+$/;
const prerelease = value => /(?:snapshot|alpha|beta|preview|nightly|(?:^|[.\-])(?:rc|m)\d)/i.test(value);
const equalPath = (a, b) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];

function javaNumber(value) {
  const match = /^(?:1\.)?(\d{1,2})$/.exec(String(value || "").trim());
  const number = Number(match?.[1]);
  return number >= 6 && number <= 99 ? number : null;
}
function javaTarget(source) {
  const isXml = /<project(?:\s|>)/.test(source);
  source = isXml ? maskXmlComments(source) : maskSourceComments(source);
  const code = isXml ? source : maskJavaSource(source);
  const locals = new Map([...source.matchAll(/\b(?:val|var|def)\s+([A-Za-z_]\w*)\s*=\s*["']?(\d{1,2})["']?/g)].map(match => [match[1], match[2]]));
  for (const pattern of [
    /\b(?:options\.)?release\s*(?:\.set\s*\(\s*|=\s*)([A-Za-z_]\w*|["']?(?:1\.)?\d{1,2}["']?)/g,
    /\btargetCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?([A-Za-z_]\w*|["']?(?:1[._])?\d{1,2}["']?)/g,
    /JavaLanguageVersion\.of\s*\(\s*([A-Za-z_]\w*|\d{1,2})\s*\)/g,
    /<(?:maven\.compiler\.release|maven\.compiler\.target|java\.version)>\s*([^<]+)\s*</g,
  ]) {
    const hits = [...source.matchAll(pattern)];
    for (const match of hits.reverse()) {
      if (!code.slice(match.index, match.index + 5).trim()) continue;
      const value = String(locals.get(match[1]) || match[1]).replace(/["']/g, "").replace(/^1_/, "1.");
      const number = javaNumber(value); if (number) return number;
    }
  }
  return null;
}

function minecraftVersion(groupId, artifactId, version) {
  if (artifactId === "fabric-api" && groupId.startsWith("net.fabricmc")) return /\+(\d+\.\d+(?:\.\d+)?)/.exec(version)?.[1] || null;
  if (["io.papermc.paper:paper-api", "org.spigotmc:spigot-api", "org.bukkit:bukkit", "net.fabricmc:yarn"].includes(`${groupId}:${artifactId}`)) return /^(\d+\.\d+(?:\.\d+)?)(?:[+.-]|$)/.exec(version)?.[1] || null;
  return null;
}
function sameMinecraft(target, candidate) {
  if (!target || !candidate) return true;
  const parts = target.split(".");
  return candidate.split(".").slice(0, parts.length).join(".") === target;
}

class DependencyCompatibilityService {
  constructor(guard, projects, dependencies) { Object.assign(this, { guard, projects, dependencies }); }

  async context(root, buildFile, groupId, artifactId) {
    root = this.guard.assertWorkspace(root);
    const model = await this.dependencies.collect(root);
    const target = buildFile ? model.files.find(file => equalPath(file.file, this.guard.assertAllowed(buildFile, root))) : model.files[0];
    if (!target) throw new Error("Die Builddatei gehört nicht zu diesem Projekt.");
    const project = await this.projects.detect(root);
    const declared = model.dependencies.filter(entry => equalPath(entry.buildFile, target.file));
    const current = declared.find(entry => entry.groupId === groupId && entry.artifactId === artifactId);
    const paper = declared.find(entry => /^(paper-api|spigot-api|bukkit)$/.test(entry.artifactId));
    let minecraftTarget = paper ? minecraftVersion(paper.groupId, paper.artifactId, paper.version) : null;
    if (!minecraftTarget) {
      const properties = path.join(root, "gradle.properties"); this.guard.assertAllowed(properties, root);
      const text = await fs.readFile(properties, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
      minecraftTarget = /^\s*(?:minecraft_version|minecraftVersion|minecraft\.version)\s*=\s*(\d+\.\d+(?:\.\d+)?)\s*$/m.exec(text)?.[1] || null;
    }
    const declaredJava = javaTarget(target.source);
    const unresolvedTarget = !declaredJava && /(?:\brelease\s*(?:=|\.set)|targetCompatibility|JavaLanguageVersion\.of|<parent>|<maven\.compiler\.(?:target|release)>)/.test(target.source);
    return { root, buildFile: target.file, javaTarget: declaredJava || (unresolvedTarget ? null : javaNumber(project.languageLevel)), minecraftTarget, currentVersion: current?.version || "", declared };
  }

  async pom(source, groupId, artifactId, version, depth = 0, seen = new Set()) {
    if (!PART.test(groupId) || !PART.test(artifactId) || !VERSION.test(version) || depth > 2) return null;
    const key = `pom:${source.id}:${groupId}:${artifactId}:${version}`;
    if (seen.has(key)) return null;
    const next = new Set(seen).add(key);
    const read = async () => {
      const base = `${groupId.replaceAll(".", "/")}/${artifactId}/${version}/`;
      let filenameVersion = version;
      if (version.endsWith("-SNAPSHOT")) {
        const meta = await this.dependencies.sources.request(new URL(`${base}maven-metadata.xml`, source.url));
        if (meta && /<metadata(?:\s|>)/.test(meta)) {
          const snapshot = list(xml.parse(meta)?.metadata?.versioning?.snapshotVersions?.snapshotVersion).find(entry => entry.extension === "pom" && !entry.classifier);
          if (snapshot?.value && VERSION.test(snapshot.value)) filenameVersion = snapshot.value;
        }
      }
      const text = await this.dependencies.sources.request(new URL(`${base}${artifactId}-${filenameVersion}.pom`, source.url));
      if (!text || !/<project(?:\s|>)/.test(text)) return null;
      const project = xml.parse(text)?.project;
      if (!project) return null;
      let inherited = {};
      const parent = project.parent;
      if (parent && depth < 2 && [parent.groupId, parent.artifactId, parent.version].every(value => typeof value === "string")) {
        const result = await this.pom(source, parent.groupId, parent.artifactId, parent.version, depth + 1, next).catch(() => null);
        inherited = result?.properties || {};
      }
      const properties = { ...inherited, ...(project.properties || {}) };
      const resolve = value => {
        let text = String(value || "");
        for (let index = 0; index < 5; index++) text = text.replace(/\$\{([^}]+)\}/g, (all, name) => typeof properties[name] === "string" ? properties[name] : all);
        return text;
      };
      const compiler = list(project.build?.plugins?.plugin).find(plugin => plugin.artifactId === "maven-compiler-plugin")?.configuration;
      const requiredJava = [compiler?.release, properties["maven.compiler.release"], compiler?.target, properties["maven.compiler.target"], properties["java.version"]].map(value => javaNumber(resolve(value))).find(Boolean) || null;
      return { properties, requiredJava, evidence: requiredJava ? "pom" : null };
    };
    // Recursive reads must not wait on another root's in-flight cache entry:
    // two POMs with cyclic parents can otherwise await each other forever.
    return depth === 0 ? this.dependencies.sources.cached(key, read) : read();
  }

  async requirement(source, groupId, artifactId, version) {
    return this.dependencies.sources.cached(`compatibility:${source.id}:${groupId}:${artifactId}:${version}`, async () => {
      const url = new URL(`${groupId.replaceAll(".", "/")}/${artifactId}/${version}/${artifactId}-${version}.module`, source.url);
      let unavailable = false;
      try {
        const data = await this.dependencies.sources.request(url, "json");
        const variants = list(data?.variants).filter(variant => /java-(api|runtime)/.test(variant.attributes?.["org.gradle.usage"] || "") && (!variant.capabilities || variant.capabilities.some(capability => capability.group === groupId && capability.name === artifactId)));
        const levels = variants.map(variant => javaNumber(variant.attributes?.["org.gradle.jvm.version"])).filter(Boolean);
        if (levels.length) return { requiredJava: Math.min(...levels), evidence: "gradle-module", constraints: variants.flatMap(variant => list(variant.dependencyConstraints)) };
      } catch { unavailable = true; }
      const pom = await this.pom(source, groupId, artifactId, version).catch(() => { unavailable = true; return null; });
      return { requiredJava: pom?.requiredJava || null, evidence: pom?.evidence || (unavailable ? "unavailable" : null), constraints: [] };
    });
  }

  async advise(root, groupId, artifactId, options = {}) {
    const checked = assertCoordinates({ groupId, artifactId, version: options.version || "1" });
    if (options.version && !VERSION.test(options.version)) throw new Error("Eine konkrete Version ist für die Kompatibilitätsprüfung erforderlich.");
    const context = await this.context(root, options.buildFile, checked.groupId, checked.artifactId);
    const remembered = this.dependencies.sources.artifactSources.get(`${groupId}:${artifactId}`);
    const source = repositoryById(options.sourceId || remembered || sourceForGroup(groupId)?.id || "central");
    let published = [];
    try { published = (await this.dependencies.sources.artifact(source, groupId, artifactId)).versions; } catch { /* Search API remains a fallback. */ }
    if (!published.length) published = await this.dependencies.versions(groupId, artifactId, 100, source.id);
    const sameGame = published.filter(version => sameMinecraft(context.minecraftTarget, minecraftVersion(groupId, artifactId, version)));
    const sameMajor = version => !context.currentVersion || version.split(".")[0] === context.currentVersion.split(".")[0];
    const preferred = sameGame.filter(version => sameMajor(version) && (!prerelease(version) || prerelease(context.currentVersion) || Boolean(minecraftVersion(groupId, artifactId, version))));
    const lines = new Set();
    const representatives = preferred.filter(version => { const line = version.split(".").slice(0, 2).join("."); if (lines.has(line)) return false; lines.add(line); return true; }).slice(0, 4);
    const candidates = [...new Set([...(options.version ? [options.version] : preferred.slice(0, 3)), ...(context.currentVersion && VERSION.test(context.currentVersion) ? [context.currentVersion] : []), ...(!options.version ? representatives : []), ...(!options.version ? published.slice(0, 2) : [])])].slice(0, 10);
    const reports = [];
    // Bound network fan-out; checks run independently of the version selector.
    for (let index = 0; index < candidates.length; index += 3) {
      reports.push(...await Promise.all(candidates.slice(index, index + 3).map(async version => {
        const info = await this.requirement(source, groupId, artifactId, version);
        const minecraft = minecraftVersion(groupId, artifactId, version);
        const reasons = [];
        if (info.requiredJava && context.javaTarget && info.requiredJava > context.javaTarget) reasons.push(`Benötigt Java ${info.requiredJava}; das Projekt erzeugt Java-${context.javaTarget}-Code.`);
        if (minecraft && context.minecraftTarget && !sameMinecraft(context.minecraftTarget, minecraft)) reasons.push(`Für Minecraft ${minecraft}; das Projekt verwendet Minecraft ${context.minecraftTarget}.`);
        const notes = [];
        if (!info.requiredJava) notes.push(info.evidence === "unavailable" ? "Die Paketquelle war bei der Metadatenprüfung nicht erreichbar." : "Die erforderliche Java-Version ist in den verfügbaren Metadaten nicht angegeben.");
        if (!sameMajor(version)) notes.push("Diese Version wechselt auf eine neue Hauptversion.");
        const family = /^(org\.jetbrains\.kotlin|org\.springframework\.boot|io\.netty|com\.fasterxml\.jackson\.core)$/.test(groupId);
        if (family && context.declared.some(entry => entry.groupId === groupId && entry.artifactId !== artifactId && entry.version && entry.version !== version)) notes.push("Weitere Bibliotheken dieser Familie sollten gemeinsam aktualisiert werden.");
        for (const constraint of info.constraints || []) {
          const existing = context.declared.find(entry => entry.groupId === constraint.group && entry.artifactId === constraint.module);
          const required = constraint.version?.strictly;
          if (existing && required && existing.version !== required) notes.push(`Weitere Bibliotheken müssen abgestimmt werden: ${constraint.group}:${constraint.module} benötigt ${required}; im Projekt steht ${existing.version}.`);
        }
        const status = reasons.length ? "incompatible" : info.requiredJava && context.javaTarget ? "compatible" : "unknown";
        return { version, status, reasons, notes, requiredJava: info.requiredJava, minecraftVersion: minecraft, evidence: info.evidence };
      })));
    }
    const recommended = preferred.map(version => reports.find(report => report.version === version)).find(report => report?.status === "compatible" && !report.notes.some(note => note.startsWith("Weitere Bibliotheken")))?.version || null;
    return { javaTarget: context.javaTarget, minecraftTarget: context.minecraftTarget, currentVersion: context.currentVersion, recommendedVersion: recommended, versions: reports, checkedAt: Date.now() };
  }
}
module.exports = { DependencyCompatibilityService, javaTarget, minecraftVersion, sameMinecraft };
