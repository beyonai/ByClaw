package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ConnectorCredentialVerificationGuardTest {

    @Test
    void deduplicatesByUserAndConnectorAndReleasesAfterError() {
        ConnectorCredentialVerificationGuard guard = new ConnectorCredentialVerificationGuard(
            new ConnectorSkillAuthorizationSyncProperties(2, 0));

        try (ConnectorCredentialVerificationGuard.Admission ignored = guard.acquire(42L, "ima-openapi")) {
            assertThatThrownBy(() -> guard.acquire(42L, "ima-openapi"))
                .isInstanceOf(ConnectorCredentialVerificationBusyException.class);
            assertThatCode(() -> {
                try (ConnectorCredentialVerificationGuard.Admission other = guard.acquire(43L, "ima-openapi")) {
                    throw new IllegalStateException("verification failed");
                }
            }).isInstanceOf(IllegalStateException.class);
        }

        assertThatCode(() -> guard.acquire(42L, "ima-openapi").close()).doesNotThrowAnyException();
        assertThatCode(() -> guard.acquire(43L, "ima-openapi").close()).doesNotThrowAnyException();
    }

    @Test
    void globalCapacityRejectsWithoutWaiting() {
        ConnectorCredentialVerificationGuard guard = new ConnectorCredentialVerificationGuard(
            new ConnectorSkillAuthorizationSyncProperties(1, 0));

        try (ConnectorCredentialVerificationGuard.Admission ignored = guard.acquire(42L, "ima-openapi")) {
            assertThatThrownBy(() -> guard.acquire(43L, "dingtalk"))
                .isInstanceOf(ConnectorCredentialVerificationBusyException.class);
        }
    }
}
