package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;

@Service
public class WeixinAuthorizerAuthStore {
    private static final String PROVIDER_CODE = "weixin-open-platform";
    private static final Duration OPERATION_LOCK_TTL = Duration.ofMinutes(2);

    private final ConnectorAuthMapper connectorAuthMapper;
    private final ConnectorCredentialSecretStore secretStore;
    private final RedisAuthorizationSessionRepository sessionRepository;

    public WeixinAuthorizerAuthStore(
            ConnectorAuthMapper connectorAuthMapper,
            ConnectorCredentialSecretStore secretStore,
            RedisAuthorizationSessionRepository sessionRepository) {
        this.connectorAuthMapper = connectorAuthMapper;
        this.secretStore = secretStore;
        this.sessionRepository = sessionRepository;
    }

    public Optional<Binding> findActive(String userId, Long connectorId) {
        ConnectorAuth auth = connectorAuthMapper.selectOne(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getUserId, userId)
            .eq(ConnectorAuth::getConnectorId, connectorId)
            .eq(ConnectorAuth::getStatusCd, "00A")
            .orderByDesc(ConnectorAuth::getUpdateTime)
            .last("LIMIT 1"));
        return Optional.ofNullable(auth).map(this::binding);
    }

    @Transactional(rollbackFor = Exception.class)
    public void revoke(String userId, Long connectorId) {
        revokeActiveSecret(userId, connectorId);
    }

    @Transactional(rollbackFor = Exception.class)
    public void revokeByAuthorizer(String authorizerAppid) {
        if (!StringUtils.hasText(authorizerAppid)) {
            throw new IllegalArgumentException("authorizerAppid is required");
        }
        List<ConnectorAuth> authorizations = connectorAuthMapper.selectActiveByProviderAndExternalAccount(
            PROVIDER_CODE, authorizerAppid);
        Date now = new Date();
        for (ConnectorAuth authorization : authorizations) {
            String userId = authorization.getUserId();
            Long connectorId = authorization.getConnectorId();
            String lockToken = sessionRepository.tryAcquireStartLock(userId, connectorId, OPERATION_LOCK_TTL)
                .orElseThrow(() -> new IllegalStateException("Connector credential operation is in progress"));
            boolean releaseDeferred = deferLockReleaseUntilTransactionCompletion(userId, connectorId, lockToken);
            try {
                revokeActiveSecret(userId, connectorId);
                authorization.setCredentialState("REAUTH_REQUIRED");
                authorization.setEnableFlag("N");
                authorization.setUpdateTime(now);
                if (connectorAuthMapper.updateById(authorization) != 1) {
                    throw new IllegalStateException("Weixin authorization revoke did not update exactly one row");
                }
            } finally {
                if (!releaseDeferred) {
                    releaseLockBestEffort(userId, connectorId, lockToken);
                }
            }
        }
    }

    private boolean deferLockReleaseUntilTransactionCompletion(
            String userId, Long connectorId, String lockToken) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return false;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                releaseLockBestEffort(userId, connectorId, lockToken);
            }
        });
        return true;
    }

    private void releaseLockBestEffort(String userId, Long connectorId, String lockToken) {
        try {
            sessionRepository.releaseStartLock(userId, connectorId, lockToken);
        } catch (RuntimeException ignored) {
            // The bounded lock expires automatically if Redis release is temporarily unavailable.
        }
    }

    private void revokeActiveSecret(String userId, Long connectorId) {
        secretStore.findActive(userId, connectorId, PROVIDER_CODE)
            .ifPresent(secret -> secretStore.revoke(secret.credentialReference()));
    }

    private Binding binding(ConnectorAuth auth) {
        if (!StringUtils.hasText(auth.getExternalAccountId())
                || !StringUtils.hasText(auth.getAuthCredential())) {
            throw new IllegalStateException("Weixin authorization metadata is incomplete");
        }
        try {
            JSONObject credential = JSON.parseObject(Sm4Util.decrypt(auth.getAuthCredential()));
            return new Binding(
                auth.getExternalAccountId(),
                required(credential, "accountName"),
                required(credential, "username"),
                required(credential, "principalName"),
                required(credential, "credentialReference"));
        } catch (RuntimeException e) {
            throw new IllegalStateException("Weixin authorization metadata is invalid", e);
        }
    }

    private String required(JSONObject credential, String key) {
        String value = credential == null ? null : credential.getString(key);
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException("Weixin authorization metadata is incomplete");
        }
        return value;
    }

    public record Binding(
        String authorizerAppid,
        String nickname,
        String username,
        String principalName,
        String credentialReference
    ) {
    }
}
