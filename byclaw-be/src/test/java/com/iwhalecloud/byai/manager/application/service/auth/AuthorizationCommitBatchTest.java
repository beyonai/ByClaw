package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.util.RedisUtil;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.LongStream;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class AuthorizationCommitBatchTest {
    @TempDir Path directory;
    private final AuthRedisSyncService cache = mock(AuthRedisSyncService.class);
    private final Object owner = new Object();
    private TransactionTemplate transaction;
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        var source = new UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + directory.resolve("commit.sqlite"), null, null);
        transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE authorization (id BIGINT PRIMARY KEY)");
    }

    @Test
    void combines15SkillsFor3000UsersAndSubmitsOneRefreshAfterCommit() {
        Map<String, Set<String>> expected = new LinkedHashMap<>();
        Set<Long> users = LongStream.rangeClosed(1, 3000).boxed().collect(Collectors.toSet());
        try (var redis = mockStatic(RedisUtil.class)) {
            transaction.executeWithoutResult(status -> {
                for (int skill = 1; skill <= 15; skill++) {
                    Map<String, Set<String>> additions = new LinkedHashMap<>();
                    for (Long user : users) {
                        String key = "user:" + user;
                        String value = "SKILL_" + skill;
                        additions.put(key, Set.of(value));
                        expected.computeIfAbsent(key, ignored -> new java.util.HashSet<>()).add(value);
                    }
                    AuthorizationCommitBatch batch = AuthorizationCommitBatch.current(owner, cache);
                    batch.addSetMembers(additions);
                    batch.refreshUsers(users, "FORCE_USE");
                }
                assertThat(TransactionSynchronizationManager.getSynchronizations()).hasSize(1);
                redis.verifyNoInteractions();
                verifyNoInteractions(cache);
            });
            redis.verify(() -> RedisUtil.addSets(expected));
            verify(cache).asyncSyncAuthChangedUsers(users, "FORCE_USE");
            verify(cache).asyncSyncManageAuthChangedUsers(users, "FORCE_USE");
        }
    }

    @Test
    void rollbackDoesNotWriteRedisOrLaunchRefresh() {
        try (var redis = mockStatic(RedisUtil.class)) {
            transaction.executeWithoutResult(status -> {
                jdbc.update("INSERT INTO authorization VALUES (1)");
                AuthorizationCommitBatch batch = AuthorizationCommitBatch.current(owner, cache);
                batch.addSetMembers(Map.of("user:1", Set.of("SKILL_1")));
                batch.refreshUsers(Set.of(1L), "FORCE_USE");
                status.setRollbackOnly();
            });
            redis.verifyNoInteractions();
            verifyNoInteractions(cache);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM authorization", Integer.class)).isZero();
        }
    }

    @Test
    void redisFailureAfterCommitRetainsDatabaseAndAttemptsBothRefreshes() {
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.addSets(anyMap())).thenThrow(new RedisSystemException("Redis down", null));
            doThrow(new IllegalStateException("executor rejected task")).when(cache)
                .asyncSyncAuthChangedUsers(Set.of(1L), "FORCE_USE");
            assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
                jdbc.update("INSERT INTO authorization VALUES (1)");
                AuthorizationCommitBatch batch = AuthorizationCommitBatch.current(owner, cache);
                batch.addSetMembers(Map.of("user:1", Set.of("SKILL_1")));
                batch.refreshUsers(Set.of(1L), "FORCE_USE");
            })).isInstanceOf(RedisSystemException.class).hasMessageContaining("database committed");
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM authorization", Integer.class)).isEqualTo(1);
            verify(cache).asyncSyncAuthChangedUsers(Set.of(1L), "FORCE_USE");
            verify(cache).asyncSyncManageAuthChangedUsers(Set.of(1L), "FORCE_USE");
        }
    }
}
