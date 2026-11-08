# Kiwi IDE

Kiwi ist eine mehrsprachige Desktop-IDE für Windows, Linux und macOS: Java, Kotlin,
Python, Rust, PHP mit Webentwicklung, Lua, Go sowie C, C++, C# und
Objective-C/Objective-C++. Die Kiwi-Oberfläche kombiniert Monaco,
Sprachserver, Build-/Run-Werkzeuge, den Java-Debugger, Git und
projektisolierte Terminals.

## Funktionsumfang

- Spracherkennung, Syntaxfarben, sprachspezifische Vorlagen und
  Autovervollständigung für alle unterstützten Programmiersprachen;
  konfigurierte Sprachserver ergänzen typabhängige Vorschläge, Diagnosen,
  Hover und Navigation. HTML, CSS, JavaScript und TypeScript besitzen
  integrierte Monaco-Sprachdienste
- Projektassistent und Run-/Build-Aktionen für alle angebotenen Sprachen;
  Compiler, Interpreter und zusätzliche Sprachserver werden separat erkannt
  oder konfiguriert. Die unterstützten Werkzeuge und Grenzen stehen in
  [docs/hybrid-languages.md](docs/hybrid-languages.md)
- Java-Sprachintelligenz über Eclipse JDT LS 1.60.0: Completion, Hover/Javadoc,
  Diagnostics, Definitionen, Referenzen, Rename, Quick Fixes, Formatierung,
  Organize Imports und Symbole; Call-/Type-Hierarchien sind rekursiv
  aufklappbar und Find Usages gruppiert Treffer nach Package und Datei
- semantische Member-Completion für eigene Klassen (`objekt.`/`Klasse.`),
  Maven-/Gradle-Abhängigkeiten und lokale JARs unter `lib`/`libs`; dazu
  Basic/Smart Completion, Camel-Hump-Ranking, Auto-Imports, Live Templates und
  Postfix-Templates
- sichtbare und abbrechbare Maven-/Gradle-Synchronisierung sowie Java-
  Indexierung nach Änderungen an Build-Dateien, JARs und Modulmetadaten
- Lombok-/Annotation-Processor-Unterstützung, generierte Sources, lokale JARs
  und automatisch importierte Maven-/Gradle-Classpaths
- Codegenerierung für Konstruktoren, Getter/Setter, `equals`/`hashCode` und
  `toString`, direkt über `Alt+Enter` und die Command Palette
- JDT-Diagnosen mit ausführbaren Quick-Fixes in Hover und `Alt+Enter`, darunter
  fehlende Imports und das Erzeugen noch nicht implementierter Methoden
- Java-Typ-Assistent für Klassen, Interfaces, Enums, Records, Annotationen und
  JUnit-Tests mit Modifier, Basisklasse und implementierten Interfaces
- refactoring-sicheres Explorer-Rename mit fester Dateiendung und automatischer
  Anpassung der öffentlichen Java-Typdeklaration
- Projekt-Hub und Projekt-Switcher mit genau einem aktiven Explorer-Projekt;
  Projekte behalten getrennte Tabs, Terminals und Run-Konfigurationen
- Maven-/Gradle-/Plain-Java-Module mit SDK-/Language-Level-Overrides,
  JPMS-Descriptoren, Abhängigkeitsgraph und atomaren Änderungen ohne
  vorgeschaltetes Prüffenster
- Projektassistent für Plain Java, Maven und Gradle einschließlich JDK-Auswahl,
  Source-/Teststruktur, Build-Datei, `.gitignore` und Beispielcode
- Run-Konfigurationen für Java Application, JUnit, Maven Goal und Gradle Task
- eigener JDI/JDWP-Debug-Adapter mit bedingten und Exception-Breakpoints,
  Threads, Objekt-/Collection-/Array-Bäumen, Watches, Inline-Werten,
  Hot Code Replace und JFR-/Speicher-/Thread-Profilern
- JUnit-Test-Explorer mit Live-Fortschritt, Modul-/Package-/Klassenbaum,
  verschachtelten, parametrisierten und dynamischen Tests sowie
  Package-/Klassen-/Methoden-Coverage
- Maven-/Gradle-Toolfenster mit Wrapper-Priorität, Tasks, Modulen und
  navigierbarem Dependency Tree, Konfliktmarkierungen, Sources und Javadocs;
  seltene Aktionen liegen in kompakten Hamburger-Menüs
- integrierter Dependency-Editor zum Hinzufügen, Entfernen und Aktualisieren;
  unterstützt Maven `dependencyManagement`, Properties, Gradle Groovy/Kotlin
  sowie `libs.versions.toml` und benannte Gradle-Versionskataloge
- Git-Workflow mit Status, Diff, Stage/Unstage, Commit, Branches, Historie,
  Pull, Push, Stash, visuellem interaktivem Rebase, Pull-Request-Ansicht,
  zeilenweisem Drei-Wege-Merge und Datei-/Zeilenhistorie
- projektweite Suche mit Replace Preview, Go to File, Go to Symbol,
  Dateiwatcher, Session-Wiederherstellung und Editor-Splits
- persistentes Terminal mit PowerShell unter Windows und der Benutzershell
  unter Linux und macOS, mit ANSI/Truecolor, roher
  Tastatureingabe, `Ctrl+C`, interaktiven Programmen, Resize und getrennten
  Sitzungen; jede Sitzung kann in ein eigenes Kiwi-Fenster verschoben werden
- Problems, Build, Run, Debug, Tests und Terminal lassen sich pro Projekt
  getrennt unten, unten links, unten rechts, links oder rechts andocken; die
  Kanten sind gleichzeitig sichtbar, haben je eigene Tabs und eigene Größen
  (wie in IntelliJ). Am Griff wandert das ganze Fenster mit allen Tabs, an
  einem Tab nur dieser eine. Die Abwurfzone ist dabei genau der Streifen, den
  die Vorschau aufleuchten lässt, damit ein Loslassen im markierten Bereich
  auch dort ankommt. Ein Werkzeugfenster allein in einer unteren Ecke bleibt
  auch dort und nimmt die halbe Reihe ein, statt sich über die ganze Breite zu
  ziehen; teilen sich zwei die Reihe, füllen sie sie gemeinsam
- an einer Seite angedockt führt ein Werkzeugfenster eine eigene Kopfzeile mit
  Symbol und Namen des aktiven Werkzeugs; Griff und Bedienelemente liegen dort
  statt in der Tabreihe, und mit nur einem Werkzeug an dieser Kante entfällt
  die Tabreihe ganz
- ein Fallenlassen in der Mitte nimmt das Werkzeugfenster aus der Werkbank
  heraus und öffnet es als eigenständiges Kiwi-Fenster — wie die Einstellungen
  ein Fenster des Betriebssystems und damit auf einen zweiten Monitor
  verschiebbar; es zeigt dieselben Tabs und wirkt auf dieselbe Sitzung, weil
  die Werkbank die alleinige Quelle bleibt und jeder Klick dorthin zurückgeht.
  Solange es draußen läuft, gibt die Werkbank den Platz ganz frei; beim
  Schließen kehrt jeder Tab an seine vorherige Kante zurück. Wer das Fenster
  lieber über der Werkbank schweben lässt, wählt das in der Andock-Auswahl
- `//region Name` bis `//endregion` gliedert eine Java-Datei: der Bereich ist
  faltbar, die Markerzeile trägt eine Linie, einen Balken in der Randspalte und
  den Namen am Zeilenende. Beide gebräuchlichen Schreibweisen werden gelesen,
  Regionen lassen sich schachteln, und eine nie geschlossene faltet trotzdem —
  wird aber als solche gekennzeichnet
- die gewählte Akzentfarbe trägt die gesamte Oberfläche: Knöpfe, Fokus,
  Fortschritt, aktive Zustände. Die Schrift auf farbigen Flächen richtet sich
  nach der Helligkeit der Farbe, damit sie auch bei sehr dunklen oder sehr
  hellen Akzenten lesbar bleibt; Grün mit eigener Bedeutung — hinzugefügte und
  gestagte Git-Zeilen, Abdeckung, bestandene Tests — bleibt davon unberührt
- ein Theme lässt sich nachjustieren: Rundung der Ecken von kantig bis deutlich
  runder, Helligkeit nach oben oder unten und eine leichte Tönung zur
  Akzentfarbe. Flächen und Schrift wandern gegenläufig, damit der Kontrast
  erhalten bleibt. Die Rundung gilt für die gesamte IDE — jedes Kiwi-Fenster
  und auch die Popups des Editors. Dazu kommen die Stärke der Trennlinien, die
  Tiefe der Schatten unter Menüs und Dialogen sowie eine eigene Schrift für die
  Bedienoberfläche
- an einer Seite angedockt zeigt ein Werkzeugfenster Symbol und Namen in seiner
  Kopfzeile; Aktionen und Schließen stehen daneben, alles Weitere liegt im
  Menü, damit der Name auch bei schmaler Kante lesbar bleibt
- angedockt zieht ein Werkzeugfenster in eine Spalte, die es schon gibt: links
  zum Explorer, rechts zum Build-Werkzeug. Es teilt sich deren Breite und
  besitzt darin nur seine Höhe, statt eine zweite schmale Spalte neben dem
  Editor aufzumachen und ihm die Breite zu nehmen
- die Oberfläche spricht elf Sprachen — Deutsch, Englisch, Französisch,
  Spanisch, Italienisch, Niederländisch, Polnisch, Portugiesisch, Ungarisch,
  Türkisch und Russisch —, und zwar in jedem Fenster: auch in den
  Einstellungen, der Projektstruktur und einem abgetrennten Terminal. Was in
  einer Sprache noch fehlt, erscheint auf Englisch statt auf Deutsch
- ein Java-Laufzeitpaket lässt sich aus der IDE heraus holen: die Liste kommt
  von Eclipse Adoptium, der Download wird beim Schreiben per SHA-256 geprüft
  und ein Paket ohne Prüfsumme gar nicht erst geladen
- beschädigte Artefakte in den geteilten Maven- und Gradle-Caches werden
  erkannt und in Quarantäne verschoben statt gelöscht — ein abgeschnittenes
  Jar dort überlebt sonst jede projektlokale Reparatur
- die Editorfarben liegen in ihren sieben Familien: eine Familie nimmt oben
  eine Farbe für alle ihre Token an, jedes einzelne Token lässt sich davon
  abweichend setzen, und beides ist getrennt zurücksetzbar
- „Ansicht zurücksetzen“ stellt die Standardansicht in einem Schritt wieder her:
  alle Werkzeugfenster zurück nach unten in die Mitte, Standardgrößen für
  Seitenleiste und Panel, kein Fokusmodus — und abgetrennte Werkzeug- und
  Terminalfenster kehren in die Werkbank zurück, ohne ihre laufenden Sitzungen
  zu beenden. Erreichbar über die Statusleiste („Standardansicht“), das
  Überlaufmenü der Werkzeugleiste und die Command Palette
- Git-Teil-Stage einzelner Diff-Hunks oder ausgewählter geänderter Zeilen und
  Commit-Prüfungen vor dem Commit
- Search Everywhere, Command Palette, zuletzt verwendete Dateien, Favoriten,
  Bookmarks, Scratch-Dateien und benannte Workspaces
- projektweite Undo-Checkpoints und lokale Datei-Historie für Refactorings,
  Verschieben, Umbenennen, Löschen und Quick Fixes
- JaCoCo-Abdeckung im Editor, automatisches Wiederholen fehlgeschlagener Tests,
  Debug-Inlinewerte und Watches aus dem Editor-Kontextmenü
- Projektvorlagen für Java, CLI/Picocli, Spring Boot und JavaFX sowie
  Dependency-Update-, Unused- und Security-Prüfungen
- flaches Kiwi Dark und eine vollständige High-Contrast-Variante mit dem neuen,
  transparenten Kiwi-Logo
- links/rechts andockbare Build-Toolfenster, speicherbare Workbench-Layouts,
  Browser-Virtualisierung großer Explorer-Bäume und dauerhaft gespeicherte
  Start-, Lade-, Indexierungs- und RAM-Metriken

Dateizugriffe der Renderer-API sind auf den registrierten Projektordner
beschränkt. Git verwendet weiterhin den systemweiten Credential Manager. Ein
optional in Kiwi eingegebenes GitHub-Token wird ausschließlich verschlüsselt
über Electrons `safeStorage` im Benutzerprofil abgelegt, nie im
Repository oder in dessen Git-Konfiguration. Für den Browser-Device-Flow kann
beim Start `KIWI_GITHUB_CLIENT_ID` auf die Client-ID einer eigenen GitHub OAuth
App gesetzt werden; ohne diese Konfiguration bleibt die Token-Anmeldung aktiv.

## Voraussetzungen

- Windows (x64), Linux (x64 oder ARM64) oder macOS (Intel oder Apple Silicon)
- Node.js 20 oder neuer für die Entwicklung
- JDK 21 oder neuer für JDT LS, Builds und Debugging

Projekt- und Modul-SDKs dürfen Java 8, 11, 17 oder 21–25 verwenden. Nur der
separat gestartete JDT Language Server benötigt Java 21 oder neuer.

Maven 3.9.16, Gradle 9.6.1 und JDT LS 1.60.0 werden für die Desktop-Pakete
gebündelt. Externe Projektabhängigkeiten benötigen Internetzugang oder einen
vorhandenen lokalen Cache.

## Entwicklung

```powershell
npm install
npm run fetch:toolchain
npm run dev
```

## CodeToGetter-Relay

Das Relay wird als eigenständige ausführbare Java-21-JAR gebaut. Auf dem
Zielserver sind Node.js und npm nicht erforderlich:

```powershell
npm run relay:build
java -jar .\resources\codetogether-relay\kiwi-codetogether-relay.jar --host 0.0.0.0 --port 8787
```

Zum Bauen und direkten Starten aus diesem Repository genügt `npm run relay`.
Ausführliche Hinweise stehen in [docs/codetogether-relay.md](docs/codetogether-relay.md).

## Qualitätssicherung

```powershell
npm test
npm run test:jdtls
npm run test:debug
npm run test:projects
npm run test:e2e
npm run test:update
npm run test:relay
npm run test:performance
npm run build
npm audit --omit=dev
```

## Linux- und macOS-Pakete

Erstelle das Paket auf dem jeweiligen Betriebssystem mit Node.js für die
gewünschte Architektur. Für native Node-Module benötigt Linux bei Bedarf
Python 3, Make und einen C++-Compiler, macOS die Xcode Command Line Tools.

- Linux: `npm run dist:linux` erstellt ein AppImage in `release/`. Mach es vor dem Start mit `chmod +x <Datei>.AppImage` ausführbar.
- macOS: `npm run dist:mac` erstellt ein DMG in `release/`. Für die öffentliche Verteilung sind eine Developer-ID-Signatur und die Apple-Notarisierung einzurichten.

## Updates über GitHub Releases

Gepackte Kiwi-Versionen prüfen standardmäßig die [GitHub Releases von Kiwi IDE](https://github.com/KIWI-IDE/KiwiIDE/releases).
Unter **Einstellungen → Allgemein → Jetzt prüfen** lässt sich die Suche jederzeit
starten. Stable berücksichtigt reguläre Releases, Beta und Canary auch Vorabversionen.
Kiwi prüft die Dateigröße und den von GitHub gelieferten SHA-256-Wert vor der
Installation. Unter Windows startet Kiwi nach deiner Bestätigung das Setup oder
aktualisiert die portable EXE. Unter Linux und macOS zeigt Kiwi das heruntergeladene
AppImage oder DMG im Dateimanager an.

Für ein Update veröffentliche einen Release mit einem Versions-Tag wie `v1.0.1`
und hänge die unveränderten Build-Dateien direkt an den Release. Die Version im
Dateinamen muss zum Tag passen. Für `v1.0.1` sind das diese Dateien.

- Windows: `Kiwi-IDE-1.0.1-setup.exe` und `Kiwi-IDE-1.0.1-portable.exe`
- Linux: `Kiwi-IDE-1.0.1-x86_64.AppImage` und `Kiwi-IDE-1.0.1-arm64.AppImage`
- macOS: `Kiwi-IDE-1.0.1-x64.dmg` und `Kiwi-IDE-1.0.1-arm64.dmg`

Eine eigene HTTPS-Manifest-Adresse hat unter Windows Vorrang.

## Windows-Pakete

```powershell
npm run dist:win
```

Der Build erzeugt `release/Kiwi-IDE-<version>-portable.exe` und
`release/Kiwi-IDE-<version>-setup.exe`. Ohne Zertifikat bleiben beide Dateien
absichtlich unsigniert. Für einen signierten Release-Build müssen
`KIWI_WINDOWS_CERT_PFX`, `KIWI_WINDOWS_CERT_PASSWORD` und
`KIWI_SIGNTOOL_PATH` gesetzt sein. Mit `KIWI_REQUIRE_SIGNING=1` schlägt der
Build fehl, falls keine verifizierte Authenticode-Signatur erzeugt werden kann.

Für einen eigenen Windows-Update-Server erzeugt Kiwi ein Manifest unter
`release/latest.json` und kanalbezogen unter `release/manifests/<kanal>/latest.json`.
Dafür braucht der Build die öffentliche HTTPS-Adresse des Servers.

```powershell
$env:KIWI_UPDATE_PUBLIC_BASE_URL = "https://updates.meine-domain.de"
npm run release:manifest
```

Der mitgelieferte, eigenständige Java-21-Update-Server erzwingt direktes TLS oder
einen explizit konfigurierten lokalen HTTPS-Reverse-Proxy. Releases werden mit
`npm run release:publish` authentifiziert, streamend und atomisch in den
Stable- oder Beta-Kanal veröffentlicht. ETags, HEAD und Range-Downloads werden
unterstützt. Kiwi lädt ausschließlich HTTPS-Updates und prüft Installer vor
dem Start zwingend anhand von SHA-256 und Dateigröße. Betrifft ein Release nur
die Oberfläche, lädt Kiwi statt des Installers ein kleines, geprüftes
Renderer-Paket, übernimmt es im laufenden Programm und lädt die Fenster neu:
Terminal, Sprachserver und Debugger laufen weiter, es wird nichts neu
gestartet. Ein solches Paket wird ausschließlich auf genau den Hauptprozess
angewendet, gegen den es gebaut wurde. Nur wenn sich das Programm selbst
geändert hat, läuft der Installerweg — automatische Updates
speichern dann den Workspace, installieren still und öffnen Kiwi samt Tabs selbst
wieder; ein manueller Neustart ist auch dabei nicht erforderlich. Ein externer Watchdog
prüft den Installer nochmals auf Datenträger, startet Kiwi nach Erfolg und
öffnet bei einem Installationsfehler automatisch die bisherige Version mit dem
gesicherten Workspace. Die vollständige
Einrichtung steht in [docs/update-server.md](docs/update-server.md).

Die Toolchain-Archive werden anhand der festgeschriebenen Hersteller-Checksummen
verifiziert. Lizenztexte liegen im Paket unter `resources/toolchain`.
