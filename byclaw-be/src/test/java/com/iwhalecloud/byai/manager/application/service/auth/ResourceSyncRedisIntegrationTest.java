package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.util.RedisUtil;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;

class ResourceSyncRedisIntegrationTest {
    @Test @EnabledIfEnvironmentVariable(named="BYCLAW_TEST_REDIS_PORT",matches="[0-9]+")
    void standaloneKeepsUnrelatedPermissionsAndExpiration() {
        verify(new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1",Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT")))));
    }
    @Test @EnabledIfEnvironmentVariable(named="BYCLAW_TEST_REDIS_CLUSTER_PORT",matches="[0-9]+")
    void realClusterUpdatesDifferentUserSlotsWithoutCrossSlotOrClosingSharedConnections() {
        verify(new JedisConnectionFactory(new RedisClusterConfiguration(List.of("127.0.0.1:"+System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")))));
    }
    private void verify(JedisConnectionFactory factory) {
        factory.afterPropertiesSet(); factory.start();
        var template = new StringRedisTemplate(factory);
        var original = ReflectionTestUtils.getField(RedisUtil.class,"instance");
        var util = new RedisUtil(); ReflectionTestUtils.setField(util,"stringRedisTemplate",template);
        ReflectionTestUtils.setField(RedisUtil.class,"instance",util);
        var service = new AuthRedisApplicationService();
        List<Long> users=List.of(991001L,991002L,991003L);
        try {
            for (Long user:users) {
                String key=service.getUserAuthKey(user);
                template.opsForHash().put(key,"unrelated","KG_DOC"); template.expire(key,Duration.ofMinutes(1));
                service.writeResourceAuth(user,101L,"SKILL",true);
                service.writeResourceAuth(user,102L,"TOOLKIT",true);
                service.writeResourceAuth(user,101L,"SKILL",false);
                service.writeResourceAuth(user,101L,"SKILL",false); // Retry is idempotent.
                assertThat(template.opsForHash().entries(key)).containsEntry("unrelated","KG_DOC").containsEntry("102","TOOLKIT").doesNotContainKey("101");
                assertThat(template.getExpire(key)).isBetween(1L,60L);
            }
            assertThat(template.opsForHash().get(service.getUserAuthKey(users.get(0)),"102")).isEqualTo("TOOLKIT");
        } finally {
            users.forEach(id->template.delete(service.getUserAuthKey(id)));
            ReflectionTestUtils.setField(RedisUtil.class,"instance",original); factory.destroy();
        }
    }
}
