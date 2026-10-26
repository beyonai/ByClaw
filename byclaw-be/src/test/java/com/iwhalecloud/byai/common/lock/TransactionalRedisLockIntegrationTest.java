package com.iwhalecloud.byai.common.lock;

import static org.assertj.core.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

class TransactionalRedisLockIntegrationTest {
    private DriverManagerDataSource source() {
        return new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
    }

    @Test void twoInstancesRemainExclusiveUntilCommitBeyondInitialLease() throws Exception {
        try (var redis = new DisposableRedis()) {
            var first = new TransactionalRedisLockService(redis.registry(600L));
            var second = new TransactionalRedisLockService(redis.registry(600L));
            var source = source();
            var jdbc = new JdbcTemplate(source);
            jdbc.execute("create table mutation (id int)");
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
            jdbc.execute("create table byai_datasource (datasource_id bigint)");
            jdbc.update("insert into byai_datasource values (1)");
            var firstMapper = mapper(first, source);
            var secondMapper = mapper(second, source);
            var held = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            try (var executor = Executors.newFixedThreadPool(2)) {
                var owner = executor.submit(() -> transaction.executeWithoutResult(status -> {
                    firstMapper.lockRow(1L);
                    firstMapper.lockRow(1L); // only one release for repeated acquisition
                    jdbc.update("insert into mutation values (1)");
                    held.countDown();
                    await(release);
                }));
                assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
                var waiter = executor.submit(() -> transaction.execute(status -> {
                    secondMapper.lockRow(1L);
                    return jdbc.queryForObject("select count(*) from mutation", Integer.class);
                }));
                try {
                    assertThatThrownBy(() -> waiter.get(1500, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                } finally { release.countDown(); }
                owner.get(5, TimeUnit.SECONDS);
                assertThat(waiter.get(5, TimeUnit.SECONDS)).isEqualTo(1);
            }
        }
    }

    @Test void ownershipLostBeforeCommitRollsBackWritesAndDoesNotDeleteNewOwner() throws Exception {
        try (var redis = new DisposableRedis()) {
            var locks = new TransactionalRedisLockService(redis.registry(60_000L));
            var source = source();
            var jdbc = new JdbcTemplate(source);
            jdbc.execute("create table mutation (id int)");
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
            byte[] key = (redis.prefix + ":resource:1").getBytes(StandardCharsets.UTF_8);
            assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
                locks.acquire("resource:1");
                jdbc.update("insert into mutation values (1)");
                try (var connection = redis.connection.getConnection()) {
                    connection.stringCommands().set(key, "new-owner".getBytes(StandardCharsets.UTF_8));
                }
            })).isInstanceOf(IllegalStateException.class);
            assertThat(jdbc.queryForObject("select count(*) from mutation", Integer.class)).isZero();
            try (var connection = redis.connection.getConnection()) {
                assertThat(new String(connection.stringCommands().get(key), StandardCharsets.UTF_8)).isEqualTo("new-owner");
            }
        }
    }

    @Test void rollbackReleasesAndMissingTransactionFailsClosed() throws Exception {
        try (var redis = new DisposableRedis()) {
            var locks = new TransactionalRedisLockService(redis.registry(60_000L));
            assertThatThrownBy(() -> locks.acquire("resource:1")).isInstanceOf(IllegalStateException.class);
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source()));
            transaction.executeWithoutResult(status -> { locks.acquire("resource:1"); status.setRollbackOnly(); });
            var other = redis.registry(60_000L).obtain("resource:1");
            assertThat(other.tryLock()).isTrue();
            other.unlock();
        }
    }

    @Test void committedLockIsReleasedBeforeApplicationCallbacks() throws Exception {
        try (var redis = new DisposableRedis()) {
            var locks = new TransactionalRedisLockService(redis.registry(60_000L));
            var contender = redis.registry(60_000L).obtain("resource:1");
            var completed = new java.util.concurrent.atomic.AtomicBoolean();
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source()));
            transaction.executeWithoutResult(status -> {
                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override public void afterCommit() {
                            assertThat(contender.tryLock()).isTrue();
                            contender.unlock();
                            completed.set(true);
                        }
                    });
                locks.acquire("resource:1");
            });
            assertThat(completed).isTrue();
        }
    }

    @Test void unavailableRedisCannotReachTheMutation() throws Exception {
        try (var redis = new DisposableRedis()) {
            var locks = new TransactionalRedisLockService(redis.registry(60_000L));
            redis.stopServer();
            var mutation = new java.util.concurrent.atomic.AtomicBoolean();
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source()));
            assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
                locks.acquire("resource:1");
                mutation.set(true);
            })).isInstanceOf(RuntimeException.class);
            assertThat(mutation).isFalse();
        }
    }

    private com.iwhalecloud.byai.manager.mapper.datasource.DataSourceMapper mapper(
            TransactionalRedisLockService locks, javax.sql.DataSource source) {
        var config = new org.apache.ibatis.session.Configuration();
        config.setEnvironment(new org.apache.ibatis.mapping.Environment("lock-test",
            new org.mybatis.spring.transaction.SpringManagedTransactionFactory(), source));
        config.addInterceptor(new RedisTransactionLockInterceptor(locks));
        config.addMapper(com.iwhalecloud.byai.manager.mapper.datasource.DataSourceMapper.class);
        var template = new org.mybatis.spring.SqlSessionTemplate(new org.apache.ibatis.session.SqlSessionFactoryBuilder().build(config));
        return template.getMapper(com.iwhalecloud.byai.manager.mapper.datasource.DataSourceMapper.class);
    }

    private static void await(CountDownLatch latch) {
        try { if (!latch.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test timeout"); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
    }
}
