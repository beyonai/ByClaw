package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

import lombok.extern.slf4j.Slf4j;

/**
 * 记录 ACK 重试耗尽的 Stream 消息，供 pending recovery 定向补捞。
 * <p>
 * 活跃 listener 的 ACK 失败无法靠心跳超时被发现：keepAlive 会持续刷新运行态心跳，
 * 该 session 永远不会被判定为 stale，因此必须由 listener 主动登记失败消息，
 * 让 {@link SessionStreamRecoveryService} 知道这个 session 仍有需要补捞的 pending。
 * <p>
 * 以 Stream Key 为索引，与 claim 操作使用的维度一致；recovery 侧可直接用 Stream Key 查询。
 */
@Slf4j
@Component
public class StreamAckFailureRegistry {

    /** 单个 Stream Key 最多登记的失败消息数，防止异常情况下无界增长。 */
    private static final int MAX_FAILURES_PER_STREAM = 256;

    /** streamKey -> ACK 重试耗尽的 Stream ID 集合 */
    private final Map<String, Set<String>> failuresByStreamKey = new ConcurrentHashMap<>();

    public void record(String streamKey, String streamId) {
        if (streamKey == null || streamId == null) {
            return;
        }
        Set<String> failures = failuresByStreamKey.computeIfAbsent(streamKey,
            key -> ConcurrentHashMap.newKeySet());
        if (failures.size() >= MAX_FAILURES_PER_STREAM) {
            log.warn("ACK 失败登记已达上限，丢弃本条登记, stream: {}, streamId: {}, limit: {}", streamKey, streamId,
                MAX_FAILURES_PER_STREAM);
            return;
        }
        failures.add(streamId);
    }

    /**
     * 返回当前登记的失败 Stream ID 快照；返回副本，调用方遍历期间不受并发登记影响。
     */
    public Set<String> snapshot(String streamKey) {
        Set<String> failures = streamKey == null ? null : failuresByStreamKey.get(streamKey);
        return failures == null ? Collections.emptySet() : Set.copyOf(failures);
    }

    public boolean hasFailures(String streamKey) {
        Set<String> failures = streamKey == null ? null : failuresByStreamKey.get(streamKey);
        return failures != null && !failures.isEmpty();
    }

    public void clear(String streamKey, String streamId) {
        if (streamKey == null || streamId == null) {
            return;
        }
        // 先移除元素，再按空集合回收整个条目，避免 session 结束后残留空 Set。
        failuresByStreamKey.computeIfPresent(streamKey, (key, failures) -> {
            failures.remove(streamId);
            return failures.isEmpty() ? null : failures;
        });
    }

    public void clearAll(String streamKey) {
        if (streamKey != null) {
            failuresByStreamKey.remove(streamKey);
        }
    }
}
