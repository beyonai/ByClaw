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
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class MailConnectionCheckLeaseServiceTest {

    @Test
    @SuppressWarnings("unchecked")
    void acquiresAccountScopedBoundedLeaseAndReleasesOnlyWithOwnerToken() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(true);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(), anyString()))
            .thenReturn(1L);
        MailConnectionCheckLeaseService service = new MailConnectionCheckLeaseService(redis);

        MailConnectionCheckLeaseService.Lease lease = service.tryAcquire(7001L).orElseThrow();

        verify(values).setIfAbsent(
            org.mockito.ArgumentMatchers.eq("byai:mail:connection-check:7001"),
            org.mockito.ArgumentMatchers.eq(lease.owner()),
            org.mockito.ArgumentMatchers.eq(Duration.ofSeconds(60)));
        assertThat(service.release(lease)).isTrue();
        verify(redis).execute(any(org.springframework.data.redis.core.script.RedisScript.class),
            org.mockito.ArgumentMatchers.eq(java.util.List.of("byai:mail:connection-check:7001")),
            org.mockito.ArgumentMatchers.eq(lease.owner()));
    }

    @Test
    @SuppressWarnings("unchecked")
    void contentionIsRejectedAndRedisFailureFailsClosedWithoutDetails() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class)))
            .thenReturn(false)
            .thenThrow(new IllegalStateException("redis-server-secret"));
        MailConnectionCheckLeaseService service = new MailConnectionCheckLeaseService(redis);

        assertThat(service.tryAcquire(7001L)).isEmpty();
        assertThatThrownBy(() -> service.tryAcquire(7001L))
            .isInstanceOf(MailConnectionCheckLeaseService.LeaseUnavailableException.class)
            .hasMessageNotContaining("redis-server-secret");
    }

    @Test
    @SuppressWarnings("unchecked")
    void renewProvesCurrentOwnerAtomicallyAndRejectsExpiredOrReplacedLease() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(),
            anyString(), anyString())).thenReturn(1L).thenReturn(0L);
        MailConnectionCheckLeaseService service = new MailConnectionCheckLeaseService(redis);
        MailConnectionCheckLeaseService.Lease lease =
            new MailConnectionCheckLeaseService.Lease(7001L, "original-owner");

        service.assertOwnedAndRenew(lease);
        assertThatThrownBy(() -> service.assertOwnedAndRenew(lease))
            .isInstanceOf(MailConnectionCheckLeaseService.LeaseLostException.class)
            .hasMessageNotContaining("original-owner");

        verify(redis, org.mockito.Mockito.times(2)).execute(
            any(org.springframework.data.redis.core.script.RedisScript.class),
            org.mockito.ArgumentMatchers.eq(java.util.List.of("byai:mail:connection-check:7001")),
            org.mockito.ArgumentMatchers.eq("original-owner"),
            org.mockito.ArgumentMatchers.eq("60000"));
    }
}
