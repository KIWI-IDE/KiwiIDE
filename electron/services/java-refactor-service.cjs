const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { maskSourceComments, maskXmlComments, maskXmlElement, topLevelBlockBody } = require("./source-text.cjs");

const JAVA_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const PACKAGE_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const METHOD_KINDS = new Set([6, 9]);
const PRIVATE_ANALYSIS_KINDS = new Set([5, 6, 7, 8, 10, 11, 12, 23]);
const PLAN_TTL_MS = 15 * 60 * 1000;

/**
 * Semantic Java refactorings that do not depend on VS Code's Java extension.
 *
 * JDT LS resolves symbols and references. Kiwi turns those semantic locations
 * into an inspectable, hash-protected WorkspaceEdit and applies it as one Local
 * History transaction. This is important because JDT's
 * `java.action.applyRefactoringCommand` is deliberately a client-delegated
 * command and therefore cannot be executed by a bare LSP client.
 */
class JavaRefactorService {
  constructor(pathGuard, workspace, modules, language) {
    this.pathGuard = pathGuard;
    this.workspace = workspace;
    this.modules = modules;
    this.language = language;
    this.plans = new Map();
    this.unusedCache = new Map();
  }

  async previewMove(root, request) {
    root = this.pathGuard.assertWorkspace(root);
    const sourcePath = this.pathGuard.assertAllowed(request?.sourcePath, root);
    if (!/\.java$/i.test(sourcePath)) throw new Error("Nur Java-Quelldateien können sicher zwischen Modulen verschoben werden.");
    const moduleList = await this.modules.list(root);
    const sourceModule = moduleForPath(sourcePath, moduleList);
    const targetModule = moduleList.find((module) => module.id === request?.targetModuleId);
    if (!sourceModule) throw new Error("Die Quelldatei gehört zu keinem erkannten Modul.");
    if (!targetModule) throw new Error("Das Zielmodul wurde nicht gefunden.");

    const sourceKind = sourceKindForPath(sourcePath, sourceModule);
    if (sourceKind === "resource") throw new Error("Die Datei liegt nicht in einem Java-Source-Root.");
    const targetRoots = sourceKind === "test" ? targetModule.testRoots : targetModule.sourceRoots;
    const requestedRoot = request?.targetSourceRoot
      ? this.pathGuard.assertAllowed(request.targetSourceRoot, root)
      : targetRoots[0];
    if (!requestedRoot || !targetRoots.some((candidate) => samePath(candidate, requestedRoot))) {
      throw new Error(`Das Zielmodul besitzt keinen passenden ${sourceKind === "test" ? "Test-" : "Produktions-"}Source-Root.`);
    }
    if (sourceKind === "production" && request?.targetKind === "test") {
      throw new Error("Produktionscode darf nicht unbemerkt in einen Test-Source-Root verschoben werden.");
    }

    const source = await fs.readFile(sourcePath, "utf8");
    const declaration = topLevelType(source, path.basename(sourcePath, ".java"));
    if (!declaration) throw new Error("In der Datei wurde kein passender Top-Level-Java-Typ gefunden.");
    const oldPackage = javaPackage(source);
    const targetPackage = String(request?.targetPackage ?? oldPackage).trim();
    if (targetPackage && !PACKAGE_NAME.test(targetPackage)) throw new Error("Der Ziel-Package-Name ist ungültig.");
    const targetDirectory = path.join(requestedRoot, ...targetPackage.split(".").filter(Boolean));
    const targetPath = this.pathGuard.assertAllowed(path.join(targetDirectory, path.basename(sourcePath)), root);
    if (samePath(sourcePath, targetPath)) throw new Error("Quelle und Ziel sind identisch.");
    if (fsSync.existsSync(targetPath)) throw new Error("Im Ziel-Package existiert bereits eine Datei mit diesem Namen.");
    assertCompatibleLanguageLevels(sourceModule, targetModule, source);

    await this.ensureOpen(root, sourcePath, source);
    const references = await this.references(root, sourcePath, declaration.position);
    const oldQualifiedName = oldPackage ? `${oldPackage}.${declaration.name}` : declaration.name;
    const newQualifiedName = targetPackage ? `${targetPackage}.${declaration.name}` : declaration.name;
    const referencePaths = unique(references.map(locationPath).filter((candidate) => isInside(candidate, root)));
    const fileChanges = new Map();
    const warnings = [];
    const blockedReasons = [];

    for (const file of unique([sourcePath, ...referencePaths])) {
      const before = await fs.readFile(file, "utf8").catch(() => "");
      let after = before;
      if (samePath(file, sourcePath)) {
        after = replaceJavaPackage(after, targetPackage);
      } else if (oldQualifiedName !== newQualifiedName) {
        after = after.replace(new RegExp(`\\b${escapeRegExp(oldQualifiedName)}\\b`, "g"), newQualifiedName);
        const classification = referenceLocationsForFile(references, file);
        if (classification.length && javaPackage(after) === oldPackage && oldPackage !== targetPackage) {
          const conflictingImport = javaImports(after).find((entry) => entry.endsWith(`.${declaration.name}`) && entry !== newQualifiedName);
          if (conflictingImport) {
            blockedReasons.push(`${path.relative(root, file)} importiert bereits einen anderen Typ namens ${declaration.name}.`);
          } else {
            after = addJavaImport(after, newQualifiedName);
          }
        }
        if (javaPackage(after) === targetPackage) after = removeJavaImport(after, newQualifiedName);
      }
      setFileChange(fileChanges, file, before, after, "java");
    }

    const refScopes = referenceModuleScopes(
      references.filter((reference) => !samePath(locationPath(reference), sourcePath)),
      moduleList,
      targetModule.id,
    );
    const dependencyGraph = await readModuleDependencyGraph(root, moduleList);
    const buildChanges = [];
    for (const [moduleId, scope] of refScopes) {
      const referringModule = moduleList.find((module) => module.id === moduleId);
      if (!referringModule || graphHasEdge(dependencyGraph, moduleId, targetModule.id)) continue;
      if (graphHasPath(dependencyGraph, targetModule.id, moduleId)) {
        blockedReasons.push(`Die Verschiebung würde eine Modulschleife erzeugen: ${referringModule.name} ↔ ${targetModule.name}.`);
        continue;
      }
      const dependencyChange = await addModuleDependency(root, referringModule, targetModule, scope, moduleList);
      if (!dependencyChange) {
        blockedReasons.push(`Die Abhängigkeit ${referringModule.name} → ${targetModule.name} konnte im Buildmodell nicht sicher ergänzt werden.`);
        continue;
      }
      setFileChange(fileChanges, dependencyChange.path, dependencyChange.before, dependencyChange.after, "build-model");
      buildChanges.push({
        path: dependencyChange.path,
        moduleId,
        targetModuleId: targetModule.id,
        scope,
      });
      addGraphEdge(dependencyGraph, moduleId, targetModule.id);
    }

    await addJpmsMoveChanges(
      root,
      sourceModule,
      targetModule,
      oldPackage,
      targetPackage,
      sourcePath,
      fileChanges,
      blockedReasons,
      refScopes,
      moduleList,
    );
    if (!references.length) warnings.push("JDT LS hat keine Referenzen gemeldet; nur die Quelldatei wird verschoben.");
    if (oldPackage === targetPackage && sourceModule.id !== targetModule.id) {
      warnings.push("Das Package bleibt unverändert; nur Modul- und Buildzuordnung ändern sich.");
    }

    const workspaceEdit = workspaceEditFromChanges(fileChanges, [{ kind: "rename", oldPath: sourcePath, newPath: targetPath }]);
    return this.storePlan(root, {
      type: "move-class",
      title: `${declaration.name} nach ${targetModule.name} verschieben`,
      workspaceEdit,
      changes: [...fileChanges.values()],
      resources: [{ kind: "rename", oldPath: sourcePath, newPath: targetPath }],
      warnings,
      blockedReasons,
      affectedCallSites: await callSites(root, references),
      buildModelChanges: buildChanges,
      sourceModuleId: sourceModule.id,
      targetModuleId: targetModule.id,
      sourcePath,
      targetPath,
    });
  }

  /** Returns JDT's Change Signature action plus the declaration model Kiwi needs for its form. */
  async prepareChangeSignature(root, file, position) {
    root = this.pathGuard.assertWorkspace(root);
    file = this.pathGuard.assertAllowed(file, root);
    const source = await fs.readFile(file, "utf8");
    await this.ensureOpen(root, file, source);
    const uri = pathToFileURL(file).toString();
    const symbols = await this.language.request(root, "textDocument/documentSymbol", { textDocument: { uri } });
    const symbol = methodSymbolAt(symbols, position);
    const signature = parseMethodSignature(source, symbol, position);
    if (!signature) throw new Error("An dieser Position wurde keine Java-Methode oder kein Konstruktor gefunden.");
    const actions = await this.language.request(root, "textDocument/codeAction", {
      textDocument: { uri },
      range: { start: position, end: position },
      context: { diagnostics: [], only: ["refactor.rewrite"], triggerKind: 1 },
    });
    const jdtAction = (actions || []).find((action) =>
      action?.kind === "refactor.change.signature" || /change signature|signatur ändern/i.test(String(action?.title || "")),
    ) || null;
    const references = await this.references(root, file, signature.namePosition);
    return {
      available: Boolean(jdtAction),
      reason: jdtAction ? "" : "JDT LS bietet für dieses Symbol kein Change-Signature-Refactoring an.",
      jdtAction,
      signature: publicSignature(signature),
      affectedCallSites: await callSites(root, references),
    };
  }

  /**
   * Creates the missing client side of JDT's delegated Change Signature action.
   * JDT supplies overload-safe references; Kiwi rewrites exactly those calls.
   */
  async previewChangeSignature(root, request) {
    root = this.pathGuard.assertWorkspace(root);
    const file = this.pathGuard.assertAllowed(request?.file, root);
    const source = await fs.readFile(file, "utf8");
    await this.ensureOpen(root, file, source);
    const uri = pathToFileURL(file).toString();
    const position = request?.position;
    if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.character)) {
      throw new Error("Die Methodenposition fehlt.");
    }
    const symbols = await this.language.request(root, "textDocument/documentSymbol", { textDocument: { uri } });
    const symbol = methodSymbolAt(symbols, position);
    const current = parseMethodSignature(source, symbol, position);
    if (!current) throw new Error("Die Methodensignatur konnte nicht gelesen werden.");
    const next = validateSignatureRequest(current, request);
    const references = await this.references(root, file, current.namePosition);
    const locations = uniqueLocations([
      ...references,
      { uri, range: current.nameRange },
    ]);
    const editsByFile = new Map();
    const affected = [];
    const blockedReasons = [];
    const warnings = [];
    const parametersChanged = !sameParameters(current.parameters, next.parameters);

    for (const location of locations) {
      const targetFile = locationPath(location);
      if (!isInside(targetFile, root)) continue;
      const content = await fs.readFile(targetFile, "utf8").catch(() => "");
      const locationStart = offsetAt(content, location.range.start);
      const locationEnd = offsetAt(content, location.range.end);
      const nameWithinRange = content.slice(locationStart, Math.max(locationEnd, locationStart + current.name.length)).indexOf(current.name);
      const nameStart = nameWithinRange >= 0 ? locationStart + nameWithinRange : locationStart;
      const nameEnd = nameStart + current.name.length;
      const isDeclaration = samePath(targetFile, file)
        && rangesOverlap(location.range, current.nameRange);
      const relatedDeclaration = !isDeclaration && looksLikeMethodDeclaration(content, nameStart)
        ? parseMethodSignature(content, null, location.range.start)
        : null;
      const edits = editsByFile.get(targetFile) || [];
      if (isDeclaration) {
        edits.push({ start: current.headerStart, end: current.headerEnd, text: renderMethodHeader(current, next) });
      } else if (relatedDeclaration) {
        const relatedNext = {
          ...relatedDeclaration,
          name: next.name,
          returnType: next.returnType || relatedDeclaration.returnType,
          parameters: next.parameters.map((parameter) => ({
            ...parameter,
            name: parameter.name,
            type: parameter.type,
          })),
        };
        edits.push({
          start: relatedDeclaration.headerStart,
          end: relatedDeclaration.headerEnd,
          text: renderMethodHeader(relatedDeclaration, relatedNext),
        });
      } else {
        if (next.name !== current.name) edits.push({ start: nameStart, end: nameEnd, text: next.name });
        const call = parseInvocationAt(content, nameEnd);
        if (parametersChanged) {
          if (!call) {
            blockedReasons.push(`${path.relative(root, targetFile)}:${location.range.start.line + 1} ist eine Methodenreferenz oder kein sicher änderbarer Aufruf.`);
          } else {
            const reordered = next.parameters.map((parameter) =>
              parameter.sourceIndex == null ? parameter.defaultValue : call.arguments[parameter.sourceIndex],
            );
            if (reordered.some((argument) => argument == null)) {
              blockedReasons.push(`${path.relative(root, targetFile)}:${location.range.start.line + 1} besitzt nicht die erwartete Argumentanzahl.`);
            } else {
              edits.push({ start: call.argumentsStart, end: call.argumentsEnd, text: reordered.join(", ") });
            }
          }
        }
        affected.push(await callSite(root, location));
      }
      editsByFile.set(targetFile, edits);
    }

    if (!references.length) warnings.push("JDT LS hat keine Aufrufstellen gemeldet.");
    const changes = new Map();
    for (const [targetFile, edits] of editsByFile) {
      const before = await fs.readFile(targetFile, "utf8");
      const after = applyOffsetEdits(before, edits);
      setFileChange(changes, targetFile, before, after, "java");
    }
    const workspaceEdit = workspaceEditFromChanges(changes, []);
    return this.storePlan(root, {
      type: "change-signature",
      title: `Signatur ändern: ${current.name}`,
      workspaceEdit,
      changes: [...changes.values()],
      resources: [],
      warnings,
      blockedReasons,
      affectedCallSites: affected.filter(Boolean),
      beforeSignature: publicSignature(current),
      afterSignature: publicSignature(next),
      buildModelChanges: [],
    });
  }

  /** Builds a preview around a WorkspaceEdit returned directly by JDT. */
  async previewWorkspaceEdit(root, title, edit, context = {}) {
    root = this.pathGuard.assertWorkspace(root);
    const converted = await changesFromWorkspaceEdit(root, edit, this.pathGuard);
    const references = context.file && context.position
      ? await this.references(root, context.file, context.position)
      : [];
    return this.storePlan(root, {
      type: context.type || "jdt-workspace-edit",
      title: title || "Java-Refactoring",
      workspaceEdit: edit,
      changes: converted.changes,
      resources: converted.resources,
      warnings: converted.warnings,
      blockedReasons: [],
      affectedCallSites: await callSites(root, references),
      buildModelChanges: [],
    });
  }

  async applyPlan(root, planId) {
    root = this.pathGuard.assertWorkspace(root);
    const plan = this.plans.get(planId);
    if (!plan || !samePath(plan.root, root) || Date.now() - plan.createdAtMs > PLAN_TTL_MS) {
      this.plans.delete(planId);
      throw new Error("Die Refactoring-Vorschau ist abgelaufen. Bitte erneut prüfen.");
    }
    if (plan.blockedReasons.length) throw new Error(`Das Refactoring ist blockiert: ${plan.blockedReasons.join(" ")}`);
    await validatePlanFiles(root, plan, this.pathGuard);
    const touched = unique([
      ...plan.changes.map((change) => change.path),
      ...plan.resources.flatMap((resource) => [resource.oldPath, resource.newPath]).filter(Boolean),
    ]);
    const snapshots = await snapshotPaths(touched);
    await this.workspace.beginOperation(root, plan.title, touched);
    try {
      for (const resource of plan.resources) {
        if (resource.kind !== "rename") throw new Error(`Nicht unterstützte Ressourcenänderung: ${resource.kind}`);
        await fs.mkdir(path.dirname(resource.newPath), { recursive: true });
        await fs.rename(resource.oldPath, resource.newPath);
      }
      for (const change of plan.changes) {
        const target = renamedPath(change.path, plan.resources);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, change.after, "utf8");
      }
    } catch (error) {
      await restoreSnapshots(snapshots);
      throw error;
    } finally {
      this.workspace.endOperation(root);
    }
    this.plans.delete(planId);
    this.workspace.invalidate?.(root);
    this.workspace.send?.("workspace:changed", { root, path: plan.resources[0]?.newPath || plan.changes[0]?.path || root, paths: touched, kind: "rename" });
    await this.language.refresh(root, plan.resources[0]?.newPath || plan.changes[0]?.path).catch(() => false);
    return { applied: true, id: planId, files: touched, targetPath: plan.resources[0]?.newPath || null };
  }

  async analyzeUnusedPrivate(root, options = {}) {
    root = this.pathGuard.assertWorkspace(root);
    const moduleList = await this.modules.list(root);
    const files = await collectJavaFiles(root, moduleList, this.pathGuard, options.maxFiles || 10_000);
    const fingerprint = await fileFingerprint(files);
    const cached = this.unusedCache.get(root);
    if (!options.force && cached?.fingerprint === fingerprint) return { ...cached.result, cached: true };
    await this.language.start(root);
    const findings = [];
    let analysedDeclarations = 0;
    let skippedReflective = 0;
    const concurrency = Math.max(1, Math.min(6, Number(options.concurrency) || 4));

    await concurrentMap(files, concurrency, async (file) => {
      const source = await fs.readFile(file, "utf8").catch(() => "");
      if (!source) return;
      const uri = pathToFileURL(file).toString();
      let symbols = [];
      try {
        symbols = await this.language.request(root, "textDocument/documentSymbol", { textDocument: { uri } }) || [];
      } catch {
        return;
      }
      for (const symbol of flattenSymbols(symbols)) {
        if (!PRIVATE_ANALYSIS_KINDS.has(symbol.kind) || !isPrivateDeclaration(source, symbol)) continue;
        if (isImplicitlyUsedJavaMember(source, symbol)) {
          skippedReflective += 1;
          continue;
        }
        analysedDeclarations += 1;
        let references = [];
        try {
          references = await this.language.request(root, "textDocument/references", {
            textDocument: { uri },
            position: symbol.selectionRange?.start || symbol.range.start,
            context: { includeDeclaration: false },
          }) || [];
        } catch {
          continue;
        }
        const realReferences = references.filter((location) => !sameLocation(location, uri, symbol.selectionRange || symbol.range));
        if (realReferences.length) continue;
        const module = moduleForPath(file, moduleList);
        const annotated = hasDeclarationAnnotation(source, symbol);
        findings.push({
          id: `${uri}:${symbol.selectionRange?.start?.line || 0}:${symbol.name}`,
          kind: unusedKind(symbol.kind),
          name: String(symbol.name || "").replace(/\(.*$/, ""),
          path: file,
          moduleId: module?.id || null,
          line: (symbol.selectionRange?.start?.line ?? symbol.range.start.line) + 1,
          column: (symbol.selectionRange?.start?.character ?? symbol.range.start.character) + 1,
          range: symbol.range,
          confidence: annotated ? "low" : "high",
          safeDelete: !annotated,
          explanation: annotated
            ? "Keine statische Referenz gefunden; Annotationen können den Member jedoch per Reflection verwenden."
            : "JDT LS findet außerhalb der Deklaration keine Referenz.",
        });
      }
    });
    findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
    const result = {
      root,
      analysedFiles: files.length,
      analysedDeclarations,
      skippedReflective,
      findings,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
    this.unusedCache.set(root, { fingerprint, result });
    return result;
  }

  async ensureOpen(root, file, source) {
    const started = await this.language.start(root);
    if (!started?.available) throw new Error(started?.reason || "JDT LS ist nicht verfügbar.");
    await this.language.open(root, file, source, "java");
  }

  async references(root, file, position) {
    return await this.language.request(root, "textDocument/references", {
      textDocument: { uri: pathToFileURL(file).toString() },
      position,
      context: { includeDeclaration: true },
    }) || [];
  }

  storePlan(root, details) {
    const id = crypto.randomUUID();
    const plan = {
      id,
      root,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      ...details,
    };
    this.plans.set(id, plan);
    for (const [candidateId, candidate] of this.plans) {
      if (Date.now() - candidate.createdAtMs > PLAN_TTL_MS) this.plans.delete(candidateId);
    }
    return publicPlan(plan);
  }
}

function publicPlan(plan) {
  return {
    id: plan.id,
    root: plan.root,
    type: plan.type,
    title: plan.title,
    createdAt: plan.createdAt,
    blocked: plan.blockedReasons.length > 0,
    blockedReasons: [...plan.blockedReasons],
    warnings: [...plan.warnings],
    files: plan.changes.map((change) => ({
      path: change.path,
      before: change.before,
      after: change.after,
      kind: change.category === "build-model" ? "build-model" : "edit",
      beforeHash: change.beforeHash,
    })),
    resources: plan.resources.map((resource) => ({ ...resource })),
    workspaceEdit: plan.workspaceEdit,
    affectedCallSites: plan.affectedCallSites,
    buildModelChanges: plan.buildModelChanges,
    sourceModuleId: plan.sourceModuleId,
    targetModuleId: plan.targetModuleId,
    sourcePath: plan.sourcePath,
    targetPath: plan.targetPath,
    beforeSignature: plan.beforeSignature,
    afterSignature: plan.afterSignature,
  };
}

function topLevelType(source, expectedName) {
  const expression = new RegExp(`\\b(?:class|interface|enum|record|@interface)\\s+(${escapeRegExp(expectedName)})\\b`);
  const match = expression.exec(maskJavaCommentsAndStrings(source));
  if (!match) return null;
  return { name: expectedName, position: positionAt(source, match.index + match[0].lastIndexOf(expectedName)) };
}

function javaPackage(source) {
  return source.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1] || "";
}

function replaceJavaPackage(source, packageName) {
  const declaration = /^\s*package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*;\s*/m;
  if (declaration.test(source)) {
    return source.replace(declaration, packageName ? `package ${packageName};\n\n` : "");
  }
  return packageName ? `package ${packageName};\n\n${source.replace(/^\s+/, "")}` : source;
}

function javaImports(source) {
  return [...source.matchAll(/^\s*import\s+(?:static\s+)?([\w.$]+)\s*;/gm)].map((match) => match[1]);
}

function addJavaImport(source, qualifiedName) {
  if (!qualifiedName.includes(".") || javaImports(source).includes(qualifiedName)) return source;
  const imports = [...source.matchAll(/^\s*import\s+(?:static\s+)?[\w.$]+\s*;\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    const end = last.index + last[0].length;
    return `${source.slice(0, end).replace(/\s*$/, "")}\nimport ${qualifiedName};\n${source.slice(end).replace(/^\s*/, "\n")}`;
  }
  const packageMatch = /^\s*package\s+[\w.]+\s*;\s*/m.exec(source);
  if (packageMatch) {
    const end = packageMatch.index + packageMatch[0].length;
    return `${source.slice(0, end).replace(/\s*$/, "")}\n\nimport ${qualifiedName};\n\n${source.slice(end).replace(/^\s*/, "")}`;
  }
  return `import ${qualifiedName};\n\n${source}`;
}

function removeJavaImport(source, qualifiedName) {
  return source.replace(new RegExp(`^\\s*import\\s+(?:static\\s+)?${escapeRegExp(qualifiedName)}(?:\\.[\\w$*]+)?\\s*;\\s*\\r?\\n?`, "gm"), "");
}

function moduleForPath(file, modules) {
  return [...modules]
    .filter((module) => isInside(file, module.root))
    .sort((left, right) => right.root.length - left.root.length)[0] || null;
}

function sourceKindForPath(file, module) {
  if ((module.testRoots || []).some((root) => isInside(file, root))) return "test";
  if ((module.sourceRoots || []).some((root) => isInside(file, root))) return "production";
  return "resource";
}

function assertCompatibleLanguageLevels(sourceModule, targetModule, source) {
  const sourceLevel = Number.parseInt(sourceModule.languageLevel, 10) || 0;
  const targetLevel = Number.parseInt(targetModule.languageLevel, 10) || 0;
  if (sourceLevel && targetLevel && targetLevel < sourceLevel && sourceUsesLanguageLevel(source, sourceLevel)) {
    throw new Error(`Das Zielmodul verwendet Java ${targetLevel}, die Klasse benötigt aber mindestens Java ${sourceLevel}.`);
  }
}

function sourceUsesLanguageLevel(source, level) {
  if (level >= 16 && /\brecord\s+\w+/.test(source)) return true;
  if (level >= 17 && /\bsealed\s+(?:class|interface)|\bpermits\b/.test(source)) return true;
  if (level >= 14 && /\bswitch\s*\([^)]*\)\s*\{[^}]*->/s.test(source)) return true;
  if (level >= 10 && /\bvar\s+\w+\s*=/.test(source)) return true;
  return false;
}

function referenceModuleScopes(references, modules, targetModuleId) {
  const result = new Map();
  for (const reference of references) {
    const file = locationPath(reference);
    const module = moduleForPath(file, modules);
    if (!module || module.id === targetModuleId) continue;
    const scope = sourceKindForPath(file, module) === "test" ? "test" : "compile";
    if (result.get(module.id) !== "compile") result.set(module.id, scope);
  }
  return result;
}

async function readModuleDependencyGraph(root, modules) {
  const graph = new Map(modules.map((module) => [module.id, new Set()]));
  const aliases = new Map();
  for (const module of modules) {
    for (const value of [module.id, module.name, module.relativePath, module.relativePath?.replace(/[\\/]/g, "."), module.jpms?.name]) {
      if (value) aliases.set(String(value).toLocaleLowerCase(), module.id);
    }
  }
  for (const module of modules) {
    for (const dependency of module.dependencies || []) {
      const value = typeof dependency === "string" ? dependency : dependency?.moduleId;
      const target = aliases.get(String(value || "").toLocaleLowerCase());
      if (target) addGraphEdge(graph, module.id, target);
    }
    for (const dependency of [...(module.jpms?.requires || []), ...(module.jpms?.requiresTransitive || [])]) {
      const target = aliases.get(String(dependency || "").toLocaleLowerCase());
      if (target) addGraphEdge(graph, module.id, target);
    }
    const buildFile = buildFileForModule(module);
    if (!buildFile || !fsSync.existsSync(buildFile)) continue;
    const source = await fs.readFile(buildFile, "utf8");
    if (module.buildSystem === "Gradle") {
      for (const match of source.matchAll(/project\s*\(\s*["'](:[^"']+)["']\s*\)/g)) {
        const target = aliases.get(match[1].slice(1).replace(/:/g, ".").toLocaleLowerCase());
        if (target) addGraphEdge(graph, module.id, target);
      }
    } else if (module.buildSystem === "Maven") {
      for (const match of source.matchAll(/<dependency>[\s\S]*?<artifactId>\s*([^<]+)\s*<\/artifactId>[\s\S]*?<\/dependency>/g)) {
        const target = aliases.get(match[1].trim().toLocaleLowerCase());
        if (target) addGraphEdge(graph, module.id, target);
      }
    }
  }
  return graph;
}

function addGraphEdge(graph, from, to) {
  const edges = graph.get(from) || new Set();
  edges.add(to);
  graph.set(from, edges);
}

function graphHasEdge(graph, from, to) {
  return graph.get(from)?.has(to) || false;
}

function graphHasPath(graph, from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return [...(graph.get(from) || [])].some((next) => graphHasPath(graph, next, to, seen));
}

async function addModuleDependency(root, sourceModule, targetModule, scope, modules) {
  if (sourceModule.buildSystem === "Maven") return addMavenProjectDependency(sourceModule, targetModule, scope);
  if (sourceModule.buildSystem === "Gradle") return addGradleProjectDependency(sourceModule, targetModule, scope);
  return addPlainProjectDependency(root, sourceModule, targetModule, modules);
}

async function addMavenProjectDependency(sourceModule, targetModule, scope) {
  const sourcePom = path.join(sourceModule.root, "pom.xml");
  const targetPom = path.join(targetModule.root, "pom.xml");
  if (!fsSync.existsSync(sourcePom) || !fsSync.existsSync(targetPom)) return null;
  const [before, targetSource] = await Promise.all([fs.readFile(sourcePom, "utf8"), fs.readFile(targetPom, "utf8")]);
  const coordinate = mavenCoordinate(targetSource);
  if (!coordinate.artifactId || !coordinate.groupId) return null;
  // Read the pom past the sections that hold dependencies which are not the
  // project's own. <dependencyManagement> holds versions, a <profile> holds
  // dependencies that only apply when it is switched on, and a comment holds
  // whatever somebody tried last week. Counting any of those as "already
  // declared" made the whole action do nothing; adding into one of them wrote
  // a version where a dependency belonged, and the build still could not find
  // the class.
  const declared = maskXmlElement(maskXmlElement(maskXmlComments(before), "dependencyManagement"), "profiles");
  const existing = new RegExp(`<dependency>[\\s\\S]*?<artifactId>\\s*${escapeRegExp(coordinate.artifactId)}\\s*</artifactId>[\\s\\S]*?</dependency>`);
  if (existing.test(declared)) return { path: sourcePom, before, after: before };
  const dependency = [
    "    <dependency>",
    `      <groupId>${coordinate.groupId}</groupId>`,
    `      <artifactId>${coordinate.artifactId}</artifactId>`,
    coordinate.version ? `      <version>${coordinate.version}</version>` : "",
    scope === "test" ? "      <scope>test</scope>" : "",
    "    </dependency>",
  ].filter(Boolean).join("\n");
  let after;
  const dependenciesEnd = declared.lastIndexOf("</dependencies>");
  if (dependenciesEnd >= 0) {
    // Insert at the start of the closing tag's line, so the new element keeps
    // its own indentation instead of inheriting the closing tag's.
    const lineStart = before.lastIndexOf("\n", dependenciesEnd) + 1;
    after = `${before.slice(0, lineStart)}${dependency}\n${before.slice(lineStart)}`;
  } else {
    after = before.replace(/\s*<\/project>\s*$/, `\n  <dependencies>\n${dependency}\n  </dependencies>\n</project>\n`);
  }
  return { path: sourcePom, before, after };
}

function mavenCoordinate(source) {
  const withoutParent = source.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const parent = source.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] || "";
  const value = (name, body) => body.match(new RegExp(`<${name}>\\s*([^<]+)\\s*</${name}>`))?.[1]?.trim() || "";
  return {
    groupId: value("groupId", withoutParent) || value("groupId", parent),
    artifactId: value("artifactId", withoutParent),
    version: value("version", withoutParent) || value("version", parent),
  };
}

async function addGradleProjectDependency(sourceModule, targetModule, scope) {
  const buildFile = buildFileForModule(sourceModule);
  if (!buildFile || !fsSync.existsSync(buildFile)) return null;
  const before = await fs.readFile(buildFile, "utf8");
  const projectPath = targetModule.relativePath === "." ? ":" : `:${targetModule.relativePath.replace(/[\\/]+/g, ":")}`;
  // Comments go, quotes stay: the path being looked for lives inside a string,
  // so blanking the literals would blank the answer along with the noise.
  const code = maskSourceComments(before);
  if (new RegExp(`project\\s*\\(\\s*["']${escapeRegExp(projectPath)}["']\\s*\\)`).test(code)) {
    return { path: buildFile, before, after: before };
  }
  const declaration = `    ${scope === "test" ? "testImplementation" : "implementation"}(project("${projectPath}"))`;
  // The project's own dependencies block, not the first one in the file. A
  // script that configures its own plugins opens with `buildscript { }`, which
  // has a dependencies block of its own holding classpath entries — an
  // `implementation` written in there is not a configuration that exists, so
  // the build stopped before it started.
  const body = topLevelBlockBody(before, "dependencies");
  const after = body >= 0
    ? `${before.slice(0, body)}\n${declaration}${before.slice(body)}`
    : `${before.replace(/\s*$/, "")}\n\ndependencies {\n${declaration}\n}\n`;
  return { path: buildFile, before, after };
}

async function addPlainProjectDependency(root, sourceModule, targetModule, modules) {
  const metadataFile = path.join(root, ".kiwi", "modules.json");
  const before = await fs.readFile(metadataFile, "utf8").catch(() => "{\n  \"version\": 1,\n  \"modules\": []\n}\n");
  let metadata;
  try { metadata = JSON.parse(before); } catch { return null; }
  metadata.modules = Array.isArray(metadata.modules) ? metadata.modules : [];
  let source = metadata.modules.find((item) => item.id === sourceModule.id || item.path === sourceModule.relativePath);
  if (!source) {
    source = { id: sourceModule.id, name: sourceModule.name, path: sourceModule.relativePath, dependencies: [] };
    metadata.modules.push(source);
  }
  source.dependencies = unique([...(source.dependencies || []), targetModule.id]);
  return { path: metadataFile, before, after: `${JSON.stringify(metadata, null, 2)}\n` };
}

function buildFileForModule(module) {
  if (module.buildSystem === "Maven") return path.join(module.root, "pom.xml");
  if (module.buildSystem === "Gradle") {
    return ["build.gradle.kts", "build.gradle"].map((name) => path.join(module.root, name)).find(fsSync.existsSync) || null;
  }
  return null;
}

async function addJpmsMoveChanges(
  root,
  sourceModule,
  targetModule,
  oldPackage,
  targetPackage,
  sourcePath,
  changes,
  blockedReasons,
  referenceScopes,
  modules,
) {
  if (!sourceModule.jpms && !targetModule.jpms) return;
  if (targetModule.jpms && !targetPackage) {
    blockedReasons.push("Ein benanntes JPMS-Modul darf keine Klasse im Default-Package enthalten.");
    return;
  }
  if (!targetModule.jpms?.name) {
    blockedReasons.push("Das Zielmodul besitzt keinen JPMS-Descriptor, obwohl die Quelle modular ist.");
    return;
  }
  const exportedPackageMoves = Boolean(targetPackage && sourceModule.jpms?.exports?.includes(oldPackage));
  if (oldPackage && oldPackage === targetPackage && sourceModule.id !== targetModule.id) {
    const remaining = await packageContainsOtherJava(sourceModule, oldPackage, sourcePath);
    if (remaining) {
      blockedReasons.push(`JPMS-Split-Package verhindert: ${oldPackage} würde gleichzeitig in ${sourceModule.name} und ${targetModule.name} liegen.`);
      return;
    }
  }
  if (exportedPackageMoves) {
    const targetDescriptor = targetModule.descriptorPath;
    if (!targetDescriptor || !fsSync.existsSync(targetDescriptor)) {
      blockedReasons.push("Der JPMS-Descriptor des Zielmoduls fehlt.");
      return;
    }
    const before = changes.get(targetDescriptor)?.after ?? await fs.readFile(targetDescriptor, "utf8");
    const after = ensureModuleDirective(before, `exports ${targetPackage};`);
    setFileChange(changes, targetDescriptor, changes.get(targetDescriptor)?.before ?? before, after, "build-model");
  }
  if (sourceModule.descriptorPath && oldPackage && (oldPackage !== targetPackage || sourceModule.id !== targetModule.id)) {
    const remaining = await packageContainsOtherJava(sourceModule, oldPackage, sourcePath);
    if (!remaining) {
      const descriptor = sourceModule.descriptorPath;
      const before = changes.get(descriptor)?.after ?? await fs.readFile(descriptor, "utf8");
      const after = before.replace(new RegExp(`^\\s*exports\\s+${escapeRegExp(oldPackage)}\\s*;\\s*\\r?\\n?`, "m"), "");
      setFileChange(changes, descriptor, changes.get(descriptor)?.before ?? before, after, "build-model");
    }
  }
  if (targetModule.jpms?.name) {
    for (const [moduleId] of referenceScopes) {
      const referringModule = modules.find((module) => module.id === moduleId);
      if (!referringModule?.descriptorPath || !fsSync.existsSync(referringModule.descriptorPath)) continue;
      const descriptor = referringModule.descriptorPath;
      const before = changes.get(descriptor)?.after ?? await fs.readFile(descriptor, "utf8");
      const after = ensureModuleDirective(before, `requires ${targetModule.jpms.name};`);
      setFileChange(changes, descriptor, changes.get(descriptor)?.before ?? before, after, "build-model");
    }
  }
}

async function packageContainsOtherJava(module, packageName, sourcePath) {
  for (const sourceRoot of module.sourceRoots || []) {
    const directory = path.join(sourceRoot, ...packageName.split("."));
    const entries = await fs.readdir(directory).catch(() => []);
    if (entries.some((name) => name.endsWith(".java") && !samePath(path.join(directory, name), sourcePath))) return true;
  }
  return false;
}

function ensureModuleDirective(source, directive) {
  if (source.includes(directive)) return source;
  const end = source.lastIndexOf("}");
  return end < 0 ? source : `${source.slice(0, end).replace(/\s*$/, "")}\n    ${directive}\n${source.slice(end)}`;
}

function setFileChange(changes, file, before, after, category) {
  const existing = changes.get(file);
  const original = existing?.before ?? before;
  if (original === after) {
    changes.delete(file);
    return;
  }
  changes.set(file, { path: file, before: original, after, beforeHash: digest(original), category });
}

function workspaceEditFromChanges(changes, resources) {
  return {
    documentChanges: [
      ...[...changes.values()].map((change) => ({
        textDocument: { uri: pathToFileURL(change.path).toString(), version: null },
        edits: [{
          range: { start: { line: 0, character: 0 }, end: positionAt(change.before, change.before.length) },
          newText: change.after,
        }],
      })),
      ...resources.map((resource) => ({
        kind: resource.kind,
        oldUri: pathToFileURL(resource.oldPath).toString(),
        newUri: pathToFileURL(resource.newPath).toString(),
      })),
    ],
  };
}

async function changesFromWorkspaceEdit(root, edit, pathGuard) {
  const editsByFile = new Map();
  const resources = [];
  const warnings = [];
  for (const [uri, edits] of Object.entries(edit?.changes || {})) editsByFile.set(uriPath(uri), [...edits]);
  for (const change of edit?.documentChanges || []) {
    if (change.textDocument?.uri) {
      const file = uriPath(change.textDocument.uri);
      editsByFile.set(file, [...(editsByFile.get(file) || []), ...(change.edits || [])]);
    } else if (change.kind === "rename") {
      const oldPath = pathGuard.assertAllowed(uriPath(change.oldUri), root);
      const newPath = pathGuard.assertAllowed(uriPath(change.newUri), root);
      resources.push({ kind: "rename", oldPath, newPath });
    } else {
      throw new Error(`Das JDT-Refactoring enthält die nicht unterstützte Ressourcenänderung „${change.kind}“.`);
    }
  }
  const changes = [];
  for (const [rawFile, edits] of editsByFile) {
    const file = pathGuard.assertAllowed(rawFile, root);
    const before = await fs.readFile(file, "utf8");
    const offsetEdits = edits.map((edit) => ({
      start: offsetAt(before, edit.range.start),
      end: offsetAt(before, edit.range.end),
      text: edit.newText,
    }));
    changes.push({ path: file, before, after: applyOffsetEdits(before, offsetEdits), beforeHash: digest(before), category: "java" });
  }
  return { changes, resources, warnings };
}

function methodSymbolAt(symbols, position) {
  return flattenSymbols(symbols)
    .filter((symbol) => METHOD_KINDS.has(symbol.kind) && containsPosition(symbol.range, position))
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0] || null;
}

function flattenSymbols(symbols, result = []) {
  for (const symbol of symbols || []) {
    result.push(symbol);
    if (symbol.children) flattenSymbols(symbol.children, result);
  }
  return result;
}

function parseMethodSignature(source, symbol, fallbackPosition) {
  const namePosition = symbol?.selectionRange?.start || fallbackPosition;
  const nameStart = offsetAt(source, namePosition);
  const selectedName = symbol?.name?.replace(/\(.*$/, "") || identifierAt(source, nameStart);
  if (!selectedName || !JAVA_IDENTIFIER.test(selectedName)) return null;
  const actualNameStart = source.indexOf(selectedName, Math.max(0, nameStart - 2));
  if (actualNameStart < 0 || actualNameStart > nameStart + selectedName.length + 2) return null;
  const open = skipWhitespace(source, actualNameStart + selectedName.length);
  if (source[open] !== "(") return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  const headerStart = symbol?.range ? offsetAt(source, symbol.range.start) : lineStart(source, actualNameStart);
  let headerEnd = close + 1;
  while (headerEnd < source.length && /\s/.test(source[headerEnd])) headerEnd += 1;
  if (/^throws\b/.test(source.slice(headerEnd))) {
    const terminator = findHeaderTerminator(source, headerEnd);
    headerEnd = terminator;
  }
  const prefix = source.slice(headerStart, actualNameStart);
  const parameterSource = source.slice(open + 1, close);
  const rawParameters = splitTopLevel(parameterSource);
  const parameters = rawParameters.filter(Boolean).map((raw, index) => parseParameter(raw, index));
  const modifierMatch = prefix.match(/((?:(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|default)\s+)*)((?:[\w$?.<>\[\], @]+\s+)?)$/s);
  const modifierText = modifierMatch?.[1] || "";
  const returnType = (modifierMatch?.[2] || "").trim();
  const throwsClause = source.slice(close + 1, headerEnd).trim();
  return {
    name: selectedName,
    namePosition: positionAt(source, actualNameStart),
    nameRange: { start: positionAt(source, actualNameStart), end: positionAt(source, actualNameStart + selectedName.length) },
    headerStart,
    headerEnd,
    prefix,
    modifierText,
    returnType,
    parameters,
    throwsClause,
    terminator: source[headerEnd] || "",
  };
}

function parseParameter(raw, index) {
  const cleaned = raw.trim();
  const match = cleaned.match(/^(.*?)([A-Za-z_$][\w$]*)\s*$/s);
  return {
    sourceIndex: index,
    type: (match?.[1] || "").trim(),
    name: match?.[2] || `arg${index}`,
    original: cleaned,
    defaultValue: "",
  };
}

function validateSignatureRequest(current, request) {
  const name = String(request?.newName ?? current.name).trim();
  if (!JAVA_IDENTIFIER.test(name)) throw new Error("Der neue Methodenname ist ungültig.");
  const returnType = String(request?.returnType ?? current.returnType).trim();
  if (current.returnType && !returnType) throw new Error("Der Rückgabetyp darf nicht leer sein.");
  const parameters = (request?.parameters ?? current.parameters).map((parameter, index) => {
    const parameterName = String(parameter.name || "").trim();
    const type = String(parameter.type || "").trim();
    const sourceIndex = parameter.sourceIndex == null ? null : Number(parameter.sourceIndex);
    if (!JAVA_IDENTIFIER.test(parameterName)) throw new Error(`Parameter ${index + 1} hat keinen gültigen Namen.`);
    if (!type || /[;{}]/.test(type)) throw new Error(`Parameter ${parameterName} hat keinen gültigen Typ.`);
    if (sourceIndex != null && (!Number.isInteger(sourceIndex) || !current.parameters[sourceIndex])) {
      throw new Error(`Parameter ${parameterName} verweist auf keinen vorhandenen Parameter.`);
    }
    const defaultValue = sourceIndex == null ? String(parameter.defaultValue || "").trim() : "";
    if (sourceIndex == null && !defaultValue) throw new Error(`Für den neuen Parameter ${parameterName} fehlt ein Standardargument.`);
    return { sourceIndex, name: parameterName, type, defaultValue, original: `${type} ${parameterName}` };
  });
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) {
    throw new Error("Parameternamen müssen eindeutig sein.");
  }
  return { ...current, name, returnType, parameters };
}

function renderMethodHeader(current, next) {
  let prefix = current.prefix;
  if (current.returnType && next.returnType !== current.returnType) {
    const index = prefix.lastIndexOf(current.returnType);
    if (index >= 0) prefix = `${prefix.slice(0, index)}${next.returnType}${prefix.slice(index + current.returnType.length)}`;
  }
  const parameters = next.parameters.map((parameter) => `${parameter.type} ${parameter.name}`).join(", ");
  return `${prefix}${next.name}(${parameters})${current.throwsClause ? ` ${current.throwsClause}` : ""}${current.terminator === "{" ? " " : ""}`;
}

function publicSignature(signature) {
  return {
    name: signature.name,
    returnType: signature.returnType,
    parameters: signature.parameters.map(({ sourceIndex, type, name, defaultValue }) => ({ sourceIndex, type, name, defaultValue })),
    throwsClause: signature.throwsClause,
    position: signature.namePosition,
  };
}

function sameParameters(left, right) {
  return left.length === right.length && left.every((parameter, index) =>
    right[index].sourceIndex === parameter.sourceIndex && right[index].type === parameter.type && right[index].name === parameter.name,
  );
}

function parseInvocationAt(source, nameEnd) {
  const open = skipWhitespace(source, nameEnd);
  if (source[open] !== "(") return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  return {
    argumentsStart: open + 1,
    argumentsEnd: close,
    arguments: splitTopLevel(source.slice(open + 1, close)),
  };
}

function looksLikeMethodDeclaration(source, nameStart) {
  const start = Math.max(
    source.lastIndexOf("\n", nameStart - 1),
    source.lastIndexOf("{", nameStart - 1),
    source.lastIndexOf(";", nameStart - 1),
  ) + 1;
  const prefix = source.slice(start, nameStart).trim();
  if (!prefix || /[.=:+\-*/%!?]/.test(prefix)) return false;
  return /^(?:(?:@[\w$.]+(?:\([^)]*\))?\s+)|(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|default)\s+)*(?:<[^>]+>\s*)?[\w$?.<>\[\], @]+\s*$/.test(prefix);
}

function splitTopLevel(value) {
  const result = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let angle = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "{") curly += 1;
    else if (character === "}") curly -= 1;
    else if (character === "<") angle += 1;
    else if (character === ">" && angle > 0) angle -= 1;
    else if (character === "," && !round && !square && !curly && !angle) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail || value.trim()) result.push(tail);
  return result;
}

function applyOffsetEdits(source, edits) {
  const sorted = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
  let previousStart = source.length + 1;
  let result = source;
  for (const edit of sorted) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.length || edit.end > previousStart) {
      throw new Error("Das Refactoring enthält überlappende oder ungültige Textänderungen.");
    }
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
    previousStart = edit.start;
  }
  return result;
}

async function callSites(root, locations) {
  const result = [];
  for (const location of uniqueLocations(locations)) {
    const site = await callSite(root, location);
    if (site) result.push(site);
  }
  return result;
}

async function callSite(root, location) {
  const file = locationPath(location);
  if (!isInside(file, root)) return null;
  const source = await fs.readFile(file, "utf8").catch(() => "");
  return {
    path: file,
    line: location.range.start.line + 1,
    column: location.range.start.character + 1,
    preview: source.split(/\r?\n/)[location.range.start.line]?.trim() || "",
  };
}

async function validatePlanFiles(root, plan, pathGuard) {
  for (const change of plan.changes) {
    pathGuard.assertAllowed(change.path, root);
    const current = await fs.readFile(change.path, "utf8").catch(() => null);
    if (current == null || digest(current) !== change.beforeHash) {
      throw new Error(`„${path.basename(change.path)}“ wurde seit der Vorschau geändert.`);
    }
  }
  for (const resource of plan.resources) {
    pathGuard.assertAllowed(resource.oldPath, root);
    pathGuard.assertAllowed(resource.newPath, root);
    if (!fsSync.existsSync(resource.oldPath)) throw new Error("Die zu verschiebende Quelldatei existiert nicht mehr.");
    if (fsSync.existsSync(resource.newPath)) throw new Error("Am Refactoring-Ziel existiert inzwischen bereits eine Datei.");
  }
}

async function snapshotPaths(paths) {
  const result = [];
  for (const target of paths) {
    const stat = await fs.stat(target).catch(() => null);
    result.push({ path: target, existed: Boolean(stat), directory: stat?.isDirectory() || false, content: stat?.isFile() ? await fs.readFile(target) : null });
  }
  return result;
}

async function restoreSnapshots(snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    if (!snapshot.existed) await fs.rm(snapshot.path, { recursive: true, force: true }).catch(() => undefined);
    else if (snapshot.directory) await fs.mkdir(snapshot.path, { recursive: true });
    else {
      await fs.mkdir(path.dirname(snapshot.path), { recursive: true });
      await fs.writeFile(snapshot.path, snapshot.content);
    }
  }
}

function renamedPath(file, resources) {
  const resource = resources.find((candidate) => candidate.kind === "rename" && samePath(candidate.oldPath, file));
  return resource?.newPath || file;
}

async function collectJavaFiles(root, modules, pathGuard, maxFiles) {
  const roots = unique(modules.flatMap((module) => [...module.sourceRoots, ...module.testRoots])).filter(fsSync.existsSync);
  const files = [];
  const visit = async (directory) => {
    if (files.length >= maxFiles) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && [".git", ".kiwi", ".gradle", "build", "target", "out"].includes(entry.name)) continue;
      const target = pathGuard.assertAllowed(path.join(directory, entry.name), root);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".java")) files.push(target);
      if (files.length >= maxFiles) break;
    }
  };
  for (const sourceRoot of roots) await visit(sourceRoot);
  return unique(files);
}

async function fileFingerprint(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    hash.update(`${file}\0${stat?.size || 0}\0${stat?.mtimeMs || 0}\n`);
  }
  return hash.digest("hex");
}

async function concurrentMap(values, concurrency, handler) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await handler(values[index], index);
    }
  });
  await Promise.all(workers);
}

function isPrivateDeclaration(source, symbol) {
  const start = offsetAt(source, symbol.range.start);
  const selected = offsetAt(source, symbol.selectionRange?.start || symbol.range.start);
  const header = source.slice(start, Math.max(start, selected));
  return /\bprivate\b/.test(maskJavaCommentsAndStrings(header));
}

function isImplicitlyUsedJavaMember(source, symbol) {
  const name = String(symbol.name || "").replace(/\(.*$/, "");
  if (["serialVersionUID", "readObject", "writeObject", "readResolve", "writeReplace"].includes(name)) return true;
  const selected = offsetAt(source, symbol.selectionRange?.start || symbol.range.start);
  const header = declarationPrefix(source, offsetAt(source, symbol.range.start), selected);
  return /@(Inject|Autowired|Value|JsonProperty|JsonCreator|FXML|PostConstruct|PreDestroy|PersistenceContext|EventHandler|Subscribe)\b/.test(header);
}

function hasDeclarationAnnotation(source, symbol) {
  const start = offsetAt(source, symbol.range.start);
  const selected = offsetAt(source, symbol.selectionRange?.start || symbol.range.start);
  return /@[A-Za-z_$][\w$.]*/.test(declarationPrefix(source, start, selected));
}

function declarationPrefix(source, declarationStart, selected) {
  const searchFrom = Math.max(0, declarationStart - 1);
  const boundary = Math.max(
    source.lastIndexOf(";", searchFrom),
    source.lastIndexOf("{", searchFrom),
    source.lastIndexOf("}", searchFrom),
  );
  return source.slice(Math.max(0, boundary + 1), selected);
}

function unusedKind(kind) {
  if ([5, 10, 11, 12, 23].includes(kind)) return "class";
  if ([7, 8].includes(kind)) return "field";
  return "method";
}

function sameLocation(location, uri, range) {
  return location?.uri === uri && rangesOverlap(location.range, range);
}

function referenceLocationsForFile(references, file) {
  return references.filter((location) => samePath(locationPath(location), file));
}

function locationPath(location) {
  return uriPath(location?.uri || location?.targetUri || "");
}

function uriPath(uri) {
  if (!uri) return "";
  try { return fileURLToPath(uri); } catch { return String(uri); }
}

function uniqueLocations(locations) {
  const seen = new Set();
  return (locations || []).filter((location) => {
    if (!location?.range) return false;
    const key = `${location.uri || location.targetUri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rangesOverlap(left, right) {
  if (!left || !right) return false;
  return comparePosition(left.start, right.end) <= 0 && comparePosition(right.start, left.end) <= 0;
}

function containsPosition(range, position) {
  return range && comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

function comparePosition(left, right) {
  return left.line - right.line || left.character - right.character;
}

function rangeSize(range) {
  return (range.end.line - range.start.line) * 1_000_000 + range.end.character - range.start.character;
}

function identifierAt(source, offset) {
  let start = offset;
  while (start > 0 && /[\w$]/.test(source[start - 1])) start -= 1;
  let end = offset;
  while (end < source.length && /[\w$]/.test(source[end])) end += 1;
  return source.slice(start, end);
}

function matchingDelimiter(source, open, opening, closing) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === opening) depth += 1;
    else if (character === closing && --depth === 0) return index;
  }
  return -1;
}

function findHeaderTerminator(source, start) {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{" || source[index] === ";") return index;
  }
  return start;
}

function skipWhitespace(source, offset) {
  while (offset < source.length && /\s/.test(source[offset])) offset += 1;
  return offset;
}

function lineStart(source, offset) {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

function offsetAt(source, position) {
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
  }
  return Math.min(source.length, offset + position.character);
}

function positionAt(source, offset) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).replace(/\r$/, "").length };
}

function maskJavaCommentsAndStrings(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (match) => match.replace(/[^\r\n]/g, " "));
}

function isInside(candidate, root) {
  if (!candidate) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left, right) {
  if (!left || !right) return false;
  return process.platform === "win32"
    ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
    : path.resolve(left) === path.resolve(right);
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = process.platform === "win32" && typeof value === "string" ? value.toLocaleLowerCase() : value;
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function digest(value) {
  return crypto.createHash("sha256").update(value == null ? "<missing>" : String(value)).digest("hex");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  JavaRefactorService,
  addGradleProjectDependency,
  addMavenProjectDependency,
  applyOffsetEdits,
  changesFromWorkspaceEdit,
  parseInvocationAt,
  parseMethodSignature,
  replaceJavaPackage,
  splitTopLevel,
};
