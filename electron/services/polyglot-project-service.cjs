const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { prepareCommand, terminateProcessTree, spawnCapture } = require("./process-utils.cjs");

const PROJECT_LANGUAGES = {
  kotlin: { name: "Kotlin", extension: ".kt", main: "src/main/kotlin/Main.kt" },
  python: { name: "Python", extension: ".py", main: "main.py" },
  rust: { name: "Rust", extension: ".rs", main: "src/main.rs" },
  php: { name: "PHP", extension: ".php", main: "public/index.php" },
  lua: { name: "Lua", extension: ".lua", main: "main.lua" },
  go: { name: "Go", extension: ".go", main: "main.go" },
  c: { name: "C", extension: ".c", main: "src/main.c" },
  cpp: { name: "C++", extension: ".cpp", main: "src/main.cpp" },
  csharp: { name: "C#", extension: ".cs", main: "Program.cs" },
  "objective-c": { name: "Objective-C", extension: ".m", main: "src/main.m" },
  "objective-cpp": { name: "Objective-C++", extension: ".mm", main: "src/main.mm" },
  typescript: { name: "TypeScript", extension: ".ts", main: "src/index.ts" },
  javascript: { name: "JavaScript", extension: ".js", main: "src/index.js" },
  node: { name: "Node.js", extension: ".js", main: "index.js" },
  dart: { name: "Dart", extension: ".dart", main: "bin/main.dart" },
  zig: { name: "Zig", extension: ".zig", main: "src/main.zig" },
  swift: { name: "Swift", extension: ".swift", main: "Sources/main.swift" },
  ruby: { name: "Ruby", extension: ".rb", main: "main.rb" },
  elixir: { name: "Elixir", extension: ".ex", main: "lib/main.ex" },
  r: { name: "R", extension: ".R", main: "main.R" },
  scala: { name: "Scala", extension: ".scala", main: "src/main/scala/Main.scala" },
  shell: { name: "Shell", extension: ".sh", main: "main.sh" },
  powershell: { name: "PowerShell", extension: ".ps1", main: "main.ps1" },
  perl: { name: "Perl", extension: ".pl", main: "main.pl" },
  gdscript: { name: "GDScript", extension: ".gd", main: "main.gd" },
  sql: { name: "SQL", extension: ".sql", main: "main.sql" },
  terraform: { name: "Terraform", extension: ".tf", main: "main.tf" },
  assembly: { name: "Assembly", extension: ".asm", main: "main.asm" },
  autohotkey: { name: "AutoHotkey", extension: ".ahk", main: "main.ahk" },
  odin: { name: "Odin", extension: ".odin", main: "main.odin" },
};

const EXTENSIONS = {
  ".kt": "kotlin", ".kts": "kotlin", ".py": "python", ".pyw": "python",
  ".rs": "rust", ".php": "php", ".phtml": "php", ".lua": "lua", ".go": "go",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp",
  ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp", ".cs": "csharp", ".m": "objective-c", ".mm": "objective-cpp",
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".vue": "javascript", ".svelte": "javascript",
  ".dart": "dart",
  ".zig": "zig",
  ".swift": "swift",
  ".rb": "ruby", ".rake": "ruby", ".gemspec": "ruby",
  ".ex": "elixir", ".exs": "elixir",
  ".r": "r", ".R": "r",
  ".scala": "scala", ".sc": "scala",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".ps1": "powershell", ".psm1": "powershell", ".psd1": "powershell",
  ".pl": "perl", ".pm": "perl", ".t": "perl",
  ".gd": "gdscript",
  ".sql": "sql",
  ".tf": "terraform", ".tfvars": "terraform", ".hcl": "terraform",
  ".asm": "assembly", ".s": "assembly",
  ".ahk": "autohotkey",
  ".odin": "odin",
};
const IGNORE = new Set([".git", ".kiwi", ".idea", "node_modules", "vendor", "target", "build", "out", "bin", "obj", ".gradle", ".venv", "venv", "__pycache__"]);

function languageForFile(file) {
  return EXTENSIONS[path.extname(String(file || "")).toLowerCase()] || "";
}

function sourceFiles(root, maxDepth = 5) {
  const result = [];
  function visit(directory, depth) {
    if (depth > maxDepth || result.length >= 3000) return;
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (result.length >= 3000) break;
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !IGNORE.has(entry.name)) visit(file, depth + 1);
      else if (entry.isFile() && (languageForFile(file) || /\.java$/i.test(file))) result.push(file);
    }
  }
  visit(root, 0);
  return result;
}

/** Detect the main project language without probing or requiring a Java SDK. */
function detectPolyglotProject(root, file = "") {
  const has = (name) => fs.existsSync(path.join(root, name));
  let language = languageForFile(file);
  let buildFile = null;
  if (!language) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(root, ".kiwi", "language.json"), "utf8"));
      if (Object.hasOwn(PROJECT_LANGUAGES, saved.language)) language = saved.language;
    } catch { /* An imported project has no Kiwi metadata. */ }
  }
  const manifests = [
    ["tsconfig.json", "typescript"],
    ["package.json", "javascript"],
    ["pubspec.yaml", "dart"],
    ["build.zig", "zig"],
    ["Package.swift", "swift"],
    ["Gemfile", "ruby"],
    ["mix.exs", "elixir"],
    ["build.sbt", "scala"],
    ["cpanfile", "perl"], ["Makefile.PL", "perl"],
    ["project.godot", "gdscript"],
    ["main.tf", "terraform"],
    ["ols.json", "odin"],
    ["Cargo.toml", "rust"], ["go.mod", "go"], ["go.work", "go"],
    ["composer.json", "php"], ["pyproject.toml", "python"], ["requirements.txt", "python"],
    ["Pipfile", "python"], ["setup.py", "python"],
  ];
  if (!language) {
    for (const [manifest, candidate] of manifests) {
      if (has(manifest)) { language = candidate; buildFile = manifest; break; }
    }
  }
  let topFiles = [];
  try { topFiles = fs.readdirSync(root); } catch { return null; }
  const csproj = topFiles.find((name) => /\.csproj$/i.test(name));
  if (!language && csproj) { language = "csharp"; buildFile = csproj; }
  // An ordinary Gradle or Maven project remains on the existing Java path.
  // Kotlin-only roots are recognised by their source directory or plugin.
  if (!language && (has("src/main/kotlin") || has("build.gradle.kts") || has("build.gradle"))) {
    let gradle = "";
    try { gradle = fs.readFileSync(path.join(root, has("build.gradle.kts") ? "build.gradle.kts" : "build.gradle"), "utf8"); } catch {}
    if (has("src/main/kotlin") || /kotlin\s*\(\s*["']jvm["']|org\.jetbrains\.kotlin/.test(gradle)) language = "kotlin";
  }
  if (!language && (has("pom.xml") || has("build.gradle") || has("build.gradle.kts"))) return null;
  const sources = sourceFiles(root);
  if (!language && sources.some((candidate) => /\.java$/i.test(candidate))) return null;
  if (!language && has("CMakeLists.txt")) {
    language = sources.map(languageForFile).find((id) => ["cpp", "objective-cpp", "objective-c", "c"].includes(id)) || "cpp";
    buildFile = "CMakeLists.txt";
  }
  if (!language) language = sources.map(languageForFile).find(Boolean) || "";
  const definition = PROJECT_LANGUAGES[language];
  if (!definition) return null;
  if (!buildFile) {
    if (language === "csharp") buildFile = csproj || null;
    else if (language === "kotlin") buildFile = has("build.gradle.kts") ? "build.gradle.kts" : has("build.gradle") ? "build.gradle" : has("pom.xml") ? "pom.xml" : null;
    else if (language === "typescript") buildFile = has("tsconfig.json") ? "tsconfig.json" : has("package.json") ? "package.json" : null;
    else if (language === "javascript" || language === "node") buildFile = has("package.json") ? "package.json" : null;
    else buildFile = manifests.find(([manifest, id]) => id === language && has(manifest))?.[0] || (has("CMakeLists.txt") ? "CMakeLists.txt" : null);
  }
  const mainFile = file || (has(definition.main) ? path.join(root, definition.main) : sources.find((candidate) => languageForFile(candidate) === language) || (language === "node" ? sources.find((candidate) => candidate.endsWith(".js")) : "") || "");
  return { language, type: definition.name, buildFile, mainFile };
}

function safeName(name) {
  const value = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") throw new Error("Der Projektname enthält ungültige Zeichen.");
  return value;
}

function findExecutable(names, env = process.env) {
  for (const name of names) {
    if (path.isAbsolute(name) && fs.existsSync(name)) return name;
    for (const directory of String(env.PATH || env.Path || "").split(path.delimiter)) {
      if (!directory) continue;
      const candidates = process.platform === "win32" && !path.extname(name)
        ? [name, ...String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((extension) => `${name}${extension.toLowerCase()}`)]
        : [name];
      for (const candidate of candidates) {
        const file = path.join(directory, candidate);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
      }
    }
  }
  return names[0];
}

function projectFiles(language, name, sample, template = "standard", options = {}) {
  const packageName = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([^a-zA-Z_])/, "_$1").toLowerCase();
  const greeting = `Hello from ${PROJECT_LANGUAGES[language].name}!`;
  const desc = options.description || `Created with Kiwi IDE.`;
  const files = {
    ".gitignore": ".kiwi/\n.venv/\nvenv/\n__pycache__/\n*.pyc\ntarget/\nbuild/\nout/\nbin/\nobj/\n.gradle/\nvendor/\nnode_modules/\n*.class\n",
    ".kiwi/language.json": `${JSON.stringify({ version: 1, language, template }, null, 2)}\n`,
    "README.md": `# ${name}\n\n${desc}\n\n## Getting Started\n\n- Use **Run** (F5) or **Build** in Kiwi IDE.\n- The matching compiler or interpreter must be installed on PATH.\n`,
  };

  if (language === "python") {
    if (template === "fastapi") {
      files["pyproject.toml"] = `[project]\nname = ${JSON.stringify(name.toLowerCase().replace(/_/g, "-"))}\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = ["fastapi", "uvicorn[standard]", "pydantic"]\n`;
      files["requirements.txt"] = "fastapi>=0.110.0\nuvicorn[standard]>=0.28.0\npydantic>=2.0.0\npytest>=8.0.0\nhttpx>=0.27.0\n";
      files["tests/__init__.py"] = "";
      if (sample) {
        files["app.py"] = `from fastapi import FastAPI\nfrom pydantic import BaseModel\nimport uvicorn\n\napp = FastAPI(title=${JSON.stringify(name)}, version="1.0.0")\n\nclass Item(BaseModel):\n    name: str\n    description: str | None = None\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello from FastAPI!", "app": ${JSON.stringify(name)}, "status": "online"}\n\n@app.get("/health")\ndef health():\n    return {"status": "healthy"}\n\n@app.post("/items")\ndef create_item(item: Item):\n    return {"created": item, "status": "success"}\n\nif __name__ == "__main__":\n    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)\n`;
        files["tests/test_api.py"] = `import unittest\nfrom fastapi.testclient import TestClient\nfrom app import app\n\nclass TestApi(unittest.TestCase):\n    def setUp(self):\n        self.client = TestClient(app)\n\n    def test_root(self):\n        res = self.client.get("/")\n        self.assertEqual(res.status_code, 200)\n        self.assertEqual(res.json()["status"], "online")\n\nif __name__ == "__main__":\n    unittest.main()\n`;
      }
    } else if (template === "flask") {
      files["pyproject.toml"] = `[project]\nname = ${JSON.stringify(name.toLowerCase().replace(/_/g, "-"))}\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = ["flask"]\n`;
      files["requirements.txt"] = "flask>=3.0.0\npytest>=8.0.0\n";
      files["tests/__init__.py"] = "";
      if (sample) {
        files["app.py"] = `from flask import Flask, jsonify, render_template\n\napp = Flask(__name__)\n\n@app.route("/")\ndef index():\n    return render_template("index.html", title=${JSON.stringify(name)})\n\n@app.route("/api/health")\ndef health():\n    return jsonify({"status": "healthy", "app": ${JSON.stringify(name)}})\n\nif __name__ == "__main__":\n    app.run(host="127.0.0.1", port=5000, debug=True)\n`;
        files["templates/index.html"] = `<!doctype html>\n<html lang="de">\n<head><meta charset="UTF-8"><title>{{ title }}</title><link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}"></head>\n<body><main><h1>{{ title }}</h1><p>Flask läuft erfolgreich in Kiwi IDE.</p></main></body>\n</html>\n`;
        files["static/style.css"] = "body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 48rem; padding: 1rem; line-height: 1.6; }\n";
        files["tests/test_app.py"] = `import unittest\nfrom app import app\n\nclass TestFlask(unittest.TestCase):\n    def setUp(self):\n        self.client = app.test_client()\n\n    def test_health(self):\n        res = self.client.get("/api/health")\n        self.assertEqual(res.status_code, 200)\n\nif __name__ == "__main__":\n    unittest.main()\n`;
      }
    } else if (template === "datascience") {
      files["pyproject.toml"] = `[project]\nname = ${JSON.stringify(name.toLowerCase().replace(/_/g, "-"))}\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = ["pandas", "numpy", "matplotlib"]\n`;
      files["requirements.txt"] = "pandas>=2.0.0\nnumpy>=1.26.0\nmatplotlib>=3.8.0\npytest>=8.0.0\n";
      if (sample) {
        files["analysis.py"] = `import csv\nimport os\nimport statistics\n\ndef run_analysis():\n    data_file = os.path.join(os.path.dirname(__file__), "data", "sample.csv")\n    if not os.path.exists(data_file):\n        print(f"Data file not found: {data_file}")\n        return\n    scores = []\n    with open(data_file, "r", encoding="utf-8") as f:\n        reader = csv.DictReader(f)\n        for row in reader:\n            scores.append(float(row["score"]))\n    print(f"Dataset entries: {len(scores)}")\n    print(f"Mean score: {statistics.mean(scores):.2f}")\n    print(f"Max score:  {max(scores):.2f}")\n\nif __name__ == "__main__":\n    run_analysis()\n`;
        files["data/sample.csv"] = "id,name,metric,score\n1,Alpha,A,94.5\n2,Beta,B,88.2\n3,Gamma,A,92.0\n4,Delta,C,98.6\n";
      }
    } else if (template === "package") {
      files["pyproject.toml"] = `[project]\nname = ${JSON.stringify(name.toLowerCase().replace(/_/g, "-"))}\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = []\n\n[build-system]\nrequires = ["setuptools>=61.0"]\nbuild-backend = "setuptools.build_meta"\n`;
      if (sample) {
        files[`src/${packageName}/__init__.py`] = `"""${name} package."""\n__version__ = "0.1.0"\nfrom .core import greet\n__all__ = ["greet"]\n`;
        files[`src/${packageName}/core.py`] = `def greet(name: str = "World") -> str:\n    return f"Hello, {name}! Welcome to ${name}."\n`;
        files["tests/test_core.py"] = `import unittest\nfrom ${packageName}.core import greet\n\nclass TestCore(unittest.TestCase):\n    def test_greet(self):\n        self.assertIn("Hello, Kiwi!", greet("Kiwi"))\n\nif __name__ == "__main__":\n    unittest.main()\n`;
      }
    } else {
      files["pyproject.toml"] = `[project]\nname = ${JSON.stringify(name.toLowerCase().replace(/_/g, "-"))}\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = []\n`;
      files["requirements.txt"] = "pytest>=8.0.0\n";
      files["tests/__init__.py"] = "";
      if (sample) files["main.py"] = `def main():\n    print(${JSON.stringify(greeting)})\n\n\nif __name__ == "__main__":\n    main()\n`;
      if (sample && options.includeTests !== false) {
        files["tests/test_main.py"] = `import unittest\n\nclass TestMain(unittest.TestCase):\n    def test_example(self):\n        self.assertEqual(1 + 1, 2)\n\nif __name__ == "__main__":\n    unittest.main()\n`;
      }
    }
  } else if (language === "rust") {
    if (template === "library") {
      files["Cargo.toml"] = `[package]\nname = ${JSON.stringify(packageName)}\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`;
      if (sample) {
        files["src/lib.rs"] = `pub fn add(left: usize, right: usize) -> usize {\n    left + right\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn it_works() {\n        let result = add(2, 2);\n        assert_eq!(result, 4);\n    }\n}\n`;
        files["tests/integration_test.rs"] = `use ${packageName}::add;\n\n#[test]\nfn test_add() {\n    assert_eq!(add(3, 4), 7);\n}\n`;
      }
    } else {
      files["Cargo.toml"] = `[package]\nname = ${JSON.stringify(packageName)}\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`;
      if (sample) files["src/main.rs"] = `fn main() {\n    println!(${JSON.stringify(greeting)});\n}\n`;
      if (sample && options.includeTests !== false) {
        files["tests/test_main.rs"] = `#[test]\nfn test_main() {\n    assert_eq!(2 + 2, 4);\n}\n`;
      }
    }
  } else if (language === "go") {
    const modName = `example.com/${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
    files["go.mod"] = `module ${modName}\n\ngo 1.21\n`;
    if (template === "rest") {
      if (sample) {
        files["main.go"] = `package main\n\nimport (\n\t"encoding/json"\n\t"fmt"\n\t"log"\n\t"net/http"\n\t"time"\n)\n\ntype StatusResponse struct {\n\tMessage string    \`json:"message"\`\n\tStatus  string    \`json:"status"\`\n\tTime    time.Time \`json:"time"\`\n}\n\nfunc main() {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n\t\tw.Header().Set("Content-Type", "application/json")\n\t\tjson.NewEncoder(w).Encode(StatusResponse{\n\t\t\tMessage: ${JSON.stringify(greeting)},\n\t\t\tStatus:  "ok",\n\t\t\tTime:    time.Now(),\n\t\t})\n\t})\n\tmux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {\n\t\tw.Header().Set("Content-Type", "application/json")\n\t\tw.Write([]byte(\`{"status":"healthy"}\`))\n\t})\n\n\taddr := ":8080"\n\tfmt.Printf("Go REST server running at http://localhost%s\\n", addr)\n\tlog.Fatal(http.ListenAndServe(addr, mux))\n}\n`;
        files["main_test.go"] = `package main\n\nimport (\n\t"net/http"\n\t"net/http/httptest"\n\t"testing"\n)\n\nfunc TestHealthEndpoint(t *testing.T) {\n\treq := httptest.NewRequest("GET", "/health", nil)\n\tw := httptest.NewRecorder()\n\thttp.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {\n\t\trw.Write([]byte(\`{"status":"healthy"}\`))\n\t}).ServeHTTP(w, req)\n\tif w.Code != http.StatusOK {\n\t\tt.Errorf("Expected 200, got %d", w.Code)\n\t}\n}\n`;
      }
    } else if (template === "package") {
      if (sample) {
        files["pkg/calc/calc.go"] = `package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n`;
        files["pkg/calc/calc_test.go"] = `package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 {\n\t\tt.Errorf("Add(2, 3) = %d; want 5", Add(2, 3))\n\t}\n}\n`;
        files["main.go"] = `package main\n\nimport (\n\t"fmt"\n\t"${modName}/pkg/calc"\n)\n\nfunc main() {\n\tfmt.Println(${JSON.stringify(greeting)})\n\tfmt.Printf("calc.Add(10, 20) = %d\\n", calc.Add(10, 20))\n}\n`;
      }
    } else {
      if (sample) files["main.go"] = `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(${JSON.stringify(greeting)})\n}\n`;
      if (sample && options.includeTests !== false) {
        files["main_test.go"] = `package main\n\nimport "testing"\n\nfunc TestMain(t *testing.T) {\n\tif 1+1 != 2 {\n\t\tt.Errorf("Basic math failed")\n\t}\n}\n`;
      }
    }
  } else if (language === "php") {
    if (template === "rest") {
      files["composer.json"] = `${JSON.stringify({ name: `app/${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, description: desc, type: "project", require: { php: ">=8.1" } }, null, 2)}\n`;
      if (sample) {
        files["public/index.php"] = `<?php\ndeclare(strict_types=1);\n\nheader('Content-Type: application/json; charset=UTF-8');\n\n$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);\n\nif ($uri === '/' || $uri === '/api') {\n    echo json_encode([\n        'status' => 'ok',\n        'message' => '${greeting}',\n        'time' => date('c'),\n        'endpoints' => ['/api/health']\n    ], JSON_PRETTY_PRINT);\n    exit;\n}\n\nif ($uri === '/api/health') {\n    echo json_encode(['status' => 'healthy']);\n    exit;\n}\n\nhttp_response_code(404);\necho json_encode(['error' => 'Not Found', 'path' => $uri]);\n`;
        files["src/Api/Response.php"] = `<?php\ndeclare(strict_types=1);\n\nnamespace App\\Api;\n\nclass Response\n{\n    public static function json(array $data, int $status = 200): void\n    {\n        http_response_code($status);\n        header('Content-Type: application/json; charset=UTF-8');\n        echo json_encode($data, JSON_PRETTY_PRINT);\n    }\n}\n`;
      }
    } else if (template === "cli") {
      files["composer.json"] = `${JSON.stringify({ name: `app/${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, description: desc, type: "project", require: { php: ">=8.1" } }, null, 2)}\n`;
      if (sample) {
        files["bin/console"] = `#!/usr/bin/env php\n<?php\ndeclare(strict_types=1);\n\necho "=== ${name} CLI Tool ===\\n";\necho "${greeting}\\n";\n`;
      }
    } else if (template === "frontend" || template === "web") {
      files["index.html"] = `<!doctype html>\n<html lang="de">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <header>\n    <h1>${name}</h1>\n    <p>${greeting}</p>\n  </header>\n  <main id="app">\n    <div class="card">\n      <button id="counter-btn">Klicks: 0</button>\n    </div>\n  </main>\n  <script type="module" src="main.js"></script>\n</body>\n</html>\n`;
      files["style.css"] = "body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }\nheader { text-align: center; margin-bottom: 2rem; }\n.card { background: #1e293b; border-radius: 8px; padding: 1.5rem; max-width: 420px; margin: 0 auto; text-align: center; }\nbutton { background: #3b82f6; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-size: 1rem; }\n";
      files["main.js"] = `let count = 0;\nconst btn = document.getElementById("counter-btn");\nif (btn) {\n  btn.addEventListener("click", () => {\n    count += 1;\n    btn.textContent = \`Klicks: \${count}\`;\n  });\n}\nconsole.log(${JSON.stringify(greeting)});\n`;
      files["package.json"] = `${JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"), version: "1.0.0", description: desc, scripts: { start: "npx serve ." } }, null, 2)}\n`;
    } else {
      files["composer.json"] = `${JSON.stringify({ name: `app/${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, description: desc, type: "project", require: { php: ">=8.1" }, autoload: { "psr-4": { "App\\": "src/" } } }, null, 2)}\n`;
      if (sample) files["public/index.php"] = `<?php\ndeclare(strict_types=1);\n?>\n<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>${name}</title><link rel="stylesheet" href="style.css"></head>\n<body><h1><?php echo htmlspecialchars('${greeting}', ENT_QUOTES, 'UTF-8'); ?></h1></body>\n</html>\n`;
      files["public/style.css"] = "body { font: 16px system-ui, sans-serif; max-width: 48rem; margin: 4rem auto; padding: 1rem; }\n";
      if (sample) files["src/App.php"] = `<?php\ndeclare(strict_types=1);\n\nnamespace App;\n\nclass App\n{\n    public function greet(): string\n    {\n        return '${greeting}';\n    }\n}\n`;
    }
  } else if (language === "lua") {
    if (template === "modular") {
      if (sample) {
        files["main.lua"] = `local app = require("src.module")\n\nlocal function main()\n    print(app.greet(${JSON.stringify(name)}))\nend\n\nmain()\n`;
        files["src/module.lua"] = `local M = {}\n\nfunction M.greet(target)\n    return "Hello from Lua module, " .. (target or "World") .. "!"\nend\n\nreturn M\n`;
        files["tests/test_module.lua"] = `local app = require("src.module")\nassert(app.greet("Kiwi") == "Hello from Lua module, Kiwi!")\nprint("All Lua tests passed.")\n`;
      }
    } else {
      if (sample) files["main.lua"] = `local function main()\n    print(${JSON.stringify(greeting)})\nend\n\nmain()\n`;
    }
  } else if (language === "kotlin") {
    if (template === "gradle") {
      files["build.gradle.kts"] = `plugins {\n    kotlin("jvm") version "2.0.0"\n    application\n}\n\nrepositories {\n    mavenCentral()\n}\n\ndependencies {\n    testImplementation(kotlin("test"))\n}\n\ntasks.test {\n    useJUnitPlatform()\n}\n\napplication {\n    mainClass.set("MainKt")\n}\n`;
      files["settings.gradle.kts"] = `rootProject.name = "${name}"\n`;
      if (sample) files["src/main/kotlin/Main.kt"] = `fun main() {\n    println(${JSON.stringify(greeting)})\n}\n`;
      if (sample && options.includeTests !== false) {
        files["src/test/kotlin/MainTest.kt"] = `import kotlin.test.Test\nimport kotlin.test.assertEquals\n\nclass MainTest {\n    @Test\n    fun testExample() {\n        assertEquals(4, 2 + 2)\n    }\n}\n`;
      }
    } else if (template === "script") {
      if (sample) files["script.kts"] = `println(${JSON.stringify(greeting)})\n`;
    } else {
      if (sample) files["src/main/kotlin/Main.kt"] = `fun main() {\n    println(${JSON.stringify(greeting)})\n}\n`;
      files["README.md"] += "\nThe starter uses the Kotlin command-line compiler (`kotlinc`) and a Java runtime. Existing Gradle projects use their Gradle build.\n";
    }
  } else if (language === "csharp") {
    if (template === "webapi") {
      files[`${name}.csproj`] = '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n';
      if (sample) {
        files["Program.cs"] = `var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\n\napp.MapGet("/", () => Results.Ok(new { message = ${JSON.stringify(greeting)}, status = "ok" }));\napp.MapGet("/health", () => Results.Ok(new { status = "healthy" }));\n\napp.Run();\n`;
        files["appsettings.json"] = '{\n  "Logging": {\n    "LogLevel": {\n      "Default": "Information",\n      "Microsoft.AspNetCore": "Warning"\n    }\n  },\n  "AllowedHosts": "*"\n}\n';
      }
    } else if (template === "library") {
      files[`${name}.csproj`] = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n';
      if (sample) {
        files["Class1.cs"] = `namespace ${name};\n\npublic class Class1\n{\n    public string Greet(string target) => $"Hello, {target}!";\n}\n`;
      }
    } else {
      files[`${name}.csproj`] = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n';
      files["README.md"] += "\nThis starter targets .NET 10 LTS and needs the .NET 10 SDK or newer. Existing C# projects keep their own target framework.\n";
      if (sample) files["Program.cs"] = `Console.WriteLine(${JSON.stringify(greeting)});\n`;
    }
  } else if (language === "typescript") {
    if (template === "react") {
      files["package.json"] = `${JSON.stringify({
        name: packageName,
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "tsc -b && vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
        devDependencies: {
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@vitejs/plugin-react": "^4.3.4",
          typescript: "^5.7.2",
          vite: "^6.0.0",
        },
      }, null, 2)}\n`;
      files["tsconfig.json"] = `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          useDefineForClassFields: true,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          skipLibCheck: true,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          moduleDetection: "force",
          noEmit: true,
          jsx: "react-jsx",
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
        },
        include: ["src"],
      }, null, 2)}\n`;
      files["vite.config.ts"] = `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { port: 3000 },\n});\n`;
      files["index.html"] = `<!doctype html>\n<html lang="de">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`;
      if (sample) {
        files["src/index.ts"] = `export * from "./App";\n`;
        files["src/main.tsx"] = `import React from "react";\nimport ReactDOM from "react-dom/client";\nimport { App } from "./App";\nimport "./index.css";\n\nconst root = document.getElementById("root");\nif (root) {\n  ReactDOM.createRoot(root).render(\n    <React.StrictMode>\n      <App />\n    </React.StrictMode>\n  );\n}\n`;
        files["src/App.tsx"] = `import React, { useState } from "react";\n\nexport function App() {\n  const [count, setCount] = useState<number>(0);\n  return (\n    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>\n      <h1>${name}</h1>\n      <p>${greeting}</p>\n      <button\n        onClick={() => setCount((c) => c + 1)}\n        style={{ padding: "0.6rem 1.2rem", fontSize: "1rem", cursor: "pointer", borderRadius: "6px" }}\n      >\n        Klicks: {count}\n      </button>\n    </div>\n  );\n}\n`;
        files["src/index.css"] = `body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; }\n`;
      }
    } else if (template === "express") {
      files["package.json"] = `${JSON.stringify({
        name: packageName,
        version: "1.0.0",
        description: desc,
        type: "module",
        main: "dist/index.js",
        scripts: {
          build: "tsc",
          start: "node dist/index.js",
          dev: "tsx watch src/index.ts",
        },
        dependencies: {
          express: "^4.21.2",
          cors: "^2.8.5",
        },
        devDependencies: {
          "@types/express": "^5.0.0",
          "@types/cors": "^2.8.17",
          "@types/node": "^22.10.0",
          tsx: "^4.19.2",
          typescript: "^5.7.2",
        },
      }, null, 2)}\n`;
      files["tsconfig.json"] = `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: "src",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      }, null, 2)}\n`;
      if (sample) {
        files["src/index.ts"] = `import express, { Request, Response } from "express";\nimport cors from "cors";\n\nconst app = express();\nconst port = Number(process.env.PORT) || 3000;\n\napp.use(cors());\napp.use(express.json());\n\napp.get("/", (_req: Request, res: Response) => {\n  res.json({ message: ${JSON.stringify(greeting)}, status: "online" });\n});\n\napp.get("/api/health", (_req: Request, res: Response) => {\n  res.json({ status: "healthy", timestamp: new Date().toISOString() });\n});\n\napp.listen(port, () => {\n  console.log(\`TypeScript Express Server läuft auf http://localhost:\${port}\`);\n});\n`;
      }
    } else {
      files["package.json"] = `${JSON.stringify({
        name: packageName,
        version: "1.0.0",
        description: desc,
        type: "module",
        main: "src/index.ts",
        scripts: {
          build: "tsc",
          start: "tsx src/index.ts",
          dev: "tsx watch src/index.ts",
          test: "node --test",
        },
        devDependencies: {
          "@types/node": "^22.10.0",
          tsx: "^4.19.2",
          typescript: "^5.7.2",
        },
      }, null, 2)}\n`;
      files["tsconfig.json"] = `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: "dist",
        },
        include: ["src/**/*"],
      }, null, 2)}\n`;
      if (sample) {
        files["src/index.ts"] = `export function main(): void {\n  console.log(${JSON.stringify(greeting)});\n}\n\nmain();\n`;
        if (options.includeTests !== false) {
          files["tests/index.test.ts"] = `import { describe, it } from "node:test";\nimport assert from "node:assert";\n\ndescribe("TypeScript App", () => {\n  it("runs tests correctly", () => {\n    assert.strictEqual(1 + 1, 2);\n  });\n});\n`;
        }
      }
    }
  } else if (language === "javascript" || language === "node") {
    const isNode = language === "node";
    const mainFile = isNode ? "index.js" : "src/index.js";
    if (template === "express") {
      files["package.json"] = `${JSON.stringify({
        name: packageName,
        version: "1.0.0",
        description: desc,
        type: "module",
        main: mainFile,
        scripts: {
          start: `node ${mainFile}`,
          dev: `node --watch ${mainFile}`,
        },
        dependencies: {
          express: "^4.21.2",
          cors: "^2.8.5",
        },
      }, null, 2)}\n`;
      if (sample) {
        files[mainFile] = `import express from "express";\nimport cors from "cors";\n\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.use(cors());\napp.use(express.json());\n\napp.get("/", (req, res) => {\n  res.json({ message: ${JSON.stringify(greeting)}, status: "online" });\n});\n\napp.get("/api/health", (req, res) => {\n  res.json({ status: "healthy" });\n});\n\napp.listen(port, () => {\n  console.log(\`Express Server läuft auf http://localhost:\${port}\`);\n});\n`;
      }
    } else if (template === "react") {
      files["package.json"] = `${JSON.stringify({
        name: packageName,
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
        devDependencies: {
          "@vitejs/plugin-react": "^4.3.4",
          vite: "^6.0.0",
        },
      }, null, 2)}\n`;
      files["vite.config.js"] = `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { port: 3000 },\n});\n`;
      files["index.html"] = `<!doctype html>\n<html lang="de">\n  <head>\n    <meta charset="UTF-8" />\n    <title>${name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`;
      if (sample) {
        files["src/index.js"] = `export * from "./App";\n`;
        files["src/main.jsx"] = `import React from "react";\nimport ReactDOM from "react-dom/client";\nimport { App } from "./App";\n\nconst root = document.getElementById("root");\nif (root) {\n  ReactDOM.createRoot(root).render(<App />);\n}\n`;
        files["src/App.jsx"] = `import React, { useState } from "react";\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>\n      <h1>${name}</h1>\n      <p>${greeting}</p>\n      <button onClick={() => setCount(c => c + 1)}>Klicks: {count}</button>\n    </div>\n  );\n}\n`;
      }
    } else {
      files["package.json"] = `${JSON.stringify({
        name: packageName,
        version: "1.0.0",
        description: desc,
        type: "module",
        main: mainFile,
        scripts: {
          start: `node ${mainFile}`,
          dev: `node --watch ${mainFile}`,
          test: "node --test",
        },
      }, null, 2)}\n`;
      if (sample) {
        files[mainFile] = `export function main() {\n  console.log(${JSON.stringify(greeting)});\n}\n\nmain();\n`;
        if (options.includeTests !== false) {
          files[isNode ? "test/index.test.js" : "tests/index.test.js"] = `import { describe, it } from "node:test";\nimport assert from "node:assert";\n\ndescribe("Application", () => {\n  it("basic test", () => {\n    assert.strictEqual(1 + 1, 2);\n  });\n});\n`;
        }
      }
    }
  } else if (language === "dart") {
    files["pubspec.yaml"] = `name: ${packageName}\ndescription: ${desc}\nversion: 1.0.0\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndev_dependencies:\n  test: ^1.24.0\n`;
    if (sample) {
      files["bin/main.dart"] = `void main() {\n  print(${JSON.stringify(greeting)});\n}\n`;
      if (options.includeTests !== false) {
        files["test/main_test.dart"] = `import 'package:test/test.dart';\n\nvoid main() {\n  test('arithmetic', () {\n    expect(2 + 2, equals(4));\n  });\n}\n`;
      }
    }
  } else if (language === "zig") {
    files["build.zig"] = `const std = @import("std");\n\npub fn build(b: *std.Build) void {\n    const target = b.standardTargetOptions(.{});\n    const optimize = b.standardOptimizeOption(.{});\n    const exe = b.addExecutable(.{\n        .name = "${packageName}",\n        .root_source_file = b.path("src/main.zig"),\n        .target = target,\n        .optimize = optimize,\n    });\n    b.installArtifact(exe);\n    const run_cmd = b.addRunArtifact(exe);\n    const run_step = b.step("run", "Run the application");\n    run_step.dependOn(&run_cmd.step);\n}\n`;
    if (sample) {
      files["src/main.zig"] = `const std = @import("std");\n\npub fn main() !void {\n    const stdout = std.io.getStdOut().writer();\n    try stdout.print("${greeting}\\n", .{});\n}\n`;
    }
  } else if (language === "swift") {
    files["Package.swift"] = `// swift-tools-version: 5.9\nimport PackageDescription\n\nlet package = Package(\n    name: "${name}",\n    targets: [\n        .executableTarget(name: "${name}", path: "Sources")\n    ]\n)\n`;
    if (sample) {
      files["Sources/main.swift"] = `import Foundation\n\nprint(${JSON.stringify(greeting)})\n`;
    }
  } else if (language === "ruby") {
    files["Gemfile"] = `source "https://rubygems.org"\n\ngem "rake", "~> 13.0"\n`;
    if (sample) {
      files["main.rb"] = `def main\n  puts ${JSON.stringify(greeting)}\nend\n\nmain\n`;
      if (options.includeTests !== false) {
        files["test/test_main.rb"] = `require "minitest/autorun"\n\nclass TestMain < Minitest::Test\n  def test_example\n    assert_equal 4, 2 + 2\n  end\nend\n`;
      }
    }
  } else if (language === "elixir") {
    files["mix.exs"] = `defmodule ${name.replace(/[^A-Za-z0-9]/g, "") || "App"}.MixProject do\n  use Mix.Project\n\n  def project do\n    [\n      app: :${packageName},\n      version: "0.1.0",\n      elixir: "~> 1.14",\n      start_permanent: Mix.env() == :prod,\n      deps: []\n    ]\n  end\nend\n`;
    if (sample) {
      files["lib/main.ex"] = `defmodule Main do\n  def run do\n    IO.puts(${JSON.stringify(greeting)})\n  end\nend\n\nMain.run()\n`;
    }
  } else if (language === "r") {
    files["main.R"] = `# R Data Science Script\n\ngreeting <- ${JSON.stringify(greeting)}\ncat(greeting, "\\n")\n\n# Sample data frame\ndf <- data.frame(\n  id = 1:5,\n  score = c(88, 92, 79, 95, 85)\n)\nprint(summary(df))\n`;
  } else if (language === "scala") {
    files["build.sbt"] = `scalaVersion := "3.3.1"\n\nname := "${name}"\nversion := "0.1.0"\n`;
    if (sample) {
      files["src/main/scala/Main.scala"] = `@main def run(): Unit = {\n  println(${JSON.stringify(greeting)})\n}\n`;
    }
  } else if (language === "shell") {
    files["main.sh"] = `#!/usr/bin/env bash\nset -euo pipefail\n\necho ${JSON.stringify(greeting)}\n`;
  } else if (language === "powershell") {
    files["main.ps1"] = `# PowerShell Script\nWrite-Host ${JSON.stringify(greeting)} -ForegroundColor Cyan\n`;
  } else if (language === "perl") {
    files["cpanfile"] = `requires "Test::More", ">= 0.98";\n`;
    if (sample) {
      files["main.pl"] = `#!/usr/bin/env perl\nuse strict;\nuse warnings;\n\nprint ${JSON.stringify(greeting)} . "\\n";\n`;
      if (options.includeTests !== false) {
        files["t/01_basic.t"] = `use strict;\nuse warnings;\nuse Test::More tests => 1;\n\nok(1 == 1, 'basic math works');\n`;
      }
    }
  } else if (language === "gdscript") {
    files["project.godot"] = `; Engine configuration file for Godot Engine\n[application]\nconfig/name="${name}"\nconfig/features=PackedStringArray("4.3", "Forward Plus")\n`;
    if (sample) {
      files["main.gd"] = `extends SceneTree\n\nfunc _init():\n\tprint(${JSON.stringify(greeting)})\n\tquit()\n`;
    }
  } else if (language === "sql") {
    files["main.sql"] = `-- SQL Starter Script (${name})\nCREATE TABLE IF NOT EXISTS items (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  title TEXT NOT NULL,\n  status TEXT DEFAULT 'active'\n);\n\nINSERT INTO items (title) VALUES (${JSON.stringify(greeting)});\n\nSELECT * FROM items;\n`;
  } else if (language === "terraform") {
    files["main.tf"] = `terraform {\n  required_version = ">= 1.5.0"\n}\n\noutput "welcome_message" {\n  value       = ${JSON.stringify(greeting)}\n  description = "Project greeting"\n}\n`;
    files["variables.tf"] = `variable "environment" {\n  type        = string\n  default     = "dev"\n  description = "Target deployment environment"\n}\n`;
  } else if (language === "assembly") {
    files["main.asm"] = `; x86_64 NASM Assembly (${name})\ndefault rel\nglobal main\nextern puts\n\nsection .data\n    msg: db ${JSON.stringify(greeting)}, 0\n\nsection .text\nmain:\n    sub rsp, 40\n    lea rcx, [msg]\n    call puts\n    xor eax, eax\n    add rsp, 40\n    ret\n`;
  } else if (language === "autohotkey") {
    files["main.ahk"] = `#Requires AutoHotkey v2.0\n\n; Hotkey Ctrl+Shift+K\n^+k:: {\n    MsgBox(${JSON.stringify(greeting)}, "KiwiIDE AutoHotkey")\n}\n\nTrayTip("AutoHotkey aktiv", "Drücke Strg+Umschalt+K für die Meldung")\n`;
  } else if (language === "odin") {
    files["main.odin"] = `package main\n\nimport "core:fmt"\n\nmain :: proc() {\n    fmt.println(${JSON.stringify(greeting)})\n}\n`;
    files["ols.json"] = `{\n  "$schema": "https://raw.githubusercontent.com/DanielGavin/ols/master/misc/ols.schema.json"\n}\n`;
  } else {
    const cmakeLanguage = { c: "C", cpp: "CXX", "objective-c": "OBJC", "objective-cpp": "OBJCXX" }[language];
    const main = PROJECT_LANGUAGES[language].main;
    files["CMakeLists.txt"] = `cmake_minimum_required(VERSION 3.20)\nproject(${packageName} LANGUAGES ${cmakeLanguage})\nset(CMAKE_EXPORT_COMPILE_COMMANDS ON)\nset(CMAKE_RUNTIME_OUTPUT_DIRECTORY "\u0024{CMAKE_BINARY_DIR}/bin")\nforeach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)\n  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_\u0024{config} "\u0024{CMAKE_BINARY_DIR}/bin")\nendforeach()\nadd_executable(kiwi_app ${main})\n`;
    if (language === "c" || language === "cpp") {
      files["Makefile"] = `CC ?= ${language === "cpp" ? "g++" : "gcc"}\nCFLAGS ?= -Wall -Wextra -O2\nTARGET = kiwi_app\n\nall: $(TARGET)\n\n$(TARGET): ${main}\n\t$(CC) $(CFLAGS) -o $@ $<\n\nclean:\n\trm -f $(TARGET)\n`;
    }
    if (sample) {
      files[main] = language === "cpp" || language === "objective-cpp"
        ? `#include <iostream>\n\nint main() {\n    std::cout << ${JSON.stringify(greeting)} << '\\n';\n    return 0;\n}\n`
        : `#include <stdio.h>\n\nint main(void) {\n    puts(${JSON.stringify(greeting)});\n    return 0;\n}\n`;
    }
    if (language.startsWith("objective-")) files["README.md"] += "\nObjective-C compilation needs a compiler with Objective-C support. Platform frameworks and runtimes are supplied by your SDK (for example Xcode or GNUstep).\n";
  }
  return files;
}

class PolyglotProjectService {
  constructor(guard, options = {}) {
    this.guard = guard;
    this.settings = options.settings;
    this.send = options.send || (() => undefined);
    this.spawnImpl = options.spawnImpl || spawn;
    this.terminate = options.terminateImpl || terminateProcessTree;
    this.toolchainRoot = options.toolchainRoot || "";
    this.running = new Map();
    this.nextOperation = 0;
  }

  detect(root, file = "") {
    root = this.guard.assertWorkspace(root);
    if (file) file = this.guard.assertAllowed(file, root);
    return detectPolyglotProject(root, file);
  }

  async create(spec) {
    const parent = this.guard.assertWorkspace(spec.location);
    const name = safeName(spec.name);
    const language = String(spec.language || "");
    if (!Object.hasOwn(PROJECT_LANGUAGES, language)) throw new Error("Diese Projektsprache wird nicht unterstützt.");
    const root = this.guard.assertAllowed(path.join(parent, name), parent);
    // mkdir without recursive reserves the root atomically: creation never
    // writes over an existing project, including two clicks in the same tick.
    await fsp.mkdir(root);
    const files = projectFiles(language, name, spec.sampleClass !== false, spec.template || "standard", spec);
    for (const [relative, content] of Object.entries(files)) {
      const file = this.guard.assertAllowed(path.join(root, relative), parent);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, content, { encoding: "utf8", flag: "wx" });
    }
    await fsp.mkdir(path.join(root, path.dirname(PROJECT_LANGUAGES[language].main)), { recursive: true });
    if (language === "php") await fsp.mkdir(path.join(root, "src"), { recursive: true });
    if (spec.initGit) {
      try {
        await spawnCapture("git", ["init", "-b", "main"], { cwd: root });
      } catch {
        try {
          await spawnCapture("git", ["init"], { cwd: root });
        } catch {}
      }
    }
    this.guard.register(root);
    await this.settings?.rememberWorkspace?.(root);
    const entryCandidate = files[PROJECT_LANGUAGES[language].main] !== undefined
      ? PROJECT_LANGUAGES[language].main
      : (spec.sampleClass === false ? "" : Object.keys(files).find((k) => /\.(py|rs|go|php|lua|c|cpp|cs|kt|ts|tsx|js|jsx)$/i.test(k) && !k.includes("test")) || PROJECT_LANGUAGES[language].main);
    const mainFile = spec.sampleClass === false ? "" : path.join(root, entryCandidate);
    return { root, type: PROJECT_LANGUAGES[language].name, language, mainFile };
  }

  async plan({ root, file = "", action = "run", language = "" }) {
    root = this.guard.assertWorkspace(root);
    if (file) file = this.guard.assertAllowed(file, root);
    const detected = this.detect(root, file);
    language = language || languageForFile(file) || detected?.language || "";
    if (!Object.hasOwn(PROJECT_LANGUAGES, language)) throw new Error("Für diese Datei ist keine ausführbare Sprache erkannt worden.");
    if (!["run", "build", "test", "clean", "debug"].includes(action)) throw new Error("Unbekannte Projektaktion.");
    const sources = sourceFiles(root).filter((candidate) => languageForFile(candidate) === language);
    const mainFile = (languageForFile(file) === language ? file : "") || (fs.existsSync(path.join(root, PROJECT_LANGUAGES[language].main)) ? path.join(root, PROJECT_LANGUAGES[language].main) : sources[0]);
    const outputRoot = this.guard.assertAllowed(path.join(root, ".kiwi", "build"), root);
    const steps = [];
    const add = (command, args, extra = {}) => steps.push({ command, args, cwd: root, ...extra });
    const has = (name) => fs.existsSync(path.join(root, name));
    const tool = (names) => findExecutable(names);
    let url;
    if (action === "clean" && (["python", "php", "lua", "kotlin", "c", "cpp", "objective-c", "objective-cpp", "dart", "zig", "swift", "ruby", "elixir", "r", "scala", "shell", "powershell", "perl", "gdscript", "sql", "terraform", "assembly", "autohotkey", "odin"].includes(language)
      || language === "rust" && !has("Cargo.toml") || language === "go" && !has("go.mod") && !has("go.work"))) {
      steps.push({ internal: "clean", path: outputRoot, cwd: root, command: "", args: [] });
    } else if (language === "python") {
      const interpreter = [path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"), path.join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")].find((candidate) => fs.existsSync(candidate));
      const command = interpreter || tool(process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"]);
      const env = { PYTHONPYCACHEPREFIX: path.join(outputRoot, "python-cache"), PYTHONUNBUFFERED: "1" };
      if (action === "test") add(command, ["-m", "unittest", "discover", ...(has("tests") ? ["-s", "tests"] : [])], { env });
      else if (action === "build") {
        if (!sources.length) throw new Error("Es wurde keine Python-Quelldatei gefunden.");
        add(command, ["-m", "compileall", "-f", "-q", ...(has("src") ? [path.join(root, "src")] : sources)], { env });
      }
      else if (action === "debug") {
        if (!mainFile) throw new Error("Es wurde keine Python-Quelldatei zum Debuggen gefunden.");
        add(command, ["-m", "pdb", mainFile], { env });
      }
      else if (mainFile) add(command, [mainFile], { env });
    } else if (language === "rust" && has("Cargo.toml")) add(tool(["cargo"]), [action === "run" ? "run" : action === "test" ? "test" : action === "clean" ? "clean" : "build"]);
    else if (language === "go") {
      if (has("go.mod") || has("go.work")) add(tool(["go"]), action === "run" ? ["run", "."] : [action === "test" ? "test" : action === "clean" ? "clean" : "build", "./..."]);
      else {
        const packageFiles = sources.filter((candidate) => (!mainFile || path.dirname(candidate) === path.dirname(mainFile)) && (action === "test" || !/_test\.go$/i.test(candidate)));
        if (!packageFiles.length) throw new Error("Es wurde keine Go-Quelldatei gefunden.");
        add(tool(["go"]), action === "build"
          ? ["build", "-o", path.join(outputRoot, "native", process.platform === "win32" ? "app.exe" : "app"), ...packageFiles]
          : [action === "test" ? "test" : "run", ...packageFiles]);
      }
    }
    else if (language === "csharp") {
      const csproj = fs.readdirSync(root).find((entry) => /\.csproj$/i.test(entry));
      if (!csproj) throw new Error("Für C# fehlt eine .csproj-Projektdatei.");
      add(tool(["dotnet"]), action === "run" ? ["run", "--project", path.join(root, csproj)] : [action, path.join(root, csproj)]);
    } else if (language === "php") {
      if (action === "run") { url = "http://127.0.0.1:8000"; add(tool(["php"]), ["-S", "127.0.0.1:8000", "-t", has("public") ? path.join(root, "public") : root]); }
      else if (action === "test") {
        const phpunit = path.join(root, "vendor", "bin", "phpunit");
        if (!fs.existsSync(phpunit)) throw new Error("Für PHP-Tests fehlt vendor/bin/phpunit. Installiere die Testabhängigkeiten des Projekts mit Composer.");
        add(tool(["php"]), [phpunit]);
      } else for (const source of sources) add(tool(["php"]), ["-l", source]);
    } else if (language === "lua") {
      if (action === "test") {
        if (!has("tests/main.lua")) throw new Error("Für Lua-Tests fehlt tests/main.lua.");
        add(tool(["lua"]), [path.join(root, "tests", "main.lua")]);
      } else if (action === "build") add(tool(["luac"]), ["-p", ...sources]);
      else if (mainFile) add(tool(["lua"]), [mainFile]);
    } else if (language === "kotlin" && (has("build.gradle.kts") || has("build.gradle"))) {
      const wrapper = path.join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew");
      const bundled = path.join(this.toolchainRoot, "gradle", "bin", process.platform === "win32" ? "gradle.bat" : "gradle");
      add(fs.existsSync(wrapper) ? wrapper : this.toolchainRoot && fs.existsSync(bundled) ? bundled : tool(["gradle"]), [action]);
    } else if (language === "kotlin") {
      if (action === "test") throw new Error("Für Kotlin-Tests wird ein Gradle-Projekt benötigt.");
      if (/\.kts$/i.test(mainFile || "")) {
        if (action !== "run") throw new Error("Kotlin-Skripte werden mit Ausführen gestartet. Für eine Build- oder Testaufgabe wird ein Gradle-Projekt benötigt.");
        add(tool(process.platform === "win32" ? ["kotlinc.bat", "kotlinc"] : ["kotlinc"]), ["-script", mainFile]);
      }
      else {
        const jar = path.join(outputRoot, "kotlin", "app.jar");
        const kotlinSources = sources.filter((candidate) => /\.kt$/i.test(candidate));
        if (!kotlinSources.length) throw new Error("Es wurde keine Kotlin-Quelldatei gefunden.");
        add(tool(process.platform === "win32" ? ["kotlinc.bat", "kotlinc"] : ["kotlinc"]), [...kotlinSources, "-include-runtime", "-d", jar]);
        if (action === "run") add(tool(["java"]), ["-jar", jar]);
      }
    } else if (["c", "cpp", "objective-c", "objective-cpp"].includes(language) && has("CMakeLists.txt")) {
      const build = path.join(outputRoot, "cmake");
      add(tool(["cmake"]), ["-S", root, "-B", build, "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"]);
      add(tool(["cmake"]), ["--build", build, "--config", "Debug"]);
      if (action === "test") add(tool(["ctest"]), ["--test-dir", build, "-C", "Debug", "--output-on-failure"]);
      else if (action === "run") {
        // A generated starter has an explicit runtime-output directory. For
        // imported CMake projects discover the executable after the build.
        steps.push({ internal: "runNative", path: build, cwd: root, command: "", args: [] });
      }
    } else if (["c", "cpp", "objective-c", "objective-cpp", "rust"].includes(language)) {
      if (!mainFile) throw new Error("Es wurde keine Quelldatei gefunden.");
      if (action === "test") throw new Error("Für Tests dieser Sprache wird eine passende Projektdatei benötigt.");
      const executable = path.join(outputRoot, "native", process.platform === "win32" ? "app.exe" : "app");
      const compiler = language === "rust" ? tool(["rustc"]) : language === "cpp" ? tool(["clang++", "g++", "c++"]) : language === "objective-cpp" ? tool(["clang++"]) : language === "objective-c" ? tool(["clang"]) : tool(["clang", "gcc", "cc"]);
      const argumentsForCompiler = language === "rust" ? [mainFile, "-o", executable] : [...(language.startsWith("objective-") ? ["-x", language === "objective-c" ? "objective-c" : "objective-c++"] : []), mainFile, "-o", executable];
      add(compiler, argumentsForCompiler);
      if (action === "run") add(executable, []);
    } else if (language === "typescript" || language === "javascript" || language === "node") {
      const npm = tool(process.platform === "win32" ? ["npm.cmd", "npm"] : ["npm"]);
      const node = tool(process.platform === "win32" ? ["node.exe", "node"] : ["node"]);
      const npx = tool(process.platform === "win32" ? ["npx.cmd", "npx"] : ["npx"]);

      let pkg = null;
      if (has("package.json")) {
        try {
          pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        } catch {}
      }
      const scripts = pkg?.scripts || {};

      if (action === "clean") {
        steps.push({ internal: "clean", path: path.join(outputRoot, "dist"), cwd: root, command: "", args: [] });
      } else if (action === "test") {
        if (scripts.test) {
          add(npm, ["test"]);
        } else {
          add(node, ["--test"]);
        }
      } else if (action === "build") {
        if (scripts.build) {
          add(npm, ["run", "build"]);
        } else if (has("tsconfig.json")) {
          add(npx, ["tsc", "--noEmit"]);
        } else {
          for (const source of sources.slice(0, 50)) {
            add(node, ["--check", source]);
          }
        }
      } else if (action === "run") {
        if (scripts.dev) {
          add(npm, ["run", "dev"]);
        } else if (scripts.start) {
          add(npm, ["start"]);
        } else if (language === "typescript") {
          if (mainFile) {
            add(npx, ["tsx", mainFile]);
          } else {
            add(npm, ["start"]);
          }
        } else if (mainFile) {
          add(node, [mainFile]);
        } else {
          add(node, ["index.js"]);
        }
      } else if (action === "debug") {
        if (language === "typescript") {
          if (mainFile) {
            add(npx, ["tsx", "--inspect=0", mainFile]);
          } else {
            add(npx, ["tsx", "--inspect=0", "src/index.ts"]);
          }
        } else if (mainFile) {
          add(node, ["--inspect=0", mainFile]);
        } else {
          add(node, ["--inspect=0", "index.js"]);
        }
      }
    } else if (language === "dart") {
      const dart = tool(process.platform === "win32" ? ["dart.bat", "dart.exe", "dart"] : ["dart"]);
      if (action === "test") {
        add(dart, ["test"]);
      } else if (action === "build") {
        if (mainFile) {
          const exe = path.join(outputRoot, "dart", process.platform === "win32" ? "app.exe" : "app");
          add(dart, ["compile", "exe", mainFile, "-o", exe]);
        } else {
          add(dart, ["analyze"]);
        }
      } else if (action === "debug") {
        add(dart, ["run", "--observe", ...(mainFile ? [mainFile] : [])]);
      } else {
        add(dart, ["run", ...(mainFile ? [mainFile] : [])]);
      }
    } else if (language === "zig") {
      const zig = tool(["zig"]);
      if (has("build.zig")) {
        if (action === "test") add(zig, ["build", "test"]);
        else if (action === "build") add(zig, ["build"]);
        else add(zig, ["build", "run"]);
      } else {
        if (!mainFile) throw new Error("Es wurde keine Zig-Quelldatei gefunden.");
        if (action === "test") add(zig, ["test", mainFile]);
        else if (action === "build") {
          const exe = path.join(outputRoot, "native", process.platform === "win32" ? "app.exe" : "app");
          add(zig, ["build-exe", mainFile, `-femit-bin=${exe}`]);
        } else add(zig, ["run", mainFile]);
      }
    } else if (language === "swift") {
      const swift = tool(["swift"]);
      if (has("Package.swift")) {
        if (action === "test") add(swift, ["test"]);
        else if (action === "build") add(swift, ["build"]);
        else add(swift, ["run"]);
      } else {
        if (!mainFile) throw new Error("Es wurde keine Swift-Quelldatei gefunden.");
        if (action === "test") add(swift, ["test"]);
        else if (action === "build") {
          const swiftc = tool(["swiftc"]);
          const exe = path.join(outputRoot, "native", process.platform === "win32" ? "app.exe" : "app");
          add(swiftc, [mainFile, "-o", exe]);
        } else add(swift, [mainFile]);
      }
    } else if (language === "ruby") {
      const ruby = tool(process.platform === "win32" ? ["ruby.exe", "ruby"] : ["ruby"]);
      const bundle = tool(process.platform === "win32" ? ["bundle.bat", "bundle"] : ["bundle"]);
      if (action === "test") {
        if (has("Gemfile")) add(bundle, ["exec", "rake", "test"]);
        else if (has("test/test_main.rb")) add(ruby, [path.join(root, "test", "test_main.rb")]);
        else if (mainFile) add(ruby, ["-r", "minitest/autorun", mainFile]);
      } else if (action === "build") {
        if (!mainFile) throw new Error("Es wurde keine Ruby-Quelldatei gefunden.");
        add(ruby, ["-c", mainFile]);
      } else if (action === "debug") {
        if (!mainFile) throw new Error("Es wurde keine Ruby-Quelldatei gefunden.");
        add(ruby, ["-r", "debug", mainFile]);
      } else {
        if (!mainFile) throw new Error("Es wurde keine Ruby-Quelldatei gefunden.");
        add(ruby, [mainFile]);
      }
    } else if (language === "elixir") {
      const elixir = tool(process.platform === "win32" ? ["elixir.bat", "elixir"] : ["elixir"]);
      const mix = tool(process.platform === "win32" ? ["mix.bat", "mix"] : ["mix"]);
      if (has("mix.exs")) {
        if (action === "test") add(mix, ["test"]);
        else if (action === "build") add(mix, ["compile"]);
        else add(mix, ["run"]);
      } else {
        if (!mainFile) throw new Error("Es wurde keine Elixir-Quelldatei gefunden.");
        add(elixir, [mainFile]);
      }
    } else if (language === "r") {
      const rscript = tool(process.platform === "win32" ? ["Rscript.exe", "Rscript"] : ["Rscript"]);
      if (!mainFile) throw new Error("Es wurde keine R-Quelldatei gefunden.");
      if (action === "build") add(rscript, ["-e", `parse(file=${JSON.stringify(mainFile)})`]);
      else add(rscript, [mainFile]);
    } else if (language === "scala") {
      const sbt = tool(process.platform === "win32" ? ["sbt.bat", "sbt"] : ["sbt"]);
      const scalaCli = tool(process.platform === "win32" ? ["scala-cli.bat", "scala-cli.exe", "scala-cli", "scala.bat", "scala"] : ["scala-cli", "scala"]);
      if (has("build.sbt")) {
        if (action === "test") add(sbt, ["test"]);
        else if (action === "build") add(sbt, ["compile"]);
        else add(sbt, ["run"]);
      } else {
        if (!mainFile) throw new Error("Es wurde keine Scala-Quelldatei gefunden.");
        if (action === "test") add(scalaCli, ["test", mainFile]);
        else if (action === "build") add(scalaCli, ["compile", mainFile]);
        else add(scalaCli, ["run", mainFile]);
      }
    } else if (language === "shell") {
      const bash = tool(process.platform === "win32" ? ["bash.exe", "sh.exe", "bash", "sh"] : ["bash", "sh"]);
      if (!mainFile) throw new Error("Es wurde keine Shell-Skriptdatei gefunden.");
      if (action === "build") add(bash, ["-n", mainFile]);
      else add(bash, [mainFile]);
    } else if (language === "powershell") {
      const pwsh = tool(process.platform === "win32" ? ["powershell.exe", "pwsh.exe", "powershell", "pwsh"] : ["pwsh", "powershell"]);
      if (!mainFile) throw new Error("Es wurde keine PowerShell-Skriptdatei gefunden.");
      if (action === "build") add(pwsh, ["-NoProfile", "-Command", `& { $err = $null; [System.Management.Automation.Language.Parser]::ParseFile('${mainFile.replace(/'/g, "''")}', [ref]$null, [ref]$err); if ($err) { $err | ForEach-Object { Write-Error $_.Message }; exit 1 } }`]);
      else add(pwsh, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mainFile]);
    } else if (language === "perl") {
      const perl = tool(process.platform === "win32" ? ["perl.exe", "perl"] : ["perl"]);
      const prove = tool(process.platform === "win32" ? ["prove.bat", "prove"] : ["prove"]);
      if (action === "test") {
        if (has("t")) add(prove, ["-l", "t"]);
        else if (mainFile) add(perl, [mainFile]);
      } else if (action === "build") {
        if (!mainFile) throw new Error("Es wurde keine Perl-Quelldatei gefunden.");
        add(perl, ["-c", mainFile]);
      } else if (action === "debug") {
        if (!mainFile) throw new Error("Es wurde keine Perl-Quelldatei gefunden.");
        add(perl, ["-d", mainFile]);
      } else {
        if (!mainFile) throw new Error("Es wurde keine Perl-Quelldatei gefunden.");
        add(perl, [mainFile]);
      }
    } else if (language === "gdscript") {
      const godot = tool(process.platform === "win32" ? ["godot.exe", "godot_console.exe", "godot"] : ["godot", "godot4"]);
      if (action === "build") {
        if (mainFile) add(godot, ["--headless", "--check-only", "-s", mainFile]);
        else add(godot, ["--headless", "--check-only"]);
      } else if (action === "test") {
        if (mainFile) add(godot, ["--headless", "-s", mainFile]);
        else add(godot, ["--headless"]);
      } else {
        if (mainFile) add(godot, ["--headless", "-s", mainFile]);
        else add(godot, ["--headless"]);
      }
    } else if (language === "sql") {
      const sqlite = tool(process.platform === "win32" ? ["sqlite3.exe", "sqlite3"] : ["sqlite3"]);
      if (!mainFile) throw new Error("Es wurde keine SQL-Datei gefunden.");
      add(sqlite, [":memory:", "-init", mainFile, ".exit"]);
    } else if (language === "terraform") {
      const terraform = tool(process.platform === "win32" ? ["terraform.exe", "terraform"] : ["terraform"]);
      if (action === "test") add(terraform, ["test"]);
      else if (action === "build") add(terraform, ["validate"]);
      else add(terraform, ["plan"]);
    } else if (language === "assembly") {
      const nasm = tool(process.platform === "win32" ? ["nasm.exe", "nasm"] : ["nasm"]);
      if (!mainFile) throw new Error("Es wurde keine Assembler-Datei gefunden.");
      const format = process.platform === "win32" ? "win64" : process.platform === "darwin" ? "macho64" : "elf64";
      const obj = path.join(outputRoot, "native", "app.obj");
      add(nasm, ["-f", format, mainFile, "-o", obj]);
    } else if (language === "autohotkey") {
      const ahk = tool(process.platform === "win32" ? ["AutoHotkey64.exe", "AutoHotkey.exe", "AutoHotkey32.exe"] : ["autohotkey"]);
      if (!mainFile) throw new Error("Es wurde keine AutoHotkey-Datei gefunden.");
      if (action === "build") add(ahk, ["/validate", mainFile]);
      else add(ahk, [mainFile]);
    } else if (language === "odin") {
      const odin = tool(process.platform === "win32" ? ["odin.exe", "odin"] : ["odin"]);
      if (action === "test") add(odin, ["test", "."]);
      else if (action === "build") add(odin, ["build", "."]);
      else add(odin, ["run", mainFile || "."]);
    }
    if (!steps.length) throw new Error("Es wurde keine passende Quelldatei zum Ausführen oder Bauen gefunden.");
    return { root, language, action, steps, ...(url ? { url } : {}) };
  }

  async execute(payload) {
    const root = this.guard.assertWorkspace(payload.root);
    if (this.running.has(root)) throw new Error("Für dieses Projekt läuft bereits ein Prozess.");
    const operationId = `polyglot-${++this.nextOperation}`;
    const operation = { root, operationId, action: payload.action || "run", child: null, stopped: false };
    this.running.set(root, operation);
    try {
      const plan = await this.plan(payload);
      if (operation.stopped) return { started: false, root, language: plan.language, action: plan.action, operationId };
      const build = this.guard.assertAllowed(path.join(root, ".kiwi", "build"), root);
      await fsp.mkdir(path.join(build, "native"), { recursive: true });
      await fsp.mkdir(path.join(build, "kotlin"), { recursive: true });
      if (plan.url) this.output(operation, `Webserver: ${plan.url}\n`, "stdout");
      void this.runPlan(operation, plan).catch((error) => {
        this.output(operation, `${error.message || error}\n`, "stderr");
        this.finish(operation, 1);
      });
      return { started: true, root, language: plan.language, action: plan.action, operationId, command: plan.steps[0].command, ...(plan.url ? { url: plan.url } : {}) };
    } catch (error) {
      this.running.delete(root);
      throw error;
    }
  }

  output(operation, text, stream) {
    this.send("polyglot:output", { root: operation.root, text, stream, action: operation.action, operationId: operation.operationId });
  }

  finish(operation, code) {
    if (this.running.get(operation.root) !== operation) return;
    this.running.delete(operation.root);
    this.send("polyglot:exit", { root: operation.root, code, action: operation.action, operationId: operation.operationId });
  }

  async runPlan(operation, plan) {
    let code = 0;
    for (const step of plan.steps) {
      if (operation.stopped) { code = 1; break; }
      if (step.internal === "clean") {
        const managed = this.guard.assertAllowed(path.join(plan.root, ".kiwi", "build"), plan.root);
        if (path.resolve(step.path) !== path.resolve(managed)) throw new Error("Ungültiger Build-Ausgabepfad.");
        await fsp.rm(managed, { recursive: true, force: true });
        this.output(operation, "Build-Ausgabe bereinigt.\n", "stdout");
        continue;
      }
      if (step.internal === "runNative") {
        const executable = this.nativeExecutable(step.path);
        code = await this.runProcess(operation, { command: executable, args: [], cwd: plan.root });
      } else code = await this.runProcess(operation, step);
      if (code !== 0) break;
    }
    this.finish(operation, code);
  }

  nativeExecutable(build) {
    const extension = process.platform === "win32" ? ".exe" : "";
    const standard = path.join(build, "bin", `kiwi_app${extension}`);
    if (fs.existsSync(standard)) return standard;
    const candidates = [];
    const visit = (directory, depth) => {
      if (depth > 3) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "CMakeFiles" || entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file, depth + 1);
        else if (entry.isFile() && (process.platform === "win32" ? /\.exe$/i.test(file) : !path.extname(file) && Boolean(fs.statSync(file).mode & 0o111))) candidates.push(file);
      }
    };
    visit(build, 0);
    if (candidates.length !== 1) throw new Error("Das CMake-Projekt erzeugt kein eindeutig ausführbares Ziel. Starte das gewünschte Ziel über das Terminal.");
    return candidates[0];
  }

  runProcess(operation, step) {
    this.guard.assertAllowed(step.cwd, operation.root);
    this.output(operation, `> ${step.command} ${step.args.map((argument) => /\s/.test(argument) ? JSON.stringify(argument) : argument).join(" ")}\n`, "stdout");
    return new Promise((resolve) => {
      const prepared = prepareCommand(step.command, step.args);
      let child;
      try {
        child = this.spawnImpl(prepared.command, prepared.args, { cwd: step.cwd, env: step.env ? { ...process.env, ...step.env } : process.env, shell: false, windowsHide: true, windowsVerbatimArguments: prepared.verbatim });
      } catch (error) {
        this.output(operation, `${error.message || error}\n`, "stderr");
        resolve(1);
        return;
      }
      operation.child = child;
      child.stdout?.on("data", (data) => this.output(operation, data.toString(), "stdout"));
      child.stderr?.on("data", (data) => {
        const text = data.toString();
        this.output(operation, text, "stderr");
        const match = text.match(/Debugger listening on (ws:\/\/[^\s\r\n]+)/);
        if (match) {
          const ws = match[1];
          const devtools = `devtools://devtools/bundled/js_app.html?ws=${ws.replace(/^ws:\/\//, "")}`;
          this.output(operation, `\n💡 Chrome DevTools Debug-Link:\n   ${devtools}\n\n`, "stdout");
        }
      });
      child.once("error", (error) => {
        this.output(operation, `${error.code === "ENOENT" ? `Compiler oder Interpreter nicht gefunden: ${step.command}. Installiere das Werkzeug oder ergänze seinen Ordner in PATH.` : error.message}\n`, "stderr");
        resolve(1);
      });
      child.once("close", (code, signal) => {
        operation.child = null;
        resolve(operation.stopped || signal || typeof code !== "number" ? 1 : code);
      });
      child.stdin?.end();
    });
  }

  async stop(root) {
    if (root) root = this.guard.assertWorkspace(root);
    const operations = root ? [this.running.get(root)].filter(Boolean) : [...this.running.values()];
    await Promise.all(operations.map(async (operation) => {
      operation.stopped = true;
      if (operation.child) await this.terminate(operation.child);
      else this.finish(operation, 1);
    }));
    return operations.length > 0;
  }
}

module.exports = { PolyglotProjectService, PROJECT_LANGUAGES, detectPolyglotProject, languageForFile, projectFiles, findExecutable };
