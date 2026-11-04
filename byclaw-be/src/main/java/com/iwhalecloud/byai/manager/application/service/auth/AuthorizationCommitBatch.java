package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.util.RedisUtil;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 仅聚合本事务新增的关联资源授权及用户重建；回滚时不执行任何缓存写入。 */
final class AuthorizationCommitBatch implements TransactionSynchronization {

    private static final Logger logger = LoggerFactory.getLogger(AuthorizationCommitBatch.class);
    private final Object owner;
    private final AuthRedisSyncService sync;
    private final AuthorizationCachePlan plan = new AuthorizationCachePlan();
    private final Map<String, Set<String>> additions = plan.getAdditions();
    private final Set<Long> userIds = new LinkedHashSet<>();
    private final Set<String> hints = new LinkedHashSet<>();

    private AuthorizationCommitBatch(Object owner, AuthRedisSyncService sync) {
        this.owner = owner;
        this.sync = sync;
    }

    static AuthorizationCommitBatch current(Object owner, AuthRedisSyncService sync) {
        for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
            if (synchronization instanceof AuthorizationCommitBatch batch && batch.owner == owner) return batch;
        }
        AuthorizationCommitBatch batch = new AuthorizationCommitBatch(owner, sync);
        TransactionSynchronizationManager.registerSynchronization(batch);
        return batch;
    }

    void addSetMembers(Map<String, Set<String>> values) {
        plan.change(values, false);
    }

    void removeSetMembers(Map<String, Set<String>> values) {
        plan.change(values, true);
    }

    void copyTo(AuthorizationCachePlan target) {
        target.change(plan.getRemovals(), true);
        target.change(additions, false);
        target.getUserIds().addAll(userIds);
    }

    void refreshUsers(Set<Long> changedUsers, String hint) {
        userIds.addAll(changedUsers);
        hints.add(hint);
    }

    @Override
    public void afterCommit() {
        if (AuthorizationTaskExecution.active()) return;
        long started = System.nanoTime();
        RuntimeException failure = null;
        try {
            RedisUtil.removeSets(plan.getRemovals());
            RedisUtil.addSets(additions);
        } catch (RuntimeException exception) {
            failure = exception;
        }
        // 即使旧权限 Set 同步失败，也尝试提交两类用户缓存重建，不因一个失败跳过另一个。
        if (!userIds.isEmpty()) {
            Set<Long> snapshot = Set.copyOf(userIds);
            String hint = String.join(",", hints);
            try {
                sync.asyncSyncAuthChangedUsers(snapshot, hint);
            } catch (RuntimeException exception) {
                failure = accumulate(failure, exception);
            }
            try {
                sync.asyncSyncManageAuthChangedUsers(snapshot, hint);
            } catch (RuntimeException exception) {
                failure = accumulate(failure, exception);
            }
        }
        if (failure != null) {
            logger.error("授权数据库已提交，Redis同步未完成 keys={}, users={}", additions.size(), userIds.size(), failure);
            throw new RedisSystemException("Authorization database committed; Redis synchronization failed", failure);
        }
        logger.info("授权提交后缓存批处理完成 keys={}, members={}, users={}, totalMs={}", additions.size(),
            additions.values().stream().mapToInt(Set::size).sum(), userIds.size(),
            (System.nanoTime() - started) / 1_000_000);
    }

    private static RuntimeException accumulate(RuntimeException first, RuntimeException next) {
        if (first == null) return next;
        if (first != next) first.addSuppressed(next);
        return first;
    }
}
