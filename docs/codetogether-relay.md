# CodeToGetter Relay als ausführbare JAR

Das CodeToGetter-Relay läuft als eigenständige Java-21-Anwendung. Auf dem
Server werden weder Node.js noch npm benötigt. Das Projekt selbst bleibt beim
Host; das Relay vermittelt nur die Ende-zu-Ende-verschlüsselte Verbindung.

## JAR bauen

Auf dem Entwicklungsrechner wird ein **JDK 21 oder neuer** benötigt. `JAVA_HOME`
kann auf dieses JDK zeigen; alternativ müssen `javac` und `jar` über `PATH`
erreichbar sein.

```powershell
npm run relay:build
```

Das Ergebnis liegt hier:

```text
resources/codetogether-relay/kiwi-codetogether-relay.jar
```

Für ein kleines, direkt kopierbares Serverpaket:

```powershell
npm run relay:package
```

Es wird unter `release/kiwi-codetogether-relay/` mit der JAR und einer kurzen
Startanleitung abgelegt.

Der Build verwendet feste Archiv-Zeitstempel und eine stabile Reihenfolge der
Klassen. Gleiche Quellen und dieselbe JDK-Version erzeugen dadurch dieselbe
JAR-Datei.

## Relay starten

Die JAR kann auf einen öffentlich erreichbaren Server kopiert und direkt
gestartet werden:

```powershell
java -jar kiwi-codetogether-relay.jar --host 0.0.0.0 --port 8787
```

Beim Start direkt aus dem Kiwi-Quellprojekt genügt:

```powershell
npm run relay -- --host 0.0.0.0 --port 8787
```

Ohne Argumente lauscht das Relay auf `0.0.0.0:8787`. Der TCP-Port muss in der
Firewall beziehungsweise Sicherheitsgruppe des Servers freigegeben sein.

Die optionalen Umgebungsvariablen sind:

- `KIWI_RELAY_HOST` – Bind-Adresse
- `KIWI_RELAY_PORT` – TCP-Port
- `KIWI_RELAY_MAX_ROOMS` – maximale Zahl gleichzeitig gehosteter Räume

`--host` und `--port` haben Vorrang vor den Umgebungsvariablen. Mit `--quiet`
werden Verbindungsereignisse nicht ausgegeben.

Das Relay speichert weder Projekte noch Sitzungen auf der Festplatte. Ein
Neustart trennt deshalb aktive Sitzungen. Einladungscodes bleiben geheim und
werden nicht auf dem Relay eingegeben.
