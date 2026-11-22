import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DependencyService } = require("../electron/services/dependency-service.cjs");
const service = new DependencyService({}, {});
const cases = [
  ["central", "com.google.guava:guava"],
  ["google", "androidx.core:core"],
  ["papermc", "paper-api"],
  ["spigot", "spigot-api"],
  ["fabric", "fabric-loader"],
  ["sponge", "spongeapi"],
  ["jitpack", "com.github.PhilJay:MPAndroidChart"],
];
const results = await Promise.allSettled(cases.map(async ([source, query]) => {
  const candidates = await service.search(query, 5, source);
  assert(candidates.length, `${source}: no candidates for ${query}`);
  const first = candidates[0];
  assert.equal(first.sourceId, source);
  const versions = await service.versions(first.groupId, first.artifactId, 100, source);
  assert(versions.length, `${source}: no versions for ${query}`);
  assert(versions.includes(first.version), `${source}: selected version is missing from its version list`);
  console.log(`${source}: ${first.groupId}:${first.artifactId}, ${versions.length} versions verified`);
}));
const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${cases[index][0]}: ${result.reason.message}`] : []);
if (errors.length) throw new Error(errors.join("\n"));
console.log("All seven dependency repositories passed live search and version checks.");
