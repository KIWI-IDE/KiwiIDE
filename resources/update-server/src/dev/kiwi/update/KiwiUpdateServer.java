package dev.kiwi.update;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsParameters;
import com.sun.net.httpserver.HttpsServer;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.TreeMap;
import java.util.concurrent.Executors;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Dependency-free production update service for Kiwi IDE.
 *
 * <p>The public API deliberately matches the former Node implementation so
 * existing Kiwi clients and the streaming release publisher remain compatible.</p>
 */
public final class KiwiUpdateServer {
    private static final long DEFAULT_MAX_BYTES = 600L * 1024L * 1024L;
    private static final Pattern SEMVER = Pattern.compile(
            "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$"
    );
    private static final Pattern LATEST_VERSION = Pattern.compile("\\\"version\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
    private static final Pattern SHA256 = Pattern.compile("^[a-f0-9]{64}$");
    // Header of a Kiwi renderer bundle: the magic bytes and the main-process
    // fingerprint the manifest has to publish for restart-free updates.
    private static final String RENDERER_MAGIC = "KIWIRND\0";
    private static final Pattern RENDERER_MAIN_HASH = Pattern.compile("\"mainHash\"\\s*:\\s*\"([a-fA-F0-9]{64})\"");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Config config;
    private final Path realStorageRoot;
    private final Map<String, ReentrantLock> channelLocks = Map.of(
            "stable", new ReentrantLock(),
            "beta", new ReentrantLock()
    );

    private KiwiUpdateServer(Config config) throws IOException {
        this.config = config;
        Files.createDirectories(config.storageRoot());
        this.realStorageRoot = config.storageRoot().toRealPath();
    }

    public static void main(String[] args) {
        List<String> arguments = List.of(args);
        if (arguments.contains("--help") || arguments.contains("-h")) {
            System.out.print(USAGE);
            return;
        }
        if (arguments.contains("--init")) {
            try {
                Path written = writeStarterConfiguration(configurationPath(System.getenv()), arguments.contains("--force"));
                System.out.printf("Konfiguration geschrieben: %s%n", written);
                System.out.println("Adresse und TLS eintragen, dann starten: java -jar kiwi-update-server.jar");
            } catch (Exception error) {
                // A file that is already there is an answer, not a crash.
                System.err.println(safeMessage(error));
                System.exit(1);
            }
            return;
        }
        try {
            Config config = Config.fromEnvironment(settings(System.getenv()));
            KiwiUpdateServer application = new KiwiUpdateServer(config);
            HttpServer server = application.createServer();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(1), "kiwi-update-shutdown"));
            server.start();
            int port = server.getAddress().getPort();
            System.out.printf("Kiwi Update Server (Java): %s/v1/updates/stable/latest.json%n", config.publicBaseUrl());
            System.out.printf("Listener: %s://%s:%d%n", config.tlsEnabled() ? "https" : "http", config.host(), port);
            System.out.printf("Publishing-API: %s%n", config.publishToken().isEmpty() ? "deaktiviert (read-only)" : "aktiv");
            System.out.printf("Speicherort: %s%n", config.storageRoot());
            // Stays last: every harness treats this line as "the server is up".
            System.out.printf("KIWI_UPDATE_READY=%d%n", port);
            System.out.flush();
        } catch (Exception error) {
            System.err.println("Update-Server konnte nicht gestartet werden: " + safeMessage(error));
            error.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private static final String CONFIG_FILE_NAME = "kiwi-update-server.properties";

    private static final String USAGE = """
            Kiwi Update Server

              java -jar kiwi-update-server.jar            startet den Server
              java -jar kiwi-update-server.jar --init     schreibt eine Startkonfiguration
              java -jar kiwi-update-server.jar --help     zeigt diese Hilfe

            Gelesen wird kiwi-update-server.properties neben dem JAR oder im
            Arbeitsverzeichnis; KIWI_UPDATE_CONFIG benennt eine andere Datei.
            Jede Einstellung kann als Umgebungsvariable gesetzt werden und hat
            dort Vorrang vor der Datei.
            """;

    /**
     * Where the configuration file lives.
     *
     * <p>Next to the JAR first, because that is where a copied-over server
     * directory keeps it, then the working directory. Naming one explicitly
     * always wins, so a service unit can point at /etc.</p>
     */
    private static Path configurationPath(Map<String, String> environment) {
        String explicit = environment.getOrDefault("KIWI_UPDATE_CONFIG", "").trim();
        if (!explicit.isEmpty()) return Path.of(explicit).toAbsolutePath().normalize();
        Path besideJar = jarDirectory();
        if (besideJar != null && Files.isRegularFile(besideJar.resolve(CONFIG_FILE_NAME))) {
            return besideJar.resolve(CONFIG_FILE_NAME);
        }
        Path working = Path.of("").toAbsolutePath().resolve(CONFIG_FILE_NAME);
        if (Files.isRegularFile(working)) return working;
        return besideJar != null ? besideJar.resolve(CONFIG_FILE_NAME) : working;
    }

    private static Path jarDirectory() {
        try {
            Path location = Path.of(KiwiUpdateServer.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            return Files.isDirectory(location) ? location : location.getParent();
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * The settings the server runs on: the configuration file, overlaid with
     * the environment.
     *
     * <p>Setting everything through environment variables meant the operator
     * had to reproduce the whole block on every start and a service that lost
     * its unit file lost its configuration with it. The file is the durable
     * half; the environment stays authoritative so a container can still
     * override a single value without editing anything.</p>
     */
    static Map<String, String> settings(Map<String, String> environment) throws IOException {
        Map<String, String> merged = new TreeMap<>(readConfigurationFile(configurationPath(environment)));
        for (Map.Entry<String, String> entry : environment.entrySet()) {
            if (entry.getKey().startsWith("KIWI_UPDATE_") && entry.getValue() != null && !entry.getValue().isBlank()) {
                merged.put(entry.getKey(), entry.getValue());
            }
        }
        return merged;
    }

    static Map<String, String> readConfigurationFile(Path file) throws IOException {
        Map<String, String> values = new TreeMap<>();
        if (file == null || !Files.isRegularFile(file)) return values;
        Properties properties = new Properties();
        try (InputStream stream = Files.newInputStream(file)) {
            properties.load(stream);
        }
        for (String name : properties.stringPropertyNames()) {
            String key = name.trim();
            String value = properties.getProperty(name, "").trim();
            // The file uses the same names as the environment, so there is one
            // list of settings to learn rather than two.
            if (!key.startsWith("KIWI_UPDATE_") || value.isEmpty()) continue;
            values.put(key, value);
        }
        return values;
    }

    /**
     * Writes a configuration to fill in, with a publishing token already
     * generated: the one value nobody should be asked to invent by hand.
     */
    static Path writeStarterConfiguration(Path target, boolean overwrite) throws IOException {
        if (Files.exists(target) && !overwrite) {
            throw new IllegalStateException(target + " existiert bereits. --force überschreibt sie.");
        }
        byte[] secret = new byte[48];
        RANDOM.nextBytes(secret);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        // Written absolute on purpose: a relative path would follow whichever
        // directory the service happened to be started from, and the storage
        // would quietly move with it.
        Path configured = target.toAbsolutePath().normalize();
        // A backslash is an escape character in a properties file, so a Windows
        // path has to be written doubled or it is read back as something else.
        String storageDirectory = String.valueOf(
                configured.getParent() == null ? Path.of("update-storage") : configured.getParent().resolve("update-storage"))
                .replace("\\", "\\\\");
        String contents = """
                # Kiwi Update Server
                # Jede Zeile kann auch als Umgebungsvariable gesetzt werden und hat dort Vorrang.

                # Die Adresse, unter der Kiwi-Clients den Server erreichen. HTTPS ist Pflicht.
                KIWI_UPDATE_PUBLIC_BASE_URL=https://updates.example.org

                # Woran der Server lauscht. 0.0.0.0 fuer direktes TLS, 127.0.0.1 hinter einem Reverse-Proxy.
                KIWI_UPDATE_HOST=0.0.0.0
                KIWI_UPDATE_PORT=443

                # Wohin die Installer geschrieben werden. Ein eigenes Verzeichnis, kein Systempfad.
                # Absolut, damit ein Dienst den Speicherort nicht vom Arbeitsverzeichnis abhaengig macht.
                KIWI_UPDATE_STORAGE_DIR=%s

                # Frisch erzeugt. Wer diesen Token hat, darf Releases veroeffentlichen.
                KIWI_UPDATE_PUBLISH_TOKEN=%s

                # Direktes TLS: Zertifikatskette und unverschluesselter PKCS#8-Schluessel.
                #KIWI_UPDATE_TLS_CERT=/etc/kiwi/fullchain.pem
                #KIWI_UPDATE_TLS_KEY=/etc/kiwi/privkey.pem

                # Alternativ ein PKCS#12-Keystore statt der beiden PEM-Dateien.
                #KIWI_UPDATE_TLS_KEYSTORE=/etc/kiwi/updates.p12
                #KIWI_UPDATE_TLS_KEYSTORE_PASSWORD=

                # Statt eigenem TLS: HTTPS terminiert ein Reverse-Proxy davor.
                # Dann muss KIWI_UPDATE_HOST auf 127.0.0.1 stehen.
                #KIWI_UPDATE_BEHIND_HTTPS_PROXY=1
                """.formatted(storageDirectory, token);
        Path parent = target.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);
        Files.writeString(target, contents, StandardCharsets.UTF_8);
        restrictToOwner(target);
        return target.toAbsolutePath().normalize();
    }

    /** The file holds the publishing token, so nobody else on the host reads it. */
    private static void restrictToOwner(Path file) {
        try {
            Files.setPosixFilePermissions(file, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception ignored) {
            // Windows has no POSIX permissions; the file inherits the directory's.
        }
    }

    private HttpServer createServer() throws Exception {
        InetSocketAddress address = new InetSocketAddress(config.host(), config.port());
        HttpServer server;
        if (config.tlsEnabled()) {
            HttpsServer secure = HttpsServer.create(address, 64);
            SSLContext sslContext = createSslContext(config);
            secure.setHttpsConfigurator(new HttpsConfigurator(sslContext) {
                @Override
                public void configure(HttpsParameters parameters) {
                    var sslParameters = getSSLContext().getDefaultSSLParameters();
                    List<String> enabled = List.of(sslParameters.getProtocols()).stream()
                            .filter(protocol -> protocol.equals("TLSv1.3") || protocol.equals("TLSv1.2"))
                            .toList();
                    if (enabled.isEmpty()) throw new IllegalStateException("JVM unterstützt weder TLS 1.2 noch TLS 1.3.");
                    sslParameters.setProtocols(enabled.toArray(String[]::new));
                    parameters.setSSLParameters(sslParameters);
                }
            });
            server = secure;
        } else {
            server = HttpServer.create(address, 64);
        }
        server.createContext("/", new Router());
        server.setExecutor(Executors.newFixedThreadPool(config.workerThreads(), runnable -> {
            Thread thread = new Thread(runnable, "kiwi-update-http");
            thread.setDaemon(false);
            return thread;
        }));
        return server;
    }

    private final class Router implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try {
                route(exchange);
            } catch (HttpError error) {
                if (!exchange.getResponseHeaders().containsKey("Content-Type")) {
                    sendJson(exchange, error.status, "{\"error\":\"" + escapeJson(error.getMessage()) + "\"}");
                } else {
                    exchange.close();
                }
            } catch (Exception error) {
                System.err.println("Update server request failed: " + safeMessage(error));
                error.printStackTrace(System.err);
                if (!exchange.getResponseHeaders().containsKey("Content-Type")) {
                    sendJson(exchange, 500, "{\"error\":\"Interner Serverfehler.\"}");
                } else {
                    exchange.close();
                }
            } finally {
                exchange.close();
            }
        }
    }

    private void route(HttpExchange exchange) throws Exception {
        String method = exchange.getRequestMethod();
        URI uri = exchange.getRequestURI();
        String rawPath = uri.getRawPath();
        List<String> segments = decodeSegments(rawPath);

        if (method.equals("GET") && rawPath.equals("/healthz")) {
            sendJson(exchange, 200, "{\"status\":\"ok\",\"service\":\"kiwi-update-server\",\"runtime\":\"java\"}");
            return;
        }
        if ((method.equals("GET") || method.equals("HEAD"))
                && (rawPath.equals("/") || rawPath.equals("/latest.json"))) {
            String channel = queryParameter(uri.getRawQuery(), "channel");
            serveFile(exchange, safeResolve("channels", assertChannel(channel == null ? "stable" : channel), "latest.json"), true);
            return;
        }
        if ((method.equals("GET") || method.equals("HEAD")) && segments.size() == 4
                && segments.get(0).equals("v1") && segments.get(1).equals("updates") && segments.get(3).equals("latest.json")) {
            serveFile(exchange, safeResolve("channels", assertChannel(segments.get(2)), "latest.json"), true);
            return;
        }
        if (method.equals("GET") && segments.size() == 3
                && segments.get(0).equals("v1") && segments.get(1).equals("releases")) {
            listReleases(exchange, assertChannel(segments.get(2)));
            return;
        }
        if ((method.equals("GET") || method.equals("HEAD")) && segments.size() == 5
                && segments.get(0).equals("v1") && segments.get(1).equals("releases")) {
            String channel = assertChannel(segments.get(2));
            Version version = Version.parse(segments.get(3));
            String filename = safeSegment(segments.get(4));
            if (!filename.equalsIgnoreCase(artifactFilename("setup", version))
                    && !filename.equalsIgnoreCase(artifactFilename("portable", version))
                    && !filename.equalsIgnoreCase(artifactFilename("renderer", version))) {
                throw new HttpError(404, "Nicht gefunden.");
            }
            serveFile(exchange, safeResolve("releases", channel, version.value, filename), false);
            return;
        }
        if (method.equals("PUT") && segments.size() == 6
                && segments.get(0).equals("v1") && segments.get(1).equals("admin")
                && segments.get(2).equals("releases")
                && (segments.get(5).equals("portable") || segments.get(5).equals("renderer"))) {
            authenticate(exchange);
            String kind = segments.get(5);
            String channel = assertChannel(segments.get(3));
            String version = safeSegment(segments.get(4));
            ReentrantLock lock = channelLocks.get(channel);
            lock.lockInterruptibly();
            try {
                String artifact = publishStagedArtifact(exchange, kind, channel, version);
                sendJson(exchange, 201, artifact);
            } finally {
                lock.unlock();
            }
            return;
        }
        if (method.equals("PUT") && segments.size() == 5
                && segments.get(0).equals("v1") && segments.get(1).equals("admin") && segments.get(2).equals("releases")) {
            authenticate(exchange);
            String channel = assertChannel(segments.get(3));
            String version = safeSegment(segments.get(4));
            ReentrantLock lock = channelLocks.get(channel);
            lock.lockInterruptibly();
            try {
                String manifest = publishRelease(exchange, channel, version);
                exchange.getResponseHeaders().set("Location", "/v1/updates/" + channel + "/latest.json");
                sendJson(exchange, 201, manifest);
            } finally {
                lock.unlock();
            }
            return;
        }
        if (List.of("POST", "PUT", "PATCH", "DELETE").contains(method)) throw new HttpError(405, "Methode nicht erlaubt.");
        throw new HttpError(404, "Nicht gefunden.");
    }

    /**
     * Stores a package that does not activate a release on its own.
     *
     * Portable EXE and renderer bundle are uploaded before the installer and
     * only become visible once the setup upload switches `latest` over. A
     * renderer bundle is additionally checked to be a real Kiwi bundle whose
     * main-process fingerprint can be published, because a client uses exactly
     * that value to decide whether it may skip the installer.
     */
    private String publishStagedArtifact(HttpExchange exchange, String kind, String channel, String versionText) throws Exception {
        Version version = Version.parse(versionText);
        if (channel.equals("stable") && !version.prerelease.isEmpty()) {
            throw new HttpError(400, "Vorabversionen gehören in den Beta-Kanal.");
        }
        assertNewerThanLatest(channel, version);
        String filename = artifactFilename(kind, version);
        Path releaseDirectory = safeResolve("releases", channel, version.value);
        createSecureDirectories(releaseDirectory);
        UploadedArtifact artifact = receiveArtifact(exchange, releaseDirectory, filename);
        if (kind.equals("renderer")) {
            try {
                artifact = artifact.withMainHash(readRendererMainHash(releaseDirectory.resolve(filename)));
            } catch (HttpError error) {
                Files.deleteIfExists(releaseDirectory.resolve(filename));
                throw error;
            }
        }
        return "{" +
                "\"staged\":true," +
                "\"channel\":\"" + escapeJson(channel) + "\"," +
                "\"version\":\"" + escapeJson(version.value) + "\"," +
                "\"artifact\":" + artifactJson(channel, version, artifact) +
                "}";
    }

    private static String artifactFilename(String kind, Version version) {
        return kind.equals("renderer")
                ? "Kiwi-IDE-" + version.value + "-renderer.kiwi"
                : "Kiwi-IDE-" + version.value + "-" + kind + ".exe";
    }

    /**
     * Reads the main-process fingerprint out of a renderer bundle header.
     *
     * The value is taken from the uploaded file itself rather than from a
     * header the publisher supplies, so a manifest can never promise a
     * restart-free update for a bundle that was built against other code.
     */
    private String readRendererMainHash(Path bundle) throws Exception {
        try (FileChannel channel = FileChannel.open(bundle, StandardOpenOption.READ)) {
            ByteBuffer prefix = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN);
            while (prefix.hasRemaining() && channel.read(prefix) >= 0) { /* fill */ }
            if (prefix.hasRemaining()) throw new HttpError(400, "Das Renderer-Bundle ist unvollständig.");
            prefix.flip();
            byte[] magic = new byte[8];
            prefix.get(magic);
            if (!new String(magic, StandardCharsets.US_ASCII).equals(RENDERER_MAGIC)) {
                throw new HttpError(400, "Das Renderer-Bundle hat kein gültiges Kiwi-Format.");
            }
            int headerLength = prefix.getInt();
            if (headerLength <= 0 || headerLength > 4 * 1024 * 1024 || headerLength > channel.size() - 12) {
                throw new HttpError(400, "Der Kopf des Renderer-Bundles ist ungültig.");
            }
            ByteBuffer header = ByteBuffer.allocate(headerLength);
            while (header.hasRemaining() && channel.read(header) >= 0) { /* fill */ }
            if (header.hasRemaining()) throw new HttpError(400, "Der Kopf des Renderer-Bundles ist unvollständig.");
            Matcher matcher = RENDERER_MAIN_HASH.matcher(new String(header.array(), StandardCharsets.UTF_8));
            if (!matcher.find()) throw new HttpError(400, "Dem Renderer-Bundle fehlt die Hauptprozess-Prüfsumme.");
            return matcher.group(1).toLowerCase(Locale.ROOT);
        } catch (IOException error) {
            throw new HttpError(500, "Das Renderer-Bundle konnte nicht gelesen werden.");
        }
    }

    private String publishRelease(HttpExchange exchange, String channel, String versionText) throws Exception {
        Version version = Version.parse(versionText);
        if (channel.equals("stable") && !version.prerelease.isEmpty()) {
            throw new HttpError(400, "Vorabversionen gehören in den Beta-Kanal.");
        }
        assertNewerThanLatest(channel, version);
        String filename = "Kiwi-IDE-" + version.value + "-setup.exe";
        String suppliedFilename = exchange.getRequestHeaders().getFirst("X-Kiwi-Filename");
        if (suppliedFilename != null && !safeSegment(suppliedFilename).equalsIgnoreCase(filename)) {
            throw new HttpError(400, "Der Installer muss " + filename + " heißen.");
        }
        String releaseNotes = decodeReleaseNotes(exchange.getRequestHeaders().getFirst("X-Kiwi-Release-Notes-Base64"), version.value);
        Path releaseDirectory = safeResolve("releases", channel, version.value);
        createSecureDirectories(releaseDirectory);
        UploadedArtifact setup = receiveArtifact(exchange, releaseDirectory, filename);
        boolean activated = false;
        try {
            String portableFilename = artifactFilename("portable", version);
            Path portablePath = releaseDirectory.resolve(portableFilename);
            UploadedArtifact portable = Files.exists(portablePath, LinkOption.NOFOLLOW_LINKS)
                    ? describeArtifact(portablePath, portableFilename)
                    : null;
            String rendererFilename = artifactFilename("renderer", version);
            Path rendererPath = releaseDirectory.resolve(rendererFilename);
            UploadedArtifact renderer = Files.exists(rendererPath, LinkOption.NOFOLLOW_LINKS)
                    ? describeArtifact(rendererPath, rendererFilename).withMainHash(readRendererMainHash(rendererPath))
                    : null;
            String manifest = createManifest(channel, version, setup, portable, renderer, releaseNotes);
            writeUtf8Atomic(safeResolve("channels", channel, "latest.json"), manifest + System.lineSeparator());
            activated = true;
            return manifest;
        } finally {
            // A setup artifact is the activation transaction. If manifest
            // creation/persistence fails it must be retryable; an already
            // staged portable artifact remains immutable for that retry.
            if (!activated) Files.deleteIfExists(releaseDirectory.resolve(filename));
        }
    }

    private void assertNewerThanLatest(String channel, Version version) throws Exception {
        Path latest = safeResolve("channels", channel, "latest.json");
        String currentVersion = readLatestVersion(latest);
        if (currentVersion != null && !config.allowDowngrade() && Version.compare(version, Version.parse(currentVersion)) <= 0) {
            throw new HttpError(409, "Version " + version.value + " ist nicht neuer als " + currentVersion + ".");
        }
    }

    private UploadedArtifact receiveArtifact(HttpExchange exchange, Path releaseDirectory, String expectedFilename) throws Exception {
        long contentLength = parseLong(exchange.getRequestHeaders().getFirst("Content-Length"), -1);
        if (contentLength <= 0 || contentLength > config.maxUploadBytes()) throw new HttpError(413, "Ungültige oder zu große Upload-Größe.");
        String expectedHash = lower(exchange.getRequestHeaders().getFirst("X-Kiwi-Sha256"));
        if (!SHA256.matcher(expectedHash).matches()) throw new HttpError(400, "X-Kiwi-Sha256 fehlt oder ist ungültig.");
        String suppliedFilename = exchange.getRequestHeaders().getFirst("X-Kiwi-Filename");
        String filename = safeSegment(suppliedFilename == null ? expectedFilename : suppliedFilename);
        if (!filename.equalsIgnoreCase(expectedFilename)) throw new HttpError(400, "Das Paket muss " + expectedFilename + " heißen.");
        assertRealParent(releaseDirectory.resolve(filename));
        Path target = releaseDirectory.resolve(filename);
        Path temporary = releaseDirectory.resolve("." + filename + "." + ProcessHandle.current().pid() + "-" + randomHex(6) + ".upload");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long bytes = 0;
        boolean installed = false;
        try {
            try (InputStream input = exchange.getRequestBody();
                 FileChannel output = FileChannel.open(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read == 0) continue;
                    bytes += read;
                    if (bytes > config.maxUploadBytes() || bytes > contentLength) throw new HttpError(413, "Upload überschreitet die angekündigte Größe.");
                    digest.update(buffer, 0, read);
                    ByteBuffer byteBuffer = ByteBuffer.wrap(buffer, 0, read);
                    while (byteBuffer.hasRemaining()) output.write(byteBuffer);
                }
                output.force(true);
            }
            if (bytes != contentLength) throw new HttpError(400, "Upload-Größe stimmt nicht mit Content-Length überein.");
            String actualHash = HexFormat.of().formatHex(digest.digest());
            if (!MessageDigest.isEqual(actualHash.getBytes(StandardCharsets.US_ASCII), expectedHash.getBytes(StandardCharsets.US_ASCII))) {
                throw new HttpError(400, "SHA-256-Prüfsumme des Uploads stimmt nicht.");
            }
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
                UploadedArtifact existing = describeArtifact(target, filename);
                if (existing.bytes == bytes && MessageDigest.isEqual(
                        existing.sha256.getBytes(StandardCharsets.US_ASCII),
                        actualHash.getBytes(StandardCharsets.US_ASCII))) {
                    // Retrying after a failed setup activation must not strand
                    // an otherwise valid portable-first release.
                    return existing;
                }
                throw new HttpError(409, "Diese Release-Version existiert bereits.");
            }
            try {
                Files.createLink(target, temporary);
            } catch (FileAlreadyExistsException error) {
                throw new HttpError(409, "Diese Release-Version existiert bereits.");
            } catch (UnsupportedOperationException error) {
                moveCreateOnly(temporary, target);
            } catch (IOException error) {
                if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) throw new HttpError(409, "Diese Release-Version existiert bereits.");
                moveCreateOnly(temporary, target);
            }
            Files.deleteIfExists(temporary);
            installed = true;
            return new UploadedArtifact(filename, actualHash, bytes);
        } catch (Exception error) {
            if (installed) Files.deleteIfExists(target);
            throw error;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private void listReleases(HttpExchange exchange, String channel) throws Exception {
        Path directory = safeResolve("releases", channel);
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
            sendJson(exchange, 200, "{\"channel\":\"" + channel + "\",\"versions\":[]}");
            return;
        }
        assertRealInside(directory);
        List<Version> versions = new ArrayList<>();
        try (var stream = Files.list(directory)) {
            stream.filter(path -> Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS))
                    .forEach(path -> {
                        try {
                            Version version = Version.parse(path.getFileName().toString());
                            Path setup = path.resolve("Kiwi-IDE-" + version.value + "-setup.exe");
                            // A portable-first upload is staged, not published.
                            // Release listings must change with latest activation.
                            if (Files.isRegularFile(setup, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(setup)) {
                                versions.add(version);
                            }
                        } catch (HttpError ignored) { }
                    });
        }
        versions.sort((left, right) -> -Version.compare(left, right));
        StringBuilder json = new StringBuilder("{\"channel\":\"").append(channel).append("\",\"versions\":[");
        for (int index = 0; index < versions.size(); index++) {
            if (index > 0) json.append(',');
            json.append('"').append(escapeJson(versions.get(index).value)).append('"');
        }
        sendJson(exchange, 200, json.append("]}").toString());
    }

    private void serveFile(HttpExchange exchange, Path target, boolean manifest) throws Exception {
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(target)) throw new HttpError(404, "Nicht gefunden.");
        assertRealInside(target);
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) throw new HttpError(404, "Nicht gefunden.");
        long size = Files.size(target);
        long modified = Files.getLastModifiedTime(target, LinkOption.NOFOLLOW_LINKS).toMillis();
        String etag = "\"" + Long.toHexString(size) + "-" + Long.toHexString(modified) + "\"";
        Headers requestHeaders = exchange.getRequestHeaders();
        if (etag.equals(requestHeaders.getFirst("If-None-Match"))) {
            addCommonHeaders(exchange.getResponseHeaders());
            exchange.getResponseHeaders().set("ETag", etag);
            exchange.sendResponseHeaders(304, -1);
            return;
        }
        Range range;
        try {
            range = parseRange(requestHeaders.getFirst("Range"), size);
        } catch (HttpError error) {
            if (error.status == 416) {
                addCommonHeaders(exchange.getResponseHeaders());
                exchange.getResponseHeaders().set("Content-Range", "bytes */" + size);
                exchange.sendResponseHeaders(416, -1);
                return;
            }
            throw error;
        }
        long start = range == null ? 0 : range.start;
        long end = range == null ? size - 1 : range.end;
        long length = Math.max(0, end - start + 1);
        Headers headers = exchange.getResponseHeaders();
        addCommonHeaders(headers);
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", manifest ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable");
        headers.set("Content-Type", manifest ? "application/json; charset=utf-8" : "application/vnd.microsoft.portable-executable");
        headers.set("ETag", etag);
        if (!manifest) headers.set("Content-Disposition", "attachment; filename=\"" + target.getFileName() + "\"");
        if (range != null) headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
        int status = range == null ? 200 : 206;
        if (exchange.getRequestMethod().equals("HEAD")) {
            headers.set("Content-Length", Long.toString(length));
            exchange.sendResponseHeaders(status, -1);
            return;
        }
        exchange.sendResponseHeaders(status, length);
        try (OutputStream output = exchange.getResponseBody(); FileChannel input = FileChannel.open(target, StandardOpenOption.READ)) {
            long position = start;
            long remaining = length;
            while (remaining > 0) {
                long transferred = input.transferTo(position, remaining, java.nio.channels.Channels.newChannel(output));
                if (transferred <= 0) break;
                position += transferred;
                remaining -= transferred;
            }
        }
    }

    private UploadedArtifact describeArtifact(Path target, String filename) throws Exception {
        if (Files.isSymbolicLink(target) || !Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new HttpError(409, "Das bereitgestellte Portable-Paket ist ungültig.");
        }
        assertRealInside(target);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long bytes = 0;
        try (InputStream input = Files.newInputStream(target, StandardOpenOption.READ)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) continue;
                bytes += read;
                if (bytes > config.maxUploadBytes()) throw new HttpError(413, "Portable-Paket ist zu groß.");
                digest.update(buffer, 0, read);
            }
        }
        return new UploadedArtifact(filename, HexFormat.of().formatHex(digest.digest()), bytes);
    }

    private String artifactJson(String channel, Version version, UploadedArtifact artifact) {
        String url = config.publicBaseUrl() + "/v1/releases/" + channel + "/" + encodePath(version.value) + "/" + encodePath(artifact.filename);
        return "{" +
                "\"filename\":\"" + escapeJson(artifact.filename) + "\"," +
                "\"url\":\"" + escapeJson(url) + "\"," +
                "\"sha256\":\"" + artifact.sha256 + "\"," +
                "\"bytes\":" + artifact.bytes +
                (artifact.mainHash == null || artifact.mainHash.isEmpty()
                        ? ""
                        : ",\"mainHash\":\"" + escapeJson(artifact.mainHash) + "\"") +
                "}";
    }

    private String createManifest(String channel, Version version, UploadedArtifact setup, UploadedArtifact portable, UploadedArtifact renderer, String notes) {
        String setupJson = artifactJson(channel, version, setup);
        String portableJson = portable == null ? "" : ",\"portable\":" + artifactJson(channel, version, portable);
        String rendererJson = renderer == null ? "" : ",\"renderer\":" + artifactJson(channel, version, renderer);
        String setupUrl = config.publicBaseUrl() + "/v1/releases/" + channel + "/" + encodePath(version.value) + "/" + encodePath(setup.filename);
        return "{" +
                "\"schemaVersion\":3," +
                "\"channel\":\"" + escapeJson(channel) + "\"," +
                "\"version\":\"" + escapeJson(version.value) + "\"," +
                // Legacy schema-1/2 clients always receive the setup package.
                "\"url\":\"" + escapeJson(setupUrl) + "\"," +
                "\"sha256\":\"" + setup.sha256 + "\"," +
                "\"bytes\":" + setup.bytes + "," +
                "\"artifacts\":{\"setup\":" + setupJson + portableJson + rendererJson + "}," +
                "\"releaseNotes\":\"" + escapeJson(notes) + "\"," +
                "\"publishedAt\":\"" + Instant.now() + "\"" +
                "}";
    }

    private Path safeResolve(String... segments) throws HttpError {
        Path target = config.storageRoot();
        for (String segment : segments) target = target.resolve(safeSegment(segment));
        target = target.normalize().toAbsolutePath();
        if (!target.startsWith(config.storageRoot())) throw new HttpError(403, "Pfad liegt außerhalb des Update-Speichers.");
        return target;
    }

    private void createSecureDirectories(Path directory) throws Exception {
        Files.createDirectories(directory);
        assertRealInside(directory);
    }

    private void assertRealParent(Path target) throws Exception {
        assertRealInside(target.getParent());
    }

    private void assertRealInside(Path target) throws Exception {
        Path real = target.toRealPath();
        if (!real.startsWith(realStorageRoot)) throw new HttpError(403, "Symlink verlässt den Update-Speicher.");
    }

    private String readLatestVersion(Path target) throws Exception {
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) return null;
        if (Files.isSymbolicLink(target)) throw new HttpError(403, "Symlink ist im Update-Speicher nicht erlaubt.");
        assertRealInside(target);
        String content = Files.readString(target, StandardCharsets.UTF_8);
        Matcher matcher = LATEST_VERSION.matcher(content);
        if (!matcher.find()) throw new HttpError(500, "Gespeichertes Update-Manifest ist beschädigt.");
        return matcher.group(1);
    }

    private void writeUtf8Atomic(Path target, String content) throws Exception {
        createSecureDirectories(target.getParent());
        assertRealParent(target);
        Path temporary = target.getParent().resolve("." + target.getFileName() + "." + ProcessHandle.current().pid() + "-" + randomHex(6) + ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                ByteBuffer data = StandardCharsets.UTF_8.encode(content);
                while (data.hasRemaining()) channel.write(data);
                channel.force(true);
            }
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void moveCreateOnly(Path source, Path target) throws Exception {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(source, target);
        } catch (FileAlreadyExistsException error) {
            throw new HttpError(409, "Diese Release-Version existiert bereits.");
        }
    }

    private void authenticate(HttpExchange exchange) throws HttpError {
        if (config.publishToken().isEmpty()) throw new HttpError(503, "Publishing ist auf diesem Server nicht aktiviert.");
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new HttpError(401, "Authentifizierung erforderlich.");
        }
        byte[] provided = authorization.substring(7).getBytes(StandardCharsets.UTF_8);
        byte[] expected = config.publishToken().getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(provided, expected)) throw new HttpError(403, "Ungültiger Publishing-Token.");
    }

    private static String decodeReleaseNotes(String encoded, String version) throws HttpError {
        if (encoded == null || encoded.isBlank()) return "Kiwi IDE " + version;
        if (encoded.length() > 8_192 || !encoded.matches("^[A-Za-z0-9+/]*={0,2}$")) throw new HttpError(400, "Release Notes sind ungültig oder zu lang.");
        try {
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (bytes.length > 4_000) throw new HttpError(400, "Release Notes sind ungültig oder zu lang.");
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new HttpError(400, "Release Notes sind ungültig.");
        }
    }

    private static SSLContext createSslContext(Config config) throws Exception {
        char[] password = config.tlsPassphrase().toCharArray();
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        if (config.tlsKeyStore() != null) {
            try (InputStream input = Files.newInputStream(config.tlsKeyStore())) {
                keyStore.load(input, password);
            }
        } else {
            keyStore.load(null, password);
            PrivateKey key = readPrivateKey(config.tlsKey());
            Collection<? extends Certificate> certificateCollection;
            try (InputStream input = Files.newInputStream(config.tlsCert())) {
                certificateCollection = CertificateFactory.getInstance("X.509").generateCertificates(input);
            }
            if (certificateCollection.isEmpty()) throw new IllegalArgumentException("TLS-Zertifikatskette ist leer.");
            Certificate[] chain = certificateCollection.toArray(Certificate[]::new);
            keyStore.setKeyEntry("kiwi-update", key, password, chain);
        }
        KeyManagerFactory manager = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        manager.init(keyStore, password);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(manager.getKeyManagers(), null, RANDOM);
        return context;
    }

    private static PrivateKey readPrivateKey(Path file) throws Exception {
        String pem = Files.readString(file, StandardCharsets.US_ASCII);
        if (!pem.contains("-----BEGIN PRIVATE KEY-----")) {
            throw new IllegalArgumentException("TLS-Schlüssel muss unverschlüsselt im PKCS#8-PEM-Format vorliegen.");
        }
        String encoded = pem.replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(Base64.getDecoder().decode(encoded));
        for (String algorithm : List.of("RSA", "EC", "DSA")) {
            try { return KeyFactory.getInstance(algorithm).generatePrivate(spec); } catch (Exception ignored) { }
        }
        throw new IllegalArgumentException("Nicht unterstützter PKCS#8-TLS-Schlüssel.");
    }

    private static Range parseRange(String value, long size) throws HttpError {
        if (value == null || value.isBlank()) return null;
        Matcher matcher = Pattern.compile("^bytes=(\\d*)-(\\d*)$").matcher(value);
        if (!matcher.matches() || (matcher.group(1).isEmpty() && matcher.group(2).isEmpty())) throw new HttpError(416, "Ungültiger Byte-Bereich.");
        long start;
        long end;
        try {
            if (matcher.group(1).isEmpty()) {
                long suffix = Long.parseLong(matcher.group(2));
                if (suffix <= 0) throw new NumberFormatException();
                start = Math.max(0, size - suffix);
                end = size - 1;
            } else {
                start = Long.parseLong(matcher.group(1));
                end = matcher.group(2).isEmpty() ? size - 1 : Long.parseLong(matcher.group(2));
            }
        } catch (NumberFormatException error) {
            throw new HttpError(416, "Ungültiger Byte-Bereich.");
        }
        if (start < 0 || start >= size || end < start) throw new HttpError(416, "Byte-Bereich liegt außerhalb der Datei.");
        return new Range(start, Math.min(end, size - 1));
    }

    private static List<String> decodeSegments(String rawPath) throws HttpError {
        List<String> result = new ArrayList<>();
        for (String raw : rawPath.split("/")) {
            if (raw.isEmpty()) continue;
            try {
                result.add(safeSegment(URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8)));
            } catch (IllegalArgumentException error) {
                throw new HttpError(400, "Ungültiger URL-Pfad.");
            }
        }
        return result;
    }

    private static String queryParameter(String rawQuery, String expectedName) throws HttpError {
        if (rawQuery == null) return null;
        for (String pair : rawQuery.split("&")) {
            String[] parts = pair.split("=", 2);
            try {
                String name = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
                if (name.equals(expectedName)) return URLDecoder.decode(parts.length > 1 ? parts[1] : "", StandardCharsets.UTF_8);
            } catch (IllegalArgumentException error) {
                throw new HttpError(400, "Ungültige URL-Query.");
            }
        }
        return null;
    }

    private static String safeSegment(String value) throws HttpError {
        if (value == null || value.isBlank() || value.equals(".") || value.equals("..") || value.indexOf('\0') >= 0
                || value.contains("/") || value.contains("\\")) throw new HttpError(400, "Ungültiger URL-Pfad.");
        return value;
    }

    private static String assertChannel(String value) throws HttpError {
        String channel = lower(value);
        if (!channel.equals("stable") && !channel.equals("beta")) throw new HttpError(400, "Unbekannter Update-Kanal.");
        return channel;
    }

    private static void sendJson(HttpExchange exchange, int status, String json) throws IOException {
        byte[] body = (json + System.lineSeparator()).getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        addCommonHeaders(headers);
        headers.set("Cache-Control", "no-store");
        headers.set("Content-Type", "application/json; charset=utf-8");
        boolean head = exchange.getRequestMethod().equals("HEAD");
        if (head) {
            headers.set("Content-Length", Integer.toString(body.length));
            exchange.sendResponseHeaders(status, -1);
            return;
        }
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream output = exchange.getResponseBody()) { output.write(body); }
    }

    private static void addCommonHeaders(Headers headers) {
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Cross-Origin-Resource-Policy", "same-site");
    }

    private static String escapeJson(String value) {
        StringBuilder result = new StringBuilder(value.length() + 16);
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            switch (current) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                case '\b' -> result.append("\\b");
                case '\f' -> result.append("\\f");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (current < 0x20) result.append(String.format("\\u%04x", (int) current));
                    else result.append(current);
                }
            }
        }
        return result.toString();
    }

    private static String encodePath(String value) {
        StringBuilder result = new StringBuilder();
        for (byte current : value.getBytes(StandardCharsets.UTF_8)) {
            int unsigned = current & 0xff;
            if ((unsigned >= 'a' && unsigned <= 'z') || (unsigned >= 'A' && unsigned <= 'Z')
                    || (unsigned >= '0' && unsigned <= '9') || "-._~".indexOf(unsigned) >= 0) result.append((char) unsigned);
            else result.append('%').append(String.format("%02X", unsigned));
        }
        return result.toString();
    }

    private static String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        return HexFormat.of().formatHex(value);
    }

    private static long parseLong(String value, long fallback) {
        try { return value == null ? fallback : Long.parseLong(value); } catch (NumberFormatException error) { return fallback; }
    }

    private static String lower(String value) { return String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT); }
    private static String safeMessage(Throwable error) { return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(); }

    private record UploadedArtifact(String filename, String sha256, long bytes, String mainHash) {
        UploadedArtifact(String filename, String sha256, long bytes) { this(filename, sha256, bytes, ""); }

        UploadedArtifact withMainHash(String value) { return new UploadedArtifact(filename, sha256, bytes, value); }
    }

    private record Range(long start, long end) { }

    private static final class HttpError extends Exception {
        private static final long serialVersionUID = 1L;
        private final int status;
        private HttpError(int status, String message) { super(message); this.status = status; }
    }

    private static final class Version {
        private final String value;
        private final int[] core;
        private final List<String> prerelease;

        private Version(String value, int[] core, List<String> prerelease) {
            this.value = value;
            this.core = core;
            this.prerelease = prerelease;
        }

        private static Version parse(String value) throws HttpError {
            String normalized = String.valueOf(value).trim();
            Matcher matcher = SEMVER.matcher(normalized);
            if (!matcher.matches()) throw new HttpError(400, "Ungültige semantische Version.");
            try {
                return new Version(normalized, new int[]{Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(3))},
                        matcher.group(4) == null ? List.of() : List.of(matcher.group(4).split("\\.")));
            } catch (NumberFormatException error) {
                throw new HttpError(400, "Ungültige semantische Version.");
            }
        }

        private static int compare(Version left, Version right) {
            for (int index = 0; index < 3; index++) {
                int compared = Integer.compare(left.core[index], right.core[index]);
                if (compared != 0) return compared;
            }
            if (left.prerelease.isEmpty() && right.prerelease.isEmpty()) return 0;
            if (left.prerelease.isEmpty()) return 1;
            if (right.prerelease.isEmpty()) return -1;
            for (int index = 0; index < Math.max(left.prerelease.size(), right.prerelease.size()); index++) {
                if (index >= left.prerelease.size()) return -1;
                if (index >= right.prerelease.size()) return 1;
                String a = left.prerelease.get(index);
                String b = right.prerelease.get(index);
                if (a.equals(b)) continue;
                boolean aNumber = a.matches("\\d+");
                boolean bNumber = b.matches("\\d+");
                if (aNumber && bNumber) return Long.compare(Long.parseLong(a), Long.parseLong(b));
                if (aNumber) return -1;
                if (bNumber) return 1;
                return a.compareTo(b);
            }
            return 0;
        }
    }

    private record Config(
            String host,
            int port,
            Path storageRoot,
            String publicBaseUrl,
            String publishToken,
            long maxUploadBytes,
            boolean allowDowngrade,
            Path tlsCert,
            Path tlsKey,
            Path tlsKeyStore,
            String tlsPassphrase,
            boolean behindHttpsProxy,
            boolean allowHttp,
            int workerThreads
    ) {
        private boolean tlsEnabled() { return tlsCert != null || tlsKeyStore != null; }

        private static Config fromEnvironment(Map<String, String> environment) throws Exception {
            String host = value(environment, "KIWI_UPDATE_HOST", "127.0.0.1");
            boolean allowHttp = flag(environment, "KIWI_UPDATE_ALLOW_HTTP");
            boolean behindProxy = flag(environment, "KIWI_UPDATE_BEHIND_HTTPS_PROXY");
            String certText = value(environment, "KIWI_UPDATE_TLS_CERT", "");
            String keyText = value(environment, "KIWI_UPDATE_TLS_KEY", "");
            String keyStoreText = value(environment, "KIWI_UPDATE_TLS_KEYSTORE", "");
            if (certText.isEmpty() != keyText.isEmpty()) throw new IllegalArgumentException("TLS-Zertifikat und TLS-Schlüssel müssen gemeinsam gesetzt werden.");
            if (!keyStoreText.isEmpty() && !certText.isEmpty()) throw new IllegalArgumentException("TLS-Keystore und TLS-PEM-Dateien dürfen nicht gleichzeitig gesetzt werden.");
            if (certText.isEmpty() && keyStoreText.isEmpty() && !behindProxy && !allowHttp) throw new IllegalArgumentException("HTTPS ist erforderlich. TLS konfigurieren oder KIWI_UPDATE_BEHIND_HTTPS_PROXY=1 für einen lokalen Reverse-Proxy setzen.");
            if (behindProxy && !isLoopbackHost(host)) throw new IllegalArgumentException("Hinter einem HTTPS-Reverse-Proxy darf der Update-Server nur an Loopback gebunden werden.");
            if (allowHttp && certText.isEmpty() && keyStoreText.isEmpty() && !behindProxy && !isLoopbackHost(host)) throw new IllegalArgumentException("Der unsichere lokale HTTP-Testmodus darf nur an Loopback gebunden werden.");
            String publicBaseUrl = validatePublicBaseUrl(environment.getOrDefault("KIWI_UPDATE_PUBLIC_BASE_URL", environment.get("KIWI_UPDATE_BASE_URL")), allowHttp);
            String token = value(environment, "KIWI_UPDATE_PUBLISH_TOKEN", "");
            if (!token.isEmpty() && token.getBytes(StandardCharsets.UTF_8).length < 32) throw new IllegalArgumentException("KIWI_UPDATE_PUBLISH_TOKEN muss mindestens 32 Byte lang sein.");
            return new Config(
                    host,
                    integer(environment, "KIWI_UPDATE_PORT", 8787, 0, 65535),
                    Path.of(value(environment, "KIWI_UPDATE_STORAGE_DIR", "update-storage")).toAbsolutePath().normalize(),
                    publicBaseUrl,
                    token,
                    longInteger(environment, "KIWI_UPDATE_MAX_BYTES", DEFAULT_MAX_BYTES, 1, DEFAULT_MAX_BYTES),
                    flag(environment, "KIWI_UPDATE_ALLOW_DOWNGRADE"),
                    certText.isEmpty() ? null : Path.of(certText).toAbsolutePath().normalize(),
                    keyText.isEmpty() ? null : Path.of(keyText).toAbsolutePath().normalize(),
                    keyStoreText.isEmpty() ? null : Path.of(keyStoreText).toAbsolutePath().normalize(),
                    value(environment, "KIWI_UPDATE_TLS_KEYSTORE_PASSWORD", value(environment, "KIWI_UPDATE_TLS_PASSPHRASE", "changeit")),
                    behindProxy,
                    allowHttp,
                    integer(environment, "KIWI_UPDATE_WORKERS", Math.max(4, Runtime.getRuntime().availableProcessors()), 2, 256)
            );
        }

        private static String validatePublicBaseUrl(String value, boolean allowHttp) throws Exception {
            URI uri;
            try { uri = URI.create(Objects.requireNonNullElse(value, "").trim()); } catch (Exception error) { throw new IllegalArgumentException("KIWI_UPDATE_PUBLIC_BASE_URL ist keine gültige URL."); }
            if (uri.getScheme() == null || uri.getHost() == null) throw new IllegalArgumentException("KIWI_UPDATE_PUBLIC_BASE_URL ist keine gültige URL.");
            if (!uri.getScheme().equalsIgnoreCase("https") && !(allowHttp && uri.getScheme().equalsIgnoreCase("http"))) throw new IllegalArgumentException("Die öffentliche Update-Adresse muss HTTPS verwenden.");
            if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException("Die öffentliche Update-Adresse darf keine Zugangsdaten, Query oder Fragmente enthalten.");
            String normalized = uri.toString().replaceAll("/+$", "");
            return normalized;
        }

        private static boolean isLoopbackHost(String host) { return host.equals("127.0.0.1") || host.equals("::1") || host.equalsIgnoreCase("localhost"); }
        private static boolean flag(Map<String, String> environment, String name) { return "1".equals(environment.get(name)); }
        private static String value(Map<String, String> environment, String name, String fallback) { return environment.getOrDefault(name, fallback).trim(); }
        private static int integer(Map<String, String> environment, String name, int fallback, int min, int max) {
            long value = longInteger(environment, name, fallback, min, max);
            return (int) value;
        }
        private static long longInteger(Map<String, String> environment, String name, long fallback, long min, long max) {
            String raw = environment.get(name);
            long value;
            try { value = raw == null || raw.isBlank() ? fallback : Long.parseLong(raw); } catch (NumberFormatException error) { throw new IllegalArgumentException(name + " muss eine Ganzzahl sein."); }
            if (value < min || value > max) throw new IllegalArgumentException(name + " muss zwischen " + min + " und " + max + " liegen.");
            return value;
        }
    }
}
