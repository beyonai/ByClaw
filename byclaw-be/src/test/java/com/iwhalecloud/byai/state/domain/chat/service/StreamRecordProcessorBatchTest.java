package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson.JSONObject;

class StreamRecordProcessorBatchTest {
    private final StreamRecordProcessor processor = new StreamRecordProcessor();

    @AfterEach
    void close() { processor.shutdown(); }

    @Test
    void groupsOnlyAdjacentEventsOfTheSameChildRunAndPreservesParentOrder() {
        List<String> calls = new ArrayList<>();
        ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", new SessionStreamEventRouter() {
            @Override public StreamDispatchResult dispatchChildBatch(Long sessionId, List<JSONObject> events) {
                calls.add("child:" + events.getFirst().getJSONObject("metadata").getLong("child_turn") + ":" + events.size());
                assertThat(events.getFirst().getString("stream_id")).isNotBlank();
                return StreamDispatchResult.HANDLED;
            }
            @Override public StreamDispatchResult dispatch(JSONObject event) {
                calls.add("parent");
                return StreamDispatchResult.HANDLED;
            }
        });
        List<StreamDispatchResult> results = processor.processBatch(List.of(
            child(1, 1), child(2, 1), parent(3), child(4, 1), child(5, 2)));
        assertThat(calls).containsExactly("child:1:2", "parent", "child:1:1", "child:2:1");
        assertThat(results).hasSize(5).allMatch(StreamDispatchResult::shouldAcknowledge);
    }

    @Test
    void failedChildCheckpointKeepsEveryRecordInItsBatchPending() {
        ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", new SessionStreamEventRouter() {
            @Override public StreamDispatchResult dispatchChildBatch(Long sessionId, List<JSONObject> events) {
                return StreamDispatchResult.ERROR;
            }
        });
        assertThat(processor.processBatch(List.of(child(1, 1), child(2, 1))))
            .hasSize(2).noneMatch(StreamDispatchResult::shouldAcknowledge);
    }

    @Test
    void failurePreventsLaterParentTerminalFromOvertakingUncheckpointedChildEvents() {
        List<String> calls = new ArrayList<>();
        ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", new SessionStreamEventRouter() {
            @Override public StreamDispatchResult dispatchChildBatch(Long sessionId, List<JSONObject> events) {
                return StreamDispatchResult.ERROR;
            }
            @Override public StreamDispatchResult dispatch(JSONObject event) {
                calls.add("later parent");
                return StreamDispatchResult.HANDLED;
            }
        });
        assertThat(processor.processBatch(List.of(child(1, 1), parent(2))))
            .hasSize(2).noneMatch(StreamDispatchResult::shouldAcknowledge);
        assertThat(calls).isEmpty();
    }

    @Test
    void exceptionReturnsSuccessfulPrefixSoItIsNotReplayedWithTheFailedSuffix() {
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", new SessionStreamEventRouter() {
            @Override public StreamDispatchResult dispatch(JSONObject event) {
                if (calls.incrementAndGet() == 2) throw new IllegalStateException("temporary Redis failure");
                return StreamDispatchResult.HANDLED;
            }
        });
        assertThat(processor.processBatch(List.of(parent(1), parent(2), parent(3))))
            .containsExactly(StreamDispatchResult.HANDLED, StreamDispatchResult.ERROR, StreamDispatchResult.ERROR);
        assertThat(calls).hasValue(2);
    }

    @Test
    void jsonNullIsIgnoredWithoutBlockingTheNextValidEventForever() {
        ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", new SessionStreamEventRouter() {
            @Override public StreamDispatchResult dispatch(JSONObject event) { return StreamDispatchResult.HANDLED; }
        });
        MapRecord<String, String, String> poison = StreamRecords.newRecord().in("stream-10")
            .ofMap(Map.of("data", "null")).withId(RecordId.of("1-0"));
        assertThat(processor.processBatch(List.of(poison, parent(2))))
            .containsExactly(StreamDispatchResult.INTENTIONALLY_IGNORED, StreamDispatchResult.HANDLED);
    }

    private MapRecord<String, String, String> child(int id, int turn) {
        JSONObject event = new JSONObject();
        event.put("session_id", "10");
        event.put("metadata", new JSONObject().fluentPut("session_scope", "child")
            .fluentPut("external_session_id", "worker").fluentPut("child_run_id", "run-" + turn)
            .fluentPut("child_turn", turn));
        return StreamRecords.newRecord().in("stream-10").ofMap(Map.of("data", event.toJSONString()))
            .withId(RecordId.of(id + "-0"));
    }

    private MapRecord<String, String, String> parent(int id) {
        return StreamRecords.newRecord().in("stream-10").ofMap(Map.of("data", "{\"session_id\":\"10\"}"))
            .withId(RecordId.of(id + "-0"));
    }
}
