import { describe, expect, it, vi } from "vitest";
const { DependencySources, metadata } = require("../electron/services/dependency-sources.cjs");
const { mavenSearchQuery } = require("../electron/services/dependency-service.cjs");
const response = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const missing = () => response("", 404);
const versions = (values: string[]) => `<metadata><versioning><versions>${values.map(value => `<version>${value}</version>`).join("")}</versions></versioning></metadata>`;
const docs = (...rows: any[]) => response({ response: { docs: rows } });

describe("dependency package sources", () => {
  it("finds Paper while Central is unavailable and loads its own version list", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.host.includes("papermc")) return response(versions(["1.21.8-R0.1-SNAPSHOT", "1.21.9-R0.1-SNAPSHOT"]));
      if (url.host === "dl.google.com") return response("<metadata/>");
      throw new Error("unavailable");
    });
    const client = new DependencySources(fetcher, mavenSearchQuery);
    const found = await client.search("paper");
    expect(found).toMatchObject([{ groupId: "io.papermc.paper", artifactId: "paper-api", version: "1.21.9-R0.1-SNAPSHOT", sourceId: "papermc" }]);
    expect(await client.versions("io.papermc.paper", "paper-api")).toEqual(["1.21.9-R0.1-SNAPSHOT", "1.21.8-R0.1-SNAPSHOT"]);
    expect(fetcher.mock.calls.filter(([url]) => url.host.includes("papermc"))).toHaveLength(1);
  });

  it("uses Google's group index and prefers a stable version", async () => {
    const client = new DependencySources(async (url: URL) => {
      if (url.pathname.endsWith("master-index.xml")) return response('<metadata><androidx.core/><androidx.appcompat/></metadata>');
      if (url.pathname.endsWith("group-index.xml")) return response('<androidx.core><core versions="1.9.0,1.10.0,1.11.0-alpha01"/></androidx.core>');
      return missing();
    }, mavenSearchQuery);
    const found = await client.search("core", 25, "google");
    expect(found).toMatchObject([{ groupId: "androidx.core", artifactId: "core", version: "1.10.0", sourceId: "google" }]);
    expect(await client.search("androidx.core core", 25, "google")).toMatchObject([{ artifactId: "core" }]);
  });

  it("supports JitPack coordinate lookups without inventing a global search", async () => {
    const fetcher = vi.fn(async (url: URL) => url.host === "jitpack.io" ? response(versions(["v1.0.0", "v1.1.0"])) : missing());
    const client = new DependencySources(fetcher, mavenSearchQuery);
    expect(await client.search("Chart", 25, "jitpack")).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.search("com.github.Owner:Chart", 25, "jitpack")).toMatchObject([{ version: "v1.1.0", sourceId: "jitpack" }]);
    expect(await client.versions("com.github.Owner", "Chart", 40, "jitpack")).toEqual(["v1.1.0", "v1.0.0"]);
  });

  it("falls back to Sonatype search and merges duplicate artifacts", async () => {
    const client = new DependencySources(async (url: URL) => {
      if (url.host === "search.maven.org") throw new Error("index offline");
      if (url.host === "central.sonatype.com") return docs({ g: "net.fabricmc", a: "fabric-loader", latestVersion: "1.0.0" });
      if (url.host === "maven.fabricmc.net") return response(versions(["1.0.0"]));
      if (url.host === "dl.google.com") return response("<metadata/>");
      return missing();
    }, mavenSearchQuery);
    const rows = await client.search("fabric-loader");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ artifactId: "fabric-loader", sourceId: "central" });
  });

  it("continues on one failed source and distinguishes no matches from an outage", async () => {
    const client = new DependencySources(async (url: URL) => {
      if (url.host === "dl.google.com") throw new Error("google offline");
      return docs();
    }, mavenSearchQuery);
    expect(await client.search("no-match")).toEqual([]);
    const offline = new DependencySources(async () => { throw new Error("offline"); }, mavenSearchQuery);
    await expect(offline.search("no-match")).rejects.toThrow(/nicht erreichbar/);
  });

  it("coalesces repeated requests and confines user input to fixed HTTPS endpoints", async () => {
    const fetcher = vi.fn(async (url: URL) => url.pathname === "/solrsearch/select" ? docs({ g: "com.example", a: "library", latestVersion: "1.0.0" }, { g: "../bad", a: "bad", latestVersion: "1" }) : response("<metadata/>"));
    const client = new DependencySources(fetcher, mavenSearchQuery);
    await Promise.all([client.search("library"), client.search("library")]);
    expect(fetcher.mock.calls.filter(([url]) => url.pathname === "/solrsearch/select")).toHaveLength(1);
    const rows = await client.search("https://evil.example/../../password");
    expect(rows).toHaveLength(1);
    for (const [url] of fetcher.mock.calls) {
      expect(url.protocol).toBe("https:");
      expect(["search.maven.org", "dl.google.com"]).toContain(url.host);
    }
    await expect(client.search("library", 25, "https://evil.example")).rejects.toThrow(/Unbekannte/);
  });

  it("falls back to Central metadata for version queries and orders numeric releases", async () => {
    const client = new DependencySources(async (url: URL) => url.host === "repo.maven.apache.org" ? response(versions(["1.9", "1.10"])) : docs(), mavenSearchQuery);
    expect(await client.versions("com.example", "library")).toEqual(["1.10", "1.9"]);
    expect(metadata(versions(["1.0", "2.0-beta1"])).latest).toBe("1.0");
    expect(() => metadata("<html>login page</html>")).toThrow(/Metadaten/);
  });

  it("bounds a hung source and aborts its request", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const client = new DependencySources((_url: URL, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        return new Promise(() => undefined);
      }, mavenSearchQuery);
      const result = expect(client.search("library", 25, "central")).rejects.toThrow(/nicht erreichbar/);
      await vi.advanceTimersByTimeAsync(4100);
      await result;
      expect(signals).toHaveLength(2);
      expect(signals.every(signal => signal.aborted)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
