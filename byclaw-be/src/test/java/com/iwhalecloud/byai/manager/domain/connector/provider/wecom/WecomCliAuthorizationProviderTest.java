package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.Date;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;

class WecomCliAuthorizationProviderTest {

    private static final String MESSAGE = "企业微信授权暂未开放";

    private final WecomCliAuthorizationProvider provider = new WecomCliAuthorizationProvider();

    @Test
    void startReturnsStableNotImplementedFailureShape() {
        long before = System.currentTimeMillis();

        AuthorizationStartResult result = provider.start(startContext());

        long after = System.currentTimeMillis();
        assertThat(provider.providerCode()).isEqualTo("wecom-cli");
        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.authorizationUrl()).isNull();
        assertThat(result.expiresAt()).isNotNull();
        assertThat(result.expiresAt().getTime()).isBetween(before, after);
        assertThat(result.providerSessionId()).isNull();
        assertThat(result.providerState()).isNull();
        assertThat(result.errorCode()).isEqualTo("PROVIDER_NOT_IMPLEMENTED");
        assertThat(result.errorMessage()).isEqualTo(MESSAGE);
    }

    @Test
    void queryStatusReturnsStableNotImplementedFailureShape() {
        AuthorizationStatusResult result = provider.queryStatus(sessionContext());

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isEqualTo("PROVIDER_NOT_IMPLEMENTED");
        assertThat(result.errorMessage()).isEqualTo(MESSAGE);
    }

    @Test
    void cancelIsNoOp() {
        assertThatCode(() -> provider.cancel(sessionContext())).doesNotThrowAnyException();
    }

    private AuthorizationStartContext startContext() {
        return new AuthorizationStartContext(
            "auth-wecom-1",
            "42",
            1002L,
            "wecom",
            "wecom-cli",
            null,
            Map.of()
        );
    }

    private AuthorizationSessionContext sessionContext() {
        return new AuthorizationSessionContext(
            "auth-wecom-1",
            "42",
            1002L,
            "wecom",
            "wecom-cli",
            null,
            null,
            new Date()
        );
    }
}
