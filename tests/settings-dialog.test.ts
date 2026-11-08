import { describe, expect, it } from "vitest";
import { changedSettingsPatch } from "../src/components/SettingsDialog";

describe("settings Apply payload", () => {
  it("does not send an untouched dock snapshot with an unrelated setting", () => {
    const saved = {
      fontSize: 14,
      theme: "kiwi-new-dark",
      panelViewDocks: { debug: "bottom" },
    };
    const edited = { ...saved, fontSize: 16 };

    expect(changedSettingsPatch(edited, saved)).toEqual({ fontSize: 16 });
  });

  it("includes dock placement only when it was actually edited", () => {
    const saved = { panelViewDocks: { debug: "bottom" }, fontSize: 14 };
    const edited = { ...saved, panelViewDocks: { debug: "right" } };

    expect(changedSettingsPatch(edited, saved)).toEqual({ panelViewDocks: { debug: "right" } });
  });
});
