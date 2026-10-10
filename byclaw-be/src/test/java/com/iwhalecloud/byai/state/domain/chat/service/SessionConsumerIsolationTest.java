package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.ApplicationContext;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson.JSONObject;

@DisabledOnOs(OS.WINDOWS)
class SessionConsumerIsolationTest {
    @Test
    void blockedDispatchDoesNotPinTheOnlyVirtualThreadCarrier(@TempDir Path temporaryDirectory) throws Exception {
        Path outputFile = temporaryDirectory.resolve("pinning-probe.log");
        // 直接写文件，避免等待退出期间无人读取 stdout/stderr，导致子 JVM 被输出管道阻塞。
        Process process = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
            "-Djdk.virtualThreadScheduler.parallelism=1", "-Djdk.virtualThreadScheduler.maxPoolSize=1",
            "-cp", System.getProperty("java.class.path"), PinningProbe.class.getName())
            .redirectErrorStream(true).redirectOutput(outputFile.toFile()).start();
        try {
            // 启动及类加载单独预留余量；探针内部仍用 2 秒判断无关会话是否被阻塞。
            boolean exited = process.waitFor(60, TimeUnit.SECONDS);
            if (!exited) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
            String output = Files.readString(outputFile, StandardCharsets.UTF_8);
            assertThat(exited).as("Pinning probe did not exit within 60 seconds. Output:%n%s", output).isTrue();
            assertThat(process.exitValue()).as("Pinning probe failed. Output:%n%s", output).isZero();
        }
        finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
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
                    } else if ("2".equals(event.getString("session_id"))) { other.countDown(); }
                    return StreamDispatchResult.HANDLED;
                }
            });
            Thread first = null;
            Thread second = null;
            try {
                System.out.println("Initializing stream processor on the platform thread");
                // 先在平台线程初始化 JSON、日志和 Stream record 等依赖，隔离业务锁与首次类加载的影响。
                processor.process(record("warmup"));
                MapRecord<String, String, String> firstRecord = record("1");
                MapRecord<String, String, String> secondRecord = record("2");
                System.out.println("Starting single-carrier session isolation probe");
                first = Thread.startVirtualThread(() -> processor.process(firstRecord));
                if (!entered.await(3, TimeUnit.SECONDS)) throw new AssertionError("first dispatch did not start");
                second = Thread.startVirtualThread(() -> processor.process(secondRecord));
                if (!other.await(2, TimeUnit.SECONDS)) {
                    throw new AssertionError("unrelated session stalled on pinned carrier");
                }
            }
            finally {
                // 初始化、首次分发或隔离断言失败时也释放阻塞；清理不能用无限 join 掩盖原始失败。
                release.countDown();
                try {
                    if (first != null) first.join(TimeUnit.SECONDS.toMillis(5));
                    if (second != null) second.join(TimeUnit.SECONDS.toMillis(5));
                }
                finally { processor.shutdown(); }
            }
            if (first.isAlive() || second.isAlive()) {
                throw new AssertionError("probe dispatch did not finish after release");
            }
            System.out.println("Single-carrier session isolation probe passed");
        }

        private static MapRecord<String, String, String> record(String sessionId) {
            return StreamRecords.newRecord().in("stream-" + sessionId)
                .ofMap(Map.of("data", "{\"session_id\":\"" + sessionId + "\"}"))
                .withId(RecordId.of("1-0"));
        }
    }
}
