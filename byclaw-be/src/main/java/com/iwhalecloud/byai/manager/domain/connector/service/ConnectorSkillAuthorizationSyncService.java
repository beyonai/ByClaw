package com.iwhalecloud.byai.manager.domain.connector.service;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import io.micrometer.core.instrument.Timer;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifierRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorSkillAuthorizationSyncDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Independently verifies an existing CLI credential before enabling its connector binding. */
@Service
public class ConnectorSkillAuthorizationSyncService {

    private static final Logger log = LoggerFactory.getLogger(ConnectorSkillAuthorizationSyncService.class);
    private static final int MAX_RATE_LIMIT_ENTRIES = 4_096;
    private static final Duration OPERATION_LOCK_TTL = Duration.ofMinutes(2);
    private static final Map<String, String> SKILL_CONNECTOR_PROVIDERS = Map.of(
        "dingtalk", "dws-dingtalk",
        "lark", "lark-cli",
        "wecom", "wecom-cli",
        "ima", "ima-openapi",
        "ima-skill", "ima-openapi"
    );
    private static final Set<String> PUBLIC_VERIFICATION_ERRORS = Set.of(
        "CREDENTIAL_WORKSPACE_UNAVAILABLE",
        "CONNECTOR_CACHE_INVALID",
        "CONNECTOR_BUSINESS_PROBE_INVALID",
        "CONNECTOR_CREDENTIAL_INVALID",
        "CONNECTOR_CLI_UNAVAILABLE",
        "CONNECTOR_VERIFICATION_TIMEOUT",
        "CONNECTOR_VERIFICATION_FAILED",
        "PROVIDER_PROTOCOL_ERROR"
    );

    private final ConnectorInfoService connectorInfoService;
    private final ConnectorCredentialVerifierRegistry verifierRegistry;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorSkillAuthorizationSyncProperties properties;
    private final ConnectorSkillAuthorizationSyncMetrics metrics;
    private final ConnectorCredentialVerificationGuard verificationGuard;
    private final RedisAuthorizationSessionRepository sessionRepository;
    private final ConcurrentHashMap<Long, Long> nextAllowedVerificationNanos = new ConcurrentHashMap<>();

    public ConnectorSkillAuthorizationSyncService(
            ConnectorInfoService connectorInfoService,
            ConnectorCredentialVerifierRegistry verifierRegistry,
            ConnectorConnectionStateService connectionStateService,
            ConnectorSkillAuthorizationSyncProperties properties,
            ConnectorSkillAuthorizationSyncMetrics metrics) {
        this(connectorInfoService, verifierRegistry, connectionStateService, properties, metrics,
            new ConnectorCredentialVerificationGuard(properties), null);
    }

    public ConnectorSkillAuthorizationSyncService(
            ConnectorInfoService connectorInfoService,
            ConnectorCredentialVerifierRegistry verifierRegistry,
            ConnectorConnectionStateService connectionStateService,
            ConnectorSkillAuthorizationSyncProperties properties,
            ConnectorSkillAuthorizationSyncMetrics metrics,
            ConnectorCredentialVerificationGuard verificationGuard) {
        this(connectorInfoService, verifierRegistry, connectionStateService, properties, metrics, verificationGuard, null);
    }

    @Autowired
    public ConnectorSkillAuthorizationSyncService(
            ConnectorInfoService connectorInfoService,
            ConnectorCredentialVerifierRegistry verifierRegistry,
            ConnectorConnectionStateService connectionStateService,
            ConnectorSkillAuthorizationSyncProperties properties,
            ConnectorSkillAuthorizationSyncMetrics metrics,
            ConnectorCredentialVerificationGuard verificationGuard,
            RedisAuthorizationSessionRepository sessionRepository) {
        this.connectorInfoService = connectorInfoService;
        this.verifierRegistry = verifierRegistry;
        this.connectionStateService = connectionStateService;
        this.properties = properties;
        this.metrics = metrics;
        this.verificationGuard = verificationGuard;
        this.sessionRepository = sessionRepository;
    }

    public ConnectorSkillAuthorizationSyncDto sync(String connectorCode, String userId) {
        Timer.Sample metricSample = metrics.start();
        long startedNanos = System.nanoTime();
        try {
            ConnectorSkillAuthorizationSyncDto result = synchronize(connectorCode, userId);
            metrics.recordSuccess(metricSample);
            audit(userId, result.getConnectorCode(), "CONNECTED", startedNanos);
            return result;
        } catch (ConnectorSkillAuthorizationSyncException e) {
            metrics.recordFailure(metricSample, e.getErrorCode());
            audit(userId, safeConnectorCode(connectorCode), e.getErrorCode(), startedNanos);
            throw e;
        } catch (RuntimeException e) {
            metrics.recordFailure(metricSample, "CONNECTOR_SYNC_INTERNAL_ERROR");
            audit(userId, safeConnectorCode(connectorCode), "CONNECTOR_SYNC_INTERNAL_ERROR", startedNanos);
            throw e;
        }
    }

    private ConnectorSkillAuthorizationSyncDto synchronize(String connectorCode, String userId) {
        String normalizedCode = normalizeConnectorCode(connectorCode);
        Long numericUserId = requireUser(userId);
        String expectedProviderCode = SKILL_CONNECTOR_PROVIDERS.get(normalizedCode);
        if (expectedProviderCode == null) {
            throw failure("CONNECTOR_NOT_FOUND", "Connector is unavailable", false);
        }
        ConnectorInfo connector = connectorInfoService.findByCode(resolveConnectorCode(normalizedCode));
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            throw failure("CONNECTOR_NOT_FOUND", "Connector is unavailable", false);
        }
        if (!expectedProviderCode.equals(connector.getProviderCode())) {
            throw failure("CONNECTOR_VERIFIER_NOT_FOUND", "Connector verifier is unavailable", false);
        }

        ConnectorCredentialVerifier verifier;
        try {
            verifier = verifierRegistry.get(expectedProviderCode);
        } catch (IllegalArgumentException e) {
            throw failure("CONNECTOR_VERIFIER_NOT_FOUND", "Connector verifier is unavailable", false);
        }

        Optional<String> operationLock = acquireOperationLock(userId, connector.getConnectorId());
        try (ConnectorCredentialVerificationGuard.Admission ignored = acquire(numericUserId, connector.getConnectorCode())) {
            AuthorizationStatusResult verification = verify(verifier, numericUserId, connector);
            if (verification == null
                    || verification.status() != AuthorizationStatus.CONNECTED
                    || verification.credentialState() == CredentialState.REAUTH_REQUIRED) {
                throw verificationFailure(verification);
            }
            try {
                connectionStateService.saveEnabledAuthorization(userId, connector, verification, null);
            } catch (ConnectorSkillAuthorizationSyncException e) {
                throw e;
            } catch (InvalidConnectorManifestException e) {
                throw failure("CONNECTOR_MANIFEST_INVALID", "Connector runtime configuration is invalid", false);
            } catch (RuntimeException e) {
                throw failure("AUTH_BINDING_FAILED", "Unable to synchronize connector state", true);
            }
            return ConnectorSkillAuthorizationSyncDto.connected(normalizedCode);
        } finally {
            releaseOperationLock(userId, connector.getConnectorId(), operationLock);
        }
    }

    private Optional<String> acquireOperationLock(String userId, Long connectorId) {
        if (sessionRepository == null) {
            return Optional.empty();
        }
        Optional<String> lockToken = sessionRepository.tryAcquireStartLock(userId, connectorId, OPERATION_LOCK_TTL);
        if (lockToken.isEmpty()) {
            throw busy();
        }
        return lockToken;
    }

    private void releaseOperationLock(String userId, Long connectorId, Optional<String> lockToken) {
        if (sessionRepository != null && lockToken.isPresent()) {
            try {
                sessionRepository.releaseStartLock(userId, connectorId, lockToken.get());
            } catch (RuntimeException ignored) {
                // The bounded lock expires automatically if Redis release is temporarily unavailable.
            }
        }
    }

    private AuthorizationStatusResult verify(
            ConnectorCredentialVerifier verifier,
            Long userId,
            ConnectorInfo connector) {
        try {
            return verifier.verify(userId, connector);
        } catch (RuntimeException e) {
            throw failure("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential", true);
        }
    }

    private ConnectorSkillAuthorizationSyncException verificationFailure(AuthorizationStatusResult result) {
        String errorCode = result == null ? null : result.errorCode();
        if (errorCode == null || !PUBLIC_VERIFICATION_ERRORS.contains(errorCode)) {
            errorCode = "CONNECTOR_CREDENTIAL_INVALID";
        }
        boolean retryable = "CONNECTOR_VERIFICATION_TIMEOUT".equals(errorCode)
            || "CONNECTOR_VERIFICATION_FAILED".equals(errorCode);
        return failure(errorCode, "Connector credential verification did not succeed", retryable);
    }

    private String normalizeConnectorCode(String connectorCode) {
        if (!StringUtils.hasText(connectorCode)) {
            throw failure("CONNECTOR_NOT_FOUND", "Connector is unavailable", false);
        }
        return connectorCode.trim();
    }

    private String resolveConnectorCode(String skillOrConnectorCode) {
        return "ima".equals(skillOrConnectorCode) || "ima-skill".equals(skillOrConnectorCode)
            ? "ima-openapi"
            : skillOrConnectorCode;
    }

    private Long requireUser(String userId) {
        if (!StringUtils.hasText(userId)) {
            throw failure("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential", false);
        }
        try {
            Long numericUserId = Long.parseLong(userId.trim());
            if (numericUserId <= 0) {
                throw new NumberFormatException("non-positive");
            }
            return numericUserId;
        } catch (NumberFormatException e) {
            throw failure("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential", false);
        }
    }

    private ConnectorCredentialVerificationGuard.Admission acquire(Long userId, String connectorCode) {
        ConnectorCredentialVerificationGuard.Admission admission;
        try {
            admission = verificationGuard.acquire(userId, connectorCode);
        } catch (ConnectorCredentialVerificationBusyException e) {
            throw busy();
        }
        if (!acquireUserRateLimit(userId)) {
            admission.close();
            throw busy();
        }
        return admission;
    }

    private boolean acquireUserRateLimit(Long userId) {
        long intervalNanos = TimeUnit.MILLISECONDS.toNanos(properties.minUserIntervalMillis());
        if (intervalNanos == 0) {
            return true;
        }
        long now = System.nanoTime();
        AtomicBoolean acquired = new AtomicBoolean();
        nextAllowedVerificationNanos.compute(userId, (ignored, nextAllowed) -> {
            if (nextAllowed == null || now >= nextAllowed) {
                acquired.set(true);
                return now + intervalNanos;
            }
            return nextAllowed;
        });
        if (nextAllowedVerificationNanos.size() > MAX_RATE_LIMIT_ENTRIES) {
            nextAllowedVerificationNanos.entrySet().removeIf(entry -> now >= entry.getValue());
        }
        return acquired.get();
    }

    private ConnectorSkillAuthorizationSyncException busy() {
        return failure(ConnectorCredentialVerificationBusyException.ERROR_CODE,
            ConnectorCredentialVerificationBusyException.PUBLIC_MESSAGE, true);
    }

    private String safeConnectorCode(String connectorCode) {
        String normalized = connectorCode == null ? "" : connectorCode.trim();
        return SKILL_CONNECTOR_PROVIDERS.containsKey(normalized) ? normalized : "unknown";
    }

    private String safeUserId(String userId) {
        if (userId == null || !userId.trim().matches("[1-9]\\d{0,18}")) {
            return "unknown";
        }
        return userId.trim();
    }

    private void audit(String userId, String connectorCode, String result, long startedNanos) {
        long durationMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
        log.info(
            "connector_skill_sync userId={} connectorCode={} providerCode={} result={} durationMs={}",
            safeUserId(userId),
            connectorCode,
            SKILL_CONNECTOR_PROVIDERS.getOrDefault(connectorCode, "unknown"),
            result,
            durationMillis
        );
    }

    private ConnectorSkillAuthorizationSyncException failure(
            String errorCode,
            String message,
            boolean retryable) {
        return new ConnectorSkillAuthorizationSyncException(errorCode, message, retryable);
    }

}
