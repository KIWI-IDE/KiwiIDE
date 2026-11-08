const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release");

/**
 * Return only files produced for the version being released. Enumerating the
 * entire release directory used to re-sign older installers on every release,
 * changing immutable binaries that might already be published.
 */
function currentVersionArtifacts(root, version, existsSync = fs.existsSync) {
  return [
    path.join(root, `Kiwi-IDE-${version}-portable.exe`),
    path.join(root, `Kiwi-IDE-${version}-setup.exe`),
  ].filter((file) => existsSync(file));
}

function signingConfig(env = process.env) {
  return {
    certificate: env.KIWI_WINDOWS_CERT_PFX || "",
    password: env.KIWI_WINDOWS_CERT_PASSWORD || "",
    signTool: env.KIWI_SIGNTOOL_PATH || "",
    timestampUrl: env.KIWI_TIMESTAMP_URL || "http://timestamp.digicert.com",
    required: env.KIWI_REQUIRE_SIGNING === "1",
  };
}

function signingAvailable(config, logger = console) {
  if (config.certificate && config.password && config.signTool) return true;
  const message = "Windows-Signierung übersprungen: KIWI_WINDOWS_CERT_PFX, KIWI_WINDOWS_CERT_PASSWORD und KIWI_SIGNTOOL_PATH sind erforderlich.";
  if (config.required) throw new Error(message);
  logger.log(message);
  return false;
}

/**
 * Signs one artifact, waiting out whatever still holds the file.
 *
 * SignTool opens the file for writing, and a 276 MB installer that was written
 * seconds ago is often still being read by a virus scanner or by the indexer.
 * That fails with "The file is being used by another process" — a condition
 * that passes on its own within seconds. Losing a release build that had
 * already cleared three E2E runs to it is the wrong trade, so the attempt is
 * repeated before it is called a failure.
 *
 * A wrong password or a missing certificate fails the same way every time, so
 * the retries cost only the delay and change no outcome.
 */
/** Blocks the run, because everything around it is synchronous. */
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function signAndVerify(artifact, config, execute = execFileSync, wait = sleepSync) {
  const attempts = Number(config.attempts) > 0 ? Number(config.attempts) : 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      execute(config.signTool, [
        "sign",
        "/fd", "SHA256",
        "/td", "SHA256",
        "/tr", config.timestampUrl,
        "/f", config.certificate,
        "/p", config.password,
        artifact,
      ], { stdio: "inherit", windowsHide: true });
      break;
    } catch {
      // Child-process errors can expose their full argument list, including the
      // certificate password. Nothing from the failure is carried outwards.
      if (attempt >= attempts) throw new Error(`SignTool konnte ${path.basename(artifact)} nach ${attempts} Versuchen nicht signieren.`);
      process.stdout.write(`SignTool-Versuch ${attempt} für ${path.basename(artifact)} fehlgeschlagen — neuer Versuch in ${attempt * 3} s.\n`);
      wait(attempt * 3000);
    }
  }

  try {
    execute(config.signTool, ["verify", "/pa", "/all", artifact], { stdio: "pipe", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function signArtifactIfConfigured(artifact, { env = process.env, execute = execFileSync, logger = console } = {}) {
  const config = signingConfig(env);
  if (!signingAvailable(config, logger)) return { signed: false, trusted: false };
  const trusted = signAndVerify(artifact, config, execute);
  if (trusted) {
    logger.log(`Signatur geprüft: ${path.basename(artifact)}`);
  } else {
    const message = `${path.basename(artifact)} ist signiert, aber das Zertifikat führt auf keine vertrauenswürdige Wurzel.`;
    if (config.required) throw new Error(message);
    logger.log(`${message} Bei einem selbstsignierten Zertifikat ist das erwartet — SmartScreen warnt weiterhin.`);
  }
  return { signed: true, trusted };
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const version = String(pkg.version || "").trim();
  if (!version) throw new Error("package.json enthält keine gültige Versionsnummer.");

  const config = signingConfig();
  const artifacts = currentVersionArtifacts(releaseRoot, version);

  if (!signingAvailable(config)) return;

  /**
   * `signtool verify /pa` applies the Authenticode policy, which requires the
   * certificate to chain to a trusted root. A self-signed certificate never
   * satisfies that even though the signature it produced is valid, so treating
   * the check as fatal stopped the run after the very first artifact — the
   * installer and the portable build were left unsigned, and the release
   * manifest was never written. The outcome is collected instead and only
   * raised at the end, when KIWI_REQUIRE_SIGNING=1 asks for a chain that
   * everyone can trust.
   */
  const untrusted = [];

  for (const artifact of artifacts) {
    const relative = path.relative(projectRoot, artifact);
    if (signAndVerify(artifact, config)) {
      console.log(`Signatur geprüft: ${relative}`);
    } else {
      untrusted.push(relative);
      console.log(`Signiert, aber ohne vertrauenswürdige Kette: ${relative}`);
    }
  }

  if (untrusted.length) {
    const message = `${untrusted.length} Artefakt(e) sind signiert, aber das Zertifikat führt auf keine vertrauenswürdige Wurzel.`
      + " Bei einem selbstsignierten Zertifikat ist das erwartet — SmartScreen warnt weiterhin.";
    if (config.required) throw new Error(message);
    console.log(message);
  }
}

module.exports = {
  currentVersionArtifacts,
  main,
  signAndVerify,
  signArtifactIfConfigured,
  signingAvailable,
  signingConfig,
};

if (require.main === module) main();
