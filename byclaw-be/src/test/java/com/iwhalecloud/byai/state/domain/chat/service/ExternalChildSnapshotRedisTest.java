package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;

import java.time.Duration;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.TimeUnit;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.common.redis.RedisConfig;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

/** Run only against a disposable local Redis: BYCLAW_TEST_REDIS_PORT=... mvn test. */
@EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
class ExternalChildSnapshotRedisTest {

    private static final String INDEX = "byai:chat:running:external-child:index";

    private JedisConnectionFactory connectionFactory;
    private RedisTemplate<String, Object> redis;
    private RunningChatSnapshotService service;

    @BeforeEach
    void setUp() {
        connectionFactory = new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1",
            Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT"))));
        connectionFactory.afterPropertiesSet();
        redis = spy(new RedisConfig().redisTemplate(connectionFactory));
        try (var connection = connectionFactory.getConnection()) {
            connection.serverCommands().flushDb();
        }
        service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redis);
    }

    @AfterEach
    void tearDown() {
        connectionFactory.destroy();
    }

    @Test
    void sessionLookupStillFindsOtherRunningTurnAfterLatestTurnWasDeleted() {
        ChatProcessContext first = new ChatProcessContext(null, null);
        first.sessionId = 20L;
        first.traceId = "first-turn";
        first.modelAnswerMessageId = 21L;
        first.messageContext = new com.iwhalecloud.byai.state.domain.chat.model.MessageContext();
        first.messageContext.setMessageId(21L);
        ChatProcessContext second = new ChatProcessContext(null, null);
        second.sessionId = 20L;
        second.traceId = "second-turn";
        second.modelAnswerMessageId = 22L;
        second.messageContext = new com.iwhalecloud.byai.state.domain.chat.model.MessageContext();
        second.messageContext.setMessageId(22L);
        service.save(first);
        service.save(second);
        service.delete(second);
        assertThat(service.get(20L, null, null)).isNotNull()
            .extracting(RunningChatSnapshotResponse::getModelAnswerMessageId).isEqualTo(21L);
        verify(redis, never()).keys(anyString());
        verify(redis, never()).scan(any());
    }

    @Test
    void updatingAShortLivedTurnDoesNotShortenTheSharedSessionIndexLifetime() {
        service.saveExternalChild(message(20L, "1-0"), "1-0", false);
        String key = "byai:chat:running:snapshot:20:external-child-20";
        redis.expire(key, 60, TimeUnit.SECONDS);
        assertThat(service.updateSnapshot(service.getExternalChildSnapshot(20L, 21L))).isTrue();
        assertThat(redis.getExpire("byai:chat:running:session:20", TimeUnit.SECONDS)).isGreaterThan(1700L);
    }

    @Test
    void touchingSnapshotRefreshesItsSessionIndexMemberBeforeExpiryCleanup() {
        service.saveExternalChild(message(20L, "1-0"), "1-0", false);
        String key = "byai:chat:running:snapshot:20:external-child-20";
        String index = "byai:chat:running:session:20";
        redis.opsForZSet().add(index, key, 1);
        ChatProcessContext context = new ChatProcessContext(null, null);
        context.sessionId = 20L;
        context.traceId = "external-child-20";
        context.modelAnswerMessageId = 21L;
        service.touch(context);
        assertThat(redis.opsForZSet().score(index, key)).isGreaterThan((double) System.currentTimeMillis());
    }

    @Test
    void recoversOnlyIndexedSnapshotsWithoutScanningUnrelatedKeys() {
        redis.opsForValue().set("unrelated:wrong-type", "not a snapshot");
        // Legacy snapshots deliberately have no startup keyspace-scan fallback.
        redis.opsForValue().set("byai:chat:running:snapshot:99:external-child-99", JSON.toJSONString(snapshot(99L)));
        assertThat(service.saveExternalChild(message(20L, "123-4"), "123-4", false)).isTrue();

        assertThat(service.findExternalChildSnapshots()).extracting(RunningChatSnapshotResponse::getSessionId)
            .containsExactly(20L);
        verify(redis, never()).scan(any());
        verify(redis, never()).keys(anyString());
        assertThat(redis.getExpire(INDEX, TimeUnit.SECONDS)).isBetween(1800L, 1860L);
        assertThat(service.getExternalChildSnapshot(20L, 21L).getMessageContent()).isEqualTo("child output");
    }

    @Test
    void oldPersistenceWatermarkDoesNotHideANewerSnapshot() {
        ByaiMessageHotDtoDto old = message(20L, "123-4");
        service.saveExternalChild(old, "123-4", false);
        service.markExternalChildPersisted(old);
        assertThat(service.findExternalChildSnapshots()).isEmpty();

        service.saveExternalChild(message(20L, "123-5"), "123-5", false);
        service.markExternalChildPersisted(old);

        assertThat(service.findExternalChildSnapshots()).extracting(RunningChatSnapshotResponse::getSnapshotStreamId)
            .containsExactly("123-5");
    }

    @Test
    void malformedAndExpiredSnapshotsDoNotAbortRecovery() {
        redis.opsForZSet().add(INDEX, "missing-snapshot", System.currentTimeMillis() + 100000);
        redis.opsForZSet().add(INDEX, "malformed-snapshot", System.currentTimeMillis() + 100000);
        redis.opsForValue().set("malformed-snapshot", "{invalid-json", Duration.ofMinutes(1));
        service.saveExternalChild(message(20L, "123-4"), "123-4", false);

        assertThat(service.findExternalChildSnapshots()).extracting(RunningChatSnapshotResponse::getSessionId)
            .containsExactly(20L);
    }

    @Test
    void savingPrunesExpiredIndexEntriesWithoutDeletingFreshOnes() {
        redis.opsForZSet().add(INDEX, "expired", 1);
        redis.opsForZSet().add(INDEX, "fresh", System.currentTimeMillis() + 100000);

        service.saveExternalChild(message(20L, "123-4"), "123-4", false);

        assertThat(redis.opsForZSet().score(INDEX, "expired")).isNull();
        assertThat(redis.opsForZSet().score(INDEX, "fresh")).isNotNull();
    }

    @Test
    void failedIndexRegistrationDoesNotReportADurableSnapshot() {
        redis.opsForValue().set(INDEX, "wrong-type");

        assertThat(service.saveExternalChild(message(20L, "123-4"), "123-4", false)).isFalse();
    }

    @Test
    void recoveryUsesBoundedBulkReadsEvenWhenTheIndexContainsMoreThanOneBatch() {
        for (long id = 1000; id < 1205; id++) {
            String key = "byai:chat:running:snapshot:" + id + ":external-child-" + id;
            redis.opsForValue().set(key, JSON.toJSONString(snapshot(id)));
            redis.opsForZSet().add(INDEX, key, System.currentTimeMillis() + 100000);
        }
        ValueOperations<String, Object> values = spy(redis.opsForValue());
        doReturn(values).when(redis).opsForValue();
        List<RunningChatSnapshotResponse> recovered = new ArrayList<>();
        List<Integer> batchSizes = new ArrayList<>();

        service.findExternalChildSnapshots(batch -> {
            batchSizes.add(batch.size());
            recovered.addAll(batch);
        });

        assertThat(recovered).hasSize(205);
        assertThat(recovered).extracting(RunningChatSnapshotResponse::getSessionId).doesNotHaveDuplicates();
        assertThat(batchSizes).allSatisfy(size -> assertThat(size).isBetween(1, 100));
        ArgumentCaptor<List<String>> keys = ArgumentCaptor.forClass(List.class);
        verify(values, times(6)).multiGet(keys.capture());
        assertThat(keys.getAllValues()).allSatisfy(batch -> assertThat(batch).hasSizeLessThanOrEqualTo(100));
        verify(values, never()).get(any());
    }

    @Test
    void missingIndexDoesNotFallBackToLegacyKeyspaceDiscovery() {
        redis.opsForValue().set("byai:chat:running:snapshot:99:external-child-99", JSON.toJSONString(snapshot(99L)));

        assertThat(service.findExternalChildSnapshots()).isEmpty();
        verify(redis, never()).scan(any());
        verify(redis, never()).keys(anyString());
    }

    @Test
    void persistenceRecheckRecognizesANewerDurableWatermark() {
        service.markExternalChildPersisted(message(20L, "123-5"));

        assertThat(service.isExternalChildPersisted(message(20L, "123-4"))).isTrue();
        assertThat(service.isExternalChildPersisted(message(20L, "123-6"))).isFalse();
    }

    private static ByaiMessageHotDtoDto message(Long sessionId, String streamId) {
        ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
        message.setSessionId(sessionId);
        message.setMessageId(sessionId + 1);
        message.setMessageContent("child output");
        message.setMetadata("{\"event_stream_id\":\"" + streamId + "\"}");
        return message;
    }

    private static RunningChatSnapshotResponse snapshot(Long sessionId) {
        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        snapshot.setSessionId(sessionId);
        snapshot.setMessageId(sessionId + 1);
        snapshot.setSnapshotStreamId("123-4");
        return snapshot;
    }
}
