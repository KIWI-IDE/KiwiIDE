package dev.kiwi.relay;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Dependency-free CodeToGetter relay for Java 21.
 *
 * <p>The server deliberately understands only the small rendezvous protocol.
 * Once a host-data connection is paired with a guest, encrypted session bytes
 * are copied unchanged in both directions. Project files, invite tokens and
 * encryption keys therefore never reach this process.</p>
 */
public final class KiwiRelayServer implements AutoCloseable {
    private static final int RELAY_VERSION = 1;
    private static final int ROOM_HEX_LENGTH = 32;
    private static final int MAX_GREETING_BYTES = 2_048;
    private static final long DEFAULT_WAIT_MILLIS = 20_000L;

    private final String host;
    private final int port;
    private final int maxRooms;
    private final boolean quiet;
    private final long waitMillis;
    private final ConcurrentHashMap<String, Room> rooms = new ConcurrentHashMap<>();
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private final AtomicLong nextTicket = new AtomicLong(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
        Thread.ofPlatform().daemon().name("kiwi-relay-timeouts").factory()
    );
    private final CountDownLatch stopped = new CountDownLatch(1);
    private volatile ServerSocket serverSocket;

    private KiwiRelayServer(String host, int port, int maxRooms, boolean quiet, long waitMillis) {
        this.host = host;
        this.port = port;
        this.maxRooms = maxRooms;
        this.quiet = quiet;
        this.waitMillis = waitMillis;
    }

    public static void main(String[] args) {
        final Options options;
        try {
            options = Options.parse(args, System.getenv());
        } catch (IllegalArgumentException error) {
            System.err.println(error.getMessage());
            System.err.println("Nutze --help für die verfügbaren Optionen.");
            System.exit(2);
            return;
        }

        if (options.help()) {
            printHelp();
            return;
        }

        var relay = new KiwiRelayServer(
            options.host(), options.port(), options.maxRooms(), options.quiet(), DEFAULT_WAIT_MILLIS
        );
        Runtime.getRuntime().addShutdownHook(Thread.ofPlatform().name("kiwi-relay-shutdown").unstarted(() -> {
            try {
                relay.close();
            } catch (Exception ignored) {
                // The operating system is already shutting down.
            }
        }));

        try {
            int actualPort = relay.start();
            System.out.printf("Kiwi CodeToGetter-Relay lauscht auf %s:%d.%n", options.host(), actualPort);
            System.out.println("Trage diese Adresse in Kiwi unter CODETOGETTER als Relay ein.");
            relay.await();
        } catch (IOException error) {
            System.err.println("Das Relay konnte nicht starten: " + safeMessage(error));
            try {
                relay.close();
            } catch (Exception ignored) {
                // Preserve the useful startup error.
            }
            System.exit(1);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            try {
                relay.close();
            } catch (Exception ignored) {
                // Interruption is already the reason for leaving.
            }
        }
    }

    private static void printHelp() {
        System.out.println("""
            Kiwi CodeToGetter Relay (Java 21+)

            Start:
              java -jar kiwi-codetogether-relay.jar [Optionen]

            Optionen:
              --host <Adresse>  Bind-Adresse (Standard: KIWI_RELAY_HOST oder 0.0.0.0)
              --port <Port>     TCP-Port (Standard: KIWI_RELAY_PORT oder 8787)
              --quiet           Verbindungsereignisse nicht protokollieren
              --help            Diese Hilfe anzeigen

            Umgebung:
              KIWI_RELAY_HOST, KIWI_RELAY_PORT, KIWI_RELAY_MAX_ROOMS
            """);
    }

    /** Starts accepting connections and returns the actual bound port. */
    public int start() throws IOException {
        if (serverSocket != null) throw new IllegalStateException("Das Relay läuft bereits.");
        var server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(host, port));
        serverSocket = server;
        Thread.ofVirtual().name("kiwi-relay-accept").start(() -> acceptLoop(server));
        return server.getLocalPort();
    }

    private void acceptLoop(ServerSocket server) {
        while (!closed.get()) {
            try {
                Socket socket = server.accept();
                socket.setTcpNoDelay(true);
                sockets.add(socket);
                Thread.ofVirtual().name("kiwi-relay-client").start(() -> receiveGreeting(socket));
            } catch (IOException error) {
                if (!closed.get()) {
                    System.err.println("Relay-Verbindung konnte nicht angenommen werden: " + safeMessage(error));
                }
                break;
            }
        }
    }

    private void receiveGreeting(Socket socket) {
        try {
            Greeting greeting = Greeting.read(socket.getInputStream());
            switch (greeting.role()) {
                case "host" -> registerHost(socket, greeting.room());
                case "guest" -> registerGuest(socket, greeting.room());
                case "host-data" -> joinHostData(socket, greeting.room(), greeting.id());
                default -> refuse(socket, "Unbekannte Rolle am Relay.");
            }
        } catch (ProtocolException error) {
            refuse(socket, error.getMessage());
        } catch (IOException error) {
            closeSocket(socket);
        }
    }

    private void registerHost(Socket control, String roomId) throws IOException {
        Room room = new Room(roomId, control);
        synchronized (rooms) {
            if (rooms.containsKey(roomId)) {
                refuse(control, "Für diesen Raum ist bereits ein Gastgeber verbunden.");
                return;
            }
            if (rooms.size() >= maxRooms) {
                refuse(control, "Das Relay ist ausgelastet.");
                return;
            }
            rooms.put(roomId, room);
        }

        try {
            writeLine(control, "{\"ok\":true}");
            log("host", roomId);

            // A host sends no more application data over its control connection.
            // Reading here exists solely to notice EOF promptly and release its room.
            InputStream input = control.getInputStream();
            while (input.read() >= 0) {
                // Ignore unexpected control bytes, matching the Node relay.
            }
        } finally {
            dropRoom(room);
        }
    }

    private void registerGuest(Socket guest, String roomId) {
        Room room = rooms.get(roomId);
        if (room == null || !room.active.get()) {
            refuse(guest, "Zu diesem Einladungscode ist gerade kein Gastgeber verbunden.");
            return;
        }

        String ticket = Long.toString(nextTicket.getAndIncrement());
        Pending pending = new Pending(guest);
        synchronized (room) {
            if (!room.active.get() || rooms.get(roomId) != room) {
                refuse(guest, "Zu diesem Einladungscode ist gerade kein Gastgeber verbunden.");
                return;
            }
            room.waiting.put(ticket, pending);
            pending.timeout = scheduler.schedule(() -> {
                synchronized (room) {
                    if (room.waiting.remove(ticket, pending)) closeSocket(guest);
                }
            }, waitMillis, TimeUnit.MILLISECONDS);
            try {
                writeLine(room.control, "{\"type\":\"connect\",\"id\":\"" + ticket + "\"}");
            } catch (IOException error) {
                room.waiting.remove(ticket, pending);
                pending.cancelTimeout();
                closeSocket(guest);
                dropRoom(room);
                return;
            }
        }
        log("guest", roomId);
    }

    private void joinHostData(Socket hostData, String roomId, String ticket) {
        Room room = rooms.get(roomId);
        if (room == null) {
            closeSocket(hostData);
            return;
        }

        Pending pending;
        synchronized (room) {
            pending = room.waiting.remove(ticket);
        }
        if (pending == null) {
            closeSocket(hostData);
            return;
        }
        pending.cancelTimeout();
        bridge(hostData, pending.socket);
        log("joined", roomId);
    }

    private void bridge(Socket left, Socket right) {
        var pairClosed = new AtomicBoolean();
        Runnable closePair = () -> {
            if (!pairClosed.compareAndSet(false, true)) return;
            closeSocket(left);
            closeSocket(right);
        };
        Thread.ofVirtual().name("kiwi-relay-upstream").start(() -> pump(left, right, closePair));
        Thread.ofVirtual().name("kiwi-relay-downstream").start(() -> pump(right, left, closePair));
    }

    private static void pump(Socket source, Socket destination, Runnable closePair) {
        try {
            source.getInputStream().transferTo(destination.getOutputStream());
            destination.getOutputStream().flush();
        } catch (IOException ignored) {
            // Closing either peer ends the other direction as well.
        } finally {
            closePair.run();
        }
    }

    private void dropRoom(Room room) {
        if (!room.active.compareAndSet(true, false)) return;
        rooms.remove(room.id, room);
        synchronized (room) {
            for (Pending pending : room.waiting.values()) {
                pending.cancelTimeout();
                closeSocket(pending.socket);
            }
            room.waiting.clear();
        }
        closeSocket(room.control);
        log("host-gone", room.id);
    }

    private static void refuse(Socket socket, String message) {
        try {
            writeLine(socket, "{\"type\":\"error\",\"message\":\"" + jsonEscape(message) + "\"}");
            socket.shutdownOutput();
        } catch (IOException ignored) {
            // There is nobody left to receive the explanation.
        } finally {
            closeQuietly(socket);
        }
    }

    private static void writeLine(Socket socket, String line) throws IOException {
        synchronized (socket) {
            OutputStream output = socket.getOutputStream();
            output.write(line.getBytes(StandardCharsets.UTF_8));
            output.write('\n');
            output.flush();
        }
    }

    private void closeSocket(Socket socket) {
        sockets.remove(socket);
        closeQuietly(socket);
    }

    private static void closeQuietly(Closeable closeable) {
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Closing is best effort.
        }
    }

    private void log(String event, String room) {
        if (quiet) return;
        String shortRoom = room.substring(0, Math.min(8, room.length()));
        System.out.printf("%s %s %s… (%d Räume)%n", Instant.now(), event, shortRoom, rooms.size());
    }

    private void await() throws InterruptedException {
        stopped.await();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        ServerSocket server = serverSocket;
        if (server != null) closeQuietly(server);
        for (Room room : rooms.values()) dropRoom(room);
        rooms.clear();
        for (Socket socket : Set.copyOf(sockets)) closeSocket(socket);
        scheduler.shutdownNow();
        stopped.countDown();
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private static String jsonEscape(String text) {
        StringBuilder escaped = new StringBuilder(text.length() + 8);
        for (int index = 0; index < text.length(); index++) {
            char value = text.charAt(index);
            switch (value) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (value < 0x20) escaped.append(String.format("\\u%04x", (int) value));
                    else escaped.append(value);
                }
            }
        }
        return escaped.toString();
    }

    private static final class Room {
        private final String id;
        private final Socket control;
        private final Map<String, Pending> waiting = new LinkedHashMap<>();
        private final AtomicBoolean active = new AtomicBoolean(true);

        private Room(String id, Socket control) {
            this.id = id;
            this.control = control;
        }
    }

    private static final class Pending {
        private final Socket socket;
        private volatile ScheduledFuture<?> timeout;

        private Pending(Socket socket) {
            this.socket = socket;
        }

        private void cancelTimeout() {
            ScheduledFuture<?> current = timeout;
            if (current != null) current.cancel(false);
        }
    }

    private record Greeting(String role, String room, String id) {
        private static Greeting read(InputStream input) throws IOException, ProtocolException {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(256);
            while (true) {
                int value = input.read();
                if (value < 0) throw new ProtocolException("Ungültige Anmeldung am Relay.");
                if (value == '\n') break;
                if (bytes.size() >= MAX_GREETING_BYTES) {
                    throw new ProtocolException("Ungültige Anmeldung am Relay.");
                }
                bytes.write(value);
            }

            final String json;
            try {
                json = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(bytes.toByteArray()))
                    .toString();
            } catch (CharacterCodingException error) {
                throw new ProtocolException("Ungültige Anmeldung am Relay.");
            }

            final Map<String, Object> values;
            try {
                values = TinyJson.parseObject(json);
            } catch (IllegalArgumentException error) {
                throw new ProtocolException("Ungültige Anmeldung am Relay.");
            }

            if (!isVersion(values.get("v"))) {
                throw new ProtocolException("Das Relay spricht eine andere Version.");
            }
            String room = string(values.get("room"));
            if (!room.matches("[0-9a-f]{" + ROOM_HEX_LENGTH + "}")) {
                throw new ProtocolException("Ungültige Raumkennung.");
            }
            String role = string(values.get("role"));
            if (!role.equals("host") && !role.equals("host-data") && !role.equals("guest")) {
                throw new ProtocolException("Unbekannte Rolle am Relay.");
            }
            return new Greeting(role, room, string(values.get("id")));
        }

        private static boolean isVersion(Object value) {
            if (value instanceof Number number) return number.doubleValue() == RELAY_VERSION;
            try {
                return Double.parseDouble(string(value)) == RELAY_VERSION;
            } catch (NumberFormatException ignored) {
                return false;
            }
        }

        private static String string(Object value) {
            return value == null ? "" : String.valueOf(value);
        }
    }

    private static final class ProtocolException extends Exception {
        private ProtocolException(String message) {
            super(message);
        }
    }

    /** A deliberately tiny JSON object reader for the relay's one-line greeting. */
    private static final class TinyJson {
        private final String source;
        private int index;

        private TinyJson(String source) {
            this.source = source;
        }

        private static Map<String, Object> parseObject(String source) {
            TinyJson reader = new TinyJson(source);
            Map<String, Object> result = reader.object();
            reader.space();
            if (reader.index != source.length()) throw new IllegalArgumentException("Trailing JSON");
            return result;
        }

        private Map<String, Object> object() {
            expect('{');
            Map<String, Object> result = new LinkedHashMap<>();
            space();
            if (take('}')) return result;
            while (true) {
                space();
                String key = string();
                space();
                expect(':');
                space();
                result.put(key, value());
                space();
                if (take('}')) return result;
                expect(',');
            }
        }

        private Object value() {
            if (index >= source.length()) throw new IllegalArgumentException("Missing value");
            char current = source.charAt(index);
            if (current == '"') return string();
            if (current == '-' || Character.isDigit(current)) return number();
            if (source.startsWith("true", index)) { index += 4; return Boolean.TRUE; }
            if (source.startsWith("false", index)) { index += 5; return Boolean.FALSE; }
            if (source.startsWith("null", index)) { index += 4; return null; }
            throw new IllegalArgumentException("Unsupported value");
        }

        private Number number() {
            int start = index;
            if (source.charAt(index) == '-') index++;
            while (index < source.length() && Character.isDigit(source.charAt(index))) index++;
            if (index < source.length() && source.charAt(index) == '.') {
                index++;
                while (index < source.length() && Character.isDigit(source.charAt(index))) index++;
            }
            String value = source.substring(start, index);
            try {
                return value.contains(".") ? Double.parseDouble(value) : Long.parseLong(value);
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException("Invalid number", error);
            }
        }

        private String string() {
            expect('"');
            StringBuilder value = new StringBuilder();
            while (index < source.length()) {
                char current = source.charAt(index++);
                if (current == '"') return value.toString();
                if (current != '\\') {
                    if (current < 0x20) throw new IllegalArgumentException("Control character");
                    value.append(current);
                    continue;
                }
                if (index >= source.length()) throw new IllegalArgumentException("Broken escape");
                char escaped = source.charAt(index++);
                switch (escaped) {
                    case '"', '\\', '/' -> value.append(escaped);
                    case 'b' -> value.append('\b');
                    case 'f' -> value.append('\f');
                    case 'n' -> value.append('\n');
                    case 'r' -> value.append('\r');
                    case 't' -> value.append('\t');
                    case 'u' -> {
                        if (index + 4 > source.length()) throw new IllegalArgumentException("Broken unicode escape");
                        try {
                            value.append((char) Integer.parseInt(source.substring(index, index + 4), 16));
                        } catch (NumberFormatException error) {
                            throw new IllegalArgumentException("Broken unicode escape", error);
                        }
                        index += 4;
                    }
                    default -> throw new IllegalArgumentException("Unknown escape");
                }
            }
            throw new IllegalArgumentException("Unclosed string");
        }

        private void expect(char expected) {
            space();
            if (index >= source.length() || source.charAt(index) != expected) {
                throw new IllegalArgumentException("Expected " + expected);
            }
            index++;
        }

        private boolean take(char expected) {
            space();
            if (index < source.length() && source.charAt(index) == expected) {
                index++;
                return true;
            }
            return false;
        }

        private void space() {
            while (index < source.length() && Character.isWhitespace(source.charAt(index))) index++;
        }
    }

    private record Options(String host, int port, int maxRooms, boolean quiet, boolean help) {
        private static Options parse(String[] args, Map<String, String> environment) {
            String host = fallback(environment.get("KIWI_RELAY_HOST"), "0.0.0.0");
            int port = port(environment.get("KIWI_RELAY_PORT"), 8_787, false, "KIWI_RELAY_PORT");
            int maxRooms = roomLimit(environment.get("KIWI_RELAY_MAX_ROOMS"));
            boolean quiet = false;
            boolean help = false;

            for (int index = 0; index < args.length; index++) {
                switch (args[index]) {
                    case "--host" -> {
                        if (++index >= args.length || args[index].isBlank()) {
                            throw new IllegalArgumentException("Nach --host fehlt eine Adresse.");
                        }
                        host = args[index];
                    }
                    case "--port" -> {
                        if (++index >= args.length) throw new IllegalArgumentException("Nach --port fehlt ein Port.");
                        port = port(args[index], -1, true, "Port");
                    }
                    case "--quiet" -> quiet = true;
                    case "--help", "-h" -> help = true;
                    default -> throw new IllegalArgumentException("Unbekannte Option: " + args[index]);
                }
            }
            return new Options(host, port, maxRooms, quiet, help);
        }

        private static int port(String raw, int fallback, boolean allowEphemeral, String label) {
            if (raw == null || raw.isBlank()) return fallback;
            try {
                int parsed = Integer.parseInt(raw);
                if (parsed < (allowEphemeral ? 0 : 1) || parsed > 65_535) throw new NumberFormatException();
                return parsed;
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException("Kein gültiger Wert für " + label + ": " + raw);
            }
        }

        private static int roomLimit(String raw) {
            if (raw == null || raw.isBlank()) return 200;
            try {
                int parsed = Integer.parseInt(raw);
                return parsed > 0 ? parsed : 200;
            } catch (NumberFormatException ignored) {
                // Matches the Node relay: a malformed optional limit falls back.
                return 200;
            }
        }

        private static String fallback(String value, String fallback) {
            return value == null || value.isBlank() ? fallback : value;
        }
    }
}
