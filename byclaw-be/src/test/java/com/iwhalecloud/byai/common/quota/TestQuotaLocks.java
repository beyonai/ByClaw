package com.iwhalecloud.byai.common.quota;

import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.integration.redis.util.RedisLockRegistry;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Test-only registry substitute; retains the real transaction synchronization lifecycle. */
public final class TestQuotaLocks {
    private TestQuotaLocks() { }
    public static TransactionalRedisLockService create() {
        var registry = mock(RedisLockRegistry.class);
        var locks = new ConcurrentHashMap<String, ReentrantLock>();
        when(registry.obtain(anyString())).thenAnswer(call ->
            locks.computeIfAbsent(call.getArgument(0), ignored -> new ReentrantLock()));
        return new TransactionalRedisLockService(registry);
    }
}
