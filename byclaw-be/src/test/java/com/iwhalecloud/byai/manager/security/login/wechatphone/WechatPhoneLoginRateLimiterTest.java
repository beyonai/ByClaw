package com.iwhalecloud.byai.manager.security.login.wechatphone;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;

class WechatPhoneLoginRateLimiterTest {

    @Test
    void stopsExcessiveAnonymousAttemptsBeforePhoneExchange() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class), anyList()))
            .thenReturn(31L);
        WechatPhoneLoginRateLimiter limiter = new WechatPhoneLoginRateLimiter(redis, 30);

        assertThatThrownBy(() -> limiter.check("192.0.2.1"))
            .isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void failsClosedWhenSharedRateLimitStorageIsUnavailable() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class), anyList()))
            .thenThrow(new IllegalStateException("private redis details"));
        WechatPhoneLoginRateLimiter limiter = new WechatPhoneLoginRateLimiter(redis, 30);

        assertThatThrownBy(() -> limiter.check("192.0.2.1"))
            .isInstanceOf(AuthenticationServiceException.class)
            .hasMessageNotContaining("private redis details");
    }
}
