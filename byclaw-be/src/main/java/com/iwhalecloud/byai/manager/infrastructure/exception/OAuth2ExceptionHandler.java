package com.iwhalecloud.byai.manager.infrastructure.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * OAuth2异常处理器
 */
@ControllerAdvice
public class OAuth2ExceptionHandler {

    private static final Logger logger = LoggerFactory.getLogger(OAuth2ExceptionHandler.class);

    /**
     * 处理OAuth2异常
     */
    @ExceptionHandler(OAuth2Exception.class)
    public ResponseEntity<?> handleOAuth2Exception(OAuth2Exception ex, HttpServletRequest request) {
        logger.error("OAuth2 Exception: {} - {}", ex.getError(), ex.getErrorDescription(), ex);
        
        String requestUri = request.getRequestURI();
        
        // 授权端点的错误需要重定向
        if (requestUri.contains("/oauth2/auth")) {
            String redirectUri = request.getParameter("redirect_uri");
            String state = request.getParameter("state");
            
            if (redirectUri != null) {
                return ResponseEntity.status(HttpStatus.FOUND)
                    .location(java.net.URI.create(buildErrorRedirectUrl(redirectUri, ex.getError(), ex.getErrorDescription(), state)))
                    .build();
            }
        }
        
        // 其他端点返回JSON错误响应
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", ex.getError());
        errorResponse.put("error_description", ex.getErrorDescription());
        
        if (ex.getErrorUri() != null) {
            errorResponse.put("error_uri", ex.getErrorUri());
        }
        
        // 根据错误类型返回适当的HTTP状态码
        HttpStatus status = getHttpStatusForError(ex.getError());
        
        return ResponseEntity.status(status).body(errorResponse);
    }

    /**
     * 处理通用异常
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGenericException(Exception ex, HttpServletRequest request) {
        logger.error("Unexpected error in OAuth2 endpoint: {}", request.getRequestURI(), ex);
        
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", "server_error");
        errorResponse.put("error_description", "An unexpected error occurred");
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }

    /**
     * 构建错误重定向URL
     */
    private String buildErrorRedirectUrl(String redirectUri, String error, String errorDescription, String state) {
        try {
            StringBuilder errorUrl = new StringBuilder(redirectUri);
            errorUrl.append(redirectUri.contains("?") ? "&" : "?");
            errorUrl.append("error=").append(URLEncoder.encode(error, StandardCharsets.UTF_8));
            errorUrl.append("&error_description=").append(URLEncoder.encode(errorDescription, StandardCharsets.UTF_8));
            
            if (state != null) {
                errorUrl.append("&state=").append(URLEncoder.encode(state, StandardCharsets.UTF_8));
            }
            
            return errorUrl.toString();
        } catch (Exception e) {
            logger.error("Error building error redirect URL", e);
            return redirectUri;
        }
    }

    /**
     * 根据OAuth2错误类型返回相应的HTTP状态码
     */
    private HttpStatus getHttpStatusForError(String error) {
        switch (error) {
            case "invalid_request":
            case "invalid_scope":
            case "unsupported_response_type":
            case "unsupported_grant_type":
                return HttpStatus.BAD_REQUEST;
            
            case "invalid_client":
            case "unauthorized_client":
                return HttpStatus.UNAUTHORIZED;
            
            case "access_denied":
                return HttpStatus.FORBIDDEN;
            
            case "invalid_grant":
                return HttpStatus.BAD_REQUEST;
            
            case "temporarily_unavailable":
                return HttpStatus.SERVICE_UNAVAILABLE;
            
            case "server_error":
            default:
                return HttpStatus.INTERNAL_SERVER_ERROR;
        }
    }
}
