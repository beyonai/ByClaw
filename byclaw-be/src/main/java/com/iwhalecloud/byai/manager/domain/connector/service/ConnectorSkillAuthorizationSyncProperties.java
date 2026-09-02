package com.iwhalecloud.byai.manager.domain.connector.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Capacity controls for connector credential verification initiated by Skills. */
@Component
public class ConnectorSkillAuthorizationSyncProperties {

    private final int maxConcurrentVerifications;
    private final long minUserIntervalMillis;

    public ConnectorSkillAuthorizationSyncProperties(
            @Value("${byai.connector.skill-sync.max-concurrent-verifications:32}") int maxConcurrentVerifications,
            @Value("${byai.connector.skill-sync.min-user-interval-millis:250}") long minUserIntervalMillis) {
        if (maxConcurrentVerifications <= 0) {
            throw new IllegalArgumentException("maxConcurrentVerifications must be positive");
        }
        if (minUserIntervalMillis < 0) {
            throw new IllegalArgumentException("minUserIntervalMillis must not be negative");
        }
        this.maxConcurrentVerifications = maxConcurrentVerifications;
        this.minUserIntervalMillis = minUserIntervalMillis;
    }

    public int maxConcurrentVerifications() {
        return maxConcurrentVerifications;
    }

    public long minUserIntervalMillis() {
        return minUserIntervalMillis;
    }
}
