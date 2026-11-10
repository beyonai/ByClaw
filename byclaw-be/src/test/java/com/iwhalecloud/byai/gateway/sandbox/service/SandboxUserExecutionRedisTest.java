package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostContexts;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.domain.chat.service.SystemParamTargetAgentResolver;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/** Opt-in ports must belong to disposable loopback Redis instances, never application Redis. */
@Timeout(30)
class SandboxUserExecutionRedisTest {

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
    void legacyHostRoutingPreservesMarkersAndReleasesLaunchLocksOnStandalone() {
        verifyRouting(new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1",
            Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT")))));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_CLUSTER_PORT", matches = "[0-9]+")
    void legacyHostRoutingPreservesMarkersAndReleasesLaunchLocksOnCluster() {
        verifyRouting(new JedisConnectionFactory(new RedisClusterConfiguration(List.of(
            "127.0.0.1:" + System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")))));
    }

    private void verifyRouting(JedisConnectionFactory connection) {
        Object previous = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        connection.afterPropertiesSet();
        StringRedisTemplate redis = new StringRedisTemplate(connection);
        RedisUtil util = new RedisUtil();
        ReflectionTestUtils.setField(util, "stringRedisTemplate", redis);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", util);
        String prefix = "execution-test-" + UUID.randomUUID();
        String mappedUser = prefix + "-mapped";
        String defaultUser = prefix + "-default";
        String independentUser = prefix + "-independent";
        List<String> markers = List.of(marker(mappedUser), marker(defaultUser), marker(independentUser));
        List<String> locks = List.of(lock(mappedUser, "user-tools"), lock(defaultUser, "configured-tools"),
            lock(independentUser, "byclaw-dsh"));
        SandboxService service = localService(mappedUser);
        try {
            redis.opsForValue().set(marker(mappedUser), "shared-host-a", Duration.ofMinutes(2));
            redis.opsForValue().set(marker(defaultUser), "shared-host-b", Duration.ofMinutes(2));

            // Real RedisUtil GET, lock SET and owner-checked Lua release run for each request.
            for (int attempt = 0; attempt < 2; attempt++) {
                assertThat(service.launchUserExecutionSandbox(mappedUser).getSandboxId()).isEqualTo("existing-user-tools");
                assertThat(service.launchUserExecutionSandbox(defaultUser).getSandboxId()).isEqualTo("existing-configured-tools");
                assertThat(service.launchUserExecutionSandbox(independentUser).getSandboxId()).isEqualTo("existing-byclaw-dsh");
            }

            assertThat(redis.opsForValue().get(marker(mappedUser))).isEqualTo("shared-host-a");
            assertThat(redis.opsForValue().get(marker(defaultUser))).isEqualTo("shared-host-b");
            assertThat(redis.getExpire(marker(mappedUser))).isBetween(1L, 120L);
            assertThat(redis.getExpire(marker(defaultUser))).isBetween(1L, 120L);
            assertThat(redis.hasKey(marker(independentUser))).isFalse();
            locks.forEach(key -> assertThat(redis.hasKey(key)).isFalse());

            // A removed legacy announcement must stop selecting tools on the next request.
            redis.delete(marker(mappedUser));
            assertThat(service.launchUserExecutionSandbox(mappedUser).getSandboxId()).isEqualTo("existing-byclaw-dsh");
            assertThat(redis.hasKey(lock(mappedUser, "byclaw-dsh"))).isFalse();
        }
        finally {
            // Individual deletes are valid even when the random user keys occupy different cluster slots.
            markers.forEach(redis::delete);
            locks.forEach(redis::delete);
            redis.delete(lock(mappedUser, "byclaw-dsh"));
            ReflectionTestUtils.setField(RedisUtil.class, "instance", previous);
            connection.destroy();
        }
    }

    private SandboxService localService(String mappedUser) {
        SandboxService service = new SandboxService();
        ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn(mappedUser + "=user-tools");
        SandboxProperties properties = new SandboxProperties();
        properties.getSharedDshHost().setToolServiceKey("configured-tools");
        ReflectionTestUtils.setField(service, "byaiSystemConfigService", config);
        ReflectionTestUtils.setField(service, "systemParamTargetAgentResolver",
            new SystemParamTargetAgentResolver(config, mock(UserPrivateParamCacheReader.class), null));
        ReflectionTestUtils.setField(service, "sandboxProperties", properties);
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<PlatformRemoteGateway> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(gateway);
        when(gateway.isRemote()).thenReturn(false);
        ReflectionTestUtils.setField(service, "platformGatewayProvider", provider);
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", records);
        ReflectionTestUtils.setField(service, "sandboxMetadataCache", mock(SandboxMetadataCache.class));
        when(records.selectActiveByUserAndResource(anyString(), anyString(), eq(-1L))).thenAnswer(call -> {
            SsSandboxRecord record = new SsSandboxRecord();
            record.setId(1L);
            record.setUserCode(call.getArgument(0));
            record.setSandboxType(call.getArgument(1));
            record.setResourceId(-1L);
            record.setSandboxId("existing-" + call.getArgument(1));
            record.setStatus("RUNNING");
            record.setEndpoint("http://sandbox.example.test/chat");
            return record;
        });
        return service;
    }

    private static String marker(String user) {
        return SandboxService.SHARED_DSH_HOST_KEY_PREFIX + user;
    }

    private static String lock(String user, String type) {
        return "sandbox:launch:lock:" + user + ":" + type + ":-1";
    }
}
