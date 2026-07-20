package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.Objects;
import org.springframework.stereotype.Component;

@Component
public class RecorderRequestRegistry {

    private static final long TERMINAL_TTL_MS = 300_000L;
    private static final String OWNER_KEY = "_owner";

    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, Map<String, Object>> requests = new ConcurrentHashMap<>();

    public String nextRequestId() {
        return nextId("req");
    }

    public Map<String, Object> createSucceeded(
        String requestId,
        String type,
        Map<String, Object> result,
        RecorderOwner owner
    ) {
        createRunning(requestId, type, owner);
        return finalizeRequest(requestId, "succeeded", result, null);
    }

    public Map<String, Object> createRunning(String requestId, String type, RecorderOwner owner) {
        Objects.requireNonNull(owner, "owner");
        long now = Instant.now().toEpochMilli();
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("requestId", requestId);
        request.put("type", type);
        request.put("status", "running");
        request.put("startedAt", now);
        request.put("updatedAt", now);
        request.put("expiresAt", null);
        request.put("pollAfterMs", 100L);
        request.put("result", null);
        request.put("error", null);
        request.put("progress", List.of(Map.of("stage", type, "status", "running")));
        request.put(OWNER_KEY, owner);
        requests.put(requestId, request);
        return snapshot(request);
    }

    public Map<String, Object> finalizeRequest(
        String requestId,
        String status,
        Map<String, Object> result,
        Map<String, Object> error
    ) {
        Map<String, Object> request = requests.computeIfPresent(requestId, (id, current) -> {
            synchronized (current) {
                long now = Instant.now().toEpochMilli();
                current.put("status", status);
                current.put("updatedAt", now);
                current.put("expiresAt", now + TERMINAL_TTL_MS);
                current.put("result", deepCopyValue(result));
                current.put("error", deepCopyValue(error));
                current.put("progress", List.of(Map.of(
                    "stage", current.get("type"),
                    "status", "succeeded".equals(status) ? "done" : status,
                    "durationMs", Math.max(1L, now - ((Number) current.get("startedAt")).longValue())
                )));
                return current;
            }
        });
        return request == null ? Map.of() : snapshot(request);
    }

    public Optional<Map<String, Object>> get(String requestId) {
        return find(requestId, null);
    }

    public Optional<Map<String, Object>> getOwned(String requestId, RecorderOwner owner) {
        Objects.requireNonNull(owner, "owner");
        return find(requestId, owner);
    }

    private Optional<Map<String, Object>> find(String requestId, RecorderOwner owner) {
        Map<String, Object> request = requests.get(requestId);
        if (request == null) {
            return Optional.empty();
        }
        synchronized (request) {
            if (owner != null && !(request.get(OWNER_KEY) instanceof RecorderOwner storedOwner && storedOwner.sameAs(owner))) {
                return Optional.empty();
            }
            Object expiresAt = request.get("expiresAt");
            if (expiresAt instanceof Number number && Instant.now().toEpochMilli() > number.longValue()) {
                requests.remove(requestId, request);
                return Optional.empty();
            }
            return Optional.of(deepCopyMap(request));
        }
    }

    private Map<String, Object> snapshot(Map<String, Object> request) {
        synchronized (request) {
            return deepCopyMap(request);
        }
    }

    private Map<String, Object> deepCopyMap(Map<?, ?> source) {
        Map<String, Object> copy = new LinkedHashMap<>();
        source.forEach((key, value) -> {
            if (key instanceof String text && !OWNER_KEY.equals(text)) {
                copy.put(text, deepCopyValue(value));
            }
        });
        return copy;
    }

    private Object deepCopyValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return deepCopyMap(map);
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            list.forEach(item -> copy.add(deepCopyValue(item)));
            return copy;
        }
        if (value instanceof Set<?> set) {
            Set<Object> copy = new LinkedHashSet<>();
            set.forEach(item -> copy.add(deepCopyValue(item)));
            return copy;
        }
        return value;
    }

    private String nextId(String prefix) {
        return prefix + "_" + Long.toString(System.currentTimeMillis(), 36) + "_" + Long.toString(sequence.incrementAndGet(), 36);
    }
}
