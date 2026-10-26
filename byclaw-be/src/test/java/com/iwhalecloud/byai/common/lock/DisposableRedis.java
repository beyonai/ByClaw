package com.iwhalecloud.byai.common.lock;

import java.net.ServerSocket;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** Starts an isolated loopback Redis, never a configured application Redis. */
public final class DisposableRedis implements AutoCloseable {
    private final Process process;
    private final Path log;
    private final Thread cleanup;
    public final JedisConnectionFactory connection;
    public final ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    public final String prefix = "test:business:" + UUID.randomUUID();
    private final java.util.List<RedisLockRegistry> registries = new java.util.ArrayList<>();

    public DisposableRedis() throws Exception {
        int port;
        try (var socket = new ServerSocket(0)) { port = socket.getLocalPort(); }
        log = Files.createTempFile("byclaw-test-redis-", ".log");
        process = new ProcessBuilder("redis-server", "--bind", "127.0.0.1", "--port", Integer.toString(port),
            "--save", "", "--appendonly", "no").redirectErrorStream(true).redirectOutput(log.toFile()).start();
        cleanup = new Thread(process::destroyForcibly, "dispose-test-redis");
        Runtime.getRuntime().addShutdownHook(cleanup);
        try {
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
            while (true) {
                try (Socket ignored = new Socket("127.0.0.1", port)) { break; }
                catch (java.io.IOException error) {
                    if (!process.isAlive() || System.nanoTime() > deadline) throw error;
                    Thread.sleep(20);
                }
            }
            connection = new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1", port));
            connection.afterPropertiesSet();
            connection.start();
            scheduler.setDaemon(true);
            scheduler.initialize();
        } catch (Exception error) {
            process.destroyForcibly();
            Runtime.getRuntime().removeShutdownHook(cleanup);
            Files.deleteIfExists(log);
            throw error;
        }
    }

    public RedisLockRegistry registry(long ttl) {
        var registry = new RedisLockRegistry(connection, prefix, ttl);
        registry.setRenewalTaskScheduler(scheduler);
        registries.add(registry);
        return registry;
    }

    public void stopServer() throws Exception {
        process.destroy();
        if (!process.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) process.destroyForcibly().waitFor();
    }

    @Override public void close() throws Exception {
        for (var registry : registries) registry.destroy();
        scheduler.shutdown();
        connection.destroy();
        process.destroy();
        if (!process.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) process.destroyForcibly().waitFor();
        Runtime.getRuntime().removeShutdownHook(cleanup);
        Files.deleteIfExists(log);
    }
}
