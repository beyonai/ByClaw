package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class RecorderVerifyServiceTest {

    private static final RecorderOwner OWNER = new RecorderOwner(1L, "alice");

    private static final Set<String> FRONTEND_ERROR_CODES = Set.of(
        "validation_failed", "invalid_state", "csrf_failed", "auth_failed", "auth_required",
        "responsible_use_required", "network_error", "insufficient_samples", "daemon_unavailable",
        "extension_disconnected", "profile_busy", "queue_full", "page_lost", "navigation_url_forbidden",
        "navigation_redirect_requires_interception", "dns_resolution_failed", "request_not_found",
        "idempotency_conflict", "temp_store_full", "verify_timeout", "pipeline_timeout", "analyze_timeout",
        "adapter_runtime_error", "runner_protocol_error", "shape_mismatch", "fixture_mismatch",
        "output_truncated", "feature_disabled", "ambiguous_iframe_target", "config_invalid"
    );

    private ExecutorService executor;

    @AfterEach
    void tearDown() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void expectationRequiresOkMinimumRowsStageAndPositiveFieldCount() {
        RecorderVerifyService service = service(new FakePort());

        assertThat(service.meetsExpectation(
            Map.of("ok", true, "rows", 2, "stage", "execute", "fieldCount", 3),
            Map.of("minRows", 2, "expectedStage", "execute", "expectedFieldCount", 3)
        )).containsEntry("ok", true).containsEntry("reasons", List.of());

        Map<String, Object> failed = service.meetsExpectation(
            Map.of("ok", false, "rows", 0, "stage", "load", "fieldCount", 2),
            Map.of("expectedStage", "execute", "expectedFieldCount", 3)
        );
        assertThat(failed).containsEntry("ok", false).containsEntry("rows", 0).containsEntry("fieldCount", 2);
        assertThat((List<?>) failed.get("reasons")).hasSize(4);
    }

    @Test
    void missingExpectationUsesOneRowAndOnlyChecksStageWhenSummaryHasStage() {
        RecorderVerifyService service = service(new FakePort());

        assertThat(service.meetsExpectation(Map.of("ok", true, "rows", 1), Map.of("expectedStage", "execute")))
            .containsEntry("ok", true);
        assertThat(service.meetsExpectation(Map.of("ok", true, "rows", 0), Map.of()))
            .containsEntry("ok", false);
    }

    @Test
    void acceptedVerifyCreatesRunningThenFinalizesFromDaemonSummary() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of("status", "running"));
        port.statuses.add(Map.of("status", "succeeded", "result", Map.of("ok", true, "rows", 2)));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 20, 5);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        );

        assertThat(registry.getOwned(requestId, OWNER).orElseThrow()).containsEntry("status", "running");
        assertThat(registry.getOwned(requestId, new RecorderOwner(2L, "bob"))).isEmpty();
        awaitStatus(registry, requestId, "succeeded");
        assertThat(registry.getOwned(requestId, OWNER).orElseThrow().get("result"))
            .isEqualTo(Map.of("ok", true, "rows", 2));
        assertThat(port.canonicalRequestId).isEqualTo(requestId);
    }

    @Test
    void startFailureFinalizesFailedAndDoesNotMutateSession() {
        FakePort port = new FakePort();
        port.startFailure = new RecorderVerifyException("daemon_unavailable", "daemon unavailable");
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 5, 1);
        RecorderSession session = new RecorderSession("session-1", OWNER);

        assertThatThrownBy(() -> service.start(
            session.sessionId(), OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        )).isInstanceOf(RecorderVerifyException.class);

        assertThat(session.state().wireValue()).isEqualTo("idle");
        assertThat(registry.get(port.canonicalRequestId).orElseThrow()).containsEntry("status", "failed");
    }

    @Test
    void startTransportTimeoutIsNormalizedForRegistryAndCaller() {
        FakePort port = new FakePort();
        port.startFailure = new RecorderVerifyException("daemon_timeout", "SECRET start timeout detail");
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 5, 1);

        assertThatThrownBy(() -> service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "verify_timeout")
            .hasMessage("verify runner timed out")
            .hasMessageNotContaining("SECRET");

        Map<?, ?> error = (Map<?, ?>) registry.get(port.canonicalRequestId).orElseThrow().get("error");
        assertThat(error.get("code")).isEqualTo("verify_timeout");
        assertThat(error.get("message")).isEqualTo("verify runner timed out");
        assertThat(error.toString()).doesNotContain("SECRET");
    }

    @Test
    void statusTransportTimeoutIsNormalizedBeforeRegistryFinalization() throws Exception {
        FakePort port = new FakePort();
        port.statusFailure = new RecorderVerifyException("daemon_timeout", "SECRET status timeout detail");
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 5, 0);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        );

        awaitStatus(registry, requestId, "timeout");
        Map<?, ?> error = (Map<?, ?>) registry.get(requestId).orElseThrow().get("error");
        assertThat(error.get("code")).isEqualTo("verify_timeout");
        assertThat(error.get("message")).isEqualTo("verify runner timed out");
        assertThat(error.toString()).doesNotContain("SECRET");
    }

    @Test
    void unknownStartTransportErrorCollapsesToAdapterRuntimeError() {
        FakePort port = new FakePort();
        port.startFailure = new RecorderVerifyException("internal_transport_detail", "SECRET start detail");
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 5, 1);

        assertThatThrownBy(() -> service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "adapter_runtime_error")
            .hasMessage("adapter execution failed")
            .hasMessageNotContaining("SECRET");
    }

    @Test
    void supportedStatusTransportErrorKeepsAllowlistedCodeWithSafeMessage() throws Exception {
        FakePort port = new FakePort();
        port.statusFailure = new RecorderVerifyException("auth_required", "SECRET auth detail");
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 5, 0);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        );

        awaitStatus(registry, requestId, "failed");
        Map<?, ?> error = (Map<?, ?>) registry.get(requestId).orElseThrow().get("error");
        assertThat(error.get("code")).isEqualTo("auth_required");
        assertThat(error.get("message")).isEqualTo("authentication is required");
        assertThat(error.toString()).doesNotContain("SECRET");
    }

    @Test
    void boundedPollingFinalizesTimeoutInsteadOfSuccess() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of("status", "running"));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 2, 1);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.ts", Map.of(), summary -> summary
        );

        awaitStatus(registry, requestId, "timeout");
        assertThat(registry.get(requestId).orElseThrow().get("error")).isNotNull();
    }

    @Test
    void acceptedCallbackRunsBeforeZeroDelayTerminalObserver() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of("status", "succeeded", "result", Map.of("ok", true, "rows", 1)));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 2, 0);
        AtomicBoolean accepted = new AtomicBoolean();
        AtomicBoolean terminalObservedAfterAccept = new AtomicBoolean();

        String requestId = service.start(
            "session-1",
            OWNER,
            "verify",
            "example/search",
            "/tmp/draft.ts",
            Map.of(),
            summary -> summary,
            () -> accepted.set(true),
            (status, payload) -> terminalObservedAfterAccept.set(accepted.get())
        );

        awaitStatus(registry, requestId, "succeeded");
        assertThat(terminalObservedAfterAccept).isTrue();
    }

    @Test
    void capacityIsReservedBeforeCallingDaemonStart() {
        FakePort port = new FakePort();
        port.statuses.add(Map.of("status", "succeeded", "result", Map.of("ok", true, "rows", 1)));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        QueuedExecutor queuedExecutor = new QueuedExecutor();
        executor = queuedExecutor;
        RecorderVerifyService service = new RecorderVerifyService(port, registry, queuedExecutor, 2, 0, 1);

        service.start("session-1", OWNER, "verify", "example/one", "/tmp/one.js", Map.of(), summary -> summary);

        assertThatThrownBy(() -> service.start(
            "session-2", OWNER, "verify", "example/two", "/tmp/two.js", Map.of(), summary -> summary
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "queue_full");
        assertThat(port.startCalls).hasValue(1);
    }

    @Test
    void terminalDaemonErrorsAreAllowlistedAndDoNotLeakMessage() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of(
            "status", "failed",
            "result", Map.of(
                "ok", false,
                "error", Map.of("code", "evil_internal_code", "message", "SECRET-TOKEN in daemon detail")
            )
        ));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 2, 0);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.js", Map.of(), summary -> summary
        );

        awaitStatus(registry, requestId, "failed");
        Map<?, ?> error = (Map<?, ?>) registry.get(requestId).orElseThrow().get("error");
        assertThat(error.get("code")).isEqualTo("adapter_runtime_error");
        assertThat(error.get("message")).isEqualTo("adapter execution failed");
        assertThat(error.toString()).doesNotContain("SECRET-TOKEN");
    }

    @Test
    void terminalStatusesWithoutSupportedErrorsUseOnlyFrontendContractCodes() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of("status", "failed", "result", Map.of("ok", false)));
        port.statuses.add(Map.of(
            "status", "cancelled",
            "result", Map.of(
                "ok", false,
                "error", Map.of("code", "verify_cancelled", "message", "SECRET cancelled detail")
            )
        ));
        port.statuses.add(Map.of(
            "status", "timeout",
            "result", Map.of(
                "ok", false,
                "error", Map.of("code", "daemon_timeout", "message", "SECRET timeout detail")
            )
        ));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 2, 0);

        Map<String, String> expectedCodes = Map.of(
            "failed", "adapter_runtime_error",
            "cancelled", "adapter_runtime_error",
            "timeout", "verify_timeout"
        );
        Map<String, String> expectedMessages = Map.of(
            "failed", "adapter execution failed",
            "cancelled", "adapter execution failed",
            "timeout", "verify runner timed out"
        );
        for (String terminal : List.of("failed", "cancelled", "timeout")) {
            String requestId = service.start(
                "session-1", OWNER, "verify", "example/search", "/tmp/draft.js", Map.of(), summary -> summary
            );
            awaitStatus(registry, requestId, terminal);
            Map<?, ?> error = (Map<?, ?>) registry.get(requestId).orElseThrow().get("error");
            assertThat(error.get("code")).isEqualTo(expectedCodes.get(terminal));
            assertThat(error.get("message")).isEqualTo(expectedMessages.get(terminal));
            assertThat(FRONTEND_ERROR_CODES).contains((String) error.get("code"));
            assertThat(error.toString())
                .doesNotContain("verify_failed")
                .doesNotContain("verify_cancelled")
                .doesNotContain("SECRET");
        }
    }

    @Test
    void terminalDaemonResultPreservesAuthRequiredWithFixedSafeMessage() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of(
            "status", "failed",
            "result", Map.of(
                "ok", false,
                "stage", "execute",
                "error", Map.of("code", "auth_required", "message", "SECRET login detail")
            )
        ));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 2, 0);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.js", Map.of(), summary -> summary
        );

        awaitStatus(registry, requestId, "failed");
        Map<?, ?> error = (Map<?, ?>) registry.get(requestId).orElseThrow().get("error");
        assertThat(error.get("code")).isEqualTo("auth_required");
        assertThat(error.get("message")).isEqualTo("authentication is required");
        assertThat(error.toString()).doesNotContain("SECRET");
    }

    @Test
    void terminalDaemonResultErrorsPreserveAllowlistedCodeWithoutLeakingMessage() throws Exception {
        FakePort port = new FakePort();
        port.statuses.add(Map.of(
            "status", "failed",
            "result", Map.of(
                "ok", false,
                "stage", "execute",
                "error", Map.of("code", "adapter_runtime_error", "message", "SECRET-TOKEN in daemon detail")
            )
        ));
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        RecorderVerifyService service = service(port, registry, 2, 0);

        String requestId = service.start(
            "session-1", OWNER, "verify", "example/search", "/tmp/draft.js", Map.of(), summary -> summary
        );

        awaitStatus(registry, requestId, "failed");
        Map<?, ?> error = (Map<?, ?>) registry.get(requestId).orElseThrow().get("error");
        assertThat(error.get("code")).isEqualTo("adapter_runtime_error");
        assertThat(error.get("message")).isEqualTo("adapter execution failed");
        assertThat(error.toString()).doesNotContain("SECRET-TOKEN");
    }

    private RecorderVerifyService service(FakePort port) {
        return service(port, new RecorderRequestRegistry(), 2, 1);
    }

    private RecorderVerifyService service(FakePort port, RecorderRequestRegistry registry, int maxPolls, long pollMs) {
        executor = Executors.newSingleThreadExecutor();
        return new RecorderVerifyService(port, registry, executor, maxPolls, pollMs);
    }

    private void awaitStatus(RecorderRequestRegistry registry, String requestId, String expected) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
        while (System.nanoTime() < deadline) {
            if (expected.equals(registry.get(requestId).orElseThrow().get("status"))) {
                return;
            }
            Thread.sleep(5);
        }
        throw new AssertionError("request did not reach " + expected + ": " + registry.get(requestId));
    }

    private static final class FakePort implements RecorderVerifyPort {
        private final Queue<Map<String, Object>> statuses = new ArrayDeque<>();
        private RecorderVerifyException startFailure;
        private RecorderVerifyException statusFailure;
        private String canonicalRequestId;
        private final AtomicInteger startCalls = new AtomicInteger();

        @Override
        public String start(
            String canonicalRequestId,
            String sessionId,
            String name,
            String adapterPath,
            Map<String, Object> executionSeedArgs
        ) {
            startCalls.incrementAndGet();
            this.canonicalRequestId = canonicalRequestId;
            if (startFailure != null) {
                throw startFailure;
            }
            return canonicalRequestId;
        }

        @Override
        public Map<String, Object> status(String daemonRequestId) {
            if (statusFailure != null) {
                throw statusFailure;
            }
            return statuses.size() > 1 ? statuses.remove() : statuses.peek();
        }
    }

    private static final class QueuedExecutor extends AbstractExecutorService {
        private Runnable queued;
        private boolean shutdown;

        @Override
        public void shutdown() {
            shutdown = true;
        }

        @Override
        public List<Runnable> shutdownNow() {
            shutdown = true;
            return queued == null ? List.of() : List.of(queued);
        }

        @Override
        public boolean isShutdown() {
            return shutdown;
        }

        @Override
        public boolean isTerminated() {
            return shutdown;
        }

        @Override
        public boolean awaitTermination(long timeout, TimeUnit unit) {
            return shutdown;
        }

        @Override
        public void execute(Runnable command) {
            if (queued != null) {
                throw new java.util.concurrent.RejectedExecutionException();
            }
            queued = command;
        }
    }
}
