package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Date;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class AuthorizationProgressModelTest {

    @Test
    void carriesPendingPhaseTransitionsWithoutBreakingLegacyResults() throws Exception {
        Date expiresAt = new Date(System.currentTimeMillis() + 60_000L);
        AuthorizationProgress progress = new AuthorizationProgress(
            "user_authorization",
            "https://open.feishu.cn/authorize",
            "{\"deviceCode\":\"secret\"}",
            expiresAt
        );
        AuthorizationStatusResult status = new AuthorizationStatusResult(
            AuthorizationStatus.PENDING, null, null, null, null, null, null, progress);
        AuthorizationStartResult start = new AuthorizationStartResult(
            AuthorizationStatus.PENDING,
            "https://open.feishu.cn/initialize",
            expiresAt,
            null,
            "{}",
            null,
            null,
            "app_initialization"
        );

        assertThat(status.progress()).isEqualTo(progress);
        assertThat(start.phase()).isEqualTo("app_initialization");
        assertThat(new AuthorizationStatusResult(
            AuthorizationStatus.PENDING, null, null, null, null, null, null).progress()).isNull();
        assertThat(new AuthorizationStartResult(
            AuthorizationStatus.PENDING, null, expiresAt, null, null, null, null).phase()).isNull();

        RedisAuthorizationSession session = new RedisAuthorizationSession(
            "authorization-1",
            "user-1",
            3L,
            "lark",
            "lark-cli",
            AuthorizationStatus.PENDING,
            "app_initialization",
            "encrypted-url",
            null,
            "encrypted-state",
            null,
            expiresAt,
            null,
            null,
            0L
        );
        ObjectMapper mapper = new ObjectMapper();

        assertThat(mapper.readValue(mapper.writeValueAsString(session), RedisAuthorizationSession.class))
            .isEqualTo(session);
    }
}
