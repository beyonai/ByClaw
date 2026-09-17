package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStreamCommands;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 验证 PEL claim 的两个边界（#1）：
 * 1) PEL 超过单批上限时分页 claim，不漏后续页；
 * 2) idle 未满阈值的 pending 本轮不 claim，留待后续周期补捞。
 */
class SessionStreamRecoveryClaimTest {

    private static final long IDLE = 180_000L;
    private static final String GROUP = SessionStreamManager.CONSUMER_GROUP;

    private RedisTemplate<String, Object> redisTemplate;
    private StreamOperations<String, Object, Object> streamOps;
    private SessionStreamManager sessionStreamManager;
    private SessionStreamRecoveryService recoveryService;
    private StreamRecordProcessor processor;
    private StreamAckFailureRegistry ackFailures;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        recoveryService = new SessionStreamRecoveryService();
        redisTemplate = mock(RedisTemplate.class);
        streamOps = mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOps);

        sessionStreamManager = mockField("sessionStreamManager", SessionStreamManager.class);
        processor = mockField("streamRecordProcessor", StreamRecordProcessor.class);
        ackFailures = new StreamAckFailureRegistry();
        ReflectionTestUtils.setField(recoveryService, "streamAckFailureRegistry", ackFailures);
        ReflectionTestUtils.setField(recoveryService, "redisTemplate", redisTemplate);
        mockField("chatRuntimeStateService", ChatRuntimeStateService.class);
        mockField("chatContextRecoveryService", ChatContextRecoveryService.class);
        mockField("runningOutputStreamRegistry", RunningOutputStreamRegistry.class);
        mockField("outputStreamManager", OutputStreamManager.class);
        mockField("chatRuntimeInstance", ChatRuntimeInstance.class);

        when(sessionStreamManager.buildStreamKey("10")).thenReturn("byai_gateway:session:10:data_stream");
        when(sessionStreamManager.buildConsumerName("10")).thenReturn("byai_conversation_consumer:instance-a:10");
        when(processor.process(any())).thenReturn(StreamDispatchResult.HANDLED);
        // Return each requested record: an omitted result cannot prove that the PEL checkpoint succeeded.
        when(streamOps.claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class)))
            .thenAnswer(call -> ((RedisStreamCommands.XClaimOptions) call.getArgument(3)).getIds().stream()
                .map(id -> MapRecord.create("byai_gateway:session:10:data_stream",
                    java.util.Map.<Object, Object>of("data", "{}")).withId(id)).toList());
    }

    private <T> T mockField(String name, Class<T> type) {
        T m = Mockito.mock(type);
        ReflectionTestUtils.setField(recoveryService, name, m);
        return m;
    }

    private PendingMessage pending(String id, long idleMillis) {
        return new PendingMessage(RecordId.of(id), Consumer.from(GROUP, "c"), Duration.ofMillis(idleMillis), 1L);
    }

    private void invokeClaim() {
        ReflectionTestUtils.invokeMethod(recoveryService, "claimPendingMessages", "10");
    }

    @Test
    void limitsEachSessionToOnePelPagePerRecoveryPass() {
        // 即使第一页已满，本轮也只处理一页，让其他 session 获得恢复机会。
        List<PendingMessage> page1 = new ArrayList<>();
        for (int i = 1; i <= 100; i++) {
            page1.add(pending(i + "-0", IDLE + 1000));
        }

        when(streamOps.pending(eq("byai_gateway:session:10:data_stream"), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, page1));

        invokeClaim();

        verify(streamOps).pending(any(), anyString(), any(Range.class), anyLong());
        verify(streamOps).claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class));
    }

    @Test
    void nextRecoveryPassContinuesAfterThePreviousFullPage() {
        List<PendingMessage> page1 = new ArrayList<>();
        for (int i = 1; i <= 100; i++) {
            page1.add(pending(i + "-0", IDLE + 1000));
        }
        List<PendingMessage> page2 = Collections.singletonList(pending("101-0", IDLE + 1000));
        when(streamOps.pending(eq("byai_gateway:session:10:data_stream"), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, page1))
            .thenReturn(new PendingMessages(GROUP, page2));

        invokeClaim();
        invokeClaim();

        ArgumentCaptor<Range<String>> ranges = ArgumentCaptor.forClass(Range.class);
        verify(streamOps, times(2)).pending(any(), anyString(), ranges.capture(), anyLong());
        org.assertj.core.api.Assertions.assertThat(ranges.getAllValues().get(0).getLowerBound().isBounded()).isFalse();
        Range.Bound<String> secondLowerBound = ranges.getAllValues().get(1).getLowerBound();
        org.assertj.core.api.Assertions.assertThat(secondLowerBound.getValue()).contains("100-0");
        org.assertj.core.api.Assertions.assertThat(secondLowerBound.isInclusive()).isFalse();
    }

    @Test
    void skipsIdleNotYetMetButClaimsEligible() {
        // 单页：一条 idle 已满、一条 idle 未满 → 只 claim 已满的那条。
        List<PendingMessage> page = new ArrayList<>();
        page.add(pending("100-0", IDLE + 1000));
        page.add(pending("101-0", IDLE - 1000));

        when(streamOps.pending(eq("byai_gateway:session:10:data_stream"), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, page));

        invokeClaim();

        ArgumentCaptor<RedisStreamCommands.XClaimOptions> captor =
            ArgumentCaptor.forClass(RedisStreamCommands.XClaimOptions.class);
        verify(streamOps, times(1)).claim(any(), any(), any(), captor.capture());
        // 只有 idle 已满的 100-0 被纳入 claim，101-0 被过滤。
        List<RecordId> claimedIds = captor.getValue().getIds();
        org.junit.jupiter.api.Assertions.assertEquals(1, claimedIds.size());
        org.junit.jupiter.api.Assertions.assertEquals("100-0", claimedIds.get(0).getValue());
    }

    @Test
    void noClaimWhenPelEmpty() {
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, Collections.emptyList()));

        invokeClaim();

        verify(streamOps, never()).claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class));
    }

    @Test
    void retriesFailedRecordBeforeProcessingOrAdvancingPastItsSuffix() {
        List<PendingMessage> firstPage = new ArrayList<>();
        for (int i = 1; i <= 100; i++) firstPage.add(pending(i + "-0", IDLE + 1000));
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, firstPage))
            .thenReturn(new PendingMessages(GROUP, firstPage.subList(49, 100)));
        when(streamOps.claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class)))
            .thenAnswer(call -> ((RedisStreamCommands.XClaimOptions) call.getArgument(3)).getIds().stream()
                .map(id -> MapRecord.create("byai_gateway:session:10:data_stream",
                    java.util.Map.<Object, Object>of("data", "{}" )).withId(id)).toList());
        List<String> processed = new ArrayList<>();
        java.util.concurrent.atomic.AtomicInteger failedAttempts = new java.util.concurrent.atomic.AtomicInteger();
        when(processor.process(any())).thenAnswer(call -> {
            String id = ((MapRecord<?, ?, ?>) call.getArgument(0)).getId().getValue();
            processed.add(id);
            return "50-0".equals(id) && failedAttempts.getAndIncrement() == 0
                ? StreamDispatchResult.ERROR : StreamDispatchResult.HANDLED;
        });

        invokeClaim();

        org.junit.jupiter.api.Assertions.assertEquals(50, processed.size(), "Failed checkpoint must stop later records");
        invokeClaim();
        ArgumentCaptor<Range<String>> ranges = ArgumentCaptor.forClass(Range.class);
        verify(streamOps, times(2)).pending(any(), anyString(), ranges.capture(), anyLong());
        org.junit.jupiter.api.Assertions.assertFalse(ranges.getAllValues().get(1).getLowerBound().isBounded(),
            "The failed page must be retried before scanning newer IDs");
        org.junit.jupiter.api.Assertions.assertEquals("50-0", processed.get(50));
        org.junit.jupiter.api.Assertions.assertEquals("51-0", processed.get(51));
    }

    @Test
    void doesNotOvertakeAnEarlierRecordWhoseIdleThresholdIsNotMet() {
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, List.of(pending("100-0", 1000), pending("101-0", IDLE + 1000))));

        invokeClaim();

        verify(streamOps, never()).claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class));
    }

    @Test
    void retriesNewlyClaimedLocalFailureWithoutWaitingForForeignConsumerIdleThreshold() {
        PendingMessage localFirst = new PendingMessage(RecordId.of("50-0"), Consumer.from(GROUP,
            "byai_conversation_consumer:instance-a:10"), Duration.ofMillis(1), 2);
        PendingMessage localSecond = new PendingMessage(RecordId.of("51-0"), Consumer.from(GROUP,
            "byai_conversation_consumer:instance-a:10"), Duration.ofMillis(1), 2);
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, List.of(pending("50-0", IDLE + 1000), pending("51-0", IDLE + 1000))))
            .thenReturn(new PendingMessages(GROUP, List.of(localFirst, localSecond)));
        when(streamOps.claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class)))
            .thenAnswer(call -> ((RedisStreamCommands.XClaimOptions) call.getArgument(3)).getIds().stream()
                .map(id -> MapRecord.create("byai_gateway:session:10:data_stream",
                    java.util.Map.<Object, Object>of("data", "{}")).withId(id)).toList());
        List<String> processed = new ArrayList<>();
        when(processor.process(any())).thenAnswer(call -> {
            String id = ((MapRecord<?, ?, ?>) call.getArgument(0)).getId().getValue();
            processed.add(id);
            return processed.size() == 1 ? StreamDispatchResult.ERROR : StreamDispatchResult.HANDLED;
        });

        invokeClaim();
        invokeClaim();

        org.junit.jupiter.api.Assertions.assertEquals(List.of("50-0", "50-0", "51-0"), processed,
            "XCLAIM resets idle but the paused owner must retry its own failure on the next pass");
    }

    @Test
    void missingClaimedRecordStillInPelStopsLaterRecordsAndKeepsBarrierClosed() {
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, List.of(pending("50-0", IDLE + 1000), pending("51-0", IDLE + 1000))));
        MapRecord<String, Object, Object> newer = MapRecord.create("byai_gateway:session:10:data_stream",
            java.util.Map.<Object, Object>of("data", "{}")).withId(RecordId.of("51-0"));
        when(streamOps.claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class)))
            .thenReturn(List.of(newer));
        when(processor.process(any())).thenReturn(StreamDispatchResult.HANDLED);

        Object drained = ReflectionTestUtils.invokeMethod(recoveryService, "claimPendingMessages", "10");

        org.junit.jupiter.api.Assertions.assertEquals(false, drained, "A missing claim result is not proof of checkpointing");
        verify(processor, never()).process(any());
    }

    @Test
    void registersOnlyFailedAcknowledgementAndClearsItOnSuccessfulRetry() {
        String stream = "byai_gateway:session:10:data_stream";
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, List.of(pending("50-0", IDLE + 1000))));
        when(streamOps.acknowledge(any(), anyString(), any(RecordId.class)))
            .thenThrow(new IllegalStateException("ACK transport unavailable")).thenReturn(1L);

        invokeClaim();

        org.junit.jupiter.api.Assertions.assertTrue(ackFailures.hasFailures(stream),
            "After unread resumes, completed dispatches require targeted ACK recovery");
        invokeClaim();
        org.junit.jupiter.api.Assertions.assertFalse(ackFailures.hasFailures(stream));
    }
}
