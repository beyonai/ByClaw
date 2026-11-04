package com.iwhalecloud.byai.manager.application.service.auth;

import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Per-worker scope; a persisted outbox replaces non-durable afterCommit callbacks. */
final class AuthorizationTaskExecution implements AutoCloseable {
    private static final ThreadLocal<Boolean> ACTIVE = new ThreadLocal<>();
    AuthorizationTaskExecution() { ACTIVE.set(true); }
    static boolean active() { return Boolean.TRUE.equals(ACTIVE.get()); }
    AuthorizationCachePlan plan() {
        AuthorizationCachePlan result = new AuthorizationCachePlan();
        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> {
            if (sync instanceof AuthorizationCommitBatch batch) batch.copyTo(result);
        });
        return result;
    }
    @Override public void close() { ACTIVE.remove(); }
}
