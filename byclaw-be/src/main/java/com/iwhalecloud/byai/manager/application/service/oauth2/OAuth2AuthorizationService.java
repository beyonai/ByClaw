package com.iwhalecloud.byai.manager.application.service.oauth2;

import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.apache.commons.collections.MapUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * OAuth2授权服务 处理授权码生成、验证、令牌生成等核心逻辑 支持PKCE、令牌内省、令牌撤销等高级功能
 *
 * @author AI Assistant
 * @version 1.0
 * @since 2024
 */
@Service
public class OAuth2AuthorizationService {

    /**
     * 日志记录器
     */
    private static final Logger logger = LoggerFactory.getLogger(OAuth2AuthorizationService.class);

    // Redis存储key前缀
    /**
     * 授权码存储前缀
     */
    private static final String AUTH_CODE_PREFIX = "oauth2:auth_code:";

    /**
     * 刷新令牌存储前缀
     */
    private static final String REFRESH_TOKEN_PREFIX = "oauth2:refresh_token:";

    // 令牌过期时间（秒）
    /**
     * 授权码过期时间：10分钟
     */
    private static final long AUTH_CODE_EXPIRES = 600;

    /**
     * 访问令牌过期时间：2小时
     */
    private static final long ACCESS_TOKEN_EXPIRES = 7200;

    /**
     * 刷新令牌过期时间：30天
     */
    private static final long REFRESH_TOKEN_EXPIRES = 2592000;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private SystemConfigService systemConfigService;

    /**
     * 验证重定向URI是否匹配 检查客户端提供的重定向URI是否与数据库配置匹配
     *
     * @param clientApp 客户端应用配置
     * @param redirectUri 客户端提供的重定向URI
     * @return true表示匹配，false表示不匹配
     */
    public boolean validateRedirectUri(SourceSystem clientApp, String redirectUri) {
        String check = systemConfigService.getStringParamValueByCode("OAUTH2_REDIRECT_URI_VALIDATE_SWITCH");
        if (!Constants.YES_VALUE_TRUE.equalsIgnoreCase(check)) {
            return true;
        }

        if (clientApp == null || !StringUtils.hasText(redirectUri)) {
            return false;
        }

        String configuredRedirectUri = clientApp.getRedirectUri();
        if (!StringUtils.hasText(configuredRedirectUri)) {
            logger.warn("No redirect_uri configured for client: {}", clientApp.getAppKey());
            return false;
        }

        // 精确匹配或前缀匹配
        return redirectUri.equals(configuredRedirectUri)
            || redirectUri.startsWith(configuredRedirectUri.replace("*", ""));
    }

    /**
     * 验证PKCE参数 检查code_challenge的格式和长度是否符合RFC 7636标准
     *
     * @param codeChallenge PKCE代码挑战值
     * @param codeChallengeMethod 挑战方法，支持"S256"和"plain"
     * @return true表示参数有效，false表示参数无效
     */
    public boolean validatePKCE(String codeChallenge, String codeChallengeMethod) {
        if (!StringUtils.hasText(codeChallenge)) {
            return false;
        }

        // 支持的code_challenge_method
        if (StringUtils.hasText(codeChallengeMethod)) {
            if (!"S256".equals(codeChallengeMethod) && !"plain".equals(codeChallengeMethod)) {
                logger.warn("Unsupported code_challenge_method: {}", codeChallengeMethod);
                return false;
            }
        }

        // code_challenge长度验证 (43-128字符)
        if (codeChallenge.length() < 43 || codeChallenge.length() > 128) {
            logger.warn("Invalid code_challenge length: {}", codeChallenge.length());
            return false;
        }

        return true;
    }

    /**
     * 生成授权码（支持PKCE，包含用户ID）
     */
    public String generateAuthorizationCode(String clientId, String redirectUri, String scope, String state,
        String codeChallenge, String codeChallengeMethod) {
        String authorizationCode = UUID.randomUUID().toString().replace("-", "");

        // 存储授权码相关信息
        Map<String, Object> codeData = new HashMap<>();
        codeData.put("client_id", clientId);
        codeData.put("redirect_uri", redirectUri);
        codeData.put("scope", scope);
        codeData.put("state", state);
        codeData.put("created_time", System.currentTimeMillis());
        // 存储用户ID
        codeData.put("user_id", CurrentUserHolder.getCurrentUserId());

        // 存储PKCE参数
        if (StringUtils.hasText(codeChallenge)) {
            codeData.put("code_challenge", codeChallenge);
            codeData.put("code_challenge_method",
                StringUtils.hasText(codeChallengeMethod) ? codeChallengeMethod : "plain");
        }

        // 存储到Redis，设置过期时间 - 使用RedisUtil并以JSON格式保存
        String redisKey = AUTH_CODE_PREFIX + authorizationCode;
        String jsonData = JsonUtil.toJSONString(codeData);
        RedisUtil.setString(redisKey, jsonData, AUTH_CODE_EXPIRES);

        logger.info("Generated authorization code: {} for client_id: {} (PKCE: {})", authorizationCode, clientId,
            StringUtils.hasText(codeChallenge) ? "enabled" : "disabled");

        return authorizationCode;
    }

    /**
     * 验证授权码和PKCE
     */
    public boolean validateAuthorizationCodeWithPKCE(String authorizationCode, String clientId, String redirectUri,
        String codeVerifier) {
        String redisKey = AUTH_CODE_PREFIX + authorizationCode;

        String jsonData = RedisUtil.getString(redisKey);
        if (jsonData == null) {
            logger.warn("Authorization code not found or expired: {}", authorizationCode);
            return false;
        }

        // 将JSON字符串转换为Map对象
        @SuppressWarnings("unchecked")
        Map<String, Object> codeData = JsonUtil.parseObject(jsonData, Map.class);
        if (codeData == null) {
            logger.warn("Failed to parse authorization code data: {}", authorizationCode);
            return false;
        }

        // 验证client_id和redirect_uri
        String storedClientId = MapUtils.getString(codeData, "client_id");
        if (!clientId.equals(storedClientId)) {
            logger.warn("Authorization code validation failed - client_id: {}, redirect_uri: {}", clientId,
                redirectUri);
            return false;
        }

        // 验证PKCE（如果存在code_challenge）
        String storedCodeChallenge = MapUtils.getString(codeData, "code_challenge");
        if (StringUtils.hasText(storedCodeChallenge)) {
            if (!StringUtils.hasText(codeVerifier)) {
                logger.warn("Code verifier required but not provided for client_id: {}", clientId);
                return false;
            }

            String codeChallengeMethod = MapUtils.getString(codeData, "code_challenge_method");
            if (!verifyPKCE(codeVerifier, storedCodeChallenge, codeChallengeMethod)) {
                logger.warn("PKCE verification failed for client_id: {}", clientId);
                return false;
            }
        }

        return true;
    }

    /**
     * 验证PKCE code_verifier
     */
    private boolean verifyPKCE(String codeVerifier, String codeChallenge, String codeChallengeMethod) {
        try {
            String computedChallenge;

            if ("S256".equals(codeChallengeMethod)) {
                // SHA256 hash and base64url encode
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] hash = digest.digest(codeVerifier.getBytes("UTF-8"));
                computedChallenge = Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
            }
            else {
                // plain method
                computedChallenge = codeVerifier;
            }

            boolean isValid = computedChallenge.equals(codeChallenge);
            logger.debug("PKCE verification - method: {}, valid: {}", codeChallengeMethod, isValid);

            return isValid;

        }
        catch (Exception e) {
            logger.error("Error verifying PKCE", e);
            return false;
        }
    }

    /**
     * 生成访问令牌
     */
    public Map<String, Object> generateAccessToken(String authorizationCode, String clientId, String clientSecret) {

        String redisKey = AUTH_CODE_PREFIX + authorizationCode;

        String jsonData = RedisUtil.getString(redisKey);

        if (jsonData == null) {
            logger.error("Authorization code not found when generating access token: {}", authorizationCode);
            return null;
        }

        // 将JSON字符串转换为Map对象
        Map<String, Object> codeData = JSON.parseObject(jsonData, Map.class);
        if (codeData == null) {
            logger.error("Failed to parse authorization code data: {}", authorizationCode);
            return null;
        }

        // 从授权码中获取用户ID
        Long userId = MapParamUtil.getLongValue(codeData, "user_id", null);
        if (userId == null) {
            logger.error("User ID not found in authorization code data: {}", authorizationCode);
            return null;
        }

        // 通过用户ID获取完整的用户登录信息
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(userId);
        if (loginInfo == null) {
            logger.error("User not found for user_id: {}", userId);
            return null;
        }

        // 生成刷新令牌
        String refreshToken = UUID.randomUUID().toString().replace("-", "");

        // 构建刷新令牌数据
        Map<String, Object> refreshTokenData = new HashMap<>();
        refreshTokenData.put("client_id", clientId);
        refreshTokenData.put("user_id", userId);
        String scope = MapUtils.getString(codeData, "scope");
        refreshTokenData.put("scope", scope);
        refreshTokenData.put("created_time", System.currentTimeMillis());

        // 存储刷新令牌 - 以JSON格式保存
        String refreshTokenKey = REFRESH_TOKEN_PREFIX + refreshToken;
        String refreshTokenJson = JsonUtil.toJSONString(refreshTokenData);
        RedisUtil.setString(refreshTokenKey, refreshTokenJson, REFRESH_TOKEN_EXPIRES);

        // 删除已使用的授权码
        RedisUtil.removeKey(redisKey);

        String jwtAccessToken = jwtService.createJwt(loginInfo);

        // 构建响应
        Map<String, Object> response = new HashMap<>(5);
        response.put("access_token", jwtAccessToken);
        response.put("token_type", "Bearer");
        response.put("expires_in", ACCESS_TOKEN_EXPIRES);
        response.put("refresh_token", refreshToken);
        response.put("scope", scope);

        logger.info("Generated JWT access token for client_id: {}, user_id: {}", clientId, userId);

        return response;
    }

    /**
     * 根据JWT访问令牌获取用户信息
     */
    public Map<String, Object> getUserInfoByAccessToken(String jwtAccessToken) {
        try {
            // 验证JWT令牌并获取用户信息
            LoginInfo loginInfo = jwtService.verifyJwt(jwtAccessToken, LoginInfo.class);
            if (loginInfo == null) {
                logger.warn("Invalid or expired JWT access token");
                return null;
            }

            // 构建用户信息响应
            Map<String, Object> userInfo = new HashMap<>();
            userInfo.put("sub", loginInfo.getUserCode()); // subject - 用户标识
            userInfo.put("user_id", loginInfo.getUserId());
            userInfo.put("user_code", loginInfo.getUserCode());
            userInfo.put("name", loginInfo.getUserName());
            userInfo.put("email", loginInfo.getEmail());
            userInfo.put("phone", loginInfo.getPhone());
            userInfo.put("enterprise_id", loginInfo.getEnterpriseId());
            userInfo.put("iss", "ByaiManager"); // issuer - 发行者
            userInfo.put("aud", loginInfo.getUserCode()); // audience - 受众

            // JWT中的时间信息
            if (loginInfo.getExpiredTime() != null) {
                userInfo.put("exp", loginInfo.getExpiredTime() / 1000); // expiration - 过期时间 (Unix timestamp)
            }

            logger.info("Retrieved user info from JWT for user_code: {}", loginInfo.getUserCode());

            return userInfo;

        }
        catch (Exception e) {
            logger.error("Error verifying JWT access token", e);
            return null;
        }
    }

    /**
     * 刷新访问令牌
     */
    public Map<String, Object> refreshAccessToken(String refreshToken, SourceSystem sourceSystem) {
        String redisKey = REFRESH_TOKEN_PREFIX + refreshToken;

        String jsonData = RedisUtil.getString(redisKey);
        if (jsonData == null) {
            logger.warn("Refresh token not found or expired: {}", refreshToken);
            return null;
        }

        // 将JSON字符串转换为Map对象
        Map<String, Object> refreshTokenData = JSON.parseObject(jsonData, Map.class);
        if (refreshTokenData == null) {
            logger.warn("Failed to parse refresh token data: {}", refreshToken);
            return null;
        }

        String storedClientId = MapUtils.getString(refreshTokenData, "client_id");
        if (!sourceSystem.getAppKey().equals(storedClientId)) {
            logger.warn("Client ID mismatch for refresh token: {} vs {}", sourceSystem.getAppKey(), storedClientId);
            return null;
        }

        // 从刷新令牌中获取用户ID
        Long userId = MapUtils.getLong(refreshTokenData, "user_id");
        // 重新获取完整的用户登录信息
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(userId);
        if (loginInfo == null) {
            logger.error("User not found for user_id: {}", userId);
            return null;
        }

        // 生成新的JWT访问令牌
        String newJwtAccessToken = jwtService.createJwt(loginInfo, sourceSystem.getAppSecret());

        // 构建响应
        Map<String, Object> response = new HashMap<>();
        response.put("access_token", newJwtAccessToken);
        response.put("token_type", "Bearer");
        response.put("expires_in", ACCESS_TOKEN_EXPIRES);
        response.put("refresh_token", refreshToken);
        response.put("scope", MapUtils.getString(refreshTokenData, "scope"));

        logger.info("Refreshed access token for client_id: {}", sourceSystem.getAppKey());

        return response;
    }

    /**
     * 撤销令牌
     */
    public boolean revokeToken(String token, String tokenTypeHint, String clientId) {
        boolean revoked = false;

        // 对于JWT访问令牌，我们无法真正撤销（无状态特性）
        // 但可以记录撤销请求用于审计
        if ("access_token".equals(tokenTypeHint)) {
            try {
                LoginInfo loginInfo = jwtService.verifyJwt(token, LoginInfo.class);
                if (loginInfo != null) {
                    logger.info("JWT access token revocation requested for client_id: {}, user_code: {}", clientId,
                        loginInfo.getUserCode());
                    // 注意：JWT令牌无法被服务端撤销，除非实现黑名单机制
                    revoked = true;
                }
            }
            catch (Exception e) {
                logger.warn("Invalid JWT token provided for revocation: {}", e.getMessage());
            }
        }

        // 尝试撤销刷新令牌
        if ("refresh_token".equals(tokenTypeHint) || (tokenTypeHint == null && !revoked)) {
            String refreshTokenKey = REFRESH_TOKEN_PREFIX + token;
            if (RedisUtil.hasKey(refreshTokenKey)) {
                RedisUtil.removeKey(refreshTokenKey);
                revoked = true;
                logger.info("Revoked refresh token for client_id: {}", clientId);
            }
        }

        return revoked;
    }

    /**
     * 令牌内省
     */
    public Map<String, Object> introspectToken(String token, String tokenTypeHint) {
        Map<String, Object> response = new HashMap<>();

        // 默认令牌不活跃
        response.put("active", false);

        // 尝试作为JWT访问令牌查询
        if ("access_token".equals(tokenTypeHint) || tokenTypeHint == null) {
            try {
                LoginInfo loginInfo = jwtService.verifyJwt(token, LoginInfo.class);
                if (loginInfo != null) {
                    response.put("active", true);
                    response.put("user_code", loginInfo.getUserCode());
                    response.put("user_name", loginInfo.getUserName());
                    response.put("enterprise_id", loginInfo.getEnterpriseId());
                    response.put("token_type", "Bearer");

                    if (loginInfo.getExpiredTime() != null) {
                        response.put("exp", loginInfo.getExpiredTime() / 1000); // expiration (Unix timestamp)
                    }

                    response.put("sub", loginInfo.getUserCode()); // subject
                    response.put("aud", loginInfo.getUserCode()); // audience
                    response.put("iss", "ByaiManager"); // issuer

                    logger.info("Token introspection - JWT access token active for user_code: {}",
                        loginInfo.getUserCode());
                    return response;
                }
            }
            catch (Exception e) {
                logger.debug("Token is not a valid JWT access token: {}", e.getMessage());
            }
        }

        // 尝试作为刷新令牌查询
        if ("refresh_token".equals(tokenTypeHint)
            || (tokenTypeHint == null && !Boolean.TRUE.equals(response.get("active")))) {
            String refreshTokenKey = REFRESH_TOKEN_PREFIX + token;
            String jsonData = RedisUtil.getString(refreshTokenKey);

            if (jsonData != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> tokenData = JsonUtil.parseObject(jsonData, Map.class);
                if (tokenData != null) {
                    response.put("active", true);
                    String clientId = MapUtils.getString(tokenData, "client_id");
                    Long userId = MapUtils.getLong(tokenData, "user_id");
                    response.put("client_id", clientId);
                    response.put("user_id", userId);
                    response.put("scope", MapUtils.getString(tokenData, "scope"));
                    response.put("token_type", "refresh_token");

                    Long createdTime = MapUtils.getLong(tokenData, "created_time");

                    response.put("iat", createdTime / 1000);
                    response.put("exp", (createdTime + REFRESH_TOKEN_EXPIRES * 1000) / 1000);

                    response.put("sub", userId);
                    response.put("aud", clientId);
                    response.put("iss", "ByaiManager");

                    logger.info("Token introspection - refresh token active for client_id: {}, user_id: {}", clientId,
                        userId);
                    return response;
                }
            }
        }

        logger.info("Token introspection - token not active or not found");
        return response;
    }
}
