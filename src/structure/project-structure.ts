import type { DependencyAudit, JdkInfo, ModuleInfo, ProjectInfo, ProjectSettings } from "../types";

export interface StructureProblem {
  severity: "error" | "warning";
  /** Section the problem belongs to, so a click can jump there. */
  section: "project" | "modules" | "libraries" | "sdks";
  title: string;
  detail: string;
}

/**
 * Configuration problems of a project, the way IntelliJ's Project Structure
 * collects them in one place.
 *
 * These are settings that only fail much later — a language level the SDK
 * cannot compile shows up as a build error, a module without a source root as
 * a class that is never found. Listing them where they are configured is the
 * whole point of the dialog.
 */
export function projectStructureProblems(
  project: ProjectInfo,
  settings: ProjectSettings | null,
  modules: readonly ModuleInfo[],
  jdks: readonly JdkInfo[],
  audit: DependencyAudit | null,
): StructureProblem[] {
  const problems: StructureProblem[] = [];
  const jdkMajor = Number(project.jdkMajor || 0);
  const languageLevel = Number(settings?.languageLevel || project.languageLevel || 0);

  if (!jdks.length) {
    problems.push({
      severity: "error",
      section: "sdks",
      title: "Kein JDK gefunden",
      detail: "Ohne SDK lassen sich weder Build noch Tests noch Debugging starten.",
    });
  }

  if (languageLevel > 0 && jdkMajor > 0 && languageLevel > jdkMajor) {
    problems.push({
      severity: "error",
      section: "project",
      title: `Language Level ${languageLevel} über dem SDK`,
      detail: `Das ausgewählte SDK beherrscht nur Java ${jdkMajor}. Build, Tests und Debugging bleiben blockiert.`,
    });
  }

  if (settings?.jdkPath && jdks.length && !jdks.some((jdk) => jdk.path === settings.jdkPath)) {
    problems.push({
      severity: "warning",
      section: "project",
      title: "Project SDK zeigt auf einen unbekannten Pfad",
      detail: settings.jdkPath,
    });
  }

  for (const module of modules) {
    if (!module.sourceRoots.length) {
      problems.push({
        severity: "warning",
        section: "modules",
        title: `${module.name} hat kein Source Root`,
        detail: "Klassen dieses Moduls werden nicht übersetzt und sind für Ausführung und Debugger unsichtbar.",
      });
    }
    const moduleLevel = Number(module.languageLevel || 0);
    if (moduleLevel > 0 && jdkMajor > 0 && moduleLevel > jdkMajor) {
      problems.push({
        severity: "error",
        section: "modules",
        title: `${module.name} verlangt Java ${moduleLevel}`,
        detail: `Das SDK des Moduls beherrscht nur Java ${jdkMajor}.`,
      });
    }
    for (const dependency of module.dependencies) {
      if (!modules.some((candidate) => candidate.id === dependency)) {
        problems.push({
          severity: "error",
          section: "modules",
          title: `${module.name} hängt von einem unbekannten Modul ab`,
          detail: dependency,
        });
      }
    }
  }

  // Two modules under one name make every dependency between them ambiguous.
  const seen = new Map<string, number>();
  for (const module of modules) seen.set(module.name, (seen.get(module.name) || 0) + 1);
  for (const [name, count] of seen) {
    if (count > 1) {
      problems.push({
        severity: "warning",
        section: "modules",
        title: `Modulname „${name}“ ist ${count}-mal vergeben`,
        detail: "Abhängigkeiten zwischen gleichnamigen Modulen sind nicht eindeutig.",
      });
    }
  }

  for (const warning of audit?.warnings || []) {
    problems.push({
      severity: "warning",
      section: "libraries",
      title: warning.coordinate,
      detail: warning.message,
    });
  }

  return problems;
}
