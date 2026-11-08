/**
 * Proving an update manifest came from whoever builds Kiwi.
 *
 * The manifest already had to be well-formed, name the right channel, and
 * carry a SHA-256 that the downloaded file has to match. All of that proves
 * the download was not corrupted; none of it proves who wrote the manifest.
 * TLS protects the road, not the sender: whoever can serve that URL — a
 * hosting account, a proxy with its own certificate, a mistaken DNS entry —
 * decides what every Kiwi installs, and the checksum they publish will match
 * the file they publish.
 *
 * So the manifest carries a signature over its own body, made with a key that
 * never leaves the machine that builds releases, and the app carries the
 * public half. A manifest that does not verify is not a manifest.
 *
 * Ed25519, because it is in Node without a dependency, the keys are short
 * enough to paste, and there are no parameters to get wrong.
 */

const crypto = require("node:crypto");

/** Where the signature lives, and what is signed. */
const SIGNATURE_FIELD = "signature";
const KEY_ID_FIELD = "keyId";

/**
 * The bytes a signature covers.
 *
 * Everything in the manifest except the signature itself, serialised so the
 * same content always gives the same bytes: keys in order, no incidental
 * whitespace. Without that, a manifest re-saved by a different tool would stop
 * verifying while saying exactly the same thing.
 */
function canonicalManifest(manifest) {
  const body = { ...(manifest || {}) };
  delete body[SIGNATURE_FIELD];
  return JSON.stringify(sortValue(body));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key]);
  return sorted;
}

/** Signs a manifest body. The private key never leaves the build machine. */
function signManifest(manifest, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Zum Signieren wird ein Ed25519-Schlüssel gebraucht.");
  const signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest), "utf8"), key);
  return signature.toString("base64");
}

/**
 * Whether a signature is one of the trusted keys' work.
 *
 * Every pinned key is tried, so a key can be rotated by shipping the new one
 * alongside the old rather than by breaking every installation at once.
 */
function verifyManifestSignature(manifest, publicKeys) {
  const keys = (Array.isArray(publicKeys) ? publicKeys : [publicKeys]).filter(Boolean);
  if (!keys.length) return { verified: false, reason: "keine Schlüssel" };
  const provided = String(manifest?.[SIGNATURE_FIELD] || "").trim();
  if (!provided) return { verified: false, reason: "keine Signatur" };
  let signature;
  try {
    signature = Buffer.from(provided, "base64");
  } catch {
    return { verified: false, reason: "unlesbare Signatur" };
  }
  // Ed25519 signatures are exactly 64 bytes; anything else is not one, and
  // saying so is cheaper than asking the crypto library.
  if (signature.length !== 64) return { verified: false, reason: "unlesbare Signatur" };

  const data = Buffer.from(canonicalManifest(manifest), "utf8");
  for (const candidate of keys) {
    let key;
    try {
      key = crypto.createPublicKey(candidate);
    } catch {
      continue;
    }
    if (key.asymmetricKeyType !== "ed25519") continue;
    try {
      if (crypto.verify(null, data, key, signature)) {
        return { verified: true, keyId: String(manifest?.[KEY_ID_FIELD] || "") };
      }
    } catch {
      // A key that throws is a key that does not match.
    }
  }
  return { verified: false, reason: "Signatur passt zu keinem bekannten Schlüssel" };
}

/**
 * What to do about a manifest, given what this build knows.
 *
 * A build with no pinned key behaves as it always did and says so, because
 * breaking updates for everybody who has not set a key up yet would be a worse
 * outcome than the one being guarded against. A build that has a key requires
 * a signature, and an unsigned manifest is refused rather than warned about —
 * once a key exists, an unsigned manifest is either an attack or a mistake,
 * and both should stop.
 */
function manifestTrust(manifest, publicKeys) {
  const keys = (Array.isArray(publicKeys) ? publicKeys : [publicKeys]).filter(Boolean);
  if (!keys.length) {
    return {
      trusted: true,
      signed: false,
      warning: "Dieses Update ist nicht signiert. Es wird nur über die Prüfsumme abgesichert.",
    };
  }
  const result = verifyManifestSignature(manifest, keys);
  if (result.verified) return { trusted: true, signed: true, keyId: result.keyId, warning: "" };
  return {
    trusted: false,
    signed: false,
    warning: "",
    error: `Das Update-Manifest ist nicht vertrauenswürdig (${result.reason}).`,
  };
}

/**
 * The public keys in a PEM file, however many it holds.
 *
 * More than one is how a key is rotated: the new one is shipped beside the old
 * so that installations carrying either can still verify, and the old one is
 * dropped a release later. A file that is missing or unreadable yields none,
 * which is the same as not having set one up.
 */
function readPublicKeys(text) {
  const blocks = String(text || "").match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g);
  return blocks || [];
}

/** A fresh key pair, as the two PEM strings a release setup needs. */
function createSigningKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

module.exports = {
  KEY_ID_FIELD,
  SIGNATURE_FIELD,
  canonicalManifest,
  createSigningKeyPair,
  manifestTrust,
  readPublicKeys,
  signManifest,
  verifyManifestSignature,
};
