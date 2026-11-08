/**
 * Makes the key pair releases are signed with.
 *
 * Run once. The private half signs manifests on the machine that builds
 * releases and must never be committed or shipped; the public half is pinned
 * into the app so it can tell a manifest of yours from anybody else's.
 *
 *   node scripts/create-update-keys.mjs
 *
 * Writes nothing on its own — the two keys are printed, so that where they end
 * up is a decision somebody makes rather than a file that quietly appears in a
 * repository.
 */

import { createRequire } from "node:module";

const { createSigningKeyPair } = createRequire(import.meta.url)("../electron/services/update-signature.cjs");
const { privateKeyPem, publicKeyPem } = createSigningKeyPair();

console.log("Privater Schlüssel — nur auf dem Rechner, der Releases baut.");
console.log("Niemals committen, niemals ausliefern.\n");
console.log(privateKeyPem.trim());
console.log("\nSetze ihn beim Bauen als KIWI_UPDATE_PRIVATE_KEY, oder lege ihn");
console.log("außerhalb des Repositories ab und zeige mit KIWI_UPDATE_PRIVATE_KEY_FILE darauf.\n");
console.log("Öffentlicher Schlüssel — gehört in resources/update-keys.pem:\n");
console.log(publicKeyPem.trim());
console.log("\nMehrere öffentliche Schlüssel in dieser Datei sind erlaubt: so wird ein");
console.log("Schlüssel gewechselt, ohne jede Installation auf einmal auszusperren.");
