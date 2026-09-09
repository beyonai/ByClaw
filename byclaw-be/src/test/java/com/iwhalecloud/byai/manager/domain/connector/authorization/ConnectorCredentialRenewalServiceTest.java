package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;

class ConnectorCredentialRenewalServiceTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-08-31T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void registryRejectsDuplicateProviderCodes() {
        ConnectorCredentialRenewalProvider one = provider("gmail-oauth2");
        ConnectorCredentialRenewalProvider duplicate = provider("gmail-oauth2");

        assertThatThrownBy(() -> new ConnectorCredentialRenewalProviderRegistry(List.of(one, duplicate)))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void schedulerRenewsOnlyWindowCandidatesAndPublishesLifecycleThroughStateService() {
        ConnectorAuthMapper authMapper = mock(ConnectorAuthMapper.class);
        ConnectorInfoMapper infoMapper = mock(ConnectorInfoMapper.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        ConnectorInfo connector = connector(9L, "gmail-oauth2");
        ConnectorAuth due = auth(1L, 9L, Date.from(CLOCK.instant().plusSeconds(299)));
        ConnectorAuth later = auth(2L, 9L, Date.from(CLOCK.instant().plusSeconds(301)));
        when(authMapper.selectList(any())).thenReturn(List.of(due, later));
        when(infoMapper.selectById(9L)).thenReturn(connector);
        AuthorizationStatusResult renewed = AuthorizationStatusResult.connected("id", "mail@example.com",
            CredentialState.READY, CredentialRenewalMode.REFRESH_TOKEN,
            Date.from(CLOCK.instant().plusSeconds(3600)), null, Date.from(CLOCK.instant()), "credential-ref");
        when(provider.renew(1001L, connector)).thenReturn(renewed);
        ConnectorCredentialRenewalLeaseService leases = leaseService();
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(authMapper, infoMapper,
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)), stateService, leases, CLOCK);

        service.renewExpiringCredentials();

        verify(provider).renew(1001L, connector);
        verify(stateService).updateCredentialLifecycle("1001", connector, renewed);
        verify(leases).release(any());
    }

    @Test
    void oneFailureDoesNotPreventNextRenewal() {
        ConnectorAuthMapper authMapper = mock(ConnectorAuthMapper.class);
        ConnectorInfoMapper infoMapper = mock(ConnectorInfoMapper.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        ConnectorInfo connector = connector(9L, "gmail-oauth2");
        when(authMapper.selectList(any())).thenReturn(List.of(
            auth(1L, 9L, Date.from(CLOCK.instant())), auth(2L, 9L, Date.from(CLOCK.instant()))));
        when(infoMapper.selectById(9L)).thenReturn(connector);
        AuthorizationStatusResult success = AuthorizationStatusResult.connected("id", "mail@example.com",
            CredentialState.READY, CredentialRenewalMode.REFRESH_TOKEN, new Date(), null, new Date(), "ref");
        when(provider.renew(1001L, connector)).thenThrow(new IllegalStateException("secret-token"))
            .thenReturn(success);
        ConnectorCredentialRenewalLeaseService leases = leaseService();
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(authMapper, infoMapper,
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)), stateService, leases, CLOCK);

        service.renewExpiringCredentials();

        verify(stateService).updateCredentialLifecycle("1001", connector, success);
        verify(leases, org.mockito.Mockito.times(2)).release(any());
    }

    @Test
    void providerUnknownExceptionMarksRefreshNeededAndKeepsProcessing() {
        ConnectorAuthMapper authMapper = mock(ConnectorAuthMapper.class);
        ConnectorInfoMapper infoMapper = mock(ConnectorInfoMapper.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        ConnectorInfo connector = connector(9L, "gmail-oauth2");
        when(authMapper.selectList(any())).thenReturn(List.of(
            auth(1L, 9L, Date.from(CLOCK.instant()))));
        when(infoMapper.selectById(9L)).thenReturn(connector);
        when(provider.renew(1001L, connector)).thenThrow(new IllegalStateException("temporary database detail"));
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(authMapper, infoMapper,
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)), stateService, leaseService(), CLOCK);

        service.renewExpiringCredentials();

        verify(stateService).markRefreshNeeded("1001", connector);
        verify(stateService, never()).markReauthRequired(any(), any());
    }

    @Test
    void sanitizedLogThrowableRetainsStackButDropsMessageAndCause() {
        IllegalStateException original = new IllegalStateException("secret-token",
            new RuntimeException("provider-body"));

        Throwable safe = ConnectorCredentialRenewalService.safeThrowable(original);

        assertThat(safe.getMessage()).doesNotContain("secret-token", "provider-body");
        assertThat(safe.getCause()).isNull();
        assertThat(safe.getStackTrace()).containsExactly(original.getStackTrace());
    }

    @Test
    void failedAuthorizationStatusDoesNotUpdateBinding() {
        ConnectorInfo connector = connector(9L, "gmail-oauth2");
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        when(provider.renew(1001L, connector)).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.FAILED, null, null, null, null, "FAILED", "safe"));
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(
            mock(ConnectorAuthMapper.class), mock(ConnectorInfoMapper.class),
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)), stateService, leaseService(), CLOCK);

        service.renewOne(auth(1L, 9L, new Date()), connector);

        verify(stateService, never()).updateCredentialLifecycle(any(), any(), any());
    }

    @Test
    void expiredRefreshTokenTransitionsToReauthWithoutCallingProvider() {
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(
            mock(ConnectorAuthMapper.class), mock(ConnectorInfoMapper.class),
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)), stateService, leaseService(), CLOCK);
        ConnectorAuth expired = auth(1L, 9L, new Date());
        expired.setRefreshExpireTime(Date.from(CLOCK.instant().minusSeconds(1)));
        ConnectorInfo connector = connector(9L, "gmail-oauth2");

        service.renewOne(expired, connector);

        verify(provider, never()).renew(any(), any());
        verify(stateService).markReauthRequired("1001", connector);
    }

    @Test
    void permanentAndRetryableFailuresUseDifferentNarrowTransitions() {
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(
            mock(ConnectorAuthMapper.class), mock(ConnectorInfoMapper.class),
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)), stateService, leaseService(), CLOCK);
        ConnectorInfo connector = connector(9L, "gmail-oauth2");
        ConnectorAuth auth = auth(1L, 9L, new Date());
        when(provider.renew(1001L, connector)).thenReturn(
            new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null,
                "OAUTH_REFRESH_RETRYABLE", "safe"),
            new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null,
                "OAUTH_REFRESH_UNAVAILABLE", "safe"));

        service.renewOne(auth, connector);
        service.renewOne(auth, connector);

        verify(stateService).markRefreshNeeded("1001", connector);
        verify(stateService).markReauthRequired("1001", connector);
    }

    @Test
    void schedulerSkipsWithoutLeaseAndUsesBoundedOrderedBackoffQuery() {
        if (com.baomidou.mybatisplus.core.metadata.TableInfoHelper.getTableInfo(ConnectorAuth.class) == null) {
            com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
                new org.apache.ibatis.builder.MapperBuilderAssistant(
                    new com.baomidou.mybatisplus.core.MybatisConfiguration(), ""), ConnectorAuth.class);
        }
        ConnectorAuthMapper authMapper = mock(ConnectorAuthMapper.class);
        ConnectorInfoMapper infoMapper = mock(ConnectorInfoMapper.class);
        ConnectorCredentialRenewalProvider provider = provider("gmail-oauth2");
        ConnectorCredentialRenewalLeaseService leases = mock(ConnectorCredentialRenewalLeaseService.class);
        when(leases.tryAcquire(1L)).thenReturn(java.util.Optional.empty());
        when(authMapper.selectList(any())).thenReturn(List.of(auth(1L, 9L, new Date())));
        ConnectorCredentialRenewalService service = new ConnectorCredentialRenewalService(authMapper, infoMapper,
            new ConnectorCredentialRenewalProviderRegistry(List.of(provider)),
            mock(ConnectorConnectionStateService.class), leases, CLOCK);

        service.renewExpiringCredentials();

        verify(infoMapper, never()).selectById(any());
        var query = org.mockito.ArgumentCaptor.forClass(
            com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper.class);
        verify(authMapper).selectList(query.capture());
        assertThat(query.getValue().getSqlSegment()).contains("last_sync_time", "access_expire_time", "LIMIT 100");
    }

    private ConnectorCredentialRenewalLeaseService leaseService() {
        ConnectorCredentialRenewalLeaseService service = mock(ConnectorCredentialRenewalLeaseService.class);
        when(service.tryAcquire(any())).thenAnswer(invocation -> java.util.Optional.of(
            new ConnectorCredentialRenewalLeaseService.Lease(invocation.getArgument(0), "owner")));
        return service;
    }

    private ConnectorCredentialRenewalProvider provider(String code) {
        ConnectorCredentialRenewalProvider provider = mock(ConnectorCredentialRenewalProvider.class);
        when(provider.providerCode()).thenReturn(code);
        return provider;
    }

    private ConnectorInfo connector(Long id, String providerCode) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(id);
        connector.setProviderCode(providerCode);
        connector.setStatusCd("00A");
        return connector;
    }

    private ConnectorAuth auth(Long id, Long connectorId, Date accessExpiry) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setAuthId(id);
        auth.setUserId("1001");
        auth.setConnectorId(connectorId);
        auth.setEnableFlag("Y");
        auth.setStatusCd("00A");
        auth.setRenewalMode("REFRESH_TOKEN");
        auth.setAccessExpireTime(accessExpiry);
        auth.setRefreshExpireTime(Date.from(CLOCK.instant().plusSeconds(7200)));
        return auth;
    }
}
