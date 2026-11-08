# Kiwi Update Server

Der produktive Update-Server läuft vollständig auf **Java 21** und benötigt zur
Laufzeit weder Node.js noch npm. `npm` wird im Entwicklungsprojekt lediglich zum
Kompilieren/Starten und für den kompatiblen Release-Publisher verwendet. Der
Server verwendet ausschließlich APIs aus dem JDK und wird als eigenständige
`resources/update-server/kiwi-update-server.jar` gebaut.

Der Update-Server veröffentlicht unveränderliche Windows-Installer und portable
EXEs in getrennten `stable`- und `beta`-Kanälen. Clients laden zuerst ein kleines
Manifest und verwenden ausschließlich das darin per SHA-256 und Dateigröße
gebundene Paket ihrer Laufzeit. Ein Renderer kann keine eigene Download-Adresse zur Installation
einschleusen: Der Electron-Hauptprozess akzeptiert nur das Ergebnis seiner
unmittelbar vorherigen Manifestprüfung.

## Der kurze Weg

Auf dem Zielrechner wird nur **Java 21 oder neuer** gebraucht — kein Node.js,
kein npm, keine weiteren Pakete.

Auf dem Build-Rechner:

```powershell
npm run update:server:package
```

Das legt `release/kiwi-update-server/` an: das JAR, ein Installationsskript je
Plattform und eine Kurzanleitung. Dieses Verzeichnis auf den Server kopieren
und dort einmal ausführen:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir C:\KiwiUpdateServer -RegisterService
```

```bash
sudo ./install.sh --install-dir /opt/kiwi-update-server --systemd
```

Der Installer prüft die Java-Version, legt das Verzeichnis an und erzeugt
`kiwi-update-server.properties` mit einem **frisch gewürfelten
Publishing-Token**. Eine bereits vorhandene Konfiguration wird nie
überschrieben — ein Update darf den Token nicht ungültig machen.

Danach sind genau zwei Zeilen einzutragen: die öffentliche Adresse und das
TLS-Zertifikat. Gestartet wird ohne jede Umgebungsvariable:

```powershell
java -jar kiwi-update-server.jar
```

Ohne Installer geht dasselbe von Hand:

```powershell
java -jar kiwi-update-server.jar --init    # schreibt die Konfiguration
java -jar kiwi-update-server.jar --help    # erklärt die Aufrufe
```

Gelesen wird `kiwi-update-server.properties` neben dem JAR oder im
Arbeitsverzeichnis; `KIWI_UPDATE_CONFIG` benennt eine andere Datei. Jede
Einstellung heißt in der Datei genauso wie ihre Umgebungsvariable, und die
Umgebung hat Vorrang — eine leere Variable zählt dabei nicht als Wert und kann
die Datei nicht aushebeln.

Die Konfigurationsdatei enthält den Publishing-Token. Sie gehört weder in ein
Repository noch in eine unverschlüsselte Sicherung; unter Linux setzt der
Installer sie auf `0600`.

## Produktionsbetrieb mit direktem TLS

Voraussetzungen sind eine eigene DNS-Adresse, ein gültiges öffentlich
vertrauenswürdiges TLS-Zertifikat und ein zufälliger Publishing-Token mit
mindestens 32 Byte. Zertifikat und privater Schlüssel gehören nicht ins
Repository.

```powershell
$env:KIWI_UPDATE_PUBLIC_BASE_URL = "https://updates.meine-domain.de"
$env:KIWI_UPDATE_HOST = "0.0.0.0"
$env:KIWI_UPDATE_PORT = "443"
$env:KIWI_UPDATE_STORAGE_DIR = "D:\KiwiUpdates"
$env:KIWI_UPDATE_TLS_CERT = "D:\KiwiSecrets\fullchain.pem"
$env:KIWI_UPDATE_TLS_KEY = "D:\KiwiSecrets\privkey.pem"
$env:KIWI_UPDATE_PUBLISH_TOKEN = "<zufälliger geheimer Token mit mindestens 32 Byte>"
npm run update:server
```

`KIWI_UPDATE_TLS_KEY` muss ein unverschlüsselter PKCS#8-PEM-Schlüssel sein
(`BEGIN PRIVATE KEY`). Alternativ kann direkt ein PKCS#12-Keystore verwendet
werden:

```powershell
$env:KIWI_UPDATE_PUBLIC_BASE_URL = "https://updates.meine-domain.de"
$env:KIWI_UPDATE_HOST = "0.0.0.0"
$env:KIWI_UPDATE_PORT = "443"
$env:KIWI_UPDATE_STORAGE_DIR = "D:\KiwiUpdates"
$env:KIWI_UPDATE_TLS_KEYSTORE = "D:\KiwiSecrets\updates.p12"
$env:KIWI_UPDATE_TLS_KEYSTORE_PASSWORD = "<Passwort aus dem Secret Store>"
$env:KIWI_UPDATE_PUBLISH_TOKEN = "<zufälliger geheimer Token mit mindestens 32 Byte>"
npm run update:server
```

Für einen Zielserver ohne Node.js wird das JAR auf dem Build-System mit
`npm run update:server:build` erzeugt und anschließend zusammen mit der
Konfiguration übertragen:

```powershell
java -jar .\kiwi-update-server.jar
```

Der Prozess beendet sich absichtlich, wenn weder TLS noch ein explizit
konfigurierter HTTPS-Reverse-Proxy vorhanden ist. Für Caddy, nginx oder IIS:

```powershell
$env:KIWI_UPDATE_PUBLIC_BASE_URL = "https://updates.meine-domain.de"
$env:KIWI_UPDATE_HOST = "127.0.0.1"
$env:KIWI_UPDATE_PORT = "8787"
$env:KIWI_UPDATE_BEHIND_HTTPS_PROXY = "1"
$env:KIWI_UPDATE_STORAGE_DIR = "D:\KiwiUpdates"
$env:KIWI_UPDATE_PUBLISH_TOKEN = "<geheimer Token>"
npm run update:server
```

Im Proxy-Modus erzwingt Kiwi eine Loopback-Bindung. Der Proxy muss HTTPS
terminieren und darf den internen Port nicht öffentlich freigeben. Für lokale
Tests existiert `KIWI_UPDATE_ALLOW_HTTP=1`; diese Option darf nicht in einer
Produktionsumgebung verwendet werden.

Zusätzliche Servereinstellung: `KIWI_UPDATE_WORKERS` begrenzt die Anzahl der
parallelen Java-Worker (Standard: mindestens vier, höchstens die Zahl der
Prozessorkerne). `KIWI_UPDATE_MAX_BYTES` begrenzt Uploads zusätzlich zur
Content-Length-Prüfung.

Der Serverprozess sollte unter einem eigenen, nicht administrativen Konto
laufen. Nur dieses Konto benötigt Schreibzugriff auf `KIWI_UPDATE_STORAGE_DIR`.
Der TLS-Schlüssel und der Publishing-Token benötigen separate, eingeschränkte
Datei-/Secret-Berechtigungen.

## Release veröffentlichen

Die Versionsnummer in `package.json` ist die Standardversion. Nach Build und
Authenticode-Signatur lädt der Publisher zuerst die portable EXE und danach den
Installer streamend hoch. Der portable Upload ist nur eine unveröffentlichte
Stufe. Erst der vollständig geprüfte Setup-Upload schaltet `latest` atomisch auf
die neue Version um. Dateigröße und SHA-256 werden serverseitig für beide
Pakete erneut geprüft. Release Notes werden im Publishing-Aufruf auf 4.000
Zeichen begrenzt, damit sie sicher innerhalb üblicher Proxy-Headerlimits bleiben.

```powershell
$env:KIWI_UPDATE_SERVER_URL = "https://updates.meine-domain.de"
$env:KIWI_UPDATE_PUBLISH_TOKEN = "<derselbe geheime Token>"
$env:KIWI_UPDATE_CHANNEL = "stable"
$env:KIWI_RELEASE_NOTES_FILE = ".\release-notes\0.5.0.md"
npm run release:publish
```

Alternativ lassen sich Werte explizit übergeben:

```powershell
npm run release:publish -- --version 0.5.0 --channel beta --artifact .\release\Kiwi-IDE-0.5.0-setup.exe --portable .\release\Kiwi-IDE-0.5.0-portable.exe
```

Ein Setup-only-Release bleibt für verwaltete Installationen und ältere Clients
möglich, muss aber ausdrücklich mit `--allow-setup-only` oder
`KIWI_ALLOW_SETUP_ONLY=1` freigegeben werden. Portable Kiwi-Clients fallen nicht
automatisch auf den Setup-Installer zurück.

Das Schema-3-Manifest enthält beide Laufzeitpakete unter
`artifacts.setup|portable = {filename,url,sha256,bytes}`. Die bisherigen
Top-Level-Felder `url`, `sha256` und `bytes` zeigen weiterhin auf Setup, sodass
Schema-1/2-Clients kompatibel bleiben. Bei einem expliziten Setup-only-Release
fehlt lediglich `artifacts.portable`.

## Updates ohne Neustart

`npm run release:renderer` erzeugt zusätzlich `Kiwi-IDE-<version>-renderer.kiwi`
— ein signaturgeprüftes Archiv des gebauten Renderers von rund zwei Megabyte
statt eines Installers von mehreren hundert. Der Publisher lädt es als weitere
Stufe hoch (`PUT /v1/admin/releases/<channel>/<version>/renderer`), und das
Manifest weist es als `artifacts.renderer = {filename,url,sha256,bytes,mainHash}`
aus.

`mainHash` ist der Fingerabdruck des Hauptprozesses, gegen den das Paket gebaut
wurde: alle `electron/**/*.cjs`, die Electron-Version und die Laufzeitabhängig-
keiten. Der Server liest ihn aus der hochgeladenen Datei selbst, nicht aus einem
Header. Ein Client wendet ein Renderer-Paket ausschließlich an, wenn dieser Wert
mit seinem eigenen Hauptprozess exakt übereinstimmt; sonst nimmt er weiterhin
Setup beziehungsweise Portable. Damit kann eine Oberfläche niemals auf eine
Preload- oder IPC-Version treffen, zu der sie nicht gehört.

Beim Anwenden sichert Kiwi die Sitzung, entpackt das Paket nach
`userData/renderer/<version>-<hash>` und lädt nur die Fenster neu. Terminal,
Sprachserver, Build und Debugger laufen dabei weiter. Lädt der neue Renderer
nicht, wird er verworfen und der mitgelieferte wieder geladen. Ein späterer
vollständiger Installer setzt sich automatisch durch, weil ein angewendetes
Paket nur gilt, solange es neuer als die installierte Version ist.

Vorabversionen wie `0.5.0-beta.1` sind nur im Beta-Kanal zulässig. Bereits
veröffentlichte oder ältere Versionen werden nicht überschrieben. Ein bewusstes
Rollback kann nur durch einen Serverneustart mit
`KIWI_UPDATE_ALLOW_DOWNGRADE=1` veröffentlicht werden und sollte anschließend
sofort wieder deaktiviert werden.

Für rein statisches Hosting erzeugt `npm run release:manifest` zusätzlich ein
Manifest. Dabei ist `KIWI_UPDATE_PUBLIC_BASE_URL` zwingend; eine
Platzhalter-Domain wird nicht mehr erzeugt. Auch hier muss ein fehlendes
Portable-Paket ausdrücklich mit `KIWI_ALLOW_SETUP_ONLY=1` erlaubt werden.

## Client konfigurieren

In Kiwi unter **Einstellungen → Updates** wird diese URL eingetragen:

```text
https://updates.meine-domain.de/latest.json
```

Kiwi ergänzt den ausgewählten Kanal als Query-Parameter. Direkte Endpunkte sind:

- `GET /latest.json?channel=stable`
- `GET /v1/updates/stable/latest.json`
- `GET /v1/releases/stable/<version>/<setup-or-portable-artifact>`
- `GET /v1/releases/stable` (verfügbare Versionen)
- `GET /healthz`
- `PUT /v1/admin/releases/<channel>/<version>` (Bearer-Token erforderlich)
- `PUT /v1/admin/releases/<channel>/<version>/portable` (staged nur die portable EXE)
- `PUT /v1/admin/releases/<channel>/<version>/renderer` (staged nur das Renderer-Paket)

Vor der Installation schreibt Kiwi alle offenen Entwürfe und den Fensterzustand
synchron in eine verifizierte Recovery-Datei. Setup und Portable verwenden
anschließend einen unabhängigen PowerShell-Watchdog. Er prüft Größe und SHA-256
nochmals direkt vom Datenträger und öffnet nach Erfolg automatisch die neue
Version. Schlägt die Installation oder der atomare Portable-Austausch fehl,
wird die bisherige EXE mit demselben Workspace wieder gestartet. Diagnose-Logs
liegen im Electron-`userData` unter `updates/setup-update.log` beziehungsweise
`updates/portable-update.log`.

Manifest-Antworten sind nicht cachebar; versionierte Installer sind immutable
und unterstützen ETag, `HEAD` und Byte-Range-Downloads. Der Server liefert
keine Verzeichnisinhalte oder frei wählbaren Dateipfade aus.

## Betrieb und Wiederherstellung

- `update-storage/releases` und `update-storage/channels` regelmäßig sichern.
- Portable zuerst und Setup zuletzt veröffentlichen; das Manifest wird erst
  nach vollständigem Hash-Abgleich des Setup-Pakets gewechselt.
- Health-Checks ausschließlich gegen `/healthz` ausführen.
- Publishing-Token regelmäßig rotieren und niemals in Shell-History, Logs oder
  Commit-Dateien schreiben.
- Nach Zertifikatserneuerung den Prozess kontrolliert neu starten.
- Mit `npm run test:update` wird das Java-JAR neu gebaut und anschließend ein
  echter Java-Prozess geprüft: direktes TLS, Reverse-Proxy-Schutz, Publishing,
  Kanalregeln, Authentifizierung, atomare Konkurrenzfälle, Pfadschutz,
  Hashprüfung, ETag, HEAD und Range-Downloads.
