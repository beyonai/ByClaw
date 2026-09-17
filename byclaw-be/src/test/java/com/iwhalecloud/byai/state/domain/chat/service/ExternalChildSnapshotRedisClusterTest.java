package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.iwhalecloud.byai.state.common.redis.RedisConfig;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.test.util.ReflectionTestUtils;

/** The port must belong to a disposable local Redis Cluster. */
@EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_CLUSTER_PORT", matches = "[0-9]+")
class ExternalChildSnapshotRedisClusterTest {

    @Test
    void savesAndRecoversSnapshotsAndWatermarksAcrossClusterSlots() {
        var configuration = new RedisClusterConfiguration(List.of(
            "127.0.0.1:" + System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")));
        var factory = new JedisConnectionFactory(configuration);
        factory.afterPropertiesSet();
        var redis = new RedisConfig().redisTemplate(factory);
        var service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redis);
        try {
            var first = message(901L);
            var second = message(902L);
            assertThat(service.saveExternalChild(first, "123-4", false)).isTrue();
            assertThat(service.saveExternalChild(second, "123-4", false)).isTrue();
            service.markExternalChildPersisted(first);

            assertThat(service.findExternalChildSnapshots()).extracting(RunningChatSnapshotResponse::getSessionId)
                .contains(902L).doesNotContain(901L);
            assertThat(service.getExternalChildSnapshot(901L, 902L)).isNotNull();
        }
        finally {
            for (String key : List.of("byai:chat:running:external-child:index",
                    "byai:chat:running:snapshot:901:external-child-901",
                    "byai:chat:running:snapshot:902:external-child-902", "byai:chat:scoped:persisted:901:902")) {
                redis.delete(key);
            }
            factory.destroy();
        }
    }

    private static ByaiMessageHotDtoDto message(Long sessionId) {
        var message = new ByaiMessageHotDtoDto();
        message.setSessionId(sessionId);
        message.setMessageId(sessionId + 1);
        message.setMessageContent("child output");
        message.setMetadata("{\"event_stream_id\":\"123-4\"}");
        return message;
    }
}
