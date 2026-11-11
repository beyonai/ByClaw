package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.common.RedisConnectionConfig;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceDiscoveryRegistrationService;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.parallel.ResourceLock;
import org.junit.jupiter.api.parallel.Resources;
import org.springframework.test.util.ReflectionTestUtils;
import redis.clients.jedis.HostAndPort;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.commands.JedisCommands;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.Mockito.mock;

/** Use disposable local Redis instances, as in RedisUtilPrefixIntegrationTest. */
@ResourceLock(Resources.SYSTEM_PROPERTIES)
class ServiceDiscoveryRedisIntegrationTest {

    private static final String HOST = "127.0.0.1";
    private static final String SCHEMA_PROPERTY = "REDIS_KEY_SCHEMA_VERSION";

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
    void replacesAndUnregistersEndpointsOnStandalone() {
        verifyLifecycle(this::standaloneClient, "v1");
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
    void replacesAndUnregistersEndpointsOnStandaloneV2() {
        verifyLifecycle(this::standaloneClient, "v2");
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_CLUSTER_PORT", matches = "[0-9]+")
    void replacesAndUnregistersEndpointsOnClusterV2() {
        RedisConnectionConfig config = new RedisConnectionConfig();
        config.setMode(RedisConnectionConfig.Mode.CLUSTER);
        config.setClusterNodes(List.of(new HostAndPort(HOST,
            Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")))));
        config.setTimeout(2000);
        verifyLifecycle(() -> new RedisClient(config), "v2");
    }

    private RedisClient standaloneClient() {
        return new RedisClient(HOST, Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT")));
    }

    private void verifyLifecycle(Supplier<RedisClient> connect, String schema) {
        String previousSchema = System.setProperty(SCHEMA_PROPERTY, schema);
        try {
            RedisClient client = connect.get();
            try {
                JedisCommands commands = client.getCommands();
                try {
                    assertAll(
                        () -> verifySandbox(client, commands),
                        () -> verifyResource(client, commands));
                }
                finally {
                    if (commands instanceof Jedis borrowed) {
                        borrowed.close();
                    }
                }
            }
            finally {
                client.close();
            }
        }
        finally {
            if (previousSchema == null) {
                System.clearProperty(SCHEMA_PROPERTY);
            }
            else {
                System.setProperty(SCHEMA_PROPERTY, previousSchema);
            }
        }
    }

    private void verifySandbox(RedisClient client, JedisCommands commands) {
        SandboxService sandbox = new SandboxService();
        ReflectionTestUtils.setField(sandbox, "redisClient", client);
        ReflectionTestUtils.setField(sandbox, "sandboxServiceSpecRepository", mock(SandboxServiceSpecRepository.class));
        String user = "registry-it-" + UUID.randomUUID();
        SandboxLaunchRouting routing = new SandboxLaunchRouting("openclaw", -1L);
        verifyRegistry(client, commands, "BYCLAW_EXE_" + user, "sandbox.example.test",
            () -> ReflectionTestUtils.invokeMethod(sandbox, "registerSandboxEndpoint", user, routing,
                "http://sandbox.example.test:8080", null),
            () -> ReflectionTestUtils.invokeMethod(sandbox, "unregisterSandboxEndpoint", user, "openclaw", null));
    }

    private void verifyResource(RedisClient client, JedisCommands commands) {
        ResourceDiscoveryRegistrationService resource = new ResourceDiscoveryRegistrationService();
        ReflectionTestUtils.setField(resource, "redisClient", client);
        String service = "resource-registry-it-" + UUID.randomUUID();
        String target = """
            {"domainName":"%s","domainURL":"http://resource.example.test:8080"}
            """.formatted(service);
        try {
            verifyRegistry(client, commands, service, "resource.example.test",
                () -> resource.registerAfterCommit("test", 1L, "resource", target),
                () -> resource.unregisterAfterCommit("test", 1L, "resource", target));
        }
        finally {
            resource.shutdown();
        }
    }

    private void verifyRegistry(RedisClient client, JedisCommands commands, String service, String expectedHost,
        Runnable register, Runnable unregister) {
        String details = Constants.RegistryKeys.sdInstanceDetails(service);
        String active = Constants.RegistryKeys.sdActiveInstances(service);
        String services = Constants.RegistryKeys.sdServices();
        DiscoveryClient discovery = new DiscoveryClient(client);
        commands.hset(details, "stale", "{}");
        commands.zadd(active, 1, "stale");
        commands.sadd(services, service);
        try {
            register.run();
            var ids = commands.hkeys(details);
            assertThat(ids).hasSize(1).doesNotContain("stale");
            assertThat(commands.zrange(active, 0, -1)).containsExactlyElementsOf(ids);
            assertThat(commands.sismember(services, service)).isTrue();
            assertThat(discovery.getInstances(service)).extracting(ServiceInstance::getHost).containsExactly(expectedHost);

            unregister.run();
            assertThat(commands.exists(details)).isFalse();
            assertThat(commands.exists(active)).isFalse();
            assertThat(commands.sismember(services, service)).isFalse();
            discovery.refreshService(service, 30_000);
            assertThat(discovery.getInstances(service)).isEmpty();
        }
        finally {
            discovery.close();
            commands.del(details);
            commands.del(active);
            commands.srem(services, service);
        }
    }
}
