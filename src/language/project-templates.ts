/**
 * Project-specific file templates for Explorer right-click -> New...
 */
export interface ProjectNewItem {
  id: string;
  label: string;
  detail?: string;
  icon: "file" | "folder" | "code" | "package" | "test" | "web" | "class";
  defaultName: string;
  extension: string;
  isPackage?: boolean;
  content: (name: string) => string;
}

export const WEB_TEMPLATES: ProjectNewItem[] = [
  {
    id: "html",
    label: "HTML5-Datei",
    detail: ".html",
    icon: "web",
    defaultName: "index.html",
    extension: ".html",
    content: (name) => `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>${name}</h1>
  <script src="main.js"></script>
</body>
</html>
`,
  },
  {
    id: "css",
    label: "CSS-Stylesheet",
    detail: ".css",
    icon: "web",
    defaultName: "style.css",
    extension: ".css",
    content: () => `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6;
  padding: 2rem;
}
`,
  },
  {
    id: "js",
    label: "JavaScript-Datei",
    detail: ".js",
    icon: "code",
    defaultName: "main.js",
    extension: ".js",
    content: () => `console.log("Hello from JavaScript!");\n`,
  },
  {
    id: "ts",
    label: "TypeScript-Datei",
    detail: ".ts",
    icon: "code",
    defaultName: "main.ts",
    extension: ".ts",
    content: () => `export function main(): void {
  console.log("Hello from TypeScript!");
}

main();
`,
  },
  {
    id: "tsx",
    label: "React Component (TSX)",
    detail: ".tsx",
    icon: "code",
    defaultName: "Component.tsx",
    extension: ".tsx",
    content: (name) => `import React from "react";

interface ${name}Props {
  title?: string;
}

export const ${name}: React.FC<${name}Props> = ({ title = "${name}" }) => {
  return (
    <div className="${name.toLowerCase()}">
      <h2>{title}</h2>
    </div>
  );
};
`,
  },
  {
    id: "jsx",
    label: "React Component (JSX)",
    detail: ".jsx",
    icon: "code",
    defaultName: "Component.jsx",
    extension: ".jsx",
    content: (name) => `import React from "react";

export function ${name}({ title = "${name}" }) {
  return (
    <div className="${name.toLowerCase()}">
      <h2>{title}</h2>
    </div>
  );
}
`,
  },
  {
    id: "json",
    label: "JSON-Datei",
    detail: ".json",
    icon: "file",
    defaultName: "data.json",
    extension: ".json",
    content: () => `{\n  "version": "1.0.0"\n}\n`,
  },
];

export const PYTHON_TEMPLATES: ProjectNewItem[] = [
  {
    id: "python-script",
    label: "Python-Skript (mit main)",
    detail: "main.py",
    icon: "code",
    defaultName: "main.py",
    extension: ".py",
    content: () => `def main():
    print("Hello from Python!")


if __name__ == "__main__":
    main()
`,
  },
  {
    id: "python-class",
    label: "Python-Klasse",
    detail: "class",
    icon: "class",
    defaultName: "MyClass.py",
    extension: ".py",
    content: (name) => `class ${name}:
    def __init__(self):
        pass
`,
  },
  {
    id: "python-module",
    label: "Python-Modul (__init__.py)",
    detail: "__init__.py",
    icon: "package",
    defaultName: "__init__.py",
    extension: ".py",
    content: () => `"""Package initialization."""\n`,
  },
  {
    id: "python-test",
    label: "Python-Test (unittest)",
    detail: "test_*.py",
    icon: "test",
    defaultName: "test_main.py",
    extension: ".py",
    content: (name) => `import unittest


class Test${name.replace(/^test_?/i, "") || "App"}(unittest.TestCase):
    def test_example(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
`,
  },
  {
    id: "python-package",
    label: "Python-Paket (Ordner + __init__.py)",
    detail: "Ordner",
    icon: "folder",
    defaultName: "mypackage",
    extension: "",
    isPackage: true,
    content: () => `"""Package initialization."""\n`,
  },
  {
    id: "pyproject",
    label: "pyproject.toml",
    detail: "pyproject.toml",
    icon: "file",
    defaultName: "pyproject.toml",
    extension: ".toml",
    content: () => `[project]
name = "my-project"
version = "0.1.0"
requires-python = ">=3.9"
dependencies = []
`,
  },
  {
    id: "requirements",
    label: "requirements.txt",
    detail: "requirements.txt",
    icon: "file",
    defaultName: "requirements.txt",
    extension: ".txt",
    content: () => `# Dependencies\n`,
  },
];

export const PHP_TEMPLATES: ProjectNewItem[] = [
  {
    id: "php-script",
    label: "PHP-Skript",
    detail: "index.php",
    icon: "code",
    defaultName: "index.php",
    extension: ".php",
    content: () => `<?php
declare(strict_types=1);

echo "Hello from PHP!\n";
`,
  },
  {
    id: "php-class",
    label: "PHP-Klasse",
    detail: "class",
    icon: "class",
    defaultName: "Controller.php",
    extension: ".php",
    content: (name) => `<?php
declare(strict_types=1);

namespace App;

class ${name} {
    public function __construct() {
    }
}
`,
  },
  {
    id: "php-interface",
    label: "PHP-Interface",
    detail: "interface",
    icon: "class",
    defaultName: "ServiceInterface.php",
    extension: ".php",
    content: (name) => `<?php
declare(strict_types=1);

namespace App;

interface ${name} {
}
`,
  },
];

export const RUST_TEMPLATES: ProjectNewItem[] = [
  {
    id: "rust-main",
    label: "Rust-Datei (main)",
    detail: "main.rs",
    icon: "code",
    defaultName: "main.rs",
    extension: ".rs",
    content: () => `fn main() {
    println!("Hello from Rust!");
}
`,
  },
  {
    id: "rust-module",
    label: "Rust-Modul (mod.rs)",
    detail: "mod.rs",
    icon: "package",
    defaultName: "mod.rs",
    extension: ".rs",
    content: () => `// Rust module\n`,
  },
  {
    id: "rust-test",
    label: "Rust-Test",
    detail: "tests.rs",
    icon: "test",
    defaultName: "tests.rs",
    extension: ".rs",
    content: () => `#[cfg(test)]
mod tests {
    #[test]
    fn test_it() {
        assert_eq!(2 + 2, 4);
    }
}
`,
  },
];

export const GO_TEMPLATES: ProjectNewItem[] = [
  {
    id: "go-main",
    label: "Go-Datei (main)",
    detail: "main.go",
    icon: "code",
    defaultName: "main.go",
    extension: ".go",
    content: () => `package main

import "fmt"

func main() {
\tfmt.Println("Hello from Go!")
}
`,
  },
  {
    id: "go-pkg",
    label: "Go-Paketdatei",
    detail: "pkg.go",
    icon: "package",
    defaultName: "helper.go",
    extension: ".go",
    content: () => `package mypkg\n`,
  },
  {
    id: "go-test",
    label: "Go-Test (*_test.go)",
    detail: "*_test.go",
    icon: "test",
    defaultName: "main_test.go",
    extension: ".go",
    content: () => `package main

import "testing"

func TestMain(t *testing.T) {
\tt.Log("Running tests...")
}
`,
  },
];

export const C_TEMPLATES: ProjectNewItem[] = [
  {
    id: "c-source",
    label: "C-Quelldatei",
    detail: "main.c",
    icon: "code",
    defaultName: "main.c",
    extension: ".c",
    content: () => `#include <stdio.h>

int main(void) {
    printf("Hello from C!\\n");
    return 0;
}
`,
  },
  {
    id: "c-header",
    label: "C-Header",
    detail: "header.h",
    icon: "file",
    defaultName: "header.h",
    extension: ".h",
    content: () => `#pragma once\n`,
  },
];

export const CPP_TEMPLATES: ProjectNewItem[] = [
  {
    id: "cpp-source",
    label: "C++-Quelldatei",
    detail: "main.cpp",
    icon: "code",
    defaultName: "main.cpp",
    extension: ".cpp",
    content: () => `#include <iostream>

int main() {
    std::cout << "Hello from C++!" << std::endl;
    return 0;
}
`,
  },
  {
    id: "cpp-header",
    label: "C++-Header",
    detail: "header.hpp",
    icon: "file",
    defaultName: "header.hpp",
    extension: ".hpp",
    content: () => `#pragma once\n`,
  },
];

export const CSHARP_TEMPLATES: ProjectNewItem[] = [
  {
    id: "csharp-program",
    label: "C#-Programm",
    detail: "Program.cs",
    icon: "code",
    defaultName: "Program.cs",
    extension: ".cs",
    content: () => `Console.WriteLine("Hello from C#!");\n`,
  },
  {
    id: "csharp-class",
    label: "C#-Klasse",
    detail: "class",
    icon: "class",
    defaultName: "MyClass.cs",
    extension: ".cs",
    content: (name) => `namespace App;

public class ${name}
{
}
`,
  },
  {
    id: "csharp-interface",
    label: "C#-Interface",
    detail: "interface",
    icon: "class",
    defaultName: "IMyInterface.cs",
    extension: ".cs",
    content: (name) => `namespace App;

public interface ${name}
{
}
`,
  },
];

export const KOTLIN_TEMPLATES: ProjectNewItem[] = [
  {
    id: "kotlin-main",
    label: "Kotlin-Datei (main)",
    detail: "Main.kt",
    icon: "code",
    defaultName: "Main.kt",
    extension: ".kt",
    content: () => `fun main() {
    println("Hello from Kotlin!")
}
`,
  },
  {
    id: "kotlin-class",
    label: "Kotlin-Klasse",
    detail: "class",
    icon: "class",
    defaultName: "MyClass.kt",
    extension: ".kt",
    content: (name) => `class ${name} {
}
`,
  },
  {
    id: "kotlin-script",
    label: "Kotlin-Skript (.kts)",
    detail: "script.kts",
    icon: "code",
    defaultName: "script.kts",
    extension: ".kts",
    content: () => `println("Hello from Kotlin script!")\n`,
  },
];

export const LUA_TEMPLATES: ProjectNewItem[] = [
  {
    id: "lua-script",
    label: "Lua-Skript (main)",
    detail: "main.lua",
    icon: "code",
    defaultName: "main.lua",
    extension: ".lua",
    content: () => `local function main()
    print("Hello from Lua!")
end

main()
`,
  },
];

export const TYPESCRIPT_TEMPLATES: ProjectNewItem[] = [
  {
    id: "ts-file",
    label: "TypeScript-Modul",
    detail: ".ts",
    icon: "code",
    defaultName: "index.ts",
    extension: ".ts",
    content: (name) => `export function ${name}(): void {\n  // TODO: implement\n}\n`,
  },
  {
    id: "ts-react",
    label: "React Component (TSX)",
    detail: ".tsx",
    icon: "code",
    defaultName: "MyComponent.tsx",
    extension: ".tsx",
    content: (name) => `import React from "react";\n\ninterface ${name}Props {\n  title?: string;\n}\n\nexport const ${name}: React.FC<${name}Props> = ({ title = "${name}" }) => {\n  return (\n    <div className="${name.toLowerCase()}">\n      <h2>{title}</h2>\n    </div>\n  );\n};\n`,
  },
  {
    id: "ts-interface",
    label: "TypeScript Interface",
    detail: ".ts",
    icon: "class",
    defaultName: "types.ts",
    extension: ".ts",
    content: (name) => `export interface ${name} {\n  id: string;\n  name: string;\n  createdAt: Date;\n}\n`,
  },
  {
    id: "ts-express-route",
    label: "Express Router (TS)",
    detail: ".ts",
    icon: "web",
    defaultName: "router.ts",
    extension: ".ts",
    content: () => `import { Router, Request, Response } from "express";\n\nexport const router = Router();\n\nrouter.get("/", (_req: Request, res: Response) => {\n  res.json({ status: "ok" });\n});\n`,
  },
  {
    id: "ts-test",
    label: "TypeScript Unit Test",
    detail: ".test.ts",
    icon: "test",
    defaultName: "app.test.ts",
    extension: ".test.ts",
    content: () => `import { describe, it } from "node:test";\nimport assert from "node:assert";\n\ndescribe("Feature", () => {\n  it("should pass", () => {\n    assert.strictEqual(1 + 1, 2);\n  });\n});\n`,
  },
];

export const JAVASCRIPT_TEMPLATES: ProjectNewItem[] = [
  {
    id: "js-file",
    label: "JavaScript-Modul",
    detail: ".js",
    icon: "code",
    defaultName: "index.js",
    extension: ".js",
    content: (name) => `export function ${name}() {\n  // TODO: implement\n}\n`,
  },
  {
    id: "js-react",
    label: "React Component (JSX)",
    detail: ".jsx",
    icon: "code",
    defaultName: "MyComponent.jsx",
    extension: ".jsx",
    content: (name) => `import React from "react";\n\nexport function ${name}({ title = "${name}" }) {\n  return (\n    <div className="${name.toLowerCase()}">\n      <h2>{title}</h2>\n    </div>\n  );\n}\n`,
  },
  {
    id: "js-express-route",
    label: "Express Router (JS)",
    detail: ".js",
    icon: "web",
    defaultName: "router.js",
    extension: ".js",
    content: () => `import { Router } from "express";\n\nexport const router = Router();\n\nrouter.get("/", (req, res) => {\n  res.json({ status: "ok" });\n});\n`,
  },
  {
    id: "node-test",
    label: "Node.js Unit Test",
    detail: ".test.js",
    icon: "test",
    defaultName: "app.test.js",
    extension: ".test.js",
    content: () => `import { describe, it } from "node:test";\nimport assert from "node:assert";\n\ndescribe("Feature", () => {\n  it("should pass", () => {\n    assert.strictEqual(1 + 1, 2);\n  });\n});\n`,
  },
];

export const DART_TEMPLATES: ProjectNewItem[] = [
  {
    id: "dart-file",
    label: "Dart-Datei",
    detail: ".dart",
    icon: "code",
    defaultName: "main.dart",
    extension: ".dart",
    content: (name) => `void main() {\n  print("Hello from ${name}!");\n}\n`,
  },
  {
    id: "dart-class",
    label: "Dart-Klasse",
    detail: ".dart",
    icon: "class",
    defaultName: "Item.dart",
    extension: ".dart",
    content: (name) => `class ${name.replace(/\.dart$/i, "")} {\n  final String name;\n\n  const ${name.replace(/\.dart$/i, "")}(this.name);\n}\n`,
  },
  {
    id: "dart-test",
    label: "Dart Unit Test",
    detail: "_test.dart",
    icon: "test",
    defaultName: "app_test.dart",
    extension: "_test.dart",
    content: () => `import "package:test/test.dart";\n\nvoid main() {\n  test("basic assertion", () {\n    expect(1 + 1, equals(2));\n  });\n}\n`,
  },
];

export const ZIG_TEMPLATES: ProjectNewItem[] = [
  {
    id: "zig-file",
    label: "Zig-Quelldatei",
    detail: ".zig",
    icon: "code",
    defaultName: "main.zig",
    extension: ".zig",
    content: () => `const std = @import("std");\n\npub fn main() !void {\n    const stdout = std.io.getStdOut().writer();\n    try stdout.print("Hello from Zig!\\n", .{});\n}\n`,
  },
  {
    id: "zig-test",
    label: "Zig Test",
    detail: ".zig",
    icon: "test",
    defaultName: "test.zig",
    extension: ".zig",
    content: () => `const std = @import("std");\n\ntest "simple test" {\n    try std.testing.expectEqual(@as(i32, 4), 2 + 2);\n}\n`,
  },
];

export const SWIFT_TEMPLATES: ProjectNewItem[] = [
  {
    id: "swift-file",
    label: "Swift-Quelldatei",
    detail: ".swift",
    icon: "code",
    defaultName: "main.swift",
    extension: ".swift",
    content: () => `import Foundation\n\nprint("Hello from Swift!")\n`,
  },
  {
    id: "swift-struct",
    label: "Swift Struct",
    detail: ".swift",
    icon: "class",
    defaultName: "Model.swift",
    extension: ".swift",
    content: (name) => `import Foundation\n\nstruct ${name.replace(/\.swift$/i, "")} {\n    let id: UUID\n    var title: String\n}\n`,
  },
];

export const RUBY_TEMPLATES: ProjectNewItem[] = [
  {
    id: "ruby-file",
    label: "Ruby-Skript",
    detail: ".rb",
    icon: "code",
    defaultName: "main.rb",
    extension: ".rb",
    content: () => `def main\n  puts "Hello from Ruby!"\nend\n\nmain\n`,
  },
  {
    id: "ruby-class",
    label: "Ruby-Klasse",
    detail: ".rb",
    icon: "class",
    defaultName: "service.rb",
    extension: ".rb",
    content: (name) => `class ${name.replace(/\.rb$/i, "").split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("")}\n  def initialize\n  end\n\n  def call\n    puts "Calling service"\n  end\nend\n`,
  },
  {
    id: "ruby-test",
    label: "Ruby Minitest",
    detail: "_test.rb",
    icon: "test",
    defaultName: "app_test.rb",
    extension: ".rb",
    content: () => `require "minitest/autorun"\n\nclass AppTest < Minitest::Test\n  def test_example\n    assert_equal 2, 1 + 1\n  end\nend\n`,
  },
];

export const ELIXIR_TEMPLATES: ProjectNewItem[] = [
  {
    id: "elixir-module",
    label: "Elixir-Modul",
    detail: ".ex",
    icon: "code",
    defaultName: "main.ex",
    extension: ".ex",
    content: (name) => `defmodule ${name.replace(/\.ex$/i, "").split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("")} do\n  def hello do\n    IO.puts("Hello from Elixir!")\n  end\nend\n`,
  },
  {
    id: "elixir-script",
    label: "Elixir-Skript",
    detail: ".exs",
    icon: "code",
    defaultName: "script.exs",
    extension: ".exs",
    content: () => `IO.puts("Hello from Elixir Script!")\n`,
  },
];

export const R_TEMPLATES: ProjectNewItem[] = [
  {
    id: "r-script",
    label: "R-Skript",
    detail: ".R",
    icon: "code",
    defaultName: "script.R",
    extension: ".R",
    content: () => `# R Analysis Script\ncat("Hello from R!\\n")\n\ndf <- data.frame(\n  x = 1:10,\n  y = (1:10)^2\n)\nsummary(df)\n`,
  },
];

export const SCALA_TEMPLATES: ProjectNewItem[] = [
  {
    id: "scala-file",
    label: "Scala-Quelldatei",
    detail: ".scala",
    icon: "code",
    defaultName: "Main.scala",
    extension: ".scala",
    content: () => `@main def run(): Unit = {\n  println("Hello from Scala!")\n}\n`,
  },
];

export const SHELL_TEMPLATES: ProjectNewItem[] = [
  {
    id: "shell-script",
    label: "Bash-Skript",
    detail: ".sh",
    icon: "code",
    defaultName: "script.sh",
    extension: ".sh",
    content: () => `#!/usr/bin/env bash\nset -euo pipefail\n\necho "Hello from Bash!"\n`,
  },
];

export const POWERSHELL_TEMPLATES: ProjectNewItem[] = [
  {
    id: "powershell-script",
    label: "PowerShell-Skript",
    detail: ".ps1",
    icon: "code",
    defaultName: "script.ps1",
    extension: ".ps1",
    content: () => `# PowerShell Script\nWrite-Host "Hello from PowerShell!" -ForegroundColor Cyan\n`,
  },
  {
    id: "powershell-module",
    label: "PowerShell-Modul",
    detail: ".psm1",
    icon: "code",
    defaultName: "Module.psm1",
    extension: ".psm1",
    content: () => `function Get-Greeting {\n    [CmdletBinding()]\n    param(\n        [string]$Name = "World"\n    )\n    Write-Output "Hello, $Name!"\n}\n\nExport-ModuleMember -Function Get-Greeting\n`,
  },
];

export const PERL_TEMPLATES: ProjectNewItem[] = [
  {
    id: "perl-script",
    label: "Perl-Skript",
    detail: ".pl",
    icon: "code",
    defaultName: "main.pl",
    extension: ".pl",
    content: () => `#!/usr/bin/env perl\nuse strict;\nuse warnings;\nuse feature 'say';\n\nsay "Hello from Perl!";\n`,
  },
  {
    id: "perl-module",
    label: "Perl-Modul",
    detail: ".pm",
    icon: "class",
    defaultName: "Module.pm",
    extension: ".pm",
    content: (name) => `package ${name.replace(/\.pm$/i, "")};\n\nuse strict;\nuse warnings;\n\nsub new {\n    my ($class, %args) = @_;\n    return bless \\%args, $class;\n}\n\n1;\n`,
  },
  {
    id: "perl-test",
    label: "Perl Test",
    detail: ".t",
    icon: "test",
    defaultName: "basic.t",
    extension: ".t",
    content: () => `use strict;\nuse warnings;\nuse Test::More tests => 1;\n\nok(1 == 1, 'basic assertion');\n`,
  },
];

export const GDSCRIPT_TEMPLATES: ProjectNewItem[] = [
  {
    id: "gdscript-node",
    label: "GDScript Node",
    detail: ".gd",
    icon: "code",
    defaultName: "CustomNode.gd",
    extension: ".gd",
    content: () => `extends Node\n\nfunc _ready() -> void:\n\tprint("Hello from Godot!")\n\nfunc _process(delta: float) -> void:\n\tpass\n`,
  },
  {
    id: "gdscript-character",
    label: "GDScript CharacterBody2D",
    detail: ".gd",
    icon: "code",
    defaultName: "Player.gd",
    extension: ".gd",
    content: () => `extends CharacterBody2D\n\nconst SPEED = 300.0\n\nfunc _physics_process(delta: float) -> void:\n\tmove_and_slide()\n`,
  },
];

export const SQL_TEMPLATES: ProjectNewItem[] = [
  {
    id: "sql-file",
    label: "SQL-Skript",
    detail: ".sql",
    icon: "code",
    defaultName: "query.sql",
    extension: ".sql",
    content: () => `SELECT * FROM items;\n`,
  },
  {
    id: "sql-table",
    label: "SQL-Tabelle",
    detail: ".sql",
    icon: "code",
    defaultName: "schema.sql",
    extension: ".sql",
    content: () => `CREATE TABLE IF NOT EXISTS items (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL\n);\n`,
  },
];

export const TERRAFORM_TEMPLATES: ProjectNewItem[] = [
  {
    id: "tf-main",
    label: "Terraform-Konfiguration",
    detail: ".tf",
    icon: "code",
    defaultName: "main.tf",
    extension: ".tf",
    content: () => `terraform {\n  required_version = ">= 1.5.0"\n}\n`,
  },
  {
    id: "tf-vars",
    label: "Terraform-Variablen",
    detail: ".tf",
    icon: "code",
    defaultName: "variables.tf",
    extension: ".tf",
    content: () => `variable "region" {\n  type    = string\n  default = "eu-central-1"\n}\n`,
  },
];

export const ASSEMBLY_TEMPLATES: ProjectNewItem[] = [
  {
    id: "asm-file",
    label: "Assembler-Quelldatei",
    detail: ".asm",
    icon: "code",
    defaultName: "main.asm",
    extension: ".asm",
    content: () => `default rel\nglobal main\n\nsection .text\nmain:\n  xor eax, eax\n  ret\n`,
  },
];

export const AUTOHOTKEY_TEMPLATES: ProjectNewItem[] = [
  {
    id: "ahk-script",
    label: "AutoHotkey-Skript",
    detail: ".ahk",
    icon: "code",
    defaultName: "script.ahk",
    extension: ".ahk",
    content: () => `#Requires AutoHotkey v2.0\n\n^+k:: {\n    MsgBox("Hello from AutoHotkey!")\n}\n`,
  },
];

export const ODIN_TEMPLATES: ProjectNewItem[] = [
  {
    id: "odin-file",
    label: "Odin-Quelldatei",
    detail: ".odin",
    icon: "code",
    defaultName: "main.odin",
    extension: ".odin",
    content: () => `package main\n\nimport "core:fmt"\n\nmain :: proc() {\n  fmt.println("Hello from Odin!")\n}\n`,
  },
];

export function getProjectNewTemplates(language: string): {
  languageItems: ProjectNewItem[];
  webItems: ProjectNewItem[];
} {
  const lang = String(language || "").toLowerCase();
  let languageItems: ProjectNewItem[] = [];

  if (lang === "typescript" || lang === "ts") languageItems = TYPESCRIPT_TEMPLATES;
  else if (lang === "javascript" || lang === "js" || lang === "node") languageItems = JAVASCRIPT_TEMPLATES;
  else if (lang === "python") languageItems = PYTHON_TEMPLATES;
  else if (lang === "php") languageItems = PHP_TEMPLATES;
  else if (lang === "rust") languageItems = RUST_TEMPLATES;
  else if (lang === "go") languageItems = GO_TEMPLATES;
  else if (lang === "c") languageItems = C_TEMPLATES;
  else if (lang === "cpp") languageItems = CPP_TEMPLATES;
  else if (lang === "csharp") languageItems = CSHARP_TEMPLATES;
  else if (lang === "kotlin") languageItems = KOTLIN_TEMPLATES;
  else if (lang === "lua") languageItems = LUA_TEMPLATES;
  else if (lang === "dart") languageItems = DART_TEMPLATES;
  else if (lang === "zig") languageItems = ZIG_TEMPLATES;
  else if (lang === "swift") languageItems = SWIFT_TEMPLATES;
  else if (lang === "ruby") languageItems = RUBY_TEMPLATES;
  else if (lang === "elixir") languageItems = ELIXIR_TEMPLATES;
  else if (lang === "r") languageItems = R_TEMPLATES;
  else if (lang === "scala") languageItems = SCALA_TEMPLATES;
  else if (lang === "shell" || lang === "bash") languageItems = SHELL_TEMPLATES;
  else if (lang === "powershell") languageItems = POWERSHELL_TEMPLATES;
  else if (lang === "perl") languageItems = PERL_TEMPLATES;
  else if (lang === "gdscript" || lang === "godot") languageItems = GDSCRIPT_TEMPLATES;
  else if (lang === "sql") languageItems = SQL_TEMPLATES;
  else if (lang === "terraform" || lang === "hcl") languageItems = TERRAFORM_TEMPLATES;
  else if (lang === "assembly" || lang === "asm") languageItems = ASSEMBLY_TEMPLATES;
  else if (lang === "autohotkey" || lang === "ahk") languageItems = AUTOHOTKEY_TEMPLATES;
  else if (lang === "odin") languageItems = ODIN_TEMPLATES;

  return {
    languageItems,
    webItems: WEB_TEMPLATES,
  };
}
