import { describe, expect, it } from "vitest";

const { UpdateService } = require("../electron/services/update-service.cjs");
const { createSigningKeyPair, signManifest } = require("../electron/services/update-signature.cjs");

const keys = createSigningKeyPair();
const other = createSigningKeyPair();

const body = {
  schemaVersion: 3,
  channel: "stable",
  version: "9.9.9",
  releaseNotes: "Kiwi IDE 9.9.9",
  artifacts: {
    setup: {
      filename: "Kiwi-IDE-9.9.9-setup.exe",
      url: "https://kiwi.example.org/Kiwi-IDE-9.9.9-setup.exe",
      sha256: "c".repeat(64),
      bytes: 1_000,
    },
  },
};

/** A service that answers one manifest and nothing else. */
function serviceFor(manifest: unknown, trustedKeys: string[]) {
  const settings = {
    get: () => ({
      updateManifestUrl: "https://kiwi.example.org/latest.json",
      updateChannel: "stable",
    }),
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: "https://kiwi.example.org/latest.json",
    headers: { get: () => "" },
    text: async () => JSON.stringify(manifest),
    json: async () => manifest,
  });
  return new UpdateService(settings, "1.0.0", "", fetchImpl, { artifactKind: "setup", trustedKeys });
}

/**
 * Everything after the manifest is read trusts it: the URL it points at, the
 * checksum it claims, the version it names. Whoever can serve that URL decides
 * what every Kiwi installs.
 */
describe("an update the app has no reason to trust", () => {
  it("takes a manifest signed by the pinned key", async () => {
    const manifest = { ...body, signature: signManifest(body, keys.privateKeyPem) };
    const result = await serviceFor(manifest, [keys.publicKeyPem]).check();
    expect(result).toMatchObject({ available: true, version: "9.9.9", signed: true });
  });

  it("refuses an unsigned manifest once a key is pinned", async () => {
    await expect(serviceFor(body, [keys.publicKeyPem]).check())
      .rejects.toThrow(/nicht vertrauenswürdig/);
  });

  it("refuses one signed by somebody else's key", async () => {
    const manifest = { ...body, signature: signManifest(body, other.privateKeyPem) };
    await expect(serviceFor(manifest, [keys.publicKeyPem]).check())
      .rejects.toThrow(/nicht vertrauenswürdig/);
  });

  it("refuses a manifest whose download URL was swapped after signing", async () => {
    // The attack the signature exists for: a valid signature over the real
    // manifest, and a different file behind the link.
    const signed = { ...body, signature: signManifest(body, keys.privateKeyPem) };
    const swapped = {
      ...signed,
      artifacts: {
        setup: { ...signed.artifacts.setup, url: "https://woanders.example/Kiwi-IDE-9.9.9-setup.exe" },
      },
    };
    await expect(serviceFor(swapped, [keys.publicKeyPem]).check())
      .rejects.toThrow(/nicht vertrauenswürdig/);
  });

  it("still updates a build that pins no key, and says the update is unsigned", async () => {
    // Breaking updates for everybody who has not set a key up yet would be a
    // worse outcome than the one being guarded against.
    const result = await serviceFor(body, []).check();
    expect(result).toMatchObject({ available: true, signed: false });
    expect(result.signatureWarning).toContain("nicht signiert");
  });

  it("says nothing about signatures when there is nothing to update to", async () => {
    const older = {
      ...body,
      version: "0.0.1",
      artifacts: {
        setup: {
          ...body.artifacts.setup,
          filename: "Kiwi-IDE-0.0.1-setup.exe",
          url: "https://kiwi.example.org/Kiwi-IDE-0.0.1-setup.exe",
        },
      },
    };
    const manifest = { ...older, signature: signManifest(older, keys.privateKeyPem) };
    const result = await serviceFor(manifest, [keys.publicKeyPem]).check();
    expect(result.available).toBe(false);
    expect(result.signed).toBe(true);
  });
});
