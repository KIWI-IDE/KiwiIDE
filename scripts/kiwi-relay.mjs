import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRelayServer } = require("../electron/services/collab-relay-service.cjs");

/**
 * The CodeToGetter relay, as a program you can run anywhere reachable.
 *
 * Start it on a machine both developers can dial out to — a small VPS, a root
 * server, the same box that already serves Kiwi's updates. Neither side then
 * needs anything opened on their own router, because both of them are making
 * outgoing connections, which routers let through without being asked.
 *
 *   node scripts/kiwi-relay.mjs --port 8787
 *
 * What it can see: that two machines are connected, roughly how much they are
 * sending, and a room identifier. What it cannot see: anything of the project.
 * The session is encrypted end to end with keys both ends derive from the
 * invite, and the invite never reaches the relay — the room it matches on is an
 * HMAC of it. That is worth knowing in both directions: a relay you do not
 * control cannot read your source, and a relay you do control does not give you
 * a way to read anybody else's.
 *
 * It keeps no state on disk and nothing between restarts. A restart drops every
 * session; the sessions themselves say so and can be started again.
 */

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const port = Number(argument("port", process.env.KIWI_RELAY_PORT || 8787));
const host = argument("host", process.env.KIWI_RELAY_HOST || "0.0.0.0");
const quiet = process.argv.includes("--quiet");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write(`Kein gültiger Port: ${argument("port", "")}\n`);
  process.exit(1);
}

const relay = createRelayServer({
  maxRooms: Number(process.env.KIWI_RELAY_MAX_ROOMS || 200),
  // The log says what happened and never what was said. A relay that logged
  // payloads would undo the one guarantee it is able to make.
  log: quiet ? undefined : (event, room) => {
    process.stdout.write(`${new Date().toISOString()} ${event} ${room.slice(0, 8)}… (${relay.rooms} Räume)\n`);
  },
});

const stop = async (signal) => {
  process.stdout.write(`\n${signal}: Relay wird beendet.\n`);
  await relay.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

relay.listen(port, host).then((actual) => {
  process.stdout.write(`Kiwi CodeToGetter-Relay lauscht auf ${host}:${actual}.\n`);
  process.stdout.write("Trage diese Adresse in Kiwi unter CODETOGETTER als Relay ein.\n");
}).catch((error) => {
  process.stderr.write(`Das Relay konnte nicht starten: ${error.message}\n`);
  process.exit(1);
});
