/**
 * Locates JUnit tests in the buffer that is on screen.
 *
 * The main process already discovers tests by scanning files on disk, but the
 * gutter needs positions in the text as it currently stands — a file with
 * unsaved edits would otherwise show its run icons on the wrong lines. Both
 * derive the same qualified identifiers, and a test pins them against one
 * fixture so the icon always starts the test it sits next to.
 */

export interface JavaTestTarget {
  /** 1-based line the icon belongs on. */
  line: number;
  kind: "class" | "method";
  /** What tests.run() expects: "pkg.Class" or "pkg.Class#method". */
  id: string;
  label: string;
}

const testAnnotation = /@(?:org\.junit\.jupiter\.(?:api|params)\.)?(TestFactory|ParameterizedTest|RepeatedTest|TestTemplate|Test)\b/;

const lineOf = (source: string, index: number) => source.slice(0, index).split(/\r?\n/).length;

export function findJavaTestTargets(source: string, fileName = ""): JavaTestTarget[] {
  const text = String(source || "");
  const packageName = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
  const classes = [...text.matchAll(/((?:@(?:org\.junit\.jupiter\.api\.)?Nested\b[\s\S]{0,180}?)?)\bclass\s+([A-Za-z_$][\w$]*)/g)]
    .map((match, index) => ({
      name: match[2],
      index: match.index || 0,
      // Only a class after the first one can be @Nested.
      nested: index > 0 && /@(?:org\.junit\.jupiter\.api\.)?Nested\b/.test(match[1] || ""),
    }));
  if (!classes.length) {
    const fallback = fileName.replace(/^.*[\\/]/, "").replace(/\.java$/i, "");
    if (!fallback) return [];
    classes.push({ name: fallback, index: 0, nested: false });
  }

  const qualify = (ownerIndex: number) => {
    const owner = classes[ownerIndex];
    const outer = classes[0];
    const binary = ownerIndex > 0 ? `${outer.name}$${owner.name}` : owner.name;
    return `${packageName ? `${packageName}.` : ""}${binary}`;
  };

  const targets: JavaTestTarget[] = [];
  const seenClasses = new Set<string>();
  const methodPattern = /((?:@[A-Za-z_$][\w$.]*(?:\([^)]*\))?\s*)+)[\t ]*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:<[^>]+>\s*)?(?:void|[\w$<>, ?.[\]]+)\s+([A-Za-z_$][\w$]*)\s*\(/g;

  for (const match of text.matchAll(methodPattern)) {
    if (!testAnnotation.test(match[1] || "")) continue;
    // findLastIndex needs a newer lib target than this project compiles with.
    const owners = classes.filter((candidate) => candidate.index <= (match.index || 0));
    const ownerIndex = Math.max(0, owners.length - 1);
    const qualifiedClass = qualify(ownerIndex);
    if (!seenClasses.has(qualifiedClass)) {
      seenClasses.add(qualifiedClass);
      targets.push({
        line: lineOf(text, classes[ownerIndex].index),
        kind: "class",
        id: qualifiedClass,
        label: classes[ownerIndex].name,
      });
    }
    // The icon belongs on the signature, not on the annotation above it.
    const signatureIndex = (match.index || 0) + (match[1] || "").length;
    targets.push({
      line: lineOf(text, signatureIndex),
      kind: "method",
      id: `${qualifiedClass}#${match[2]}`,
      label: match[2],
    });
  }

  return targets.sort((left, right) => left.line - right.line);
}
