package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

class DshActivityStateStoreTest {

    private static final String KEY = DshActivityStateStore.DEFAULT_STATE_KEY;

    private StringRedisTemplate redis;
    private HashOperations<String, Object, Object> hash;
    private DshActivityStateStore store;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        hash = mock(HashOperations.class);
        when(redis.<Object, Object>opsForHash()).thenReturn(hash);
        store = new DshActivityStateStore(redis);
    }

    @Test
    @SuppressWarnings("unchecked")
    void recordHandsJsonAndStreamIdToTheAtomicCompareAndSetScript() {
        DshActivity activity = new DshActivity("user001", "busy", 1_000L, "1700000000000-1",
            "2026-10-15T08:00:00.000Z", "2026-10-15T07:59:00.000Z", null, null);
        when(redis.execute(any(RedisScript.class), eq(List.of(KEY)), eq("byclaw-dsh-user001"), anyString(),
            eq("1700000000000-1"))).thenReturn(1L);

        assertThat(store.record("byclaw-dsh-user001", activity)).isTrue();

        ArgumentCaptor<Object> json = ArgumentCaptor.forClass(Object.class);
        verify(redis).execute(any(RedisScript.class), eq(List.of(KEY)), eq("byclaw-dsh-user001"), json.capture(),
            eq("1700000000000-1"));
        verify(hash, never()).put(anyString(), anyString(), anyString());
        assertThat(json.getValue().toString()).doesNotContain("\"busy\":true").doesNotContain("fresh");
        when(hash.get(KEY, "byclaw-dsh-user001")).thenReturn(json.getValue());
        assertThat(store.find("byclaw-dsh-user001")).isEqualTo(activity);
    }

    @Test
    @SuppressWarnings("unchecked")
    void recordReportsAnEntryTheScriptRejectedAsOutOfOrder() {
        DshActivity older = new DshActivity("user001", "releasable", 3_000L, "1700000000004-9", null, null, null, null);
        when(redis.execute(any(RedisScript.class), eq(List.of(KEY)), eq("w"), anyString(), eq("1700000000004-9")))
            .thenReturn(0L);

        assertThat(store.record("w", older)).isFalse();
    }

    @Test
    void malformedOrOwnerlessValuesReadAsNeverReported() {
        Map<Object, Object> values = new LinkedHashMap<>();
        values.put("good", json(new DshActivity("u1", "busy", 1L, "1-0", null, null, null, null)));
        values.put("broken", "{not json");
        values.put("ownerless", json(new DshActivity("", "busy", 1L, "1-0", null, null, null, null)));
        when(hash.entries(KEY)).thenReturn(values);
        when(hash.get(KEY, "broken")).thenReturn("{not json");

        assertThat(store.entries()).containsOnlyKeys("good");
        assertThat(store.find("broken")).isNull();
        assertThat(store.find(" ")).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void removeIfUnchangedComparesTheStreamIdInsideRedis() {
        DshActivity seen = new DshActivity("u1", "busy", 1L, "1-0", null, null, null, null);
        when(redis.execute(any(RedisScript.class), eq(List.of(KEY)), eq("w"), eq("1-0"))).thenReturn(0L, 1L);

        assertThat(store.removeIfUnchanged("w", seen)).isFalse();
        assertThat(store.removeIfUnchanged("w", seen)).isTrue();
        assertThat(store.removeIfUnchanged(" ", seen)).isFalse();
        verify(hash, never()).delete(anyString(), any());
    }

    @Test
    void freshnessAndStreamIdTime() {
        DshActivity activity = new DshActivity("u1", "releasable", 10_000L, "5-3", null, null, null, null);

        assertThat(activity.isFresh(100_000L, 90_000L)).isTrue();
        assertThat(activity.isFresh(100_001L, 90_000L)).isFalse();
        assertThat(activity.isReleasable()).isTrue();
        assertThat(activity.isBusy()).isFalse();
        assertThat(DshActivity.streamIdMillis("1700000000000-7")).isEqualTo(1_700_000_000_000L);
        assertThat(DshActivity.streamIdMillis("1700000000000")).isEqualTo(1_700_000_000_000L);
        assertThat(DshActivity.streamIdMillis("garbage")).isEqualTo(-1L);
        assertThat(DshActivity.streamIdMillis("0-0")).isEqualTo(-1L);
        assertThat(DshActivity.streamIdMillis(" ")).isEqualTo(-1L);
    }

    @Test
    void busyHeartbeatTimeIsKeptBesideTheStateAndRemovedWithIt() {
        String busyKey = DshActivityStateStore.DEFAULT_BUSY_HEARTBEAT_KEY;

        store.touchBusyHeartbeat("w", 1_234L);
        verify(hash).put(busyKey, "w", "1234");

        when(hash.get(busyKey, "w")).thenReturn("1234");
        assertThat(store.busyHeartbeatAt("w")).isEqualTo(1_234L);
        when(hash.get(busyKey, "w")).thenReturn("x");
        assertThat(store.busyHeartbeatAt("w")).isZero();
        assertThat(store.busyHeartbeatAt("never")).isZero();
        assertThat(store.busyHeartbeatAt(" ")).isZero();

        store.remove("w");
        verify(hash).delete(KEY, "w");
        verify(hash).delete(busyKey, "w");
    }

    private static String json(DshActivity activity) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(activity);
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
