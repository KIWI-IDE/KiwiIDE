const { XMLParser } = require("fast-xml-parser");
const repositories = require("./dependency-repositories.json");
const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });
const PART = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const VERSION = /^[A-Za-z0-9._+-]+$/;
const CENTRAL_SEARCH = ["https://search.maven.org", "https://central.sonatype.com"];

function repositoryById(id) {
  const source = repositories.find(entry => entry.id === id);
  if (!source) throw new Error("Unbekannte Dependency-Quelle.");
  return source;
}

function coordinateQuery(query) {
  const match = String(query || "").trim().match(/^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)(?::([A-Za-z0-9._+-]+))?$/);
  return match && PART.test(match[1]) && PART.test(match[2])
    ? { groupId: match[1], artifactId: match[2], version: match[3] || "" } : null;
}

function sourceForGroup(groupId) {
  // GitHub-style group IDs also exist on Central. JitPack must be selected
  // explicitly or confirmed by a lookup before adding its repository.
  return repositories.find(source => source.id !== "jitpack" && source.groups.some(prefix => groupId === prefix || groupId.startsWith(prefix.endsWith(".") ? prefix : `${prefix}.`)));
}

function orderedVersions(values) {
  return [...new Set(values.map(String).filter(value => VERSION.test(value)))].sort((a, b) =>
    b.localeCompare(a, "en", { numeric: true, sensitivity: "base" }));
}

function metadata(text) {
  if (!/<metadata(?:\s|>)/.test(text)) throw new Error("Die Quelle hat keine Maven-Metadaten geliefert.");
  const data = xml.parse(text)?.metadata;
  const versioning = data?.versioning;
  if (!versioning) throw new Error("Ungültige Maven-Metadaten.");
  const values = versioning.versions?.version;
  const versions = orderedVersions([...(Array.isArray(values) ? values : values ? [values] : []), versioning.release || "", versioning.latest || ""]);
  const stable = versions.filter(value => !/(?:snapshot|alpha|beta|preview|dev|nightly|(?:^|[.\-])(?:rc|m)\d*)/i.test(value));
  const release = String(versioning.release || "");
  return { versions, latest: stable.includes(release) ? release : stable[0] || versions[0] || "" };
}

class DependencySources {
  constructor(fetchImpl, queryBuilder) {
    this.fetch = fetchImpl;
    this.queryBuilder = queryBuilder;
    this.cache = new Map();
    this.artifactSources = new Map();
  }

  cached(key, work) {
    const previous = this.cache.get(key);
    if (previous && previous.expires > Date.now()) return previous.value;
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value);
    const entry = { expires: Date.now() + 300_000 };
    entry.value = Promise.resolve().then(work).catch(error => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, entry);
    return entry.value;
  }

  async request(url, format = "text") {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Zeitüberschreitung bei der Paketquelle.")); }, 2000);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetch(url, { signal: controller.signal, headers: { accept: format === "json" ? "application/json" : "application/xml, text/xml" } });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Paketquelle antwortete mit ${response.status}.`);
        if (format === "json") return response.json();
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error("Antwort der Paketquelle ist zu groß.");
        return text;
      })()]);
    } finally { clearTimeout(timer); }
  }

  async central(query, limit, versions = false) {
    let failure;
    for (const host of CENTRAL_SEARCH) {
      const url = new URL("/solrsearch/select", host);
      url.searchParams.set("q", this.queryBuilder(query));
      if (versions || coordinateQuery(query)?.version) url.searchParams.set("core", "gav");
      url.searchParams.set("rows", String(limit));
      url.searchParams.set("wt", "json");
      try {
        const data = await this.request(url, "json");
        if (!Array.isArray(data?.response?.docs)) throw new Error("Ungültige Antwort von Maven Central.");
        return data.response.docs;
      } catch (error) { failure = error; }
    }
    throw failure;
  }

  async artifact(source, groupId, artifactId) {
    if (!PART.test(groupId) || !PART.test(artifactId)) throw new Error("Ungültige Dependency-Koordinate.");
    return this.cached(`metadata:${source.id}:${groupId}:${artifactId}`, async () => {
      const url = new URL(`${groupId.replaceAll(".", "/")}/${artifactId}/maven-metadata.xml`, source.url);
      const body = await this.request(url);
      return body === null ? { versions: [], latest: "" } : metadata(body);
    });
  }

  candidate(source, groupId, artifactId, version, extra = {}) {
    return { groupId, artifactId, version, packaging: "jar", updatedAt: 0, sourceId: source.id, sourceLabel: source.label, repositoryUrl: source.url, ...extra };
  }

  async google(query, limit) {
    const source = repositoryById("google");
    const exact = coordinateQuery(query);
    if (exact) return this.fromMetadata(source, exact);
    const index = await this.cached("google:groups", async () => {
      const body = await this.request(new URL("master-index.xml", source.url));
      if (!body || !/<metadata(?:\s|>)/.test(body)) throw new Error("Google Maven ist nicht erreichbar.");
      return Object.keys(xml.parse(body)?.metadata || {}).filter(group => PART.test(group));
    });
    const terms = query.toLowerCase().split(/[\s:]+/).filter(Boolean);
    const exactGroup = terms.find(term => index.some(group => group.toLowerCase() === term));
    const matchingGroups = exactGroup ? index.filter(group => group.toLowerCase() === exactGroup)
      : index.filter(group => terms.every(term => group.toLowerCase().includes(term)));
    const groups = (matchingGroups.length ? matchingGroups : index.filter(group => terms.length > 1 && group.toLowerCase().includes(terms[0])))
      .sort((a, b) => a.length - b.length).slice(0, 8);
    const answers = await Promise.allSettled(groups.map(async group => {
      const body = await this.cached(`google:${group}`, () => this.request(new URL(`${group.replaceAll(".", "/")}/group-index.xml`, source.url)));
      const entries = body && xml.parse(body)?.[group];
      return Object.entries(entries || {}).filter(([artifact]) => PART.test(artifact) && terms.every(term => `${group} ${artifact}`.toLowerCase().includes(term))).flatMap(([artifact, data]) => {
        const versions = orderedVersions(String(data?.["@_versions"] || "").split(","));
        const stable = versions.find(version => !/(?:alpha|beta|snapshot|rc\d|dev)/i.test(version)) || versions[0];
        return stable ? [this.candidate(source, group, artifact, stable)] : [];
      });
    }));
    if (answers.length && answers.every(answer => answer.status === "rejected")) throw answers[0].reason;
    return answers.flatMap(answer => answer.status === "fulfilled" ? answer.value : []).slice(0, limit);
  }

  async fromMetadata(source, coordinate) {
    const data = await this.artifact(source, coordinate.groupId, coordinate.artifactId);
    const version = coordinate.version || data.latest;
    if (!version || (coordinate.version && !data.versions.includes(version))) return [];
    return [this.candidate(source, coordinate.groupId, coordinate.artifactId, version)];
  }

  async supplement(source, query) {
    const exact = coordinateQuery(query);
    if (exact) {
      if (!source.groups.some(prefix => exact.groupId === prefix || exact.groupId.startsWith(prefix.endsWith(".") ? prefix : `${prefix}.`))) return [];
      return this.fromMetadata(source, exact);
    }
    const terms = query.toLowerCase().split(/[\s:]+/).filter(Boolean);
    const seeds = source.artifacts.filter(([group, artifact, aliases]) => terms.every(term => `${group} ${artifact} ${aliases}`.toLowerCase().includes(term))).slice(0, 6);
    const answers = await Promise.allSettled(seeds.map(([groupId, artifactId]) => this.fromMetadata(source, { groupId, artifactId })));
    if (answers.length && answers.every(answer => answer.status === "rejected")) throw answers[0].reason;
    return answers.flatMap(answer => answer.status === "fulfilled" ? answer.value : []);
  }

  async search(query, limit = 25, sourceId = "") {
    query = String(query || "").trim().slice(0, 250);
    if (!query) return [];
    if (sourceId) repositoryById(sourceId);
    limit = Math.min(50, Math.max(1, Number(limit) || 25));
    return this.cached(`search:${query}:${limit}:${sourceId}`, async () => {
      const exactQuery = coordinateQuery(query);
      const sources = repositories.filter(source => !sourceId || source.id === sourceId).filter(source => {
        if (source.id === "central") return true;
        if (exactQuery) return source.groups.some(prefix => exactQuery.groupId === prefix || exactQuery.groupId.startsWith(prefix.endsWith(".") ? prefix : `${prefix}.`));
        if (source.id === "google") return true;
        const terms = query.toLowerCase().split(/[\s:]+/).filter(Boolean);
        return source.artifacts.some(([group, artifact, aliases]) => terms.every(term => `${group} ${artifact} ${aliases}`.toLowerCase().includes(term)));
      });
      const tasks = sources.map(async source => {
        if (source.id === "central") {
          let docs;
          try { docs = await this.central(query, limit); }
          catch (error) {
            if (exactQuery) return this.fromMetadata(source, exactQuery);
            throw error;
          }
          return docs.filter(doc => PART.test(doc.g || "") && PART.test(doc.a || "") && VERSION.test(doc.latestVersion || doc.v || ""))
            .map(doc => this.candidate(source, doc.g, doc.a, doc.latestVersion || doc.v, { packaging: String(doc.p || "jar"), updatedAt: Number(doc.timestamp) || 0 }));
        }
        return source.id === "google" ? this.google(query, limit) : this.supplement(source, query);
      });
      const answers = await Promise.allSettled(tasks);
      const rows = answers.flatMap(answer => answer.status === "fulfilled" ? answer.value : []);
      // Empty, inapplicable providers do not hide a complete network outage.
      if (!rows.length && answers.length && answers.every(answer => answer.status === "rejected")) {
        throw new Error("Die passenden Paketquellen sind nicht erreichbar. Bitte prüfe die Verbindung oder füge eine vollständige Koordinate ein.");
      }
      const exact = coordinateQuery(query);
      const score = row => row.artifactId.toLowerCase() === query.toLowerCase() ? 3 : exact && row.groupId === exact.groupId && row.artifactId === exact.artifactId ? 4 : row.artifactId.toLowerCase().startsWith(query.toLowerCase()) ? 2 : 0;
      const unique = new Map();
      for (const row of rows) {
        const key = `${row.groupId}:${row.artifactId}`;
        if (!unique.has(key)) unique.set(key, row);
      }
      const result = [...unique.values()].sort((a, b) => score(b) - score(a)).slice(0, limit);
      for (const row of result) {
        if (this.artifactSources.size >= 500) this.artifactSources.delete(this.artifactSources.keys().next().value);
        this.artifactSources.set(`${row.groupId}:${row.artifactId}`, row.sourceId);
      }
      return result;
    });
  }

  async versions(groupId, artifactId, limit = 40, sourceId = "") {
    if (!PART.test(groupId) || !PART.test(artifactId)) throw new Error("Ungültige Dependency-Koordinate.");
    limit = Math.min(100, Math.max(1, Number(limit) || 40));
    const remembered = this.artifactSources.get(`${groupId}:${artifactId}`);
    const source = repositoryById(sourceId || remembered || sourceForGroup(groupId)?.id || "central");
    return this.cached(`versions:${source.id}:${groupId}:${artifactId}:${limit}`, async () => {
      if (source.id !== "central") return (await this.artifact(source, groupId, artifactId)).versions.slice(0, limit);
      try {
        const rows = await this.central(`${groupId}:${artifactId}`, limit, true);
        const versions = orderedVersions(rows.map(row => row.v || ""));
        if (versions.length) return versions.slice(0, limit);
      } catch { /* Direct metadata also works while the search index is down. */ }
      const direct = (await this.artifact(source, groupId, artifactId)).versions;
      if (!direct.length && groupId.startsWith("com.github.")) return (await this.artifact(repositoryById("jitpack"), groupId, artifactId)).versions.slice(0, limit);
      return direct.slice(0, limit);
    });
  }
}

module.exports = { DependencySources, repositoryById, sourceForGroup, coordinateQuery, metadata, orderedVersions };
