# Sprachen in Kiwi IDE

Kiwi öffnet gemischte Projekte und erkennt die Sprache jeder Datei. Die
vorhandene Java-Unterstützung mit JDT LS bleibt bestehen. Der Projektassistent
bietet zusätzlich Kotlin, Python, Rust, PHP, Lua, Go und die C-Sprachen an.

Syntaxfarben, Schlüsselwörter, Vorlagen und Vorschläge aus der bearbeiteten Datei
sind ohne zusätzliche Sprachserver verfügbar. Für typabhängige Vorschläge,
Bibliothekswissen, Diagnosen, Hover und Navigation benötigt die jeweilige
Sprache einen laufenden Sprachserver. Das ist in den Einstellungen erkennbar;
ein fehlender Server wird als fehlend angezeigt.

| Sprache | Typische Dateien | Build und Ausführen | Sprachdienst |
| --- | --- | --- | --- |
| Java | `.java` | Javac, Maven, Gradle; vorhandene Java-Projektvorlagen | JDT LS, vorhandene gebündelte Integration |
| Kotlin | `.kt`, `.kts` | Kotlin-Compiler und Java; bestehende Gradle-Projekte verwenden ihren Wrapper oder Gradle | Kotlin Language Server; eigener Serverbefehl konfigurierbar |
| Python | `.py`, `.pyw` | Python 3; lokale `.venv` oder `venv` wird bevorzugt | Pyright |
| Rust | `.rs`, `Cargo.toml` | Cargo für Projekte; `rustc` für einzelne Dateien | rust-analyzer |
| PHP | `.php`, `.phtml` | PHP; lokaler Webserver, Syntaxprüfung mit `php -l` | Intelephense |
| Lua | `.lua` | `lua`; Syntaxprüfung mit `luac -p` | Lua Language Server |
| Go | `.go`, `go.mod` | Go-Paketbefehle; einzelne Dateien auch ohne Modul | gopls |
| C | `.c`, `.h` | CMake und C-Compiler; einzelne Quelldateien mit Clang/GCC | clangd |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` | CMake und C++-Compiler; einzelne Quelldateien mit Clang++/G++ | clangd |
| C# | `.cs`, `.csproj` | .NET SDK; neue Starter zielen auf .NET 10 LTS | csharp-ls |
| Objective-C | `.m` | CMake oder Clang mit passendem Objective-C-SDK | clangd |
| Objective-C++ | `.mm` | CMake oder Clang++ mit passendem SDK | clangd |
| Webdateien | HTML, CSS/SCSS/Less, JavaScript/JSX, TypeScript/TSX, JSON | Im selben Projekt bearbeitbar; Start über das PHP-Projekt oder projektspezifische Werkzeuge | Integrierte Monaco-Sprachdienste |

## Sprachserver einrichten

Unter **Einstellungen → Sprachen & Sprachserver** zeigt Kiwi die gefundenen
Programme an. Ein leerer Programmpfad verwendet die automatische Erkennung.
Ein eigener Programmpfad und einzelne Argumente pro Zeile überschreiben diese
Erkennung. Mit **Übernehmen** werden geänderte Einstellungen aktiviert.

Für Python und PHP kann **Für Kiwi installieren** den jeweiligen Server im
Kiwi-Benutzerprofil installieren. Dafür muss Node.js mit npm verfügbar sein.
Diese Installation liefert den Sprachserver; sie installiert keinen
Python- oder PHP-Interpreter. Andere Server lassen sich über ihre offiziellen
Installationswege beziehen und anschließend über PATH oder einen vollständigen
Programmpfad verwenden. Nach einer Änderung des Windows-PATH Kiwi neu starten
oder den Programmpfad direkt eintragen.

| Server | Standardprogramm und Argumente | Offizielle Anleitung |
| --- | --- | --- |
| Kotlin Language Server | `kotlin-language-server` | [Projekt und Installation](https://github.com/fwcd/kotlin-language-server#installation) |
| Pyright | `pyright-langserver --stdio` | [Installation](https://github.com/microsoft/pyright#installation) |
| rust-analyzer | `rust-analyzer` | [Installation](https://rust-analyzer.github.io/book/installation.html) |
| Intelephense | `intelephense --stdio` | [Installation](https://github.com/bmewburn/intelephense-docs/blob/master/installation.md) |
| Lua Language Server | `lua-language-server` | [Verwendung](https://luals.github.io/wiki/usage/) |
| gopls | `gopls` | [gopls](https://go.dev/gopls/) |
| clangd | `clangd --background-index` | [Installation](https://clangd.llvm.org/installation) |
| csharp-ls | `csharp-ls` | [Projekt und Voraussetzungen](https://github.com/razzmatazz/csharp-language-server#quick-start) |

## Projekte ausführen und bauen

**Neues Projekt** enthält eine Sprachauswahl. Java behält seine bestehenden
Build-Systeme und Vorlagen. Andere Sprachen erhalten passende Projektdateien
und auf Wunsch eine Startdatei. Eine kleine Datei `.kiwi/language.json`
speichert die Projektsprache. Importierte Projekte werden außerdem anhand von
Dateien wie `Cargo.toml`, `go.mod`, `composer.json`, `pyproject.toml`, einer
`.csproj` oder `CMakeLists.txt` erkannt. Ein Nicht-Java-Projekt benötigt zum
Öffnen kein JDK.

Die Aktionen **Ausführen**, **Projekt bauen**, **Tests ausführen** und
**Prozess beenden** verwenden die passende Toolchain. Ein gemischtes Projekt
kann beispielsweise eine Python-Datei neben Java-Dateien enthalten; die aktive
Quelldatei bestimmt dann das Werkzeug. Eine geöffnete README wird nicht als
Programm gestartet. Ausgabe und Fehler erscheinen in den vorhandenen
Werkzeugfenstern. Fehlende Compiler oder Interpreter erzeugen eine konkrete
Fehlermeldung.

- Python verwendet beim Bauen `compileall`, beim Testen `unittest discover`.
  Neue Bytecode-Dateien landen unter `.kiwi/build/python-cache`.
- Rust-Projekte verwenden Cargo; Go-Projekte verwenden `go run`, `go build`
  und `go test`. Vorhandene Abhängigkeiten und Projektkonfigurationen gelten
  weiter.
- PHP startet ausschließlich auf `127.0.0.1:8000` und verwendet `public/` als
  Webwurzel, sofern der Ordner vorhanden ist. Das ist ein lokaler
  Entwicklungsserver. PHP-Tests benötigen ein projektspezifisch installiertes
  `vendor/bin/phpunit`.
- Kotlin-Starter verwenden `kotlinc` und Java. Kotlin-Skripte werden nur mit
  **Ausführen** gestartet; für Build-/Testaufgaben eines Skripts wird ein
  Gradle-Projekt benötigt. Kotlin-Tests verwenden die vorhandene
  Gradle-Konfiguration.
- CMake-Starter schreiben Build-Dateien und `compile_commands.json` nach
  `.kiwi/build/cmake`. Für vollständige Include- und Compilerinformationen
  muss das Projekt zunächst konfiguriert/gebaut werden. Bei einer eigenen
  Build-Struktur muss clangd die passende Kompilierdatenbank finden; sie kann
  mit `--compile-commands-dir=...` angegeben werden.
- Neue C#-Projekte benötigen ein .NET-10-SDK oder neuer. Bestehende Projekte
  behalten ihr eigenes Target Framework.

## Aktuelle Grenzen

Der integrierte Debugger, JUnit-Testbaum, Java-Refactorings, Javadoc und die
Maven-/Gradle-Dependency-Oberflächen bleiben Java-Funktionen. Für andere
Sprachen gibt es Build/Run und Sprachdienste; passende native Debugadapter
sind noch nicht integriert.

Compiler, Interpreter, Plattform-SDKs und die meisten zusätzlichen
Sprachserver sind nicht Teil des Kiwi-Installers. PHP benötigt PHP, Rust die
Rust-Toolchain, Go die Go-Toolchain und native C-Projekte einen C-/C++-Compiler
und gegebenenfalls CMake. Objective-C/Objective-C++ benötigen außerdem ein
passendes SDK beziehungsweise Runtime und Frameworks; Apple-Frameworks stehen
unter Windows nicht automatisch zur Verfügung.

## Referenzen zu Build-Werkzeugen

- [Kotlin-Kommandozeilencompiler](https://kotlinlang.org/docs/command-line.html)
- [Python compileall](https://docs.python.org/3/library/compileall.html)
- [Cargo: erste Schritte](https://doc.rust-lang.org/cargo/getting-started/first-steps.html)
- [PHP-Entwicklungsserver](https://www.php.net/commandline.webserver)
- [Lua-Compiler](https://www.lua.org/manual/5.5/luac.html)
- [Go: Einstieg](https://go.dev/doc/tutorial/getting-started)
- [CMake-Kommandozeile](https://cmake.org/cmake/help/latest/manual/cmake.1.html)
- [Clang und die C-Sprachfamilie](https://clang.llvm.org/docs/UsersManual.html)
- [.NET-Kommandozeilenwerkzeuge](https://learn.microsoft.com/en-us/dotnet/core/tools/)
