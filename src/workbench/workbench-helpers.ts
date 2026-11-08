/**
 * The small answers the workbench keeps asking for.
 *
 * What kind of file a name is, which package a folder stands for, whether a
 * buffer holds something the disk does not — none of it touches state, and all
 * of it lived in App.tsx only because that is where it was first needed. A
 * question with one right answer belongs where it can be read on its own.
 */
import type { IdeSettings, OpenFile, ProjectTask } from "../types";
import type { WorkbenchLayout } from "./workbench-types";

export function safeDecodeUri(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function javaBreadcrumbParts(content: string, line: number) {
  const source = content.split(/\r?\n/).slice(0, Math.max(1, line)).join("\n");
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] || "";
  const classMatches = [...source.matchAll(/\b(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/g)];
  const methodMatches = [...source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^{]+)?\{/g)]
    .filter((match) => !["if", "for", "while", "switch", "catch", "try", "synchronized"].includes(match[1]));
  return {
    packageName,
    className: classMatches.at(-1)?.[1] || "",
    methodName: methodMatches.at(-1)?.[1] || "",
  };
}

export function qualifiedJavaClassName(file: OpenFile) {
  const packageName = file.content.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
  return `${packageName ? `${packageName}.` : ""}${file.name.replace(/\.java$/i, "")}`;
}

export function splitUnifiedDiff(source: string) {
  return String(source || "").split(/\r?\n/).map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return { left: "", right: line, kind: "add" as const };
    if (line.startsWith("-") && !line.startsWith("---")) return { left: line, right: "", kind: "remove" as const };
    return { left: line, right: line, kind: line.startsWith("@@") ? "header" as const : "context" as const };
  });
}

export function stableHue(value: string) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function nextDockLabel(current: WorkbenchLayout["rightToolDock"]) {
  return current === "right" ? "unten" : current === "bottom" ? "links" : "rechts";
}

export function fileKind(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "java") return "java";
  if (extension === "xml") return "xml";
  if (extension === "json") return "json";
  if (extension === "gradle" || extension === "kts") return "gradle";
  if (extension === "md") return "markdown";
  if (name === "pom.xml") return "maven";
  if (extension === "tsx") return "tsx";
  if (extension === "jsx") return "jsx";
  if (extension === "ts") return "typescript";
  if (extension === "js" || extension === "mjs" || extension === "cjs") return "javascript";
  return "default";
}

/**
 * Whether a buffer holds something the disk does not.
 *
 * Two ways that happens: the text was edited, or the file went away while the
 * text stayed. Both mean the same thing to everyone who asks — the tab marker,
 * the close warning, "save all" — and they used to ask three different
 * questions, so a vanished file was marked in the tab strip and ignored by
 * everything else.
 */
export function isUnsaved(file: OpenFile): boolean {
  return file.content !== file.savedContent || Boolean(file.missing);
}

export function isProjectDefinition(path: string) {
  return /(?:^|[\\/])(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties|\.classpath|modules\.json|project\.json)$/i.test(path);
}

export function contentFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export function explainBuildToolFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/offline|cached version|available for offline/i.test(raw)) {
    return `Offline-Modus: Eine benötigte Abhängigkeit liegt nicht im lokalen Cache. Deaktiviere „Offline“ im Build-Menü oder lade sie einmal mit Netzwerkzugang.`;
  }
  if (/could not find|could not resolve|non-resolvable|unknown host|name or service not known/i.test(raw)) {
    return "Repository-Problem: Eine Abhängigkeit konnte nicht aufgelöst werden. Prüfe Repository-URL, Proxy, Zugangsdaten und Internetverbindung.";
  }
  if (/gradle-wrapper|wrapper.*(missing|not found)|mvnw.*(missing|not found)/i.test(raw)) {
    return "Wrapper-Problem: Projekt-Wrapper fehlt oder ist unvollständig. Kiwi verwendet ersatzweise das gebündelte Build-Werkzeug, sofern möglich.";
  }
  if (/permission denied|access is denied|eacces|eperm/i.test(raw)) {
    return "Zugriffsproblem: Das Build-Werkzeug kann eine Projekt- oder Cache-Datei nicht lesen bzw. schreiben.";
  }
  return raw || "Projekt-Synchronisierung fehlgeschlagen.";
}

/**
 * The space the workbench really has, in the coordinate system it draws in.
 *
 * UI scaling is applied as `zoom`, which leaves window.innerWidth reporting
 * device pixels while everything laid out inside counts in scaled ones. Sizes
 * compared against the raw window are therefore too generous by exactly the
 * scale factor.
 */
/**
 * Keeps a popup that was placed at the pointer inside the window.
 *
 * A context menu opened near the right or bottom edge ran off the screen: the
 * mouse position is where it *starts*, not where it fits. Measured after the
 * menu is in the DOM, because its size depends on its entries.
 */
export function clampPopupToViewport(node: HTMLElement | null) {
  if (!node) return;
  const room = effectiveViewport();
  const rect = node.getBoundingClientRect();
  const scale = Number((document.body.style as CSSStyleDeclaration & { zoom: string }).zoom) || 1;
  const width = rect.width / scale;
  const height = rect.height / scale;
  const left = Number.parseFloat(node.style.left) || 0;
  const top = Number.parseFloat(node.style.top) || 0;
  // Never push it past the top-left corner, however small the window is.
  node.style.left = `${Math.max(4, Math.min(left, room.width - width - 4))}px`;
  node.style.top = `${Math.max(4, Math.min(top, room.height - height - 4))}px`;
}

export function effectiveViewport() {
  const scale = Number((document.body.style as CSSStyleDeclaration & { zoom: string }).zoom) || 1;
  return { width: window.innerWidth / scale, height: window.innerHeight / scale };
}

export function taskGroupLabel(task: ProjectTask): string {
  const explicit = String(task.group || "").trim();
  const labels: Record<string, string> = {
    application: "Anwendung",
    build: "Build",
    "build setup": "Projekt-Setup",
    "build-lifecycle": "Build-Lifecycle",
    lifecycle: "Build-Lifecycle",
    plugins: "Plugins",
    "häufig verwendet": "Häufig verwendet",
    dependencies: "Abhängigkeiten",
    abhängigkeiten: "Abhängigkeiten",
    "help": "Hilfe & Diagnose",
    documentation: "Dokumentation",
    verification: "Verifikation",
    verifikation: "Verifikation",
    publishing: "Veröffentlichung",
    veröffentlichung: "Veröffentlichung",
    java: "Java",
    other: "Weitere Tasks",
    "weitere tasks": "Weitere Tasks",
  };
  if (explicit) return labels[explicit.toLocaleLowerCase()] || explicit;
  const name = task.name.split(":").filter(Boolean).at(-1)?.toLocaleLowerCase() || task.name.toLocaleLowerCase();
  if (/^(run|start|bootrun|runshadow|installdist)$/.test(name)) return "Anwendung";
  if (/^(test|check|verification|jacocotestreport|spotlesscheck|checkstylemain|pmdmain)$/.test(name)) return "Verifikation";
  // shadowJar and bootJar are what a project is usually built for; leaving them
  // under "other tasks" put the one task somebody wants at the very bottom.
  if (/^(build|clean|assemble|classes|jar|shadowjar|bootjar|war|compilejava|compiletestjava|compilekotlin)$/.test(name)) return "Build";
  if (/^(publish|publishtomavenlocal|distzip|disttar|assembledist)$/.test(name)) return "Veröffentlichung";
  if (/^(dependencies|dependencyinsight|projects|properties|tasks|help|javadoc)$/.test(name)) return "Hilfe & Diagnose";
  return "Weitere Tasks";
}

export function groupProjectTasks(tasks: ProjectTask[], query: string): Array<{ name: string; tasks: ProjectTask[] }> {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = tasks.filter((task) =>
    !needle || `${task.name} ${task.description} ${task.group || ""}`.toLocaleLowerCase().includes(needle));
  // The build service marks its everyday invocations with an explicit group.
  // Deciding this by task name instead would tear "clean" and "test" out of
  // the Maven lifecycle listing, which is only useful when it stays complete.
  const favorites = filtered.filter((task) => taskGroupLabel(task) === "Häufig verwendet");
  const favoritesSet = new Set(favorites);
  const grouped = new Map<string, ProjectTask[]>();
  for (const task of filtered) {
    if (favoritesSet.has(task)) continue;
    const name = taskGroupLabel(task);
    grouped.set(name, [...(grouped.get(name) || []), task]);
  }
  const order = ["Anwendung", "Build", "Build-Lifecycle", "Plugins", "Verifikation", "Abhängigkeiten", "Java", "Projekt-Setup", "Dokumentation", "Veröffentlichung", "Hilfe & Diagnose", "Weitere Tasks"];
  const groups = [...grouped.entries()]
    .sort(([left], [right]) => {
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
        || left.localeCompare(right);
    })
    .map(([name, groupTasks]) => ({ name, tasks: groupTasks }));
  return favorites.length ? [{ name: "Häufig verwendet", tasks: favorites }, ...groups] : groups;
}

export function parseEnvironmentTemplate(value: string): Record<string, string> {
  return Object.fromEntries(String(value || "")
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, ...rest] = entry.split("=");
      return [key.trim(), rest.join("=").trim()];
    })
    .filter(([key]) => Boolean(key)));
}

export function editorTabSize(settings: IdeSettings, language: string): number {
  if (language === "java") return settings.javaTabSize;
  if (language === "xml") return settings.xmlTabSize;
  if (language === "groovy" || language === "kotlin") return settings.gradleTabSize;
  return settings.tabSize;
}

export function storedJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function storeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full quota must not take the workbench down; the layout is a nicety.
  }
}

export function legacyProjectRoots(): string[] {
  const roots: string[] = [];
  const add = (candidate: unknown) => {
    if (typeof candidate !== "string" || !/^[a-zA-Z]:[\\/]/.test(candidate)) return;
    if (!roots.some((root) => root.toLowerCase() === candidate.toLowerCase())) roots.push(candidate);
  };
  add(localStorage.getItem("kiwi.lastWorkspace"));
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    const match = key.match(/^kiwi\.(?:session(?:\.v2)?|explorer\.expanded\.v1):(.+)$/);
    if (match) add(match[1]);
  }
  for (const metric of storedJson<Array<{ projectRoot?: string }>>("kiwi.performance.metrics.v1", [])) {
    add(metric.projectRoot);
  }
  return roots;
}

export function javaPackageAt(projectRoot: string, directory: string, projectType: string) {
  const normalizedRoot = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedDirectory = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedDirectory.toLowerCase().startsWith(normalizedRoot.toLowerCase())) return "";
  const lower = normalizedDirectory.toLowerCase();
  const markers = projectType === "Java"
    ? ["/src/main/java", "/src/test/java", "/src"]
    : ["/src/main/java", "/src/test/java"];
  const match = markers
    .map((marker) => ({ marker, index: lower.lastIndexOf(marker) }))
    .filter((candidate) => candidate.index >= normalizedRoot.length)
    .sort((left, right) => right.index - left.index || right.marker.length - left.marker.length)[0];
  if (!match) return "";
  const sourceRootLength = match.index + match.marker.length;
  return normalizedDirectory
    .slice(sourceRootLength)
    .split("/")
    .filter(Boolean)
    .join(".");
}
