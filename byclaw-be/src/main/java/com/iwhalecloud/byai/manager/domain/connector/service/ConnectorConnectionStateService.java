package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/** 在同一事务中维护连接器授权绑定和用户 Runtime Manifest 快照。 */
@Service
public class ConnectorConnectionStateService {

    private final ConnectorAuthMapper connectorAuthMapper;
    private final ConnectorInfoMapper connectorInfoMapper;
    private final SequenceService sequenceService;
    private final ConnectorManifestService manifestService;
    private final UserService userService;
    private final UserPrivateParamApplicationService privateParamService;

    public ConnectorConnectionStateService(
            ConnectorAuthMapper connectorAuthMapper,
            ConnectorInfoMapper connectorInfoMapper,
            SequenceService sequenceService,
            ConnectorManifestService manifestService,
            UserService userService,
            UserPrivateParamApplicationService privateParamService) {
        this.connectorAuthMapper = connectorAuthMapper;
        this.connectorInfoMapper = connectorInfoMapper;
        this.sequenceService = sequenceService;
        this.manifestService = manifestService;
        this.userService = userService;
        this.privateParamService = privateParamService;
    }

    @Transactional(rollbackFor = Exception.class)
    public ConnectorAuth saveEnabledAuthorization(
            String userId,
            ConnectorInfo connector,
            AuthorizationStatusResult statusResult,
            String authorizationId) {
        UserIdentity user = requireUser(userId);
        boolean manifestChanged = manifestService.upsertAndEnable(user.userId(), connector);

        ConnectorAuth existing = findActiveAuthorization(userId, connector.getConnectorId());
        Date now = new Date();
        ConnectorAuth auth = existing == null ? new ConnectorAuth() : existing;
        applyEnabledAuthorization(auth, userId, connector, statusResult, authorizationId, now);
        if (existing != null) {
            auth.setUpdateTime(now);
            requireSingleAffectedRow(connectorAuthMapper.updateById(auth));
        } else {
            auth = insertOrUpdateWinner(auth, userId, connector, statusResult, authorizationId, now);
        }
        scheduleCacheRefresh(manifestChanged, user);
        return auth;
    }

    @Transactional(rollbackFor = Exception.class)
    public void updateEnableFlag(String userId, Long connectorId, boolean enabled) {
        UserIdentity user = requireUser(userId);
        ConnectorAuth auth = findActiveAuthorization(userId, connectorId);
        if (auth == null) {
            throw new IllegalArgumentException("连接器授权记录不存在");
        }
        ConnectorInfo connector = connectorInfoMapper.selectById(connectorId);
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            throw new IllegalArgumentException("连接器不存在或已失效");
        }
        boolean manifestChanged = enabled
            ? manifestService.upsertAndEnable(user.userId(), connector)
            : manifestService.disable(user.userId(), connector);
        auth.setEnableFlag(enabled ? "Y" : "N");
        auth.setUpdateTime(new Date());
        requireSingleAffectedRow(connectorAuthMapper.updateById(auth));
        scheduleCacheRefresh(manifestChanged, user);
    }

    @Transactional(rollbackFor = Exception.class)
    public void revokeAuthorization(String userId, Long connectorId) {
        UserIdentity user = requireUser(userId);
        ConnectorAuth auth = findActiveAuthorization(userId, connectorId);
        if (auth == null) {
            throw new IllegalArgumentException("连接器授权记录不存在");
        }
        ConnectorInfo connector = connectorInfoMapper.selectById(connectorId);
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            throw new IllegalArgumentException("连接器不存在或已失效");
        }

        boolean manifestChanged = manifestService.disable(user.userId(), connector);
        auth.setEnableFlag("N");
        auth.setStatusCd("00X");
        auth.setUpdateTime(new Date());
        requireSingleAffectedRow(connectorAuthMapper.updateById(auth));
        scheduleCacheRefresh(manifestChanged, user);
    }

    public ConnectorAuth findEnabledActiveAuthorization(String userId, Long connectorId) {
        return connectorAuthMapper.selectOne(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getUserId, userId)
            .eq(ConnectorAuth::getConnectorId, connectorId)
            .eq(ConnectorAuth::getEnableFlag, "Y")
            .eq(ConnectorAuth::getStatusCd, "00A")
            .orderByDesc(ConnectorAuth::getUpdateTime)
            .last("LIMIT 1"));
    }

    private ConnectorAuth insertOrUpdateWinner(
            ConnectorAuth auth,
            String userId,
            ConnectorInfo connector,
            AuthorizationStatusResult statusResult,
            String authorizationId,
            Date now) {
        auth.setAuthId(sequenceService.nextVal());
        auth.setCreateBy(userId);
        auth.setCreateTime(now);
        int inserted = connectorAuthMapper.insertActiveIgnoreConflict(auth);
        if (inserted == 1) {
            return auth;
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
        return winner;
    }

    public ConnectorAuth findActiveAuthorization(String userId, Long connectorId) {
        return connectorAuthMapper.selectOne(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getUserId, userId)
            .eq(ConnectorAuth::getConnectorId, connectorId)
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
        }
        return Sm4Util.encrypt(JSON.toJSONString(metadata));
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

    private UserIdentity requireUser(String userId) {
        Long numericUserId;
        try {
            numericUserId = Long.valueOf(userId);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("userId必须为正整数", e);
        }
        if (numericUserId <= 0) {
            throw new IllegalArgumentException("userId必须为正整数");
        }
        Users user = userService.findById(numericUserId);
        if (user == null || !StringUtils.hasText(user.getUserCode())) {
            throw new IllegalArgumentException("用户不存在或用户编码为空");
        }
        return new UserIdentity(numericUserId, user.getUserCode());
    }

    private void requireSingleAffectedRow(int affectedRows) {
        if (affectedRows != 1) {
            throw new IllegalStateException("Connector state write did not affect exactly one row");
        }
    }

    private void scheduleCacheRefresh(boolean manifestChanged, UserIdentity user) {
        if (!manifestChanged) {
            return;
        }
        privateParamService.refreshPrivateParamCacheAfterCommit(user.userId(), user.userCode());
    }

    private record UserIdentity(Long userId, String userCode) {
    }
}
