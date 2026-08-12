package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;

import org.junit.jupiter.api.Test;

class CredentialLifecycleEvaluatorTest {

    private static final Date NOW = Date.from(Instant.parse("2026-08-12T00:00:00Z"));

    @Test
    void mapsRefreshAwareStatesWithoutTreatingAccessExpiryAsAuthorizationExpiry() {
        assertThat(CredentialLifecycleEvaluator.evaluate("expired", true, future(30), NOW))
            .isEqualTo(CredentialState.REFRESH_NEEDED);
        assertThat(CredentialLifecycleEvaluator.evaluate("valid", true, future(6), NOW))
            .isEqualTo(CredentialState.EXPIRING);
        assertThat(CredentialLifecycleEvaluator.evaluate("valid", false, future(30), NOW))
            .isEqualTo(CredentialState.REAUTH_REQUIRED);
        assertThat(CredentialLifecycleEvaluator.evaluate("expired", null, null, NOW))
            .isEqualTo(CredentialState.REAUTH_REQUIRED);
        assertThat(CredentialLifecycleEvaluator.evaluate(null, null, null, NOW))
            .isEqualTo(CredentialState.UNKNOWN);
    }

    private Date future(long days) {
        return new Date(NOW.getTime() + Duration.ofDays(days).toMillis());
    }
}
