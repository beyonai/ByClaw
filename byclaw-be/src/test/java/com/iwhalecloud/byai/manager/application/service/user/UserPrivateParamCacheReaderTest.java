package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

@ExtendWith(MockitoExtension.class)
class UserPrivateParamCacheReaderTest {

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    private UserPrivateParamCacheReader reader;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        reader = new UserPrivateParamCacheReader(redisTemplate, new ObjectMapper());
    }

    @Test
    void readsEnabledPersonalParameterFromExistingRedisPayload() {
        when(valueOperations.get("byai:user:private_params:user-a"))
            .thenReturn("{\"version\":1,\"params\":{\"ENABLE_DSH\":\" 1 \",\"GH_TOKEN\":\"secret\"}}");

        assertThat(reader.getValue(" user-a ", " enable_dsh ")).isEqualTo("1");
    }

    @Test
    void returnsMissingWhenCacheIsUnavailableOrMalformed() {
        when(valueOperations.get("byai:user:private_params:user-a"))
            .thenReturn("not-json")
            .thenThrow(new IllegalStateException("redis unavailable"));

        assertThat(reader.getValue("user-a", "ENABLE_DSH")).isNull();
        assertThat(reader.getValue("user-a", "ENABLE_DSH")).isNull();
        assertThat(reader.getValue(" ", "ENABLE_DSH")).isNull();
    }
}
