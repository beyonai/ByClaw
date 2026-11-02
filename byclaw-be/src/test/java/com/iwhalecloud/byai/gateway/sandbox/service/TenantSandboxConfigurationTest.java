package com.iwhalecloud.byai.gateway.sandbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformTenantFileRouting;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class TenantSandboxConfigurationTest {
    private ApplicationContextRunner context() {
        return new ApplicationContextRunner()
            .withBean(SandboxLifecycleFacade.class, () -> mock(SandboxLifecycleFacade.class))
            .withBean(OpenSandboxClient.class, () -> mock(OpenSandboxClient.class))
            .withBean(SandboxServiceSpecRepository.class, () -> mock(SandboxServiceSpecRepository.class))
            .withBean(SsSandboxRecordMapper.class, () -> mock(SsSandboxRecordMapper.class))
            .withBean(TenantAdminTenantMapper.class, () -> mock(TenantAdminTenantMapper.class))
            .withBean(PlatformTenantFileRouting.class, () -> mock(PlatformTenantFileRouting.class))
            .withBean(ObjectMapper.class, ObjectMapper::new)
            .withBean(com.iwhalecloud.byai.manager.domain.tenant.TenantRuntimeIdentity.class,
                () -> new com.iwhalecloud.byai.manager.domain.tenant.TenantRuntimeIdentity("fixture-deployment-secret-at-least-32-bytes"))
            .withBean(TenantSandboxService.class);
    }

    @Test void resolvedSharedRedisPropertiesWinWithoutTenantOrImageOverrides() {
        context().withPropertyValues("REDIS_HOST=unused", "REDIS_PORT=6379",
            "spring.redis.host=shared-redis", "spring.redis.port=6380", "spring.redis.database=2",
            "spring.redis.username=shared-user", "spring.redis.password=fixture-password")
            .run(c -> {
                assertThat(c).hasNotFailed();
                var service = c.getBean(TenantSandboxService.class);
                assertThat(ReflectionTestUtils.getField(service, "redisHost")).isEqualTo("shared-redis");
                assertThat(ReflectionTestUtils.getField(service, "redisPort")).isEqualTo("6380");
                assertThat(ReflectionTestUtils.getField(service, "redisDatabase")).isEqualTo("2");
                assertThat(ReflectionTestUtils.getField(service, "redisUsername")).isEqualTo("shared-user");
                assertThat(ReflectionTestUtils.getField(service, "redisPassword")).isEqualTo("fixture-password");
            });
    }

    @Test void sharedEnvironmentFallbackUsesTheSameRedisEndpoint() {
        context().withPropertyValues("REDIS_HOST=redis-from-env", "REDIS_PORT=6381",
            "REDIS_DATABASE=3", "REDIS_USERNAME=default", "REDIS_PASSWORD=fixture-password")
            .run(c -> {
                assertThat(c).hasNotFailed();
                var service = c.getBean(TenantSandboxService.class);
                assertThat(ReflectionTestUtils.getField(service, "redisHost")).isEqualTo("redis-from-env");
                assertThat(ReflectionTestUtils.getField(service, "redisPort")).isEqualTo("6381");
                assertThat(ReflectionTestUtils.getField(service, "redisDatabase")).isEqualTo("3");
            });
    }
}
