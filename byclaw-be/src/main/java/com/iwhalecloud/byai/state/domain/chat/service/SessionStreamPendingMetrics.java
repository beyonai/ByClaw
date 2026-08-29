package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Objects;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.stream.StreamInfo.XInfoGroup;
import org.springframework.data.redis.connection.stream.StreamInfo.XInfoGroups;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 低频汇总当前实例活跃 Session Stream 的 Consumer Group pending 数量。
 * <p>
 * 只有全部 Stream 都采样成功时才更新 gauge，避免 Redis 局部故障期间发布不完整的总量。
 */
@Component
public class SessionStreamPendingMetrics {

    private static final Logger log = LoggerFactory.getLogger(SessionStreamPendingMetrics.class);

    private final SessionStreamManager sessionStreamManager;
    private final RedisTemplate<String, Object> redisTemplate;
    private final SessionStreamMetrics sessionStreamMetrics;

    public SessionStreamPendingMetrics(SessionStreamManager sessionStreamManager,
        RedisTemplate<String, Object> redisTemplate, SessionStreamMetrics sessionStreamMetrics) {
        this.sessionStreamManager = sessionStreamManager;
        this.redisTemplate = redisTemplate;
        this.sessionStreamMetrics = sessionStreamMetrics;
    }

    @Scheduled(
        initialDelayString = "${byclaw.session-stream.metrics.pending-sample-initial-delay-ms:30000}",
        fixedDelayString = "${byclaw.session-stream.metrics.pending-sample-interval-ms:30000}")
    void samplePending() {
        Set<String> sessionIds = sessionStreamManager.activeSessionIdsSnapshot();
        if (sessionIds.isEmpty()) {
            sessionStreamMetrics.updatePendingTotal(0L);
            return;
        }

        long pendingTotal = 0L;
        boolean complete = true;
        for (String sessionId : sessionIds) {
            String streamKey = sessionStreamManager.buildStreamKey(sessionId);
            try {
                XInfoGroups groups = redisTemplate.opsForStream().groups(streamKey);
                pendingTotal += groups.stream()
                    .filter(group -> SessionStreamManager.CONSUMER_GROUP.equals(group.groupName()))
                    .map(XInfoGroup::pendingCount)
                    .filter(Objects::nonNull)
                    .findFirst()
                    .orElse(0L);
            }
            catch (Exception e) {
                complete = false;
                sessionStreamMetrics.recordPendingSampleFailure();
                log.warn("采样 Session Stream pending 失败, sessionId: {}, stream: {}, errorType: {}, "
                        + "errorMessage: {}",
                    sessionId, streamKey, e.getClass().getSimpleName(), e.getMessage());
            }
        }

        if (complete) {
            sessionStreamMetrics.updatePendingTotal(pendingTotal);
        }
    }
}
