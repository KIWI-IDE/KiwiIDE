import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { ProjectService } = require("../electron/services/project-service.cjs");
const { ModuleService } = require("../electron/services/module-service.cjs");
const { LanguageService } = require("../electron/services/language-service.cjs");
const { JavaRefactorService } = require("../electron/services/java-refactor-service.cjs");
const { spawnCapture } = require("../electron/services/process-utils.cjs");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-jdtls-"));
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-jdtls-data-"));
const libraryBuild = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-jdtls-library-"));
const sourceDirectory = path.join(root, "src", "demo");
const sourceFile = path.join(sourceDirectory, "Main.java");
const personFile = path.join(sourceDirectory, "Person.java");
const libraryDirectory = path.join(root, "libs");
const libraryFile = path.join(libraryDirectory, "external-api.jar");
const source = `package demo;

import external.lib.ExternalApi;

public class Main {
    public static void main(String[] args) {
        String message = "Kiwi";
        System.out.println(message);
        Person person = new Person();
        System.out.println(person.displayName());
        person.rename(message);
        ExternalApi api = new ExternalApi();
        System.out.println(api.libraryMethod());
    }

    public String greeting() {
        return "Hello";
    }
}
`;
const personSource = `package demo;

interface Named {
    String displayName();
}

public class Person implements Named {
    public String displayName() {
        return "Kiwi";
    }

    public void rename(String value) {
    }

    public static Person create() {
        return new Person();
    }
}
`;
const externalSource = `package external.lib;

public class ExternalApi {
    public String libraryMethod() {
        return "library";
    }

    public static ExternalApi libraryFactory() {
        return new ExternalApi();
    }
}
`;

const events = [];
const guard = new PathGuard();
guard.register(root);
const settings = { get: () => ({ jdkPath: "" }) };
const projects = new ProjectService(guard, settings, path.join(process.cwd(), "resources", "toolchain"));
const language = new LanguageService(
  guard,
  projects,
  path.join(process.cwd(), "resources", "toolchain"),
  userData,
  (channel, payload) => events.push({ channel, payload }),
);
const modules = new ModuleService(guard, projects);
const refactors = new JavaRefactorService(
  guard,
  { beginOperation: async () => null, endOperation: () => true, invalidate: () => undefined },
  modules,
  language,
);

try {
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.mkdir(libraryDirectory, { recursive: true });
  const externalSourceDirectory = path.join(libraryBuild, "src", "external", "lib");
  const externalClasses = path.join(libraryBuild, "classes");
  const externalSourceFile = path.join(externalSourceDirectory, "ExternalApi.java");
  await fs.mkdir(externalSourceDirectory, { recursive: true });
  await fs.mkdir(externalClasses, { recursive: true });
  await fs.writeFile(externalSourceFile, externalSource, "utf8");

  const compilerJdk = await projects.detectJdk(root);
  assert.equal(compilerJdk.available, true, "No JDK is available for the JDT LS library smoke test.");
  await spawnCapture(compilerJdk.javac, ["-d", externalClasses, externalSourceFile], {
    cwd: libraryBuild,
    rejectOnError: true,
  });
  const jarCommand = compilerJdk.path
    ? path.join(compilerJdk.path, "bin", process.platform === "win32" ? "jar.exe" : "jar")
    : process.platform === "win32" ? "jar.exe" : "jar";
  await spawnCapture(jarCommand, ["--create", "--file", libraryFile, "-C", externalClasses, "."], {
    cwd: libraryBuild,
    rejectOnError: true,
  });

  await fs.writeFile(sourceFile, source, "utf8");
  await fs.writeFile(personFile, personSource, "utf8");
  const [started, concurrentStart] = await Promise.all([
    language.start(root),
    language.start(root),
  ]);
  assert.equal(started.available, true, started.reason);
  assert.equal(concurrentStart.available, true, concurrentStart.reason);
  assert.ok(
    started.project?.referencedLibraries?.includes("libs/external-api.jar"),
    "The Java project model did not add libs/external-api.jar to referenced libraries.",
  );
  await language.open(root, sourceFile, source, "java");
  await language.open(root, personFile, personSource, "java");
  await waitFor(() => events.some((event) => event.channel === "language:diagnostics"), 20_000);

  const uri = pathToFileURL(sourceFile).toString();
  const typePrefixSource = source.replace(
    '        String message = "Kiwi";',
    "        Syst",
  );
  await language.change(root, sourceFile, typePrefixSource);
  const typePrefixCompletion = await retryCompletion(() => language.request(root, "textDocument/completion", {
    textDocument: { uri },
    position: positionAfter(typePrefixSource, "        Syst"),
    context: { triggerKind: 1 },
  }), ["System"]);
  assertCompletionLabels(typePrefixCompletion, ["System"], "JDK type prefixes");

  const systemMemberSource = source.replace(
    "        System.out.println(message);",
    "        System.",
  );
  await language.change(root, sourceFile, systemMemberSource);
  const systemMemberCompletion = await retryCompletion(() => language.request(root, "textDocument/completion", {
    textDocument: { uri },
    position: positionAfter(systemMemberSource, "        System."),
    context: { triggerKind: 2, triggerCharacter: "." },
  }), ["currentTimeMillis", "getProperty", "out"]);
  assertCompletionLabels(
    systemMemberCompletion,
    ["currentTimeMillis", "getProperty", "out"],
    "java.lang.System members",
  );
  assertCompletionMetadata(systemMemberCompletion, "getProperty", "java.lang.System member");

  const memberSource = source.replace(
    "        System.out.println(person.displayName());",
    "        person.",
  );
  await language.change(root, sourceFile, memberSource);
  const memberCompletion = await retryCompletion(() => language.request(root, "textDocument/completion", {
    textDocument: { uri },
    position: positionAfter(memberSource, "        person."),
    context: { triggerKind: 2, triggerCharacter: "." },
  }), ["displayName", "rename"]);
  assertCompletionLabels(memberCompletion, ["displayName", "rename"], "own class members");
  assertCompletionMetadata(memberCompletion, "displayName", "own class member");

  const staticMemberSource = source.replace(
    "        System.out.println(person.displayName());",
    "        Person.",
  );
  await language.change(root, sourceFile, staticMemberSource);
  const staticMemberCompletion = await retryCompletion(() => language.request(root, "textDocument/completion", {
    textDocument: { uri },
    position: positionAfter(staticMemberSource, "        Person."),
    context: { triggerKind: 2, triggerCharacter: "." },
  }), ["create"]);
  assertCompletionLabels(staticMemberCompletion, ["create"], "own static class members");

  const librarySource = source.replace(
    "        System.out.println(api.libraryMethod());",
    "        api.",
  );
  await language.change(root, sourceFile, librarySource);
  const libraryCompletion = await retryCompletion(() => language.request(root, "textDocument/completion", {
    textDocument: { uri },
    position: positionAfter(librarySource, "        api."),
    context: { triggerKind: 2, triggerCharacter: "." },
  }), ["libraryMethod"]);
  assertCompletionLabels(libraryCompletion, ["libraryMethod"], "external JAR members");
  assertCompletionMetadata(libraryCompletion, "libraryMethod", "external JAR member");

  const staticLibrarySource = source.replace(
    "        System.out.println(api.libraryMethod());",
    "        ExternalApi.",
  );
  await language.change(root, sourceFile, staticLibrarySource);
  const staticLibraryCompletion = await retryCompletion(() => language.request(root, "textDocument/completion", {
    textDocument: { uri },
    position: positionAfter(staticLibrarySource, "        ExternalApi."),
    context: { triggerKind: 2, triggerCharacter: "." },
  }), ["libraryFactory"]);
  assertCompletionLabels(staticLibraryCompletion, ["libraryFactory"], "external static JAR members");

  const missingImportSource = source.replace(
    "public class Main {",
    "public class Main {\n    private List<String> names;",
  );
  await language.change(root, sourceFile, missingImportSource);
  await waitFor(
    () => diagnosticsFor(uri).some((diagnostic) => /List/.test(diagnostic.message)),
    20_000,
    "missing-import diagnostic",
  );
  const importDiagnostic = diagnosticsFor(uri).find((diagnostic) => /List/.test(diagnostic.message));
  const importActions = await retryRequest(() => language.request(root, "textDocument/codeAction", {
    textDocument: { uri },
    range: importDiagnostic.range,
    context: { diagnostics: [importDiagnostic], triggerKind: 1 },
  }));
  const importAction = (importActions || []).find((action) => /import.*List|List.*import/i.test(action.title));
  assert.ok(
    importAction,
    `JDT LS returned no List import fix: ${codeActionTitles(importActions).join(", ")}`,
  );
  const resolvedImportAction = importAction.edit || importAction.command
    ? importAction
    : await language.request(root, "codeAction/resolve", importAction);
  assert.ok(
    resolvedImportAction.edit || resolvedImportAction.command,
    "The List import quick fix could not be resolved to an executable action.",
  );

  const unimplementedSource = source.replace(
    "public class Main {",
    "public class Main implements Runnable {",
  );
  await language.change(root, sourceFile, unimplementedSource);
  await waitFor(
    () => diagnosticsFor(uri).some((diagnostic) => /inherited abstract method|implement/i.test(diagnostic.message)),
    20_000,
    "unimplemented-method diagnostic",
  );
  const implementationDiagnostic = diagnosticsFor(uri).find((diagnostic) =>
    /inherited abstract method|implement/i.test(diagnostic.message),
  );
  const implementationActions = await retryRequest(() => language.request(root, "textDocument/codeAction", {
    textDocument: { uri },
    range: implementationDiagnostic.range,
    context: { diagnostics: [implementationDiagnostic], triggerKind: 1 },
  }));
  const implementationAction = (implementationActions || []).find((action) =>
    /unimplemented|implement inherited|implement methods/i.test(action.title),
  );
  assert.ok(
    implementationAction,
    `JDT LS returned no implementation fix: ${codeActionTitles(implementationActions).join(", ")}`,
  );
  const resolvedImplementationAction = implementationAction.edit || implementationAction.command
    ? implementationAction
    : await language.request(root, "codeAction/resolve", implementationAction);
  assert.ok(
    resolvedImplementationAction.edit || resolvedImplementationAction.command,
    "The inherited-method quick fix could not be resolved to an executable action.",
  );

  await language.change(root, sourceFile, source);

  const changeSignaturePosition = positionInside(personSource, "void rename", "rename");
  const changeSignatureActions = await retryRequest(() => language.request(root, "textDocument/codeAction", {
    textDocument: { uri: pathToFileURL(personFile).toString() },
    range: { start: changeSignaturePosition, end: changeSignaturePosition },
    context: { diagnostics: [], only: ["refactor.rewrite"], triggerKind: 1 },
  }));
  assert.ok(
    (changeSignatureActions || []).some((action) =>
      action.kind === "refactor.change.signature" && action.command?.command === "java.action.applyRefactoringCommand",
    ),
    `JDT LS returned no semantic Change Signature action: ${codeActionTitles(changeSignatureActions).join(", ")}`,
  );
  const preparedSignature = await refactors.prepareChangeSignature(root, personFile, changeSignaturePosition);
  assert.equal(preparedSignature.available, true, preparedSignature.reason);
  assert.equal(preparedSignature.signature.name, "rename");
  const signaturePreview = await refactors.previewChangeSignature(root, {
    file: personFile,
    position: changeSignaturePosition,
    newName: "setName",
    parameters: [{ sourceIndex: 0, type: "String", name: "value" }],
  });
  assert.equal(signaturePreview.blocked, false, signaturePreview.blockedReasons.join(" "));
  assert.ok(
    signaturePreview.files.some((file) => file.path === personFile && file.after.includes("void setName(String value)")),
    "Kiwi did not preview the Change Signature declaration edit.",
  );
  assert.ok(
    signaturePreview.files.some((file) => file.path === sourceFile && file.after.includes("person.setName(message)")),
    "Kiwi did not preview the semantic Change Signature call-site edit.",
  );

  const definition = await retryRequest(() => language.request(root, "textDocument/definition", {
    textDocument: { uri },
    position: positionInside(source, "person.displayName", "displayName"),
  }));
  assert.ok(definition, "JDT LS returned no definition.");

  const references = await retryRequest(() => language.request(root, "textDocument/references", {
    textDocument: { uri },
    position: positionInside(source, "person.displayName", "displayName"),
    context: { includeDeclaration: true },
  }));
  assert.ok(Array.isArray(references) && references.length >= 2, "JDT LS returned no grouped Find Usages locations.");

  const personUri = pathToFileURL(personFile).toString();
  const callItems = await retryRequest(() => language.request(root, "textDocument/prepareCallHierarchy", {
    textDocument: { uri: personUri },
    position: positionInside(personSource, "String displayName", "displayName"),
  }));
  assert.ok(Array.isArray(callItems) && callItems.length, "JDT LS returned no Call Hierarchy root.");
  const incomingCalls = await retryRequest(() => language.request(root, "callHierarchy/incomingCalls", { item: callItems[0] }));
  assert.ok(
    Array.isArray(incomingCalls) && incomingCalls.some((call) => call.from?.name?.startsWith("main(")),
    `Call Hierarchy did not contain Main.main: ${JSON.stringify(incomingCalls)}`,
  );

  const typeItems = await retryRequest(() => language.request(root, "textDocument/prepareTypeHierarchy", {
    textDocument: { uri: personUri },
    position: positionInside(personSource, "class Person", "Person"),
  }));
  assert.ok(Array.isArray(typeItems) && typeItems.length, "JDT LS returned no Type Hierarchy root.");
  const supertypes = await retryRequest(() => language.request(root, "typeHierarchy/supertypes", { item: typeItems[0] }));
  assert.ok(Array.isArray(supertypes) && supertypes.some((item) => item.name === "Named"), "Type Hierarchy did not contain the Named interface.");

  const rename = await retryRequest(() => language.request(root, "textDocument/rename", {
    textDocument: { uri },
    position: positionInside(source, "String message", "message"),
    newName: "headline",
  }));
  assert.ok(rename?.changes || rename?.documentChanges, "JDT LS returned no rename edit.");

  console.log(
    `JDT LS smoke passed: JDK/own/library members, imports, implementations, definition, usages, hierarchies, rename and Change Signature available`
    + ` (${completionItems(typePrefixCompletion).length + completionItems(systemMemberCompletion).length
      + completionItems(memberCompletion).length + completionItems(staticMemberCompletion).length
      + completionItems(libraryCompletion).length + completionItems(staticLibraryCompletion).length} proposals).`,
  );
} finally {
  await language.stop();
  try {
    const workspacesRoot = path.join(userData, "jdtls-workspaces");
    const workspaces = await fs.readdir(workspacesRoot, { withFileTypes: true }).catch(() => []);
    const logs = await Promise.all(workspaces
      .filter((entry) => entry.isDirectory())
      .map((entry) => fs.readFile(path.join(workspacesRoot, entry.name, ".metadata", ".log"), "utf8").catch(() => "")));
    assert.doesNotMatch(
      logs.join("\n"),
      /Missing system library|Failed to import projects|options is null|PreferenceManager\.getPreferences/i,
      "JDT LS wrote a known import, classpath or shutdown race to its runtime log.",
    );
  } finally {
    await removeWithRetry(root);
    await removeWithRetry(userData);
    await removeWithRetry(libraryBuild);
  }
}

async function retryRequest(factory) {
  let last;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await factory();
      if (result && (!Array.isArray(result) || result.length)) return result;
      last = result;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (last instanceof Error) throw last;
  return last;
}

async function retryCompletion(factory, expectedLabels) {
  let last;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      last = await factory();
      const labels = completionItems(last).map(completionLabel);
      if (expectedLabels.every((expected) => labels.some((label) => label.startsWith(expected)))) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (last instanceof Error) throw last;
  return last;
}

function completionItems(result) {
  return Array.isArray(result) ? result : result?.items || [];
}

function completionLabel(item) {
  return typeof item?.label === "string" ? item.label : item?.label?.label || "";
}

function diagnosticsFor(uri) {
  return events
    .filter((event) => event.channel === "language:diagnostics" && event.payload?.uri === uri)
    .at(-1)?.payload?.diagnostics || [];
}

function codeActionTitles(result) {
  return (Array.isArray(result) ? result : []).map((action) => String(action?.title || ""));
}

function assertCompletionLabels(result, expectedLabels, description) {
  const labels = completionItems(result).map(completionLabel);
  const diagnostics = events
    .filter((event) => event.channel === "language:diagnostics")
    .flatMap((event) => event.payload?.diagnostics || [])
    .map((diagnostic) => diagnostic.message)
    .slice(-12);
  for (const expected of expectedLabels) {
    assert.ok(
      labels.some((label) => label.startsWith(expected)),
      `JDT LS did not return ${description}: ${expected}. Received: ${labels.slice(0, 30).join(", ")}`
      + `\nDiagnostics: ${diagnostics.join(" | ")}`,
    );
  }
}

function assertCompletionMetadata(result, expectedLabel, description) {
  const item = completionItems(result).find((candidate) => completionLabel(candidate).startsWith(expectedLabel));
  const metadata = [
    item?.detail,
    item?.labelDetails?.detail,
    item?.labelDetails?.description,
    item?.documentation,
  ].filter(Boolean);
  assert.ok(
    metadata.length > 0,
    `JDT LS returned ${description} ${expectedLabel} without signature, type, origin or documentation data.`,
  );
}

function positionAfter(sourceText, needle) {
  const index = sourceText.indexOf(needle);
  assert.notEqual(index, -1, `Marker not found: ${needle}`);
  return positionAt(sourceText, index + needle.length);
}

function positionInside(sourceText, occurrence, token) {
  const occurrenceIndex = sourceText.indexOf(occurrence);
  assert.notEqual(occurrenceIndex, -1, `Occurrence not found: ${occurrence}`);
  return positionAt(sourceText, occurrenceIndex + occurrence.indexOf(token) + 1);
}

function positionAt(sourceText, offset) {
  const prefix = sourceText.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
}

async function waitFor(predicate, timeout, label = "JDT LS diagnostics") {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function removeWithRetry(target) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}
