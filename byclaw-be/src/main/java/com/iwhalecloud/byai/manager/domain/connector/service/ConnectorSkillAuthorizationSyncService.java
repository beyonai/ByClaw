package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifierRegistry;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorSkillAuthorizationSyncDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Independently verifies an existing CLI credential before enabling its connector binding. */
@Service
public class ConnectorSkillAuthorizationSyncService {

    private static final int LOCK_COUNT = 64;
    private static final Map<String, String> SKILL_CONNECTOR_PROVIDERS = Map.of(
        "dingtalk", "dws-dingtalk",
        "lark", "lark-cli",
        "wecom", "wecom-cli"
    );
    private static final Set<String> PUBLIC_VERIFICATION_ERRORS = Set.of(
        "CREDENTIAL_WORKSPACE_UNAVAILABLE",
        "CONNECTOR_CREDENTIAL_INVALID",
        "CONNECTOR_VERIFICATION_TIMEOUT",
        "CONNECTOR_VERIFICATION_FAILED"
    );

    private final ConnectorInfoService connectorInfoService;
    private final ConnectorCredentialVerifierRegistry verifierRegistry;
    private final ConnectorConnectionStateService connectionStateService;
    private final ReentrantLock[] locks = createLocks();

    public ConnectorSkillAuthorizationSyncService(
            ConnectorInfoService connectorInfoService,
            ConnectorCredentialVerifierRegistry verifierRegistry,
            ConnectorConnectionStateService connectionStateService) {
        this.connectorInfoService = connectorInfoService;
        this.verifierRegistry = verifierRegistry;
        this.connectionStateService = connectionStateService;
    }

    public ConnectorSkillAuthorizationSyncDto sync(String connectorCode, String userId) {
        String normalizedCode = normalizeConnectorCode(connectorCode);
        requireUser(userId);
        String expectedProviderCode = SKILL_CONNECTOR_PROVIDERS.get(normalizedCode);
        if (expectedProviderCode == null) {
            throw failure("CONNECTOR_NOT_FOUND", "Connector is unavailable", false);
        }
        ConnectorInfo connector = connectorInfoService.findByCode(normalizedCode);
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

        ReentrantLock lock = lock(userId, connector.getConnectorId());
        lock.lock();
        try {
            AuthorizationStatusResult verification = verify(verifier, userId, connector);
            if (verification == null || verification.status() != AuthorizationStatus.CONNECTED) {
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
            lock.unlock();
        }
    }

    private AuthorizationStatusResult verify(
            ConnectorCredentialVerifier verifier,
            String userId,
            ConnectorInfo connector) {
        try {
            return verifier.verify(userId, connector);
        } catch (RuntimeException e) {
            throw failure("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential", true);
        }
    }

    private ConnectorSkillAuthorizationSyncException verificationFailure(AuthorizationStatusResult result) {
        String errorCode = result == null ? null : result.errorCode();
        if (!PUBLIC_VERIFICATION_ERRORS.contains(errorCode)) {
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

    private void requireUser(String userId) {
        if (!StringUtils.hasText(userId)) {
            throw failure("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential", false);
        }
        try {
            if (Long.parseLong(userId.trim()) <= 0) {
                throw new NumberFormatException("non-positive");
            }
        } catch (NumberFormatException e) {
            throw failure("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential", false);
        }
    }

    private ReentrantLock lock(String userId, Long connectorId) {
        int index = Math.floorMod((userId + ':' + connectorId).hashCode(), locks.length);
        return locks[index];
    }

    private ReentrantLock[] createLocks() {
        ReentrantLock[] result = new ReentrantLock[LOCK_COUNT];
        for (int index = 0; index < result.length; index++) {
            result[index] = new ReentrantLock();
        }
        return result;
    }

    private ConnectorSkillAuthorizationSyncException failure(
            String errorCode,
            String message,
            boolean retryable) {
        return new ConnectorSkillAuthorizationSyncException(errorCode, message, retryable);
    }
}
