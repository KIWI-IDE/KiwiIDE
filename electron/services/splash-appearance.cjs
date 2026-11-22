/** Reuse the renderer's theme anchors without loading its application. */
function splashAppearance(stylesheet, settings) {
  const palette = [...stylesheet.matchAll(/(?:\:root|\[data-theme=[^\]]+\])\s*\{[^}]*\}/g)].map(match => match[0]).join("\n");
  const known = [...palette.matchAll(/\[data-theme=["']?([a-z0-9-]+)["']?\]/g)].map(match => match[1]);
  const theme = known.includes(settings.theme) ? settings.theme : "kiwi-nord";
  const block = [...palette.matchAll(/\[data-theme=["']?([a-z0-9-]+)["']?\]\s*\{([^}]*)\}/g)].find(match => match[1] === theme)?.[2] || "";
  const light = /color-scheme\s*:\s*light/.test(block);
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accentColor) ? settings.accentColor : "#88c0d0";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
  const shade = clamp(settings.themeShade, -40, 40);
  const declarations = {
    "--accent": accent,
    "--accent-bright": `color-mix(in srgb, ${accent} 74%, #ffffff)`,
    "--accent-dim": `color-mix(in srgb, ${accent} 44%, #000000)`,
    "--theme-shade": `${Math.abs(shade)}%`,
    "--theme-shade-surface": shade >= 0 ? "#ffffff" : "#000000",
    "--theme-shade-ink": shade >= 0 ? "#000000" : "#ffffff",
    "--theme-tint": `${clamp(settings.themeTint, 0, 30)}%`,
    "--theme-contrast": `${clamp(settings.themeContrast, 0, 30)}%`,
    "--theme-contrast-surface": light ? "#ffffff" : "#000000",
    "--theme-contrast-ink": light ? "#000000" : "#ffffff",
  };
  for (const [key, variable] of Object.entries({ chromeBackground: "--chrome-base-source", chromeForeground: "--chrome-fg-source", panelBackground: "--panel-base-source", panelForeground: "--panel-fg-source" })) {
    const value = settings.themeColorOverrides?.[key];
    if (/^[0-9a-f]{6}$/i.test(value || "")) declarations[variable] = `#${value}`;
  }
  return { theme, css: `${palette}\n:root{${Object.entries(declarations).map(([name, value]) => `${name}:${value}`).join(";")}}` };
}

module.exports = { splashAppearance };
