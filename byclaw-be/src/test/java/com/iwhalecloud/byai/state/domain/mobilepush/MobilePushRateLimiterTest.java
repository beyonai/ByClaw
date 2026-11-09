package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class MobilePushRateLimiterTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);
    private final MobilePushProperties properties = new MobilePushProperties();
    private final MobilePushRateLimiter limiter = new MobilePushRateLimiter(redis, properties);
    private final Duration slotDuration = Duration.ofMillis(100);

    @BeforeEach
    void configureRedis() {
        properties.setSdkAppId(123);
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test
    void onlyAtomicNxWithExpiryCanGrantTheSharedSlot() {
        String key = "byclaw:mobile-push:rate:{123}";
        when(values.setIfAbsent(key, "1", slotDuration)).thenReturn(true, false);
        assertThat(limiter.acquire()).isTrue();
        assertThat(limiter.acquire()).isFalse();
    }

    @Test
    void sameAppSharesQuotaAcrossEnvironmentsButDifferentAppsUseDifferentKeys() {
        when(values.setIfAbsent("byclaw:mobile-push:rate:{123}", "1", slotDuration))
            .thenReturn(true, false);
        when(values.setIfAbsent("byclaw:mobile-push:rate:{456}", "1", slotDuration)).thenReturn(true);
        assertThat(limiter.acquire()).isTrue();
        MobilePushProperties development = new MobilePushProperties();
        development.setSdkAppId(123);
        development.setEnvironmentId("development");
        assertThat(new MobilePushRateLimiter(redis, development).acquire()).isFalse();
        development.setSdkAppId(456);
        assertThat(new MobilePushRateLimiter(redis, development).acquire()).isTrue();
        verify(values).setIfAbsent("byclaw:mobile-push:rate:{456}", "1", slotDuration);
    }

    @Test
    void redisFailureAndUnknownResultNeverGrantQuotaAndRecoveryNeedsARealGrant() {
        when(values.setIfAbsent("byclaw:mobile-push:rate:{123}", "1", slotDuration))
            .thenThrow(new IllegalStateException("test connection failure"))
            .thenReturn(null, false, true);
        assertThat(limiter.acquire()).isFalse();
        assertThat(limiter.acquire()).isFalse();
        assertThat(limiter.acquire()).isFalse();
        assertThat(limiter.acquire()).isTrue();
    }

    @Test
    void missingAppNeverCreatesASharedFallbackKey() {
        properties.setSdkAppId(0);
        assertThat(limiter.acquire()).isFalse();
        verifyNoInteractions(values);
    }

    @Test
    void brieflyWaitsForSharedSlotButSkipsImmediatelyWhenRedisFails() {
        String key = "byclaw:mobile-push:rate:{123}";
        when(values.setIfAbsent(key, "1", slotDuration)).thenReturn(false, true);
        assertThat(limiter.awaitSlot()).isTrue();
        when(values.setIfAbsent(key, "1", slotDuration)).thenThrow(new IllegalStateException("test failure"));
        assertThat(limiter.awaitSlot()).isFalse();
    }

    @Test
    void shutdownInterruptionPreventsAnyFurtherRedisOrVendorWork() {
        Thread.currentThread().interrupt();
        try {
            assertThat(limiter.awaitSlot()).isFalse();
            verifyNoInteractions(values);
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void duplicateAttemptsShareOneExpiringMarkerWithoutStoringPayloads() {
        String notificationId = "a".repeat(64);
        String key = "byclaw:mobile-push:dedup:{123}:" + notificationId;
        when(values.setIfAbsent(key, "1", Duration.ofMinutes(10))).thenReturn(true, false);
        assertThat(limiter.firstAttempt(notificationId)).isTrue();
        assertThat(limiter.firstAttempt(notificationId)).isFalse();
        assertThat(limiter.firstAttempt("invalid")).isFalse();
    }
}
