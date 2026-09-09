package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Per-session I/O serialization; entries exist only while callers hold or wait for their lock. */
final class SessionLifecycleLocks {

    private final ConcurrentHashMap<String, Entry> entries = new ConcurrentHashMap<>();

    <T> T withLock(String sessionId, Supplier<T> action) {
        Entry entry = entries.compute(sessionId, (key, current) -> {
            Entry retained = current == null ? new Entry() : current;
            retained.users++;
            return retained;
        });
        entry.mutex.lock();
        try {
            return action.get();
        }
        finally {
            entry.mutex.unlock();
            // Waiters retain the same entry before parking, so removal cannot create overlapping locks.
            entries.compute(sessionId, (key, current) -> --entry.users == 0 ? null : entry);
        }
    }

    private static final class Entry {
        private final ReentrantLock mutex = new ReentrantLock(true);
        private int users;
    }
}
