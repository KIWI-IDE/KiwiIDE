import { describe, expect, it } from "vitest";

const {
  canonicalManifest,
  createSigningKeyPair,
  manifestTrust,
  readPublicKeys,
  signManifest,
  verifyManifestSignature,
} = require("../electron/services/update-signature.cjs");

const keys = createSigningKeyPair();
const other = createSigningKeyPair();

const manifest = {
  schemaVersion: 3,
  channel: "stable",
  version: "1.3.34",
  keyId: "release-2026",
  artifacts: {
    setup: {
      filename: "Kiwi-IDE-1.3.34-setup.exe",
      url: "https://example.org/Kiwi-IDE-1.3.34-setup.exe",
      sha256: "a".repeat(64),
      bytes: 289_764_784,
    },
  },
};

/**
 * The checksum proves the download was not corrupted. It proves nothing about
 * who wrote the manifest, and whoever can serve that URL decides what every
 * Kiwi installs.
 */
describe("signing a manifest", () => {
  it("verifies against the key that signed it", () => {
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    expect(verifyManifestSignature(signed, [keys.publicKeyPem])).toMatchObject({ verified: true });
  });

  it("does not verify against a different key", () => {
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    expect(verifyManifestSignature(signed, [other.publicKeyPem]).verified).toBe(false);
  });

  it("tries every pinned key, so one can be rotated in beside the other", () => {
    const signed = { ...manifest, signature: signManifest(manifest, other.privateKeyPem) };
    expect(verifyManifestSignature(signed, [keys.publicKeyPem, other.publicKeyPem]).verified).toBe(true);
  });

  it("refuses a manifest whose content was changed after signing", () => {
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    const tampered = {
      ...signed,
      artifacts: { setup: { ...signed.artifacts.setup, url: "https://woanders.example/böse.exe" } },
    };
    expect(verifyManifestSignature(tampered, [keys.publicKeyPem]).verified).toBe(false);
  });

  it("refuses a changed checksum, which is the whole point", () => {
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    const tampered = {
      ...signed,
      artifacts: { setup: { ...signed.artifacts.setup, sha256: "b".repeat(64) } },
    };
    expect(verifyManifestSignature(tampered, [keys.publicKeyPem]).verified).toBe(false);
  });

  it("says why rather than just no", () => {
    expect(verifyManifestSignature(manifest, [keys.publicKeyPem]).reason).toBe("keine Signatur");
    expect(verifyManifestSignature({ ...manifest, signature: "nicht base64!!" }, [keys.publicKeyPem]).reason)
      .toBe("unlesbare Signatur");
    expect(verifyManifestSignature({ ...manifest, signature: "AAAA" }, []).reason).toBe("keine Schlüssel");
  });

  it("ignores a pinned key that is not a key", () => {
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    expect(verifyManifestSignature(signed, ["kein schlüssel", keys.publicKeyPem]).verified).toBe(true);
  });

  it("refuses to sign with anything but Ed25519", () => {
    expect(() => signManifest(manifest, "-----BEGIN PRIVATE KEY-----\nnein\n-----END PRIVATE KEY-----"))
      .toThrow();
  });
});

/**
 * A manifest re-saved by a different tool says exactly the same thing and must
 * still verify.
 */
describe("what the signature covers", () => {
  it("does not depend on the order the keys were written in", () => {
    const reordered = { version: manifest.version, channel: manifest.channel, schemaVersion: 3, keyId: manifest.keyId, artifacts: manifest.artifacts };
    expect(canonicalManifest(reordered)).toBe(canonicalManifest(manifest));
  });

  it("does not cover the signature itself", () => {
    expect(canonicalManifest({ ...manifest, signature: "abc" })).toBe(canonicalManifest(manifest));
  });

  it("covers everything else, including nested values", () => {
    const changed = {
      ...manifest,
      artifacts: { setup: { ...manifest.artifacts.setup, bytes: 1 } },
    };
    expect(canonicalManifest(changed)).not.toBe(canonicalManifest(manifest));
  });
});

/**
 * More than one key is how a key is rotated: the new one ships beside the old
 * so installations carrying either can still verify.
 */
describe("the key file a build ships with", () => {
  it("reads every key in it", () => {
    const file = `${keys.publicKeyPem}
${other.publicKeyPem}`;
    expect(readPublicKeys(file)).toHaveLength(2);
  });

  it("ignores everything that is not a key", () => {
    const file = `# Noch keiner eingetragen.
# Siehe scripts/create-update-keys.mjs
`;
    expect(readPublicKeys(file)).toEqual([]);
  });

  it("reads a key that comments were written around", () => {
    const file = `# der aktuelle
${keys.publicKeyPem}
# der alte, eine Version lang
`;
    expect(readPublicKeys(file)).toHaveLength(1);
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    expect(verifyManifestSignature(signed, readPublicKeys(file)).verified).toBe(true);
  });

  it("yields none for a file that is not there", () => {
    expect(readPublicKeys("")).toEqual([]);
    expect(readPublicKeys(null as never)).toEqual([]);
  });
});

/**
 * Breaking updates for everybody who has not set a key up yet would be a worse
 * outcome than the one being guarded against.
 */
describe("what a build does about it", () => {
  it("still updates when no key is pinned, and says the update is unsigned", () => {
    const trust = manifestTrust(manifest, []);
    expect(trust.trusted).toBe(true);
    expect(trust.signed).toBe(false);
    expect(trust.warning).toContain("nicht signiert");
  });

  it("accepts a signed manifest when a key is pinned", () => {
    const signed = { ...manifest, signature: signManifest(manifest, keys.privateKeyPem) };
    expect(manifestTrust(signed, [keys.publicKeyPem])).toMatchObject({ trusted: true, signed: true, keyId: "release-2026" });
  });

  it("refuses an unsigned manifest once a key exists", () => {
    // Then it is either an attack or a mistake, and both should stop.
    const trust = manifestTrust(manifest, [keys.publicKeyPem]);
    expect(trust.trusted).toBe(false);
    expect(trust.error).toContain("nicht vertrauenswürdig");
  });

  it("refuses one signed by somebody else", () => {
    const signed = { ...manifest, signature: signManifest(manifest, other.privateKeyPem) };
    expect(manifestTrust(signed, [keys.publicKeyPem]).trusted).toBe(false);
  });
});
