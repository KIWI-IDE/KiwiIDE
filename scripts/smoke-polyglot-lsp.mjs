import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { PolyglotLanguageService } = require("../electron/services/polyglot-language-service.cjs");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managedRoot = path.resolve(process.env.KIWI_LANGUAGE_SERVERS_DIR || path.join(repository, ".kiwi", "language-servers"));
const fixtureBase = path.join(repository, ".kiwi", "smoke");
await fs.mkdir(fixtureBase, { recursive: true });
const root = await fs.mkdtemp(path.join(fixtureBase, "polyglot-real-"));
const guard = new PathGuard();
guard.register(root);
const events = [];
const service = new PolyglotLanguageService(guard, () => ({}), (channel, payload) => events.push({ channel, payload }), {
  managedRoot, initializeTimeoutMs: 45_000, requestTimeoutMs: 20_000,
});

async function until(action, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error(`${label}: Zeitüberschreitung.${lastError ? ` ${lastError.message}` : ""}`);
}

async function exercise(languageId, name, source, expectedCompletion, checkedSource, diagnosticNeedle) {
  const file = path.join(root, name);
  await fs.writeFile(file, source);
  const document = { root, file, languageId, text: source };
  const opened = await service.open(document);
  assert.equal(opened.available, true, `${languageId}: ${opened.reason || opened.status}`);
  const lines = source.split("\n");
  const position = { line: lines.length - 1, character: lines.at(-1).length };
  const result = await until(async () => {
    const answer = await service.request({
      ...document, method: "textDocument/completion",
      params: { textDocument: { uri: pathToFileURL(file).toString() }, position, context: { triggerKind: 1 } },
    });
    const items = Array.isArray(answer) ? answer : answer?.items || [];
    return items.some((item) => item.label === expectedCompletion) ? items : null;
  }, `${languageId}: Completion ${expectedCompletion}`);
  process.stdout.write(`${languageId}: echte Member-Completion „${expectedCompletion}“ (${result.length} Vorschläge).\n`);

  const before = events.length;
  await service.change({ ...document, text: checkedSource });
  await fs.writeFile(file, checkedSource);
  await service.save({ root, file, text: checkedSource });
  const diagnostics = await until(() => {
    const answers = events.slice(before).filter((event) => event.channel === "polyglot:diagnostics"
      && event.payload.uri === pathToFileURL(file).toString());
    return answers.map((event) => event.payload.diagnostics || []).find((items) => items.some((item) =>
      item.severity === 1 && diagnosticNeedle.test(String(item.message)))) || null;
  }, `${languageId}: semantische Diagnose`);
  process.stdout.write(`${languageId}: semantische Fehlerdiagnose bestätigt (${diagnostics.length} Diagnose(n)).\n`);
  await service.close(document);
}

try {
  const available = await service.status(root);
  for (const languageId of ["python", "php"]) {
    const row = available.find((entry) => entry.languageId === languageId);
    assert.ok(row?.available, `${languageId}: Sprachserver fehlt unter ${managedRoot}. Bitte zuerst in Kiwi lokal installieren.`);
  }
  await exercise("python", "main.py", 'word = "kiwi"\nword.', "upper",
    'word = "kiwi"\nword.upper()\nnumber: int = "text"\n', /(?:int|str|assign)/i);
  await exercise("php", "main.php", [
    "<?php", "class KiwiGreeter {", "    public function greet(string $name): string { return strtoupper($name); }",
    "}", "$greeter = new KiwiGreeter();", "$greeter->",
  ].join("\n"), "greet", [
    "<?php", "class KiwiGreeter {", "    public function greet(string $name): string { return strtoupper($name); }",
    "}", "$greeter = new KiwiGreeter();", "$greeter->methodThatDoesNotExist();", "",
  ].join("\n"), /methodThatDoesNotExist/i);
  process.stdout.write("Polyglot LSP smoke passed: echte Pyright- und Intelephense-Prozesse, Member-Completion und semantische Diagnosen.\n");
} catch (error) {
  const logs = events.filter((event) => event.channel === "polyglot:log").slice(-12).map((event) => event.payload.text).join("");
  if (logs) process.stderr.write(logs);
  throw error;
} finally {
  await service.stop();
  await fs.rm(root, { recursive: true, force: true });
}
