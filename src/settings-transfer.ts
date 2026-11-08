import type { IdeSettings } from "./types";

/**
 * What a bundle needs a layout to be.
 *
 * Deliberately loose: the workbench owns the real shape and adds to it, and a
 * bundle that refused a layout carrying a field this module had not heard of
 * would break every time that shape grew.
 */
export interface TransferableLayout {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** What the file says it is, so a wrong file is refused rather than applied. */
export const SETTINGS_BUNDLE_KIND = "kiwi-settings";

/** The shape written today. Older bundles are still read. */
export const SETTINGS_BUNDLE_VERSION = 1;

/**
 * Settings that belong to one machine and must not travel to another.
 *
 * A bundle is meant to be shared — with a colleague, with a second machine, in
 * a repository. Every one of these is either a path that exists nowhere else,
 * a secret, or a record of what this person has been doing, and carrying them
 * over would at best break the other installation and at worst leak something.
 */
export const MACHINE_SPECIFIC_SETTINGS = [
  "jdkPath",
  "recentProjects",
  "lastWorkspace",
  "workspaceHistoryMigrated",
  "extraCertificates",
  "githubClientId",
  "backgroundImage",
  "schemaVersion",
] as const;

export interface SettingsBundle {
  kind: typeof SETTINGS_BUNDLE_KIND;
  version: number;
  exportedAt: string;
  settings: Partial<IdeSettings>;
  layouts: TransferableLayout[];
}

/**
 * Everything worth taking to another machine, and nothing else.
 *
 * Keymaps are part of the settings rather than a section of their own — they
 * are stored that way, and splitting them here would only invite the two to
 * drift apart.
 */
export function createSettingsBundle(settings: IdeSettings, layouts: TransferableLayout[]): SettingsBundle {
  const portable: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if ((MACHINE_SPECIFIC_SETTINGS as readonly string[]).includes(key)) continue;
    portable[key] = value;
  }
  return {
    kind: SETTINGS_BUNDLE_KIND,
    version: SETTINGS_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: portable as Partial<IdeSettings>,
    layouts: Array.isArray(layouts) ? layouts : [],
  };
}

/**
 * Reads a bundle back, refusing anything that is not one.
 *
 * The file comes from wherever somebody found it, so nothing in it is believed:
 * the kind has to say what it is, the settings have to be an object, and the
 * machine-specific keys are dropped on the way in as well as on the way out —
 * a bundle written by an older version still carries them.
 */
export function readSettingsBundle(text: string): { settings: Partial<IdeSettings>; layouts: TransferableLayout[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist keine gültige Kiwi-Einstellungsdatei.");
  }
  const bundle = parsed as Partial<SettingsBundle> | null;
  if (!bundle || typeof bundle !== "object" || bundle.kind !== SETTINGS_BUNDLE_KIND) {
    throw new Error("Die Datei ist keine Kiwi-Einstellungsdatei.");
  }
  if (Number(bundle.version) > SETTINGS_BUNDLE_VERSION) {
    throw new Error("Die Datei stammt aus einer neueren Kiwi-Version.");
  }
  const incoming = bundle.settings && typeof bundle.settings === "object" ? bundle.settings : {};
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if ((MACHINE_SPECIFIC_SETTINGS as readonly string[]).includes(key)) continue;
    settings[key] = value;
  }
  const layouts = Array.isArray(bundle.layouts)
    // A layout without an id or a name cannot be applied or offered, so it is
    // not worth carrying.
    ? bundle.layouts.filter((layout) => layout && typeof layout === "object" && layout.id && layout.name)
    : [];
  return { settings: settings as Partial<IdeSettings>, layouts };
}

/**
 * Puts imported layouts beside the ones already here.
 *
 * An imported layout replaces one of the same id, because that is the same
 * layout arriving in a newer form. One that is merely named the same is a
 * different layout and both are kept — losing somebody's arrangement to a name
 * collision would be the worse mistake.
 */
export function mergeLayouts(existing: TransferableLayout[], incoming: TransferableLayout[]): TransferableLayout[] {
  const byId = new Map(existing.map((layout) => [layout.id, layout]));
  for (const layout of incoming) byId.set(layout.id, layout);
  return [...byId.values()];
}
