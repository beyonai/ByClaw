package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class RecorderVerifyService {

    private static final Set<String> TERMINAL = Set.of("succeeded", "failed", "timeout", "cancelled");
    private static final int DEFAULT_MAX_POLLS = 150;
    private static final long DEFAULT_POLL_MS = 300L;
    private static final int POLL_THREADS = 2;
    private static final int POLL_QUEUE_CAPACITY = 32;
    private static final Map<String, String> SAFE_TERMINAL_ERRORS = Map.ofEntries(
        Map.entry("validation_failed", "verify request validation failed"),
        Map.entry("runner_protocol_error", "verify runner protocol error"),
        Map.entry("queue_full", "verify runner queue is full"),
        Map.entry("daemon_unavailable", "byCLI daemon unavailable"),
        Map.entry("verify_timeout", "verify runner timed out"),
        Map.entry("adapter_runtime_error", "adapter execution failed"),
        Map.entry("auth_required", "authentication is required"),
        Map.entry("shape_mismatch", "adapter output shape mismatch"),
        Map.entry("fixture_mismatch", "verify fixture mismatch"),
        Map.entry("output_truncated", "verify output was truncated")
    );

    private final RecorderVerifyPort verifyPort;
    private final RecorderRequestRegistry requestRegistry;
    private final ExecutorService executor;
    private final int maxPolls;
    private final long pollMs;
    private final boolean ownsExecutor;
    private final Semaphore reservations;

    @Autowired
    public RecorderVerifyService(RecorderVerifyPort verifyPort, RecorderRequestRegistry requestRegistry) {
        this(
            verifyPort,
            requestRegistry,
            productionExecutor(),
            DEFAULT_MAX_POLLS,
            DEFAULT_POLL_MS,
            POLL_THREADS + POLL_QUEUE_CAPACITY,
            true
        );
    }

    RecorderVerifyService(
        RecorderVerifyPort verifyPort,
        RecorderRequestRegistry requestRegistry,
        ExecutorService executor,
        int maxPolls,
        long pollMs
    ) {
        this(verifyPort, requestRegistry, executor, maxPolls, pollMs, Integer.MAX_VALUE, false);
    }

    RecorderVerifyService(
        RecorderVerifyPort verifyPort,
        RecorderRequestRegistry requestRegistry,
        ExecutorService executor,
        int maxPolls,
        long pollMs,
        int maxInFlight
    ) {
        this(verifyPort, requestRegistry, executor, maxPolls, pollMs, maxInFlight, false);
    }

    private RecorderVerifyService(
        RecorderVerifyPort verifyPort,
        RecorderRequestRegistry requestRegistry,
        ExecutorService executor,
        int maxPolls,
        long pollMs,
        int maxInFlight,
        boolean ownsExecutor
    ) {
        this.verifyPort = verifyPort;
        this.requestRegistry = requestRegistry;
        this.executor = executor;
        this.maxPolls = maxPolls;
        this.pollMs = pollMs;
        this.ownsExecutor = ownsExecutor;
        this.reservations = new Semaphore(maxInFlight);
    }

    public String start(
        String sessionId,
        RecorderOwner owner,
        String type,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs,
        Function<Map<String, Object>, Map<String, Object>> resultMapper
    ) {
        return start(sessionId, owner, type, name, adapterPath, executionSeedArgs, resultMapper, (status, payload) -> {});
    }

    public String start(
        String sessionId,
        RecorderOwner owner,
        String type,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs,
        Function<Map<String, Object>, Map<String, Object>> resultMapper,
        BiConsumer<String, Map<String, Object>> terminalObserver
    ) {
        return start(
            sessionId,
            owner,
            type,
            name,
            adapterPath,
            executionSeedArgs,
            resultMapper,
            () -> {},
            terminalObserver
        );
    }

    public String start(
        String sessionId,
        RecorderOwner owner,
        String type,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs,
        Function<Map<String, Object>, Map<String, Object>> resultMapper,
        Runnable acceptedCallback,
        BiConsumer<String, Map<String, Object>> terminalObserver
    ) {
        return start(
            sessionId,
            owner,
            type,
            name,
            adapterPath,
            null,
            executionSeedArgs,
            resultMapper,
            acceptedCallback,
            terminalObserver
        );
    }

    public String start(
        String sessionId,
        RecorderOwner owner,
        String type,
        String name,
        String adapterPath,
        String expectedSourceSha256,
        Map<String, Object> executionSeedArgs,
        Function<Map<String, Object>, Map<String, Object>> resultMapper,
        Runnable acceptedCallback,
        BiConsumer<String, Map<String, Object>> terminalObserver
    ) {
        String requestId = requestRegistry.nextRequestId();
        requestRegistry.createRunning(requestId, type, owner);
        if (!reservations.tryAcquire()) {
            requestRegistry.finalizeRequest(requestId, "failed", null, error("queue_full", "verify runner queue is full"));
            throw new RecorderVerifyException("queue_full", "verify runner queue is full", requestId);
        }
        final String daemonRequestId;
        try {
            daemonRequestId = verifyPort.start(
                owner,
                requestId,
                sessionId,
                name,
                adapterPath,
                expectedSourceSha256,
                executionSeedArgs
            );
        } catch (RecorderVerifyException e) {
            reservations.release();
            Map<String, Object> normalized = safeTransportError(e.getCode());
            requestRegistry.finalizeRequest(requestId, "failed", null, normalized);
            throw new RecorderVerifyException(
                stringValue(normalized.get("code")),
                stringValue(normalized.get("message")),
                requestId
            );
        } catch (RuntimeException e) {
            reservations.release();
            requestRegistry.finalizeRequest(requestId, "failed", null, error("network_error", "verify runner start failed"));
            throw new RecorderVerifyException("network_error", "verify runner start failed", requestId);
        }
        try {
            acceptedCallback.run();
        } catch (RecorderVerifyException e) {
            reservations.release();
            requestRegistry.finalizeRequest(requestId, "failed", null, error(e.getCode(), e.getMessage()));
            throw e.withRequestId(requestId);
        } catch (RuntimeException e) {
            reservations.release();
            requestRegistry.finalizeRequest(requestId, "failed", null, error("invalid_state", "verify session could not advance"));
            throw new RecorderVerifyException("invalid_state", "verify session could not advance", requestId);
        }
        try {
            executor.execute(() -> {
                try {
                    poll(requestId, daemonRequestId, owner, resultMapper, terminalObserver);
                } finally {
                    reservations.release();
                }
            });
        } catch (RejectedExecutionException e) {
            reservations.release();
            requestRegistry.finalizeRequest(requestId, "failed", null, error("queue_full", "verify runner queue is full"));
            throw new RecorderVerifyException("queue_full", "verify runner queue is full", requestId);
        }
        return requestId;
    }

    private static ExecutorService productionExecutor() {
        return new ThreadPoolExecutor(
            POLL_THREADS,
            POLL_THREADS,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(POLL_QUEUE_CAPACITY),
            runnable -> {
                Thread thread = new Thread(runnable, "recorder-verify-poller");
                thread.setDaemon(true);
                return thread;
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
    }

    public Map<String, Object> meetsExpectation(Map<String, Object> summary, Map<String, Object> expectation) {
        int rows = intValue(summary == null ? null : summary.get("rows"), 0);
        int fieldCount = intValue(summary == null ? null : summary.get("fieldCount"), 0);
        List<String> reasons = new ArrayList<>();
        if (summary == null || !Boolean.TRUE.equals(summary.get("ok"))) {
            reasons.add("verify did not succeed (ok != true)");
        }
        int minRows = intValue(expectation == null ? null : expectation.get("minRows"), 1);
        if (rows < minRows) {
            reasons.add("rows " + rows + " < expected " + minRows);
        }
        String expectedStage = stringValue(expectation == null ? null : expectation.get("expectedStage"));
        String actualStage = stringValue(summary == null ? null : summary.get("stage"));
        if (expectedStage != null && actualStage != null && !expectedStage.equals(actualStage)) {
            reasons.add("stage " + actualStage + " != expected " + expectedStage);
        }
        int expectedFieldCount = intValue(expectation == null ? null : expectation.get("expectedFieldCount"), 0);
        if (expectedFieldCount > 0 && fieldCount != expectedFieldCount) {
            reasons.add("fieldCount " + fieldCount + " != expected " + expectedFieldCount);
        }
        Map<String, Object> outcome = new LinkedHashMap<>();
        outcome.put("ok", reasons.isEmpty());
        outcome.put("rows", rows);
        outcome.put("fieldCount", fieldCount);
        outcome.put("reasons", List.copyOf(reasons));
        return outcome;
    }

    private void poll(
        String requestId,
        String daemonRequestId,
        RecorderOwner owner,
        Function<Map<String, Object>, Map<String, Object>> resultMapper,
        BiConsumer<String, Map<String, Object>> terminalObserver
    ) {
        for (int attempt = 0; attempt < maxPolls; attempt++) {
            if (!sleep()) {
                notifyTerminal(terminalObserver, "cancelled", Map.of());
                requestRegistry.finalizeRequest(requestId, "cancelled", null, terminalError("cancelled", null));
                return;
            }
            final Map<String, Object> daemonStatus;
            try {
                daemonStatus = verifyPort.status(owner, daemonRequestId);
            } catch (RecorderVerifyException e) {
                Map<String, Object> normalized = safeTransportError(e.getCode());
                String status = "verify_timeout".equals(normalized.get("code")) ? "timeout" : "failed";
                notifyTerminal(terminalObserver, status, Map.of());
                requestRegistry.finalizeRequest(requestId, status, null, normalized);
                return;
            } catch (RuntimeException e) {
                notifyTerminal(terminalObserver, "failed", Map.of());
                requestRegistry.finalizeRequest(requestId, "failed", null, error("network_error", "verify status request failed"));
                return;
            }
            String status = stringValue(daemonStatus.get("status"));
            if (status == null) {
                notifyTerminal(terminalObserver, "failed", Map.of());
                requestRegistry.finalizeRequest(requestId, "failed", null, error("runner_protocol_error", "verify status is malformed"));
                return;
            }
            if (!TERMINAL.contains(status)) {
                if (!"running".equals(status) && !"pending".equals(status) && !"queued".equals(status)) {
                    notifyTerminal(terminalObserver, "failed", Map.of());
                    requestRegistry.finalizeRequest(requestId, "failed", null, error("runner_protocol_error", "verify status is invalid"));
                    return;
                }
                continue;
            }
            finalizeTerminal(requestId, status, daemonStatus, resultMapper, terminalObserver);
            return;
        }
        notifyTerminal(terminalObserver, "timeout", Map.of());
        requestRegistry.finalizeRequest(requestId, "timeout", null, error("verify_timeout", "verify polling limit reached"));
    }

    private void finalizeTerminal(
        String requestId,
        String status,
        Map<String, Object> daemonStatus,
        Function<Map<String, Object>, Map<String, Object>> resultMapper,
        BiConsumer<String, Map<String, Object>> terminalObserver
    ) {
        Map<String, Object> daemonResult = mapValue(daemonStatus.get("result"));
        if ("succeeded".equals(status)) {
            if (daemonResult == null) {
                notifyTerminal(terminalObserver, "failed", Map.of());
                requestRegistry.finalizeRequest(requestId, "failed", null, error("runner_protocol_error", "verify result is missing"));
                return;
            }
            try {
                Map<String, Object> mapped = resultMapper.apply(daemonResult);
                notifyTerminal(terminalObserver, "succeeded", mapped);
                requestRegistry.finalizeRequest(requestId, "succeeded", mapped, null);
            } catch (RuntimeException e) {
                notifyTerminal(terminalObserver, "failed", Map.of());
                requestRegistry.finalizeRequest(requestId, "failed", null, error("runner_protocol_error", "verify result could not be processed"));
            }
            return;
        }
        Map<String, Object> daemonError = daemonResult == null ? null : mapValue(daemonResult.get("error"));
        if (daemonError == null) {
            daemonError = mapValue(daemonStatus.get("error"));
        }
        notifyTerminal(terminalObserver, status, daemonResult == null ? Map.of() : daemonResult);
        requestRegistry.finalizeRequest(
            requestId,
            status,
            daemonResult,
            terminalError(status, daemonError)
        );
    }

    private void notifyTerminal(
        BiConsumer<String, Map<String, Object>> terminalObserver,
        String status,
        Map<String, Object> payload
    ) {
        try {
            terminalObserver.accept(status, payload);
        } catch (RuntimeException ignored) {
            // Request finalization must not be undone by an observer failure.
        }
    }

    private Map<String, Object> safeError(Map<String, Object> raw) {
        String code = stringValue(raw.get("code"));
        if ("daemon_timeout".equals(code)) {
            return error("verify_timeout", SAFE_TERMINAL_ERRORS.get("verify_timeout"));
        }
        if (code == null || !SAFE_TERMINAL_ERRORS.containsKey(code)) {
            return error("adapter_runtime_error", SAFE_TERMINAL_ERRORS.get("adapter_runtime_error"));
        }
        return error(code, SAFE_TERMINAL_ERRORS.get(code));
    }

    private Map<String, Object> safeTransportError(String code) {
        return safeError(code == null ? Map.of() : Map.of("code", code));
    }

    private Map<String, Object> terminalError(String status, Map<String, Object> daemonError) {
        return switch (status) {
            case "timeout" -> error("verify_timeout", SAFE_TERMINAL_ERRORS.get("verify_timeout"));
            case "cancelled" -> error("adapter_runtime_error", SAFE_TERMINAL_ERRORS.get("adapter_runtime_error"));
            case "failed" -> daemonError == null
                ? error("adapter_runtime_error", SAFE_TERMINAL_ERRORS.get("adapter_runtime_error"))
                : safeError(daemonError);
            default -> error("runner_protocol_error", SAFE_TERMINAL_ERRORS.get("runner_protocol_error"));
        };
    }

    private Map<String, Object> error(String code, String message) {
        return Map.of("code", code, "message", message == null ? "verify failed" : message);
    }

    private boolean sleep() {
        try {
            Thread.sleep(pollMs);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private int intValue(Object value, int fallback) {
        return value instanceof Number number ? number.intValue() : fallback;
    }

    private String stringValue(Object value) {
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private Map<String, Object> mapValue(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        raw.forEach((key, item) -> {
            if (key instanceof String text) {
                result.put(text, item);
            }
        });
        return result;
    }

    @PreDestroy
    void shutdown() {
        if (ownsExecutor) {
            executor.shutdownNow();
        }
    }
}
