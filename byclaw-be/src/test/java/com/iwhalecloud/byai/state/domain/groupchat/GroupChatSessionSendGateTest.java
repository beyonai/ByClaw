package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.*;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionSendGate;

/** Two Redis owners remain exclusive beyond the initial lease and release on failed sends. */
class GroupChatSessionSendGateTest {
    @Test
    void separateServiceInstancesSerializeSameSessionAndReleaseAfterFailure() throws Exception {
        try (var redis = new com.iwhalecloud.byai.common.lock.DisposableRedis()) {
        var sending = new GroupChatSessionSendGate(new com.iwhalecloud.byai.common.lock.TransactionalRedisLockService(redis.registry(600L)));
        var stopping = new GroupChatSessionSendGate(new com.iwhalecloud.byai.common.lock.TransactionalRedisLockService(redis.registry(600L)));
        var attempted = new CountDownLatch(1);
        var acquired = new CountDownLatch(1);
        var worker = Executors.newSingleThreadExecutor();
        try {
            var send = sending.acquire(20L);
            var stop = worker.submit(() -> {
                attempted.countDown();
                try (var lease = stopping.acquire(20L)) { acquired.countDown(); }
                return null;
            });
            assertThat(attempted.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(acquired.await(1500, TimeUnit.MILLISECONDS)).isFalse();
            // 其他子会话不被同一个锁阻塞。
            try (var independent = stopping.acquire(21L)) { assertThat(acquired.getCount()).isEqualTo(1); }
            send.close();
            stop.get(3, TimeUnit.SECONDS);
            assertThat(acquired.getCount()).isZero();
            assertThatThrownBy(() -> {
                try (var lease = sending.acquire(20L)) { throw new IllegalStateException("send failed"); }
            }).hasMessage("send failed");
            try (var afterFailure = stopping.acquire(20L)) { assertThat(afterFailure).isNotNull(); }
        } finally {
            worker.shutdownNow();
        }
        }
    }
}
