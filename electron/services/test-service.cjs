const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");

class TestService {
  constructor(pathGuard, workspace, projects, builds) {
    this.pathGuard = pathGuard;
    this.workspace = workspace;
    this.projects = projects;
    this.builds = builds;
    this.parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  }

  async discover(root) {
    this.pathGuard.assertWorkspace(root);
    const modules = await this.builds?.modules?.list?.(root).catch(() => []) || [];
    const files = await this.workspace.collectFiles(root, (candidate) =>
      candidate.endsWith(".java") && /[\\/]src[\\/]test[\\/]/i.test(candidate),
    );
    const suites = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      const discovered = discoverTestsInSource(source, file);
      const module = modules
        .filter((candidate) => isInside(file, candidate.root))
        .sort((left, right) => right.root.length - left.root.length)[0];
      for (const suite of discovered) suites.push({ ...suite, moduleId: module?.id || "" });
    }
    return suites.sort((left, right) =>
      String(left.moduleId).localeCompare(String(right.moduleId))
      || left.packageName.localeCompare(right.packageName)
      || left.name.localeCompare(right.name),
    );
  }

  async run(root, target) {
    const project = await this.projects.detect(root);
    if (project.type === "Java") {
      throw new Error("JUnit-Tests benötigen in Plain-Java-Projekten einen Maven- oder Gradle-Build.");
    }
    const normalized = target ? String(target).replace("#", project.type === "Maven" ? "#" : ".") : "";
    return this.builds.execute({
      root,
      action: "test",
      configuration: { type: "junit", target: normalized, name: target || "All tests" },
    });
  }

  async results(root) {
    root = this.pathGuard.assertWorkspace(root);
    const modules = await this.builds?.modules?.list?.(root).catch(() => []) || [];
    const moduleRoots = new Map([[path.resolve(root), ""]]);
    for (const module of modules) moduleRoots.set(path.resolve(module.root), module.id || "");
    const candidates = [...moduleRoots].flatMap(([moduleRoot, moduleId]) => [
      { directory: path.join(moduleRoot, "target", "surefire-reports"), moduleId },
      { directory: path.join(moduleRoot, "target", "failsafe-reports"), moduleId },
      { directory: path.join(moduleRoot, "build", "test-results", "test"), moduleId },
    ]);
    const reports = [];
    const fingerprint = crypto.createHash("sha256");
    for (const { directory, moduleId } of candidates) {
      if (!fsSync.existsSync(directory)) continue;
      const files = (await fs.readdir(directory)).filter((name) => /^TEST-.+\.xml$/i.test(name)).sort();
      for (const name of files) {
        try {
          const reportPath = path.join(directory, name);
          const source = await fs.readFile(reportPath, "utf8");
          fingerprint.update(reportPath).update("\0").update(source).update("\0");
          const xml = this.parser.parse(source);
          const suite = xml.testsuite;
          if (!suite) continue;
          const cases = Array.isArray(suite.testcase) ? suite.testcase : suite.testcase ? [suite.testcase] : [];
          reports.push({
            name: suite.name || name,
            moduleId,
            tests: Number(suite.tests || cases.length),
            failures: Number(suite.failures || 0),
            errors: Number(suite.errors || 0),
            skipped: Number(suite.skipped || 0),
            time: Number(suite.time || 0),
            cases: cases.map((test) => ({
              name: test.name,
              className: test.classname || "",
              time: Number(test.time || 0),
              status: test.failure || test.error ? "failed" : test.skipped ? "skipped" : "passed",
              message: test.failure?.message || test.error?.message || "",
              details: test.failure?.["#text"] || test.error?.["#text"] || "",
            })),
          });
        } catch {}
      }
    }
    if (reports.length) await this.recordHistory(root, reports, fingerprint.digest("hex"));
    return reports;
  }

  async history(root) {
    root = this.pathGuard.assertWorkspace(root);
    const file = path.join(root, ".kiwi", "test-history.json");
    const stored = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => ({ version: 1, runs: [] }));
    const runs = Array.isArray(stored.runs) ? stored.runs.slice(0, 50) : [];
    const aggregate = new Map();
    for (const run of runs) {
      for (const test of run.cases || []) {
        const current = aggregate.get(test.id) || {
          id: test.id,
          className: test.className,
          name: test.name,
          passes: 0,
          failures: 0,
          skipped: 0,
          lastStatus: test.status,
        };
        if (test.status === "passed") current.passes += 1;
        else if (test.status === "failed") current.failures += 1;
        else current.skipped += 1;
        aggregate.set(test.id, current);
      }
    }
    const latest = new Map((runs[0]?.cases || []).map((test) => [test.id, test.status]));
    const flaky = [...aggregate.values()]
      .filter((test) => test.passes > 0 && test.failures > 0)
      .map((test) => ({ ...test, lastStatus: latest.get(test.id) || test.lastStatus }))
      .sort((left, right) => right.failures - left.failures || left.id.localeCompare(right.id));
    return { runs, flaky };
  }

  async recordHistory(root, reports, fingerprint) {
    const file = path.join(root, ".kiwi", "test-history.json");
    const stored = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => ({ version: 1, runs: [] }));
    const runs = Array.isArray(stored.runs) ? stored.runs : [];
    if (runs[0]?.fingerprint === fingerprint) return;
    const cases = reports.flatMap((report) => report.cases.map((test) => ({
      id: `${test.className}#${test.name}`,
      moduleId: report.moduleId || "",
      className: test.className,
      name: test.name,
      status: test.status,
      time: test.time,
      message: test.message,
    })));
    const failed = cases.filter((test) => test.status === "failed").length;
    const skipped = cases.filter((test) => test.status === "skipped").length;
    const run = {
      id: fingerprint.slice(0, 16),
      fingerprint,
      timestamp: new Date().toISOString(),
      total: cases.length,
      passed: cases.length - failed - skipped,
      failed,
      skipped,
      duration: reports.reduce((sum, report) => sum + Number(report.time || 0), 0),
      cases,
    };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ version: 1, runs: [run, ...runs].slice(0, 50) }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file).catch(async () => {
      await fs.rm(file, { force: true });
      await fs.rename(temporary, file);
    });
  }

  async coverage(root) {
    root = this.pathGuard.assertWorkspace(root);
    const project = await this.projects.detect(root);
    if (project.type === "Java") {
      throw new Error("Testabdeckung benötigt ein Maven- oder Gradle-Projekt mit JUnit.");
    }
    if (project.type === "Maven") {
      return this.builds.execute({
        root,
        action: "test",
        configuration: {
          type: "maven",
          name: "Test Coverage",
          target: "test org.jacoco:jacoco-maven-plugin:0.8.13:report",
        },
      });
    }
    const initScript = path.join(root, ".kiwi", "coverage.init.gradle");
    await fs.mkdir(path.dirname(initScript), { recursive: true });
    await fs.writeFile(initScript, `allprojects {
    pluginManager.withPlugin('java') {
        apply plugin: 'jacoco'
        tasks.withType(Test).configureEach {
            finalizedBy tasks.named('jacocoTestReport')
        }
        tasks.named('jacocoTestReport') {
            reports {
                xml.required = true
                html.required = true
            }
        }
    }
}
`, "utf8");
    return this.builds.execute({
      root,
      action: "test",
      configuration: {
        type: "gradle",
        name: "Test Coverage",
        target: `test jacocoTestReport --init-script "${initScript}"`,
      },
    });
  }

  async coverageResults(root) {
    root = this.pathGuard.assertWorkspace(root);
    const modules = await this.builds?.modules?.list?.(root).catch(() => []) || [];
    const roots = [...new Set([root, ...modules.map((module) => module.root)])];
    const reports = roots.flatMap((moduleRoot) => [
      path.join(moduleRoot, "target", "site", "jacoco", "jacoco.xml"),
      path.join(moduleRoot, "build", "reports", "jacoco", "test", "jacocoTestReport.xml"),
    ]).filter((file) => fsSync.existsSync(file));
    if (!reports.length) return [];
    const javaFiles = await this.workspace.collectFiles(root, (candidate) => candidate.endsWith(".java"));
    const result = [];
    for (const reportFile of reports) {
      try {
        const parsed = this.parser.parse(await fs.readFile(reportFile, "utf8"));
        const packages = array(parsed.report?.package);
        for (const packageEntry of packages) {
          const packagePath = String(packageEntry.name || "").replace(/\//g, path.sep);
          for (const sourceFile of array(packageEntry.sourcefile)) {
            const expectedSuffix = path.join(packagePath, sourceFile.name || "").toLowerCase();
            const file = javaFiles.find((candidate) => candidate.toLowerCase().endsWith(expectedSuffix));
            if (!file) continue;
            const classEntry = array(packageEntry.class).find((candidate) =>
              String(candidate.sourcefilename || "").toLowerCase() === String(sourceFile.name || "").toLowerCase(),
            );
            // JaCoCo puts the branch counts on the same element as the line
            // ones -- cb taken, mb not -- and only the line ones were read. A
            // line holding `if (a && b)` is "covered" the moment it runs once,
            // whichever way it went, so a file could read 100% with half its
            // decisions never taken.
            const lines = array(sourceFile.line).map((line) => ({
              line: Number(line.nr),
              covered: Number(line.ci || 0) > 0,
              coveredInstructions: Number(line.ci || 0),
              missedInstructions: Number(line.mi || 0),
              coveredBranches: Number(line.cb || 0),
              missedBranches: Number(line.mb || 0),
            }));
            const branchesCovered = lines.reduce((sum, line) => sum + line.coveredBranches, 0);
            const branchesMissed = lines.reduce((sum, line) => sum + line.missedBranches, 0);
            result.push({
              path: file,
              lines,
              summary: {
                packageName: String(packageEntry.name || "").replace(/\//g, "."),
                className: String(classEntry?.name || sourceFile.name || "").replace(/\//g, ".").replace(/\.java$/i, ""),
                coveredLines: lines.filter((line) => line.covered).length,
                missedLines: lines.filter((line) => !line.covered).length,
                coveredBranches: branchesCovered,
                missedBranches: branchesMissed,
                // -1 rather than 100 for a file with no decisions in it: a
                // file of plain statements has nothing to report, and
                // reporting it as perfect puts it beside files that earned it.
                branchPercentage: branchesCovered + branchesMissed
                  ? Math.round((branchesCovered / (branchesCovered + branchesMissed)) * 100)
                  : -1,
                methods: array(classEntry?.method).map((method) => {
                  const counter = array(method.counter).find((item) => item.type === "LINE")
                    || array(method.counter).find((item) => item.type === "INSTRUCTION")
                    || {};
                  const covered = Number(counter.covered || 0);
                  const missed = Number(counter.missed || 0);
                  return {
                    name: String(method.name || ""),
                    descriptor: String(method.desc || ""),
                    covered,
                    missed,
                    percentage: covered + missed ? Math.round((covered / (covered + missed)) * 100) : 0,
                  };
                }),
              },
            });
          }
        }
      } catch {}
    }
    return result;
  }
}

/**
 * The types a source names.
 *
 * Capitalised words, which is every type name Java convention produces, minus
 * the ones every test file mentions and none of them depend on. Deliberately
 * crude: a name too many costs one extra test, a name too few costs a green
 * run that proves nothing.
 */
function referencedTypes(source) {
  const ignored = new Set([
    "Test", "BeforeEach", "AfterEach", "BeforeAll", "AfterAll", "DisplayName",
    "Nested", "ParameterizedTest", "RepeatedTest", "TestFactory", "TestTemplate",
    "Assertions", "Assert", "String", "Integer", "Long", "Double", "Boolean",
    "Object", "List", "Map", "Set", "Override", "Exception",
  ]);
  return [...new Set((String(source || "").match(/\b[A-Z][A-Za-z0-9_$]*\b/g) || []))]
    .filter((name) => !ignored.has(name));
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function discoverTestsInSource(source, file = "") {
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
  const classes = [...source.matchAll(/((?:@(?:org\.junit\.jupiter\.api\.)?Nested\b[\s\S]{0,180}?)?)\bclass\s+([A-Za-z_$][\w$]*)/g)]
    .map((match, index) => ({
      name: match[2],
      index: match.index || 0,
      nested: index > 0 && /@(?:org\.junit\.jupiter\.api\.)?Nested\b/.test(match[1] || ""),
    }));
  if (!classes.length) {
    classes.push({ name: path.basename(file, ".java") || "Test", index: 0, nested: false });
  }
  const suiteMap = new Map();
  const annotationPattern = /((?:@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*)+)[\t ]*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:<[^>]+>\s*)?(?:void|[\w$<>, ?.[\]]+)\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(annotationPattern)) {
    const annotations = match[1] || "";
    const kindName = annotations.match(/@(?:org\.junit\.jupiter\.(?:api|params)\.)?(TestFactory|ParameterizedTest|RepeatedTest|TestTemplate|Test)\b/)?.[1];
    if (!kindName) continue;
    const ownerIndex = Math.max(0, classes.findLastIndex((candidate) => candidate.index <= (match.index || 0)));
    const owner = classes[ownerIndex];
    const outer = classes[0];
    const binaryClass = ownerIndex > 0 ? `${outer.name}$${owner.name}` : owner.name;
    const qualifiedClass = `${packageName ? `${packageName}.` : ""}${binaryClass}`;
    const displayName = annotations.match(/@(?:org\.junit\.jupiter\.api\.)?DisplayName\s*\(\s*"([^"]+)"/)?.[1] || "";
    const kind = kindName === "ParameterizedTest"
      ? "parameterized"
      : kindName === "RepeatedTest"
        ? "repeated"
        : kindName === "TestFactory"
          ? "dynamic"
          : kindName === "TestTemplate"
            ? "template"
            : "test";
    const suite = suiteMap.get(qualifiedClass) || {
      id: qualifiedClass,
      name: ownerIndex > 0 ? `${outer.name} › ${owner.name}` : owner.name,
      packageName,
      nested: ownerIndex > 0,
      file,
      // Every capitalised name the test source mentions. It is what decides
      // whether a change to a class can have broken this test, and reading it
      // here saves the workbench opening every test file to find out.
      references: referencedTypes(source),
      methods: [],
      status: "not-run",
    };
    suite.methods.push({
      id: `${qualifiedClass}#${match[2]}`,
      name: match[2],
      displayName,
      kind,
      nestedClass: ownerIndex > 0 ? owner.name : "",
      status: "not-run",
    });
    suiteMap.set(qualifiedClass, suite);
  }
  if (!suiteMap.size && /extends\s+TestCase/.test(source)) {
    const owner = classes[0];
    const qualifiedClass = `${packageName ? `${packageName}.` : ""}${owner.name}`;
    suiteMap.set(qualifiedClass, {
      id: qualifiedClass,
      name: owner.name,
      packageName,
      nested: false,
      file,
      methods: [],
      status: "not-run",
    });
  }
  return [...suiteMap.values()];
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

module.exports = { TestService, discoverTestsInSource };
