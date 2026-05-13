package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxSpecProcessor;

class StandardSandboxLifecycleServiceTest {

    private StringRedisTemplate redisTemplate;
    private ValueOperations<String, String> valueOperations;
    private SetOperations<String, String> setOperations;
    private ZSetOperations<String, String> zSetOperations;
    private SandboxServiceSpecRepository specRepository;
    private SandboxSpecProcessor specProcessor;
    private SandboxRuntimeProvider runtimeProvider;
    private StandardSandboxLifecycleService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redisTemplate = mock(StringRedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        setOperations = mock(SetOperations.class);
        zSetOperations = mock(ZSetOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);

        specRepository = mock(SandboxServiceSpecRepository.class);
        specProcessor = mock(SandboxSpecProcessor.class);
        runtimeProvider = mock(SandboxRuntimeProvider.class);
        when(runtimeProvider.providerType()).thenReturn("test");

        SandboxProperties properties = new SandboxProperties();
        properties.setHeartbeatTimeout(Duration.ofMinutes(5));

        service = new StandardSandboxLifecycleService(
            properties, redisTemplate, specRepository, specProcessor, runtimeProvider);
    }

    @Test
    void launchSandbox_returnsCachedEndpointWithoutCallingProvider() {
        String cacheKey = "byai:worker:sandbox:user001:openclaw";
        when(valueOperations.get(cacheKey)).thenReturn(
            "{\"sandboxId\":\"sb-1\",\"userCode\":\"user001\",\"sandboxType\":\"openclaw\",\"endpoints\":[\"http://cached\"]}"
        );

        SandboxLaunchRequest request = new SandboxLaunchRequest();
        request.setUserCode("user001");
        request.setSandboxType("openclaw");

        var response = service.launchSandbox(request);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData().getEndpoint()).isEqualTo("http://cached");
        verify(runtimeProvider, never()).create(any(), any(), any(), any(), any());
    }

    @Test
    void launchSandbox_buildsRequestAndPersistsWhenCacheMiss() {
        String cacheKey = "byai:worker:sandbox:user001:openclaw";
        String lockKey = cacheKey + ":create-lock";

        when(valueOperations.get(cacheKey)).thenReturn(null);
        when(valueOperations.setIfAbsent(any(), any(), any())).thenReturn(true);
        when(valueOperations.get(lockKey)).thenReturn("lock-token-mismatch");

        SandboxServiceSpec spec = new SandboxServiceSpec();
        when(specRepository.findByServiceKey("openclaw")).thenReturn(java.util.Optional.of(spec));

        CreateSandboxRequest createRequest = CreateSandboxRequest.builder()
            .env(Map.of("KEY", "VALUE"))
            .timeout(300)
            .build();
        when(specProcessor.buildCreateRequest("user001", "openclaw", null, null, spec)).thenReturn(createRequest);
        when(runtimeProvider.findReusable("user001", "openclaw")).thenReturn(java.util.Optional.empty());
        SandboxRuntimeInstance createdInstance = SandboxRuntimeInstance.builder()
            .sandboxId("sb-2")
            .endpoints(List.of("http://created"))
            .build();
        when(runtimeProvider.create(eq(createRequest), eq(spec), eq("user001"), eq("openclaw"), any()))
            .thenReturn(createdInstance);
        when(runtimeProvider.resolveEndpoints(eq(createdInstance), eq(spec), eq(createRequest)))
            .thenReturn(List.of("http://created"));

        SandboxLaunchRequest request = new SandboxLaunchRequest();
        request.setUserCode("user001");
        request.setSandboxType("openclaw");

        var response = service.launchSandbox(request);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData().getEndpoint()).isEqualTo("http://created");
        verify(runtimeProvider).create(any(), any(), any(), any(), any());
        verify(valueOperations).set(any(), any(), any(Long.class), any());
    }
}
