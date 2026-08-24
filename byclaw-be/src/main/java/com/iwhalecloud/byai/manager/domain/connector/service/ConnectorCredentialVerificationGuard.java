package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.stereotype.Component;

/**
 * Process-local admission guard for credential verification CLI processes.
 * This intentionally does not provide cross-node coordination; every backend process enforces its own bound.
 */
@Component
public class ConnectorCredentialVerificationGuard {

    private final Semaphore processLocalPermits;
    private final ConcurrentHashMap<String, Boolean> processLocalInFlight = new ConcurrentHashMap<>();

    public ConnectorCredentialVerificationGuard(ConnectorSkillAuthorizationSyncProperties properties) {
        this.processLocalPermits = new Semaphore(properties.maxConcurrentVerifications(), true);
    }

    public Admission acquire(Long userId, String connectorCode) {
        String key = userId + ":" + connectorCode;
        if (processLocalInFlight.putIfAbsent(key, Boolean.TRUE) != null) {
            throw new ConnectorCredentialVerificationBusyException();
        }
        if (!processLocalPermits.tryAcquire()) {
            processLocalInFlight.remove(key, Boolean.TRUE);
            throw new ConnectorCredentialVerificationBusyException();
        }
        return new Admission(key);
    }

    public final class Admission implements AutoCloseable {

        private final String key;
        private final AtomicBoolean closed = new AtomicBoolean();

        private Admission(String key) {
            this.key = key;
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                processLocalPermits.release();
                processLocalInFlight.remove(key, Boolean.TRUE);
            }
        }
    }
}
