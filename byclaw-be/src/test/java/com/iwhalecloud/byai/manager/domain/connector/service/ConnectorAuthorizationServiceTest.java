package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProgress;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationQrCodeEncoder;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSession;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class ConnectorAuthorizationServiceTest {

    private static final String AUTHORIZATION_ID = "authorization-1";
    private static final String USER_ID = "1001";
    private static final Long CONNECTOR_ID = 1003L;
    private static final String AUTHORIZATION_URL = "https://open.feishu.cn/device?user_code=SECRET-CODE";
    private static final String PROVIDER_STATE = "{\"deviceCode\":\"temporary-device-secret\"}";

    private ConnectorInfoService connectorInfoService;
    private AuthorizationProviderRegistry providerRegistry;
    private RedisAuthorizationSessionRepository sessionRepository;
    private ConnectorAuthMapper connectorAuthMapper;
    private SequenceService sequenceService;
    private ConnectorAuthorizationProvider provider;
    private ConnectorAuthorizationService service;

    @BeforeEach
    void setUp() {
        connectorInfoService = mock(ConnectorInfoService.class);
        providerRegistry = mock(AuthorizationProviderRegistry.class);
        sessionRepository = mock(RedisAuthorizationSessionRepository.class);
        connectorAuthMapper = mock(ConnectorAuthMapper.class);
        sequenceService = mock(SequenceService.class);
        provider = mock(ConnectorAuthorizationProvider.class);
        when(connectorAuthMapper.insertActiveIgnoreConflict(any())).thenReturn(1);
        when(connectorAuthMapper.updateById(any())).thenReturn(1);
        lenient().when(sessionRepository.tryAcquireStartLock(eq(USER_ID), eq(CONNECTOR_ID), any(Duration.class)))
            .thenReturn(Optional.of("start-lock-token"));
        service = new ConnectorAuthorizationService(
            connectorInfoService,
            providerRegistry,
            sessionRepository,
            connectorAuthMapper,
            sequenceService
        );
    }

    @Test
    void startRoutesLarkProviderAndStoresOnlyEncryptedTemporarySecretsInRedis() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", "{\"tenant\":\"cn\"}");
        connector.setRuntimeManifest(larkManifest());
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        service = manifestDrivenService();
        Date expiresAt = futureExpiry();
        when(provider.start(any())).thenReturn(new AuthorizationStartResult(
            AuthorizationStatus.PENDING,
            AUTHORIZATION_URL,
            expiresAt,
            "provider-session-1",
            PROVIDER_STATE,
            null,
            null
        ));

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        ArgumentCaptor<AuthorizationStartContext> contextCaptor = ArgumentCaptor.forClass(AuthorizationStartContext.class);
        verify(provider).start(contextCaptor.capture());
        AuthorizationStartContext context = contextCaptor.getValue();
        assertThat(context.authorizationId()).isEqualTo(result.getAuthorizationId()).isNotBlank();
        assertThat(context.userId()).isEqualTo(USER_ID);
        assertThat(context.connectorId()).isEqualTo(CONNECTOR_ID);
        assertThat(context.connectorCode()).isEqualTo("lark");
        assertThat(context.providerCode()).isEqualTo("lark-cli");
        assertThat(context.redirectUrl()).isEqualTo(request().getRedirectUrl());
        assertThat(context.providerConfig()).containsEntry("tenant", "cn");
        assertThat(context.commandCatalog().command("status", 0))
            .containsExactly("lark-cli", "auth", "status", "--json", "--verify");

        ArgumentCaptor<RedisAuthorizationSession> sessionCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).create(sessionCaptor.capture());
        RedisAuthorizationSession session = sessionCaptor.getValue();
        assertThat(session.authorizationId()).isEqualTo(result.getAuthorizationId());
        assertThat(session.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(session.providerSessionId()).isEqualTo("provider-session-1");
        assertThat(session.version()).isZero();
        assertThat(session.manifestDigest()).isEqualTo(context.commandCatalog().digest());
        assertThat(session.expiresAt()).isEqualTo(expiresAt);
        assertThat(session.authorizationUrlCipher()).doesNotContain("SECRET-CODE");
        assertThat(session.providerStateCipher()).doesNotContain("temporary-device-secret");
        assertThat(Sm4Util.decrypt(session.authorizationUrlCipher())).isEqualTo(AUTHORIZATION_URL);
        assertThat(Sm4Util.decrypt(session.providerStateCipher())).isEqualTo(PROVIDER_STATE);

        assertThat(result.getStatus()).isEqualTo("pending");
        assertThat(result.getAuthorizationUrl()).isEqualTo(AUTHORIZATION_URL);
        assertThat(result.getQrCodeUrl()).startsWith("data:image/png;base64,");
        assertThat(result.getExpiresAt()).isEqualTo(expiresAt);
        assertThat(result.getErrorCode()).isNull();
    }

    @Test
    void startRejectsInvalidManifestBeforeCallingProvider() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        connector.setRuntimeManifest("{\"invalid\":true}");
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        service = manifestDrivenService();

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("CONNECTOR_MANIFEST_INVALID");
        verify(provider, never()).start(any());
    }

    @Test
    void statusFailsClosedAndCancelsProviderWhenManifestChangesDuringAuthorization() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        connector.setRuntimeManifest(larkManifest());
        ObjectMapper objectMapper = new ObjectMapper();
        ConnectorManifestCommandResolver resolver = new ConnectorManifestCommandResolver(
            objectMapper,
            new ConnectorManifestCanonicalizer(objectMapper)
        );
        String digest = resolver.resolve(connector).digest();
        RedisAuthorizationSession pending = new RedisAuthorizationSession(
            AUTHORIZATION_ID,
            USER_ID,
            CONNECTOR_ID,
            "lark",
            "lark-cli",
            AuthorizationStatus.PENDING,
            null,
            Sm4Util.encrypt(AUTHORIZATION_URL),
            "provider-session-1",
            Sm4Util.encrypt(PROVIDER_STATE),
            null,
            futureExpiry(),
            null,
            null,
            digest,
            0L
        );
        connector.setRuntimeManifest(larkManifest().replace("--verify", "--verify-changed"));
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(pending));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(0L), any())).thenReturn(true);
        service = manifestDrivenService();

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("CONNECTOR_MANIFEST_INVALID");
        verify(provider).cancel(any(AuthorizationSessionContext.class));
        verify(provider, never()).queryStatus(any());
    }

    @Test
    void startPersistsDirectWecomFailureWithQueryableFutureExpiry() {
        ConnectorInfo connector = connector("wecom", "wecom-cli", "CLI_INIT", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("wecom-cli")).thenReturn(provider);
        when(provider.start(any())).thenReturn(new AuthorizationStartResult(
            AuthorizationStatus.FAILED,
            null,
            new Date(System.currentTimeMillis() - 1L),
            "provider-session-failed",
            null,
            "PROVIDER_NOT_IMPLEMENTED",
            "企业微信授权暂未开放"
        ));
        long before = System.currentTimeMillis();

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        long after = System.currentTimeMillis();
        ArgumentCaptor<RedisAuthorizationSession> sessionCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).create(sessionCaptor.capture());
        RedisAuthorizationSession session = sessionCaptor.getValue();
        assertThat(session.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(session.providerSessionId()).isEqualTo("provider-session-failed");
        assertThat(session.errorCode()).isEqualTo("PROVIDER_NOT_IMPLEMENTED");
        assertThat(session.errorMessage()).isEqualTo("企业微信授权暂未开放");
        assertThat(session.expiresAt().getTime())
            .isBetween(before + Duration.ofMinutes(10).toMillis(), after + Duration.ofMinutes(10).toMillis());
        assertThat(session.authorizationUrlCipher()).isNull();
        assertThat(session.providerStateCipher()).isNull();
        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("PROVIDER_NOT_IMPLEMENTED");
    }

    @Test
    void directConnectedStartUsesPendingCasSoOnlyActiveIndexWinnerWritesBinding() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.start(any())).thenReturn(connectedStart());
        org.mockito.Mockito.doNothing()
            .doThrow(new IllegalStateException("active session"))
            .when(sessionRepository).create(any());
        when(sessionRepository.compareAndSetStatus(
            any(), eq(AuthorizationStatus.PENDING), eq(0L), any())).thenReturn(true);
        when(sessionRepository.compareAndSetStatus(
            any(), eq(AuthorizationStatus.FINALIZING), eq(1L), any())).thenReturn(true);
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(601L);

        ConnectorAuthorizationDto winner = service.start(request(), USER_ID);
        ConnectorAuthorizationDto loser = service.start(request(), USER_ID);

        assertThat(winner.getStatus()).isEqualTo("connected");
        assertThat(loser.getStatus()).isEqualTo("failed");
        assertThat(loser.getErrorCode()).isEqualTo("SESSION_ALREADY_ACTIVE");
        ArgumentCaptor<RedisAuthorizationSession> createCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository, times(2)).create(createCaptor.capture());
        assertThat(createCaptor.getAllValues()).allSatisfy(session -> {
            assertThat(session.status()).isEqualTo(AuthorizationStatus.PENDING);
            assertThat(Sm4Util.decrypt(session.authorizationUrlCipher())).isEqualTo(AUTHORIZATION_URL);
            assertThat(Sm4Util.decrypt(session.providerStateCipher())).isEqualTo(PROVIDER_STATE);
            assertThat(session.providerSessionId()).isEqualTo("provider-session-1");
        });
        verify(sessionRepository).compareAndSetStatus(
            eq(winner.getAuthorizationId()), eq(AuthorizationStatus.PENDING), eq(0L), any());
        verify(sessionRepository).compareAndSetStatus(
            eq(winner.getAuthorizationId()), eq(AuthorizationStatus.FINALIZING), eq(1L), any());
        verify(connectorAuthMapper).insertActiveIgnoreConflict(any(ConnectorAuth.class));
        verify(sequenceService).nextVal();
        ArgumentCaptor<AuthorizationSessionContext> cancelCaptor = ArgumentCaptor.forClass(AuthorizationSessionContext.class);
        verify(provider).cancel(cancelCaptor.capture());
        assertThat(cancelCaptor.getValue().authorizationId()).isEqualTo(loser.getAuthorizationId());
        assertThat(cancelCaptor.getValue().providerState()).isEqualTo(PROVIDER_STATE);
    }

    @Test
    void directConnectedStartTransitionsFinalizingToBindingFailureWhenDatabaseWriteFails() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.start(any())).thenReturn(connectedStart());
        when(sessionRepository.compareAndSetStatus(
            any(), eq(AuthorizationStatus.PENDING), eq(0L), any())).thenReturn(true);
        when(sessionRepository.compareAndSetStatus(
            any(), eq(AuthorizationStatus.FINALIZING), eq(1L), any())).thenReturn(true);
        when(connectorAuthMapper.selectOne(any())).thenThrow(new IllegalStateException("database secret"));

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("AUTH_BINDING_FAILED");
        ArgumentCaptor<RedisAuthorizationSession> createCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).create(createCaptor.capture());
        assertThat(createCaptor.getValue().status()).isEqualTo(AuthorizationStatus.PENDING);
        ArgumentCaptor<RedisAuthorizationSession> failedCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).compareAndSetStatus(
            eq(result.getAuthorizationId()),
            eq(AuthorizationStatus.FINALIZING),
            eq(1L),
            failedCaptor.capture()
        );
        assertThat(failedCaptor.getValue().status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(failedCaptor.getValue().errorCode()).isEqualTo("AUTH_BINDING_FAILED");
        assertThat(failedCaptor.getValue().authorizationUrlCipher()).isNull();
        assertThat(failedCaptor.getValue().providerStateCipher()).isNull();
    }

    @Test
    void startReturnsStableErrorsForMissingConnectorAndProviderConfiguration() {
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(null);

        ConnectorAuthorizationDto missingConnector = service.start(request(), USER_ID);

        assertThat(missingConnector.getStatus()).isEqualTo("failed");
        assertThat(missingConnector.getErrorCode()).isEqualTo("CONNECTOR_NOT_FOUND");

        ConnectorInfo missingProvider = connector("custom", null, "OAUTH2", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(missingProvider);
        ConnectorAuthorizationDto blankProvider = service.start(request(), USER_ID);

        assertThat(blankProvider.getStatus()).isEqualTo("failed");
        assertThat(blankProvider.getErrorCode()).isEqualTo("PROVIDER_NOT_CONFIGURED");

        ConnectorInfo unknownProvider = connector("custom", "missing-provider", "OAUTH2", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(unknownProvider);
        when(providerRegistry.get("missing-provider")).thenThrow(new IllegalArgumentException("unknown"));
        ConnectorAuthorizationDto unregisteredProvider = service.start(request(), USER_ID);

        assertThat(unregisteredProvider.getStatus()).isEqualTo("failed");
        assertThat(unregisteredProvider.getErrorCode()).isEqualTo("PROVIDER_NOT_CONFIGURED");
        verifyNoInteractions(sessionRepository);
    }

    @Test
    void concurrentPendingStartCancelsProviderBestEffortAndReturnsSanitizedConflict() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.start(any())).thenReturn(pendingStart());
        org.mockito.Mockito.doThrow(new IllegalStateException("redis details with temporary-device-secret"))
            .when(sessionRepository).create(any());

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("SESSION_ALREADY_ACTIVE");
        assertThat(result.getErrorMessage()).doesNotContain("temporary-device-secret").doesNotContain("redis details");
        ArgumentCaptor<AuthorizationSessionContext> cancelCaptor = ArgumentCaptor.forClass(AuthorizationSessionContext.class);
        verify(provider).cancel(cancelCaptor.capture());
        assertThat(cancelCaptor.getValue().providerState()).isEqualTo(PROVIDER_STATE);
    }

    @Test
    void concurrentStartIsRejectedBeforeProviderSideEffectsWhenStartLockIsBusy() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(sessionRepository.tryAcquireStartLock(eq(USER_ID), eq(CONNECTOR_ID), any(Duration.class)))
            .thenReturn(Optional.empty());

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("SESSION_ALREADY_ACTIVE");
        verify(provider, never()).start(any());
    }

    @Test
    void existingActiveSessionIsRejectedBeforeProviderSideEffectsAfterStartLockAcquired() {
        ConnectorInfo connector = connector("lark", "lark-cli", "DEVICE_FLOW", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(sessionRepository.hasActiveSession(USER_ID, CONNECTOR_ID)).thenReturn(true);

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("SESSION_ALREADY_ACTIVE");
        verify(provider, never()).start(any());
        verify(sessionRepository).releaseStartLock(USER_ID, CONNECTOR_ID, "start-lock-token");
    }

    @Test
    void noneAuthorizationIdempotentlyUpsertsEnabledBindingWithoutRedisOrProvider() {
        ConnectorInfo connector = connector("local", null, "NONE", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        ConnectorAuth existing = new ConnectorAuth();
        existing.setAuthId(88L);
        existing.setCreateTime(new Date(1_700_000_000_000L));
        when(connectorAuthMapper.selectOne(any())).thenReturn(null, existing);
        when(sequenceService.nextVal()).thenReturn(77L);

        ConnectorAuthorizationDto first = service.start(request(), USER_ID);
        ConnectorAuthorizationDto second = service.start(request(), USER_ID);

        assertThat(first.getStatus()).isEqualTo("connected");
        assertThat(second.getStatus()).isEqualTo("connected");
        ArgumentCaptor<ConnectorAuth> insertCaptor = ArgumentCaptor.forClass(ConnectorAuth.class);
        verify(connectorAuthMapper).insertActiveIgnoreConflict(insertCaptor.capture());
        assertEnabledBinding(insertCaptor.getValue(), "NONE");
        assertThat(insertCaptor.getValue().getAuthId()).isEqualTo(77L);
        assertThat(insertCaptor.getValue().getAuthCredential()).isNull();
        assertThat(insertCaptor.getValue().getCreateBy()).isEqualTo(USER_ID);
        assertThat(insertCaptor.getValue().getCreateTime()).isNotNull();
        verify(connectorAuthMapper).updateById(existing);
        assertEnabledBinding(existing, "NONE");
        assertThat(existing.getAuthCredential()).isNull();
        assertThat(existing.getUpdateTime()).isNotNull();
        verify(sequenceService).nextVal();
        verifyNoInteractions(providerRegistry, sessionRepository);
    }

    @Test
    void noneAuthorizationUpdatesUniqueActiveWinnerWhenInsertIsIgnored() {
        ConnectorInfo connector = connector("local", null, "NONE", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        ConnectorAuth winner = new ConnectorAuth();
        winner.setAuthId(99L);
        when(connectorAuthMapper.selectOne(any())).thenReturn(null, winner);
        when(sequenceService.nextVal()).thenReturn(98L);
        when(connectorAuthMapper.insertActiveIgnoreConflict(any())).thenReturn(0);

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("connected");
        verify(connectorAuthMapper).insertActiveIgnoreConflict(any(ConnectorAuth.class));
        verify(connectorAuthMapper).updateById(winner);
        assertEnabledBinding(winner, "NONE");
        assertThat(winner.getAuthId()).isEqualTo(99L);
    }

    @Test
    void noneAuthorizationFailsWhenExistingBindingUpdateAffectsZeroRows() {
        ConnectorInfo connector = connector("local", null, "NONE", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        ConnectorAuth existing = new ConnectorAuth();
        existing.setAuthId(88L);
        when(connectorAuthMapper.selectOne(any())).thenReturn(existing);
        when(connectorAuthMapper.updateById(existing)).thenReturn(0);

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("AUTH_BINDING_FAILED");
    }

    @Test
    void noneAuthorizationFailsWhenNewBindingInsertAffectsZeroRows() {
        ConnectorInfo connector = connector("local", null, "NONE", null);
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(77L);
        when(connectorAuthMapper.insertActiveIgnoreConflict(any())).thenReturn(0);

        ConnectorAuthorizationDto result = service.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("AUTH_BINDING_FAILED");
    }

    @Test
    void invalidManifestReturnsStableErrorWithoutExposingValidationDetails() {
        ConnectorInfo connector = connector("local", null, "NONE", null);
        ConnectorConnectionStateService connectionStateService = mock(ConnectorConnectionStateService.class);
        ConnectorAuthorizationService transactionalService = new ConnectorAuthorizationService(
            connectorInfoService,
            providerRegistry,
            sessionRepository,
            connectorAuthMapper,
            sequenceService,
            connectionStateService,
            new AuthorizationQrCodeEncoder()
        );
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        org.mockito.Mockito.doThrow(new InvalidConnectorManifestException("runtime_manifest is required"))
            .when(connectionStateService).saveEnabledAuthorization(USER_ID, connector, null, null);

        ConnectorAuthorizationDto result = transactionalService.start(request(), USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("CONNECTOR_MANIFEST_INVALID");
        assertThat(result.getErrorMessage()).isEqualTo("连接器运行时配置无效");
    }

    @Test
    void statusUsesOwnedSessionAndReturnsNotFoundForMissingOrForeignAuthorization() {
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.empty());

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("AUTHORIZATION_NOT_FOUND");
        verify(sessionRepository).findOwned(AUTHORIZATION_ID, USER_ID);
        verifyNoInteractions(providerRegistry);
    }

    @Test
    void pendingStatusDecryptsProviderContextAndReturnsPlaintextUrlOnlyInDto() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 3L);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(pending));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(statusResult(AuthorizationStatus.PENDING));

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        ArgumentCaptor<AuthorizationSessionContext> contextCaptor = ArgumentCaptor.forClass(AuthorizationSessionContext.class);
        verify(provider).queryStatus(contextCaptor.capture());
        AuthorizationSessionContext context = contextCaptor.getValue();
        assertThat(context.authorizationId()).isEqualTo(AUTHORIZATION_ID);
        assertThat(context.providerState()).isEqualTo(PROVIDER_STATE);
        assertThat(context.providerSessionId()).isEqualTo("provider-session-1");
        assertThat(result.getStatus()).isEqualTo("pending");
        assertThat(result.getAuthorizationUrl()).isEqualTo(AUTHORIZATION_URL);
        verify(sessionRepository, never()).compareAndSetStatus(any(), any(), anyLong(), any());
    }

    @Test
    void pendingStatusPersistsAndReturnsProviderProgressTransition() {
        RedisAuthorizationSession pending = sessionWithPhase(AuthorizationStatus.PENDING, 3L, "app_initialization");
        String nextUrl = "https://open.feishu.cn/user-authorization";
        String nextState = "{\"phase\":\"user_authorization\",\"deviceCode\":\"next-secret\"}";
        Date nextExpiry = new Date(System.currentTimeMillis() + Duration.ofMinutes(5).toMillis());
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(pending));
        when(sessionRepository.tryAcquireStatusLock(eq(AUTHORIZATION_ID), any(Duration.class)))
            .thenReturn(Optional.of("lock-token"));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.PENDING,
            null,
            null,
            null,
            null,
            null,
            null,
            new AuthorizationProgress("user_authorization", nextUrl, nextState, nextExpiry)
        ));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(3L), any())).thenReturn(true);

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        ArgumentCaptor<RedisAuthorizationSession> replacementCaptor =
            ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(3L), replacementCaptor.capture());
        RedisAuthorizationSession replacement = replacementCaptor.getValue();
        assertThat(replacement.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(replacement.phase()).isEqualTo("user_authorization");
        assertThat(replacement.expiresAt()).isEqualTo(nextExpiry);
        assertThat(Sm4Util.decrypt(replacement.authorizationUrlCipher())).isEqualTo(nextUrl);
        assertThat(Sm4Util.decrypt(replacement.providerStateCipher())).isEqualTo(nextState);
        assertThat(result.getStatus()).isEqualTo("pending");
        assertThat(result.getPhase()).isEqualTo("user_authorization");
        assertThat(result.getAuthorizationUrl()).isEqualTo(nextUrl);
        verify(sessionRepository).releaseStatusLock(AUTHORIZATION_ID, "lock-token");
    }

    @Test
    void appInitializationPollReturnsCurrentSessionWhenAnotherInstanceOwnsTransitionLock() {
        RedisAuthorizationSession pending = sessionWithPhase(AuthorizationStatus.PENDING, 3L, "app_initialization");
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(pending));
        when(sessionRepository.tryAcquireStatusLock(eq(AUTHORIZATION_ID), any(Duration.class)))
            .thenReturn(Optional.empty());

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("pending");
        assertThat(result.getPhase()).isEqualTo("app_initialization");
        assertThat(result.getAuthorizationUrl()).isEqualTo(AUTHORIZATION_URL);
        verifyNoInteractions(providerRegistry);
        verify(sessionRepository, never()).releaseStatusLock(any(), any());
    }

    @Test
    void appInitializationLockWinnerRereadsSessionBeforeCallingProvider() {
        RedisAuthorizationSession stale = sessionWithPhase(AuthorizationStatus.PENDING, 3L, "app_initialization");
        RedisAuthorizationSession advanced = sessionWithPhase(AuthorizationStatus.PENDING, 4L, "user_authorization");
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(stale), Optional.of(advanced));
        when(sessionRepository.tryAcquireStatusLock(eq(AUTHORIZATION_ID), any(Duration.class)))
            .thenReturn(Optional.of("lock-token"));

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getPhase()).isEqualTo("user_authorization");
        assertThat(result.getAuthorizationUrl()).isEqualTo(AUTHORIZATION_URL);
        verifyNoInteractions(providerRegistry);
        verify(sessionRepository).releaseStatusLock(AUTHORIZATION_ID, "lock-token");
    }

    @Test
    void connectedCasWinnerPersistsOneEncryptedBindingAndTerminalPollSkipsProvider() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 4L);
        RedisAuthorizationSession connected = terminalSession(AuthorizationStatus.CONNECTED, 6L, null, null);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(pending), Optional.of(connected));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED,
            "ou_account_42",
            "Lark User",
            futureExpiry(),
            "workspace:lark-cli:user-1001",
            null,
            null
        ));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(4L), any())).thenReturn(true);
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(5L), any())).thenReturn(true);
        when(connectorInfoService.findById(CONNECTOR_ID))
            .thenReturn(connector("lark", "lark-cli", "DEVICE_FLOW", null));
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(501L);

        ConnectorAuthorizationDto winner = service.status(AUTHORIZATION_ID, USER_ID);
        ConnectorAuthorizationDto terminalPoll = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(winner.getStatus()).isEqualTo("connected");
        assertThat(terminalPoll.getStatus()).isEqualTo("connected");
        verify(provider).queryStatus(any());
        ArgumentCaptor<ConnectorAuth> authCaptor = ArgumentCaptor.forClass(ConnectorAuth.class);
        verify(connectorAuthMapper).insertActiveIgnoreConflict(authCaptor.capture());
        ConnectorAuth auth = authCaptor.getValue();
        assertEnabledBinding(auth, "DEVICE_FLOW");
        assertThat(auth.getAuthId()).isEqualTo(501L);
        assertThat(auth.getAuthName()).isEqualTo("Lark User");
        assertThat(auth.getExpireTime()).isNotNull();
        assertThat(auth.getLastSyncTime()).isNotNull();
        assertThat(auth.getAuthCredential()).doesNotContain("workspace:lark-cli:user-1001");
        Map<String, Object> credential = JSON.parseObject(Sm4Util.decrypt(auth.getAuthCredential()), Map.class);
        assertThat(credential).containsEntry("providerCode", "lark-cli")
            .containsEntry("authorizationId", AUTHORIZATION_ID)
            .containsEntry("credentialReference", "workspace:lark-cli:user-1001")
            .containsEntry("accountId", "ou_account_42")
            .containsEntry("accountName", "Lark User");
        assertThat(credential.keySet()).containsExactlyInAnyOrder(
            "providerCode", "authorizationId", "credentialReference", "accountId", "accountName");
        verify(sequenceService).nextVal();

        ArgumentCaptor<RedisAuthorizationSession> finalSessionCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(5L), finalSessionCaptor.capture());
        assertThat(finalSessionCaptor.getValue().authorizationUrlCipher()).isNull();
        assertThat(finalSessionCaptor.getValue().providerStateCipher()).isNull();
    }

    @Test
    void connectedCasLoserReadsRedisAndDoesNotWriteBinding() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 2L);
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 3L);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(pending), Optional.of(finalizing));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED, "account", "Account", null, null, null, null));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(2L), any())).thenReturn(false);

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("pending");
        verify(sessionRepository, times(2)).findOwned(AUTHORIZATION_ID, USER_ID);
        verify(connectorAuthMapper).selectOne(any());
        verify(connectorAuthMapper, never()).insert(any());
        verify(connectorAuthMapper, never()).updateById(any());
        verifyNoInteractions(sequenceService);
    }

    @Test
    void finalizingStatusRecoversConnectedWhenEnabledActiveBindingAlreadyExists() {
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 8L);
        ConnectorAuth binding = enabledBinding(AUTHORIZATION_ID);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(finalizing));
        when(connectorAuthMapper.selectOne(any())).thenReturn(binding);
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(8L), any())).thenReturn(true);

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("connected");
        ArgumentCaptor<RedisAuthorizationSession> connectedCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(8L), connectedCaptor.capture());
        assertThat(connectedCaptor.getValue().status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(connectedCaptor.getValue().authorizationUrlCipher()).isNull();
        assertThat(connectedCaptor.getValue().providerStateCipher()).isNull();
        verifyNoInteractions(providerRegistry);
    }

    @Test
    void finalizingStatusDoesNotRecoverFromOldMalformedOrNullBindingCredential() {
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 8L);
        ConnectorAuth oldBinding = enabledBinding("old-authorization");
        ConnectorAuth malformedBinding = enabledBinding(AUTHORIZATION_ID);
        malformedBinding.setAuthCredential("not-sm4-ciphertext");
        ConnectorAuth noneBinding = enabledBinding(AUTHORIZATION_ID);
        noneBinding.setAuthMode("NONE");
        noneBinding.setAuthCredential(null);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(finalizing));
        when(connectorAuthMapper.selectOne(any())).thenReturn(oldBinding, malformedBinding, noneBinding);

        assertThat(service.status(AUTHORIZATION_ID, USER_ID).getStatus()).isEqualTo("pending");
        assertThat(service.status(AUTHORIZATION_ID, USER_ID).getStatus()).isEqualTo("pending");
        assertThat(service.status(AUTHORIZATION_ID, USER_ID).getStatus()).isEqualTo("pending");

        verify(sessionRepository, never()).compareAndSetStatus(any(), any(), anyLong(), any());
        verifyNoInteractions(providerRegistry);
    }

    @Test
    void finalizingStatusWithoutEnabledActiveBindingRemainsPendingUntilRedisExpiry() {
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 8L);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(finalizing));
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("pending");
        verify(connectorAuthMapper).selectOne(any());
        verify(sessionRepository, never()).compareAndSetStatus(any(), any(), anyLong(), any());
        verifyNoInteractions(providerRegistry);
    }

    @Test
    void connectedFinalCasFailureImmediatelyRecoversFromPersistedBinding() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 4L);
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 6L);
        ConnectorAuth winner = enabledBinding(AUTHORIZATION_ID);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(pending), Optional.of(finalizing));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED, "account", "Account", null, null, null, null));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(4L), any())).thenReturn(true);
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(5L), any())).thenReturn(false);
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(6L), any())).thenReturn(true);
        when(connectorInfoService.findById(CONNECTOR_ID))
            .thenReturn(connector("lark", "lark-cli", "DEVICE_FLOW", null));
        when(connectorAuthMapper.selectOne(any())).thenReturn(null, winner);
        when(sequenceService.nextVal()).thenReturn(501L);

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("connected");
        verify(sessionRepository, times(2)).findOwned(AUTHORIZATION_ID, USER_ID);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(6L), any());
    }

    @Test
    void databaseFailureTransitionsFinalizingSessionToSanitizedFailure() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 0L);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(pending));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED, "account", "Account", null, null, null, null));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(0L), any())).thenReturn(true);
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(1L), any())).thenReturn(true);
        when(connectorInfoService.findById(CONNECTOR_ID))
            .thenReturn(connector("lark", "lark-cli", "DEVICE_FLOW", null));
        when(connectorAuthMapper.selectOne(any()))
            .thenThrow(new IllegalStateException("database password and internal details"));

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("AUTH_BINDING_FAILED");
        assertThat(result.getErrorMessage()).doesNotContain("password").doesNotContain("internal details");
        ArgumentCaptor<RedisAuthorizationSession> failedCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.FINALIZING), eq(1L), failedCaptor.capture());
        assertThat(failedCaptor.getValue().status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(failedCaptor.getValue().errorCode()).isEqualTo("AUTH_BINDING_FAILED");
        assertThat(failedCaptor.getValue().authorizationUrlCipher()).isNull();
        assertThat(failedCaptor.getValue().providerStateCipher()).isNull();
    }

    @Test
    void providerFailureUsesCasAndPreservesSanitizedProviderError() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 7L);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.of(pending));
        when(providerRegistry.get("lark-cli")).thenReturn(provider);
        when(provider.queryStatus(any())).thenReturn(new AuthorizationStatusResult(
            AuthorizationStatus.FAILED,
            null,
            null,
            null,
            null,
            "SCOPE_MISSING",
            "Required scope is missing"
        ));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(7L), any())).thenReturn(true);

        ConnectorAuthorizationDto result = service.status(AUTHORIZATION_ID, USER_ID);

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("SCOPE_MISSING");
        assertThat(result.getErrorMessage()).isEqualTo("Required scope is missing");
        ArgumentCaptor<RedisAuthorizationSession> failedCaptor = ArgumentCaptor.forClass(RedisAuthorizationSession.class);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(7L), failedCaptor.capture());
        assertThat(failedCaptor.getValue().authorizationUrlCipher()).isNull();
        assertThat(failedCaptor.getValue().providerStateCipher()).isNull();
    }

    @Test
    void terminalAndFinalizingSessionsNeverCallProviderAndExposeLowercaseStatuses() {
        List<AuthorizationStatus> statuses = List.of(
            AuthorizationStatus.CONNECTED,
            AuthorizationStatus.FAILED,
            AuthorizationStatus.EXPIRED,
            AuthorizationStatus.CANCELLED,
            AuthorizationStatus.FINALIZING
        );
        List<String> externalStatuses = List.of("connected", "failed", "expired", "cancelled", "pending");
        for (int index = 0; index < statuses.size(); index++) {
            String authorizationId = AUTHORIZATION_ID + "-" + index;
            RedisAuthorizationSession session = terminalSession(
                statuses.get(index), index, "TERMINAL_ERROR", "terminal message");
            when(sessionRepository.findOwned(authorizationId, USER_ID)).thenReturn(Optional.of(new RedisAuthorizationSession(
                authorizationId,
                session.userId(),
                session.connectorId(),
                session.connectorCode(),
                session.providerCode(),
                session.status(),
                session.authorizationUrlCipher(),
                session.providerSessionId(),
                session.providerStateCipher(),
                session.ownerInstanceId(),
                session.expiresAt(),
                session.errorCode(),
                session.errorMessage(),
                session.version()
            )));

            ConnectorAuthorizationDto result = service.status(authorizationId, USER_ID);

            assertThat(result.getStatus()).isEqualTo(externalStatuses.get(index));
        }
        verifyNoInteractions(providerRegistry);
    }

    @Test
    void cancelCallsMatchingProviderOnceAndIsIdempotentForOwnedTerminalSession() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 10L);
        RedisAuthorizationSession cancelled = terminalSession(
            AuthorizationStatus.CANCELLED, 12L, "AUTH_CANCELLED", "Authorization cancelled");
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(pending), Optional.of(cancelled));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(10L), any())).thenReturn(true);
        when(providerRegistry.get("lark-cli")).thenReturn(provider);

        assertThat(service.cancel(AUTHORIZATION_ID, USER_ID)).isTrue();
        assertThat(service.cancel(AUTHORIZATION_ID, USER_ID)).isTrue();

        ArgumentCaptor<AuthorizationSessionContext> contextCaptor = ArgumentCaptor.forClass(AuthorizationSessionContext.class);
        verify(provider).cancel(contextCaptor.capture());
        assertThat(contextCaptor.getValue().providerState()).isEqualTo(PROVIDER_STATE);
        verify(sessionRepository).deleteSecrets(AUTHORIZATION_ID);
        verify(sessionRepository).compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(10L), any());
    }

    @Test
    void cancelRejectsUnknownOrForeignAuthorization() {
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.cancel(AUTHORIZATION_ID, USER_ID))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("授权任务不存在");

        verifyNoInteractions(providerRegistry);
    }

    @Test
    void cancelCasLoserReturnsFalseWhenWinnerMovedSessionToFinalizing() {
        RedisAuthorizationSession pending = session(AuthorizationStatus.PENDING, 10L);
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 11L);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(pending), Optional.of(finalizing));
        when(sessionRepository.compareAndSetStatus(
            eq(AUTHORIZATION_ID), eq(AuthorizationStatus.PENDING), eq(10L), any())).thenReturn(false);

        assertThat(service.cancel(AUTHORIZATION_ID, USER_ID)).isFalse();

        verify(sessionRepository, times(2)).findOwned(AUTHORIZATION_ID, USER_ID);
        verifyNoInteractions(providerRegistry);
        verify(sessionRepository, never()).deleteSecrets(AUTHORIZATION_ID);
    }

    @Test
    void cancelReturnsFalseForOwnedFinalizingOrConnectedSession() {
        RedisAuthorizationSession finalizing = session(AuthorizationStatus.FINALIZING, 11L);
        RedisAuthorizationSession connected = terminalSession(AuthorizationStatus.CONNECTED, 12L, null, null);
        when(sessionRepository.findOwned(AUTHORIZATION_ID, USER_ID))
            .thenReturn(Optional.of(finalizing), Optional.of(connected));

        assertThat(service.cancel(AUTHORIZATION_ID, USER_ID)).isFalse();
        assertThat(service.cancel(AUTHORIZATION_ID, USER_ID)).isFalse();

        verifyNoInteractions(providerRegistry);
    }

    private ConnectorInfo connector(String code, String providerCode, String authMode, String authConfig) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(CONNECTOR_ID);
        connector.setConnectorCode(code);
        connector.setProviderCode(providerCode);
        connector.setConnectorName(code + " connector");
        connector.setAuthMode(authMode);
        connector.setAuthConfig(authConfig);
        connector.setStatusCd("00A");
        return connector;
    }

    private StartConnectorAuthorizationRequest request() {
        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(CONNECTOR_ID);
        request.setRedirectUrl("https://app.example.com/chat");
        return request;
    }

    private AuthorizationStartResult pendingStart() {
        return new AuthorizationStartResult(
            AuthorizationStatus.PENDING,
            AUTHORIZATION_URL,
            futureExpiry(),
            "provider-session-1",
            PROVIDER_STATE,
            null,
            null
        );
    }

    private AuthorizationStartResult connectedStart() {
        return new AuthorizationStartResult(
            AuthorizationStatus.CONNECTED,
            AUTHORIZATION_URL,
            futureExpiry(),
            "provider-session-1",
            PROVIDER_STATE,
            null,
            null
        );
    }

    private AuthorizationStatusResult statusResult(AuthorizationStatus status) {
        return new AuthorizationStatusResult(status, null, null, null, null, null, null);
    }

    private ConnectorAuthorizationService manifestDrivenService() {
        ObjectMapper objectMapper = new ObjectMapper();
        ConnectorManifestCommandResolver resolver = new ConnectorManifestCommandResolver(
            objectMapper,
            new ConnectorManifestCanonicalizer(objectMapper)
        );
        return new ConnectorAuthorizationService(
            connectorInfoService,
            providerRegistry,
            sessionRepository,
            connectorAuthMapper,
            sequenceService,
            null,
            new AuthorizationQrCodeEncoder(),
            resolver
        );
    }

    private String larkManifest() {
        return """
            {
              "schemaVersion":"1.0","id":"lark","version":"1.0.84",
              "runtime":{"type":"cli","commands":{
                "login":[["lark-cli","auth","login","--domain","all","--no-wait","--json"]],
                "status":[["lark-cli","auth","status","--json","--verify"]]
              }},
              "authStorage":{"mode":"native-home","nativePath":"/by/.connector-auth/.lark-cli",
                "environment":{"LARK_HOME":"/by/.connector-auth/.lark-cli"}},
              "skill":{"code":"fws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """;
    }

    private RedisAuthorizationSession session(AuthorizationStatus status, long version) {
        return new RedisAuthorizationSession(
            AUTHORIZATION_ID,
            USER_ID,
            CONNECTOR_ID,
            "lark",
            "lark-cli",
            status,
            Sm4Util.encrypt(AUTHORIZATION_URL),
            "provider-session-1",
            Sm4Util.encrypt(PROVIDER_STATE),
            null,
            futureExpiry(),
            null,
            null,
            version
        );
    }

    private RedisAuthorizationSession sessionWithPhase(
            AuthorizationStatus status,
            long version,
            String phase) {
        return new RedisAuthorizationSession(
            AUTHORIZATION_ID,
            USER_ID,
            CONNECTOR_ID,
            "lark",
            "lark-cli",
            status,
            phase,
            Sm4Util.encrypt(AUTHORIZATION_URL),
            "provider-session-1",
            Sm4Util.encrypt(PROVIDER_STATE),
            null,
            futureExpiry(),
            null,
            null,
            version
        );
    }

    private RedisAuthorizationSession terminalSession(
        AuthorizationStatus status,
        long version,
        String errorCode,
        String errorMessage) {
        return new RedisAuthorizationSession(
            AUTHORIZATION_ID,
            USER_ID,
            CONNECTOR_ID,
            "lark",
            "lark-cli",
            status,
            null,
            "provider-session-1",
            null,
            null,
            futureExpiry(),
            errorCode,
            errorMessage,
            version
        );
    }

    private Date futureExpiry() {
        return new Date(System.currentTimeMillis() + Duration.ofMinutes(10).toMillis());
    }

    private void assertEnabledBinding(ConnectorAuth auth, String authMode) {
        assertThat(auth.getUserId()).isEqualTo(USER_ID);
        assertThat(auth.getConnectorId()).isEqualTo(CONNECTOR_ID);
        assertThat(auth.getAuthMode()).isEqualTo(authMode);
        assertThat(auth.getEnableFlag()).isEqualTo("Y");
        assertThat(auth.getStatusCd()).isEqualTo("00A");
        assertThat(auth.getLastSyncTime()).isNotNull();
    }

    private ConnectorAuth enabledBinding(String authorizationId) {
        ConnectorAuth binding = new ConnectorAuth();
        binding.setAuthId(900L);
        binding.setUserId(USER_ID);
        binding.setConnectorId(CONNECTOR_ID);
        binding.setAuthMode("DEVICE_FLOW");
        binding.setAuthCredential(Sm4Util.encrypt(JSON.toJSONString(Map.of(
            "providerCode", "lark-cli",
            "authorizationId", authorizationId
        ))));
        binding.setEnableFlag("Y");
        binding.setStatusCd("00A");
        return binding;
    }
}
