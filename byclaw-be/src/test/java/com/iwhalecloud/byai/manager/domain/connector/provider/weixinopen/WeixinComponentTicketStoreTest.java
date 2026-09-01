package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;

class WeixinComponentTicketStoreTest {

    @Test
    void atomicallyStoresOnlyEncryptedTicketMaterialInRedis() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        when(redisTemplate.execute(any(RedisScript.class), any(List.class), any(), any(), any()))
            .thenReturn(1L);
        WeixinComponentTicketStore store = new WeixinComponentTicketStore(redisTemplate);

        assertThat(store.saveIfNewer("wx-component", "verify-ticket", 100L)).isTrue();

        ArgumentCaptor<String> cipherCaptor = ArgumentCaptor.forClass(String.class);
        verify(redisTemplate).execute(
            any(RedisScript.class),
            eq(List.of("byclaw:weixin-open-platform:ticket:{wx-component}")),
            eq("100"), cipherCaptor.capture(), any(String.class));
        assertThat(cipherCaptor.getValue()).doesNotContain("verify-ticket");
        assertThat(Sm4Util.decrypt(cipherCaptor.getValue())).isEqualTo("verify-ticket");
    }

    @Test
    void ignoresDuplicateOrOlderTicketEvents() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        when(redisTemplate.execute(any(RedisScript.class), any(List.class), any(), any(), any()))
            .thenReturn(0L);
        WeixinComponentTicketStore store = new WeixinComponentTicketStore(redisTemplate);

        assertThat(store.saveIfNewer("wx-component", "old-ticket", 100L)).isFalse();
    }

    @Test
    void decryptsTheCurrentTicketFromRedis() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        HashOperations<String, Object, Object> hashOperations = mock(HashOperations.class);
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(
            "byclaw:weixin-open-platform:ticket:{wx-component}", "verify_ticket_cipher"))
            .thenReturn(Sm4Util.encrypt("new-ticket"));
        WeixinComponentTicketStore store = new WeixinComponentTicketStore(redisTemplate);

        assertThat(store.findCurrent("wx-component")).contains("new-ticket");
    }
}
