package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.locks.Lock;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.integration.support.locks.DefaultLockRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

class SkillImportLockServiceTest {

    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private SkillImportLockService locks;
    private TransactionTemplate transaction;
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        var dataSource = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("create table imported_skill (code varchar(100))");
        transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        locks = new SkillImportLockService(new DefaultLockRegistry());
    }

    @AfterEach
    void tearDown() {
        workers.shutdownNow();
        jdbc.execute("drop all objects");
        Thread.interrupted();
    }

    @Test
    void sameCodeWaitsUntilDatabaseCommitAndSeesTheCommittedImport() throws Exception {
        CountDownLatch firstLocked = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);
        CountDownLatch secondStarted = new CountDownLatch(1);
        var first = workers.submit(() -> transaction.executeWithoutResult(status -> {
            locks.acquire("demo");
            locks.acquire("demo"); // 同事务重复取得不能产生未释放的重入次数。
            jdbc.update("insert into imported_skill (code) values (?)", "demo");
            firstLocked.countDown();
            await(allowCommit);
        }));
        assertThat(firstLocked.await(5, TimeUnit.SECONDS)).isTrue();
        var second = workers.submit(() -> transaction.execute(status -> {
            secondStarted.countDown();
            locks.acquire("demo");
            return jdbc.queryForObject("select count(*) from imported_skill where code = ?", Integer.class, "demo");
        }));
        try {
            assertThat(secondStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> second.get(150, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        }
        finally {
            allowCommit.countDown();
        }
        first.get(5, TimeUnit.SECONDS);
        assertThat(second.get(5, TimeUnit.SECONDS)).isEqualTo(1);
    }

    @Test
    void differentCodesDoNotBlockEachOther() throws Exception {
        CountDownLatch firstLocked = new CountDownLatch(1);
        CountDownLatch finishFirst = new CountDownLatch(1);
        var first = workers.submit(() -> transaction.executeWithoutResult(status -> {
            locks.acquire("demo-a");
            firstLocked.countDown();
            await(finishFirst);
        }));
        try {
            assertThat(firstLocked.await(5, TimeUnit.SECONDS)).isTrue();
            workers.submit(() -> transaction.executeWithoutResult(status -> locks.acquire("demo-b")))
                .get(5, TimeUnit.SECONDS);
        }
        finally {
            finishFirst.countDown();
        }
        first.get(5, TimeUnit.SECONDS);
    }

    @Test
    void rollbackReleasesTheLockWithoutPublishingTheImport() throws Exception {
        transaction.executeWithoutResult(status -> {
            locks.acquire("demo");
            jdbc.update("insert into imported_skill (code) values (?)", "demo");
            status.setRollbackOnly();
        });
        Integer count = workers.submit(() -> transaction.execute(status -> {
            locks.acquire("demo");
            return jdbc.queryForObject("select count(*) from imported_skill", Integer.class);
        })).get(5, TimeUnit.SECONDS);
        assertThat(count).isZero();
    }

    @Test
    void acquisitionWithoutTransactionFailsBeforeLocking() {
        assertThatThrownBy(() -> locks.acquire("demo")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> locks.acquire(" ")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void interruptedAcquisitionKeepsTheInterruptFlagAndRollsBack() throws Exception {
        Lock lock = mock(Lock.class);
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenThrow(new InterruptedException());
        locks = new SkillImportLockService(key -> lock);
        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> locks.acquire("demo")))
            .isInstanceOf(CannotAcquireLockException.class);
        assertThat(Thread.currentThread().isInterrupted()).isTrue();
    }

    @Test
    void lostRedisOwnershipBeforeCommitRollsBackPendingWrites() {
        var registry = mock(org.springframework.integration.support.locks.RenewableLockRegistry.class);
        var lock = new java.util.concurrent.locks.ReentrantLock();
        when(registry.obtain("demo")).thenReturn(lock);
        org.mockito.Mockito.doThrow(new IllegalStateException("lease no longer owned"))
            .when(registry).renewLock("demo");
        locks = new SkillImportLockService(registry);

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            locks.acquire("demo");
            jdbc.update("insert into imported_skill (code) values (?)", "demo");
        })).isInstanceOf(IllegalStateException.class).hasMessage("lease no longer owned");
        assertThat(jdbc.queryForObject("select count(*) from imported_skill", Integer.class)).isZero();
        assertThat(lock.isLocked()).isFalse();
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting for test worker");
        }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }
}
