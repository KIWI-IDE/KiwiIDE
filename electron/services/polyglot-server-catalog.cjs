/** Stdio entry points from the language servers' own integration guides. */
const SERVER_CATALOG = [
  {
    id: "kotlin", name: "Kotlin Language Server", languages: [{ id: "kotlin", name: "Kotlin" }],
    command: "kotlin-language-server", args: [],
    docsUrl: "https://github.com/fwcd/kotlin-language-server#installation",
    installHint: "Kotlin Language Server installieren und dessen bin-Verzeichnis zum PATH hinzufügen. Ein eigenes kotlin-lsp-Kommando lässt sich ebenfalls konfigurieren.",
  },
  {
    id: "python", name: "Pyright", languages: [{ id: "python", name: "Python" }],
    command: "pyright-langserver", args: ["--stdio"], npmPackage: "pyright",
    docsUrl: "https://github.com/microsoft/pyright#installation",
    installHint: "In Kiwi lokal installieren oder npm install --global pyright ausführen.",
  },
  {
    id: "rust", name: "rust-analyzer", languages: [{ id: "rust", name: "Rust" }],
    command: "rust-analyzer", args: [],
    docsUrl: "https://rust-analyzer.github.io/book/installation.html",
    installHint: "rustup component add rust-analyzer",
  },
  {
    id: "php", name: "Intelephense", languages: [{ id: "php", name: "PHP" }],
    command: "intelephense", args: ["--stdio"], npmPackage: "intelephense",
    docsUrl: "https://github.com/bmewburn/intelephense-docs/blob/master/installation.md",
    installHint: "In Kiwi lokal installieren oder npm install --global intelephense ausführen.",
  },
  {
    id: "lua", name: "Lua Language Server", languages: [{ id: "lua", name: "Lua" }],
    command: "lua-language-server", args: [],
    docsUrl: "https://luals.github.io/wiki/usage/",
    installHint: "Lua Language Server entpacken und dessen bin-Verzeichnis zum PATH hinzufügen.",
  },
  {
    id: "go", name: "gopls", languages: [{ id: "go", name: "Go" }],
    command: "gopls", args: [],
    docsUrl: "https://go.dev/gopls/",
    installHint: "go install golang.org/x/tools/gopls@latest; danach das Go-bin-Verzeichnis zum PATH hinzufügen.",
  },
  {
    id: "clangd", name: "clangd", languages: [
      { id: "c", name: "C" }, { id: "cpp", name: "C++" },
      { id: "objective-c", name: "Objective-C" }, { id: "objective-cpp", name: "Objective-C++" },
    ],
    command: "clangd", args: ["--background-index"],
    docsUrl: "https://clangd.llvm.org/installation",
    installHint: "clangd/LLVM installieren und das bin-Verzeichnis zum PATH hinzufügen. Für Projekt-Includes compile_commands.json bereitstellen.",
  },
  {
    id: "csharp", name: "C# Language Server", languages: [{ id: "csharp", name: "C#" }],
    command: "csharp-ls", args: [],
    docsUrl: "https://github.com/razzmatazz/csharp-language-server#quick-start",
    installHint: "Mit passendem .NET SDK: dotnet tool install --global csharp-ls. Aktuelle Serverversionen benötigen .NET 10.",
  },
  {
    id: "typescript", name: "TypeScript & JavaScript Language Server", languages: [
      { id: "typescript", name: "TypeScript" },
      { id: "javascript", name: "JavaScript" },
      { id: "typescriptreact", name: "TypeScript React (TSX)" },
      { id: "javascriptreact", name: "JavaScript React (JSX)" },
    ],
    command: "typescript-language-server", args: ["--stdio"], npmPackage: "typescript-language-server",
    docsUrl: "https://github.com/typescript-language-server/typescript-language-server",
    installHint: "In Kiwi automatisch installiert oder per npm install --global typescript-language-server typescript.",
  },
  {
    id: "dart", name: "Dart Analysis Server", languages: [{ id: "dart", name: "Dart" }],
    command: "dart", args: ["language-server", "--client-id=KiwiIDE"],
    docsUrl: "https://dart.dev/tools/analysis-server",
    installHint: "Dart SDK installieren (im Dart/Flutter SDK enthalten).",
  },
  {
    id: "zig", name: "Zig Language Server (zls)", languages: [{ id: "zig", name: "Zig" }],
    command: "zls", args: [],
    docsUrl: "https://github.com/zigtools/zls",
    installHint: "ZLS herunterladen oder über Paketmanager installieren und zum PATH hinzufügen.",
  },
  {
    id: "swift", name: "SourceKit-LSP", languages: [{ id: "swift", name: "Swift" }],
    command: "sourcekit-lsp", args: [],
    docsUrl: "https://github.com/apple/sourcekit-lsp",
    installHint: "Im Swift-Toolchain / Xcode standardmäßig enthalten.",
  },
  {
    id: "ruby", name: "Solargraph", languages: [{ id: "ruby", name: "Ruby" }],
    command: "solargraph", args: ["stdio"],
    docsUrl: "https://solargraph.org/",
    installHint: "gem install solargraph ausführen.",
  },
  {
    id: "elixir", name: "ElixirLS", languages: [{ id: "elixir", name: "Elixir" }],
    command: "elixir-ls", args: [],
    docsUrl: "https://github.com/elixir-lsp/elixir-ls",
    installHint: "ElixirLS kompilieren oder fertiges Release herunterladen und im PATH platzieren.",
  },
  {
    id: "scala", name: "Metals", languages: [{ id: "scala", name: "Scala" }],
    command: "metals", args: [],
    docsUrl: "https://scalameta.org/metals/",
    installHint: "cs install metals über Coursier installieren.",
  },
  {
    id: "shell", name: "Bash Language Server", languages: [{ id: "shell", name: "Shell" }],
    command: "bash-language-server", args: ["start"], npmPackage: "bash-language-server",
    docsUrl: "https://github.com/bash-lsp/bash-language-server",
    installHint: "npm install --global bash-language-server ausführen.",
  },
  {
    id: "powershell", name: "PowerShell Editor Services", languages: [{ id: "powershell", name: "PowerShell" }],
    command: "pwsh", args: ["-NoProfile", "-NonInteractive", "-Command", "Start-EditorServices"],
    docsUrl: "https://github.com/PowerShell/PowerShellEditorServices",
    installHint: "PowerShell 7 (pwsh) und PowerShellEditorServices Modul installieren.",
  },
  {
    id: "perl", name: "PerlNavigator", languages: [{ id: "perl", name: "Perl" }],
    command: "perlnavigator", args: ["--stdio"], npmPackage: "perlnavigator-server",
    docsUrl: "https://github.com/bscan/PerlNavigator",
    installHint: "npm install --global perlnavigator-server ausführen.",
  },
  {
    id: "gdscript", name: "Godot Language Server", languages: [{ id: "gdscript", name: "GDScript" }],
    command: "godot", args: ["--headless", "--lsp-port=6005"],
    docsUrl: "https://docs.godotengine.org/en/stable/tutorials/editor/external_editor.html",
    installHint: "Godot 4 im PATH platzieren oder Godot Editor im Hintergrund laufen lassen.",
  },
  {
    id: "sql", name: "SQL Language Server", languages: [{ id: "sql", name: "SQL" }],
    command: "sql-language-server", args: ["up", "--method", "stdio"], npmPackage: "sql-language-server",
    docsUrl: "https://github.com/joe-re/sql-language-server",
    installHint: "npm install --global sql-language-server ausführen.",
  },
  {
    id: "terraform", name: "Terraform Language Server", languages: [{ id: "terraform", name: "Terraform" }],
    command: "terraform-ls", args: ["serve"],
    docsUrl: "https://github.com/hashicorp/terraform-ls",
    installHint: "terraform-ls herunterladen und im PATH platzieren.",
  },
  {
    id: "assembly", name: "Assembly Language Server", languages: [{ id: "assembly", name: "Assembly" }],
    command: "asm-lsp", args: [],
    docsUrl: "https://github.com/bergercookie/asm-lsp",
    installHint: "cargo install asm-lsp ausführen.",
  },
  {
    id: "autohotkey", name: "AutoHotkey Language Server", languages: [{ id: "autohotkey", name: "AutoHotkey" }],
    command: "ahk-language-server", args: ["--stdio"],
    docsUrl: "https://github.com/thqby/vscode-autohotkey2-lsp",
    installHint: "AutoHotkey v2 Language Server im PATH platzieren.",
  },
  {
    id: "odin", name: "Odin Language Server (OLS)", languages: [{ id: "odin", name: "Odin" }],
    command: "ols", args: [],
    docsUrl: "https://github.com/DanielGavin/ols",
    installHint: "OLS kompilieren oder Binary herunterladen und zum PATH hinzufügen.",
  },
];

function serverForLanguage(languageId) {
  return SERVER_CATALOG.find((server) => server.languages.some((language) => language.id === languageId)) || null;
}

module.exports = { SERVER_CATALOG, serverForLanguage };
