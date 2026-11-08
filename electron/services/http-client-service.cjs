/**
 * Sends the requests a `.http` file describes.
 *
 * Runs in the main process rather than the renderer so a request is not bound
 * by the window's content security policy, and so redirects, timeouts and
 * response sizes can be handled deliberately.
 */

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Headers whose value must never be shown or logged in full. */
const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"]);

/**
 * Masks credentials in a header list.
 *
 * A response is written into the tool window and may end up in a screenshot or
 * a bug report; a bearer token has no business travelling that far.
 */
function redactHeaders(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({
    name,
    value: SECRET_HEADERS.has(String(name).toLowerCase())
      ? `${String(value).slice(0, 4)}… (verborgen)`
      : String(value),
  }));
}

/** Pretty-prints JSON so a response is readable without another tool. */
function formatBody(body, contentType) {
  if (!/json/i.test(String(contentType || ""))) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

class HttpClientService {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
    this.inFlight = new Map();
  }

  /**
   * Performs one request and describes what came back.
   *
   * Never throws for an HTTP status: a 500 is a result worth reading, not an
   * error in the tooling. Only a request that could not be made at all fails.
   */
  async send(request, options = {}) {
    const method = String(request?.method || "GET").toUpperCase();
    const url = String(request?.url || "");
    // The renderer validated the scheme too; doing it here as well keeps the
    // main process from trusting a payload it did not build.
    let target;
    try {
      target = new URL(url);
    } catch {
      throw new Error(`„${url}“ ist keine vollständige URL.`);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error(`Das Schema ${target.protocol} wird nicht gesendet — nur http und https.`);
    }

    const headers = {};
    for (const header of request?.headers || []) {
      if (!/^[A-Za-z0-9-]+$/.test(String(header?.name || ""))) continue;
      headers[header.name] = String(header.value ?? "");
    }
    const hasBody = !["GET", "HEAD"].includes(method) && String(request?.body || "").length > 0;

    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    if (options.id) this.inFlight.set(options.id, controller);

    try {
      const response = await this.fetchImpl(target, {
        method,
        headers,
        ...(hasBody ? { body: String(request.body) } : {}),
        redirect: "follow",
        signal: controller.signal,
      });

      const raw = await response.text();
      const truncated = raw.length > MAX_BODY_BYTES;
      const contentType = response.headers?.get?.("content-type") || "";
      const responseHeaders = [];
      response.headers?.forEach?.((value, name) => responseHeaders.push([name, value]));

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || "",
        url: response.url || target.toString(),
        durationMs: Date.now() - startedAt,
        bytes: raw.length,
        truncated,
        contentType,
        headers: redactHeaders(Object.fromEntries(responseHeaders)),
        body: formatBody(truncated ? raw.slice(0, MAX_BODY_BYTES) : raw, contentType),
        request: { method, url: target.toString(), headers: redactHeaders(headers) },
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Zeitüberschreitung nach ${timeoutMs} ms: ${target.host} hat nicht geantwortet.`);
      }
      throw new Error(`${method} ${target.toString()} fehlgeschlagen: ${error?.message || error}`);
    } finally {
      clearTimeout(timer);
      if (options.id) this.inFlight.delete(options.id);
    }
  }

  /** Cancels a request that is still running. */
  cancel(id) {
    const controller = this.inFlight.get(id);
    if (!controller) return false;
    controller.abort();
    this.inFlight.delete(id);
    return true;
  }
}

module.exports = { HttpClientService, redactHeaders, formatBody, SECRET_HEADERS };
