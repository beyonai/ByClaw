package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Date;
import java.util.Optional;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.manager.mapper.users.UserMailAccountMapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.mockito.ArgumentCaptor;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

class MailAccountProjectionStateServiceTest {
    @BeforeAll
    static void initializeTableMetadata() {
        if (TableInfoHelper.getTableInfo(UserMailAccount.class) == null) {
            TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""), UserMailAccount.class);
        }
    }

    @Test
    void everyAfterCommitDatabaseBoundaryUsesRequiresNew() {
        Set<String> required = Set.of("loadActiveSnapshot", "reconcileCurrentBindings",
            "markProjectionFailed", "markProjectionSucceeded", "recognizesMailConnector",
            "findActiveConnector", "scanProjectionUsersAfter", "reconcileCurrentBinding",
            "loadAllAccountIds", "loadAccountIdsForConnector", "loadProjectionRecoveryIds");

        for (Method method : MailAccountProjectionStateService.class.getDeclaredMethods()) {
            if (!required.contains(method.getName())) continue;
            Transactional transactional = method.getAnnotation(Transactional.class);
            assertThat(transactional).as(method.getName()).isNotNull();
            assertThat(transactional.propagation()).as(method.getName())
                .isEqualTo(Propagation.REQUIRES_NEW);
        }
        assertThat(Arrays.stream(MailAccountProjectionStateService.class.getDeclaredMethods())
            .map(Method::getName).filter(required::contains).collect(java.util.stream.Collectors.toSet()))
            .containsExactlyInAnyOrderElementsOf(required);
    }


    @Test
    void prepareOAuthBindingPropagatesInfrastructureFailure() {
        UserMailAccountMapper accounts = mock(UserMailAccountMapper.class);
        ConnectorInfoMapper connectors = mock(ConnectorInfoMapper.class);
        when(connectors.selectOne(any())).thenThrow(new IllegalStateException("database unavailable"));
        MailAccountProjectionStateService service = new MailAccountProjectionStateService(accounts, connectors,
            mock(ConnectorConnectionStateService.class), mock(ConnectorCredentialSecretStore.class),
            new ObjectMapper());
        UserMailAccount account = new UserMailAccount();
        account.setUserId(1001L);
        account.setProviderCode("gmail");
        account.setAuthType("OAUTH2");

        assertThatThrownBy(() -> service.prepareOAuthBinding(account))
            .isInstanceOf(MailCredentialResolutionException.class);
    }

    @Test
    void gmailBindingRequiresMatchingNormalizedProviderIdentity() {
        OAuthFixture fixture = oauthFixture("gmail", "gmail-mail", "google");
        fixture.account().setEmail("Person@BÜCHER.example ");
        fixture.authorization().setAuthName(" person@xn--bcher-kva.example");

        fixture.service().prepareOAuthBinding(fixture.account());

        assertThat(fixture.account().getCredentialRef()).isEqualTo("credential-ref");
        assertThat(fixture.account().getStatus()).isEqualTo("NORMAL");

        fixture.account().setEmail("other@example.com");
        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isNull();
        assertThat(fixture.account().getStatus()).isEqualTo("AUTH_REQUIRED");
    }

    @Test
    void microsoftBindingUsesProviderDetailsAndRejectsMissingIdentity() {
        OAuthFixture fixture = oauthFixture("microsoft-365", "microsoft-mail", "microsoft-mail-oauth2");
        fixture.account().setEmail("person@example.com");
        fixture.authorization().setAuthName(null);
        fixture.authorization().setExternalAccountId("opaque-directory-id");
        fixture.authorization().setAuthCredential(Sm4Util.encrypt(
            "{\"credentialReference\":\"credential-ref\",\"principalName\":\"PERSON@example.com\"}"));

        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isEqualTo("credential-ref");

        fixture.authorization().setAuthCredential(Sm4Util.encrypt(
            "{\"credentialReference\":\"credential-ref\"}"));
        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isNull();
        assertThat(fixture.account().getStatus()).isEqualTo("AUTH_REQUIRED");
    }

    @Test
    void externalAccountIdIsFallbackOnlyWhenItIsAnEmailAddress() {
        OAuthFixture fixture = oauthFixture("gmail", "gmail-mail", "google");
        fixture.account().setEmail("person@example.com");
        fixture.authorization().setAuthName(null);
        fixture.authorization().setExternalAccountId("person@example.com");
        fixture.authorization().setAuthCredential(Sm4Util.encrypt(
            "{\"credentialReference\":\"credential-ref\"}"));

        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isEqualTo("credential-ref");

        fixture.authorization().setExternalAccountId("opaque-id");
        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isNull();
    }

    @Test
    void latestActiveAuthorizationMismatchIsRejectedWhileSameIdentityIsAccepted() {
        OAuthFixture fixture = oauthFixture("gmail", "gmail-mail", "google");
        fixture.account().setEmail("first@example.com");
        fixture.authorization().setAuthName("second@example.com");

        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isNull();

        fixture.authorization().setAuthName(" FIRST@example.com ");
        fixture.service().prepareOAuthBinding(fixture.account());
        assertThat(fixture.account().getCredentialRef()).isEqualTo("credential-ref");
    }

    @Test
    void boundedDatabaseSweepIncludesDeletedRowsAndReturnsCursor() {
        UserMailAccountMapper accounts = mock(UserMailAccountMapper.class);
        UserMailAccount deleted = new UserMailAccount();
        deleted.setAccountId(11L);
        deleted.setUserId(1001L);
        deleted.setDeleteFlag("1");
        when(accounts.selectList(any())).thenReturn(java.util.List.of(deleted));
        MailAccountProjectionStateService service = new MailAccountProjectionStateService(accounts,
            mock(ConnectorInfoMapper.class), mock(ConnectorConnectionStateService.class),
            mock(ConnectorCredentialSecretStore.class), new ObjectMapper());

        MailAccountProjectionStateService.ProjectionUserBatch batch = service.scanProjectionUsersAfter(0L, 100);

        assertThat(batch.userIds()).containsExactly(1001L);
        assertThat(batch.nextAccountId()).isEqualTo(11L);
        assertThat(batch.hasMore()).isFalse();
    }

    @Test
    void inactiveMailConnectorReconcilesItsProviderToAuthRequired() {
        UserMailAccountMapper accounts = mock(UserMailAccountMapper.class);
        UserMailAccount gmail = new UserMailAccount();
        gmail.setAccountId(7L);
        gmail.setUserId(1001L);
        gmail.setProviderCode("gmail");
        gmail.setCredentialRef("revoked-ref");
        gmail.setStatus("NORMAL");
        gmail.setDeleteFlag("0");
        when(accounts.selectList(any())).thenReturn(java.util.List.of(gmail));
        ConnectorInfoMapper connectors = mock(ConnectorInfoMapper.class);
        ConnectorInfo inactive = new ConnectorInfo();
        inactive.setConnectorId(9L);
        inactive.setConnectorCode("gmail-mail");
        inactive.setProviderCode("google");
        inactive.setStatusCd("00X");
        when(connectors.selectById(9L)).thenReturn(inactive);
        MailAccountProjectionStateService service = new MailAccountProjectionStateService(accounts, connectors,
            mock(ConnectorConnectionStateService.class), mock(ConnectorCredentialSecretStore.class),
            new ObjectMapper());

        assertThat(service.reconcileCurrentBinding(1001L, 9L)).containsExactly(7L);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void successRecoveryDatabaseQueryIsRestrictedToAffectedIds() {
        UserMailAccountMapper accounts = mock(UserMailAccountMapper.class);
        when(accounts.selectList(any())).thenReturn(java.util.List.of());
        MailAccountProjectionStateService service = new MailAccountProjectionStateService(accounts,
            mock(ConnectorInfoMapper.class), mock(ConnectorConnectionStateService.class),
            mock(ConnectorCredentialSecretStore.class), new ObjectMapper());

        service.markProjectionSucceeded(1001L, Set.of(7L));

        ArgumentCaptor<LambdaQueryWrapper> query = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(accounts).selectList(query.capture());
        assertThat(query.getValue().getSqlSegment()).contains("account_id IN");
        assertThat(query.getValue().getParamNameValuePairs()).containsValue(7L);
        assertThat(query.getValue().getParamNameValuePairs()).doesNotContainValue(8L);
    }

    private OAuthFixture oauthFixture(String providerCode, String connectorCode, String credentialProviderCode) {
        UserMailAccountMapper accounts = mock(UserMailAccountMapper.class);
        ConnectorInfoMapper connectors = mock(ConnectorInfoMapper.class);
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setConnectorCode(connectorCode);
        connector.setProviderCode(credentialProviderCode);
        connector.setStatusCd("00A");
        when(connectors.selectOne(any())).thenReturn(connector);

        ConnectorAuth authorization = new ConnectorAuth();
        authorization.setAuthName("person@example.com");
        authorization.setExternalAccountId("person@example.com");
        authorization.setAuthCredential(Sm4Util.encrypt(
            "{\"credentialReference\":\"credential-ref\",\"accountName\":\"person@example.com\"}"));
        ConnectorConnectionStateService connectionState = mock(ConnectorConnectionStateService.class);
        when(connectionState.findEnabledActiveAuthorization("1001", 9L)).thenReturn(authorization);

        ConnectorCredentialSecretStore secrets = mock(ConnectorCredentialSecretStore.class);
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.restored("credential-ref",
            credentialProviderCode, "1001", 9L, "access", "refresh", null, null,
            new Date(System.currentTimeMillis() + 60_000L), null);
        when(secrets.findActiveByReference("credential-ref", "1001")).thenReturn(Optional.of(secret));

        UserMailAccount account = new UserMailAccount();
        account.setUserId(1001L);
        account.setProviderCode(providerCode);
        account.setAuthType("OAUTH2");
        return new OAuthFixture(new MailAccountProjectionStateService(accounts, connectors, connectionState,
            secrets, new ObjectMapper()), account, authorization);
    }

    private record OAuthFixture(MailAccountProjectionStateService service, UserMailAccount account,
                                ConnectorAuth authorization) { }
}
