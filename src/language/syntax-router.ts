import { findJavaSyntaxProblems, type SyntaxProblem } from "./java-syntax";
import { findPythonSyntaxProblems } from "./python-syntax";
import { findJsonSyntaxProblems } from "./json-syntax";
import { findJavaScriptSyntaxProblems } from "./javascript-syntax";

export { findJavaSyntaxProblems, findPythonSyntaxProblems, findJsonSyntaxProblems, findJavaScriptSyntaxProblems };
export type { SyntaxProblem };

/**
 * Dispatches instant in-editor syntax and error analysis based on the file language.
 */
export function findCodeSyntaxProblems(language: string, source: string): SyntaxProblem[] {
  const lang = String(language || "").toLowerCase();

  if (lang === "python" || lang === "py") {
    return findPythonSyntaxProblems(source) as SyntaxProblem[];
  }

  if (lang === "java") {
    return findJavaSyntaxProblems(source);
  }

  if (lang === "json") {
    return findJsonSyntaxProblems(source) as SyntaxProblem[];
  }

  if (
    lang === "javascript" ||
    lang === "typescript" ||
    lang === "javascriptreact" ||
    lang === "typescriptreact" ||
    lang === "js" ||
    lang === "jsx" ||
    lang === "ts" ||
    lang === "tsx" ||
    lang === "mjs" ||
    lang === "cjs" ||
    lang === "mts" ||
    lang === "cts" ||
    lang === "node"
  ) {
    return findJavaScriptSyntaxProblems(source, lang);
  }

  return [];
}
