package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Date;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;

class MailCredentialResolverTest {

    @Test
    void resolvesPasswordOnlyAtProjectionTime() {
        MailCredentialResolver resolver = new MailCredentialResolver(
            mock(ConnectorCredentialSecretStore.class), mock(MailConnectorLookup.class));
        UserMailAccount account = account("qq", "APP_PASSWORD");
        account.setAuthCodeCipher(Sm4Util.encrypt("app-secret"));

        MailCredentialResolver.ResolvedAuth auth = resolver.resolve(account).orElseThrow();

        assertThat(auth.type()).isEqualTo("APP_PASSWORD");
        assertThat(auth.username()).isEqualTo("user@example.com");
        assertThat(auth.secret()).isEqualTo("app-secret");
    }

    @Test
    void oauthReturnsAccessOnlyAndRejectsMismatchesAndExpiry() {
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MailConnectorLookup connectorMapper = mock(MailConnectorLookup.class);
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setConnectorCode("gmail-mail");
        connector.setProviderCode("google");
        connector.setStatusCd("00A");
        when(connectorMapper.findActiveConnector(any())).thenReturn(connector);
        when(store.findActiveByReference("ref", "1001")).thenReturn(java.util.Optional.of(
            ConnectorCredentialSecret.restored("ref", "google", "1001", 9L, "access", "refresh",
                "Bearer", "mail openid", new Date(System.currentTimeMillis() + 60_000), null)));
        MailCredentialResolver resolver = new MailCredentialResolver(store, connectorMapper);
        UserMailAccount account = account("gmail", "OAUTH2");
        account.setCredentialRef("ref");

        MailCredentialResolver.ResolvedAuth auth = resolver.resolve(account).orElseThrow();
        assertThat(auth.accessToken()).isEqualTo("access");
        assertThat(auth.refreshToken()).isNull();
        assertThat(auth.credentialReference()).isNull();

        connector.setProviderCode("wrong-provider");
        assertThat(resolver.resolve(account)).isEmpty();

        connector.setProviderCode("google");
        connector.setConnectorId(10L);
        assertThat(resolver.resolve(account)).isEmpty();

        connector.setConnectorId(9L);
        when(store.findActiveByReference("ref", "1001")).thenReturn(java.util.Optional.of(
            ConnectorCredentialSecret.restored("ref", "google", "1001", 9L, "expired", "refresh",
                "Bearer", "mail", new Date(System.currentTimeMillis() - 1), null)));
        assertThat(resolver.resolve(account)).isEmpty();

        when(store.findActiveByReference("ref", "1001")).thenReturn(java.util.Optional.empty());
        assertThat(resolver.resolve(account)).isEmpty();
    }









    @Test
    void infrastructureAndCorruptCredentialFailuresAreTypedAndSafe() {
        MailConnectorLookup connectorMapper = mock(MailConnectorLookup.class);
        when(connectorMapper.findActiveConnector(any())).thenThrow(new IllegalStateException("database details"));
        MailCredentialResolver resolver = new MailCredentialResolver(
            mock(ConnectorCredentialSecretStore.class), connectorMapper);
        UserMailAccount gmail = account("gmail", "OAUTH2");
        gmail.setCredentialRef("ref");

        assertThatThrownBy(() -> resolver.resolve(gmail))
            .isInstanceOf(MailCredentialResolutionException.class)
            .hasMessageNotContaining("database details");

        UserMailAccount qq = account("qq", "APP_PASSWORD");
        qq.setAuthCodeCipher("not-sm4");
        assertThatThrownBy(() -> resolver.resolve(qq))
            .isInstanceOf(MailCredentialResolutionException.class)
            .hasMessageNotContaining("not-sm4");
    }

    private UserMailAccount account(String provider, String authType) {
        UserMailAccount account = new UserMailAccount();
        account.setAccountId(1L);
        account.setUserId(1001L);
        account.setEmail("user@example.com");
        account.setProviderCode(provider);
        account.setAuthType(authType);
        account.setStatus("NORMAL");
        account.setDeleteFlag("0");
        return account;
    }
}
