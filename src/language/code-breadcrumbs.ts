/**
 * Computes breadcrumb segments (folder path and enclosing code symbol)
 * for the editor header.
 */

export interface BreadcrumbSegment {
  label: string;
  kind?: "root" | "folder" | "file" | "class" | "function" | "method" | "interface" | "type";
  path?: string;
}

/**
 * Splits a relative path into folder and file breadcrumbs.
 */
export function relativePathBreadcrumbs(relativePath: string): BreadcrumbSegment[] {
  const parts = String(relativePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length) return [];

  const segments: BreadcrumbSegment[] = [];
  let currentPath = "";

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const isLast = i === parts.length - 1;

    segments.push({
      label: part,
      kind: isLast ? "file" : "folder",
      path: currentPath,
    });
  }

  return segments;
}

/**
 * Detects the enclosing code symbol (function, method, class, interface) at the given line (1-based).
 */
export function enclosingCodeSymbol(
  source: string,
  targetLine: number,
  language: string,
): { name: string; kind: "class" | "function" | "method" | "interface" | "type" } | null {
  const lines = String(source || "").split(/\r?\n/);
  const maxLine = Math.min(targetLine, lines.length);

  // Scan backwards from targetLine to 1 to find the closest enclosing declaration
  for (let i = maxLine - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) {
      continue;
    }

    // Classes / Structs / Interfaces
    const classMatch = line.match(/\b(?:class|struct|enum)\s+([A-Za-z_$][\w$]*)/);
    if (classMatch) {
      return { name: classMatch[1], kind: "class" };
    }

    const ifaceMatch = line.match(/\b(?:interface|type)\s+([A-Za-z_$][\w$]*)/);
    if (ifaceMatch) {
      return { name: ifaceMatch[1], kind: ifaceMatch[0].startsWith("interface") ? "interface" : "type" };
    }

    // Python def
    const pyDefMatch = line.match(/\bdef\s+([A-Za-z_]\w*)\s*\(/);
    if (pyDefMatch) {
      return { name: `${pyDefMatch[1]}()`, kind: "function" };
    }

    // Functions in JS/TS/Go/Rust/Kotlin/PHP
    const fnMatch = line.match(/\b(?:function|fn|func)\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (fnMatch) {
      return { name: `${fnMatch[1]}()`, kind: "function" };
    }

    // Arrow functions / assigned functions: `const foo = () =>` or `export const foo = (`
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    if (arrowMatch) {
      return { name: `${arrowMatch[1]}()`, kind: "function" };
    }

    // React FC or component: `export const App: React.FC<...>`, `function App(...)`, `const App = (...) =>`
    const reactComponentMatch = line.match(/(?:export\s+(?:default\s+)?)?(?:function|(?:const|let|var))\s+([A-Z][A-Za-z0-9_$]*)\s*(?::\s*(?:React\.)?(?:FC|FunctionComponent)|<|\(|\s*=)/);
    if (reactComponentMatch) {
      return { name: `<${reactComponentMatch[1]} />`, kind: "function" };
    }

    // Standard methods: `methodName(...) {` or `public void methodName(...)`
    const methodMatch = line.match(/(?:public|private|protected|static|async)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:\w\s<>]*\{/);
    if (methodMatch && !["if", "for", "while", "switch", "catch"].includes(methodMatch[1])) {
      return { name: `${methodMatch[1]}()`, kind: "method" };
    }
  }

  return null;
}
