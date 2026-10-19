package com.iwhalecloud.byai.gateway.sandbox.recovery;

import static org.assertj.core.api.Assertions.*;
import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.common.RedisClient;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import redis.clients.jedis.StreamEntryID;
import redis.clients.jedis.params.*;

/** Run only against a disposable Redis: -Drecovery.test.redis.port=16389. Never uses application credentials. */
@EnabledIfSystemProperty(named = "recovery.test.redis.port", matches = "[0-9]+")
class SandboxRecoveryRedisTest {
    @Test void actualRedisPaginationAndStaleAckProtection() {
        RedisClient redis = new RedisClient("127.0.0.1", Integer.parseInt(System.getProperty("recovery.test.redis.port")));
        String stream = Constants.QueueNames.ctrlStream("BYCLAW_DSH_recovery-test-" + UUID.randomUUID());
        var commands = redis.getCommands();
        try {
            var store = new SandboxRecoveryStore(redis);
            var first = commands.xadd(stream, StreamEntryID.NEW_ENTRY, Map.of("data", "{}"));
            var second = commands.xadd(stream, StreamEntryID.NEW_ENTRY, Map.of("data", "{}"));
            commands.xgroupCreate(stream, "test-group", new StreamEntryID("0-0"), false);
            commands.xreadGroup("test-group", "old-worker", new XReadGroupParams().count(1),
                Map.of(stream, StreamEntryID.UNRECEIVED_ENTRY));
            commands.xclaim(stream, "test-group", "old-worker", 0, new XClaimParams().idle(120000), first);
            var observed = store.pending(stream, "test-group", first.toString());
            assertThat(store.messages(stream, "test-group", "WAITING", null).items())
                .extracting(SandboxRecoveryStore.Message::id).containsExactly(second.toString());
            commands.xclaim(stream, "test-group", "new-worker", 0, new XClaimParams().idle(120000), first);
            assertThat(store.acknowledge(stream, "test-group", observed)).isFalse();
            var current = store.pending(stream, "test-group", first.toString());
            assertThat(current.consumer()).isEqualTo("new-worker");
            assertThat(store.acknowledge(stream, "test-group", current)).isTrue();
            assertThat(commands.xlen(stream)).isEqualTo(2); // ACK did not delete original payload.
            assertThat(commands.xpending(stream, "test-group").getTotal()).isZero();
        } finally { commands.del(stream); redis.close(); }
    }
}
