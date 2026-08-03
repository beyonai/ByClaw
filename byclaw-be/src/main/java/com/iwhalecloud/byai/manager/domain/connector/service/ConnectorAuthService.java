package com.iwhalecloud.byai.manager.domain.connector.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * 用户连接器授权绑定领域服务。
 */
@Service
public class ConnectorAuthService {

    private static final Set<String> CLI_AUTH_MODES = Set.of("DEVICE_FLOW", "CLI_INIT");
    private static final Set<String> CLI_CREDENTIAL_KEYS = Set.of(
        "providerCode", "authorizationId", "credentialReference", "accountId", "accountName");

    @Autowired
    private ConnectorAuthMapper connectorAuthMapper;

    @Autowired
    private ConnectorInfoMapper connectorInfoMapper;

    @Autowired
    private ConnectorConnectionStateService connectionStateService;

    /**
     * 新增用户连接器授权记录。
     *
     * @param connectorAuth 授权实体
     */
    public void save(ConnectorAuth connectorAuth) {
        validate(connectorAuth);
        connectorAuth.setUserId(currentUserId());
        connectorAuthMapper.insert(connectorAuth);
    }

    /**
     * 按主键更新用户连接器授权记录。
     *
     * @param connectorAuth 授权实体
     */
    public void update(ConnectorAuth connectorAuth) {
        validate(connectorAuth);
        connectorAuth.setUserId(currentUserId());
        QueryWrapper<ConnectorAuth> ownerQuery = ownerQuery(connectorAuth.getAuthId());
        connectorAuthMapper.update(connectorAuth, ownerQuery);
    }

    /**
     * 按主键查询用户连接器授权记录。
     *
     * @param authId 授权记录ID
     * @return 授权实体，不存在时返回 null
     */
    public ConnectorAuth findById(Long authId) {
        return connectorAuthMapper.selectOne(ownerQuery(authId));
    }

    /** 查询指定用户当前已开启且仍有效的连接器编码。 */
    public List<String> findEnabledConnectorCodes(Long userId) {
        if (userId == null || userId <= 0) {
            return Collections.emptyList();
        }
        return connectorAuthMapper.selectEnabledConnectorCodes(String.valueOf(userId));
    }

    /** 更新当前用户指定连接器的全局启用状态。 */
    public void updateEnableFlag(Long connectorId, boolean enabled) {
        connectionStateService.updateEnableFlag(currentUserId(), connectorId, enabled);
    }

    private QueryWrapper<ConnectorAuth> ownerQuery(Long authId) {
        return new QueryWrapper<ConnectorAuth>()
            .eq("auth_id", authId)
            .eq("user_id", currentUserId())
            .eq("status_cd", "00A");
    }

    private String currentUserId() {
        return String.valueOf(CurrentUserHolder.getCurrentUserId());
    }

    private void validate(ConnectorAuth connectorAuth) {
        if (connectorAuth == null || connectorAuth.getConnectorId() == null) {
            throw new IllegalArgumentException("connectorId不能为空");
        }
        ConnectorInfo connectorInfo = connectorInfoMapper.selectById(connectorAuth.getConnectorId());
        if (connectorInfo == null || !"00A".equals(connectorInfo.getStatusCd())) {
            throw new IllegalArgumentException("连接器不存在或已失效");
        }
        String authMode = connectorInfo.getAuthMode();
        if (authMode != null && !java.util.Set.of(
                "NONE", "OAUTH2", "AK_SK", "PASSWORD", "TOKEN", "DEVICE_FLOW", "CLI_INIT")
            .contains(authMode)) {
            throw new IllegalArgumentException("authMode不受支持");
        }
        if (connectorAuth.getAuthMode() != null && !java.util.Objects.equals(authMode, connectorAuth.getAuthMode())) {
            throw new IllegalArgumentException("authMode与连接器模板不一致");
        }
        if (!"NONE".equals(authMode) && !org.springframework.util.StringUtils.hasText(connectorAuth.getAuthCredential())) {
            throw new IllegalArgumentException("授权凭证不能为空");
        }
        if ("NONE".equals(authMode) && org.springframework.util.StringUtils.hasText(connectorAuth.getAuthCredential())) {
            throw new IllegalArgumentException("NONE授权方式不能携带授权凭证");
        }
        if (CLI_AUTH_MODES.contains(authMode)) {
            validateCliCredential(connectorAuth.getAuthCredential());
        }
        if (connectorAuth.getExpireTime() != null
            && connectorAuth.getExpireTime().before(new java.util.Date())
            && "Y".equals(connectorAuth.getEnableFlag())) {
            throw new IllegalArgumentException("启用授权的expireTime不能早于当前时间");
        }
        if (connectorAuth.getEnableFlag() != null && !java.util.Set.of("Y", "N")
            .contains(connectorAuth.getEnableFlag())) {
            throw new IllegalArgumentException("enableFlag只能为Y或N");
        }
        connectorAuth.setAuthMode(authMode);
        if (connectorAuth.getEnableFlag() == null) {
            connectorAuth.setEnableFlag("N");
        }
        if (connectorAuth.getStatusCd() == null) {
            connectorAuth.setStatusCd("00A");
        }
    }

    private void validateCliCredential(String credentialCipher) {
        try {
            JSONObject credential = JSON.parseObject(Sm4Util.decrypt(credentialCipher));
            if (credential == null || !CLI_CREDENTIAL_KEYS.containsAll(credential.keySet())) {
                throw invalidCliCredential();
            }
            validateCredentialValue(credential, "providerCode", true);
            validateCredentialValue(credential, "credentialReference", false);
            validateCredentialValue(credential, "accountId", false);
            validateCredentialValue(credential, "accountName", false);
        } catch (RuntimeException e) {
            throw invalidCliCredential();
        }
    }

    private void validateCredentialValue(JSONObject credential, String key, boolean required) {
        if (!credential.containsKey(key)) {
            if (required) {
                throw invalidCliCredential();
            }
            return;
        }
        Object value = credential.get(key);
        if (!(value instanceof String text) || !StringUtils.hasText(text)) {
            throw invalidCliCredential();
        }
    }

    private IllegalArgumentException invalidCliCredential() {
        return new IllegalArgumentException("授权凭证格式无效");
    }
}
