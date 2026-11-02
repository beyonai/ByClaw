package com.iwhalecloud.byai.manager.domain.connector.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import java.net.URI;
import java.time.Duration;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProgress;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationQrCodeEncoder;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorProvisionalCredentialCleaner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSession;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.domain.connector.provider.oauth2.OAuth2State;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;

/** 提供与前端契约一致的连接器授权任务接口。 */
@Slf4j
@Service
public class ConnectorAuthorizationService {

    private static final long AUTHORIZATION_TTL_MILLIS = 10 * 60 * 1000L;
    private static final Duration STATUS_TRANSITION_LOCK_TTL = Duration.ofMinutes(3);
    private static final Duration AUTHORIZATION_START_LOCK_TTL = Duration.ofMinutes(2);
    private static final String APP_INITIALIZATION_PHASE = "app_initialization";

    private static final String CONNECTOR_NOT_FOUND = "CONNECTOR_NOT_FOUND";
    private static final String PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED";
    private static final String AUTHORIZATION_NOT_FOUND = "AUTHORIZATION_NOT_FOUND";
    private static final String SESSION_ALREADY_ACTIVE = "SESSION_ALREADY_ACTIVE";
    private static final String AUTHORIZATION_START_IN_PROGRESS = "AUTHORIZATION_START_IN_PROGRESS";
    private static final String AUTH_BINDING_FAILED = "AUTH_BINDING_FAILED";
    private static final String CONNECTOR_MANIFEST_INVALID = "CONNECTOR_MANIFEST_INVALID";
    private static final String AUTH_CANCELLED = "AUTH_CANCELLED";
    private static final String PROVIDER_PROTOCOL_ERROR = "PROVIDER_PROTOCOL_ERROR";
    private static final String OAUTH_CALLBACK_EXPIRED = "OAUTH_CALLBACK_EXPIRED";

    private final ConnectorInfoService connectorInfoService;
    private final AuthorizationProviderRegistry providerRegistry;
    private final RedisAuthorizationSessionRepository sessionRepository;
    private final ConnectorAuthMapper connectorAuthMapper;
    private final SequenceService sequenceService;
    private final ConnectorConnectionStateService connectionStateService;
    private final AuthorizationQrCodeEncoder qrCodeEncoder;
    private final ConnectorManifestCommandResolver manifestCommandResolver;
    private final ConnectorCredentialFormProviderRegistry credentialFormProviderRegistry;
    private final ConnectorCredentialVerificationGuard credentialVerificationGuard;

    @Autowired
    public ConnectorAuthorizationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorAuthMapper connectorAuthMapper,
            SequenceService sequenceService,
            ConnectorConnectionStateService connectionStateService,
            AuthorizationQrCodeEncoder qrCodeEncoder,
            ConnectorManifestCommandResolver manifestCommandResolver,
            ConnectorCredentialFormProviderRegistry credentialFormProviderRegistry,
            ConnectorCredentialVerificationGuard credentialVerificationGuard) {
        this.connectorInfoService = connectorInfoService;
        this.providerRegistry = providerRegistry;
        this.sessionRepository = sessionRepository;
        this.connectorAuthMapper = connectorAuthMapper;
        this.sequenceService = sequenceService;
        this.connectionStateService = connectionStateService;
        this.qrCodeEncoder = qrCodeEncoder;
        this.manifestCommandResolver = manifestCommandResolver;
        this.credentialFormProviderRegistry = credentialFormProviderRegistry;
        this.credentialVerificationGuard = credentialVerificationGuard;
    }

    ConnectorAuthorizationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorAuthMapper connectorAuthMapper,
            SequenceService sequenceService,
            ConnectorConnectionStateService connectionStateService,
            AuthorizationQrCodeEncoder qrCodeEncoder,
            ConnectorManifestCommandResolver manifestCommandResolver,
            ConnectorCredentialFormProviderRegistry credentialFormProviderRegistry) {
        this(connectorInfoService, providerRegistry, sessionRepository, connectorAuthMapper, sequenceService,
            connectionStateService, qrCodeEncoder, manifestCommandResolver, credentialFormProviderRegistry,
            new ConnectorCredentialVerificationGuard(new ConnectorSkillAuthorizationSyncProperties(32, 0)));
    }

    ConnectorAuthorizationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorAuthMapper connectorAuthMapper,
            SequenceService sequenceService,
            ConnectorConnectionStateService connectionStateService,
            AuthorizationQrCodeEncoder qrCodeEncoder) {
        this(
            connectorInfoService,
            providerRegistry,
            sessionRepository,
            connectorAuthMapper,
            sequenceService,
            connectionStateService,
            qrCodeEncoder,
            null,
            null,
            new ConnectorCredentialVerificationGuard(new ConnectorSkillAuthorizationSyncProperties(32, 0))
        );
    }

    /** 仅供不加载 Spring 容器的既有单元测试使用。 */
    ConnectorAuthorizationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorAuthMapper connectorAuthMapper,
            SequenceService sequenceService) {
        this(
            connectorInfoService,
            providerRegistry,
            sessionRepository,
            connectorAuthMapper,
            sequenceService,
            null,
            new AuthorizationQrCodeEncoder(),
            null,
            null,
            new ConnectorCredentialVerificationGuard(new ConnectorSkillAuthorizationSyncProperties(32, 0))
        );
    }

    ConnectorAuthorizationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorAuthMapper connectorAuthMapper,
            SequenceService sequenceService,
            ConnectorConnectionStateService connectionStateService,
            AuthorizationQrCodeEncoder qrCodeEncoder,
            ConnectorManifestCommandResolver manifestCommandResolver) {
        this(
            connectorInfoService, providerRegistry, sessionRepository, connectorAuthMapper, sequenceService,
            connectionStateService, qrCodeEncoder, manifestCommandResolver, null,
            new ConnectorCredentialVerificationGuard(new ConnectorSkillAuthorizationSyncProperties(32, 0)));
    }

    public ConnectorAuthorizationDto start(StartConnectorAuthorizationRequest request, String userId) {
        validateRequest(request);
        ConnectorInfo connector = connectorInfoService.findById(request.getConnectorId());
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            return failed(null, request.getConnectorId(), CONNECTOR_NOT_FOUND, I18nUtil.get("connector.unavailable"), null);
        }
        if (!"AK_SK".equals(connector.getAuthMode())) {
            validateRedirectUrl(request.getRedirectUrl());
        }
        if ("NONE".equals(connector.getAuthMode())) {
            try {
                saveEnabledAuthorization(userId, connector, null, null);
                return connected(UUID.randomUUID().toString(), connector.getConnectorId(), null);
            } catch (RuntimeException e) {
                return bindingFailure(null, connector.getConnectorId(), e);
            }
        }

        if ("AK_SK".equals(connector.getAuthMode())) {
            return startCredentialAuthorization(request, userId, connector);
        }

        ConnectorAuthorizationProvider provider = findProvider(connector.getProviderCode());
        if (provider == null) {
            return failed(
                null,
                connector.getConnectorId(),
                PROVIDER_NOT_CONFIGURED,
                I18nUtil.get("connector.authorization.providerMissing"),
                null
            );
        }

        Optional<String> startLockToken = sessionRepository.tryAcquireStartLock(
            userId,
            connector.getConnectorId(),
            AUTHORIZATION_START_LOCK_TTL
        );
        if (startLockToken.isEmpty()) {
            return failed(
                null,
                connector.getConnectorId(),
                AUTHORIZATION_START_IN_PROGRESS,
                I18nUtil.get("connector.authorization.starting"),
                null
            );
        }
        try {
            Optional<RedisAuthorizationSession> activeSession =
                sessionRepository.findActiveSession(userId, connector.getConnectorId());
            if (activeSession.isPresent()) {
                RedisAuthorizationSession session = activeSession.get();
                return toDto(session, decryptBestEffort(session.authorizationUrlCipher()));
            }
            return startLocked(request, userId, connector, provider);
        } finally {
            releaseStartLockBestEffort(userId, connector.getConnectorId(), startLockToken.get());
        }
    }

    private ConnectorAuthorizationDto startCredentialAuthorization(
            StartConnectorAuthorizationRequest request,
            String userId,
            ConnectorInfo connector) {
        if (credentialFormProviderRegistry == null || connectionStateService == null) {
            return failed(null, connector.getConnectorId(), PROVIDER_NOT_CONFIGURED, I18nUtil.get("connector.authorization.providerMissing"), null);
        }
        ConnectorCredentialFormProvider provider;
        try {
            provider = credentialFormProviderRegistry.get(connector.getProviderCode());
        } catch (IllegalArgumentException e) {
            return failed(null, connector.getConnectorId(), PROVIDER_NOT_CONFIGURED, I18nUtil.get("connector.authorization.providerMissing"), null);
        }
        Optional<String> lockToken = sessionRepository.tryAcquireStartLock(
            userId, connector.getConnectorId(), AUTHORIZATION_START_LOCK_TTL);
        if (lockToken.isEmpty()) {
            return failed(null, connector.getConnectorId(), SESSION_ALREADY_ACTIVE, I18nUtil.get("connector.authorization.active"), null);
        }
        try {
            CredentialFormVerification verification;
            try (ConnectorCredentialVerificationGuard.Admission ignored = credentialVerificationGuard.acquire(
                    requireCredentialUserId(userId), connector.getConnectorCode())) {
                verification = provider.verify(userId, connector, request.getCredentials());
            } catch (ConnectorCredentialVerificationBusyException e) {
                return failed(null, connector.getConnectorId(), ConnectorCredentialVerificationBusyException.ERROR_CODE,
                    ConnectorCredentialVerificationBusyException.PUBLIC_MESSAGE, null);
            } catch (RuntimeException e) {
                return failed(null, connector.getConnectorId(), "CONNECTOR_CREDENTIAL_INVALID", I18nUtil.get("connector.credential.invalid"), null);
            }
            if (verification == null || verification.status() == null
                    || verification.status().status() != AuthorizationStatus.CONNECTED) {
                AuthorizationStatusResult status = verification == null ? null : verification.status();
                return failed(null, connector.getConnectorId(),
                    status == null || !StringUtils.hasText(status.errorCode()) ? "CONNECTOR_CREDENTIAL_INVALID" : status.errorCode(),
                    I18nUtil.get("connector.credential.checkFailed"), null);
            }
            String authorizationId = UUID.randomUUID().toString();
            try {
                connectionStateService.saveEnabledCredentialAuthorization(
                    userId, connector, verification.status(), authorizationId, verification.runtimeEnvironment());
                return connected(authorizationId, connector.getConnectorId(), null);
            } catch (RuntimeException e) {
                return bindingFailure(authorizationId, connector.getConnectorId(), e);
            }
        } finally {
            releaseStartLockBestEffort(userId, connector.getConnectorId(), lockToken.get());
        }
    }

    private Long requireCredentialUserId(String userId) {
        if (!StringUtils.hasText(userId)) {
            throw new IllegalArgumentException("userId is required");
        }
        return Long.valueOf(userId.trim());
    }

    private ConnectorAuthorizationDto startLocked(
            StartConnectorAuthorizationRequest request,
            String userId,
            ConnectorInfo connector,
            ConnectorAuthorizationProvider provider) {
        ManifestCommandCatalog commandCatalog;
        try {
            commandCatalog = resolveCommandCatalog(connector);
        } catch (InvalidConnectorManifestException e) {
            log.warn("[ConnectorAuth] 连接器 {} 运行时配置无效: {}", connector.getConnectorId(), e.getMessage(), e);
            return failed(
                null,
                connector.getConnectorId(),
                CONNECTOR_MANIFEST_INVALID,
                I18nUtil.get("connector.runtime.invalid"),
                null
            );
        }
        String authorizationId = UUID.randomUUID().toString();
        AuthorizationStartContext context = new AuthorizationStartContext(
            authorizationId,
            userId,
            connector.getConnectorId(),
            connector.getConnectorCode(),
            connector.getProviderCode(),
            request.getRedirectUrl(),
            providerConfig(connector.getAuthConfig()),
            commandCatalog
        );
        AuthorizationStartResult startResult = startProvider(provider, context);
        Date expiresAt = normalizedExpiry(startResult.expiresAt());
        AuthorizationStatus providerStatus = startResult.status();
        AuthorizationStatus initialStatus = providerStatus == AuthorizationStatus.CONNECTED
            ? AuthorizationStatus.PENDING
            : providerStatus;
        boolean active = isActive(initialStatus);
        RedisAuthorizationSession session = new RedisAuthorizationSession(
            authorizationId,
            userId,
            connector.getConnectorId(),
            connector.getConnectorCode(),
            connector.getProviderCode(),
            initialStatus,
            active ? startResult.phase() : null,
            active ? encrypt(startResult.authorizationUrl()) : null,
            startResult.providerSessionId(),
            active ? encrypt(startResult.providerState()) : null,
            null,
            expiresAt,
            startResult.errorCode(),
            startResult.errorMessage(),
            commandCatalog == null ? null : commandCatalog.digest(),
            0L
        );
        try {
            sessionRepository.create(session);
        } catch (RuntimeException e) {
            if (active) {
                cancelProviderBestEffort(
                    provider,
                    providerContext(session, startResult.providerState(), commandCatalog)
                );
            }
            return failed(
                authorizationId,
                connector.getConnectorId(),
                SESSION_ALREADY_ACTIVE,
                I18nUtil.get("connector.authorization.active"),
                expiresAt
            );
        }
        if (providerStatus == AuthorizationStatus.CONNECTED) {
            return finalizeConnected(
                session,
                new AuthorizationStatusResult(AuthorizationStatus.CONNECTED, null, null, null, null, null, null)
            );
        }
        return toDto(session, active ? startResult.authorizationUrl() : null);
    }

    public ConnectorAuthorizationDto status(String authorizationId, String userId) {
        Optional<RedisAuthorizationSession> owned = sessionRepository.findOwned(authorizationId, userId);
        if (owned.isEmpty()) {
            return authorizationNotFound(authorizationId);
        }
        RedisAuthorizationSession session = owned.get();
        if (session.status() == AuthorizationStatus.FINALIZING) {
            return recoverFinalizing(session, true);
        }
        if (session.status() != AuthorizationStatus.PENDING) {
            return toDto(session, null);
        }
        if (APP_INITIALIZATION_PHASE.equals(session.phase())) {
            Optional<String> lockToken = sessionRepository.tryAcquireStatusLock(
                authorizationId,
                STATUS_TRANSITION_LOCK_TTL
            );
            if (lockToken.isEmpty()) {
                return toDto(session, decryptBestEffort(session.authorizationUrlCipher()));
            }
            try {
                Optional<RedisAuthorizationSession> refreshed = sessionRepository.findOwned(authorizationId, userId);
                if (refreshed.isEmpty()) {
                    return authorizationNotFound(authorizationId);
                }
                RedisAuthorizationSession current = refreshed.get();
                if (current.status() != AuthorizationStatus.PENDING
                        || !APP_INITIALIZATION_PHASE.equals(current.phase())) {
                    return toDto(current, decryptBestEffort(current.authorizationUrlCipher()));
                }
                return queryPendingStatus(current);
            } finally {
                releaseStatusLockBestEffort(authorizationId, lockToken.get());
            }
        }
        return queryPendingStatus(session);
    }

    /** Completes a browser OAuth2 callback for the current user-owned authorization session. */
    public ConnectorAuthorizationDto callback(String providerCode, AuthorizationCallback callback, String userId) {
        String authorizationId;
        try {
            authorizationId = OAuth2State.authorizationId(callback == null ? null : callback.state());
        } catch (IllegalArgumentException e) {
            return authorizationNotFound(null);
        }
        RedisAuthorizationSession session = sessionRepository.findOwned(authorizationId, userId)
            .orElseGet(() -> null);
        if (session == null || !StringUtils.hasText(providerCode) || !providerCode.equals(session.providerCode())) {
            return authorizationNotFound(authorizationId);
        }
        if (session.status() != AuthorizationStatus.PENDING) {
            return toDto(session, null);
        }
        Optional<String> lockToken = sessionRepository.tryAcquireStatusLock(
            authorizationId,
            STATUS_TRANSITION_LOCK_TTL
        );
        if (lockToken.isEmpty()) {
            return toDto(session, null);
        }
        try {
            Optional<RedisAuthorizationSession> refreshed = sessionRepository.findOwned(authorizationId, userId);
            if (refreshed.isEmpty()) {
                return authorizationNotFound(authorizationId);
            }
            session = refreshed.get();
            if (!providerCode.equals(session.providerCode())) {
                return authorizationNotFound(authorizationId);
            }
            if (session.status() != AuthorizationStatus.PENDING) {
                return toDto(session, null);
            }
            if (session.expiresAt() != null && session.expiresAt().getTime() <= System.currentTimeMillis()) {
                return transitionProviderTerminal(session, new AuthorizationStatusResult(
                    AuthorizationStatus.EXPIRED, null, null, null, null,
                    OAUTH_CALLBACK_EXPIRED, I18nUtil.get("connector.authorization.callbackExpired")
                ));
            }
            ConnectorAuthorizationProvider provider = findProvider(providerCode);
            if (provider == null) {
                return transitionProviderTerminal(session, new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED, null, null, null, null,
                    PROVIDER_NOT_CONFIGURED, I18nUtil.get("connector.authorization.providerMissing")
                ));
            }
            AuthorizationStatusResult result;
            try {
                result = provider.handleCallback(
                    providerContext(session, decrypt(session.providerStateCipher()), null), callback
                );
            } catch (RuntimeException e) {
                result = new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED, null, null, null, null,
                    PROVIDER_PROTOCOL_ERROR, I18nUtil.get("connector.authorization.callbackFailed")
                );
            }
            if (result == null || result.status() == null) {
                return transitionProviderTerminal(session, new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED, null, null, null, null,
                    PROVIDER_PROTOCOL_ERROR, I18nUtil.get("connector.authorization.resultInvalid")
                ));
            }
            return result.status() == AuthorizationStatus.CONNECTED
                ? finalizeConnected(session, result)
                : transitionProviderTerminal(session, result);
        } finally {
            releaseStatusLockBestEffort(authorizationId, lockToken.get());
        }
    }

    public boolean cancel(String authorizationId, String userId) {
        RedisAuthorizationSession session = sessionRepository.findOwned(authorizationId, userId)
            .orElseThrow(() -> new IllegalArgumentException(I18nUtil.get("connector.authorization.notFound")));
        if (session.status() != AuthorizationStatus.PENDING) {
            return cancellationSucceeded(session.status());
        }

        String providerState = decryptBestEffort(session.providerStateCipher());
        RedisAuthorizationSession cancelled = replacement(
            session,
            AuthorizationStatus.CANCELLED,
            null,
            null,
            AUTH_CANCELLED,
            I18nUtil.get("connector.authorization.cancelled")
        );
        if (!sessionRepository.compareAndSetStatus(
                authorizationId,
                AuthorizationStatus.PENDING,
                session.version(),
                cancelled)) {
            return sessionRepository.findOwned(authorizationId, userId)
                .map(current -> cancellationSucceeded(current.status()))
                .orElse(false);
        }

        ConnectorAuthorizationProvider provider = findProvider(session.providerCode());
        if (provider != null) {
            cancelProviderBestEffort(provider, providerContext(session, providerState, null));
        }
        sessionRepository.deleteSecrets(authorizationId);
        return true;
    }

    private ConnectorAuthorizationDto queryPendingStatus(RedisAuthorizationSession session) {
        String authorizationUrl;
        String providerState;
        try {
            authorizationUrl = decrypt(session.authorizationUrlCipher());
            providerState = decrypt(session.providerStateCipher());
        } catch (RuntimeException e) {
            return transitionProviderTerminal(
                session,
                new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED,
                    null,
                    null,
                    null,
                    null,
                    PROVIDER_PROTOCOL_ERROR,
                    I18nUtil.get("connector.authorization.sessionInvalid")
                )
            );
        }

        ConnectorAuthorizationProvider provider = findProvider(session.providerCode());
        if (provider == null) {
            return transitionProviderTerminal(
                session,
                new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED,
                    null,
                    null,
                    null,
                    null,
                    PROVIDER_NOT_CONFIGURED,
                    I18nUtil.get("connector.authorization.providerMissing")
                )
            );
        }

        AuthorizationStatusResult result;
        try {
            ManifestCommandCatalog commandCatalog = resolveSessionCommandCatalog(session);
            result = provider.queryStatus(providerContext(session, providerState, commandCatalog));
        } catch (InvalidConnectorManifestException e) {
            log.warn("[ConnectorAuth] 授权会话 {} 状态查询时连接器 {} 运行时配置无效: {}",
                session.authorizationId(), session.connectorId(), e.getMessage(), e);
            cancelProviderBestEffort(provider, providerContext(session, providerState, null));
            return transitionProviderTerminal(
                session,
                new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED,
                    null,
                    null,
                    null,
                    null,
                    CONNECTOR_MANIFEST_INVALID,
                    I18nUtil.get("connector.runtime.invalid")
                )
            );
        } catch (RuntimeException e) {
            result = null;
        }
        if (result == null || result.status() == null) {
            return transitionProviderTerminal(
                session,
                new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED,
                    null,
                    null,
                    null,
                    null,
                    PROVIDER_PROTOCOL_ERROR,
                    I18nUtil.get("connector.authorization.resultInvalid")
                )
            );
        }
        return switch (result.status()) {
            case PENDING -> result.progress() == null
                ? toDto(session, authorizationUrl)
                : transitionPendingProgress(session, result.progress());
            case FINALIZING -> toDto(session, authorizationUrl);
            case CONNECTED -> result.credentialState() == CredentialState.REAUTH_REQUIRED
                ? transitionProviderTerminal(
                    session,
                    new AuthorizationStatusResult(
                        AuthorizationStatus.FAILED,
                        null,
                        null,
                        null,
                        null,
                        "CONNECTOR_CREDENTIAL_INVALID",
                        I18nUtil.get("connector.authorization.reauthorize")
                    )
                )
                : finalizeConnected(session, result);
            case FAILED, EXPIRED, CANCELLED -> transitionProviderTerminal(session, result);
        };
    }

    private ConnectorAuthorizationDto transitionPendingProgress(
            RedisAuthorizationSession session,
            AuthorizationProgress progress) {
        if (!StringUtils.hasText(progress.phase())
                || !StringUtils.hasText(progress.authorizationUrl())
                || !StringUtils.hasText(progress.providerState())
                || progress.expiresAt() == null
                || progress.expiresAt().getTime() <= System.currentTimeMillis()) {
            return transitionProviderTerminal(
                session,
                new AuthorizationStatusResult(
                    AuthorizationStatus.FAILED,
                    null,
                    null,
                    null,
                    null,
                    PROVIDER_PROTOCOL_ERROR,
                    I18nUtil.get("connector.authorization.progressInvalid")
                )
            );
        }
        RedisAuthorizationSession replacement = new RedisAuthorizationSession(
            session.authorizationId(),
            session.userId(),
            session.connectorId(),
            session.connectorCode(),
            session.providerCode(),
            AuthorizationStatus.PENDING,
            progress.phase(),
            encrypt(progress.authorizationUrl()),
            session.providerSessionId(),
            encrypt(progress.providerState()),
            session.ownerInstanceId(),
            boundedProgressExpiry(progress.expiresAt()),
            null,
            null,
            session.manifestDigest(),
            session.version() + 1L
        );
        if (!sessionRepository.compareAndSetStatus(
                session.authorizationId(),
                AuthorizationStatus.PENDING,
                session.version(),
                replacement)) {
            return afterCasConflict(session);
        }
        return toDto(replacement, progress.authorizationUrl());
    }

    private ConnectorAuthorizationDto finalizeConnected(
            RedisAuthorizationSession session,
            AuthorizationStatusResult result) {
        RedisAuthorizationSession finalizing = replacement(
            session,
            AuthorizationStatus.FINALIZING,
            session.authorizationUrlCipher(),
            session.providerStateCipher(),
            null,
            null
        );
        if (!sessionRepository.compareAndSetStatus(
                session.authorizationId(),
                AuthorizationStatus.PENDING,
                session.version(),
                finalizing)) {
            return afterCasConflict(session);
        }

        long finalizingVersion = session.version() + 1L;
        try {
            ConnectorInfo connector = connectorInfoService.findById(session.connectorId());
            if (connector == null || !"00A".equals(connector.getStatusCd())) {
                throw new IllegalStateException("Connector is unavailable while finalizing authorization");
            }
            saveEnabledAuthorization(session.userId(), connector, result, session.authorizationId());
            RedisAuthorizationSession connected = replacement(
                session,
                AuthorizationStatus.CONNECTED,
                null,
                null,
                null,
                null
            );
            if (sessionRepository.compareAndSetStatus(
                    session.authorizationId(),
                    AuthorizationStatus.FINALIZING,
                    finalizingVersion,
                    connected)) {
                return toDto(connected, null);
            }
            return recoverFinalizingAfterCasFailure(session);
        } catch (RuntimeException e) {
            cleanupProvisionalCredentialBestEffort(session, result);
            String errorCode = bindingErrorCode(e);
            String errorMessage = bindingErrorMessage(e);
            RedisAuthorizationSession failed = replacement(
                session,
                AuthorizationStatus.FAILED,
                null,
                null,
                errorCode,
                errorMessage
            );
            if (sessionRepository.compareAndSetStatus(
                    session.authorizationId(),
                    AuthorizationStatus.FINALIZING,
                    finalizingVersion,
                    failed)) {
                return toDto(failed, null);
            }
        }
        sessionRepository.deleteSecrets(session.authorizationId());
        return afterCasConflict(session);
    }

    private void cleanupProvisionalCredentialBestEffort(
            RedisAuthorizationSession session,
            AuthorizationStatusResult result) {
        if (result == null || !StringUtils.hasText(result.credentialReference())) {
            return;
        }
        ConnectorAuthorizationProvider provider = findProvider(session.providerCode());
        if (!(provider instanceof ConnectorProvisionalCredentialCleaner cleaner)) {
            return;
        }
        try {
            cleaner.cleanupProvisionalCredential(
                providerContext(session, decryptBestEffort(session.providerStateCipher()), null),
                result.credentialReference()
            );
        } catch (RuntimeException e) {
            // The binding failure remains authoritative; cleanup can be retried by credential reconciliation.
        }
    }

    private ConnectorAuthorizationDto recoverFinalizingAfterCasFailure(RedisAuthorizationSession previous) {
        Optional<RedisAuthorizationSession> current = sessionRepository.findOwned(
            previous.authorizationId(),
            previous.userId()
        );
        if (current.isEmpty()) {
            return authorizationNotFound(previous.authorizationId());
        }
        RedisAuthorizationSession session = current.get();
        if (session.status() == AuthorizationStatus.FINALIZING) {
            return recoverFinalizing(session, true);
        }
        return toDto(session, null);
    }

    private ConnectorAuthorizationDto recoverFinalizing(
            RedisAuthorizationSession session,
            boolean allowRetry) {
        ConnectorAuth binding = findEnabledActiveAuthorization(session.userId(), session.connectorId());
        if (!bindingMatchesAuthorization(binding, session.authorizationId())) {
            return toDto(session, null);
        }
        RedisAuthorizationSession connected = replacement(
            session,
            AuthorizationStatus.CONNECTED,
            null,
            null,
            null,
            null
        );
        if (sessionRepository.compareAndSetStatus(
                session.authorizationId(),
                AuthorizationStatus.FINALIZING,
                session.version(),
                connected)) {
            return toDto(connected, null);
        }
        Optional<RedisAuthorizationSession> current = sessionRepository.findOwned(
            session.authorizationId(),
            session.userId()
        );
        if (current.isEmpty()) {
            return authorizationNotFound(session.authorizationId());
        }
        RedisAuthorizationSession latest = current.get();
        if (allowRetry && latest.status() == AuthorizationStatus.FINALIZING) {
            return recoverFinalizing(latest, false);
        }
        if (latest.status() == AuthorizationStatus.FINALIZING) {
            sessionRepository.deleteSecrets(latest.authorizationId());
        }
        return toDto(latest, null);
    }

    private ConnectorAuthorizationDto transitionProviderTerminal(
            RedisAuthorizationSession session,
            AuthorizationStatusResult result) {
        RedisAuthorizationSession terminal = replacement(
            session,
            result.status(),
            null,
            null,
            result.errorCode(),
            result.errorMessage()
        );
        if (sessionRepository.compareAndSetStatus(
                session.authorizationId(),
                AuthorizationStatus.PENDING,
                session.version(),
                terminal)) {
            return toDto(terminal, null);
        }
        return afterCasConflict(session);
    }

    private ConnectorAuthorizationDto afterCasConflict(RedisAuthorizationSession previous) {
        Optional<RedisAuthorizationSession> current = sessionRepository.findOwned(
            previous.authorizationId(),
            previous.userId()
        );
        if (current.isEmpty()) {
            return authorizationNotFound(previous.authorizationId());
        }
        RedisAuthorizationSession session = current.get();
        if (session.status() == AuthorizationStatus.FINALIZING) {
            return recoverFinalizing(session, true);
        }
        String authorizationUrl = session.status() == AuthorizationStatus.PENDING
            ? decryptBestEffort(session.authorizationUrlCipher())
            : null;
        return toDto(session, authorizationUrl);
    }

    private AuthorizationStartResult startProvider(
            ConnectorAuthorizationProvider provider,
            AuthorizationStartContext context) {
        try {
            AuthorizationStartResult result = provider.start(context);
            if (result != null && result.status() != null) {
                return result;
            }
        } catch (RuntimeException e) {
            log.warn(
                "[ConnectorAuth] 授权Provider启动失败, connectorId={}, providerCode={}, exceptionType={}",
                context.connectorId(),
                context.providerCode(),
                e.getClass().getSimpleName(),
                e
            );
        }
        return new AuthorizationStartResult(
            AuthorizationStatus.FAILED,
            null,
            null,
            null,
            null,
            PROVIDER_PROTOCOL_ERROR,
            I18nUtil.get("connector.authorization.resultInvalid")
        );
    }

    private ConnectorAuthorizationProvider findProvider(String providerCode) {
        if (!StringUtils.hasText(providerCode)) {
            return null;
        }
        try {
            return providerRegistry.get(providerCode);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private Map<String, Object> providerConfig(String authConfig) {
        if (!StringUtils.hasText(authConfig)) {
            return Map.of();
        }
        try {
            JSONObject object = JSON.parseObject(authConfig);
            return object == null ? Map.of() : new LinkedHashMap<>(object);
        } catch (RuntimeException e) {
            return Map.of();
        }
    }

    private Date normalizedExpiry(Date expiresAt) {
        long now = System.currentTimeMillis();
        if (expiresAt == null || expiresAt.getTime() <= now) {
            return new Date(now + AUTHORIZATION_TTL_MILLIS);
        }
        return new Date(expiresAt.getTime());
    }

    private Date boundedProgressExpiry(Date expiresAt) {
        long maximumExpiry = System.currentTimeMillis() + AUTHORIZATION_TTL_MILLIS;
        return new Date(Math.min(expiresAt.getTime(), maximumExpiry));
    }

    private RedisAuthorizationSession replacement(
            RedisAuthorizationSession source,
            AuthorizationStatus status,
            String authorizationUrlCipher,
            String providerStateCipher,
            String errorCode,
            String errorMessage) {
        return new RedisAuthorizationSession(
            source.authorizationId(),
            source.userId(),
            source.connectorId(),
            source.connectorCode(),
            source.providerCode(),
            status,
            source.phase(),
            authorizationUrlCipher,
            source.providerSessionId(),
            providerStateCipher,
            source.ownerInstanceId(),
            source.expiresAt(),
            errorCode,
            errorMessage,
            source.manifestDigest(),
            source.version() + 1L
        );
    }

    private AuthorizationSessionContext providerContext(
            RedisAuthorizationSession session,
            String providerState,
            ManifestCommandCatalog commandCatalog) {
        return new AuthorizationSessionContext(
            session.authorizationId(),
            session.userId(),
            session.connectorId(),
            session.connectorCode(),
            session.providerCode(),
            session.providerSessionId(),
            providerState,
            session.expiresAt(),
            commandCatalog
        );
    }

    private ManifestCommandCatalog resolveCommandCatalog(ConnectorInfo connector) {
        return manifestCommandResolver == null ? null : manifestCommandResolver.resolve(connector);
    }

    private ManifestCommandCatalog resolveSessionCommandCatalog(RedisAuthorizationSession session) {
        if (manifestCommandResolver == null) {
            return null;
        }
        ConnectorInfo connector = connectorInfoService.findById(session.connectorId());
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            throw new InvalidConnectorManifestException("Connector is unavailable");
        }
        ManifestCommandCatalog commandCatalog = manifestCommandResolver.resolve(connector);
        if (StringUtils.hasText(session.manifestDigest())
                && !session.manifestDigest().equals(commandCatalog.digest())) {
            throw new InvalidConnectorManifestException("Connector Manifest changed during authorization");
        }
        return commandCatalog;
    }

    private void cancelProviderBestEffort(
            ConnectorAuthorizationProvider provider,
            AuthorizationSessionContext context) {
        try {
            provider.cancel(context);
        } catch (RuntimeException e) {
            // Provider cleanup is best effort and must not expose platform details.
        }
    }

    private void releaseStatusLockBestEffort(String authorizationId, String token) {
        try {
            sessionRepository.releaseStatusLock(authorizationId, token);
        } catch (RuntimeException e) {
            // The bounded Redis lease will expire; cleanup failure must not mask a valid status response.
        }
    }

    private void releaseStartLockBestEffort(String userId, Long connectorId, String token) {
        try {
            sessionRepository.releaseStartLock(userId, connectorId, token);
        } catch (RuntimeException e) {
            // The bounded Redis lease will expire; cleanup failure must not mask the start result.
        }
    }

    private void saveEnabledAuthorization(
            String userId,
            ConnectorInfo connector,
            AuthorizationStatusResult statusResult,
            String authorizationId) {
        if (connectionStateService != null) {
            connectionStateService.saveEnabledAuthorization(userId, connector, statusResult, authorizationId);
            return;
        }
        ConnectorAuth existing = findActiveAuthorization(userId, connector.getConnectorId());
        Date now = new Date();
        ConnectorAuth auth = existing == null ? new ConnectorAuth() : existing;
        applyEnabledAuthorization(auth, userId, connector, statusResult, authorizationId, now);

        if (existing != null) {
            auth.setUpdateTime(now);
            requireSingleAffectedRow(connectorAuthMapper.updateById(auth));
            return;
        }
        auth.setAuthId(sequenceService.nextVal());
        auth.setCreateBy(userId);
        auth.setCreateTime(now);
        int inserted = connectorAuthMapper.insertActiveIgnoreConflict(auth);
        if (inserted == 1) {
            return;
        }
        if (inserted != 0) {
            throw new IllegalStateException("Connector authorization insert returned an unexpected row count");
        }
        ConnectorAuth winner = findActiveAuthorization(userId, connector.getConnectorId());
        if (winner == null) {
            throw new IllegalStateException("Connector authorization conflict without an active winner");
        }
        Date retryTime = new Date();
        applyEnabledAuthorization(winner, userId, connector, statusResult, authorizationId, retryTime);
        winner.setUpdateTime(retryTime);
        requireSingleAffectedRow(connectorAuthMapper.updateById(winner));
    }

    private ConnectorAuth findActiveAuthorization(String userId, Long connectorId) {
        return connectorAuthMapper.selectOne(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getUserId, userId)
            .eq(ConnectorAuth::getConnectorId, connectorId)
            .eq(ConnectorAuth::getStatusCd, "00A")
            .orderByDesc(ConnectorAuth::getUpdateTime)
            .last("LIMIT 1"));
    }

    private ConnectorAuth findEnabledActiveAuthorization(String userId, Long connectorId) {
        if (connectionStateService != null) {
            return connectionStateService.findEnabledActiveAuthorization(userId, connectorId);
        }
        return connectorAuthMapper.selectOne(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getUserId, userId)
            .eq(ConnectorAuth::getConnectorId, connectorId)
            .eq(ConnectorAuth::getEnableFlag, "Y")
            .eq(ConnectorAuth::getStatusCd, "00A")
            .orderByDesc(ConnectorAuth::getUpdateTime)
            .last("LIMIT 1"));
    }

    private void applyEnabledAuthorization(
            ConnectorAuth auth,
            String userId,
            ConnectorInfo connector,
            AuthorizationStatusResult statusResult,
            String authorizationId,
            Date now) {
        auth.setUserId(userId);
        auth.setConnectorId(connector.getConnectorId());
        auth.setAuthMode(connector.getAuthMode());
        auth.setAuthName(accountName(statusResult));
        auth.setExternalAccountId(statusResult == null ? null : statusResult.accountId());
        auth.setAuthCredential(buildCredential(connector, statusResult, authorizationId));
        auth.setEnableFlag("Y");
        auth.setStatusCd("00A");
        auth.setLastSyncTime(now);
        applyCredentialLifecycle(auth, statusResult);
    }

    private void applyCredentialLifecycle(ConnectorAuth auth, AuthorizationStatusResult statusResult) {
        if (statusResult == null) {
            auth.setCredentialState("UNKNOWN");
            auth.setRenewalMode("NONE");
            return;
        }
        auth.setExpireTime(statusResult.accessExpiresAt());
        auth.setAccessExpireTime(statusResult.accessExpiresAt());
        auth.setRefreshExpireTime(statusResult.refreshExpiresAt());
        auth.setCredentialState(statusResult.credentialState().name());
        auth.setRenewalMode(statusResult.renewalMode().name());
        auth.setLastVerifiedAt(statusResult.lastVerifiedAt());
    }

    private void requireSingleAffectedRow(int affectedRows) {
        if (affectedRows != 1) {
            throw new IllegalStateException("Connector authorization binding write did not affect exactly one row");
        }
    }

    private boolean cancellationSucceeded(AuthorizationStatus status) {
        return status == AuthorizationStatus.CANCELLED
            || status == AuthorizationStatus.FAILED
            || status == AuthorizationStatus.EXPIRED;
    }

    private String buildCredential(
            ConnectorInfo connector,
            AuthorizationStatusResult statusResult,
            String authorizationId) {
        if ("NONE".equals(connector.getAuthMode())) {
            return null;
        }
        Map<String, Object> metadata = new LinkedHashMap<>();
        putIfHasText(metadata, "providerCode", connector.getProviderCode());
        putIfHasText(metadata, "authorizationId", authorizationId);
        if (statusResult != null) {
            putIfHasText(metadata, "credentialReference", statusResult.credentialReference());
            putIfHasText(metadata, "accountId", statusResult.accountId());
            putIfHasText(metadata, "accountName", statusResult.accountName());
            statusResult.accountAttributes().forEach((key, value) -> putIfHasText(metadata, key, value));
        }
        return Sm4Util.encrypt(JSON.toJSONString(metadata));
    }

    private boolean bindingMatchesAuthorization(ConnectorAuth binding, String authorizationId) {
        if (binding == null
                || "NONE".equals(binding.getAuthMode())
                || !StringUtils.hasText(binding.getAuthCredential())
                || !StringUtils.hasText(authorizationId)) {
            return false;
        }
        try {
            JSONObject credential = JSON.parseObject(Sm4Util.decrypt(binding.getAuthCredential()));
            Object persistedAuthorizationId = credential == null ? null : credential.get("authorizationId");
            return persistedAuthorizationId instanceof String value && authorizationId.equals(value);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private String accountName(AuthorizationStatusResult statusResult) {
        if (statusResult == null) {
            return null;
        }
        if (StringUtils.hasText(statusResult.accountName())) {
            return statusResult.accountName();
        }
        return StringUtils.hasText(statusResult.accountId()) ? statusResult.accountId() : null;
    }

    private void putIfHasText(Map<String, Object> metadata, String key, String value) {
        if (StringUtils.hasText(value)) {
            metadata.put(key, value);
        }
    }

    private boolean isActive(AuthorizationStatus status) {
        return status == AuthorizationStatus.PENDING || status == AuthorizationStatus.FINALIZING;
    }

    private String encrypt(String value) {
        return StringUtils.hasText(value) ? Sm4Util.encrypt(value) : null;
    }

    private String decrypt(String cipher) {
        return StringUtils.hasText(cipher) ? Sm4Util.decrypt(cipher) : null;
    }

    private String decryptBestEffort(String cipher) {
        try {
            return decrypt(cipher);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private void validateRequest(StartConnectorAuthorizationRequest request) {
        if (request == null || request.getConnectorId() == null) {
            throw new IllegalArgumentException(I18nUtil.get("connector.id.required"));
        }
    }

    private void validateRedirectUrl(String redirectUrl) {
        if (!StringUtils.hasText(redirectUrl)) {
            throw new IllegalArgumentException(I18nUtil.get("connector.redirectUrl.required"));
        }
        URI redirectUri = URI.create(redirectUrl);
        if (!"http".equalsIgnoreCase(redirectUri.getScheme())
                && !"https".equalsIgnoreCase(redirectUri.getScheme())) {
            throw new IllegalArgumentException(I18nUtil.get("connector.redirectUrl.invalid"));
        }
    }

    private ConnectorAuthorizationDto connected(String authorizationId, Long connectorId, Date expiresAt) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(authorizationId);
        result.setConnectorId(connectorId);
        result.setStatus("connected");
        result.setExpiresAt(expiresAt);
        return result;
    }

    private ConnectorAuthorizationDto failed(
            String authorizationId,
            Long connectorId,
            String errorCode,
            String errorMessage,
            Date expiresAt) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(authorizationId);
        result.setConnectorId(connectorId);
        result.setStatus("failed");
        result.setExpiresAt(expiresAt);
        result.setErrorCode(errorCode);
        result.setErrorMessage(ConnectorMessages.localize(errorMessage));
        return result;
    }

    private ConnectorAuthorizationDto bindingFailure(
            String authorizationId,
            Long connectorId,
            RuntimeException error) {
        log.warn("[ConnectorAuth] 授权 {} 绑定失败: {}", authorizationId, error.getMessage(), error);
        return failed(
            authorizationId,
            connectorId,
            bindingErrorCode(error),
            bindingErrorMessage(error),
            null
        );
    }

    private String bindingErrorCode(RuntimeException error) {
        return error instanceof InvalidConnectorManifestException
            ? CONNECTOR_MANIFEST_INVALID
            : AUTH_BINDING_FAILED;
    }

    private String bindingErrorMessage(RuntimeException error) {
        return error instanceof InvalidConnectorManifestException
            ? I18nUtil.get("connector.runtime.invalid")
            : I18nUtil.get("connector.authorization.bindingFailed");
    }

    private ConnectorAuthorizationDto authorizationNotFound(String authorizationId) {
        return failed(authorizationId, null, AUTHORIZATION_NOT_FOUND, I18nUtil.get("connector.authorization.notFound"), null);
    }

    private ConnectorAuthorizationDto toDto(RedisAuthorizationSession session, String authorizationUrl) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(session.authorizationId());
        result.setConnectorId(session.connectorId());
        result.setStatus(externalStatus(session.status()));
        result.setPhase(session.phase());
        result.setAuthorizationUrl(authorizationUrl);
        result.setQrCodeUrl(qrCodeEncoder.encode(authorizationUrl));
        result.setExpiresAt(session.expiresAt());
        result.setErrorCode(session.errorCode());
        result.setErrorMessage(ConnectorMessages.localize(session.errorMessage()));
        return result;
    }

    private String externalStatus(AuthorizationStatus status) {
        return status == AuthorizationStatus.FINALIZING ? "pending" : status.name().toLowerCase(java.util.Locale.ROOT);
    }
}
