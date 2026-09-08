package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class ConnectorCredentialRenewalLeaseServiceTest {
    @Test
    @SuppressWarnings("unchecked")
    void onlyOneCompetitorAcquiresAndOwnerOnlyReleaseAllowsReacquire() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class)))
            .thenReturn(true, false, true);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(), anyString()))
            .thenReturn(0L, 1L);
        ConnectorCredentialRenewalLeaseService service = new ConnectorCredentialRenewalLeaseService(redis);

        var owner = service.tryAcquire(9L);
        assertThat(owner).isPresent();
        assertThat(service.tryAcquire(9L)).isEmpty();
        assertThat(service.release(new ConnectorCredentialRenewalLeaseService.Lease(9L, "not-owner"))).isFalse();
        assertThat(service.release(owner.orElseThrow())).isTrue();
        assertThat(service.tryAcquire(9L)).isPresent();
        var keys = org.mockito.ArgumentCaptor.forClass(String.class);
        var tokens = org.mockito.ArgumentCaptor.forClass(String.class);
        var ttl = org.mockito.ArgumentCaptor.forClass(Duration.class);
        verify(values, org.mockito.Mockito.times(3)).setIfAbsent(keys.capture(), tokens.capture(), ttl.capture());
        assertThat(keys.getAllValues()).containsOnly("byai:connector:credential-renewal:9");
        assertThat(ttl.getAllValues()).containsOnly(Duration.ofSeconds(120));
        assertThat(tokens.getAllValues()).doesNotHaveDuplicates();
        tokens.getAllValues().forEach(token -> assertThatCode(() -> java.util.UUID.fromString(token))
            .doesNotThrowAnyException());
    }

    @Test
    @SuppressWarnings("unchecked")
    void distinguishesRedisBackendFailureFromBusyLease() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class)))
            .thenThrow(new IllegalStateException("redis secret details"));
        ConnectorCredentialRenewalLeaseService service = new ConnectorCredentialRenewalLeaseService(redis);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.tryAcquire(9L))
            .isInstanceOf(ConnectorCredentialRenewalLeaseUnavailableException.class)
            .hasMessageNotContaining("redis secret details");
    }
}
