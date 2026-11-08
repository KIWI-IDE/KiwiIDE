import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const coreModule = await import("../scripts/update-core.mjs");
const projectRoot = path.resolve(import.meta.dirname, "..");
const serverJar = path.join(projectRoot, "resources", "update-server", "kiwi-update-server.jar");
const processes: ChildProcessWithoutNullStreams[] = [];
const temporaryDirectories: string[] = [];
const publishToken = "test-token-that-is-at-least-thirty-two-bytes-long";

function javaTool(name: string) {
  const javaHome = String(process.env.JAVA_HOME || "").trim();
  return javaHome ? path.join(javaHome, "bin", process.platform === "win32" ? `${name}.exe` : name) : name;
}

function cleanEnvironment(extra: Record<string, string> = {}) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => !name.startsWith("KIWI_UPDATE_") && value !== undefined)) as Record<string, string>;
  return { ...environment, ...extra };
}

beforeAll(() => {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-update-server.mjs")], {
    cwd: projectRoot,
    stdio: "pipe",
  });
});

afterEach(async () => {
  await Promise.all(processes.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timeout = setTimeout(resolve, 3_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill();
  })));
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function startServer(options: { tlsKeyStore?: string; publicProtocol?: "http" | "https" } = {}) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-java-update-server-"));
  temporaryDirectories.push(storageRoot);
  const protocol = options.publicProtocol || "http";
  const environment = cleanEnvironment({
    KIWI_UPDATE_HOST: "127.0.0.1",
    KIWI_UPDATE_PORT: "0",
    KIWI_UPDATE_STORAGE_DIR: storageRoot,
    KIWI_UPDATE_PUBLIC_BASE_URL: `${protocol}://updates.kiwi.test`,
    KIWI_UPDATE_PUBLISH_TOKEN: publishToken,
    KIWI_UPDATE_MAX_BYTES: String(1024 * 1024),
    ...(options.tlsKeyStore ? {
      KIWI_UPDATE_TLS_KEYSTORE: options.tlsKeyStore,
      KIWI_UPDATE_TLS_KEYSTORE_PASSWORD: "kiwi-test-password",
    } : { KIWI_UPDATE_ALLOW_HTTP: "1" }),
  });
  const child = spawn(javaTool("java"), ["-jar", serverJar], {
    cwd: projectRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  processes.push(child);
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Java-Update-Server wurde nicht bereit: ${output}\n${errors}`)), 15_000);
    const inspect = () => {
      const match = output.match(/KIWI_UPDATE_READY=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Java-Update-Server endete mit Code ${code}: ${errors}`));
    });
  });
  return { baseUrl: `${protocol}://127.0.0.1:${port}`, storageRoot, child };
}

async function publish(baseUrl: string, channel: "stable" | "beta", version: string, body: Buffer, token = publishToken) {
  return fetch(`${baseUrl}/v1/admin/releases/${channel}/${version}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(body.length),
      "X-Kiwi-Filename": `Kiwi-IDE-${version}-setup.exe`,
      "X-Kiwi-Sha256": crypto.createHash("sha256").update(body).digest("hex"),
    },
    body,
  });
}

async function publishPortable(baseUrl: string, channel: "stable" | "beta", version: string, body: Buffer, token = publishToken) {
  return fetch(`${baseUrl}/v1/admin/releases/${channel}/${version}/portable`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(body.length),
      "X-Kiwi-Filename": `Kiwi-IDE-${version}-portable.exe`,
      "X-Kiwi-Sha256": crypto.createHash("sha256").update(body).digest("hex"),
    },
    body,
  });
}

async function publishRenderer(baseUrl: string, channel: "stable" | "beta", version: string, body: Buffer, token = publishToken) {
  return fetch(`${baseUrl}/v1/admin/releases/${channel}/${version}/renderer`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(body.length),
      "X-Kiwi-Filename": `Kiwi-IDE-${version}-renderer.kiwi`,
      "X-Kiwi-Sha256": crypto.createHash("sha256").update(body).digest("hex"),
    },
    body,
  });
}

function httpsGetIgnoringTestCertificate(url: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
  });
}

describe("Java HTTPS update server", () => {
  it("requires TLS or an explicitly constrained loopback reverse proxy", async () => {
    const missingTls = spawnSync(javaTool("java"), ["-jar", serverJar], {
      cwd: projectRoot,
      env: cleanEnvironment({ KIWI_UPDATE_PUBLIC_BASE_URL: "https://updates.kiwi.test" }),
      encoding: "utf8",
      windowsHide: true,
    });
    expect(missingTls.status).toBe(1);
    expect(missingTls.stderr).toContain("HTTPS ist erforderlich");

    const unsafeProxy = spawnSync(javaTool("java"), ["-jar", serverJar], {
      cwd: projectRoot,
      env: cleanEnvironment({
        KIWI_UPDATE_PUBLIC_BASE_URL: "https://updates.kiwi.test",
        KIWI_UPDATE_BEHIND_HTTPS_PROXY: "1",
        KIWI_UPDATE_HOST: "0.0.0.0",
      }),
      encoding: "utf8",
      windowsHide: true,
    });
    expect(unsafeProxy.status).toBe(1);
    expect(unsafeProxy.stderr).toContain("Loopback");

    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-proxy-update-server-"));
    temporaryDirectories.push(storageRoot);
    const child = spawn(javaTool("java"), ["-jar", serverJar], {
      cwd: projectRoot,
      env: cleanEnvironment({
        KIWI_UPDATE_PUBLIC_BASE_URL: "https://updates.kiwi.test",
        KIWI_UPDATE_BEHIND_HTTPS_PROXY: "1",
        KIWI_UPDATE_HOST: "127.0.0.1",
        KIWI_UPDATE_PORT: "0",
        KIWI_UPDATE_STORAGE_DIR: storageRoot,
      }),
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    processes.push(child);
    const ready = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Reverse-Proxy-Modus startete nicht.")), 10_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("KIWI_UPDATE_READY=")) { clearTimeout(timeout); resolve(output); }
      });
    });
    expect(ready).toContain("Listener: http://127.0.0.1:");
  });

  it("starts a real TLS listener from a PKCS12 keystore", async () => {
    const certificateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-tls-"));
    temporaryDirectories.push(certificateRoot);
    const keyStore = path.join(certificateRoot, "server.p12");
    execFileSync(javaTool("keytool"), [
      "-genkeypair", "-alias", "kiwi-update", "-keyalg", "RSA", "-keysize", "2048",
      "-storetype", "PKCS12", "-keystore", keyStore,
      "-storepass", "kiwi-test-password", "-keypass", "kiwi-test-password",
      "-dname", "CN=127.0.0.1", "-validity", "1", "-ext", "SAN=ip:127.0.0.1",
    ], { stdio: "pipe" });
    const { baseUrl } = await startServer({ tlsKeyStore: keyStore, publicProtocol: "https" });
    const response = await httpsGetIgnoringTestCertificate(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: "ok", runtime: "java" });

    const installer = path.join(certificateRoot, "Kiwi-IDE-0.5.1-setup.exe");
    const portable = path.join(certificateRoot, "Kiwi-IDE-0.5.1-portable.exe");
    fs.writeFileSync(installer, "MZ publisher compatibility fixture");
    fs.writeFileSync(portable, "MZ portable publisher compatibility fixture");
    execFileSync(process.execPath, [
      path.join(projectRoot, "scripts", "publish-update.mjs"),
      "--server", baseUrl,
      "--version", "0.5.1",
      "--channel", "stable",
      "--artifact", installer,
      "--portable", portable,
    ], {
      cwd: projectRoot,
      env: cleanEnvironment({
        KIWI_UPDATE_PUBLISH_TOKEN: publishToken,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      }),
      stdio: "pipe",
    });
    const manifest = await httpsGetIgnoringTestCertificate(`${baseUrl}/v1/updates/stable/latest.json`);
    expect(manifest.status).toBe(200);
    expect(JSON.parse(manifest.body)).toMatchObject({
      schemaVersion: 3,
      version: "0.5.1",
      channel: "stable",
      artifacts: {
        setup: { filename: "Kiwi-IDE-0.5.1-setup.exe" },
        portable: { filename: "Kiwi-IDE-0.5.1-portable.exe" },
      },
    });

    const setupOnly = path.join(certificateRoot, "Kiwi-IDE-0.5.2-setup.exe");
    fs.writeFileSync(setupOnly, "MZ explicitly allowed setup-only fixture");
    const refusedSetupOnly = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "publish-update.mjs"),
      "--server", baseUrl,
      "--version", "0.5.2",
      "--channel", "stable",
      "--artifact", setupOnly,
    ], {
      cwd: projectRoot,
      env: cleanEnvironment({ KIWI_UPDATE_PUBLISH_TOKEN: publishToken }),
      encoding: "utf8",
    });
    expect(refusedSetupOnly.status).toBe(1);
    expect(refusedSetupOnly.stderr).toContain("Setup-only");
    execFileSync(process.execPath, [
      path.join(projectRoot, "scripts", "publish-update.mjs"),
      "--server", baseUrl,
      "--version", "0.5.2",
      "--channel", "stable",
      "--artifact", setupOnly,
      "--allow-setup-only",
    ], {
      cwd: projectRoot,
      env: cleanEnvironment({
        KIWI_UPDATE_PUBLISH_TOKEN: publishToken,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      }),
      stdio: "pipe",
    });
    const setupOnlyManifest = await httpsGetIgnoringTestCertificate(`${baseUrl}/v1/updates/stable/latest.json`);
    const setupOnlyJson = JSON.parse(setupOnlyManifest.body);
    expect(setupOnlyJson).toMatchObject({
      schemaVersion: 3,
      version: "0.5.2",
      artifacts: { setup: { filename: "Kiwi-IDE-0.5.2-setup.exe" } },
    });
    expect(setupOnlyJson.artifacts.portable).toBeUndefined();
  });

  it("publishes a renderer bundle and takes its main-process hash from the file", async () => {
    const { createRendererBundle } = await import("../electron/services/renderer-update-service.cjs") as any;
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-renderer-publish-"));
    temporaryDirectories.push(source);
    fs.writeFileSync(path.join(source, "index.html"), "<!doctype html><title>hot</title>");
    const mainHash = "c".repeat(64);
    const bundle: Buffer = await createRendererBundle(source, { version: "0.6.0", mainHash });

    const { baseUrl } = await startServer();
    const staged = await publishRenderer(baseUrl, "stable", "0.6.0", bundle);
    expect(staged.status).toBe(201);
    expect(await staged.json()).toMatchObject({
      staged: true,
      artifact: { filename: "Kiwi-IDE-0.6.0-renderer.kiwi", bytes: bundle.length, mainHash },
    });
    // Staging alone must not activate anything: only the setup upload does.
    expect((await fetch(`${baseUrl}/v1/updates/stable/latest.json`)).status).toBe(404);

    const installer = Buffer.from("MZ kiwi signed setup fixture 0.6.0");
    const published = await (await publish(baseUrl, "stable", "0.6.0", installer)).json() as any;
    expect(published.artifacts.renderer).toMatchObject({
      filename: "Kiwi-IDE-0.6.0-renderer.kiwi",
      bytes: bundle.length,
      // The fingerprint comes out of the uploaded bundle, never from a header,
      // so a client can trust it when deciding to skip the installer.
      mainHash,
    });
    expect(published.artifacts.renderer.url)
      .toBe("http://updates.kiwi.test/v1/releases/stable/0.6.0/Kiwi-IDE-0.6.0-renderer.kiwi");

    const download = await fetch(`${baseUrl}/v1/releases/stable/0.6.0/Kiwi-IDE-0.6.0-renderer.kiwi`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bundle);

    // Anything that is not a Kiwi bundle is rejected and leaves nothing behind.
    const junk = await publishRenderer(baseUrl, "beta", "0.7.0-beta.1", Buffer.from("not a bundle at all"));
    expect(junk.status).toBe(400);
    const betaInstaller = Buffer.from("MZ kiwi beta setup fixture");
    const beta = await (await publish(baseUrl, "beta", "0.7.0-beta.1", betaInstaller)).json() as any;
    expect(beta.artifacts.renderer).toBeUndefined();
  });

  it("lets a client pick, download and apply the renderer package end to end", async () => {
    const {
      applyRendererUpdate,
      createRendererBundle,
      readCurrentRenderer,
    } = await import("../electron/services/renderer-update-service.cjs") as any;
    const { UpdateService } = await import("../electron/services/update-service.cjs") as any;

    // Kiwi refuses a plain-HTTP update source, so publisher, server and client
    // are exercised over the server's real TLS listener.
    const certificateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-renderer-tls-"));
    temporaryDirectories.push(certificateRoot);
    const keyStore = path.join(certificateRoot, "server.p12");
    execFileSync(javaTool("keytool"), [
      "-genkeypair", "-alias", "kiwi-update", "-keyalg", "RSA", "-keysize", "2048",
      "-storetype", "PKCS12", "-keystore", keyStore,
      "-storepass", "kiwi-test-password", "-keypass", "kiwi-test-password",
      "-dname", "CN=127.0.0.1", "-validity", "1", "-ext", "SAN=ip:127.0.0.1",
    ], { stdio: "pipe" });
    const { baseUrl } = await startServer({ tlsKeyStore: keyStore, publicProtocol: "https" });

    const source = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-renderer-e2e-"));
    temporaryDirectories.push(source);
    fs.writeFileSync(path.join(source, "index.html"), "<!doctype html><title>from the server</title>");
    const mainHash = "a".repeat(64);
    const bundleFile = path.join(certificateRoot, "Kiwi-IDE-0.8.0-renderer.kiwi");
    fs.writeFileSync(bundleFile, await createRendererBundle(source, { version: "0.8.0", mainHash }));
    const installerFile = path.join(certificateRoot, "Kiwi-IDE-0.8.0-setup.exe");
    fs.writeFileSync(installerFile, "MZ kiwi setup fixture 0.8.0");

    // The real publisher, so the fingerprint in the manifest is the one it
    // reads out of the bundle rather than one this test made up.
    execFileSync(process.execPath, [
      path.join(projectRoot, "scripts", "publish-update.mjs"),
      "--server", baseUrl,
      "--version", "0.8.0",
      "--channel", "stable",
      "--artifact", installerFile,
      "--renderer", bundleFile,
      "--allow-setup-only",
    ], {
      cwd: projectRoot,
      env: cleanEnvironment({ KIWI_UPDATE_PUBLISH_TOKEN: publishToken, NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
      stdio: "pipe",
    });
    const manifest = await httpsGetIgnoringTestCertificate(`${baseUrl}/v1/updates/stable/latest.json`);
    expect(JSON.parse(manifest.body).artifacts.renderer).toMatchObject({
      filename: "Kiwi-IDE-0.8.0-renderer.kiwi",
      mainHash,
    });

    const host = new URL(baseUrl).host;
    const settings = { get: () => ({ updateManifestUrl: `${baseUrl}/v1/updates/stable/latest.json`, updateChannel: "stable" }) };
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-renderer-client-"));
    temporaryDirectories.push(userData);
    // The published URLs point at the public name; a reverse proxy would do
    // this rewrite. The self-signed listener is only trusted for these calls.
    const viaTestListener = async (url: URL | string, init?: RequestInit) =>
      fetch(new URL(String(url).replace("updates.kiwi.test", host)), init);
    const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      const service = new UpdateService(settings, "0.7.0", userData, viaTestListener, { mainHash });
      const available = await service.check();
      expect(available).toMatchObject({
        available: true,
        version: "0.8.0",
        artifactKind: "renderer",
        filename: "Kiwi-IDE-0.8.0-renderer.kiwi",
        mainHash,
      });

      const downloaded = await service.download(available);
      expect(downloaded.artifactKind).toBe("renderer");
      expect(fs.readFileSync(downloaded.path)).toEqual(fs.readFileSync(bundleFile));

      const applied = await applyRendererUpdate({
        bundlePath: downloaded.path,
        userDataPath: userData,
        mainHash,
        version: downloaded.version,
      });
      expect(applied.version).toBe("0.8.0");
      expect(readCurrentRenderer(userData)?.version).toBe("0.8.0");
      expect(fs.readFileSync(path.join(applied.directory, "index.html"), "utf8")).toContain("from the server");

      // A Kiwi whose main process does not match that release takes the
      // installer instead — same server, same manifest, different decision.
      const otherService = new UpdateService(settings, "0.7.0", userData, viaTestListener, { mainHash: "b".repeat(64) });
      expect(await otherService.check()).toMatchObject({
        available: true,
        artifactKind: "setup",
        filename: "Kiwi-IDE-0.8.0-setup.exe",
      });
    } finally {
      if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
    }
  });

  it("publishes immutable stable and beta releases with manifests, HEAD, ETag and ranges", async () => {
    const { baseUrl } = await startServer();
    const installer = Buffer.from("MZ kiwi signed setup fixture");
    const portable = Buffer.from("MZ kiwi signed portable fixture");
    const portableResponse = await publishPortable(baseUrl, "stable", "0.5.0", portable);
    expect(portableResponse.status).toBe(201);
    expect(await portableResponse.json()).toMatchObject({
      staged: true,
      artifact: { filename: "Kiwi-IDE-0.5.0-portable.exe", bytes: portable.length },
    });
    // A failed setup activation can be retried without deleting or replacing
    // the already verified portable stage.
    expect((await publishPortable(baseUrl, "stable", "0.5.0", portable)).status).toBe(201);
    expect((await publishPortable(baseUrl, "stable", "0.5.0", Buffer.from("different portable"))).status).toBe(409);
    expect((await fetch(`${baseUrl}/v1/updates/stable/latest.json`)).status).toBe(404);
    expect(await (await fetch(`${baseUrl}/v1/releases/stable`)).json()).toMatchObject({ versions: [] });
    const response = await publish(baseUrl, "stable", "0.5.0", installer);
    expect(response.status).toBe(201);
    const published = await response.json() as any;
    expect(published).toMatchObject({
      schemaVersion: 3,
      channel: "stable",
      version: "0.5.0",
      bytes: installer.length,
      artifacts: {
        setup: { filename: "Kiwi-IDE-0.5.0-setup.exe", bytes: installer.length },
        portable: { filename: "Kiwi-IDE-0.5.0-portable.exe", bytes: portable.length },
      },
    });
    expect(published.url).toBe("http://updates.kiwi.test/v1/releases/stable/0.5.0/Kiwi-IDE-0.5.0-setup.exe");
    expect(published.artifacts.setup.url).toBe(published.url);
    expect(published.artifacts.portable.url).toBe("http://updates.kiwi.test/v1/releases/stable/0.5.0/Kiwi-IDE-0.5.0-portable.exe");

    const manifestResponse = await fetch(`${baseUrl}/v1/updates/stable/latest.json`);
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get("cache-control")).toContain("no-store");
    expect(await manifestResponse.json()).toMatchObject({ version: "0.5.0", sha256: published.sha256 });

    const headResponse = await fetch(`${baseUrl}/v1/releases/stable/0.5.0/Kiwi-IDE-0.5.0-setup.exe`, { method: "HEAD" });
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("content-length")).toBe(String(installer.length));
    expect(headResponse.headers.get("etag")).toBeTruthy();
    const cached = await fetch(`${baseUrl}/v1/releases/stable/0.5.0/Kiwi-IDE-0.5.0-setup.exe`, {
      headers: { "If-None-Match": headResponse.headers.get("etag")! },
    });
    expect(cached.status).toBe(304);

    const artifactResponse = await fetch(`${baseUrl}/v1/releases/stable/0.5.0/Kiwi-IDE-0.5.0-setup.exe`, { headers: { Range: "bytes=3-6" } });
    expect(artifactResponse.status).toBe(206);
    expect(artifactResponse.headers.get("content-range")).toBe(`bytes 3-6/${installer.length}`);
    expect(Buffer.from(await artifactResponse.arrayBuffer())).toEqual(installer.subarray(3, 7));

    const portableHead = await fetch(published.artifacts.portable.url.replace("updates.kiwi.test", new URL(baseUrl).host), { method: "HEAD" });
    expect(portableHead.status).toBe(200);
    expect(portableHead.headers.get("content-length")).toBe(String(portable.length));
    const portableRange = await fetch(`${baseUrl}/v1/releases/stable/0.5.0/Kiwi-IDE-0.5.0-portable.exe`, { headers: { Range: "bytes=3-7" } });
    expect(portableRange.status).toBe(206);
    expect(Buffer.from(await portableRange.arrayBuffer())).toEqual(portable.subarray(3, 8));

    expect((await publish(baseUrl, "stable", "0.5.0", installer)).status).toBe(409);
    expect((await publish(baseUrl, "stable", "0.4.9", installer)).status).toBe(409);
    expect((await publish(baseUrl, "stable", "0.6.0-beta.1", installer)).status).toBe(400);
    expect((await publish(baseUrl, "beta", "0.6.0-beta.1", installer)).status).toBe(201);
    expect(await (await fetch(`${baseUrl}/v1/releases/beta`)).json()).toMatchObject({ channel: "beta", versions: ["0.6.0-beta.1"] });
  });

  it("rejects unauthenticated, corrupted, concurrent and unsafe publishing input", async () => {
    const { baseUrl } = await startServer();
    const installer = Buffer.from("MZ fixture");
    expect((await publish(baseUrl, "stable", "1.0.0", installer, "wrong-token-that-is-also-at-least-thirty-two-bytes")).status).toBe(403);

    const corrupted = await fetch(`${baseUrl}/v1/admin/releases/stable/1.0.0`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${publishToken}`,
        "Content-Length": String(installer.length),
        "X-Kiwi-Filename": "Kiwi-IDE-1.0.0-setup.exe",
        "X-Kiwi-Sha256": "0".repeat(64),
      },
      body: installer,
    });
    expect(corrupted.status).toBe(400);

    const concurrent = await Promise.all([
      publish(baseUrl, "stable", "1.0.1", installer),
      publish(baseUrl, "stable", "1.0.1", installer),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    const setupOnly = await (await fetch(`${baseUrl}/v1/updates/stable/latest.json`)).json() as any;
    expect(setupOnly).toMatchObject({
      schemaVersion: 3,
      url: expect.stringMatching(/-setup\.exe$/),
      artifacts: { setup: { filename: "Kiwi-IDE-1.0.1-setup.exe" } },
    });
    expect(setupOnly.artifacts.portable).toBeUndefined();

    const wrongPortableName = await fetch(`${baseUrl}/v1/admin/releases/stable/1.0.2/portable`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${publishToken}`,
        "Content-Length": String(installer.length),
        "X-Kiwi-Filename": "Kiwi-IDE-1.0.2-setup.exe",
        "X-Kiwi-Sha256": crypto.createHash("sha256").update(installer).digest("hex"),
      },
      body: installer,
    });
    expect(wrongPortableName.status).toBe(400);

    const traversal = await fetch(`${baseUrl}/v1/releases/stable/1.0.1/%2e%2e%2foutside.exe`);
    expect([400, 404]).toContain(traversal.status);
    expect(() => coreModule.safeResolve("C:\\updates", "..", "outside.exe")).toThrow(/außerhalb/);
    expect(() => coreModule.createManifest({
      channel: "stable",
      version: "1.0.0-beta.1",
      filename: "Kiwi-IDE-1.0.0-beta.1-setup.exe",
      sha256: "a".repeat(64),
      bytes: 1,
      publicBaseUrl: "https://updates.kiwi.test",
    })).toThrow(/Stable/);

    const schema3 = coreModule.createManifest({
      channel: "beta",
      version: "1.0.0-beta.1",
      filename: "Kiwi-IDE-1.0.0-beta.1-setup.exe",
      sha256: "a".repeat(64),
      bytes: 10,
      portable: {
        filename: "Kiwi-IDE-1.0.0-beta.1-portable.exe",
        sha256: "b".repeat(64),
        bytes: 11,
      },
      publicBaseUrl: "https://updates.kiwi.test",
    });
    expect(schema3).toMatchObject({
      schemaVersion: 3,
      url: schema3.artifacts.setup.url,
      sha256: schema3.artifacts.setup.sha256,
      bytes: schema3.artifacts.setup.bytes,
      artifacts: {
        setup: { filename: "Kiwi-IDE-1.0.0-beta.1-setup.exe", bytes: 10 },
        portable: { filename: "Kiwi-IDE-1.0.0-beta.1-portable.exe", bytes: 11 },
      },
    });
    expect(() => coreModule.createManifest({
      channel: "beta",
      version: "1.0.0-beta.1",
      filename: "Kiwi-IDE-1.0.0-beta.1-setup.exe",
      sha256: "a".repeat(64),
      bytes: 10,
      portable: { filename: "other.exe", sha256: "b".repeat(64), bytes: 11 },
      publicBaseUrl: "https://updates.kiwi.test",
    })).toThrow(/Portable/);
  });

  it("refuses manifests reached through a storage symlink or junction", async () => {
    const { baseUrl, storageRoot } = await startServer();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-outside-"));
    temporaryDirectories.push(outside);
    fs.writeFileSync(path.join(outside, "latest.json"), "{\"version\":\"99.0.0\"}\n");
    fs.mkdirSync(path.join(storageRoot, "channels"), { recursive: true });
    fs.symlinkSync(outside, path.join(storageRoot, "channels", "stable"), process.platform === "win32" ? "junction" : "dir");
    const response = await fetch(`${baseUrl}/v1/updates/stable/latest.json`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Symlink/) });
  });
});
