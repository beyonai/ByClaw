package com.iwhalecloud.byai.gateway.sandbox.recovery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.common.RedisClient;
import java.util.*;
import org.junit.jupiter.api.Test;
import redis.clients.jedis.StreamEntryID;
import redis.clients.jedis.commands.JedisCommands;
import redis.clients.jedis.params.XPendingParams;
import redis.clients.jedis.resps.*;

class SandboxRecoveryStoreTest {
    final RedisClient redis = mock(RedisClient.class);
    final JedisCommands commands = mock(JedisCommands.class);
    final SandboxRecoveryStore store = new SandboxRecoveryStore(redis);
    final String stream = Constants.QueueNames.ctrlStream("BYCLAW_DSH_test-user");
    SandboxRecoveryStoreTest() { when(redis.getCommands()).thenReturn(commands); }
    @Test void returnsStandaloneConnectionAfterSuccessAndFailure() {
        var pooled = mock(redis.clients.jedis.Jedis.class);
        when(redis.getCommands()).thenReturn(pooled);
        when(pooled.exists(anyString())).thenReturn(true).thenThrow(new IllegalStateException("redis unavailable"));
        assertThat(store.workerOnline("worker")).isTrue();
        verify(pooled).close();
        assertThatThrownBy(() -> store.workerOnline("worker")).isInstanceOf(IllegalStateException.class);
        verify(pooled, times(2)).close();
    }
    @Test void doesNotCloseSharedClusterClient() {
        var cluster = mock(redis.clients.jedis.JedisCluster.class);
        when(redis.getCommands()).thenReturn(cluster);
        store.workerOnline("worker");
        verify(cluster, never()).close();
    }
    @Test void rejectsArbitraryRedisKeysBeforeAccess() {
        assertThatThrownBy(() -> store.pending("some-secret", "g", "1-0")).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(commands);
        assertThat(SandboxRecoveryStore.kind(stream)).isEqualTo("COMMAND");
        assertThat(SandboxRecoveryStore.kind(Constants.QueueNames.workerCtrlStream("byclaw-dsh-test"))).isEqualTo("COMMAND");
    }
    @Test void returnsTrimmedPendingEntryRatherThanHidingIt() {
        var info = mock(StreamGroupInfo.class);
        when(info.getName()).thenReturn("g");
        when(commands.xinfoGroups(stream)).thenReturn(List.of(info));
        when(commands.xpending(eq(stream), eq("g"), any(XPendingParams.class)))
            .thenReturn(List.of(new StreamPendingEntry(new StreamEntryID("1-0"), "worker", 100000, 3)));
        when(commands.xrange(eq(stream), any(StreamEntryID.class), any(StreamEntryID.class), eq(1))).thenReturn(List.of());
        var result = store.messages(stream, "g", "PENDING", null);
        assertThat(result.items()).hasSize(1);
        assertThat(result.items().getFirst().fields()).isEmpty();
        verify(commands, never()).xreadGroup(any(), any(), any(), any());
        verify(commands, never()).xack(any(), any(), any());
    }
    @Test void ackScriptComparesConsumerAndDeliveryGenerationAndNeverDeletesPayload() {
        var entry = new SandboxRecoveryStore.Message("1-0", "old", 100000, 3, "PENDING", Map.of());
        when(commands.eval(anyString(), anyList(), anyList())).thenReturn(0L);
        assertThat(store.acknowledge(stream, "g", entry)).isFalse();
        verify(commands).eval(argThat(lua -> lua.contains("XPENDING") && lua.contains("p[1][2]")
            && lua.contains("p[1][4]") && lua.contains("XACK") && !lua.contains("XDEL")),
            eq(List.of(stream)), eq(List.of("g", "1-0", "old", "3")));
    }
    @Test void successfulAuditClearsPreviousErrorInsteadOfDisplayingStaleFailure() {
        store.audit(stream, "g", "1-0", Map.of("outcome", "WAKE_REQUESTED"));
        verify(commands).hset(anyString(), argThat(values -> "".equals(values.get("error"))
            && "WAKE_REQUESTED".equals(values.get("outcome"))));
    }

}
