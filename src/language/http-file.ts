/**
 * Reads `.http` request files.
 *
 * The IDE already finds the REST endpoints a project declares, but there was
 * no way to call one — testing an endpoint meant leaving for a browser or a
 * terminal. A request file lives in the project next to the code it exercises,
 * so it is reviewed and versioned like everything else.
 *
 * The format is the one JetBrains and the VS Code REST client established:
 * requests separated by `###`, an optional name on that line, headers until the
 * first blank line, then the body.
 */

export interface HttpRequestDefinition {
  /** 1-based line of the request line, so the gutter can point at it. */
  line: number;
  name: string;
  method: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
  body: string;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];

/**
 * Collects `@name = value` definitions.
 *
 * Variables are what make one file usable against several environments, and
 * they are resolved lazily so a later definition can build on an earlier one.
 */
export function parseHttpVariables(source: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of String(source || "").split(/\r?\n/)) {
    const match = line.match(/^\s*@([A-Za-z_][\w.-]*)\s*=\s*(.*)$/);
    if (match) variables[match[1]] = expandHttpVariables(match[2].trim(), variables);
  }
  return variables;
}

/** Replaces `{{name}}` with what the file defined, leaving unknowns visible. */
export function expandHttpVariables(value: string, variables: Record<string, string>): string {
  return String(value || "").replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (whole, name) =>
    Object.hasOwn(variables, name) ? variables[name] : whole);
}

/**
 * Splits a file into its requests.
 *
 * Anything that is not a request — comments, variable definitions, blank
 * separators — is skipped rather than guessed at, so a malformed block never
 * turns into a request that goes somewhere unintended.
 */
export function parseHttpFile(source: string): HttpRequestDefinition[] {
  const lines = String(source || "").split(/\r?\n/);
  const variables = parseHttpVariables(source);
  const requests: HttpRequestDefinition[] = [];

  let current: HttpRequestDefinition | null = null;
  let pendingName = "";
  let section: "headers" | "body" = "headers";

  const finish = () => {
    if (!current) return;
    current.body = current.body.replace(/\s+$/, "");
    requests.push(current);
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();

    const separator = trimmed.match(/^###\s*(.*)$/);
    if (separator) {
      finish();
      pendingName = separator[1].trim();
      section = "headers";
      continue;
    }

    if (!current) {
      // A comment or a variable definition outside a request carries no target.
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("@")) continue;
      const request = trimmed.match(/^([A-Za-z]+)\s+(\S.*?)\s*(?:HTTP\/[\d.]+)?$/);
      if (!request || !METHODS.includes(request[1].toUpperCase())) continue;
      current = {
        line: index + 1,
        name: pendingName || `${request[1].toUpperCase()} ${expandHttpVariables(request[2], variables)}`,
        method: request[1].toUpperCase(),
        url: expandHttpVariables(request[2], variables),
        headers: [],
        body: "",
      };
      pendingName = "";
      section = "headers";
      continue;
    }

    if (section === "headers") {
      if (!trimmed) {
        section = "body";
        continue;
      }
      if (trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      const header = trimmed.match(/^([A-Za-z0-9-]+)\s*:\s*(.*)$/);
      if (header) {
        current.headers.push({ name: header[1], value: expandHttpVariables(header[2].trim(), variables) });
      }
      continue;
    }

    current.body += `${expandHttpVariables(raw, variables)}\n`;
  }

  finish();
  return requests;
}

/** The request the cursor is in, so one key can send the right one. */
export function requestAtLine(requests: HttpRequestDefinition[], line: number): HttpRequestDefinition | null {
  let match: HttpRequestDefinition | null = null;
  for (const request of requests) {
    if (request.line <= line) match = request;
  }
  return match;
}

/**
 * Rejects anything that is not an ordinary web request.
 *
 * A request file is executed with one keystroke, so the scheme is checked
 * before anything is sent: `file:` would read from disk, and other schemes
 * have no business being reachable from an editor gutter.
 */
export function assertSendableUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`„${url}“ ist keine vollständige URL. Erwartet wird http:// oder https://.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Das Schema ${parsed.protocol} wird nicht gesendet — nur http und https.`);
  }
  return parsed;
}
