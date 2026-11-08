import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Which exported functions no test ever mentions.
 *
 * Coverage in the usual sense answers "were these lines executed", which counts
 * a function reached incidentally while something else was being tested. This
 * answers a narrower and more useful question for deciding what to write next:
 * is there a test that names this thing at all?
 *
 * It found 96 of them the first time it ran, and two of those turned out to be
 * holes rather than gaps — a sanitiser that let Java keywords through into
 * generated source, and a dependency version that could carry a Groovy
 * expression into a build file.
 *
 *   node scripts/find-test-gaps.mjs            every service, worst first
 *   node scripts/find-test-gaps.mjs --max 20   fail if more than 20 are unnamed
 */

const root = process.cwd();
const serviceDirectory = path.join(root, "electron", "services");

/** Everything a test could plausibly be written in. */
function testCorpus() {
  const parts = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
        continue;
      }
      if (/\.(test\.tsx?|mjs)$/.test(entry.name)) parts.push(readFileSync(full, "utf8"));
    }
  };
  for (const directory of ["tests", "src", "scripts"]) {
    try {
      walk(path.join(root, directory));
    } catch { /* a directory that is not there is not an error here */ }
  }
  return parts.join("\n");
}

/** The names one service hands out. */
function exportsOf(file) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/module\.exports\s*=\s*\{([^}]*)\}/s);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.trim().split(":")[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

const corpus = testCorpus();
const rows = [];
for (const name of readdirSync(serviceDirectory).sort()) {
  if (!name.endsWith(".cjs")) continue;
  const missing = exportsOf(path.join(serviceDirectory, name))
    .filter((exported) => !corpus.includes(exported));
  if (missing.length) rows.push({ name, missing });
}

rows.sort((left, right) => right.missing.length - left.missing.length);
const total = rows.reduce((sum, row) => sum + row.missing.length, 0);

for (const row of rows) {
  const size = Math.round(statSync(path.join(serviceDirectory, row.name)).size / 1024);
  process.stdout.write(`${String(row.missing.length).padStart(3)}  ${row.name.padEnd(32)} ${String(size).padStart(3)} KB  ${row.missing.join(", ")}\n`);
}
process.stdout.write(`\n${total} Exporte werden in keinem Test genannt, verteilt auf ${rows.length} Dienste.\n`);

const limitIndex = process.argv.indexOf("--max");
if (limitIndex >= 0) {
  const limit = Number(process.argv[limitIndex + 1]);
  if (Number.isInteger(limit) && total > limit) {
    process.stderr.write(`Mehr als ${limit} ungenannte Exporte.\n`);
    process.exit(1);
  }
}
