package com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk;

import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Date;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService.DwsCredentialOutcome;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService.DwsCredentialStatus;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

@Component
public class DwsDingtalkAuthorizationProvider
        implements ConnectorAuthorizationProvider, ConnectorCredentialVerifier, ConnectorCredentialRevoker {

    private static final long DEVICE_FLOW_TTL_MILLIS = 900_000L;
    private static final String INVALID_USER = "INVALID_USER";
    private static final String PROVIDER_START_FAILED = "PROVIDER_START_FAILED";
    private static final String INVALID_USER_MESSAGE = "当前用户标识无效";
    private static final String START_FAILED_MESSAGE = "钉钉授权启动失败";

    private final DwsAuthService dwsAuthService;

    public DwsDingtalkAuthorizationProvider(DwsAuthService dwsAuthService) {
        this.dwsAuthService = dwsAuthService;
    }

    @Override
    public String providerCode() {
        return "dws-dingtalk";
    }

    @Override
    public AuthorizationStatusResult verify(String userId, ConnectorInfo connector) {
        Long numericUserId = parseUserId(userId);
        if (numericUserId == null) {
            return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
        }
        try {
            DwsCredentialStatus credentialStatus = dwsAuthService.getCredentialStatus(numericUserId);
            if (credentialStatus.outcome() == DwsCredentialOutcome.TIMEOUT) {
                return failedStatus(
                    "CONNECTOR_VERIFICATION_TIMEOUT",
                    "Connector credential verification timed out"
                );
            }
            if (credentialStatus.outcome() == DwsCredentialOutcome.WORKSPACE_UNAVAILABLE) {
                return failedStatus(
                    "CREDENTIAL_WORKSPACE_UNAVAILABLE",
                    "Connector credential workspace is unavailable"
                );
            }
            if (credentialStatus.outcome() != DwsCredentialOutcome.COMPLETED) {
                return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
            }
            Map<String, Object> status = credentialStatus.status();
            if (status != null && Boolean.TRUE.equals(status.get("tokenValid"))) {
                return new AuthorizationStatusResult(
                    AuthorizationStatus.CONNECTED,
                    stringValue(status.get("userId")),
                    stringValue(status.get("userName")),
                    parseDate(status.get("expiresAt")),
                    null,
                    null,
                    null
                );
            }
            return failedStatus("CONNECTOR_CREDENTIAL_INVALID", "Connector credential is invalid");
        } catch (RuntimeException e) {
            return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
        }
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        Long userId = parseUserId(context == null ? null : context.userId());
        if (userId == null) {
            return failedStart(INVALID_USER, INVALID_USER_MESSAGE);
        }
        try {
            Map<String, Object> result = dwsAuthService.startDeviceAuth(userId, context.authorizationId());
            if (!Boolean.TRUE.equals(result.get("success"))) {
                return failedStart(PROVIDER_START_FAILED, START_FAILED_MESSAGE);
            }
            String verificationUrl = stringValue(result.get("verificationUrl"));
            if (verificationUrl == null || verificationUrl.isBlank()) {
                return failedStart(PROVIDER_START_FAILED, START_FAILED_MESSAGE);
            }
            return new AuthorizationStartResult(
                AuthorizationStatus.PENDING,
                verificationUrl,
                new Date(System.currentTimeMillis() + DEVICE_FLOW_TTL_MILLIS),
                null,
                null,
                null,
                null
            );
        } catch (RuntimeException e) {
            return failedStart(PROVIDER_START_FAILED, START_FAILED_MESSAGE);
        }
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        Long userId = parseUserId(session == null ? null : session.userId());
        if (userId == null) {
            return failedStatus(INVALID_USER, INVALID_USER_MESSAGE);
        }
        try {
            Map<String, Object> status = dwsAuthService.getAuthStatus(userId);
            if (Boolean.TRUE.equals(status.get("tokenValid"))) {
                return new AuthorizationStatusResult(
                    AuthorizationStatus.CONNECTED,
                    stringValue(status.get("userId")),
                    stringValue(status.get("userName")),
                    parseDate(status.get("expiresAt")),
                    null,
                    null,
                    null
                );
            }
        } catch (RuntimeException e) {
            // A transient CLI status failure remains pending until the authorization session expires.
        }
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null);
    }

    @Override
    public void cancel(AuthorizationSessionContext session) {
        Long userId = parseUserId(session == null ? null : session.userId());
        if (userId != null) {
            dwsAuthService.cancelDeviceAuth(session.authorizationId(), userId);
        }
    }

    @Override
    public void revoke(String userId, ConnectorInfo connector) {
        Long numericUserId = parseUserId(userId);
        if (numericUserId == null) {
            throw new IllegalArgumentException(INVALID_USER_MESSAGE);
        }
        dwsAuthService.revokeCredential(numericUserId);
    }

    private AuthorizationStartResult failedStart(String errorCode, String errorMessage) {
        return new AuthorizationStartResult(
            AuthorizationStatus.FAILED,
            null,
            new Date(),
            null,
            null,
            errorCode,
            errorMessage
        );
    }

    private AuthorizationStatusResult failedStatus(String errorCode, String errorMessage) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.FAILED,
            null,
            null,
            null,
            null,
            errorCode,
            errorMessage
        );
    }

    private Long parseUserId(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            long userId = Long.parseLong(value.trim());
            return userId > 0 ? userId : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Date parseDate(Object value) {
        if (value instanceof Date date) {
            return new Date(date.getTime());
        }
        if (value == null || String.valueOf(value).isBlank()) {
            return null;
        }
        try {
            return Date.from(OffsetDateTime.parse(String.valueOf(value)).toInstant());
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
