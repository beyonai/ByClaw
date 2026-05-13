package com.iwhalecloud.byai.manager.infrastructure.exception;

/**
 * OAuth2相关异常
 * 符合RFC 6749标准的OAuth2错误响应
 * 
 * @author AI Assistant
 * @version 1.0
 * @since 2024
 */
public class OAuth2Exception extends RuntimeException {

    /** OAuth2错误代码 */
    private final String error;
    /** 错误描述信息 */
    private final String errorDescription;
    /** 错误详情URI（可选） */
    private final String errorUri;

    public OAuth2Exception(String error, String errorDescription) {
        this(error, errorDescription, null);
    }

    public OAuth2Exception(String error, String errorDescription, String errorUri) {
        super(String.format("OAuth2 Error: %s - %s", error, errorDescription));
        this.error = error;
        this.errorDescription = errorDescription;
        this.errorUri = errorUri;
    }

    public String getError() {
        return error;
    }

    public String getErrorDescription() {
        return errorDescription;
    }

    public String getErrorUri() {
        return errorUri;
    }

    // 标准OAuth2错误类型
    public static class InvalidRequest extends OAuth2Exception {
        public InvalidRequest(String description) {
            super("invalid_request", description);
        }
    }

    public static class InvalidClient extends OAuth2Exception {
        public InvalidClient(String description) {
            super("invalid_client", description);
        }
    }

    public static class InvalidGrant extends OAuth2Exception {
        public InvalidGrant(String description) {
            super("invalid_grant", description);
        }
    }

    public static class UnauthorizedClient extends OAuth2Exception {
        public UnauthorizedClient(String description) {
            super("unauthorized_client", description);
        }
    }

    public static class UnsupportedGrantType extends OAuth2Exception {
        public UnsupportedGrantType(String description) {
            super("unsupported_grant_type", description);
        }
    }

    public static class UnsupportedResponseType extends OAuth2Exception {
        public UnsupportedResponseType(String description) {
            super("unsupported_response_type", description);
        }
    }

    public static class InvalidScope extends OAuth2Exception {
        public InvalidScope(String description) {
            super("invalid_scope", description);
        }
    }

    public static class ServerError extends OAuth2Exception {
        public ServerError(String description) {
            super("server_error", description);
        }
    }

    public static class TemporarilyUnavailable extends OAuth2Exception {
        public TemporarilyUnavailable(String description) {
            super("temporarily_unavailable", description);
        }
    }

    public static class AccessDenied extends OAuth2Exception {
        public AccessDenied(String description) {
            super("access_denied", description);
        }
    }
}
