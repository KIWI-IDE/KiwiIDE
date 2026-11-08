const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * GitHub sign-in for Git operations that talk to a remote.
 *
 * The token is a Personal Access Token supplied by the user. It is encrypted
 * with Electron's safeStorage (OS keychain / DPAPI) before it touches disk, and
 * it is never written into the repository's own git config: Git receives it per
 * command through `http.extraheader`, so nothing is left behind in the project.
 */
class GitHubAuthService {
  constructor(userDataPath, safeStorage, fetchImpl = globalThis.fetch, options = {}) {
    this.file = path.join(userDataPath, "github-auth.json");
    this.safeStorage = safeStorage;
    this.fetchImpl = fetchImpl;
    this.state = emptySession();
    this.loaded = false;
    // Resolved on demand rather than pinned at construction: the OAuth client
    // id is a setting, and requiring a restart after entering it would make the
    // browser sign-in look broken. The environment variable still wins for
    // deployments that bake one in.
    this.resolveClientId = typeof options.clientId === "function"
      ? options.clientId
      : () => String(options.clientId || "").trim();
    this.deviceFlow = null;
  }

  /** The configured OAuth client id, or "" when the browser flow is unusable. */
  get clientId() {
    return String(process.env.KIWI_GITHUB_CLIENT_ID || this.resolveClientId() || "").trim();
  }

  encryptionAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.()
      && this.safeStorage.getSelectedStorageBackend?.() !== "basic_text");
  }

  async load() {
    if (this.loaded) return this.status();
    this.loaded = true;
    try {
      const stored = JSON.parse(await fs.readFile(this.file, "utf8"));
      const encrypted = String(stored.token || "");
      const token = encrypted && this.encryptionAvailable()
        ? this.safeStorage.decryptString(Buffer.from(encrypted, "base64"))
        : "";
      this.state = {
        login: String(stored.login || ""),
        name: String(stored.name || ""),
        avatarUrl: String(stored.avatarUrl || ""),
        scopes: Array.isArray(stored.scopes) ? stored.scopes.map(String) : [],
        tokenType: String(stored.tokenType || tokenKind(token)),
        token,
      };
    } catch {
      this.state = emptySession();
    }
    return this.status();
  }

  /** Public view of the session. Never exposes the token itself. */
  status() {
    return {
      signedIn: Boolean(this.state.token && this.state.login),
      login: this.state.login,
      name: this.state.name,
      avatarUrl: this.state.avatarUrl,
      scopes: this.state.scopes,
      tokenType: this.state.tokenType,
      encryptionAvailable: this.encryptionAvailable(),
      deviceFlowAvailable: Boolean(this.clientId),
    };
  }

  /** Verifies a token against the GitHub API and stores it when it is valid. */
  async signIn(token) {
    const value = String(token || "").trim();
    if (!value) throw new Error("Bitte gib ein GitHub-Token ein.");
    if (!/^[A-Za-z0-9_-]{20,255}$/.test(value)) {
      throw new Error("Das Token hat ein unerwartetes Format. Erstelle ein Personal Access Token auf github.com.");
    }
    if (!this.encryptionAvailable()) {
      throw new Error("Der Anmeldedaten-Speicher des Systems ist nicht verfügbar. Das Token wurde nicht gespeichert.");
    }
    return this.verifyAndStore(value);
  }

  async verifyAndStore(value) {
    let response;
    try {
      response = await this.fetchImpl("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${value}`,
          "User-Agent": "Kiwi-IDE",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("GitHub ist nicht erreichbar. Prüfe deine Internetverbindung.");
    }
    if (response.status === 401) throw new Error("Das Token wurde von GitHub abgelehnt. Prüfe es oder erstelle ein neues.");
    if (!response.ok) throw new Error(`GitHub-Anmeldung fehlgeschlagen (HTTP ${response.status}).`);
    const user = await response.json();
    const scopes = String(response.headers.get("x-oauth-scopes") || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const nextState = {
      login: String(user?.login || ""),
      name: String(user?.name || ""),
      avatarUrl: String(user?.avatar_url || ""),
      scopes,
      tokenType: tokenKind(value),
      token: value,
    };
    const previousState = this.state;
    this.state = nextState;
    this.loaded = true;
    try {
      await this.persist();
    } catch (error) {
      this.state = previousState;
      throw error;
    }
    return this.status();
  }

  async signOut() {
    this.state = emptySession();
    this.deviceFlow = null;
    this.loaded = true;
    await fs.rm(this.file, { force: true });
    return this.status();
  }

  /** Starts GitHub's OAuth device flow without opening a local callback server.
   * The device code stays in memory; only the final access token is persisted,
   * encrypted through safeStorage. */
  async beginDeviceFlow() {
    if (!this.clientId) {
      throw new Error("GitHub Device Login ist nicht konfiguriert. Setze KIWI_GITHUB_CLIENT_ID oder verwende ein Personal Access Token.");
    }
    if (!this.encryptionAvailable()) {
      throw new Error("Der Anmeldedaten-Speicher des Systems ist nicht verfügbar.");
    }
    const response = await this.fetchImpl("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Kiwi-IDE" },
      body: new URLSearchParams({ client_id: this.clientId, scope: "repo read:org" }).toString(),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new Error("GitHub ist nicht erreichbar. Prüfe deine Internetverbindung."); });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.device_code || !payload.user_code) {
      throw new Error(String(payload.error_description || `GitHub Device Login fehlgeschlagen (HTTP ${response.status}).`));
    }
    const expiresIn = Math.max(60, Number(payload.expires_in || 900));
    this.deviceFlow = {
      deviceCode: String(payload.device_code),
      expiresAt: Date.now() + expiresIn * 1000,
      interval: Math.max(5, Number(payload.interval || 5)),
      nextPollAt: 0,
    };
    return {
      userCode: String(payload.user_code),
      verificationUri: String(payload.verification_uri || "https://github.com/login/device"),
      expiresIn,
      interval: this.deviceFlow.interval,
    };
  }

  async pollDeviceFlow() {
    const flow = this.deviceFlow;
    if (!flow || flow.expiresAt <= Date.now()) {
      this.deviceFlow = null;
      throw new Error("Der GitHub-Anmeldecode ist abgelaufen. Starte die Anmeldung erneut.");
    }
    if (flow.nextPollAt > Date.now()) {
      return { status: "pending", retryAfter: Math.ceil((flow.nextPollAt - Date.now()) / 1000) };
    }
    flow.nextPollAt = Date.now() + flow.interval * 1000;
    const response = await this.fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Kiwi-IDE" },
      body: new URLSearchParams({
        client_id: this.clientId,
        device_code: flow.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new Error("GitHub ist nicht erreichbar. Prüfe deine Internetverbindung."); });
    const payload = await response.json().catch(() => ({}));
    if (payload.error === "authorization_pending") return { status: "pending", retryAfter: flow.interval };
    if (payload.error === "slow_down") {
      flow.interval += 5;
      return { status: "pending", retryAfter: flow.interval };
    }
    if (payload.error) {
      this.deviceFlow = null;
      throw new Error(String(payload.error_description || payload.error));
    }
    const token = String(payload.access_token || "");
    if (!response.ok || !token) throw new Error(`GitHub Device Login fehlgeschlagen (HTTP ${response.status}).`);
    this.deviceFlow = null;
    const session = await this.verifyAndStore(token);
    return { status: "complete", session };
  }

  /** Authenticated GitHub API request. The token remains inside the main
   * process and error messages are scrubbed before crossing IPC. */
  async requestJson(apiPath, options = {}) {
    if (!this.state.token) throw new Error("Melde dich zuerst bei GitHub an.");
    const pathname = String(apiPath || "");
    if (!pathname.startsWith("/") || pathname.startsWith("//") || /[\r\n]/.test(pathname)) {
      throw new Error("Ungültiger GitHub-API-Pfad.");
    }
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.state.token}`,
      "User-Agent": "Kiwi-IDE",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const init = {
      method: String(options.method || "GET").toUpperCase(),
      headers,
      signal: AbortSignal.timeout(Number(options.timeoutMs) || 20_000),
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await this.fetchImpl(`https://api.github.com${pathname}`, init);
    } catch (error) {
      throw new Error(redactSecrets(`GitHub ist nicht erreichbar: ${error?.message || error}`));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = redactSecrets(String(payload?.message || `GitHub API antwortete mit HTTP ${response.status}.`));
      if (response.status === 401) throw new Error("Die GitHub-Anmeldung ist abgelaufen oder wurde widerrufen.");
      if (response.status === 403 && response.headers?.get?.("x-ratelimit-remaining") === "0") {
        throw new Error("Das GitHub-API-Limit ist erreicht. Versuche es später erneut.");
      }
      throw new Error(message);
    }
    return payload;
  }

  /**
   * Extra git arguments that authenticate a request, or an empty list when no
   * token is stored. Only applied for GitHub remotes so a token is never sent
   * to an unrelated host.
   */
  authArgs(remoteUrl) {
    if (!this.state.token || !isGitHubRemote(remoteUrl)) return [];
    const header = Buffer.from(`x-access-token:${this.state.token}`, "utf8").toString("base64");
    return [
      // A repo-local helper would otherwise prompt before the header is used.
      "-c", "credential.helper=",
      "-c", `http.extraheader=AUTHORIZATION: basic ${header}`,
    ];
  }

  async persist() {
    if (!this.encryptionAvailable()) {
      throw new Error("Der Anmeldedaten-Speicher des Systems ist nicht verfügbar. Das Token wurde nicht gespeichert.");
    }
    const payload = {
      version: 1,
      login: this.state.login,
      name: this.state.name,
      avatarUrl: this.state.avatarUrl,
      scopes: this.state.scopes,
      tokenType: this.state.tokenType,
      token: this.safeStorage.encryptString(this.state.token).toString("base64"),
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }
}

/** True for github.com remotes in HTTPS, SSH or scp-like form. */
function isGitHubRemote(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!value) return false;
  return /^https?:\/\/(?:[^@/]*@)?github\.com(?:[:/]|$)/i.test(value)
    || /^(?:ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]/i.test(value);
}

function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!isGitHubRemote(value)) return null;
  let pathname = "";
  if (/^https?:\/\//i.test(value)) {
    try { pathname = new URL(value).pathname; } catch { return null; }
  } else {
    pathname = value.replace(/^(?:ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]/i, "/");
  }
  const match = pathname.replace(/^\/+/, "").replace(/\.git\/?$/i, "").match(/^([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

function tokenKind(token) {
  const value = String(token || "");
  if (value.startsWith("github_pat_")) return "fine-grained";
  if (/^gh[opusr]_/.test(value)) return "classic";
  return value ? "oauth" : "";
}

function emptySession() {
  return { login: "", name: "", avatarUrl: "", scopes: [], tokenType: "", token: "" };
}

/** Removes a token that leaked into a URL before output reaches the renderer. */
function redactSecrets(text) {
  return String(text || "")
    .replace(/(https?:\/\/)[^@\s/]+(?::[^@\s/]+)?@/gi, "$1***@")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g, "***")
    .replace(/([?&](?:access_token|token)=)[^&\s]+/gi, "$1***")
    .replace(/("(?:access_token|token)"\s*:\s*")[^"]+/gi, "$1***")
    .replace(/(AUTHORIZATION:\s*basic\s+)\S+/gi, "$1***");
}

module.exports = { GitHubAuthService, isGitHubRemote, parseGitHubRepository, redactSecrets, tokenKind };
