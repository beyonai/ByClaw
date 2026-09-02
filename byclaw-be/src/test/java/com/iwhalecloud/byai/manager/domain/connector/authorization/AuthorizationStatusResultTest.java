package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Date;
import java.util.Map;

import org.junit.jupiter.api.Test;

class AuthorizationStatusResultTest {

    @Test
    void compatibilityConstructorTreatsConnectedExpiryAsReadyAccessExpiry() {
        Date accessExpiresAt = Date.from(Instant.parse("2026-08-12T04:00:00Z"));

        AuthorizationStatusResult result = new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED,
            "account-1",
            "Alice",
            accessExpiresAt,
            "credential-ref",
            null,
            null
        );

        assertThat(result.credentialState()).isEqualTo(CredentialState.READY);
        assertThat(result.accessExpiresAt()).isEqualTo(accessExpiresAt);
        assertThat(result.credentialExpiresAt()).isEqualTo(accessExpiresAt);
        assertThat(result.refreshExpiresAt()).isNull();
        assertThat(result.renewalMode()).isEqualTo(CredentialRenewalMode.NONE);
    }

    @Test
    void explicitLifecycleMetadataIsPreserved() {
        Date accessExpiresAt = Date.from(Instant.parse("2026-08-12T04:00:00Z"));
        Date refreshExpiresAt = Date.from(Instant.parse("2026-09-12T04:00:00Z"));
        Date lastVerifiedAt = Date.from(Instant.parse("2026-08-12T03:30:00Z"));

        AuthorizationStatusResult result = AuthorizationStatusResult.connected(
            "account-1",
            "Alice",
            CredentialState.EXPIRING,
            CredentialRenewalMode.REFRESH_TOKEN,
            accessExpiresAt,
            refreshExpiresAt,
            lastVerifiedAt,
            "credential-ref"
        );

        assertThat(result.credentialState()).isEqualTo(CredentialState.EXPIRING);
        assertThat(result.renewalMode()).isEqualTo(CredentialRenewalMode.REFRESH_TOKEN);
        assertThat(result.accessExpiresAt()).isEqualTo(accessExpiresAt);
        assertThat(result.refreshExpiresAt()).isEqualTo(refreshExpiresAt);
        assertThat(result.lastVerifiedAt()).isEqualTo(lastVerifiedAt);
        assertThat(result.credentialExpiresAt()).isEqualTo(accessExpiresAt);
    }

    @Test
    void connectedResultPreservesSanitizedAccountAttributes() {
        AuthorizationStatusResult result = AuthorizationStatusResult.connected(
            "wx-authorizer",
            "笙歌数智录",
            CredentialState.READY,
            CredentialRenewalMode.REFRESH_TOKEN,
            null,
            null,
            new Date(),
            "credential-ref",
            Map.of("username", "gh_x", "principalName", "XXX公司")
        );

        assertThat(result.accountAttributes()).containsExactlyInAnyOrderEntriesOf(
            Map.of("username", "gh_x", "principalName", "XXX公司"));
    }
}
