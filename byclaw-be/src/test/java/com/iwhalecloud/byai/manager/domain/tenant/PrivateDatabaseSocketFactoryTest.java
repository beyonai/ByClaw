package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.management.UnixOperatingSystemMXBean;
import java.io.*;
import java.lang.management.ManagementFactory;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.util.*;
import java.util.concurrent.*;
import javax.net.SocketFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Real JDK WebSocket connections to a loopback-only wire fixture; no cloud or database required. */
@Timeout(20)
class PrivateDatabaseSocketFactoryTest {
    private static final String TOKEN = "test-only-traffic-token";

    @Test
    void rejectsPublicAndClientSelectedDatabaseTargets() {
        for (String url : List.of(
            "ws://15432-test.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql",
            "wss://15432-test.cn-beijing.sandbox.aliyuncs.com/postgresql",
            "wss://127.0.0.1/postgresql",
            "wss://15432-test.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql?target=other",
            "wss://15432-test.cn-beijing-vpc.sandbox.aliyuncs.com:8443/postgresql",
            "wss://user@15432-test.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql")) {
            assertThrows(IllegalArgumentException.class, () -> PrivateDatabaseSocketFactory.privateUrl(url));
        }
    }

    @Test
    void carriesTokenAndPresentsSeparateBinaryMessagesAsOneByteStream() throws Exception {
        byte[] request = new byte[65539];
        new Random(42).nextBytes(request);
        try (WireServer server = new WireServer(peer -> {
            assertArrayEquals(request, peer.input().readNBytes(request.length));
            peer.send(new byte[] {0, (byte) 255, 1});
            peer.send(new byte[] {2, 3});
            peer.awaitClientClose();
        }); Socket socket = connect(server)) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write(request);
            assertArrayEquals(new byte[] {0, (byte) 255, 1, 2, 3}, socket.getInputStream().readNBytes(5));
            socket.close();
            server.complete();
        }
    }

    @Test
    void splitsLargeWritesWithoutChangingPostgresWireBytes() throws Exception {
        byte[] request = new byte[5 * 1024 * 1024 + 17];
        new Random(84).nextBytes(request);
        try (WireServer server = new WireServer(peer -> {
            assertArrayEquals(request, peer.input().readNBytes(request.length));
            assertTrue(peer.largestMessage <= 65536, "transport must bound each binary message");
            assertTrue(peer.binaryMessages > 1);
            peer.send(new byte[] {42});
            peer.awaitClientClose();
        }); Socket socket = connect(server)) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(request);
            assertEquals(42, socket.getInputStream().read());
            socket.close();
            server.complete();
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 10000})
    void honorsReadTimeoutAndUnblocksPendingReadWhenClosed(int readTimeout) throws Exception {
        try (WireServer server = new WireServer(Peer::awaitClientClose); Socket socket = connect(server);
             ExecutorService reader = Executors.newSingleThreadExecutor()) {
            socket.setSoTimeout(60);
            assertThrows(SocketTimeoutException.class, () -> socket.getInputStream().read());
            socket.setSoTimeout(readTimeout);
            CountDownLatch started = new CountDownLatch(1);
            Future<Integer> read = reader.submit(() -> {
                started.countDown();
                return socket.getInputStream().read();
            });
            assertTrue(started.await(1, TimeUnit.SECONDS));
            Thread.sleep(100);
            assertFalse(read.isDone(), "fixture must close while a read is pending");
            socket.close();
            try {
                assertEquals(-1, read.get(2, TimeUnit.SECONDS));
            } catch (ExecutionException error) {
                assertInstanceOf(IOException.class, error.getCause());
            }
            assertTrue(socket.isClosed());
            server.complete();
        }
    }

    @Test
    void refusesMissingTrafficTokenBeforeConnecting() throws Exception {
        try (Socket socket = new PrivateDatabaseSocketFactory.TunnelSocket(URI.create("ws://127.0.0.1:1/postgresql"), "")) {
            assertThrows(IOException.class, () -> socket.connect(new InetSocketAddress("127.0.0.1", 1)));
        }
    }

    @Test
    void postgresBufferOptionsDoNotAllocateNativeSockets() throws Exception {
        var bean = ManagementFactory.getOperatingSystemMXBean();
        org.junit.jupiter.api.Assumptions.assumeTrue(bean instanceof UnixOperatingSystemMXBean);
        var unix = (UnixOperatingSystemMXBean) bean;
        // Warm up lazy JDK initialization before counting descriptors.
        try (Socket socket = unopened()) { socket.getSendBufferSize(); socket.getReceiveBufferSize(); }
        long before = unix.getOpenFileDescriptorCount();
        List<Socket> sockets = new ArrayList<>();
        try {
            for (int index = 0; index < 64; index++) {
                Socket socket = unopened();
                sockets.add(socket);
                socket.setSendBufferSize(32768);
                socket.setReceiveBufferSize(32768);
                assertTrue(socket.getSendBufferSize() > 0);
                assertTrue(socket.getReceiveBufferSize() > 0);
                assertFalse(socket.isBound());
            }
            assertTrue(unix.getOpenFileDescriptorCount() - before < 8,
                "PostgreSQL buffer probes must not create unused native sockets");
        } finally {
            for (Socket socket : sockets) socket.close();
        }
    }

    @Test
    void realPostgresDriverCanInitializeQueryAndCloseOverTheSocketAdapter() throws Exception {
        try (WireServer server = new WireServer(peer -> {
            DataInputStream input = new DataInputStream(peer.input());
            int startupSize = input.readInt();
            byte[] startup = input.readNBytes(startupSize - 4);
            // The installed PostgreSQL-compatible connector negotiates its own minor version.
            assertEquals(3, new DataInputStream(new ByteArrayInputStream(startup)).readInt() >>> 16);
            peer.pg('R', new byte[4]); // AuthenticationOk
            peer.pg('S', cstrings("server_version", "14.0"));
            peer.pg('S', cstrings("client_encoding", "UTF8"));
            peer.pg('S', cstrings("integer_datetimes", "on"));
            peer.pg('Z', new byte[] {'I'});
            while (true) {
                int type = input.read();
                if (type < 0) break;
                int length = input.readInt();
                String sql = new String(input.readNBytes(length - 4), StandardCharsets.UTF_8);
                if (type == 'X') break;
                assertEquals('Q', type);
                boolean versionProbe = sql.toUpperCase(Locale.ROOT).contains("SELECT VERSION()");
                boolean compatibilityProbe = sql.toUpperCase(Locale.ROOT).contains("SELECT DATCOMPATIBILITY");
                boolean extensionProbe = sql.toUpperCase(Locale.ROOT).contains("SELECT COUNT(1) FROM PG_EXTENSION");
                boolean modeProbe = sql.toUpperCase(Locale.ROOT).contains("SHOW DOLPHIN.B_COMPATIBILITY_MODE");
                boolean text = versionProbe || compatibilityProbe || modeProbe;
                if (sql.toUpperCase(Locale.ROOT).contains("FROM PG_CATALOG.PG_TYPE")
                    || sql.toUpperCase(Locale.ROOT).contains("FROM PG_SETTINGS")) {
                    // Optional openGauss type discovery has an empty result on this PostgreSQL fixture.
                    peer.pg('T', new byte[] {0, 0});
                    peer.pg('C', cstrings("SELECT 0"));
                } else if (text || extensionProbe || sql.toUpperCase(Locale.ROOT).contains("SELECT 1")) {
                    ByteArrayOutputStream description = new ByteArrayOutputStream();
                    DataOutputStream fields = new DataOutputStream(description);
                    fields.writeShort(1); fields.write(cstrings("answer")); fields.writeInt(0);
                    fields.writeShort(0); fields.writeInt(text ? 25 : 23); fields.writeShort(text ? -1 : 4);
                    fields.writeInt(-1); fields.writeShort(0);
                    peer.pg('T', description.toByteArray());
                    ByteArrayOutputStream row = new ByteArrayOutputStream();
                    DataOutputStream values = new DataOutputStream(row);
                    String result = versionProbe ? "PostgreSQL 14.0" : compatibilityProbe ? "PG"
                        : extensionProbe ? "0" : modeProbe ? "off" : "1";
                    byte[] value = result.getBytes(StandardCharsets.UTF_8);
                    values.writeShort(1); values.writeInt(value.length); values.write(value);
                    peer.pg('D', row.toByteArray());
                    peer.pg('C', cstrings("SELECT 1"));
                } else {
                    assertTrue(sql.stripLeading().toUpperCase(Locale.ROOT).startsWith("SET "), "Unhandled fixture query: " + sql);
                    peer.pg('C', cstrings("SET"));
                }
                peer.pg('Z', new byte[] {'I'});
            }
        })) {
            Properties properties = new Properties();
            properties.setProperty("user", "fixture");
            properties.setProperty("socketFactory", LoopbackSocketFactory.class.getName());
            properties.setProperty("fixtureUrl", server.uri().toString());
            properties.setProperty("sslmode", "disable");
            properties.setProperty("gssEncMode", "disable");
            properties.setProperty("preferQueryMode", "simple");
            properties.setProperty("socketTimeout", "5");
            try (var connection = DriverManager.getConnection("jdbc:postgresql://127.0.0.1:5432/fixture", properties);
                 var statement = connection.createStatement(); var result = statement.executeQuery("SELECT 1")) {
                assertTrue(result.next());
                assertEquals(1, result.getInt(1));
                assertFalse(result.next());
            } catch (Exception error) {
                try { server.complete(); } catch (Exception peerError) { error.addSuppressed(peerError); }
                throw error;
            }
            server.complete();
        }
    }

    /** JDBC instantiates this by its standard public Properties constructor. */
    public static final class LoopbackSocketFactory extends SocketFactory {
        private final URI uri;
        public LoopbackSocketFactory(Properties properties) { uri = URI.create(properties.getProperty("fixtureUrl")); }
        @Override public Socket createSocket() { return new PrivateDatabaseSocketFactory.TunnelSocket(uri, TOKEN); }
        @Override public Socket createSocket(String host, int port) throws IOException { Socket socket = createSocket(); socket.connect(new InetSocketAddress(host, port)); return socket; }
        @Override public Socket createSocket(InetAddress host, int port) throws IOException { return createSocket(host.getHostAddress(), port); }
        @Override public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { return createSocket(host, port); }
        @Override public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { return createSocket(host, port); }
    }

    private static Socket unopened() {
        return new PrivateDatabaseSocketFactory.TunnelSocket(URI.create("ws://127.0.0.1:1/postgresql"), TOKEN);
    }
    private static Socket connect(WireServer server) throws IOException {
        Socket socket = new PrivateDatabaseSocketFactory.TunnelSocket(server.uri(), TOKEN);
        socket.connect(new InetSocketAddress("127.0.0.1", server.listener.getLocalPort()), 3000);
        return socket;
    }
    private static byte[] cstrings(String... values) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (String value : values) { bytes.write(value.getBytes(StandardCharsets.UTF_8)); bytes.write(0); }
        return bytes.toByteArray();
    }
    @FunctionalInterface private interface Conversation { void run(Peer peer) throws Exception; }

    private static final class WireServer implements AutoCloseable {
        final ServerSocket listener = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
        final ExecutorService worker = Executors.newSingleThreadExecutor();
        final Future<?> task;
        volatile Socket accepted;
        WireServer(Conversation conversation) throws IOException {
            task = worker.submit(() -> {
                try (Socket socket = listener.accept()) {
                    accepted = socket;
                    socket.setSoTimeout(10000);
                    Peer peer = new Peer(socket);
                    peer.upgrade();
                    conversation.run(peer);
                } catch (Exception error) { throw new CompletionException(error); }
            });
        }
        URI uri() { return URI.create("ws://127.0.0.1:" + listener.getLocalPort() + "/postgresql"); }
        void complete() throws Exception { task.get(10, TimeUnit.SECONDS); }
        @Override public void close() throws Exception {
            listener.close();
            if (accepted != null) accepted.close();
            worker.shutdownNow();
            assertTrue(worker.awaitTermination(2, TimeUnit.SECONDS));
        }
    }

    private static final class Peer {
        final DataInputStream wire;
        final DataOutputStream output;
        int largestMessage;
        int binaryMessages;
        Peer(Socket socket) throws IOException { wire = new DataInputStream(socket.getInputStream()); output = new DataOutputStream(socket.getOutputStream()); }
        void upgrade() throws Exception {
            ByteArrayOutputStream header = new ByteArrayOutputStream();
            while (!header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) {
                int next = wire.read();
                if (next < 0 || header.size() > 16384) throw new IOException("Invalid handshake");
                header.write(next);
            }
            String[] lines = header.toString(StandardCharsets.US_ASCII).split("\r\n");
            assertEquals("GET /postgresql HTTP/1.1", lines[0]);
            Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
            for (int index = 1; index < lines.length; index++) {
                int colon = lines[index].indexOf(':');
                if (colon > 0) headers.put(lines[index].substring(0, colon), lines[index].substring(colon + 1).trim());
            }
            assertEquals(TOKEN, headers.get("e2b-traffic-access-token"));
            String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest(
                (headers.get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
            output.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            output.flush();
        }
        byte[] message() throws IOException {
            int first = wire.read();
            if (first < 0) return null;
            int second = wire.readUnsignedByte();
            assertEquals(0x82, first, "client sends complete binary messages");
            assertTrue((second & 128) != 0, "client frames must be masked");
            long length = second & 127;
            if (length == 126) length = wire.readUnsignedShort();
            else if (length == 127) length = wire.readLong();
            assertTrue(length >= 0 && length <= 65536, "bounded transport message");
            byte[] mask = wire.readNBytes(4);
            byte[] data = wire.readNBytes((int) length);
            assertEquals(length, data.length);
            for (int index = 0; index < data.length; index++) data[index] ^= mask[index % 4];
            largestMessage = Math.max(largestMessage, data.length);
            binaryMessages++;
            return data;
        }
        InputStream input() {
            return new InputStream() {
                byte[] chunk = new byte[0]; int position;
                @Override public int read() throws IOException {
                    while (position == chunk.length) { chunk = message(); position = 0; if (chunk == null) return -1; }
                    return chunk[position++] & 255;
                }
            };
        }
        void send(byte[] bytes) throws IOException {
            output.writeByte(0x82);
            if (bytes.length < 126) output.writeByte(bytes.length);
            else { output.writeByte(126); output.writeShort(bytes.length); }
            output.write(bytes); output.flush();
        }
        void pg(int type, byte[] payload) throws IOException {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream message = new DataOutputStream(bytes);
            message.writeByte(type); message.writeInt(payload.length + 4); message.write(payload);
            send(bytes.toByteArray());
        }
        void awaitClientClose() throws IOException { while (wire.read() >= 0) { /* Drain until socket abort/close. */ } }
    }
}
