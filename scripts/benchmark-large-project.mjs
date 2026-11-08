import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { PathGuard } = require("../electron/services/path-guard.cjs");
const { WorkspaceService } = require("../electron/services/workspace-service.cjs");
const { discoverJavaProjectModel } = require("../electron/services/java-project-model.cjs");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiwi-large-project-"));
const moduleCount = 24;
const filesPerModule = 50;

try {
  await Promise.all(Array.from({ length: moduleCount }, async (_, moduleIndex) => {
    const source = path.join(root, `module-${moduleIndex + 1}`, "src", "main", "java", "dev", "kiwi", `m${moduleIndex + 1}`);
    await fs.mkdir(source, { recursive: true });
    await Promise.all(Array.from({ length: filesPerModule }, (_, fileIndex) =>
      fs.writeFile(
        path.join(source, `Type${fileIndex + 1}.java`),
        `package dev.kiwi.m${moduleIndex + 1};\npublic class Type${fileIndex + 1} { public int value() { return ${fileIndex}; } }\n`,
        "utf8",
      ),
    ));
  }));

  const guard = new PathGuard();
  guard.register(root);
  const workspace = new WorkspaceService(guard, { trashItem: async () => {}, showItemInFolder: () => {} }, () => {});

  const treeStarted = performance.now();
  const tree = await workspace.readTree(root);
  const treeMs = performance.now() - treeStarted;

  const warmTreeIterations = 25;
  const warmTreeStarted = performance.now();
  let warmTree = [];
  for (let iteration = 0; iteration < warmTreeIterations; iteration += 1) {
    warmTree = await workspace.readTree(root);
  }
  const warmTreeMs = (performance.now() - warmTreeStarted) / warmTreeIterations;

  const deepExpansionStarted = performance.now();
  let expandedDirectories = 0;
  let expandedEntries = 0;
  for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
    let current = path.join(root, `module-${moduleIndex + 1}`);
    for (const segment of ["src", "main", "java", "dev", "kiwi", `m${moduleIndex + 1}`]) {
      const children = await workspace.readChildren(root, current);
      expandedDirectories += 1;
      expandedEntries += children.length;
      const next = children.find((entry) => entry.type === "directory" && entry.name === segment);
      assert.ok(next, `Deep Explorer expansion lost ${segment} below ${current}`);
      current = next.path;
    }
    const leaf = await workspace.readChildren(root, current);
    expandedDirectories += 1;
    expandedEntries += leaf.length;
    assert.equal(leaf.filter((entry) => entry.type === "file").length, filesPerModule);
  }
  const deepExpansionMs = performance.now() - deepExpansionStarted;

  const modelStarted = performance.now();
  const model = await discoverJavaProjectModel(root);
  const modelMs = performance.now() - modelStarted;

  const warmModelStarted = performance.now();
  const warmModel = await discoverJavaProjectModel(root);
  const warmModelMs = performance.now() - warmModelStarted;

  const changedDirectory = path.join(root, "module-1", "src", "main", "java", "dev", "kiwi", "m1");
  await fs.writeFile(
    path.join(changedDirectory, "AddedType.java"),
    "package dev.kiwi.m1;\npublic class AddedType { public int value() { return 51; } }\n",
    "utf8",
  );
  workspace.invalidate(root);
  const incrementalTreeStarted = performance.now();
  const incrementalTree = await workspace.readChildren(root, changedDirectory);
  const incrementalTreeMs = performance.now() - incrementalTreeStarted;
  const incrementalModelStarted = performance.now();
  const incrementalModel = await discoverJavaProjectModel(root);
  const incrementalModelMs = performance.now() - incrementalModelStarted;
  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;

  assert.equal(tree.length, moduleCount);
  assert.equal(warmTree.length, moduleCount);
  assert.equal(model.javaFiles.length, moduleCount * filesPerModule);
  assert.equal(warmModel.javaFiles.length, moduleCount * filesPerModule);
  assert.equal(incrementalModel.javaFiles.length, moduleCount * filesPerModule + 1);
  assert.ok(incrementalTree.some((entry) => entry.name === "AddedType.java"));
  assert.equal(expandedDirectories, moduleCount * 7);
  assert.ok(expandedEntries >= moduleCount * (filesPerModule + 6));
  assert.ok(treeMs < 5_000, `Lazy Explorer tree took ${treeMs.toFixed(0)} ms`);
  assert.ok(warmTreeMs < 1_000, `Warm Explorer cache took ${warmTreeMs.toFixed(0)} ms per read`);
  assert.ok(deepExpansionMs < 10_000, `Deep Explorer expansion took ${deepExpansionMs.toFixed(0)} ms`);
  assert.ok(modelMs < 15_000, `Java project discovery took ${modelMs.toFixed(0)} ms`);
  assert.ok(warmModelMs < 15_000, `Warm Java project discovery took ${warmModelMs.toFixed(0)} ms`);
  assert.ok(incrementalTreeMs < 1_000, `Incremental Explorer refresh took ${incrementalTreeMs.toFixed(0)} ms`);
  assert.ok(incrementalModelMs < 15_000, `Incremental project discovery took ${incrementalModelMs.toFixed(0)} ms`);
  assert.ok(heapMb < 300, `Benchmark used ${heapMb.toFixed(0)} MB heap`);

  console.log(JSON.stringify({
    modules: moduleCount,
    javaFiles: incrementalModel.javaFiles.length,
    explorerTreeMs: Math.round(treeMs),
    warmExplorerCacheMs: Number(warmTreeMs.toFixed(2)),
    deepExpansionMs: Math.round(deepExpansionMs),
    expandedDirectories,
    projectDiscoveryMs: Math.round(modelMs),
    warmProjectDiscoveryMs: Math.round(warmModelMs),
    incrementalExplorerMs: Number(incrementalTreeMs.toFixed(2)),
    incrementalProjectDiscoveryMs: Math.round(incrementalModelMs),
    heapMb: Math.round(heapMb),
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
