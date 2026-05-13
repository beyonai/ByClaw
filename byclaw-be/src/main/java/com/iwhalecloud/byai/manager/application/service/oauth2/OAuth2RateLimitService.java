package com.iwhalecloud.byai.manager.application.service.oauth2;

import com.iwhalecloud.byai.common.util.RedisUtil;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.concurrent.TimeUnit;

/**
 * OAuth2速率限制服务 防止恶意请求和暴力攻击，基于Redis实现滑动窗口算法 支持按IP和客户端两个维度进行速率限制
 * 
 * @author AI Assistant
 * @version 1.0
 * @since 2024
 */
@Service
public class OAuth2RateLimitService {

    private static final Logger logger = LoggerFactory.getLogger(OAuth2RateLimitService.class);

    // Redis存储key前缀
    /** 速率限制存储前缀 */
    private static final String RATE_LIMIT_PREFIX = "oauth2:rate_limit:";

    // 默认限制配置（每分钟/每小时允许的请求次数）
    /** 授权请求速率限制：每分钟10次 */
    private static final int DEFAULT_AUTH_LIMIT = 10;

    /** 令牌请求速率限制：每分钟20次 */
    private static final int DEFAULT_TOKEN_LIMIT = 20;

    /** 客户端总体限制：每小时100次 */
    private static final int DEFAULT_CLIENT_LIMIT = 100;

    // 时间窗口配置
    /** IP级别时间窗口：1分钟 */
    private static final int WINDOW_SIZE_MINUTES = 1;

    /** 客户端级别时间窗口：1小时 */
    private static final int CLIENT_WINDOW_SIZE_HOURS = 1;

    /**
     * 检查授权请求速率限制 同时检查IP级别和客户端级别的速率限制
     * 
     * @param clientId 客户端ID
     * @param clientIp 客户端IP地址
     * @return true表示未超限可以继续，false表示超限需要拒绝
     */
    public boolean checkAuthorizationRateLimit(String clientId, String clientIp) {
        // 检查IP限制
        String ipKey = RATE_LIMIT_PREFIX + "auth:ip:" + clientIp;
        if (!checkRateLimit(ipKey, DEFAULT_AUTH_LIMIT, WINDOW_SIZE_MINUTES, TimeUnit.MINUTES)) {
            logger.warn("Authorization rate limit exceeded for IP: {}", clientIp);
            return false;
        }

        // 检查客户端限制
        String clientKey = RATE_LIMIT_PREFIX + "auth:client:" + clientId;
        if (!checkRateLimit(clientKey, DEFAULT_CLIENT_LIMIT, CLIENT_WINDOW_SIZE_HOURS, TimeUnit.HOURS)) {
            logger.warn("Authorization rate limit exceeded for client: {}", clientId);
            return false;
        }

        return true;
    }

    /**
     * 检查令牌请求速率限制
     */
    public boolean checkTokenRateLimit(String clientId, String clientIp) {
        // 检查IP限制
        String ipKey = RATE_LIMIT_PREFIX + "token:ip:" + clientIp;
        if (!checkRateLimit(ipKey, DEFAULT_TOKEN_LIMIT, WINDOW_SIZE_MINUTES, TimeUnit.MINUTES)) {
            logger.warn("Token rate limit exceeded for IP: {}", clientIp);
            return false;
        }

        // 检查客户端限制
        String clientKey = RATE_LIMIT_PREFIX + "token:client:" + clientId;
        if (!checkRateLimit(clientKey, DEFAULT_CLIENT_LIMIT, CLIENT_WINDOW_SIZE_HOURS, TimeUnit.HOURS)) {
            logger.warn("Token rate limit exceeded for client: {}", clientId);
            return false;
        }
        return true;
    }

    /**
     * 通用速率限制检查（滑动窗口算法）
     */
    private boolean checkRateLimit(String key, int limit, int windowSize, TimeUnit timeUnit) {
        try {
            // 获取当前计数
            String currentCountStr = RedisUtil.getString(key);
            Integer currentCount = null;

            if (currentCountStr != null) {
                try {
                    currentCount = Integer.parseInt(currentCountStr);
                }
                catch (NumberFormatException e) {
                    logger.warn("Invalid count format for key: {}, resetting to 0", key);
                    currentCount = 0;
                }
            }

            if (currentCount == null) {
                // 首次请求，设置计数为1
                RedisUtil.setString(key, "1", windowSize, timeUnit);
                return true;
            }

            if (currentCount >= limit) {
                // 超过限制
                return false;
            }

            // 增加计数
            RedisUtil.increment(key);
            return true;

        }
        catch (Exception e) {
            logger.error("Error checking rate limit for key: {}", key, e);
            // 出错时允许请求通过，避免影响正常业务
            return true;
        }
    }

}
