package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class MailAccountProjectionLeaseServiceTest {
    @Test
    @SuppressWarnings("unchecked")
    void triggerAlwaysMarksDirtyAndAdvancesGenerationBeforeLeaseContention() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        SetOperations<String, String> sets = mock(SetOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(redis.opsForSet()).thenReturn(sets);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(), anyString()))
            .thenReturn(7L);
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(false);
        MailAccountProjectionLeaseService service = new MailAccountProjectionLeaseService(redis);

        assertThat(service.trigger(1001L)).isEqualTo(7L);
        assertThat(service.tryAcquire(1001L)).isEmpty();

        verify(redis).execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(),
            org.mockito.ArgumentMatchers.eq("1001"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void redisFailureIsTypedAndDoesNotPretendLeaseWasAcquired() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        SetOperations<String, String> sets = mock(SetOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(redis.opsForSet()).thenReturn(sets);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(), anyString()))
            .thenThrow(new IllegalStateException("backend details"));
        MailAccountProjectionLeaseService service = new MailAccountProjectionLeaseService(redis);

        assertThatThrownBy(() -> service.trigger(1001L))
            .isInstanceOf(MailAccountProjectionLeaseService.LeaseUnavailableException.class)
            .hasMessageNotContaining("backend details");
    }

    @Test
    @SuppressWarnings("unchecked")
    void renewFailsClosedWhenLeaseOwnerChanged() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(), anyString()))
            .thenReturn(0L);
        MailAccountProjectionLeaseService service = new MailAccountProjectionLeaseService(redis);

        assertThatThrownBy(() -> service.assertOwnedAndRenew(
                new MailAccountProjectionLeaseService.Lease(1001L, "old-owner")))
            .isInstanceOf(MailAccountProjectionLeaseService.LeaseLostException.class);
    }
}
