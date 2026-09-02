package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;

class WeixinAuthorizerAuthStoreTest {

    @Test
    void unauthorizedEventIsTransactional() throws NoSuchMethodException {
        assertThat(WeixinAuthorizerAuthStore.class
            .getDeclaredMethod("revokeByAuthorizer", String.class)
            .isAnnotationPresent(Transactional.class)).isTrue();
    }

    @Test
    void readsAuthorizerProfileFromEncryptedConnectorCredential() {
        ConnectorAuthMapper mapper = mock(ConnectorAuthMapper.class);
        ConnectorAuth auth = auth(11L, "credential-ref");
        when(mapper.selectOne(any())).thenReturn(auth);
        WeixinAuthorizerAuthStore store = new WeixinAuthorizerAuthStore(
            mapper, mock(ConnectorCredentialSecretStore.class), mock(RedisAuthorizationSessionRepository.class));

        assertThat(store.findActive("7", 9L)).contains(
            new WeixinAuthorizerAuthStore.Binding(
                "wx-authorizer", "笙歌数智录", "gh_x", "XXX公司", "credential-ref"));
    }

    @Test
    void unauthorizedEventRevokesEveryMatchingCredentialAndDisablesBindings() {
        ConnectorAuthMapper mapper = mock(ConnectorAuthMapper.class);
        ConnectorCredentialSecretStore secrets = mock(ConnectorCredentialSecretStore.class);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        ConnectorAuth first = auth(11L, "credential-1");
        ConnectorAuth second = auth(12L, "credential-2");
        second.setUserId("8");
        second.setConnectorId(10L);
        first.setAuthCredential(null);
        second.setAuthCredential(null);
        when(mapper.selectActiveByProviderAndExternalAccount(
            "weixin-open-platform", "wx-authorizer")).thenReturn(List.of(first, second));
        when(secrets.findActive("7", 9L, "weixin-open-platform")).thenReturn(java.util.Optional.of(
            ConnectorCredentialSecret.restored("credential-1", "weixin-open-platform", "7", 9L,
                "access-1", "refresh-1", "Bearer", null, null, null)));
        when(secrets.findActive("8", 10L, "weixin-open-platform")).thenReturn(java.util.Optional.of(
            ConnectorCredentialSecret.restored("credential-2", "weixin-open-platform", "8", 10L,
                "access-2", "refresh-2", "Bearer", null, null, null)));
        when(mapper.updateById(any())).thenReturn(1);
        when(sessions.tryAcquireStartLock(any(), any(), any())).thenReturn(
            java.util.Optional.of("lock-1"), java.util.Optional.of("lock-2"));
        WeixinAuthorizerAuthStore store = new WeixinAuthorizerAuthStore(mapper, secrets, sessions);

        store.revokeByAuthorizer("wx-authorizer");

        verify(secrets).revoke("credential-1");
        verify(secrets).revoke("credential-2");
        verify(sessions).releaseStartLock("7", 9L, "lock-1");
        verify(sessions).releaseStartLock("8", 10L, "lock-2");
        ArgumentCaptor<ConnectorAuth> captor = ArgumentCaptor.forClass(ConnectorAuth.class);
        verify(mapper, org.mockito.Mockito.times(2)).updateById(captor.capture());
        assertThat(captor.getAllValues()).allSatisfy(auth -> {
            assertThat(auth.getCredentialState()).isEqualTo("REAUTH_REQUIRED");
            assertThat(auth.getEnableFlag()).isEqualTo("N");
        });
    }

    @Test
    void unauthorizedEventDefersWhileCredentialRefreshOwnsTheOperationLock() {
        ConnectorAuthMapper mapper = mock(ConnectorAuthMapper.class);
        ConnectorCredentialSecretStore secrets = mock(ConnectorCredentialSecretStore.class);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        ConnectorAuth auth = auth(11L, "credential-1");
        when(mapper.selectActiveByProviderAndExternalAccount(
            "weixin-open-platform", "wx-authorizer")).thenReturn(List.of(auth));
        when(sessions.tryAcquireStartLock(any(), any(), any())).thenReturn(java.util.Optional.empty());
        WeixinAuthorizerAuthStore store = new WeixinAuthorizerAuthStore(mapper, secrets, sessions);

        org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> store.revokeByAuthorizer("wx-authorizer"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("in progress");

        verify(secrets, never()).findActive(any(), any(), any());
        verify(mapper, never()).updateById(any());
    }

    private ConnectorAuth auth(Long authId, String credentialReference) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setAuthId(authId);
        auth.setUserId("7");
        auth.setConnectorId(9L);
        auth.setExternalAccountId("wx-authorizer");
        auth.setAuthName("笙歌数智录");
        auth.setAuthCredential(Sm4Util.encrypt("{\"credentialReference\":\"" + credentialReference
            + "\",\"accountId\":\"wx-authorizer\",\"accountName\":\"笙歌数智录\","
            + "\"username\":\"gh_x\",\"principalName\":\"XXX公司\"}"));
        auth.setStatusCd("00A");
        return auth;
    }
}
