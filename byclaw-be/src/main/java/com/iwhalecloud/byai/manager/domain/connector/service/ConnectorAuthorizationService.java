package com.iwhalecloud.byai.manager.domain.connector.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
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
    private final ConcurrentHashMap<String, AuthorizationSession> sessions = new ConcurrentHashMap<>();

    public ConnectorAuthorizationService(ConnectorInfoService connectorInfoService, DwsAuthService dwsAuthService) {
        this.connectorInfoService = connectorInfoService;
        this.dwsAuthService = dwsAuthService;
    }

    public ConnectorAuthorizationDto start(StartConnectorAuthorizationRequest request, String userId) {
        validateRequest(request);
        ConnectorInfo connector = connectorInfoService.findByCode(request.getConnectorId());
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            return failed(request.getConnectorId(), "连接器不存在或已失效");
        }
        if (DINGTALK_CONNECTOR_ID.equals(request.getConnectorId())) {
            return startDingtalkAuthorization(request.getConnectorId(), userId);
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
        sessions.put(authorizationId, new AuthorizationSession(userId, request.getConnectorId(), expiresAt));

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
        if (DINGTALK_CONNECTOR_ID.equals(session.connectorId())) {
            Map<String, Object> dwsStatus = dwsAuthService.getAuthStatus(Long.valueOf(session.userId()));
            if (Boolean.TRUE.equals(dwsStatus.get("tokenValid"))) {
                sessions.remove(authorizationId);
                return connected(session.connectorId());
            }
        }
        return pending(authorizationId, session.connectorId(), session.expiresAt());
    }

    private ConnectorAuthorizationDto startDingtalkAuthorization(String connectorId, String userId) {
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
        sessions.put(authorizationId, new AuthorizationSession(userId, connectorId, expiresAt));

        ConnectorAuthorizationDto result = pending(authorizationId, connectorId, expiresAt);
        result.setAuthorizationUrl((String) dwsResult.get("verificationUrl"));
        return result;
    }

    private void validateRequest(StartConnectorAuthorizationRequest request) {
        if (request == null || !StringUtils.hasText(request.getConnectorId())) {
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

    private ConnectorAuthorizationDto connected(String connectorId) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(UUID.randomUUID().toString());
        result.setConnectorId(connectorId);
        result.setStatus("connected");
        return result;
    }

    private ConnectorAuthorizationDto pending(String authorizationId, String connectorId, Date expiresAt) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setAuthorizationId(authorizationId);
        result.setConnectorId(connectorId);
        result.setStatus("pending");
        result.setExpiresAt(expiresAt);
        return result;
    }

    private ConnectorAuthorizationDto failed(String connectorId, String errorMessage) {
        ConnectorAuthorizationDto result = new ConnectorAuthorizationDto();
        result.setConnectorId(connectorId);
        result.setStatus("failed");
        result.setErrorMessage(errorMessage);
        return result;
    }

    private record AuthorizationSession(String userId, String connectorId, Date expiresAt) {
    }
}
