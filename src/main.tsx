import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { locales, setActiveLocale, type Locale } from "./i18n";
import "./styles.css";

/**
 * The chosen language, applied before anything renders.
 *
 * Settings, the project structure, a detached terminal and a tool window in a
 * window of its own are each their own renderer, and each of them reaches for
 * the translator through the module rather than through the workbench. Only the
 * workbench ever set the language, so every one of those windows opened in
 * German no matter what was chosen — which is what "the settings are not
 * translated" looked like from the outside.
 *
 * The language is remembered in localStorage so it can be applied in the same
 * tick the window starts in: asking the main process first would show one
 * German frame, and rendering nothing until the answer arrives would leave a
 * window that never appears if the answer never comes.
 */
const REMEMBERED_LOCALE = "kiwi.locale";

function knownLocale(value: unknown): Locale | null {
  return locales.some((entry) => entry.id === value) ? (value as Locale) : null;
}

let applied = knownLocale(localStorage.getItem(REMEMBERED_LOCALE)) ?? "de";
setActiveLocale(applied);

const root = ReactDOM.createRoot(document.getElementById("root")!);
const render = () => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/** Re-renders only when the language really changed; `t` is not reactive. */
function useLocale(value: unknown) {
  const locale = knownLocale(value);
  if (!locale) return;
  localStorage.setItem(REMEMBERED_LOCALE, locale);
  if (locale === applied) return;
  applied = locale;
  setActiveLocale(locale);
  render();
}

render();

// The stored language can be stale — another machine's profile, or a setting
// changed while this window was closed — so it is corrected from the settings
// service as soon as that answers, and again whenever it changes.
void window.kiwi?.settings.get().then((settings) => useLocale(settings?.locale)).catch(() => undefined);
window.kiwi?.settings.onChanged(({ settings }) => useLocale(settings?.locale));
