package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class SessionLifecycleLocksTest {

    @Test
    void completedFailedAndReentrantCallsDoNotRetainSessionEntries() {
        SessionLifecycleLocks locks = new SessionLifecycleLocks();
        Map<?, ?> entries = (Map<?, ?>) ReflectionTestUtils.getField(locks, "entries");

        assertThat(locks.withLock("nested", () -> locks.withLock("nested", () -> 42))).isEqualTo(42);
        assertThat(entries).isEmpty();
        assertThrows(IllegalStateException.class, () -> locks.withLock("failed", () -> {
            throw new IllegalStateException("Redis unavailable");
        }));
        assertThat(entries).isEmpty();
        for (int session = 0; session < 1000; session++) {
            locks.withLock(String.valueOf(session), () -> null);
        }
        assertThat(entries).isEmpty();
    }
}
