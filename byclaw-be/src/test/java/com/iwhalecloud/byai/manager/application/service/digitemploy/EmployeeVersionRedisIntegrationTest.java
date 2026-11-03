package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.transaction.support.TransactionTemplate;

/** Only uses explicitly enabled disposable local Redis instances; never connects to application Redis. */
class EmployeeVersionRedisIntegrationTest {

    @ParameterizedTest
    @ValueSource(strings = {"standalone", "cluster"})
    void renewsAcrossInstancesAndReleasesAfterCommitWithoutBlockingOtherEmployees(String mode) throws Exception {
        try (var fixture = new Fixture(mode)) {
            var executor = Executors.newSingleThreadExecutor();
            var acquired = new CountDownLatch(1);
            var complete = new CountDownLatch(1);
            try {
                var operation = executor.submit(() -> fixture.transaction.executeWithoutResult(status -> {
                    fixture.service.acquire(22L, 33L);
                    acquired.countDown();
                    try {
                        if (!complete.await(8, TimeUnit.SECONDS)) throw new IllegalStateException("test timeout");
                    } catch (InterruptedException error) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(error);
                    }
                }));
                assertThat(acquired.await(5, TimeUnit.SECONDS)).isTrue();
                var competitor = fixture.otherVersions.obtain("22:33");
                // Wait past the 600ms original lease; automatic renewal must retain ownership.
                boolean stolen = competitor.tryLock(1_500, TimeUnit.MILLISECONDS);
                if (stolen) competitor.unlock();
                assertThat(stolen).isFalse();
                fixture.transaction.executeWithoutResult(status -> fixture.service.acquire(22L, 34L));
                complete.countDown();
                operation.get(5, TimeUnit.SECONDS);
                assertThat(competitor.tryLock(2, TimeUnit.SECONDS)).isTrue();
                competitor.unlock();
                var business = fixture.otherBusiness.obtain("resource:33");
                assertThat(business.tryLock(2, TimeUnit.SECONDS)).isTrue();
                business.unlock();
            } finally {
                complete.countDown();
                executor.shutdownNow();
                executor.awaitTermination(5, TimeUnit.SECONDS);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"standalone", "cluster"})
    void losingVersionLeaseRollsBackDatabaseChanges(String mode) {
        try (var fixture = new Fixture(mode)) {
            fixture.jdbc.execute("create table version_write (version_id bigint)");
            assertThatThrownBy(() -> fixture.transaction.executeWithoutResult(status -> {
                fixture.service.acquire(22L, 33L);
                fixture.jdbc.update("insert into version_write values (1)");
                try (var connection = fixture.factory.getConnection()) {
                    connection.keyCommands().del((fixture.prefix + ":22:33").getBytes(StandardCharsets.UTF_8));
                }
            })).isInstanceOf(IllegalStateException.class);
            assertThat(fixture.jdbc.queryForObject("select count(*) from version_write", Integer.class)).isZero();
        }
    }

    private static class Fixture implements AutoCloseable {
        final JedisConnectionFactory factory;
        final ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        final String prefix = "test:employee-version:" + UUID.randomUUID();
        final RedisLockRegistry versions;
        final RedisLockRegistry otherVersions;
        final RedisLockRegistry business;
        final RedisLockRegistry otherBusiness;
        final EmployeeVersionLock service;
        final JdbcTemplate jdbc;
        final TransactionTemplate transaction;

        Fixture(String mode) {
            String port = System.getenv("cluster".equals(mode)
                ? "BYCLAW_TEST_REDIS_CLUSTER_PORT" : "BYCLAW_TEST_REDIS_PORT");
            assumeTrue(port != null && port.matches("[0-9]+"), "Disposable local Redis must be enabled explicitly");
            factory = "cluster".equals(mode)
                ? new JedisConnectionFactory(new RedisClusterConfiguration(List.of("127.0.0.1:" + port)))
                : new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1", Integer.parseInt(port)));
            factory.afterPropertiesSet();
            factory.start();
            scheduler.initialize();
            versions = new RedisLockRegistry(factory, prefix, 600L);
            versions.setRenewalTaskScheduler(scheduler);
            otherVersions = new RedisLockRegistry(factory, prefix, 600L);
            business = new RedisLockRegistry(factory, prefix + ":business", 600L);
            business.setRenewalTaskScheduler(scheduler);
            otherBusiness = new RedisLockRegistry(factory, prefix + ":business", 600L);
            service = new EmployeeVersionLock(versions, new TransactionalRedisLockService(business));
            var dataSource = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID()
                + ";DB_CLOSE_DELAY=-1", "sa", "");
            jdbc = new JdbcTemplate(dataSource);
            transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        }

        @Override public void close() {
            jdbc.execute("drop all objects");
            versions.destroy();
            otherVersions.destroy();
            business.destroy();
            otherBusiness.destroy();
            scheduler.shutdown();
            factory.destroy();
        }
    }
}
