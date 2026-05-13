package com.iwhalecloud.byai.manager.interfaces.controller.oauth2;

import com.iwhalecloud.byai.manager.application.service.oauth2.OAuth2AuthorizationService;
import com.iwhalecloud.byai.manager.application.service.oauth2.OAuth2RateLimitService;
import com.iwhalecloud.byai.manager.domain.source.service.SourceSystemService;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.view.RedirectView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.Map;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * OAuth2授权服务器控制器 实现标准的OAuth2授权码流程，支持PKCE、速率限制等安全特性 主要功能： - OAuth2授权端点 (/oauth2/auth) - 令牌端点 (/oauth2/token) - 用户信息端点
 * (/oauth2/userinfo) - 令牌刷新端点 (/oauth2/refresh) - 令牌撤销端点 (/oauth2/revoke) - 令牌内省端点 (/oauth2/introspect) - 服务器元数据端点
 * (/.well-known/oauth-authorization-server)
 *
 * @author AI Assistant
 * @version 1.0
 * @since 2024
 */
@RestController
@RequestMapping("/oauth2")
public class OAuth2AuthorizationServerController {

    /** 日志记录器 */
    private static final Logger logger = LoggerFactory.getLogger(OAuth2AuthorizationServerController.class);

    @Autowired
    private SourceSystemService sourceSystemService;

    @Autowired
    private OAuth2RateLimitService oauth2RateLimitService;

    @Autowired
    private OAuth2AuthorizationService oauth2AuthorizationService;

    /**
     * OAuth2授权端点 处理OAuth2授权请求，生成授权码并重定向回客户端 支持PKCE、速率限制等安全特性
     *
     * @param responseType 响应类型，必须是"code"
     * @param clientId 客户端ID，对应数据库中的app_key
     * @param redirectUri 回调地址，必须与数据库配置匹配
     * @param scope 授权范围，默认"openid"
     * @param state 状态参数，用于防止CSRF攻击
     * @param prompt 提示参数，控制用户交互方式
     * @param codeChallenge PKCE代码挑战值，可选
     * @param codeChallengeMethod PKCE挑战方法，支持"S256"和"plain"
     * @param request HTTP请求对象，用于获取客户端IP
     * @return 重定向响应或错误信息
     */
    @GetMapping("/authorize")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "授权端点")
    public Object authorize(@RequestParam("response_type") String responseType,
                            @RequestParam("client_id") String clientId, @RequestParam("redirect_uri") String redirectUri,
                            @RequestParam(value = "scope", required = false, defaultValue = "openid") String scope,
                            @RequestParam(value = "state", required = false) String state,
                            @RequestParam(value = "prompt", required = false) String prompt,
                            @RequestParam(value = "code_challenge", required = false) String codeChallenge,
                            @RequestParam(value = "code_challenge_method", required = false) String codeChallengeMethod,
                            HttpServletRequest request) {

        String clientIp = this.getClientIp(request);
        logger.info("OAuth2 authorization request - client_id: {}, redirect_uri: {}, scope: {}, ip: {}", clientId,
                redirectUri, scope, clientIp);

        try {
            // 0. 检查用户是否已登录
            LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
            if (loginInfo == null) {
                logger.info("User not logged in, redirecting to login page");
                String currentUrl = request.getRequestURL().toString() + "?" + request.getQueryString();
                String loginUrl = "/login?redirect_uri=" + URLEncoder.encode(currentUrl, "UTF-8");
                return new RedirectView(loginUrl);
            }

            // 1. 速率限制检查
            if (!oauth2RateLimitService.checkAuthorizationRateLimit(clientId, clientIp)) {
                logger.warn("Authorization rate limit exceeded - client_id: {}, ip: {}", clientId, clientIp);
                return buildErrorResponse("temporarily_unavailable", "Rate limit exceeded, please try again later",
                        redirectUri, state);
            }
            // 2. 验证请求参数
            if (!"code".equals(responseType)) {
                return buildErrorResponse("unsupported_response_type", "Only 'code' response type is supported",
                        redirectUri, state);
            }

            if (!StringUtils.hasText(clientId)) {
                return buildErrorResponse("invalid_request", "client_id is required", redirectUri, state);
            }

            if (!StringUtils.hasText(redirectUri)) {
                return buildErrorResponse("invalid_request", "redirect_uri is required", redirectUri, state);
            }

            // 3. 根据client_id查找应用配置
            SourceSystem sourceSystem = sourceSystemService.getSourceSystemByAppKey(clientId);
            if (sourceSystem == null) {
                logger.warn("Unknown client_id: {}", clientId);
                return buildErrorResponse("invalid_client", "Unknown client_id", redirectUri, state);
            }

            // 4. 验证redirect_uri是否匹配
            if (!oauth2AuthorizationService.validateRedirectUri(sourceSystem, redirectUri)) {
                logger.warn("Invalid redirect_uri for client_id {}: {}", clientId, redirectUri);
                return buildErrorResponse("invalid_request", "Invalid redirect_uri", redirectUri, state);
            }

            // 5. 验证PKCE参数（如果提供）
            if (StringUtils.hasText(codeChallenge)) {
                if (!oauth2AuthorizationService.validatePKCE(codeChallenge, codeChallengeMethod)) {
                    logger.warn("Invalid PKCE parameters for client_id: {}", clientId);
                    return buildErrorResponse("invalid_request", "Invalid PKCE parameters", redirectUri, state);
                }
            }

            // 6. 直接生成授权码（包含用户ID）
            String authorizationCode = oauth2AuthorizationService.generateAuthorizationCode(clientId, redirectUri,
                    scope, state, codeChallenge, codeChallengeMethod);

            // 7. 构建回调URL
            String callbackUrl = buildCallbackUrl(redirectUri, authorizationCode, state);

            logger.info("Generated authorization code for client_id: {}, user: {}, redirecting to: {}", clientId,
                    loginInfo.getUserCode(), callbackUrl);

            return new RedirectView(callbackUrl);

        }
        catch (Exception e) {
            logger.error("Error processing OAuth2 authorization request", e);
            return buildErrorResponse("server_error", "Internal server error", redirectUri, state);
        }
    }

    /**
     * OAuth2令牌端点 使用授权码交换访问令牌，支持PKCE验证
     *
     * @param grantType 授权类型，必须是"authorization_code"
     * @param code 授权码，从授权端点获取
     * @param redirectUri 回调地址，必须与授权请求中的一致
     * @param clientId 客户端ID
     * @param clientSecret 客户端密钥，可选
     * @param codeVerifier PKCE代码验证器，用于验证code_challenge
     * @param request HTTP请求对象，用于获取客户端IP和速率限制
     * @return 包含访问令牌的JSON响应或错误信息
     */
    @PostMapping("/token")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "令牌端点")
    public Map<String, Object> token(@RequestParam("grant_type") String grantType, @RequestParam("code") String code,
                                     @RequestParam("redirect_uri") String redirectUri, @RequestParam("client_id") String clientId,
                                     @RequestParam(value = "client_secret", required = false) String clientSecret,
                                     @RequestParam(value = "code_verifier", required = false) String codeVerifier, HttpServletRequest request) {

        String clientIp = getClientIp(request);
        logger.info("OAuth2 token request - client_id: {}, grant_type: {}, code: {}, ip: {}", clientId, grantType, code,
                clientIp);

        try {
            // 0. 速率限制检查
            if (!oauth2RateLimitService.checkTokenRateLimit(clientId, clientIp)) {
                logger.warn("Token rate limit exceeded - client_id: {}, ip: {}", clientId, clientIp);
                return buildTokenErrorResponse("temporarily_unavailable",
                        "Rate limit exceeded, please try again later");
            }
            // 1. 验证grant_type
            if (!"authorization_code".equals(grantType)) {
                return buildTokenErrorResponse("unsupported_grant_type",
                        "Only 'authorization_code' grant type is supported");
            }

            // 2. 验证客户端
            SourceSystem sourceSystem = sourceSystemService.getSourceSystemByAppKey(clientId);
            if (sourceSystem == null) {
                return buildTokenErrorResponse("invalid_client", "Unknown client_id");
            }

            // 3. 验证客户端密钥（如果提供）
            if (StringUtils.hasText(clientSecret) && !clientSecret.equals(sourceSystem.getAppSecret())) {
                return buildTokenErrorResponse("invalid_client", "Invalid client_secret");
            }

            // 4. 验证授权码和PKCE
            if (!oauth2AuthorizationService.validateAuthorizationCodeWithPKCE(code, clientId, redirectUri,
                    codeVerifier)) {
                return buildTokenErrorResponse("invalid_grant",
                        "Invalid authorization code or PKCE verification failed");
            }

            // 5. 生成访问令牌
            Map<String, Object> tokenResponse = oauth2AuthorizationService.generateAccessToken(code, clientId,
                    clientSecret);

            logger.info("Generated access token for client_id: {}", clientId);

            return tokenResponse;

        }
        catch (Exception e) {
            logger.error("Error processing OAuth2 token request", e);
            return buildTokenErrorResponse("server_error", "Internal server error");
        }
    }

    /**
     * OAuth2令牌刷新端点 使用刷新令牌获取新的访问令牌
     *
     * @param grantType 授权类型，必须是"refresh_token"
     * @param refreshToken 刷新令牌
     * @param clientId 客户端ID
     * @param clientSecret 客户端密钥，可选
     * @return 包含新访问令牌的JSON响应或错误信息
     */
    @PostMapping("/refresh")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "刷新令牌端点")
    public Map<String, Object> refreshToken(@RequestParam("grant_type") String grantType,
                                            @RequestParam("refresh_token") String refreshToken, @RequestParam("client_id") String clientId,
                                            @RequestParam(value = "client_secret", required = false) String clientSecret) {

        logger.info("OAuth2 refresh token request - client_id: {}", clientId);

        try {
            // 1. 验证grant_type
            if (!"refresh_token".equals(grantType)) {
                return buildTokenErrorResponse("unsupported_grant_type",
                        "Only 'refresh_token' grant type is supported");
            }

            // 2. 验证客户端
            SourceSystem sourceSystem = sourceSystemService.getSourceSystemByAppKey(clientId);
            if (sourceSystem == null) {
                return buildTokenErrorResponse("invalid_client", "Unknown client_id");
            }

            // 3. 验证客户端密钥（如果提供）
            if (StringUtils.hasText(clientSecret) && !clientSecret.equals(sourceSystem.getAppSecret())) {
                return buildTokenErrorResponse("invalid_client", "Invalid client_secret");
            }

            // 4. 刷新访问令牌
            Map<String, Object> tokenResponse = oauth2AuthorizationService.refreshAccessToken(refreshToken,
                    sourceSystem);

            if (tokenResponse == null) {
                return buildTokenErrorResponse("invalid_grant", "Invalid or expired refresh token");
            }

            logger.info("Refreshed access token for client_id: {}", clientId);

            return tokenResponse;

        }
        catch (Exception e) {
            logger.error("Error processing OAuth2 refresh token request", e);
            return buildTokenErrorResponse("server_error", "Internal server error");
        }
    }

    /**
     * OAuth2用户信息端点 使用访问令牌获取用户信息，支持Bearer令牌和查询参数两种方式
     *
     * @param authorization Authorization头，格式：Bearer {access_token}
     * @param accessToken 查询参数中的访问令牌，可选
     * @return 用户信息JSON对象或错误信息
     */
    @GetMapping("/userinfo")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "用户信息端点")
    public Map<String, Object> userInfo(@RequestHeader(value = "Authorization", required = false) String authorization,
                                        @RequestParam(value = "access_token", required = false) String accessToken) {

        try {
            // 1. 提取访问令牌
            String token = null;
            if (StringUtils.hasText(authorization) && authorization.startsWith("Bearer ")) {
                token = authorization.substring(7);
            }
            else if (StringUtils.hasText(accessToken)) {
                token = accessToken;
            }

            if (!StringUtils.hasText(token)) {
                return buildUserInfoErrorResponse("invalid_request", "Access token is required");
            }

            // 2. 验证访问令牌并获取用户信息
            Map<String, Object> userInfo = oauth2AuthorizationService.getUserInfoByAccessToken(token);

            if (userInfo == null) {
                return buildUserInfoErrorResponse("invalid_token", "Invalid or expired access token");
            }

            logger.info("Retrieved user info for access token");

            return userInfo;

        }
        catch (Exception e) {
            logger.error("Error processing OAuth2 userinfo request", e);
            return buildUserInfoErrorResponse("server_error", "Internal server error");
        }
    }

    /**
     * 构建错误响应（重定向方式）
     */
    private RedirectView buildErrorResponse(String error, String errorDescription, String redirectUri, String state) {
        try {
            StringBuilder errorUrl = new StringBuilder(redirectUri);
            errorUrl.append(redirectUri.contains("?") ? "&" : "?");
            errorUrl.append("error=").append(URLEncoder.encode(error, StandardCharsets.UTF_8));
            errorUrl.append("&error_description=").append(URLEncoder.encode(errorDescription, StandardCharsets.UTF_8));

            if (StringUtils.hasText(state)) {
                errorUrl.append("&state=").append(URLEncoder.encode(state, StandardCharsets.UTF_8));
            }

            return new RedirectView(errorUrl.toString());
        }
        catch (Exception e) {
            logger.error("Error building error response", e);
            return new RedirectView(redirectUri);
        }
    }

    /**
     * 构建令牌错误响应（JSON方式）
     *
     * @param error 错误代码，符合OAuth2标准
     * @param errorDescription 错误描述
     * @return 标准化的错误响应JSON对象
     */
    private Map<String, Object> buildTokenErrorResponse(String error, String errorDescription) {
        Map<String, Object> response = new HashMap<>();
        response.put("error", error);
        response.put("error_description", errorDescription);
        return response;
    }

    /**
     * 构建用户信息错误响应（JSON方式）
     *
     * @param error 错误代码
     * @param errorDescription 错误描述
     * @return 错误响应JSON对象
     */
    private Map<String, Object> buildUserInfoErrorResponse(String error, String errorDescription) {
        Map<String, Object> response = new HashMap<>();
        response.put("error", error);
        response.put("error_description", errorDescription);
        return response;
    }

    /**
     * OAuth2令牌撤销端点 标准OAuth2令牌撤销请求：POST /oauth2/revoke
     */
    @PostMapping("/revoke")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "撤销令牌端点")
    public Map<String, Object> revokeToken(@RequestParam("token") String token,
                                           @RequestParam(value = "token_type_hint", required = false) String tokenTypeHint,
                                           @RequestParam("client_id") String clientId,
                                           @RequestParam(value = "client_secret", required = false) String clientSecret) {

        logger.info("OAuth2 revoke token request - client_id: {}", clientId);

        try {
            // 1. 验证客户端
            SourceSystem clientApp = sourceSystemService.getSourceSystemByAppKey(clientId);
            if (clientApp == null) {
                return buildTokenErrorResponse("invalid_client", "Unknown client_id");
            }

            // 2. 验证客户端密钥（如果提供）
            if (StringUtils.hasText(clientSecret) && !clientSecret.equals(clientApp.getAppSecret())) {
                return buildTokenErrorResponse("invalid_client", "Invalid client_secret");
            }

            // 3. 撤销令牌
            boolean revoked = oauth2AuthorizationService.revokeToken(token, tokenTypeHint, clientId);

            Map<String, Object> response = new HashMap<>();
            if (revoked) {
                response.put("success", true);
                response.put("message", "Token revoked successfully");
                logger.info("Revoked token for client_id: {}", clientId);
            }
            else {
                response.put("success", false);
                response.put("message", "Token not found or already expired");
            }

            return response;

        }
        catch (Exception e) {
            logger.error("Error processing OAuth2 revoke token request", e);
            return buildTokenErrorResponse("server_error", "Internal server error");
        }
    }

    /**
     * OAuth2令牌内省端点 标准OAuth2令牌内省请求：POST /oauth2/introspect
     */
    @PostMapping("/introspect")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "令牌内省端点")
    public Map<String, Object> introspectToken(@RequestParam("token") String token,
                                               @RequestParam(value = "token_type_hint", required = false) String tokenTypeHint,
                                               @RequestParam("client_id") String clientId,
                                               @RequestParam(value = "client_secret", required = false) String clientSecret) {

        logger.info("OAuth2 token introspection request - client_id: {}", clientId);

        try {
            // 1. 验证客户端
            SourceSystem clientApp = sourceSystemService.getSourceSystemByAppKey(clientId);
            if (clientApp == null) {
                return buildIntrospectionErrorResponse("invalid_client", "Unknown client_id");
            }

            // 2. 验证客户端密钥（如果提供）
            if (StringUtils.hasText(clientSecret) && !clientSecret.equals(clientApp.getAppSecret())) {
                return buildIntrospectionErrorResponse("invalid_client", "Invalid client_secret");
            }

            // 3. 内省令牌
            Map<String, Object> introspectionResponse = oauth2AuthorizationService.introspectToken(token,
                    tokenTypeHint);

            logger.info("Token introspection completed for client_id: {}", clientId);

            return introspectionResponse;

        }
        catch (Exception e) {
            logger.error("Error processing OAuth2 token introspection request", e);
            return buildIntrospectionErrorResponse("server_error", "Internal server error");
        }
    }

    /**
     * OAuth2服务器信息端点 返回OAuth2服务器的配置信息
     */
    @GetMapping("/.well-known/oauth-authorization-server")
    @ManageLogAnnotation(name = "Oauth2授权管理", description = "服务器元数据端点")
    public Map<String, Object> serverMetadata() {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("issuer", "http://localhost:8600/aiFactoryServer");
        metadata.put("authorization_endpoint", "http://localhost:8600/aiFactoryServer/oauth2/authorize");
        metadata.put("token_endpoint", "http://localhost:8600/aiFactoryServer/oauth2/token");
        metadata.put("refresh_endpoint", "http://localhost:8600/aiFactoryServer/oauth2/refresh");
        metadata.put("userinfo_endpoint", "http://localhost:8600/aiFactoryServer/oauth2/userinfo");
        metadata.put("revocation_endpoint", "http://localhost:8600/aiFactoryServer/oauth2/revoke");
        metadata.put("introspection_endpoint", "http://localhost:8600/aiFactoryServer/oauth2/introspect");
        metadata.put("response_types_supported", new String[] {
                "code"
        });
        metadata.put("grant_types_supported", new String[] {
                "authorization_code", "refresh_token"
        });
        metadata.put("token_endpoint_auth_methods_supported", new String[] {
                "client_secret_post", "client_secret_basic"
        });
        metadata.put("scopes_supported", new String[] {
                "openid", "profile", "email"
        });
        metadata.put("claims_supported", new String[] {
                "sub", "name", "email", "given_name", "family_name"
        });
        metadata.put("code_challenge_methods_supported", new String[] {
                "S256", "plain"
        });

        return metadata;
    }

    /**
     * 构建令牌内省错误响应
     */
    private Map<String, Object> buildIntrospectionErrorResponse(String error, String errorDescription) {
        Map<String, Object> response = new HashMap<>();
        response.put("active", false);
        response.put("error", error);
        response.put("error_description", errorDescription);
        return response;
    }

    /**
     * 获取客户端真实IP地址 优先从代理头中获取真实IP，处理负载均衡和反向代理场景
     *
     * @param request HTTP请求对象
     * @return 客户端真实IP地址
     */
    private String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(xForwardedFor) && !"unknown".equalsIgnoreCase(xForwardedFor)) {
            // X-Forwarded-For可能包含多个IP，取第一个
            return xForwardedFor.split(",")[0].trim();
        }

        String xRealIp = request.getHeader("X-Real-IP");
        if (StringUtils.hasText(xRealIp) && !"unknown".equalsIgnoreCase(xRealIp)) {
            return xRealIp;
        }

        String proxyClientIp = request.getHeader("Proxy-Client-IP");
        if (StringUtils.hasText(proxyClientIp) && !"unknown".equalsIgnoreCase(proxyClientIp)) {
            return proxyClientIp;
        }

        String wlProxyClientIp = request.getHeader("WL-Proxy-Client-IP");
        if (StringUtils.hasText(wlProxyClientIp) && !"unknown".equalsIgnoreCase(wlProxyClientIp)) {
            return wlProxyClientIp;
        }

        return request.getRemoteAddr();
    }

    /**
     * 构建回调URL 在重定向URI后面添加授权码和状态参数
     *
     * @param redirectUri 客户端提供的重定向URI
     * @param authorizationCode 生成的授权码
     * @param state 状态参数，可选
     * @return 完整的回调URL
     */
    private String buildCallbackUrl(String redirectUri, String authorizationCode, String state) {
        StringBuilder callbackUrl = new StringBuilder(redirectUri);
        callbackUrl.append(redirectUri.contains("?") ? "&" : "?");
        callbackUrl.append("code=").append(authorizationCode);

        if (StringUtils.hasText(state)) {
            callbackUrl.append("&state=").append(state);
        }

        return callbackUrl.toString();
    }
}
