#!/bin/sh
# Richtet den Kiwi Update Server auf einem Linux-Server ein.
#
# Ohne --systemd wird nur installiert und konfiguriert; erst --systemd legt
# einen Dienst an, der den Neustart der Maschine ueberlebt.
#
#   sudo ./install.sh --install-dir /opt/kiwi-update-server --systemd
set -eu

INSTALL_DIR="/opt/kiwi-update-server"
SERVICE_USER="kiwi-update"
JAR_SOURCE="$(cd "$(dirname "$0")" && pwd)/kiwi-update-server.jar"
REGISTER_SYSTEMD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --jar) JAR_SOURCE="$2"; shift 2 ;;
    --systemd) REGISTER_SYSTEMD=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

JAVA="${JAVA_HOME:+$JAVA_HOME/bin/java}"
[ -x "${JAVA:-}" ] || JAVA="$(command -v java || true)"
[ -n "$JAVA" ] || { echo "Java wurde nicht gefunden. Installiere ein JDK 21 oder neuer." >&2; exit 1; }

# Die Versionszeile geht nach stderr.
VERSION_TEXT="$("$JAVA" -version 2>&1 | head -n 1)"
MAJOR="$(printf '%s' "$VERSION_TEXT" | sed -n 's/.*version "\([0-9]*\).*/\1/p')"
[ -n "$MAJOR" ] && [ "$MAJOR" -ge 21 ] || {
  echo "Der Update-Server benoetigt Java 21 oder neuer, gefunden wurde: $VERSION_TEXT" >&2
  exit 1
}
echo "Java: $JAVA ($VERSION_TEXT)"

[ -f "$JAR_SOURCE" ] || { echo "kiwi-update-server.jar wurde nicht gefunden: $JAR_SOURCE" >&2; exit 1; }

mkdir -p "$INSTALL_DIR"
install -m 0644 "$JAR_SOURCE" "$INSTALL_DIR/kiwi-update-server.jar"
echo "JAR installiert: $INSTALL_DIR"

CONFIG_FILE="$INSTALL_DIR/kiwi-update-server.properties"
if [ -f "$CONFIG_FILE" ]; then
  # Die Datei enthaelt den Publishing-Token. Ein Update darf sie nie ersetzen.
  echo "Konfiguration bleibt unveraendert: $CONFIG_FILE"
else
  (cd "$INSTALL_DIR" && "$JAVA" -jar kiwi-update-server.jar --init)
fi

if [ "$REGISTER_SYSTEMD" -eq 1 ]; then
  [ "$(id -u)" -eq 0 ] || { echo "--systemd benoetigt root." >&2; exit 1; }
  id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  chown -R "$SERVICE_USER" "$INSTALL_DIR"
  chmod 0600 "$CONFIG_FILE"

  cat > /etc/systemd/system/kiwi-update-server.service <<UNIT
[Unit]
Description=Kiwi Update Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$JAVA -jar $INSTALL_DIR/kiwi-update-server.jar
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR
# Nur noetig, wenn der Server selbst auf Port 443 lauscht.
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable kiwi-update-server.service
  echo "Dienst eingerichtet. Starten mit: systemctl start kiwi-update-server"
fi

echo
echo "Naechster Schritt: $CONFIG_FILE oeffnen und KIWI_UPDATE_PUBLIC_BASE_URL sowie TLS eintragen."
echo "Danach starten:  $JAVA -jar $INSTALL_DIR/kiwi-update-server.jar"
