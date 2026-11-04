package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatGatewayCredentialService;
import java.time.Duration;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/** 在独立测试 Redis 上验证共享字符串契约；不使用生产连接或改写已有业务键。 */
class GroupChatGatewayCredentialRedisIntegrationTest {
    @Test
    void readsTheSharedCredentialAndFallsBackOnStandaloneRedis() {
        String port = System.getenv("BYCLAW_TEST_REDIS_PORT");
        Assumptions.assumeTrue(port != null && !port.isBlank(), "Requires BYCLAW_TEST_REDIS_PORT");
        verifyCredentialReads(new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1", Integer.parseInt(port))));
    }

    @Test
    void readsIndependentMemberKeysAndFallsBackOnRealRedisCluster() {
        String nodes = System.getenv("BYCLAW_TEST_REDIS_CLUSTER_NODES");
        Assumptions.assumeTrue(nodes != null && !nodes.isBlank(), "Requires BYCLAW_TEST_REDIS_CLUSTER_NODES");
        verifyCredentialReads(new JedisConnectionFactory(new RedisClusterConfiguration(Arrays.asList(nodes.split(",")))));
    }

    /** 每次只读一个成员键，跨槽成员无需多键命令，也不刷新缓存 TTL。 */
    private void verifyCredentialReads(JedisConnectionFactory factory) {
        factory.afterPropertiesSet();
        StringRedisTemplate redis = new StringRedisTemplate(factory);
        Map<Long, String> keys = new HashMap<>();
        LoginInfo login = new LoginInfo();
        login.setUserId(20L);
        CurrentUserHolder.setLoginInfo(login);
        try {
            for (int index = 0; index < 3; index++) {
                long memberId = (UUID.randomUUID().getMostSignificantBits() & Long.MAX_VALUE) | 1L;
                String key = "hacu:tokensaver:binding:v1:API_KEY:" + memberId;
                keys.put(memberId, key);
                // 共享 API_KEY 投影使用无效的测试凭据，不调用模型。
                String binding = "{\"resourceId\":\"" + memberId
                    + "\",\"resourceType\":\"API_KEY\",\"tokenSaverCode\":\"redis-test-key\",\"tokenSaverExt\":null}";
                redis.opsForValue().set(key, binding, Duration.ofSeconds(60));
                ByaiSessionMemberMapper members = mock(ByaiSessionMemberMapper.class);
                when(members.findActiveUserMemberId(30L, 20L)).thenReturn(memberId);
                when(members.findActiveUserApiKey(30L, 20L)).thenReturn("database-test-key");
                GroupChatGatewayCredentialService service = new GroupChatGatewayCredentialService(
                    members, mock(TenantNodeClient.class), redis, new ObjectMapper());
                ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
                context.groupSessionId = 30L;
                Map<String, Object> params = new HashMap<>();
                service.apply(context, params);
                assertThat(params).containsEntry("api_key", "redis-test-key");
                verify(members, never()).findActiveUserApiKey(30L, 20L);
                assertThat(redis.opsForValue().get(key)).isEqualTo(binding);
                assertThat(redis.getExpire(key)).isBetween(1L, 60L);
                redis.delete(key);
                service.apply(context, params);
                assertThat(params).containsEntry("api_key", "database-test-key");
            }
        }
        finally {
            try {
                // 每个键单独删除，避免 Cluster 中随机成员键触发跨槽操作。
                keys.values().forEach(redis::delete);
            }
            finally {
                CurrentUserHolder.clearLoginInfo();
                factory.destroy();
            }
        }
    }
}
