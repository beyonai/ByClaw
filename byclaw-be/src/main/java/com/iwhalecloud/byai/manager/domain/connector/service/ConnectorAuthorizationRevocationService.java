package com.iwhalecloud.byai.manager.domain.connector.service;

import java.time.Duration;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Coordinates credential cleanup and persistent connector unlinking for the current user. */
@Service
public class ConnectorAuthorizationRevocationService {

    private static final Duration REVOCATION_LOCK_TTL = Duration.ofSeconds(30);

    private final ConnectorInfoService connectorInfoService;
    private final AuthorizationProviderRegistry providerRegistry;
    private final RedisAuthorizationSessionRepository sessionRepository;
    private final ConnectorConnectionStateService connectionStateService;

    @org.springframework.beans.factory.annotation.Autowired
    public ConnectorAuthorizationRevocationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorConnectionStateService connectionStateService) {
        this.connectorInfoService = connectorInfoService;
        this.providerRegistry = providerRegistry;
        this.sessionRepository = sessionRepository;
        this.connectionStateService = connectionStateService;
    }

    public ConnectorAuthorizationRevocationService(
            ConnectorInfoService connectorInfoService,
            AuthorizationProviderRegistry providerRegistry,
            RedisAuthorizationSessionRepository sessionRepository,
            ConnectorConnectionStateService connectionStateService,
            ConnectorManifestService manifestService) {
        this(connectorInfoService, providerRegistry, sessionRepository, connectionStateService);
    }

    @Transactional(rollbackFor = Exception.class)
    public void revoke(Long connectorId, String userId) {
        if (connectorId == null) {
            throw new IllegalArgumentException("connectorId不能为空");
        }
        ConnectorInfo connector = connectorInfoService.findById(connectorId);
        if (connector == null) {
            throw new IllegalArgumentException("连接器不存在或已失效");
        }
        if ("AK_SK".equals(connector.getAuthMode())) {
            revokeCredentialConnector(connectorId, userId);
            return;
        }
        if (!"00A".equals(connector.getStatusCd())) {
            throw new IllegalArgumentException("连接器不存在或已失效");
        }

        if (connectionStateService.findActiveAuthorization(userId, connectorId) == null) {
            throw new IllegalArgumentException("连接器授权记录不存在");
        }

        Optional<String> lockToken = sessionRepository.tryAcquireStartLock(userId, connectorId, REVOCATION_LOCK_TTL);
        if (lockToken.isEmpty()) {
            throw new IllegalStateException("当前连接器已有进行中的授权任务");
        }
        try {
            if (sessionRepository.hasActiveSession(userId, connectorId)) {
                throw new IllegalStateException("当前连接器已有进行中的授权任务");
            }
            ConnectorAuthorizationProvider provider = providerRegistry.get(connector.getProviderCode());
            if (!(provider instanceof ConnectorCredentialRevoker revoker)) {
                throw new IllegalStateException("当前连接器不支持取消授权");
            }
            revoker.revoke(userId, connector);
            connectionStateService.revokeAuthorization(userId, connectorId);
        } finally {
            releaseLockBestEffort(userId, connectorId, lockToken.get());
        }
    }

    private void revokeCredentialConnector(Long connectorId, String userId) {
        Optional<String> lockToken = sessionRepository.tryAcquireStartLock(userId, connectorId, REVOCATION_LOCK_TTL);
        if (lockToken.isEmpty()) {
            throw new IllegalStateException("当前连接器已有进行中的授权任务");
        }
        try {
            connectionStateService.revokeAuthorization(userId, connectorId);
        } finally {
            releaseLockBestEffort(userId, connectorId, lockToken.get());
        }
    }

    private void releaseLockBestEffort(String userId, Long connectorId, String token) {
        try {
            sessionRepository.releaseStartLock(userId, connectorId, token);
        } catch (RuntimeException ignored) {
            // The bounded lock expires automatically if Redis release is temporarily unavailable.
        }
    }
}
