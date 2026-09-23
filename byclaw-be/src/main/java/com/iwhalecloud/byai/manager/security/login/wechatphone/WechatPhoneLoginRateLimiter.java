package com.iwhalecloud.byai.manager.security.login.wechatphone;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;

/** 共享 Redis 窗口限制匿名微信手机号登录请求。 */
@Component
public class WechatPhoneLoginRateLimiter {

    private static final DefaultRedisScript<Long> INCREMENT = new DefaultRedisScript<>(
        "local count = redis.call('incr', KEYS[1]); "
            + "if count == 1 then redis.call('expire', KEYS[1], 60) end; return count", Long.class);
    private static final String KEY_PREFIX = "byai:wechat:phone-login:rate:";

    private final StringRedisTemplate redis;
    private final int maxPerMinute;

    @Autowired
    public WechatPhoneLoginRateLimiter(StringRedisTemplate redis,
        @Value("${wechat.miniapp.login-rate-limit-per-minute:300}") int maxPerMinute) {
        this.redis = redis;
        this.maxPerMinute = maxPerMinute;
    }

    public void check(String clientAddress) {
        if (maxPerMinute <= 0) {
            throw new AuthenticationServiceException("微信手机号登录暂不可用");
        }
        Long count;
        try {
            count = redis.execute(INCREMENT, Collections.singletonList(key(clientAddress)));
        } catch (RuntimeException e) {
            throw new AuthenticationServiceException("微信手机号登录暂不可用");
        }
        if (count == null || count <= 0) {
            throw new AuthenticationServiceException("微信手机号登录暂不可用");
        }
        if (count > maxPerMinute) {
            throw new BadCredentialsException("微信手机号登录请求过于频繁");
        }
    }

    private String key(String address) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(String.valueOf(address).getBytes(StandardCharsets.UTF_8));
            return KEY_PREFIX + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new AuthenticationServiceException("微信手机号登录暂不可用");
        }
    }
}
