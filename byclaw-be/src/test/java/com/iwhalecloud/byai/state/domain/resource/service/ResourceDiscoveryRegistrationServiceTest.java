package com.iwhalecloud.byai.state.domain.resource.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.test.util.ReflectionTestUtils;

class ResourceDiscoveryRegistrationServiceTest {

    @Test
    @SuppressWarnings("unchecked")
    void cleanupRegistryKeys_usesSpringRedisTemplateForClusterConnections() {
        ResourceDiscoveryRegistrationService service = new ResourceDiscoveryRegistrationService();
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        HashOperations<String, Object, Object> hashOperations = mock(HashOperations.class);
        ZSetOperations<String, String> zSetOperations = mock(ZSetOperations.class);
        SetOperations<String, String> setOperations = mock(SetOperations.class);
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        when(hashOperations.entries("byai_gateway:sd:instances:resource-service"))
            .thenReturn(Map.of("instance-1", "{}"));
        ReflectionTestUtils.setField(service, "stringRedisTemplate", redisTemplate);

        ReflectionTestUtils.invokeMethod(service, "cleanupRegistryKeys", "resource-service");

        verify(hashOperations).entries("byai_gateway:sd:instances:resource-service");
        verify(hashOperations).delete("byai_gateway:sd:instances:resource-service", "instance-1");
        verify(zSetOperations).remove("byai_gateway:sd:active:resource-service", "instance-1");
        verify(redisTemplate).delete("byai_gateway:sd:instances:resource-service");
        verify(redisTemplate).delete("byai_gateway:sd:active:resource-service");
        verify(setOperations).remove("byai_gateway:sd:services", "resource-service");
    }
}
