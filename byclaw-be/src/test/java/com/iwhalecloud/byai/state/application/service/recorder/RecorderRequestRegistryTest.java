package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import org.junit.jupiter.api.Test;

class RecorderRequestRegistryTest {

    private static final RecorderOwner ALICE = new RecorderOwner(1L, "alice");

    @Test
    void requestRegistrationAndOwnedLookupRequireOwner() {
        RecorderRequestRegistry registry = new RecorderRequestRegistry();

        assertThatNullPointerException().isThrownBy(() -> registry.createRunning("req", "verify", null));
        assertThatNullPointerException().isThrownBy(() -> registry.getOwned("req", null));
    }

    @Test
    void expirationReadAndSnapshotUseTheRequestMonitor() throws Exception {
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        registry.createRunning("req-locked", "verify", ALICE);
        Map<String, Object> request = storedRequest(registry, "req-locked");
        synchronized (request) {
            request.put("expiresAt", new MonitorCheckingNumber(request, Long.MAX_VALUE));
        }

        assertThat(registry.getOwned("req-locked", ALICE)).isPresent();
    }

    @Test
    void resultAndReturnedValuesAreRecursiveSnapshots() {
        RecorderRequestRegistry registry = new RecorderRequestRegistry();
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("verify", new LinkedHashMap<>(Map.of("ok", false)));
        List<Map<String, Object>> drafts = new ArrayList<>();
        drafts.add(draft);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("drafts", drafts);

        Map<String, Object> created = registry.createSucceeded("req-1", "pipeline", result, ALICE);
        ((Map<String, Object>) draft.get("verify")).put("ok", true);
        drafts.add(Map.of("id", "late"));

        Map<String, Object> firstRead = registry.getOwned("req-1", ALICE).orElseThrow();
        Map<String, Object> firstResult = castMap(firstRead.get("result"));
        List<Object> firstDrafts = castList(firstResult.get("drafts"));
        castMap(castMap(firstDrafts.getFirst()).get("verify")).put("ok", true);
        firstDrafts.add(Map.of("id", "reader-mutation"));

        Map<String, Object> secondResult = castMap(registry.getOwned("req-1", ALICE).orElseThrow().get("result"));
        List<Object> secondDrafts = castList(secondResult.get("drafts"));
        assertThat(secondDrafts).hasSize(1);
        assertThat(castMap(castMap(secondDrafts.getFirst()).get("verify"))).containsEntry("ok", false);

        Map<String, Object> nestedError = new LinkedHashMap<>();
        nestedError.put("details", new ArrayList<>(List.of("original")));
        registry.createRunning("req-2", "verify", ALICE);
        registry.finalizeRequest("req-2", "failed", null, nestedError);
        ((List<Object>) nestedError.get("details")).add("writer-mutation");
        Map<String, Object> returnedError = castMap(registry.getOwned("req-2", ALICE).orElseThrow().get("error"));
        castList(returnedError.get("details")).add("reader-mutation");

        Map<String, Object> storedError = castMap(registry.getOwned("req-2", ALICE).orElseThrow().get("error"));
        assertThat(castList(storedError.get("details"))).containsExactly("original");
        assertThat(registry.getOwned("req-1", new RecorderOwner(2L, "bob"))).isEmpty();
        assertThat(registry.getOwned("req-1", new RecorderOwner(1L, "alice-renamed"))).isEmpty();
        assertThat(created.keySet()).doesNotContain("owner", "ownerUserId", "ownerUserCode", "_owner");
        assertThat(firstRead.keySet()).doesNotContain("owner", "ownerUserId", "ownerUserCode", "_owner");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private List<Object> castList(Object value) {
        return (List<Object>) value;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> storedRequest(RecorderRequestRegistry registry, String requestId) throws Exception {
        Field requests = RecorderRequestRegistry.class.getDeclaredField("requests");
        requests.setAccessible(true);
        return ((Map<String, Map<String, Object>>) requests.get(registry)).get(requestId);
    }

    private static final class MonitorCheckingNumber extends Number {
        private final Object monitor;
        private final long value;

        private MonitorCheckingNumber(Object monitor, long value) {
            this.monitor = monitor;
            this.value = value;
        }

        @Override
        public int intValue() {
            return Math.toIntExact(longValue());
        }

        @Override
        public long longValue() {
            if (!Thread.holdsLock(monitor)) {
                throw new AssertionError("expiresAt was read without the request monitor");
            }
            return value;
        }

        @Override
        public float floatValue() {
            return longValue();
        }

        @Override
        public double doubleValue() {
            return longValue();
        }
    }
}
