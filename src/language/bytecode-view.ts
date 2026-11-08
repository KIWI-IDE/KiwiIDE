/**
 * What the compiler actually made of a file.
 *
 * The question comes up rarely and matters entirely when it does: what a
 * lambda captures, whether a string concatenation became a builder or an
 * invokedynamic, which of two overloads a call actually picked, what a record
 * generates. Reading the class file is the only way to know, and doing it
 * meant leaving the IDE for a terminal and remembering javap's flags.
 *
 * `javap` ships with every JDK, so nothing has to be bundled. What is needed
 * here is the part around it: the class a source file becomes, the arguments
 * worth passing, and reading its answer well enough to say when there isn't
 * one — a class that has not been compiled yet produces an error whose text is
 * about a classpath, which explains nothing to whoever pressed the button.
 */

/** How javap is asked. Constant, so the output is always the same shape. */
export const JAVAP_ARGUMENTS = ["-c", "-p", "-l"];

/**
 * The binary name of the class a source file declares.
 *
 * Java's own rule: a public top-level type is named after its file, and the
 * package it is in is written at the top. Answers "" when the file says
 * neither, which the caller reports rather than guesses past.
 */
export function binaryClassName(filePath: string, source: string): string {
  const file = String(filePath || "").replace(/\\/g, "/").split("/").at(-1) || "";
  if (!file.toLowerCase().endsWith(".java")) return "";
  const simple = file.slice(0, -".java".length);
  if (!simple) return "";
  const packageName = String(source || "").match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
  return packageName ? `${packageName}.${simple}` : simple;
}

/** The tab's name for a class, which is the class and not the file. */
export function bytecodeTitle(binaryName: string): string {
  const simple = String(binaryName || "").split(".").at(-1) || String(binaryName || "");
  return simple ? `${simple}.bytecode` : "bytecode";
}

export interface BytecodeResult {
  /** What javap printed, when it printed something usable. */
  text: string;
  /** In German, and about what the reader can do — empty when it worked. */
  problem: string;
}

/**
 * Reads javap's answer.
 *
 * Its failures are about classpaths and its successes start with the class
 * declaration. The distinction matters because the commonest failure by far is
 * a class that simply has not been compiled yet, and "class not found" is not
 * what somebody who just pressed a button needs to be told.
 */
export function readBytecode(stdout: string, stderr: string, binaryName: string): BytecodeResult {
  const output = String(stdout || "").trim();
  const errors = String(stderr || "").trim();
  const named = binaryName || "Die Klasse";

  if (/error:\s*class not found/i.test(errors) || /error:\s*cannot access/i.test(errors)) {
    return {
      text: "",
      problem: `${named} ist noch nicht übersetzt. Baue das Projekt und versuche es erneut.`,
    };
  }
  if (!output) {
    return {
      text: "",
      problem: errors
        ? `javap konnte ${named} nicht lesen: ${errors.split("\n")[0]}`
        : `javap hat zu ${named} nichts ausgegeben.`,
    };
  }
  return { text: output, problem: "" };
}

/**
 * Where in the bytecode a source line ended up.
 *
 * javap prints a LineNumberTable per method when asked with -l, which is what
 * makes it possible to put the caret on a line and see the instructions it
 * became. Answers the offsets in order; an empty list where the class carries
 * no line numbers, which is what a stripped build looks like.
 */
export function bytecodeOffsetsForLine(javapOutput: string, line: number): number[] {
  const wanted = Number(line) || 0;
  if (!wanted) return [];
  const offsets: number[] = [];
  for (const match of String(javapOutput || "").matchAll(/^\s*line\s+(\d+):\s*(\d+)\s*$/gm)) {
    if (Number(match[1]) === wanted) offsets.push(Number(match[2]));
  }
  return offsets;
}

/**
 * The methods javap listed, for a summary above the listing.
 *
 * Read from the declarations rather than from the code, so a method whose body
 * javap could not print still appears.
 */
export function bytecodeMethods(javapOutput: string): string[] {
  const methods: string[] = [];
  for (const raw of String(javapOutput || "").split(/\r?\n/)) {
    const line = raw.trim();
    // A declaration ends in a semicolon and is not an instruction, and
    // instructions are always indented under one.
    if (!line.endsWith(";") || /^\d+:/.test(line)) continue;
    if (!/\(.*\)/.test(line)) continue;
    if (raw.startsWith("      ")) continue;
    methods.push(line.replace(/;$/, ""));
  }
  return methods;
}
