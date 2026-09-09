package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson.JSONObject;

class SessionConsumerIsolationTest {
    @Test
    void blockedDispatchDoesNotPinTheOnlyVirtualThreadCarrier() throws Exception {
        Process process = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
            "-Djdk.virtualThreadScheduler.parallelism=1", "-Djdk.virtualThreadScheduler.maxPoolSize=1",
            "-cp", System.getProperty("java.class.path"), PinningProbe.class.getName())
            .redirectErrorStream(true).start();
        try {
            assertThat(process.waitFor(15, TimeUnit.SECONDS)).isTrue();
            String output = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            assertThat(process.exitValue()).as(output).isZero();
        }
        finally { process.destroyForcibly(); }
    }

    @Test
    void terminalCleanupDoesNotHoldTheGlobalContextMonitorDuringRedisIo() {
        OutputStreamManager contexts = new OutputStreamManager();
        SessionStreamManager manager = new SessionStreamManager();
        ApplicationContext application = mock(ApplicationContext.class);
        when(application.getBean(RunningOutputStreamRegistry.class)).thenReturn(mock(RunningOutputStreamRegistry.class));
        ReflectionTestUtils.setField(manager, "applicationContext", application);
        ReflectionTestUtils.setField(manager, "outputStreamManager", contexts);
        ReflectionTestUtils.setField(manager, "chatRuntimeStateService", new ChatRuntimeStateService() {
            @Override public void delete(ChatProcessContext ctx) {
                assertThat(Thread.holdsLock(contexts)).as("Redis I/O must not hold all sessions' context monitor").isFalse();
            }
        });
        ChatProcessContext completed = new ChatProcessContext(null, null);
        completed.sessionId = 10L;
        manager.completeSessionTurn(completed);
    }

    public static class PinningProbe {
        public static void main(String[] args) throws Exception {
            CountDownLatch entered = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            CountDownLatch other = new CountDownLatch(1);
            StreamRecordProcessor processor = new StreamRecordProcessor();
            ReflectionTestUtils.setField(processor, "sessionStreamEventRouter", new SessionStreamEventRouter() {
                @Override public StreamDispatchResult dispatch(JSONObject event) {
                    if ("1".equals(event.getString("session_id"))) {
                        entered.countDown();
                        try { release.await(); }
                        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    } else { other.countDown(); }
                    return StreamDispatchResult.HANDLED;
                }
            });
            Thread first = Thread.startVirtualThread(() -> processor.process(StreamRecords
                .newRecord().in("stream-1").ofMap(Map.of("data", "{\"session_id\":\"1\"}")).withId(org.springframework.data.redis.connection.stream.RecordId.of("1-0"))));
            if (!entered.await(3, TimeUnit.SECONDS)) throw new AssertionError("first dispatch did not start");
            Thread second = Thread.startVirtualThread(() -> processor.process(StreamRecords
                .newRecord().in("stream-2").ofMap(Map.of("data", "{\"session_id\":\"2\"}")).withId(org.springframework.data.redis.connection.stream.RecordId.of("1-0"))));
            boolean independent;
            try { independent = other.await(2, TimeUnit.SECONDS); }
            finally { release.countDown(); first.join(); second.join(); processor.shutdown(); }
            if (!independent) throw new AssertionError("unrelated session stalled on pinned carrier");
        }
    }
}
