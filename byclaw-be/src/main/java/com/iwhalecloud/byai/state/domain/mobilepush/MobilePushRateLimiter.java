package com.iwhalecloud.byai.state.domain.mobilepush;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** 复用现有 Redis，以单键 SET NX + TTL 协调所有后端实例，无需限速数据库表。 */
@Component
public class MobilePushRateLimiter {
    private static final Logger LOG = LoggerFactory.getLogger(MobilePushRateLimiter.class);
    private static final Duration SLOT_DURATION = Duration.ofMillis(100);
    private final StringRedisTemplate redis;
    private final MobilePushProperties properties;
    private final AtomicBoolean failureReported = new AtomicBoolean();

    public MobilePushRateLimiter(StringRedisTemplate redis, MobilePushProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    /** 获取一次发送机会，靠 TTL 自动释放，不持有需要解锁的分布式锁。 */
    public boolean acquire() {
        return reserve("byclaw:mobile-push:rate:{" + properties.getSdkAppId() + "}", SLOT_DURATION);
    }

    /** 仅在通知专用线程短等限速槽；最多十个 100ms 间隔，Redis IO 沿用客户端超时，不重试厂商请求。 */
    public boolean awaitSlot() {
        for (int attempt = 0; attempt <= 10; attempt += 1) {
            if (Thread.currentThread().isInterrupted()) {
                return false;
            }
            if (acquire()) {
                return true;
            }
            if (failureReported.get() || attempt == 10) {
                return false;
            }
            try {
                Thread.sleep(SLOT_DURATION.toMillis());
            } catch (InterruptedException failure) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    /** 重复广播短期内只尝试一次；去重键仅含摘要，不保存设备 token 或消息正文。 */
    public boolean firstAttempt(String notificationId) {
        if (notificationId == null || !notificationId.matches("[0-9a-f]{64}")) {
            return false;
        }
        return reserve("byclaw:mobile-push:dedup:{" + properties.getSdkAppId() + "}:" + notificationId,
            Duration.ofMinutes(10));
    }

    private boolean reserve(String key, Duration duration) {
        if (properties.getSdkAppId() <= 0) {
            return false;
        }
        try {
            // 腾讯额度按 SDKAppID 共享；同一应用的不同环境不能各自获得一份额度。
            // 仅操作一个带 hash tag 的键，单机与 Cluster 均走项目现有客户端路由。
            Boolean acquired = redis.opsForValue().setIfAbsent(key, "1", duration);
            if (acquired == null) {
                reportUnavailable();
                return false;
            }
            if (failureReported.getAndSet(false)) {
                LOG.info("Mobile push Redis rate limiter recovered, sdkAppId={}", properties.getSdkAppId());
            }
            return acquired;
        } catch (RuntimeException failure) {
            // 禁止退回进程内限速或绕过门禁；连接异常可能携带地址信息，不输出原始异常。
            reportUnavailable();
            return false;
        }
    }

    private void reportUnavailable() {
        if (failureReported.compareAndSet(false, true)) {
            LOG.warn("Mobile push Redis unavailable; attempt skipped, sdkAppId={}",
                properties.getSdkAppId());
        }
    }
}
