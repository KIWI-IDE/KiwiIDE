import {
  Binary,
  Blocks,
  Braces,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Hammer,
  Layers,
  Network,
  Package,
  Sparkles,
  Terminal,
  TestTube2,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectSpec } from "../types";
import { KiwiLogo } from "./KiwiLogo";
import { t } from "../i18n";
import { JAVA_LANGUAGE_LEVELS } from "../language-levels";

export interface LanguageDef {
  id: NonNullable<ProjectSpec["language"]>;
  name: string;
  glyph: string;
  subtitle: string;
  icon: typeof Braces;
}

const PROJECT_LANGUAGES_LIST: LanguageDef[] = [
  { id: "java", name: "Java", glyph: "J", subtitle: "Enterprise & Desktop", icon: Braces },
  { id: "typescript", name: "TypeScript", glyph: "TS", subtitle: "Modern Web, React & Node.js", icon: Code2 },
  { id: "javascript", name: "JavaScript & Node.js", glyph: "JS", subtitle: "Fullstack, Express & Vanilla", icon: Globe },
  { id: "kotlin", name: "Kotlin", glyph: "Kt", subtitle: "Modern JVM & Multiplatform", icon: Zap },
  { id: "python", name: "Python", glyph: "Py", subtitle: "Scripts, AI & FastAPI", icon: FileCode2 },
  { id: "rust", name: "Rust", glyph: "Rs", subtitle: "Systems & High Performance", icon: Hammer },
  { id: "php", name: "PHP & Web", glyph: "PHP", subtitle: "Fullstack & REST APIs", icon: Globe },
  { id: "go", name: "Go", glyph: "Go", subtitle: "Cloud, Services & CLI", icon: Network },
  { id: "c", name: "C", glyph: "C", subtitle: "Low-level & Embedded", icon: Binary },
  { id: "cpp", name: "C++", glyph: "C++", subtitle: "Modern C++20 Systems", icon: Code2 },
  { id: "csharp", name: "C#", glyph: "C#", subtitle: ".NET 10 & Web API", icon: Layers },
  { id: "lua", name: "Lua", glyph: "Lua", subtitle: "Scripting & Games", icon: Sparkles },
  { id: "dart", name: "Dart", glyph: "Dart", subtitle: "Flutter & Cross-Platform", icon: Zap },
  { id: "zig", name: "Zig", glyph: "Zig", subtitle: "Robust Systems & Toolchain", icon: Hammer },
  { id: "swift", name: "Swift", glyph: "Sw", subtitle: "Apple, Server & Systems", icon: Terminal },
  { id: "ruby", name: "Ruby", glyph: "Rb", subtitle: "Web, Rails & Scripting", icon: Sparkles },
  { id: "elixir", name: "Elixir", glyph: "Ex", subtitle: "Fault-Tolerant & Distributed", icon: Network },
  { id: "r", name: "R", glyph: "R", subtitle: "Statistics & Data Science", icon: Blocks },
  { id: "scala", name: "Scala", glyph: "Sc", subtitle: "Functional & OOP JVM", icon: Layers },
  { id: "shell", name: "Shell / Bash", glyph: "Sh", subtitle: "Linux & CLI Automation", icon: Terminal },
  { id: "powershell", name: "PowerShell", glyph: "PS", subtitle: "Windows & Cross-Platform", icon: Terminal },
  { id: "perl", name: "Perl", glyph: "Pl", subtitle: "Scripting, Sysadmin & Regex", icon: Terminal },
  { id: "gdscript", name: "GDScript", glyph: "GD", subtitle: "Godot 4 Game Engine", icon: Sparkles },
  { id: "sql", name: "SQL", glyph: "SQL", subtitle: "Schemas, Queries & Migration", icon: Layers },
  { id: "terraform", name: "Terraform / HCL", glyph: "TF", subtitle: "Cloud Infrastructure as Code", icon: Network },
  { id: "assembly", name: "Assembly", glyph: "ASM", subtitle: "x86_64 Low-Level & HW", icon: Binary },
  { id: "autohotkey", name: "AutoHotkey", glyph: "AHK", subtitle: "Windows Desktop Automation", icon: Terminal },
  { id: "odin", name: "Odin", glyph: "Odin", subtitle: "Fast Data-Oriented Systems", icon: Hammer },
  { id: "objective-c", name: "Objective-C", glyph: "ObjC", subtitle: "Apple & GNUstep Native", icon: Binary },
  { id: "objective-cpp", name: "Objective-C++", glyph: "ObjC++", subtitle: "Hybrid C++ & Objective-C", icon: Code2 },
];

export interface TemplateDefinition {
  id: string;
  label: string;
  description: string;
  icon: typeof Terminal;
}

const TEMPLATES_BY_LANGUAGE: Record<string, TemplateDefinition[]> = {
  typescript: [
    { id: "react", label: "React + TypeScript (Vite)", description: "Modernes Frontend mit React 19, TSX, Vite und CSS", icon: Globe },
    { id: "express", label: "Express REST API (TypeScript)", description: "Asynchrone Web-API mit Express, CORS und tsx", icon: Network },
    { id: "standard", label: "Node.js + TypeScript", description: "Backend / CLI-Anwendung mit tsconfig.json und tsx", icon: Terminal },
    { id: "nextjs", label: "Next.js App (TypeScript)", description: "Fullstack React Framework mit App Router", icon: Layers },
    { id: "library", label: "TypeScript Library / Package", description: "Wiederverwendbare Bibliothek mit Typdefinitionen", icon: Package },
  ],
  javascript: [
    { id: "standard", label: "Node.js Anwendung", description: "Node.js Backend / Script mit package.json und ES-Modulen", icon: Terminal },
    { id: "express", label: "Express.js REST API", description: "Web-Server mit Express, JSON-Routen und CORS", icon: Network },
    { id: "react", label: "React Web App (Vite)", description: "Single-Page-App mit React 19, JSX und Vite", icon: Globe },
    { id: "vanilla", label: "HTML5 & Vanilla JavaScript", description: "Web-Frontend mit HTML, CSS und modernem JavaScript", icon: Code2 },
    { id: "electron", label: "Electron Desktop App", description: "Cross-Platform Desktop-App mit HTML/CSS/JS und Electron", icon: Layers },
  ],
  java: [
    { id: "standard", label: "Java Application", description: "Standardanwendung mit main-Methode und Build-Tool", icon: Terminal },
    { id: "cli", label: "CLI Application · Picocli", description: "Kommandozeilen-Werkzeug mit Argument-Parser", icon: Terminal },
    { id: "spring", label: "Spring Boot Web", description: "Moderne Spring Boot Webanwendung mit MVC & Tomcat", icon: Globe },
    { id: "rest", label: "REST API · Spring Boot", description: "RESTful JSON API mit Controller & Service-Architektur", icon: Network },
    { id: "javafx", label: "JavaFX Desktop", description: "Desktop-Benutzeroberfläche mit FXML & Controller", icon: Layers },
    { id: "jakarta", label: "Jakarta Persistence", description: "Datenbank-Persistenz mit JPA Entity & Repository", icon: Blocks },
    { id: "modular", label: "Modulare JPMS App", description: "Modulare Java-Architektur mit module-info.java", icon: Package },
    { id: "docker", label: "Containerisierte Anwendung", description: "Inklusive Dockerfile und compose.yaml", icon: Package },
  ],
  python: [
    { id: "standard", label: "Python Skript / CLI", description: "Lauffähiges Skript mit Argument-Parser & Tests", icon: Terminal },
    { id: "fastapi", label: "FastAPI REST API", description: "Asynchrone Web-API mit Pydantic Schemas & Uvicorn", icon: Network },
    { id: "flask", label: "Flask Webapp", description: "Webanwendung mit Jinja2-Templates und HTML/CSS", icon: Globe },
    { id: "datascience", label: "Data Science & Skripting", description: "Datenanalyse-Setup mit CSV-Verarbeitung und Pandas", icon: Blocks },
    { id: "package", label: "Python-Paket / Library", description: "Modulare Library-Struktur mit pyproject.toml", icon: Package },
  ],
  php: [
    { id: "standard", label: "PHP Webanwendung", description: "Webserver-Router mit PSR-4 Autoloading und HTML5", icon: Globe },
    { id: "rest", label: "PHP REST API", description: "Schnelle JSON-API mit Endpoints und Router", icon: Network },
    { id: "cli", label: "PHP CLI Tool", description: "Kommandozeilen-Skript für Konsolenaufgaben", icon: Terminal },
    { id: "frontend", label: "HTML5 & Modern Web", description: "Reines Frontend mit HTML5, Modern CSS und JavaScript", icon: Code2 },
  ],
  rust: [
    { id: "standard", label: "Binary Application", description: "Kommandozeilenanwendung mit Cargo und Tests", icon: Terminal },
    { id: "library", label: "Library Crate", description: "Wiederverwendbare Bibliothek mit Unit- & Integrationstests", icon: Package },
  ],
  go: [
    { id: "standard", label: "Go Application", description: "Standardanwendung mit go.mod und main.go", icon: Terminal },
    { id: "rest", label: "HTTP REST Service", description: "Webserver mit Standard net/http und JSON-Endpoints", icon: Network },
    { id: "package", label: "Go Package", description: "Wiederverwendbares Modulpaket mit Exporten und Tests", icon: Package },
  ],
  c: [
    { id: "standard", label: "C Console App", description: "Lauffähiges C-Programm mit CMakeLists.txt und Makefile", icon: Terminal },
  ],
  cpp: [
    { id: "standard", label: "Modern C++20 App", description: "Modernes C++ mit CMake und std::cout", icon: Terminal },
    { id: "library", label: "C++ Library", description: "Statische/dynamische Bibliothek mit Header-Struktur", icon: Package },
  ],
  csharp: [
    { id: "standard", label: ".NET Console App", description: "Moderne Konsolenanwendung mit .NET 10 / 8", icon: Terminal },
    { id: "webapi", label: "ASP.NET Core Web API", description: "Minimal API mit REST-Endpoints und JSON", icon: Network },
    { id: "library", label: ".NET Class Library", description: "Wiederverwendbare Klassenbibliothek (.NET)", icon: Package },
  ],
  kotlin: [
    { id: "standard", label: "Kotlin Console", description: "Einfacher Starter mit kotlinc", icon: Terminal },
    { id: "gradle", label: "Kotlin Gradle App", description: "Vollständiges Gradle-Projekt mit Kotlin DSL und JUnit 5", icon: Package },
    { id: "script", label: "Kotlin Script (.kts)", description: "Eigenständiges Automatisierungsskript", icon: FileText },
  ],
  lua: [
    { id: "standard", label: "Lua Script", description: "Eigenständiges Skript mit main.lua", icon: Terminal },
    { id: "modular", label: "Modulare Lua-App", description: "Struktur mit Modulen und Test-Runner", icon: Package },
  ],
  dart: [
    { id: "standard", label: "Dart Console App", description: "Konsolenanwendung mit pubspec.yaml und bin/main.dart", icon: Terminal },
  ],
  zig: [
    { id: "standard", label: "Zig Executable", description: "Lauffähiges Zig-Projekt mit build.zig und src/main.zig", icon: Terminal },
  ],
  swift: [
    { id: "standard", label: "Swift Executable", description: "Swift Package Manager Anwendung mit Package.swift", icon: Terminal },
  ],
  ruby: [
    { id: "standard", label: "Ruby Skript / Gem", description: "Ruby-Anwendung mit Gemfile, main.rb und Minitest", icon: Terminal },
  ],
  elixir: [
    { id: "standard", label: "Mix Project", description: "Elixir Mix-Projekt mit mix.exs und lib/main.ex", icon: Package },
  ],
  r: [
    { id: "standard", label: "R Skript", description: "Datenanalyse und Statistik mit main.R", icon: Blocks },
  ],
  scala: [
    { id: "standard", label: "Scala 3 App", description: "Modernes Scala 3 Projekt mit build.sbt", icon: Terminal },
  ],
  shell: [
    { id: "standard", label: "Bash Script", description: "Ausführbares Shell-Skript mit Shebang", icon: Terminal },
  ],
  powershell: [
    { id: "standard", label: "PowerShell Script", description: "PowerShell-Skript mit main.ps1 und Farbausgabe", icon: Terminal },
  ],
  perl: [
    { id: "standard", label: "Perl Skript / Modul", description: "Perl-Skript mit cpanfile, main.pl und Test::More", icon: Terminal },
  ],
  gdscript: [
    { id: "standard", label: "Godot 4 Projekt", description: "Godot Game-Projekt mit project.godot und main.gd", icon: Sparkles },
  ],
  sql: [
    { id: "standard", label: "SQL Skript & Schema", description: "SQL-Datei mit Tabellendefinitionen und Abfragen", icon: Layers },
  ],
  terraform: [
    { id: "standard", label: "Terraform Modul", description: "Infrastruktur-Code mit main.tf und variables.tf", icon: Network },
  ],
  assembly: [
    { id: "standard", label: "NASM 64-bit App", description: "x86_64 Assembler-Programm mit main.asm", icon: Binary },
  ],
  autohotkey: [
    { id: "standard", label: "AutoHotkey v2 Skript", description: "Desktop-Automatisierung mit Hotkeys und Dialogen", icon: Terminal },
  ],
  odin: [
    { id: "standard", label: "Odin Anwendung", description: "Odin-Projekt mit main.odin und OLS-Konfiguration", icon: Hammer },
  ],
  "objective-c": [
    { id: "standard", label: "Native Application", description: "CMake-basiertes Objective-C Projekt", icon: Terminal },
  ],
  "objective-cpp": [
    { id: "standard", label: "Native Application", description: "CMake-basiertes Objective-C++ Projekt", icon: Terminal },
  ],
};

function computeStructurePreview(options: {
  name: string;
  language: string;
  template: string;
  type: string;
  packageName: string;
  sampleClass: boolean;
  includeTests: boolean;
  initGit: boolean;
  createReadme: boolean;
}): Array<{ path: string; isDir: boolean }> {
  const items: Array<{ path: string; isDir: boolean }> = [];
  const pkgPath = (options.packageName || "com.example.app").replace(/\./g, "/");
  const baseName = options.name.trim() || "kiwi-app";

  if (options.initGit) {
    items.push({ path: ".git/", isDir: true });
  }
  items.push({ path: ".gitignore", isDir: false });
  if (options.createReadme) {
    items.push({ path: "README.md", isDir: false });
  }

  if (options.language === "typescript") {
    items.push({ path: "package.json", isDir: false });
    items.push({ path: "tsconfig.json", isDir: false });
    if (options.template === "react") {
      items.push({ path: "vite.config.ts", isDir: false });
      items.push({ path: "index.html", isDir: false });
      items.push({ path: "src/main.tsx", isDir: false });
      items.push({ path: "src/App.tsx", isDir: false });
      items.push({ path: "src/index.css", isDir: false });
    } else if (options.template === "express") {
      items.push({ path: "src/index.ts", isDir: false });
    } else {
      items.push({ path: "src/index.ts", isDir: false });
      if (options.includeTests) items.push({ path: "tests/index.test.ts", isDir: false });
    }
  } else if (options.language === "javascript" || options.language === "node") {
    items.push({ path: "package.json", isDir: false });
    if (options.template === "react") {
      items.push({ path: "vite.config.js", isDir: false });
      items.push({ path: "index.html", isDir: false });
      items.push({ path: "src/main.jsx", isDir: false });
      items.push({ path: "src/App.jsx", isDir: false });
    } else if (options.template === "vanilla") {
      items.push({ path: "index.html", isDir: false });
      items.push({ path: "style.css", isDir: false });
      items.push({ path: "main.js", isDir: false });
    } else {
      const mainPath = options.language === "node" ? "index.js" : "src/index.js";
      items.push({ path: mainPath, isDir: false });
      if (options.includeTests) items.push({ path: options.language === "node" ? "test/index.test.js" : "tests/index.test.js", isDir: false });
    }
  } else if (options.language === "java") {
    if (options.type === "Gradle") {
      items.push({ path: "build.gradle.kts", isDir: false });
      items.push({ path: "settings.gradle.kts", isDir: false });
    } else if (options.type === "Maven") {
      items.push({ path: "pom.xml", isDir: false });
    }
    items.push({ path: `src/main/java/${pkgPath}/`, isDir: true });
    if (options.sampleClass) {
      items.push({ path: `src/main/java/${pkgPath}/Main.java`, isDir: false });
      if (options.template === "javafx") {
        items.push({ path: `src/main/java/${pkgPath}/MainController.java`, isDir: false });
        items.push({ path: "src/main/resources/main.fxml", isDir: false });
      } else if (options.template === "jakarta") {
        items.push({ path: `src/main/java/${pkgPath}/Book.java`, isDir: false });
        items.push({ path: `src/main/java/${pkgPath}/BookRepository.java`, isDir: false });
        items.push({ path: "src/main/resources/META-INF/persistence.xml", isDir: false });
      } else if (options.template === "spring" || options.template === "rest") {
        items.push({ path: "src/main/resources/application.properties", isDir: false });
      } else if (options.template === "modular") {
        items.push({ path: "src/main/java/module-info.java", isDir: false });
      } else if (options.template === "docker") {
        items.push({ path: "Dockerfile", isDir: false });
        items.push({ path: "compose.yaml", isDir: false });
      }
    }
    if (options.includeTests && options.type !== "Java") {
      items.push({ path: `src/test/java/${pkgPath}/MainTest.java`, isDir: false });
    }
  } else if (options.language === "python") {
    items.push({ path: "pyproject.toml", isDir: false });
    items.push({ path: "requirements.txt", isDir: false });
    if (options.template === "fastapi") {
      if (options.sampleClass) items.push({ path: "app.py", isDir: false });
      if (options.includeTests) items.push({ path: "tests/test_api.py", isDir: false });
    } else if (options.template === "flask") {
      if (options.sampleClass) {
        items.push({ path: "app.py", isDir: false });
        items.push({ path: "templates/index.html", isDir: false });
        items.push({ path: "static/style.css", isDir: false });
      }
      if (options.includeTests) items.push({ path: "tests/test_app.py", isDir: false });
    } else if (options.template === "datascience") {
      if (options.sampleClass) {
        items.push({ path: "analysis.py", isDir: false });
        items.push({ path: "data/sample.csv", isDir: false });
      }
    } else if (options.template === "package") {
      const pkg = baseName.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
      items.push({ path: `src/${pkg}/__init__.py`, isDir: false });
      if (options.sampleClass) items.push({ path: `src/${pkg}/core.py`, isDir: false });
      if (options.includeTests) items.push({ path: "tests/test_core.py", isDir: false });
    } else {
      if (options.sampleClass) items.push({ path: "main.py", isDir: false });
      if (options.includeTests) items.push({ path: "tests/test_main.py", isDir: false });
    }
  } else if (options.language === "php") {
    if (options.template === "frontend" || options.template === "web") {
      items.push({ path: "index.html", isDir: false });
      items.push({ path: "style.css", isDir: false });
      items.push({ path: "main.js", isDir: false });
      items.push({ path: "package.json", isDir: false });
    } else {
      items.push({ path: "composer.json", isDir: false });
      if (options.template === "cli") {
        if (options.sampleClass) items.push({ path: "bin/console", isDir: false });
      } else {
        if (options.sampleClass) {
          items.push({ path: "public/index.php", isDir: false });
          items.push({ path: "public/style.css", isDir: false });
          items.push({ path: "src/App.php", isDir: false });
        }
      }
    }
  } else if (options.language === "rust") {
    items.push({ path: "Cargo.toml", isDir: false });
    if (options.template === "library") {
      if (options.sampleClass) items.push({ path: "src/lib.rs", isDir: false });
      if (options.includeTests) items.push({ path: "tests/integration_test.rs", isDir: false });
    } else {
      if (options.sampleClass) items.push({ path: "src/main.rs", isDir: false });
      if (options.includeTests) items.push({ path: "tests/test_main.rs", isDir: false });
    }
  } else if (options.language === "go") {
    items.push({ path: "go.mod", isDir: false });
    if (options.sampleClass) items.push({ path: "main.go", isDir: false });
    if (options.includeTests) items.push({ path: "main_test.go", isDir: false });
    if (options.template === "package") items.push({ path: "pkg/calc/calc.go", isDir: false });
  } else if (options.language === "c" || options.language === "cpp") {
    items.push({ path: "CMakeLists.txt", isDir: false });
    items.push({ path: "Makefile", isDir: false });
    const ext = options.language === "cpp" ? "cpp" : "c";
    const headerExt = options.language === "cpp" ? "hpp" : "h";
    if (options.sampleClass) {
      items.push({ path: `src/main.${ext}`, isDir: false });
      items.push({ path: `include/app.${headerExt}`, isDir: false });
    }
  } else if (options.language === "csharp") {
    items.push({ path: `${baseName}.csproj`, isDir: false });
    if (options.sampleClass) {
      if (options.template === "library") {
        items.push({ path: "Class1.cs", isDir: false });
      } else {
        items.push({ path: "Program.cs", isDir: false });
        if (options.template === "webapi") items.push({ path: "appsettings.json", isDir: false });
      }
    }
  } else if (options.language === "kotlin") {
    if (options.template === "gradle") {
      items.push({ path: "build.gradle.kts", isDir: false });
      items.push({ path: "settings.gradle.kts", isDir: false });
      if (options.sampleClass) items.push({ path: "src/main/kotlin/Main.kt", isDir: false });
      if (options.includeTests) items.push({ path: "src/test/kotlin/MainTest.kt", isDir: false });
    } else if (options.template === "script") {
      if (options.sampleClass) items.push({ path: "script.kts", isDir: false });
    } else {
      if (options.sampleClass) items.push({ path: "src/main/kotlin/Main.kt", isDir: false });
    }
  } else if (options.language === "lua") {
    if (options.sampleClass) items.push({ path: "main.lua", isDir: false });
    if (options.template === "modular") {
      items.push({ path: "src/module.lua", isDir: false });
      if (options.includeTests) items.push({ path: "tests/test_module.lua", isDir: false });
    }
  } else if (options.language === "dart") {
    items.push({ path: "pubspec.yaml", isDir: false });
    if (options.sampleClass) items.push({ path: "bin/main.dart", isDir: false });
  } else if (options.language === "zig") {
    items.push({ path: "build.zig", isDir: false });
    if (options.sampleClass) items.push({ path: "src/main.zig", isDir: false });
  } else if (options.language === "swift") {
    items.push({ path: "Package.swift", isDir: false });
    if (options.sampleClass) items.push({ path: "Sources/main.swift", isDir: false });
  } else if (options.language === "ruby") {
    items.push({ path: "Gemfile", isDir: false });
    if (options.sampleClass) {
      items.push({ path: "main.rb", isDir: false });
      if (options.includeTests) items.push({ path: "test/test_main.rb", isDir: false });
    }
  } else if (options.language === "elixir") {
    items.push({ path: "mix.exs", isDir: false });
    if (options.sampleClass) items.push({ path: "lib/main.ex", isDir: false });
  } else if (options.language === "r") {
    if (options.sampleClass) items.push({ path: "main.R", isDir: false });
  } else if (options.language === "scala") {
    items.push({ path: "build.sbt", isDir: false });
    if (options.sampleClass) items.push({ path: "src/main/scala/Main.scala", isDir: false });
  } else if (options.language === "shell") {
    if (options.sampleClass) items.push({ path: "main.sh", isDir: false });
  } else if (options.language === "powershell") {
    if (options.sampleClass) items.push({ path: "main.ps1", isDir: false });
  } else if (options.language === "perl") {
    items.push({ path: "cpanfile", isDir: false });
    if (options.sampleClass) {
      items.push({ path: "main.pl", isDir: false });
      if (options.includeTests) items.push({ path: "t/01_basic.t", isDir: false });
    }
  } else if (options.language === "gdscript") {
    items.push({ path: "project.godot", isDir: false });
    if (options.sampleClass) items.push({ path: "main.gd", isDir: false });
  } else if (options.language === "sql") {
    if (options.sampleClass) items.push({ path: "main.sql", isDir: false });
  } else if (options.language === "terraform") {
    items.push({ path: "main.tf", isDir: false });
    items.push({ path: "variables.tf", isDir: false });
  } else if (options.language === "assembly") {
    if (options.sampleClass) items.push({ path: "main.asm", isDir: false });
  } else if (options.language === "autohotkey") {
    if (options.sampleClass) items.push({ path: "main.ahk", isDir: false });
  } else if (options.language === "odin") {
    items.push({ path: "ols.json", isDir: false });
    if (options.sampleClass) items.push({ path: "main.odin", isDir: false });
  } else {
    items.push({ path: "CMakeLists.txt", isDir: false });
    if (options.sampleClass) items.push({ path: "src/main.m", isDir: false });
  }

  return items;
}

export function ProjectWizard({
  initialLocation,
  onClose,
  onCreate,
  chooseLocation,
  chooseJdk,
  embedded = false,
}: {
  initialLocation: string;
  onClose: () => void;
  onCreate: (spec: ProjectSpec) => Promise<void>;
  chooseLocation: () => Promise<string | null>;
  chooseJdk: () => Promise<{ path: string; version: string; major: number } | null>;
  embedded?: boolean;
}) {
  const [language, setLanguage] = useState<NonNullable<ProjectSpec["language"]>>("java");
  const [type, setType] = useState<"Java" | "Maven" | "Gradle">("Gradle");
  const [location, setLocation] = useState(initialLocation);
  const [name, setName] = useState("kiwi-app");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("com.example");
  const [packageName, setPackageName] = useState("com.example.app");
  const [jdkPath, setJdkPath] = useState("");
  const [languageLevel, setLanguageLevel] = useState("21");
  const [template, setTemplate] = useState<string>("standard");
  const [sampleClass, setSampleClass] = useState(true);
  const [includeTests, setIncludeTests] = useState(true);
  const [initGit, setInitGit] = useState(true);
  const [createReadme, setCreateReadme] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const languageDef = PROJECT_LANGUAGES_LIST.find((item) => item.id === language) || PROJECT_LANGUAGES_LIST[0];
  const templates = TEMPLATES_BY_LANGUAGE[language] || [{ id: "standard", label: "Standard Application", description: "Basis-Starter", icon: Terminal }];
  const artifactId = name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");

  const selectLanguage = (nextLang: NonNullable<ProjectSpec["language"]>) => {
    setLanguage(nextLang);
    const availableTemplates = TEMPLATES_BY_LANGUAGE[nextLang] || [];
    setTemplate(availableTemplates[0]?.id || "standard");
  };

  const previewItems = useMemo(() => {
    return computeStructurePreview({
      name,
      language,
      template,
      type,
      packageName,
      sampleClass,
      includeTests,
      initGit,
      createReadme,
    });
  }, [name, language, template, type, packageName, sampleClass, includeTests, initGit, createReadme]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!location || !name.trim()) return;
    setCreating(true);
    setError("");
    try {
      await onCreate({
        language,
        type: (language === "java" ? type : languageDef.name) as ProjectSpec["type"],
        location,
        name: name.trim(),
        groupId,
        artifactId,
        packageName,
        jdkPath,
        languageLevel,
        template,
        sampleClass,
        includeTests,
        initGit,
        createReadme,
        description: description.trim(),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={embedded ? "assistant-panel-content" : "overlay wizard-overlay"} onMouseDown={embedded ? undefined : onClose}>
      <form className="project-wizard" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <KiwiLogo size={34} />
            <span>
              <strong>{t("Neues Projekt")}</strong>
              <small>{t("Projektstruktur und Build-System konfigurieren")}</small>
            </span>
          </div>
          <button type="button" onClick={onClose} title={t("Abbrechen")}><X size={17} /></button>
        </header>

        <div className="wizard-body">
          {/* Left Column: Language Selector */}
          <section className="project-types">
            <h3>{t("Projektsprache")}</h3>
            {PROJECT_LANGUAGES_LIST.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`language-item-btn ${language === item.id ? "active" : ""}`}
                disabled={creating}
                onClick={() => selectLanguage(item.id)}
              >
                <span className="language-item-glyph">{item.glyph}</span>
                <div className="language-item-meta">
                  <strong>{item.name}</strong>
                  <small>{item.subtitle}</small>
                </div>
              </button>
            ))}
          </section>

          {/* Right Column: Templates, Configuration & Live Preview */}
          <section className="project-fields">
            {/* Template Cards */}
            <div className="project-fields-section-title">
              <Sparkles size={13} />
              <span>{t("Projektvorlage")} · {languageDef.name}</span>
            </div>
            <div className="template-cards-grid">
              {templates.map((tpl) => {
                const IconComponent = tpl.icon;
                const active = template === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`template-card ${active ? "active" : ""}`}
                    onClick={() => {
                      setTemplate(tpl.id);
                      if (language === "java" && tpl.id !== "standard" && type === "Java") {
                        setType("Gradle");
                      }
                    }}
                  >
                    <div className="template-card-icon">
                      <IconComponent size={14} />
                    </div>
                    <div className="template-card-text">
                      <strong>{tpl.label}</strong>
                      <small>{tpl.description}</small>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* General Project Settings */}
            <div className="field-pair">
              <label>
                <span>{t("Projektname")}</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  pattern="[A-Za-z0-9._-]+"
                  placeholder="kiwi-app"
                  required
                />
              </label>
              <label>
                <span>{t("Speicherort")}</span>
                <div className="path-input">
                  <input value={location} onChange={(event) => setLocation(event.target.value)} required />
                  <button type="button" onClick={async () => setLocation(await chooseLocation() || location)} title={t("Speicherort")}>
                    <FolderOpen size={15} />
                  </button>
                </div>
              </label>
            </div>

            <label>
              <span>Projektbeschreibung</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="z. B. Meine neue Anwendung"
              />
            </label>

            {/* Java-Specific Configuration */}
            {language === "java" && (
              <>
                <div className="project-fields-section-title">
                  <Package size={13} />
                  <span>{t("Build-System")}</span>
                </div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                  {(["Gradle", "Maven", "Java"] as const).map((buildType) => (
                    <button
                      type="button"
                      key={buildType}
                      className={type === buildType ? "secondary-button active" : "secondary-button"}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderColor: type === buildType ? "var(--accent)" : undefined,
                        background: type === buildType ? "var(--accent-surface-3)" : undefined,
                        fontWeight: type === buildType ? 700 : 500,
                      }}
                      onClick={() => setType(buildType)}
                    >
                      {buildType}
                    </button>
                  ))}
                </div>

                {type !== "Java" && (
                  <>
                    <div className="field-pair">
                      <label><span>{t("Group ID")}</span><input value={groupId} onChange={(event) => setGroupId(event.target.value)} /></label>
                      <label><span>{t("Artifact ID")}</span><input value={artifactId} readOnly /></label>
                    </div>
                    <label><span>{t("Package")}</span><input value={packageName} onChange={(event) => setPackageName(event.target.value)} /></label>
                  </>
                )}

                <div className="field-pair">
                  <label>
                    <span>{t("Project SDK")}</span>
                    <div className="path-input">
                      <input value={jdkPath} onChange={(event) => setJdkPath(event.target.value)} placeholder={t("Globales JDK oder automatisch erkennen")} />
                      <button
                        type="button"
                        title={t("JDK auswählen")}
                        onClick={async () => {
                          const selected = await chooseJdk();
                          if (selected) setJdkPath(selected.path);
                        }}
                      >
                        <FolderOpen size={15} />
                      </button>
                    </div>
                  </label>
                  <label>
                    <span>{t("Java Language Level")}</span>
                    <select value={languageLevel} onChange={(event) => setLanguageLevel(event.target.value)}>
                      {JAVA_LANGUAGE_LEVELS.map((version) => (
                        <option key={version} value={version}>Java {version}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            {/* Options Checkboxes */}
            <div className="project-fields-section-title">
              <Check size={13} />
              <span>Optionen</span>
            </div>
            <div className="options-grid">
              <label>
                <input type="checkbox" checked={sampleClass} onChange={(event) => setSampleClass(event.target.checked)} />
                <span>{t("Beispieldatei anlegen")}</span>
              </label>
              <label>
                <input type="checkbox" checked={includeTests} onChange={(event) => setIncludeTests(event.target.checked)} />
                <span>Unit-Tests anlegen</span>
              </label>
              <label>
                <input type="checkbox" checked={initGit} onChange={(event) => setInitGit(event.target.checked)} />
                <span>Git-Repository initialisieren (git init)</span>
              </label>
              <label>
                <input type="checkbox" checked={createReadme} onChange={(event) => setCreateReadme(event.target.checked)} />
                <span>README.md anlegen</span>
              </label>
            </div>

            {/* Interactive Structure Preview */}
            <div className="structure-preview-header">
              <span>Vorschau der Projektstruktur ({previewItems.length} Dateien)</span>
              <span>{name.trim() || "kiwi-app"}/</span>
            </div>
            <div className="structure-preview-box">
              {previewItems.map((item) => (
                <div key={item.path} className={`structure-tree-item ${item.isDir ? "folder" : ""}`}>
                  {item.isDir ? <Folder size={12} /> : item.path.endsWith(".md") ? <FileText size={12} /> : item.path.includes("test") ? <TestTube2 size={12} /> : <FileCode2 size={12} />}
                  <span>{item.path}</span>
                </div>
              ))}
            </div>

            {error && <p role="alert" className="error-message">{error}</p>}
          </section>
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className="primary-button" disabled={creating || !location}>
            {creating ? "Projekt wird erstellt…" : "Projekt erstellen"}
          </button>
        </footer>
      </form>
    </div>
  );
}
