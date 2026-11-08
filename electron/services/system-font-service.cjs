const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const WINDOWS_FONT_REGISTRY_KEYS = Object.freeze([
  "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
]);

const STANDARD_FONT_FALLBACKS = Object.freeze({
  win32: Object.freeze([
    "JetBrains Mono",
    "Cascadia Code",
    "Cascadia Mono",
    "Consolas",
    "Segoe UI",
    "Arial",
    "Courier New",
  ]),
  darwin: Object.freeze([
    "SF Mono",
    "Menlo",
    "Monaco",
    "Helvetica Neue",
    "Arial",
  ]),
  linux: Object.freeze([
    "DejaVu Sans Mono",
    "Liberation Mono",
    "Noto Sans Mono",
    "Ubuntu Mono",
    "monospace",
  ]),
});

/**
 * Turns one Windows Fonts registry value name into CSS font-family candidates.
 *
 * `reg query` prints the registry value name, its type and its backing file.
 * Only the value name is useful here. Collections such as
 * "Cambria & Cambria Math (TrueType)" expose more than one family and are
 * therefore split into individually selectable entries.
 */
function normalizeRegistryFontName(valueName) {
  let name = String(valueName || "")
    .replace(/\0/g, "")
    .replace(/\s+\((?:TrueType|OpenType|Type\s*1)\)\s*$/i, "")
    // These are face styles, not separate CSS families. Windows does expose
    // weights such as "Calibri Light" as distinct installed families, so the
    // deliberately small list must not strip Light/Semibold/Black.
    .replace(/\s+(?:Bold\s+(?:Italic|Oblique)|Bold|Italic|Oblique|Regular)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || /^\(default\)$/i.test(name)) return [];

  // Windows uses ` & ` for TTC collections. A literal ampersand inside a
  // family is normally not surrounded by spaces, so this remains conservative.
  return name.split(/\s+&\s+/).map((family) => family.trim()).filter(Boolean);
}

/** Parses the stable, column-oriented output produced by `reg.exe query`. */
function parseWindowsFontRegistry(output) {
  const families = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    // REG_SZ and REG_EXPAND_SZ are the only value types used for font files.
    // Requiring the type marker also ignores headings and error messages.
    const match = /^\s*(.*?)\s{2,}REG_(?:EXPAND_)?SZ\s{2,}.*$/i.exec(line);
    if (!match) continue;
    families.push(...normalizeRegistryFontName(match[1]));
  }
  return families;
}

function fontFallbacksFor(platform = process.platform) {
  return [...(STANDARD_FONT_FALLBACKS[platform] || STANDARD_FONT_FALLBACKS.linux)];
}

/** Case-insensitive de-duplication followed by deterministic display sorting. */
function deduplicateAndSortFontFamilies(values) {
  const unique = new Map();
  for (const value of values || []) {
    const raw = String(value || "");
    if (/[\r\n\0]/.test(raw)) continue;
    const family = raw.replace(/\s+/g, " ").trim();
    if (!family) continue;
    const key = family.normalize("NFKC").toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, family);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right, "en-US", {
    sensitivity: "base",
    numeric: true,
  }));
}

function regExecutable(env = process.env) {
  const systemRoot = path.win32.resolve(String(env.SystemRoot || env.WINDIR || "C:\\Windows"));
  return path.win32.join(systemRoot, "System32", "reg.exe");
}

async function readRegistryKey(key) {
  const { stdout = "" } = await execFileAsync(regExecutable(), ["query", key], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  return stdout;
}

class SystemFontService {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.readRegistryKey = options.readRegistryKey || readRegistryKey;
    this.cache = null;
  }

  /**
   * Lists locally installed Windows font entries without writing to the
   * registry. A failed or restricted registry hive never breaks Settings: the
   * standard platform fallbacks remain available.
   */
  async list() {
    if (this.cache) return [...this.cache];

    const fallbacks = fontFallbacksFor(this.platform);
    if (this.platform !== "win32") {
      this.cache = deduplicateAndSortFontFamilies(fallbacks);
      return [...this.cache];
    }

    const reads = await Promise.allSettled(
      WINDOWS_FONT_REGISTRY_KEYS.map((key) => this.readRegistryKey(key)),
    );
    const installed = reads
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => parseWindowsFontRegistry(result.value));
    this.cache = deduplicateAndSortFontFamilies([...installed, ...fallbacks]);
    return [...this.cache];
  }
}

module.exports = {
  SystemFontService,
  WINDOWS_FONT_REGISTRY_KEYS,
  STANDARD_FONT_FALLBACKS,
  deduplicateAndSortFontFamilies,
  fontFallbacksFor,
  normalizeRegistryFontName,
  parseWindowsFontRegistry,
};
