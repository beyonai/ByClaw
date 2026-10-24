package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.util.RedisUtil;
import java.util.HashMap;
import java.util.Map;
import org.mockito.MockedStatic;

/** Exercises business code through the shared RedisUtil boundary, without an external Redis process. */
class ModelHealthRedisFixture implements AutoCloseable {
    final Map<String, Map<String, String>> hashes = new HashMap<>();
    final Map<String, String> locks = new HashMap<>();
    final MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class);

    ModelHealthRedisFixture() {
        redis.when(() -> RedisUtil.hmGet(anyString(), anyString())).thenAnswer(call ->
            hashes.getOrDefault(call.getArgument(0), Map.of()).get(call.getArgument(1)));
        redis.when(() -> RedisUtil.hmPut(anyString(), anyString(), anyString())).thenAnswer(call -> {
            hashes.computeIfAbsent(call.getArgument(0), key -> new HashMap<>()).put(call.getArgument(1), call.getArgument(2));
            return null;
        });
        redis.when(() -> RedisUtil.hmPutAll(anyString(), anyMap())).thenAnswer(call -> {
            hashes.computeIfAbsent(call.getArgument(0), key -> new HashMap<>()).putAll(call.getArgument(1));
            return null;
        });
        redis.when(() -> RedisUtil.lock(anyString(), anyString(), anyLong())).thenAnswer(call ->
            locks.putIfAbsent(call.getArgument(0), call.getArgument(1)) == null);
        redis.when(() -> RedisUtil.releaseLock(anyString(), anyString())).thenAnswer(call ->
            locks.remove(call.getArgument(0), call.getArgument(1)));
        redis.when(() -> RedisUtil.expire(anyString(), anyLong(), any())).thenReturn(true);
    }

    @Override public void close() { redis.close(); }
}
