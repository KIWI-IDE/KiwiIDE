/**
 * Single source of truth for the available workbench themes.
 *
 * The UI side of a theme lives entirely in styles.css as a `[data-theme="…"]`
 * block that overrides the ramp anchors. This file only carries what code has
 * to know: the id, the label shown in the settings, whether the theme is light,
 * and the matching Monaco editor colours.
 */

import {
  javaKeywordGroups,
  javaKeywordTokenId,
  type JavaKeywordTokenId,
} from "./language/java-keywords";

export interface KiwiTheme {
  id: string;
  label: string;
  group: "Dunkel" | "Hell";
  /** Monaco base to inherit from. */
  base: "vs" | "vs-dark" | "hc-black";
  /** Editor surface colours, kept in sync with the CSS panel ramp. */
  editor: {
    background: string;
    foreground: string;
    lineHighlight: string;
    selection: string;
    cursor: string;
    lineNumber: string;
    lineNumberActive: string;
    indentGuide: string;
    indentGuideActive: string;
    widgetBackground: string;
    widgetBorder: string;
    suggestSelected: string;
  };
  /**
   * The syntax anchors a theme has to define (hex without the leading #).
   *
   * Every finer-grained token falls back to one of these, so a theme only
   * carries the handful of colours that give it its character while the user
   * can still recolour each token on its own.
   */
  tokens: BaseTokenColors;
  /** Optional finer-grained colours that make this theme more specific. */
  accents?: Partial<Record<TokenId, string>>;
}

export type BaseTokenId = "keyword" | "type" | "identifier" | "string" | "number" | "comment" | "error";
export type BaseTokenColors = Record<BaseTokenId, string>;

export const themes: KiwiTheme[] = [
  {
    id: "kiwi-new-dark",
    label: "Kiwi Dark",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#091216", foreground: "#dfe9eb", lineHighlight: "#0e1a20",
      selection: "#315b4677", cursor: "#8cdb4d", lineNumber: "#486068",
      lineNumberActive: "#a4b8bd", indentGuide: "#1b2b32", indentGuideActive: "#3b555e",
      widgetBackground: "#112027", widgetBorder: "#2c414a", suggestSelected: "#244332",
    },
    tokens: {
      keyword: "7FC7D7", type: "8ED45B", identifier: "DFEAEC",
      string: "A8D68A", number: "E3B878", comment: "668087", error: "FF6B6B",
    },
    accents: { controlKeyword: "D9A5E8", modifier: "7FC7D7", literal: "E3B878", annotation: "C9B06B", primitiveType: "6FB6C6", method: "BFD9F2", field: "C6C0E4", constant: "E3B878", javadocTag: "8AA6AC", operator: "AEC2C7", taskComment: "E4A04C" },
  },
  {
    id: "kiwi-light",
    label: "Kiwi Light",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#ffffff", foreground: "#1b2a30", lineHighlight: "#eef4f6",
      selection: "#bfe0c9aa", cursor: "#2f7a10", lineNumber: "#9aabb1",
      lineNumberActive: "#3d545c", indentGuide: "#dde6e9", indentGuideActive: "#a9bcc2",
      widgetBackground: "#f4f8f9", widgetBorder: "#c6d5d9", suggestSelected: "#d5ecd9",
    },
    tokens: {
      keyword: "0F6C86", type: "2F6B1B", identifier: "1B2A30",
      string: "2C6B22", number: "8A5510", comment: "6D8288", error: "C22B2B",
    },
    accents: { controlKeyword: "8A3FA8", modifier: "0F6C86", literal: "8A5510", annotation: "8A6B10", primitiveType: "0B5A70", method: "1F4F7A", field: "5B3E9B", constant: "8A5510", javadocTag: "55707A", operator: "44585F", taskComment: "B35A00" },
  },
  {
    id: "kiwi-high-contrast",
    label: "Kiwi High Contrast",
    group: "Dunkel",
    base: "hc-black",
    editor: {
      background: "#000000", foreground: "#ffffff", lineHighlight: "#1a1a1a",
      selection: "#2d6a2daa", cursor: "#8cff4d", lineNumber: "#8a8a8a",
      lineNumberActive: "#ffffff", indentGuide: "#3a3a3a", indentGuideActive: "#7a7a7a",
      widgetBackground: "#0a0a0a", widgetBorder: "#8a8a8a", suggestSelected: "#26501a",
    },
    tokens: {
      keyword: "6FD7FF", type: "9CFF5C", identifier: "FFFFFF",
      string: "B6FF9E", number: "FFD479", comment: "A8B4B8", error: "FF5C5C",
    },
  },
  {
    id: "kiwi-midnight",
    label: "Kiwi Midnight",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#070b18", foreground: "#dbe2f5", lineHighlight: "#0e1428",
      selection: "#2b4a8f77", cursor: "#5b8cff", lineNumber: "#4a5578",
      lineNumberActive: "#aab6da", indentGuide: "#1a2140", indentGuideActive: "#3a4570",
      widgetBackground: "#101736", widgetBorder: "#2b3763", suggestSelected: "#243a72",
    },
    tokens: {
      keyword: "7EA6FF", type: "8FD9FF", identifier: "DBE2F5",
      string: "9DDFB0", number: "E7B45F", comment: "6875A0", error: "FF7A93",
    },
    accents: { controlKeyword: "C792EA", modifier: "7EA6FF", literal: "E7B45F", annotation: "D7BA7D", primitiveType: "6FA8E0", method: "A6D4FF", field: "C3B7F0", constant: "E7B45F", javadocTag: "8892BC", operator: "A9B4D8", taskComment: "F0A040" },
  },
  {
    id: "kiwi-nord",
    label: "Kiwi Nord",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#262b35", foreground: "#eceff4", lineHighlight: "#2e3440",
      selection: "#4c67887a", cursor: "#88c0d0", lineNumber: "#5b6879",
      lineNumberActive: "#d8dee9", indentGuide: "#3b4252", indentGuideActive: "#5b6879",
      widgetBackground: "#2e3440", widgetBorder: "#4c566a", suggestSelected: "#3f5063",
    },
    tokens: {
      keyword: "81A1C1", type: "8FBCBB", identifier: "ECEFF4",
      string: "A3BE8C", number: "B48EAD", comment: "6C7A94", error: "BF616A",
    },
  },
  {
    id: "kiwi-dracula",
    label: "Kiwi Dracula",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#21222c", foreground: "#f8f8f2", lineHighlight: "#2b2d3a",
      selection: "#44475aaa", cursor: "#bd93f9", lineNumber: "#5b5f70",
      lineNumberActive: "#dcdce4", indentGuide: "#343746", indentGuideActive: "#5b5f70",
      widgetBackground: "#282a36", widgetBorder: "#44475a", suggestSelected: "#44475a",
    },
    tokens: {
      keyword: "FF79C6", type: "8BE9FD", identifier: "F8F8F2",
      string: "F1FA8C", number: "BD93F9", comment: "6272A4", error: "FF5555",
    },
  },
  {
    id: "kiwi-ember",
    label: "Kiwi Ember",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#120e0c", foreground: "#f2e7dc", lineHighlight: "#1d1613",
      selection: "#7a411f77", cursor: "#ff9159", lineNumber: "#6a564a",
      lineNumberActive: "#d7c3b3", indentGuide: "#2a1f1a", indentGuideActive: "#54423a",
      widgetBackground: "#1d1613", widgetBorder: "#4a352b", suggestSelected: "#4a2c18",
    },
    tokens: {
      keyword: "FFAB7D", type: "FFC76B", identifier: "F2E7DC",
      string: "C7D98A", number: "FF9159", comment: "8A7365", error: "FF5A47",
    },
    accents: { controlKeyword: "FFC76B", modifier: "FFAB7D", literal: "FF9159", annotation: "D9B36B", primitiveType: "E89A6B", method: "FFD9B0", field: "E8C4A0", constant: "FF9159", javadocTag: "A38A78", operator: "D6BCA8", taskComment: "FFD24A" },
  },
  {
    id: "kiwi-solarized-light",
    label: "Kiwi Solarized Light",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#fdf6e3", foreground: "#073642", lineHighlight: "#eee8d5",
      selection: "#d6cfb6aa", cursor: "#2a7a7a", lineNumber: "#93a1a1",
      lineNumberActive: "#586e75", indentGuide: "#e5dec7", indentGuideActive: "#b5ae97",
      widgetBackground: "#eee8d5", widgetBorder: "#c8c0a8", suggestSelected: "#dbd5bd",
    },
    tokens: {
      keyword: "859900", type: "268BD2", identifier: "073642",
      string: "2AA198", number: "CB4B16", comment: "93A1A1", error: "DC322F",
    },
  },
  {
    id: "kiwi-paper",
    label: "Kiwi Paper",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#fbfbfa", foreground: "#202226", lineHighlight: "#f0f0ee",
      selection: "#c5d9f5aa", cursor: "#2f6bd4", lineNumber: "#a8a8a4",
      lineNumberActive: "#4a4a50", indentGuide: "#e6e6e3", indentGuideActive: "#b6b6b2",
      widgetBackground: "#f2f2f0", widgetBorder: "#d2d2ce", suggestSelected: "#dbe6f7",
    },
    tokens: {
      keyword: "0F52A8", type: "7A45C0", identifier: "202226",
      string: "1F6B33", number: "96650F", comment: "7A7A80", error: "C0392B",
    },
  },
  {
    id: "kiwi-monokai",
    label: "Kiwi Monokai",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#272822", foreground: "#F8F8F2", lineHighlight: "#3E3D32",
      selection: "#49483Eaa", cursor: "#F8F8F0", lineNumber: "#75715E",
      lineNumberActive: "#C8C8C2", indentGuide: "#3B3A32", indentGuideActive: "#75715E",
      widgetBackground: "#1E1F1C", widgetBorder: "#75715E", suggestSelected: "#49483E",
    },
    tokens: {
      keyword: "F92672", type: "66D9EF", identifier: "F8F8F2",
      string: "E6DB74", number: "AE81FF", comment: "75715E", error: "F92672",
    },
  },
  {
    id: "kiwi-gruvbox",
    label: "Kiwi Gruvbox",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#282828", foreground: "#EBDBB2", lineHighlight: "#32302F",
      selection: "#504945aa", cursor: "#FE8019", lineNumber: "#7C6F64",
      lineNumberActive: "#D5C4A1", indentGuide: "#3C3836", indentGuideActive: "#665C54",
      widgetBackground: "#32302F", widgetBorder: "#504945", suggestSelected: "#45403D",
    },
    tokens: {
      keyword: "FB4934", type: "8EC07C", identifier: "EBDBB2",
      string: "B8BB26", number: "D3869B", comment: "928374", error: "FB4934",
    },
  },
  {
    id: "kiwi-tokyo",
    label: "Kiwi Tokyo Night",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#1A1B26", foreground: "#C0CAF5", lineHighlight: "#24283B",
      selection: "#33467Caa", cursor: "#7AA2F7", lineNumber: "#565F89",
      lineNumberActive: "#A9B1D6", indentGuide: "#292E42", indentGuideActive: "#3B4261",
      widgetBackground: "#24283B", widgetBorder: "#3B4261", suggestSelected: "#33467C",
    },
    tokens: {
      keyword: "BB9AF7", type: "2AC3DE", identifier: "C0CAF5",
      string: "9ECE6A", number: "FF9E64", comment: "565F89", error: "F7768E",
    },
  },
  {
    id: "kiwi-rose",
    label: "Kiwi Rosé",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#191724", foreground: "#E0DEF4", lineHighlight: "#1F1D2E",
      selection: "#403D52aa", cursor: "#EBBCBA", lineNumber: "#6E6A86",
      lineNumberActive: "#C4C1D8", indentGuide: "#26233A", indentGuideActive: "#403D52",
      widgetBackground: "#1F1D2E", widgetBorder: "#403D52", suggestSelected: "#31748F",
    },
    tokens: {
      keyword: "31748F", type: "9CCFD8", identifier: "E0DEF4",
      string: "F6C177", number: "EBBCBA", comment: "6E6A86", error: "FF6E8A",
    },
  },
  {
    id: "kiwi-slate",
    label: "Kiwi Slate",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#1C1F26", foreground: "#D6DBE5", lineHighlight: "#242833",
      selection: "#39415577", cursor: "#9AA5CE", lineNumber: "#5A6376",
      lineNumberActive: "#B4BCCC", indentGuide: "#282D38", indentGuideActive: "#454D5E",
      widgetBackground: "#242833", widgetBorder: "#394155", suggestSelected: "#333B4D",
    },
    tokens: {
      keyword: "8AB4F8", type: "9AD1C3", identifier: "D6DBE5",
      string: "C3E88D", number: "F0A868", comment: "636E85", error: "E06C75",
    },
  },
  {
    id: "kiwi-github-light",
    label: "Kiwi GitHub Light",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#FFFFFF", foreground: "#24292F", lineHighlight: "#F6F8FA",
      selection: "#B6D8FEaa", cursor: "#0969DA", lineNumber: "#8C959F",
      lineNumberActive: "#24292F", indentGuide: "#EAEEF2", indentGuideActive: "#AFB8C1",
      widgetBackground: "#F6F8FA", widgetBorder: "#D0D7DE", suggestSelected: "#DDF4FF",
    },
    tokens: {
      keyword: "CF222E", type: "953800", identifier: "24292F",
      string: "0A3069", number: "0550AE", comment: "6E7781", error: "CF222E",
    },
  },
  {
    id: "kiwi-sand",
    label: "Kiwi Sand",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#FAF7F0", foreground: "#3B3228", lineHighlight: "#F2ECE0",
      selection: "#DCCFB8aa", cursor: "#A6772C", lineNumber: "#A99C88",
      lineNumberActive: "#5C5140", indentGuide: "#EDE5D6", indentGuideActive: "#C4B69C",
      widgetBackground: "#F2ECE0", widgetBorder: "#D8CCB6", suggestSelected: "#E6DAC2",
    },
    tokens: {
      keyword: "A03E1E", type: "6B5424", identifier: "3B3228",
      string: "3F6B2E", number: "8A5A0F", comment: "9A8C76", error: "B03A2E",
    },
  },
  {
    id: "kiwi-mocha",
    label: "Kiwi Mocha",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#1e1e2e", foreground: "#cdd6f4", lineHighlight: "#262636",
      selection: "#45475aaa", cursor: "#f5e0dc", lineNumber: "#585b70",
      lineNumberActive: "#bac2de", indentGuide: "#313244", indentGuideActive: "#585b70",
      widgetBackground: "#181825", widgetBorder: "#45475a", suggestSelected: "#313244",
    },
    tokens: {
      keyword: "CBA6F7", type: "F9E2AF", identifier: "CDD6F4",
      string: "A6E3A1", number: "FAB387", comment: "6C7086", error: "F38BA8",
    },
    accents: {
      controlKeyword: "F5C2E7", modifier: "CBA6F7", literal: "FAB387", annotation: "F9E2AF",
      primitiveType: "89B4FA", method: "89B4FA", field: "B4BEFE", constant: "FAB387",
      javadocTag: "7F849C", operator: "94E2D5", taskComment: "F9E2AF",
    },
  },
  {
    id: "kiwi-one-dark",
    label: "Kiwi One Dark",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#282c34", foreground: "#abb2bf", lineHighlight: "#2f343d",
      selection: "#3e4451aa", cursor: "#528bff", lineNumber: "#4b5263",
      lineNumberActive: "#abb2bf", indentGuide: "#3b4048", indentGuideActive: "#5c6370",
      widgetBackground: "#21252b", widgetBorder: "#3e4451", suggestSelected: "#2c313a",
    },
    tokens: {
      keyword: "C678DD", type: "E5C07B", identifier: "ABB2BF",
      string: "98C379", number: "D19A66", comment: "5C6370", error: "E06C75",
    },
    accents: {
      controlKeyword: "C678DD", modifier: "C678DD", literal: "D19A66", annotation: "E5C07B",
      primitiveType: "56B6C2", method: "61AFEF", field: "E06C75", constant: "D19A66",
      javadocTag: "7F848E", operator: "56B6C2", taskComment: "E5C07B",
    },
  },
  {
    id: "kiwi-ayu",
    label: "Kiwi Ayu",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#0b0e14", foreground: "#bfbdb6", lineHighlight: "#131721",
      selection: "#409fff40", cursor: "#e6b450", lineNumber: "#3d4451",
      lineNumberActive: "#bfbdb6", indentGuide: "#1c212b", indentGuideActive: "#3d4451",
      widgetBackground: "#0f1419", widgetBorder: "#2d3640", suggestSelected: "#1c2733",
    },
    tokens: {
      keyword: "FF8F40", type: "59C2FF", identifier: "BFBDB6",
      string: "AAD94C", number: "D2A6FF", comment: "5C6773", error: "F07178",
    },
    accents: {
      controlKeyword: "FF8F40", modifier: "FF8F40", literal: "D2A6FF", annotation: "E6B450",
      primitiveType: "39BAE6", method: "FFB454", field: "59C2FF", constant: "D2A6FF",
      javadocTag: "6E7681", operator: "F29668", taskComment: "E6B450",
    },
  },
  {
    id: "kiwi-carbon",
    label: "Kiwi Carbon",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#0d0d0d", foreground: "#e0e0e0", lineHighlight: "#1a1a1a",
      selection: "#33405caa", cursor: "#78a9ff", lineNumber: "#525252",
      lineNumberActive: "#c6c6c6", indentGuide: "#262626", indentGuideActive: "#525252",
      widgetBackground: "#161616", widgetBorder: "#393939", suggestSelected: "#262626",
    },
    tokens: {
      keyword: "BE95FF", type: "78A9FF", identifier: "E0E0E0",
      string: "42BE65", number: "33B1FF", comment: "6F6F6F", error: "FF8389",
    },
    accents: {
      controlKeyword: "BE95FF", modifier: "BE95FF", literal: "33B1FF", annotation: "D4BBFF",
      primitiveType: "3DDBD9", method: "78A9FF", field: "82CFFF", constant: "33B1FF",
      javadocTag: "8D8D8D", operator: "3DDBD9", taskComment: "F1C21B",
    },
  },
  {
    id: "kiwi-everforest",
    label: "Kiwi Everforest",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#272e33", foreground: "#d3c6aa", lineHighlight: "#2e383c",
      selection: "#4f585eaa", cursor: "#a7c080", lineNumber: "#59676c",
      lineNumberActive: "#d3c6aa", indentGuide: "#374145", indentGuideActive: "#59676c",
      widgetBackground: "#2d353b", widgetBorder: "#4f585e", suggestSelected: "#3a4248",
    },
    tokens: {
      keyword: "E67E80", type: "DBBC7F", identifier: "D3C6AA",
      string: "A7C080", number: "D699B6", comment: "7A8478", error: "E67E80",
    },
    accents: {
      controlKeyword: "E69875", modifier: "E67E80", literal: "D699B6", annotation: "DBBC7F",
      primitiveType: "7FBBB3", method: "A7C080", field: "83C092", constant: "D699B6",
      javadocTag: "859289", operator: "E69875", taskComment: "DBBC7F",
    },
  },
  {
    id: "kiwi-synthwave",
    label: "Kiwi Synthwave",
    group: "Dunkel",
    base: "vs-dark",
    editor: {
      background: "#1b1426", foreground: "#f2e9ff", lineHighlight: "#261c35",
      selection: "#6b3a5eaa", cursor: "#ff7edb", lineNumber: "#6a5580",
      lineNumberActive: "#e5d4f5", indentGuide: "#302343", indentGuideActive: "#6a5580",
      widgetBackground: "#241b32", widgetBorder: "#4b3766", suggestSelected: "#3a2a52",
    },
    tokens: {
      keyword: "FF7EDB", type: "FEDE5D", identifier: "F2E9FF",
      string: "72F1B8", number: "F97E72", comment: "8A75A8", error: "FE4450",
    },
    accents: {
      controlKeyword: "FEDE5D", modifier: "FF7EDB", literal: "F97E72", annotation: "B98AFF",
      primitiveType: "36F9F6", method: "36F9F6", field: "B98AFF", constant: "F97E72",
      javadocTag: "9A85B8", operator: "FF7EDB", taskComment: "FEDE5D",
    },
  },
  {
    id: "kiwi-atom-light",
    label: "Kiwi Atom Light",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#ffffff", foreground: "#383a42", lineHighlight: "#f2f2f2",
      selection: "#cfe3f7aa", cursor: "#4078f2", lineNumber: "#a0a1a7",
      lineNumberActive: "#383a42", indentGuide: "#e5e5e6", indentGuideActive: "#b0b0b3",
      widgetBackground: "#f5f5f5", widgetBorder: "#d3d3d5", suggestSelected: "#dbe7f5",
    },
    tokens: {
      keyword: "A626A4", type: "C18401", identifier: "383A42",
      string: "50A14F", number: "986801", comment: "A0A1A7", error: "CA1243",
    },
    accents: {
      controlKeyword: "A626A4", modifier: "A626A4", literal: "986801", annotation: "C18401",
      primitiveType: "0184BC", method: "4078F2", field: "E45649", constant: "986801",
      javadocTag: "8A8B92", operator: "0184BC", taskComment: "B35A00",
    },
  },
  {
    id: "kiwi-ayu-light",
    label: "Kiwi Ayu Light",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#fcfcfc", foreground: "#5c6166", lineHighlight: "#f2f2f2",
      selection: "#cfe3f7aa", cursor: "#ff9940", lineNumber: "#b0b3b8",
      lineNumberActive: "#5c6166", indentGuide: "#e7e8e9", indentGuideActive: "#b0b3b8",
      widgetBackground: "#f3f4f5", widgetBorder: "#d5d7d9", suggestSelected: "#e6e9ec",
    },
    tokens: {
      keyword: "FA8D3E", type: "399EE6", identifier: "5C6166",
      string: "86B300", number: "A37ACC", comment: "9DA1A6", error: "E65050",
    },
    accents: {
      controlKeyword: "FA8D3E", modifier: "FA8D3E", literal: "A37ACC", annotation: "A37000",
      primitiveType: "55B4D4", method: "F2AE49", field: "399EE6", constant: "A37ACC",
      javadocTag: "A8ACB0", operator: "ED9366", taskComment: "A37000",
    },
  },
  {
    id: "kiwi-frost",
    label: "Kiwi Frost",
    group: "Hell",
    base: "vs",
    editor: {
      background: "#f7f9fc", foreground: "#2e3440", lineHighlight: "#eceff4",
      selection: "#c5d6e6aa", cursor: "#3a6c99", lineNumber: "#9aa7b5",
      lineNumberActive: "#2e3440", indentGuide: "#dee4ec", indentGuideActive: "#a6b3c1",
      widgetBackground: "#eceff4", widgetBorder: "#ccd4de", suggestSelected: "#dbe5ef",
    },
    tokens: {
      keyword: "5E81AC", type: "2A6E7A", identifier: "2E3440",
      string: "4A7A3A", number: "8A5C9E", comment: "7B8794", error: "A8474F",
    },
    accents: {
      controlKeyword: "8A5C9E", modifier: "5E81AC", literal: "97690C", annotation: "97690C",
      primitiveType: "3A6C99", method: "2F5F8A", field: "6A4C8C", constant: "8A5C9E",
      javadocTag: "8794A1", operator: "4C6478", taskComment: "97690C",
    },
  },
];

/**
 * Ready-made syntax palettes, picked from a list the same way a theme is.
 * "theme" keeps whatever the active theme defines; every other entry replaces
 * the anchors it names, and the finer tokens follow along through tokenLabels.
 */
export const colorSchemes: Array<{ id: string; label: string; tokens: Partial<Record<TokenId, string>> | null }> = [
  { id: "theme", label: "Passend zum Theme", tokens: null },
  {
    id: "classic",
    label: "Classic",
    tokens: { keyword: "CC7832", type: "A9B7C6", identifier: "A9B7C6", string: "6A8759", number: "6897BB", comment: "808080" },
  },
  {
    id: "vivid",
    label: "Vivid",
    tokens: { keyword: "FF79C6", type: "8BE9FD", identifier: "F8F8F2", string: "F1FA8C", number: "BD93F9", comment: "6272A4" },
  },
  {
    id: "ocean",
    label: "Ocean",
    tokens: { keyword: "5B8CFF", type: "8FD9FF", identifier: "DBE2F5", string: "9DDFB0", number: "E7B45F", comment: "6875A0" },
  },
  {
    id: "forest",
    label: "Forest",
    tokens: { keyword: "7FC7D7", type: "8ED45B", identifier: "DFEAEC", string: "A8D68A", number: "E3B878", comment: "668087" },
  },
  {
    id: "warm",
    label: "Warm",
    tokens: { keyword: "FFAB7D", type: "FFC76B", identifier: "F2E7DC", string: "C7D98A", number: "FF9159", comment: "8A7365" },
  },
  {
    id: "mono",
    label: "Monochrom",
    tokens: { keyword: "D6D6D6", type: "B4B4B4", identifier: "E8E8E8", string: "A0A0A0", number: "C4C4C4", comment: "6F6F6F" },
  },
  {
    id: "monokai",
    label: "Monokai",
    tokens: { keyword: "F92672", type: "66D9EF", identifier: "F8F8F2", string: "E6DB74", number: "AE81FF", comment: "75715E" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    tokens: { keyword: "FB4934", type: "8EC07C", identifier: "EBDBB2", string: "B8BB26", number: "D3869B", comment: "928374" },
  },
  {
    id: "nord",
    label: "Nord",
    tokens: { keyword: "81A1C1", type: "8FBCBB", identifier: "ECEFF4", string: "A3BE8C", number: "B48EAD", comment: "6C7A94" },
  },
  {
    id: "solarized",
    label: "Solarized",
    tokens: { keyword: "859900", type: "268BD2", identifier: "93A1A1", string: "2AA198", number: "CB4B16", comment: "586E75" },
  },
  {
    id: "tokyo",
    label: "Tokyo Night",
    tokens: { keyword: "BB9AF7", type: "2AC3DE", identifier: "C0CAF5", string: "9ECE6A", number: "FF9E64", comment: "565F89" },
  },
  {
    id: "rose",
    label: "Rosé",
    tokens: { keyword: "31748F", type: "9CCFD8", identifier: "E0DEF4", string: "F6C177", number: "EBBCBA", comment: "6E6A86" },
  },
  {
    id: "candy",
    label: "Candy",
    tokens: { keyword: "FF6AC1", type: "57C7FF", identifier: "EFF0EB", string: "5AF78E", number: "FFB86C", comment: "7A7F8C" },
  },
  {
    id: "contrast",
    label: "Hoher Kontrast",
    tokens: { keyword: "FFFFFF", type: "6FD7FF", identifier: "FFFFFF", string: "9CFF5C", number: "FFD479", comment: "B8C4C8" },
  },
  {
    id: "pastel",
    label: "Pastell",
    tokens: { keyword: "C8A2E0", type: "9BD3DD", identifier: "DDE1E6", string: "B5D6A7", number: "E8C39E", comment: "8A8FA0" },
  },
  {
    id: "github-light",
    label: "GitHub Light",
    tokens: { keyword: "CF222E", type: "953800", identifier: "24292F", string: "0A3069", number: "0550AE", comment: "6E7781" },
  },
  {
    id: "paper-light",
    label: "Papier hell",
    tokens: { keyword: "0F52A8", type: "7A45C0", identifier: "202226", string: "1F6B33", number: "96650F", comment: "7A7A80" },
  },
  // The palettes below also set the finer tokens, so picking one changes far
  // more than six colours at once.
  {
    id: "intellij-darcula",
    label: "Darcula",
    tokens: {
      keyword: "CC7832", type: "A9B7C6", identifier: "A9B7C6", string: "6A8759",
      number: "6897BB", comment: "808080", error: "BC3F3C",
      controlKeyword: "CC7832", modifier: "CC7832", literal: "CC7832", annotation: "BBB529",
      primitiveType: "CC7832", method: "FFC66D", field: "9876AA", constant: "9876AA",
      javadoc: "629755", javadocTag: "72A35E", operator: "A9B7C6", taskComment: "A8C023",
    },
  },
  {
    id: "rainbow",
    label: "Regenbogen",
    tokens: {
      keyword: "FF6188", type: "78DCE8", identifier: "FCFCFA", string: "FFD866",
      number: "AB9DF2", comment: "727072", error: "FF6188",
      controlKeyword: "FF6188", modifier: "FC9867", literal: "AB9DF2", annotation: "FC9867",
      primitiveType: "78DCE8", method: "A9DC76", field: "78DCE8", constant: "AB9DF2",
      javadoc: "8C8B8D", javadocTag: "A9DC76", operator: "FF6188", taskComment: "FFD866",
    },
  },
  {
    id: "cool-mint",
    label: "Cool Mint",
    tokens: {
      keyword: "56B6C2", type: "8FD9C4", identifier: "D6E5E3", string: "9ED6A8",
      number: "7FB3D5", comment: "5F7A78", error: "E88388",
      controlKeyword: "7FD1C1", modifier: "56B6C2", literal: "7FB3D5", annotation: "B5C99A",
      primitiveType: "4FA8B8", method: "BFE3DC", field: "A3C9C7", constant: "7FB3D5",
      javadoc: "6E8C8A", javadocTag: "8FB3B0", operator: "9BB8B5", taskComment: "E5C07B",
    },
  },
  {
    id: "high-visibility",
    label: "Hohe Lesbarkeit",
    tokens: {
      keyword: "FFB000", type: "00E5FF", identifier: "FFFFFF", string: "7CFF6B",
      number: "FF9EF0", comment: "B0B0B0", error: "FF4A4A",
      controlKeyword: "FFD24A", modifier: "FFB000", literal: "FF9EF0", annotation: "FFE066",
      primitiveType: "00E5FF", method: "9AD0FF", field: "D9B3FF", constant: "FF9EF0",
      javadoc: "C4C4C4", javadocTag: "E0E0E0", operator: "FFFFFF", taskComment: "FF7A1A",
    },
  },
  {
    id: "sepia-light",
    label: "Sepia hell",
    tokens: {
      keyword: "8C4A1F", type: "6B4E9E", identifier: "3B2F26", string: "4A6B23",
      number: "9C5B0F", comment: "8A7B6A", error: "A33232",
      controlKeyword: "A5501F", modifier: "8C4A1F", literal: "9C5B0F", annotation: "7A6212",
      primitiveType: "1F5F73", method: "26567A", field: "6B4E9E", constant: "9C5B0F",
      javadoc: "6F6255", javadocTag: "5C7A3A", operator: "5A4A3D", taskComment: "B35A00",
    },
  },
];

export type TokenId =
  | BaseTokenId
  | "controlKeyword" | "modifier" | "literal" | "annotation"
  | "primitiveType" | "typeParameter" | "constant" | "method" | "field"
  | "class" | "interface" | "enum" | "record" | "enumMember"
  | "parameter" | "localVariable"
  | "escape" | "operator" | "bracket" | "javadoc" | "javadocTag" | "taskComment"
  | "region"
  | JavaKeywordTokenId;

/**
 * Every recolourable syntax token, in the order the settings list them.
 *
 * `inherits` is what the token falls back to while neither the theme nor the
 * user has given it a colour of its own. That is what keeps a palette to a
 * handful of anchors without giving up per-token control.
 */
export const tokenLabels: Array<{ id: TokenId; label: string; sample: string; inherits?: BaseTokenId | TokenId }> = [
  { id: "keyword", label: "Schlüsselwörter", sample: "class · package · new" },
  { id: "controlKeyword", label: "Kontrollfluss", sample: "if · for · return", inherits: "keyword" },
  { id: "modifier", label: "Modifizierer", sample: "public · static · final", inherits: "keyword" },
  { id: "literal", label: "Literale", sample: "true · null · this", inherits: "keyword" },
  { id: "annotation", label: "Annotationen", sample: "@Override", inherits: "keyword" },
  { id: "type", label: "Typen", sample: "String · EventBus", inherits: "identifier" },
  // The four kinds of type, separately. They all looked alike, and telling a
  // record from a class at a glance is most of what reading unfamiliar code is.
  { id: "class", label: "Klassen", sample: "SpielerVerwaltung", inherits: "type" },
  { id: "interface", label: "Interfaces", sample: "Comparable", inherits: "type" },
  { id: "enum", label: "Enums", sample: "DayOfWeek", inherits: "type" },
  { id: "record", label: "Records", sample: "Spieler(name, punkte)", inherits: "type" },
  { id: "primitiveType", label: "Primitive Typen", sample: "int · boolean · void", inherits: "keyword" },
  { id: "typeParameter", label: "Typparameter", sample: "<T> · <K, V>", inherits: "type" },
  { id: "method", label: "Methoden", sample: "getPlayer(…)", inherits: "identifier" },
  { id: "field", label: "Felder", sample: "this.name", inherits: "identifier" },
  { id: "constant", label: "Konstanten", sample: "MAX_VALUE", inherits: "number" },
  { id: "enumMember", label: "Enum-Konstanten", sample: "MONDAY · ERROR", inherits: "constant" },
  // What a method was handed, against what it made itself. The distinction is
  // the one people actually look for while reading a body.
  { id: "parameter", label: "Parameter", sample: "String welt", inherits: "identifier" },
  { id: "localVariable", label: "Lokale Variablen", sample: "int zaehler", inherits: "identifier" },
  { id: "identifier", label: "Bezeichner", sample: "plugin · count" },
  { id: "string", label: "Zeichenketten", sample: "\"Hallo\"" },
  { id: "escape", label: "Escape-Sequenzen", sample: "\\n · \\u00e4", inherits: "number" },
  { id: "number", label: "Zahlen", sample: "42 · 3.14 · 0xFF" },
  { id: "operator", label: "Operatoren", sample: "+ · == · ->", inherits: "identifier" },
  { id: "bracket", label: "Klammern & Trennzeichen", sample: "( ) { } ;", inherits: "identifier" },
  { id: "comment", label: "Kommentare", sample: "// Hinweis" },
  { id: "javadoc", label: "Javadoc", sample: "/** … */", inherits: "comment" },
  { id: "javadocTag", label: "Javadoc-Tags", sample: "@param · @return", inherits: "javadoc" },
  { id: "region", label: "Regionen", sample: "//region Felder", inherits: "keyword" },
  { id: "error", label: "Fehlerhafte Syntax", sample: "\"nicht geschlossen" },
  { id: "taskComment", label: "TODO & FIXME", sample: "// TODO: aufräumen", inherits: "error" },
  ...javaKeywordGroups.flatMap((group) => group.words.map((word) => ({
    id: javaKeywordTokenId(word),
    label: word,
    sample: word,
    inherits: group.inherits as TokenId,
  }))),
];

export type WorkbenchColorId =
  | "chromeBackground" | "chromeForeground" | "panelBackground" | "panelForeground"
  | "selection" | "warning" | "danger" | "emphasis"
  | "editorBackground" | "editorForeground" | "editorCursor" | "editorSelection"
  | "editorLineHighlight" | "editorLineNumber" | "editorLineNumberActive"
  | "editorWidgetBackground" | "editorWidgetBorder" | "editorSuggestSelected"
  | "explorerBackground" | "explorerForeground" | "explorerActive"
  | "terminalBackground" | "terminalForeground"
  | "debugBackground" | "debugCurrentLine"
  | "diffAdded" | "diffRemoved"
  | "popupBackground" | "popupBorder";

/** Colour knobs which affect surfaces rather than Java syntax. */
export const workbenchColorGroups: Array<{
  id: string;
  label: string;
  colors: Array<{ id: WorkbenchColorId; label: string }>;
}> = [
  {
    id: "workbench",
    label: "Workbench",
    colors: [
      { id: "chromeBackground", label: "Toolbar & Seitenleisten" },
      { id: "chromeForeground", label: "Text in Toolbar & Seitenleisten" },
      { id: "panelBackground", label: "Panels & Dialoge" },
      { id: "panelForeground", label: "Text in Panels & Dialogen" },
      { id: "selection", label: "Auswahl & Information" },
      { id: "warning", label: "Warnungen" },
      { id: "danger", label: "Fehler" },
      { id: "emphasis", label: "Hervorgehobener Text" },
    ],
  },
  {
    id: "editorSurface",
    label: "Editor-Oberfläche",
    colors: [
      { id: "editorBackground", label: "Editor-Hintergrund" },
      { id: "editorForeground", label: "Editor-Text" },
      { id: "editorCursor", label: "Cursor" },
      { id: "editorSelection", label: "Editor-Auswahl" },
      { id: "editorLineHighlight", label: "Aktuelle Zeile" },
      { id: "editorLineNumber", label: "Zeilennummern" },
      { id: "editorLineNumberActive", label: "Aktive Zeilennummer" },
      { id: "editorWidgetBackground", label: "Completion & Hover" },
      { id: "editorWidgetBorder", label: "Completion-Rahmen" },
      { id: "editorSuggestSelected", label: "Gewählter Vorschlag" },
    ],
  },
  {
    id: "explorer",
    label: "Explorer",
    colors: [
      { id: "explorerBackground", label: "Explorer-Hintergrund" },
      { id: "explorerForeground", label: "Explorer-Text" },
      { id: "explorerActive", label: "Ausgewählte Datei" },
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    colors: [
      { id: "terminalBackground", label: "Terminal-Hintergrund" },
      { id: "terminalForeground", label: "Terminal-Text" },
    ],
  },
  {
    id: "debugger",
    label: "Debugger",
    colors: [
      { id: "debugBackground", label: "Debug-Panel" },
      { id: "debugCurrentLine", label: "Angehaltene Zeile" },
    ],
  },
  {
    id: "diff",
    label: "Git-Diff",
    colors: [
      { id: "diffAdded", label: "Hinzugefügt" },
      { id: "diffRemoved", label: "Entfernt" },
    ],
  },
  {
    id: "popup",
    label: "Menüs & Dialoge",
    colors: [
      { id: "popupBackground", label: "Popup-Hintergrund" },
      { id: "popupBorder", label: "Popup-Rahmen" },
    ],
  },
];

const hex6 = (value: string) => value.replace(/^#/, "").slice(0, 6).toUpperCase();

/** Effective colours shown in the custom-theme controls. */
export function resolveWorkbenchColors(
  theme: KiwiTheme,
  overrides: Record<string, string> = {},
): Record<WorkbenchColorId, string> {
  const resolved: Record<WorkbenchColorId, string> = {
    chromeBackground: hex6(theme.editor.widgetBackground),
    chromeForeground: hex6(theme.editor.foreground),
    panelBackground: hex6(theme.editor.background),
    panelForeground: hex6(theme.editor.foreground),
    selection: hex6(theme.tokens.type),
    warning: hex6(theme.tokens.number),
    danger: hex6(theme.tokens.error),
    emphasis: hex6(theme.editor.foreground),
    editorBackground: hex6(theme.editor.background),
    editorForeground: hex6(theme.editor.foreground),
    editorCursor: hex6(theme.editor.cursor),
    editorSelection: hex6(theme.editor.selection),
    editorLineHighlight: hex6(theme.editor.lineHighlight),
    editorLineNumber: hex6(theme.editor.lineNumber),
    editorLineNumberActive: hex6(theme.editor.lineNumberActive),
    editorWidgetBackground: hex6(theme.editor.widgetBackground),
    editorWidgetBorder: hex6(theme.editor.widgetBorder),
    editorSuggestSelected: hex6(theme.editor.suggestSelected),
    // Where each surface stood before it could be set on its own. Shown in the
    // picker as the value it currently has, so somebody opening the control
    // sees what is there rather than an empty swatch.
    explorerBackground: hex6(theme.editor.widgetBackground),
    explorerForeground: hex6(theme.editor.foreground),
    explorerActive: hex6(theme.tokens.type),
    terminalBackground: hex6(theme.editor.background),
    terminalForeground: hex6(theme.editor.foreground),
    debugBackground: hex6(theme.editor.background),
    debugCurrentLine: hex6(theme.tokens.number),
    diffAdded: hex6(theme.tokens.string),
    diffRemoved: hex6(theme.tokens.error),
    popupBackground: hex6(theme.editor.widgetBackground),
    popupBorder: hex6(theme.editor.widgetBorder),
  };
  for (const group of workbenchColorGroups) {
    for (const { id } of group.colors) {
      const value = overrides[id];
      if (/^[0-9a-fA-F]{6}$/.test(value || "")) resolved[id] = value.toUpperCase();
    }
  }
  return resolved;
}

/** CSS variables for workbench colours. Monaco consumes the editor entries. */
export function workbenchColorVariables(overrides: Record<string, string> = {}): Record<string, string> {
  const targets: Partial<Record<WorkbenchColorId, string>> = {
    chromeBackground: "--chrome-base-source",
    chromeForeground: "--chrome-fg-source",
    panelBackground: "--panel-base-source",
    panelForeground: "--panel-fg-source",
    selection: "--blue",
    warning: "--amber",
    danger: "--red",
    emphasis: "--emphasis",
    // Surfaces that used to take whatever the two base ramps gave them. Each
    // falls back to exactly that value in CSS, so an untouched setting looks
    // the way it always did.
    explorerBackground: "--explorer-base",
    explorerForeground: "--explorer-fg",
    explorerActive: "--explorer-active",
    terminalBackground: "--terminal-base",
    terminalForeground: "--terminal-fg",
    debugBackground: "--debug-base",
    debugCurrentLine: "--debug-current-line",
    diffAdded: "--diff-added",
    diffRemoved: "--diff-removed",
    popupBackground: "--popup-base",
    popupBorder: "--popup-border",
  };
  const result: Record<string, string> = {};
  for (const [id, variable] of Object.entries(targets)) {
    const value = overrides[id];
    if (variable && /^[0-9a-fA-F]{6}$/.test(value || "")) result[variable] = `#${value}`;
  }
  return result;
}

/**
 * Resolves the colour of every token for one theme.
 *
 * Precedence is theme anchors, then the chosen preset, then the user's own
 * overrides; anything still unset inherits from the token it is derived from.
 * All three layers are keyed by the plain token name and therefore independent
 * of the workbench theme.
 */
export function resolveTokenColors(
  theme: KiwiTheme,
  overrides: Record<string, string> = {},
  colorScheme = "theme",
): Record<TokenId, string> {
  const scheme = colorSchemes.find((entry) => entry.id === colorScheme);
  const chosen: Partial<Record<TokenId, string>> = {
    ...theme.tokens,
    ...(theme.accents || {}),
    ...(scheme?.tokens || {}),
  };
  const valid = (value: string | undefined) => Boolean(value) && /^[0-9a-fA-F]{6}$/.test(value as string);
  for (const { id } of tokenLabels) {
    const override = overrides[id];
    if (valid(override)) chosen[id] = override.toUpperCase();
  }
  /**
   * A colour set on a family's anchor carries to the family.
   *
   * Without this, colouring "keywords" meant writing the same value to all
   * seventy-eight of them, because a theme gives each one its own colour and
   * an explicit colour is what it takes to beat that. It worked, and it threw
   * away every keyword somebody had deliberately coloured differently.
   *
   * A token that was given a colour of its own keeps it. So the anchor is
   * "all of them together", an individual colour is "this one, whatever the
   * family does", and clearing an individual colour puts it back in the family.
   */
  for (const { id } of tokenLabels) {
    if (valid(overrides[id])) continue;
    const anchor = tokenGroupOf(id);
    if (anchor === id) continue;
    if (valid(overrides[anchor])) chosen[id] = overrides[anchor].toUpperCase();
  }
  const resolved = {} as Record<TokenId, string>;
  for (const { id, inherits } of tokenLabels) {
    // tokenLabels is ordered so a token's source is always resolved first.
    resolved[id] = (chosen[id] || (inherits ? resolved[inherits as TokenId] : "") || theme.tokens.identifier).toUpperCase();
  }
  return resolved;
}

export const defaultThemeId = "kiwi-new-dark";

export function findTheme(id: string): KiwiTheme {
  return themes.find((theme) => theme.id === id) || themes[0];
}

/** Monaco theme id for a workbench theme. Every theme gets its own definition. */
export function monacoThemeId(id: string): string {
  return `kiwi-${findTheme(id).id.replace(/^kiwi-/, "")}`;
}

/**
 * The whole accent family from the one colour a user picks.
 *
 * A theme carries four accent tokens — the colour itself, a brighter and a
 * dimmer variant, and the text that goes on top of it — and the workbench used
 * to override only one of them. Half the surfaces then showed the chosen
 * colour while the other half kept the theme's, side by side. Deriving all
 * four keeps them one colour, and the text is chosen by brightness so a filled
 * button stays readable whether the accent is near-black or near-white.
 */
export function accentPalette(color: string): Record<string, string> {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  const accent = hex ? `#${hex.toLowerCase()}` : "#7ad83b";
  const channel = (offset: number) => Number.parseInt(accent.slice(1 + offset, 3 + offset), 16) / 255;
  // Rec. 709 luminance: green carries most of the perceived brightness, so a
  // yellow accent needs dark text where a blue one of the same value does not.
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const bright = `color-mix(in srgb, ${accent} 74%, #ffffff)`;
  const dim = `color-mix(in srgb, ${accent} 44%, #000000)`;
  return {
    "--accent": accent,
    "--accent-bright": bright,
    "--accent-dim": dim,
    "--accent-on": luminance > 0.55 ? "#0b1408" : "#f4fbef",
    // The stylesheet derives these from --accent at the root, where they are
    // already computed by the time the workbench sets its own accent further
    // down. Inheriting a resolved value cannot be undone, so the aliases are
    // written out too instead of being left pointing at the theme's colour.
    "--green": accent,
    "--green-bright": bright,
    "--green-dim": dim,
  };
}

/**
 * The base colour a token ultimately comes from.
 *
 * Every finer token inherits from another one until it reaches one of the
 * seven anchors a theme defines. Following that chain gives the group a token
 * belongs to, so a colour can be assigned to a whole family at once instead of
 * twenty-two times in a row.
 */
export function tokenGroupOf(id: TokenId): BaseTokenId {
  const isBase = (candidate: string) => (baseTokenIds as readonly string[]).includes(candidate);
  const seen = new Set<string>();
  let current: TokenId = id;
  // Stops at the first anchor rather than following the chain past it: `type`
  // is an anchor a theme defines and also inherits from `identifier`, so
  // walking on would file it under identifiers and list it twice.
  while (!isBase(current) && !seen.has(current)) {
    seen.add(current);
    const parent = tokenLabels.find((entry) => entry.id === current)?.inherits;
    if (!parent) break;
    current = parent as TokenId;
  }
  return isBase(current) ? current as BaseTokenId : "identifier";
}

export const baseTokenIds = [
  "keyword", "type", "identifier", "string", "number", "comment", "error",
] as const;

/** The token families, in the order the settings show them. */
export const tokenGroups: Array<{ id: BaseTokenId; label: string; members: TokenId[] }> =
  baseTokenIds.map((id) => ({
    id,
    label: tokenLabels.find((entry) => entry.id === id)?.label || id,
    members: tokenLabels
      .filter((entry) => entry.id !== id && tokenGroupOf(entry.id) === id)
      .map((entry) => entry.id),
  }));

/**
 * The nudge applied on top of a picked theme.
 *
 * A theme is a starting point, not a verdict. These shift every ramp step at
 * once: surfaces move toward white or black while the text moves the other
 * way, so making a theme lighter does not quietly eat the contrast it was
 * designed with, and a tint pulls the whole workbench gently toward the accent.
 */
export function themeAdjustment(
  shade: number,
  tint: number,
  contrast = 0,
  accentIntensity = 100,
  lightTheme = false,
): Record<string, string> {
  const clampedShade = Math.max(-40, Math.min(40, Number.isFinite(shade) ? shade : 0));
  const clampedTint = Math.max(0, Math.min(30, Number.isFinite(tint) ? tint : 0));
  const clampedContrast = Math.max(0, Math.min(30, Number.isFinite(contrast) ? contrast : 0));
  const clampedAccent = Math.max(0, Math.min(200, Number.isFinite(accentIntensity) ? accentIntensity : 100));
  const accentStep = (base: number) => Math.min(100, base * clampedAccent / 100);
  return {
    "--theme-shade": `${Math.abs(clampedShade)}%`,
    "--theme-shade-surface": clampedShade >= 0 ? "#ffffff" : "#000000",
    "--theme-shade-ink": clampedShade >= 0 ? "#000000" : "#ffffff",
    "--theme-tint": `${clampedTint}%`,
    "--theme-contrast": `${clampedContrast}%`,
    "--theme-contrast-surface": lightTheme ? "#ffffff" : "#000000",
    "--theme-contrast-ink": lightTheme ? "#000000" : "#ffffff",
    "--accent-surface-1": `color-mix(in srgb, var(--accent) ${accentStep(8)}%, var(--chrome-base))`,
    "--accent-surface-2": `color-mix(in srgb, var(--accent) ${accentStep(12)}%, var(--chrome-base))`,
    "--accent-surface-3": `color-mix(in srgb, var(--accent) ${accentStep(16)}%, var(--chrome-base))`,
    "--accent-surface-4": `color-mix(in srgb, var(--accent) ${accentStep(20)}%, var(--chrome-base))`,
    "--accent-surface-5": `color-mix(in srgb, var(--accent) ${accentStep(26)}%, var(--chrome-base))`,
    "--accent-surface-6": `color-mix(in srgb, var(--accent) ${accentStep(32)}%, var(--chrome-base))`,
    "--accent-surface-7": `color-mix(in srgb, var(--accent) ${accentStep(40)}%, var(--chrome-base))`,
    "--accent-surface-8": `color-mix(in srgb, var(--accent) ${accentStep(50)}%, var(--chrome-base))`,
  };
}

/** One canonical set of inline variables for every Kiwi window. */
export function personalizationVariables(settings: {
  theme: string;
  accentColor: string;
  themeShade: number;
  themeTint: number;
  themeContrast?: number;
  accentIntensity?: number;
  themeColorOverrides?: Record<string, string>;
  uiRoundness: number;
  borderStrength: number;
  shadowStrength: number;
  uiFont: string;
}): Record<string, string> {
  const theme = findTheme(settings.theme);
  return {
    ...accentPalette(settings.accentColor),
    ...themeAdjustment(
      settings.themeShade,
      settings.themeTint,
      settings.themeContrast,
      settings.accentIntensity,
      theme.group === "Hell",
    ),
    ...workbenchColorVariables(settings.themeColorOverrides),
    "--roundness": String(Math.max(0, Math.min(250, settings.uiRoundness)) / 100),
    "--border-strength": String(Math.max(0, Math.min(160, settings.borderStrength)) / 100),
    "--shadow-strength": String(Math.max(0, Math.min(200, settings.shadowStrength)) / 100),
    "--ui-font": settings.uiFont
      ? `${settings.uiFont}, Inter, "Segoe UI", system-ui, sans-serif`
      : 'Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  };
}
