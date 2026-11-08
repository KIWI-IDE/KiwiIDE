import path from "node:path";
import { describe, expect, it } from "vitest";

const { SECRET_HEADERS, redactHeaders } = require("../electron/services/http-client-service.cjs");
const { tokenKind, redactSecrets } = require("../electron/services/github-auth-service.cjs");
const { samePath } = require("../electron/services/workspace-state-service.cjs");

describe("headers that must not be shown", () => {
  it("knows the ones that carry a credential", () => {
    for (const header of ["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"]) {
      expect({ header, secret: SECRET_HEADERS.has(header) }).toEqual({ header, secret: true });
    }
  });

  it("does not treat an ordinary header as one", () => {
    for (const header of ["content-type", "accept", "user-agent"]) {
      expect({ header, secret: SECRET_HEADERS.has(header) }).toEqual({ header, secret: false });
    }
  });

  it("hides the value while leaving enough to recognise it", () => {
    // A response is shown in a tool window and can end up in a screenshot or a
    // bug report. Four characters are enough to tell two tokens apart and not
    // enough to use one.
    const masked = redactHeaders({ Authorization: "Bearer sk-liveSecretValue" });
    expect(masked[0].value).toBe("Bear… (verborgen)");
    expect(masked[0].value).not.toContain("SecretValue");
  });

  it("hides it whatever case the server wrote the name in", () => {
    // HTTP header names are case-insensitive, and a server that answers with
    // "AUTHORIZATION" would otherwise have its token printed in full.
    for (const name of ["Authorization", "AUTHORIZATION", "authorization", "X-Api-Key"]) {
      const masked = redactHeaders({ [name]: "geheimer-wert" });
      expect({ name, shown: masked[0].value }).toEqual({ name, shown: "gehe… (verborgen)" });
    }
  });

  it("leaves a harmless header readable", () => {
    expect(redactHeaders({ "Content-Type": "application/json" })[0].value)
      .toBe("application/json");
  });
});

describe("recognising a GitHub token", () => {
  it("tells the two token formats apart", () => {
    expect(tokenKind("github_pat_11ABCDE_xyz")).toBe("fine-grained");
    expect(tokenKind("ghp_abcdefghijklmnop")).toBe("classic");
    expect(tokenKind("gho_abcdefghijklmnop")).toBe("classic");
  });

  it("calls anything else an OAuth token rather than refusing it", () => {
    // GitHub has changed its prefixes before. Refusing an unrecognised shape
    // would lock people out over a format that is perfectly valid.
    expect(tokenKind("1234567890abcdef")).toBe("oauth");
  });

  it("says nothing for nothing", () => {
    expect(tokenKind("")).toBe("");
    expect(tokenKind(null)).toBe("");
  });
});

describe("keeping a token out of what gets printed", () => {
  it("removes one that leaked into a URL", () => {
    // git writes the remote URL into its own error messages, credentials and
    // all, and those messages are shown in the tool window.
    const cleaned = redactSecrets("fatal: https://ghp_abcdefghijklmnop@github.com/a/b.git nicht gefunden");
    expect(cleaned).not.toContain("ghp_abcdefghijklmnop");
    expect(cleaned).toContain("github.com/a/b.git");
  });

  it("leaves a message without a secret exactly as it was", () => {
    const message = "fatal: repository not found";
    expect(redactSecrets(message)).toBe(message);
  });
});

describe("deciding whether two paths are the same project", () => {
  it("sees through a relative path and a trailing separator", () => {
    const base = process.platform === "win32" ? "C:\\dev\\projekt" : "/dev/projekt";
    expect(samePath(base, path.join(base, "unter", ".."))).toBe(true);
  });

  it("ignores the case on Windows, where the filesystem does too", () => {
    if (process.platform !== "win32") return;
    expect(samePath("C:\\Dev\\Projekt", "c:\\dev\\projekt")).toBe(true);
  });

  it("says no rather than throwing when one side is not a path", () => {
    // A profile or an older state file can carry a null root, and path.resolve
    // on it would take the whole workspace snapshot down with it.
    for (const value of [null, undefined, "", 42, {}]) {
      expect({ value: String(value), same: samePath(value as string, "C:\\dev") })
        .toEqual({ value: String(value), same: false });
      expect(samePath("C:\\dev", value as string)).toBe(false);
    }
  });

  it("keeps two different projects apart", () => {
    const left = process.platform === "win32" ? "C:\\dev\\eins" : "/dev/eins";
    const right = process.platform === "win32" ? "C:\\dev\\zwei" : "/dev/zwei";
    expect(samePath(left, right)).toBe(false);
  });
});
