package com.iwhalecloud.byai.manager.domain.connector.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.net.URI;
import java.util.Date;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** 提供与前端契约一致的连接器授权任务接口。 */
@Service
public class ConnectorAuthorizationService {

    private static final long AUTHORIZATION_TTL_MILLIS = 10 * 60 * 1000L;
    private static final String DINGTALK_CONNECTOR_ID = "dingtalk";

    private final ConnectorInfoService connectorInfoService;
    private final DwsAuthService dwsAuthService;
    private final ConnectorAuthMapper connectorAuthMapper;
    private final SequenceService sequenceService;
    private final ConcurrentHashMap<String, AuthorizationSession> sessions = new ConcurrentHashMap<>();

    public ConnectorAuthorizationService(ConnectorInfoService connectorInfoService, DwsAuthService dwsAuthService,
        ConnectorAuthMapper connectorAuthMapper, SequenceService sequenceService) {
        this.connectorInfoService = connectorInfoService;
        this.dwsAuthService = dwsAuthService;
        this.connectorAuthMapper = connectorAuthMapper;
        this.sequenceService = sequenceService;
    }

    public ConnectorAuthorizationDto start(StartConnectorAuthorizationRequest request, String userId) {
        validateRequest(request);
        ConnectorInfo connector = connectorInfoService.findById(request.getConnectorId());
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            return failed(request.getConnectorId(), "连接器不存在或已失效");
        }
        if (DINGTALK_CONNECTOR_ID.equals(connector.getConnectorCode())) {
            return startDingtalkAuthorization(connector, userId);
        }
        if ("NONE".equals(connector.getAuthMode())) {
            return connected(request.getConnectorId());
        }

        String authorizationUrl = readConfigValue(connector.getAuthConfig(), "authorizationUrl");
        if (!StringUtils.hasText(authorizationUrl)) {
            return failed(request.getConnectorId(), "连接器尚未配置授权地址");
        }
        String authorizationId = UUID.randomUUID().toString();
        Date expiresAt = new Date(System.currentTimeMillis() + AUTHORIZATION_TTL_MILLIS);
        sessions.put(authorizationId, new AuthorizationSession(userId, connector.getConnectorId(), connector.getConnectorCode(), expiresAt));

        ConnectorAuthorizationDto result = pending(authorizationId, request.getConnectorId(), expiresAt);
        result.setAuthorizationUrl(authorizationUrl);
        return result;
    }

    public ConnectorAuthorizationDto status(String authorizationId, String userId) {
        AuthorizationSession session = sessions.get(authorizationId);
        if (session == null || !session.userId().equals(userId)) {
            return failed(null, "授权任务不存在");
        }
        if (session.expiresAt().before(new Date())) {
            sessions.remove(authorizationId);
            ConnectorAuthorizationDto result = failed(session.connectorId(), "授权任务已过期");
            result.setAuthorizationId(authorizationId);
            result.setStatus("expired");
            return result;
        }
        if (DINGTALK_CONNECTOR_ID.equals(session.connectorCode())) {
            Map<String, Object> dwsStatus = dwsAuthService.getAuthStatus(Long.valueOf(session.userId()));
            if (Boolean.TRUE.equals(dwsStatus.get("tokenValid"))) {
                saveEnabledAuthorization(session.userId(), session.connectorId());
                sessions.remove(authorizationId);
                return connected(session.connectorId());
            }
        }
        return pending(authorizationId, session.connectorId(), session.expiresAt());
    }

    public boolean cancel(String authorizationId, String userId) {
        AuthorizationSession session = sessions.get(authorizationId);
        if (session == null || !session.userId().equals(userId)) {
            throw new IllegalArgumentException("授权任务不存在");
        }
        sessions.remove(authorizationId, session);
        if (DINGTALK_CONNECTOR_ID.equals(session.connectorCode())) {
            return dwsAuthService.cancelDeviceAuth(Long.valueOf(userId));
        }
        return true;
    }

    private ConnectorAuthorizationDto startDingtalkAuthorization(ConnectorInfo connector, String userId) {
        Long connectorId = connector.getConnectorId();
        try {
            Long.valueOf(userId);
        }
        catch (NumberFormatException e) {
            return failed(connectorId, "当前用户标识无效");
        }

        Map<String, Object> dwsResult = dwsAuthService.startDeviceAuth();
        if (!Boolean.TRUE.equals(dwsResult.get("success"))) {
            return failed(connectorId, String.valueOf(dwsResult.getOrDefault("message", "钉钉授权启动失败")));
        }

        String authorizationId = UUID.randomUUID().toString();
        Date expiresAt = new Date(System.currentTimeMillis() + AUTHORIZATION_TTL_MILLIS);
        sessions.put(authorizationId, new AuthorizationSession(userId, connectorId, connector.getConnectorCode(), expiresAt));

        ConnectorAuthorizationDto result = pending(authorizationId, connectorId, expiresAt);
        result.setAuthorizationUrl((String) dwsResult.get("verificationUrl"));
        return result;
    }

    private void validateRequest(StartConnectorAuthorizationRequest request) {
        if (request == null || request.getConnectorId() == null) {
            throw new IllegalArgumentException("connectorId不能为空");
        }
        if (!StringUtils.hasText(request.getRedirectUrl())) {
            throw new IllegalArgumentException("redirectUrl不能为空");
        }
        URI redirectUri = URI.create(request.getRedirectUrl());
        if (!"http".equalsIgnoreCase(redirectUri.getScheme())
            && !"https".equalsIgnoreCase(redirectUri.getScheme())) {
            throw new IllegalArgumentException("redirectUrl必须使用HTTP或HTTPS");
        }
    }

    private String readConfigValue(String config, String key) {
        if (!StringUtils.hasText(config)) {
            return null;
        }
        try {
            JSONObject object = JSON.parseObject(config);
            return object.getString(key);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private void saveEnabledAuthorization(String userId, Long connectorId) {
        ConnectorAuth existing = connectorAuthMapper.selectOne(new LambdaQueryWrapper<ConnectorAuth>()
            .eq(ConnectorAuth::getUserId, userId)
            .eq(ConnectorAuth::getConnectorId, connectorId)
            .eq(ConnectorAuth::getStatusCd, "00A")
            .orderByDesc(ConnectorAuth::getUpdateTime)
            .last("LIMIT 1"));
        if (existing != null) {
            existing.setEnableFlag("Y");
            existing.setUpdateTime(new Date());
            connectorAuthMapper.updateById(existing);
            return;
        }
        ConnectorAuth auth = new ConnectorAuth();
        auth.setAuthId(sequenceService.nextVal());
        auth.setUserId(userId);
        auth.setConnectorId(connectorId);
        auth.setEnableFlag("Y");
        auth.setStatusCd("00A");
        auth.setCreateBy(userId);
        auth.setCreateTime(new Date());
        connectorAuthMapper.insert(auth);
    }

    private ConnectorAuthorizationDto connected(Long connectorId) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(UUID.randomUUID().toString());
        result.setConnectorId(connectorId);
        result.setStatus("connected");
        return result;
    }

    private ConnectorAuthorizationDto pending(String authorizationId, Long connectorId, Date expiresAt) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(authorizationId);
        result.setConnectorId(connectorId);
        result.setStatus("pending");
        result.setExpiresAt(expiresAt);
        return result;
    }

    private ConnectorAuthorizationDto failed(Long connectorId, String errorMessage) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setConnectorId(connectorId);
        result.setStatus("failed");
        result.setErrorMessage(errorMessage);
        return result;
    }

    private record AuthorizationSession(String userId, Long connectorId, String connectorCode, Date expiresAt) {
    }
}
