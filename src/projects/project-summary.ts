/**
 * When a project was last opened, said the way a person would say it.
 *
 * The hub listed a timestamp nobody reads and sorted by it invisibly. "Vor 2
 * Stunden" is what somebody actually wants to know when choosing between four
 * projects that all look alike.
 */
export function lastOpenedLabel(iso: string, now = Date.now()): string {
  const when = Date.parse(String(iso || ""));
  if (!Number.isFinite(when)) return "";
  const minutes = Math.floor((now - when) / 60_000);
  if (minutes < 0) return "gerade eben";
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "vor 1 Woche" : `vor ${weeks} Wochen`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "vor 1 Monat" : `vor ${months} Monaten`;
  const years = Math.floor(days / 365);
  return years === 1 ? "vor 1 Jahr" : `vor ${years} Jahren`;
}

/**
 * Which projects a search term keeps.
 *
 * Matches the name and the path, because "the one under D:\programmierung" is
 * as likely a way to look for a project as its name.
 */
export function filterProjects<T extends { name: string; root: string }>(projects: T[], query: string): T[] {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return projects;
  const parts = needle.split(/\s+/).filter(Boolean);
  return projects.filter((project) => {
    const haystack = `${project.name} ${project.root}`.toLocaleLowerCase();
    return parts.every((part) => haystack.includes(part));
  });
}

/** How a build type reads in the list, "" for one nobody has determined yet. */
export function buildTypeLabel(type: string | undefined): string {
  if (type && ["Gradle", "Maven", "Kotlin", "Python", "Rust", "PHP", "Lua", "Go", "C", "C++", "C#", "Objective-C", "Objective-C++"].includes(type)) return type;
  if (type === "Java") return "Plain Java";
  return "";
}
