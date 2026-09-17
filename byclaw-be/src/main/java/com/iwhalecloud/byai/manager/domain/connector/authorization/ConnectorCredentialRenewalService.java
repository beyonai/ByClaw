package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;

@Service
public class ConnectorCredentialRenewalService {
    private static final Logger LOG = LoggerFactory.getLogger(ConnectorCredentialRenewalService.class);
    private static final Duration RENEWAL_WINDOW = Duration.ofMinutes(5);
    private final ConnectorAuthMapper authMapper;
    private final ConnectorInfoMapper connectorMapper;
    private final ConnectorCredentialRenewalProviderRegistry registry;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorCredentialRenewalLeaseService leaseService;
    private final Clock clock;

    @Autowired
    public ConnectorCredentialRenewalService(ConnectorAuthMapper authMapper, ConnectorInfoMapper connectorMapper,
            ConnectorCredentialRenewalProviderRegistry registry,
            ConnectorConnectionStateService connectionStateService,
            ConnectorCredentialRenewalLeaseService leaseService) {
        this(authMapper, connectorMapper, registry, connectionStateService, leaseService, Clock.systemUTC());
    }

    ConnectorCredentialRenewalService(ConnectorAuthMapper authMapper, ConnectorInfoMapper connectorMapper,
            ConnectorCredentialRenewalProviderRegistry registry,
            ConnectorConnectionStateService connectionStateService,
            ConnectorCredentialRenewalLeaseService leaseService, Clock clock) {
        this.authMapper = authMapper;
        this.connectorMapper = connectorMapper;
        this.registry = registry;
        this.connectionStateService = connectionStateService;
        this.leaseService = leaseService;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${byai.connector.credential-renewal.fixed-delay-millis:60000}")
    public void renewExpiringCredentials() {
        Date windowEnd = Date.from(clock.instant().plus(RENEWAL_WINDOW));
        Date retryCutoff = Date.from(clock.instant().minus(RENEWAL_WINDOW));
        List<ConnectorAuth> candidates = authMapper.selectList(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getEnableFlag, "Y")
            .eq(ConnectorAuth::getStatusCd, "00A")
            .eq(ConnectorAuth::getRenewalMode, CredentialRenewalMode.REFRESH_TOKEN.name())
            .le(ConnectorAuth::getAccessExpireTime, windowEnd)
            .and(wrapper -> wrapper.isNull(ConnectorAuth::getLastSyncTime)
                .or().le(ConnectorAuth::getLastSyncTime, retryCutoff))
            .orderByAsc(ConnectorAuth::getAccessExpireTime)
            .last("LIMIT 100"));
        for (ConnectorAuth auth : candidates) {
            if (!isDue(auth)) {
                continue;
            }
            java.util.Optional<ConnectorCredentialRenewalLeaseService.Lease> acquired;
            try {
                acquired = leaseService.tryAcquire(auth.getAuthId());
            } catch (ConnectorCredentialRenewalLeaseUnavailableException e) {
                LOG.warn("Connector credential renewal lease unavailable authId={} category={}",
                    auth.getAuthId(), e.getClass().getSimpleName(), safeThrowable(e));
                continue;
            }
            if (acquired.isEmpty()) {
                continue;
            }
            ConnectorInfo connector = null;
            try {
                connector = connectorMapper.selectById(auth.getConnectorId());
                if (connector == null || !"00A".equals(connector.getStatusCd())) {
                    continue;
                }
                renewOne(auth, connector);
            } catch (RuntimeException e) {
                if (connector != null) {
                    try {
                        connectionStateService.markRefreshNeeded(auth.getUserId(), connector);
                    } catch (RuntimeException transitionError) {
                        LOG.warn("Connector credential refresh-needed transition failed authId={} category={}",
                            auth.getAuthId(), transitionError.getClass().getSimpleName(),
                            safeThrowable(transitionError));
                    }
                }
                LOG.warn("Connector credential renewal failed authId={} connectorId={} category={}",
                    auth.getAuthId(), auth.getConnectorId(), e.getClass().getSimpleName(), safeThrowable(e));
            } finally {
                leaseService.release(acquired.orElseThrow());
            }
        }
    }

    void renewOne(ConnectorAuth auth, ConnectorInfo connector) {
        if (auth.getRefreshExpireTime() != null
                && !auth.getRefreshExpireTime().toInstant().isAfter(clock.instant())) {
            connectionStateService.markReauthRequired(auth.getUserId(), connector);
            return;
        }
        Long userId = Long.valueOf(auth.getUserId());
        AuthorizationStatusResult result = registry.get(connector.getProviderCode()).renew(userId, connector);
        if (result != null && result.status() == AuthorizationStatus.CONNECTED) {
            connectionStateService.updateCredentialLifecycle(auth.getUserId(), connector, result);
        } else if (result != null && "OAUTH_REFRESH_RETRYABLE".equals(result.errorCode())) {
            connectionStateService.markRefreshNeeded(auth.getUserId(), connector);
        } else {
            connectionStateService.markReauthRequired(auth.getUserId(), connector);
        }
    }

    private boolean isDue(ConnectorAuth auth) {
        Instant now = clock.instant();
        return auth != null && "Y".equals(auth.getEnableFlag()) && "00A".equals(auth.getStatusCd())
            && CredentialRenewalMode.REFRESH_TOKEN.name().equals(auth.getRenewalMode())
            && auth.getAccessExpireTime() != null
            && !auth.getAccessExpireTime().toInstant().isAfter(now.plus(RENEWAL_WINDOW))
            && (auth.getLastSyncTime() == null
                || !auth.getLastSyncTime().toInstant().isAfter(now.minus(RENEWAL_WINDOW)));
    }

    static Throwable safeThrowable(Throwable original) {
        RuntimeException sanitized = new RuntimeException(
            "Connector credential renewal failure: " + original.getClass().getSimpleName());
        sanitized.setStackTrace(original.getStackTrace());
        return sanitized;
    }
}
