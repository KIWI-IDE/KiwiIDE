import type { IdeSettings, KiwiApi } from "./types";
import { findTheme, personalizationVariables } from "./themes";

/** Apply at the root so inherited ramps, portals and native controls agree. */
export function watchWindowAppearance(
  settings: Pick<KiwiApi["settings"], "get" | "onChanged">,
  root: HTMLElement,
  onSettings: (settings: IdeSettings) => void = () => undefined,
) {
  let revision = 0;
  let disposed = false;
  let appliedVariables: string[] = [];
  const apply = (value: IdeSettings) => {
    if (disposed) return;
    const variables = personalizationVariables(value);
    for (const name of appliedVariables) {
      if (!(name in variables)) root.style.removeProperty(name);
    }
    root.dataset.theme = findTheme(value.theme).id;
    for (const [name, color] of Object.entries(variables)) root.style.setProperty(name, color);
    appliedVariables = Object.keys(variables);
    onSettings(value);
  };
  // Subscribe first: a slow initial read must not undo a newer setting.
  const remove = settings.onChanged(({ settings: value }) => {
    revision += 1;
    apply(value);
  });
  const requestedAt = revision;
  void settings.get().then((value) => {
    if (revision === requestedAt) apply(value);
  }).catch(() => undefined);
  return () => { disposed = true; remove(); };
}
