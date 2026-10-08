package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.transaction.support.TransactionTemplate;

/** 本地独立 Redis 验证跨实例互斥、续租及事务结束释放，不连接开发或生产服务。 */
@EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
class SkillImportRedisLockIntegrationTest {

    @Test
    void independentInstancesStayExclusiveBeyondTheOriginalLeaseAndReleaseAfterCommit() throws Exception {
        int port = Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT"));
        var connectionFactory = new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1", port));
        connectionFactory.afterPropertiesSet();
        connectionFactory.start();
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.initialize();
        String prefix = "test:skill-import:" + UUID.randomUUID();
        var firstRegistry = new RedisLockRegistry(connectionFactory, prefix, 600L);
        firstRegistry.setRenewalTaskScheduler(scheduler);
        var secondRegistry = new RedisLockRegistry(connectionFactory, prefix, 600L);
        var executor = Executors.newSingleThreadExecutor();
        CountDownLatch acquired = new CountDownLatch(1);
        CountDownLatch complete = new CountDownLatch(1);
        try {
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(
                new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID(), "sa", "")));
            var service = new SkillImportLockService(firstRegistry);
            var first = executor.submit(() -> transaction.executeWithoutResult(status -> {
                service.acquire("demo");
                acquired.countDown();
                try {
                    if (!complete.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test timeout");
                }
                catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(exception);
                }
            }));
            assertThat(acquired.await(5, TimeUnit.SECONDS)).isTrue();
            var competing = secondRegistry.obtain("demo");
            // 一次有界等待超过最初的租约；期间不能在另一个实例取得同编码锁。
            boolean unexpectedlyAcquired = competing.tryLock(1_500, TimeUnit.MILLISECONDS);
            if (unexpectedlyAcquired) competing.unlock();
            assertThat(unexpectedlyAcquired).isFalse();
            complete.countDown();
            first.get(5, TimeUnit.SECONDS);
            assertThat(competing.tryLock(2, TimeUnit.SECONDS)).isTrue();
            competing.unlock();
        }
        finally {
            complete.countDown();
            executor.shutdownNow();
            firstRegistry.destroy();
            secondRegistry.destroy();
            scheduler.shutdown();
            connectionFactory.destroy();
        }
    }
    @Test
    void lostRedisLeaseRollsBackTheDatabaseBeforeCommit() {
        int port = Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT"));
        var connectionFactory = new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1", port));
        connectionFactory.afterPropertiesSet();
        String prefix = "test:skill-import:" + UUID.randomUUID();
        var registry = new RedisLockRegistry(connectionFactory, prefix);
        var dataSource = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        jdbc.execute("create table imported_skill (code varchar(100))");
        try {
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
            var service = new SkillImportLockService(registry);
            assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
                service.acquire("demo");
                jdbc.update("insert into imported_skill (code) values (?)", "demo");
                try (var connection = connectionFactory.getConnection()) {
                    connection.keyCommands().del((prefix + ":demo").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
            })).isInstanceOf(IllegalStateException.class);
            assertThat(jdbc.queryForObject("select count(*) from imported_skill", Integer.class)).isZero();
        }
        finally {
            jdbc.execute("drop all objects");
            registry.destroy();
            connectionFactory.destroy();
        }
    }
}
