package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import lombok.extern.slf4j.Slf4j;

/**
 * 记录 terminal 事件的落库完成标记，供 ACK 失败后的重投判断是否需要再次落库。
 * <p>
 * {@link ChatProcessContext#terminalStreamId} 与 {@link ChatProcessContext#tryBeginPersist()}
 * 都是内存状态，进程重启后一律失效；而快照水位线会随快照恢复。若只依赖内存状态，
 * 重启后重投的 terminal 事件会因命中水位线被当作普通重复事件 ACK 掉，导致回答永不落库。
 * <p>
 * 每个 session 一个独立 key，只做单 key 读写，满足 Redis Cluster 约束。
 */
@Slf4j
@Service
public class TerminalPersistMarkerService {

    private static final String MARKER_KEY_PREFIX = "byai:chat:terminal-done:";

    /**
     * 标记保留时长。需要覆盖「落库成功但 ACK 持续失败」到 pending recovery 完成补捞的窗口，
     * 同时有界过期，避免长期占用 Redis 内存。
     */
    private static final long MARKER_TTL_HOURS = 24L;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    /**
     * 落库成功后写入标记。必须在持久化成功之后、ACK 之前调用，
     * 以免进程在落库前崩溃却留下「已完成」的痕迹。
     */
    public void markPersisted(Long sessionId, String streamId) {
        if (sessionId == null || streamId == null) {
            return;
        }
        try {
            redisTemplate.opsForValue()
                .set(buildKey(sessionId), streamId, MARKER_TTL_HOURS, TimeUnit.HOURS);
        }
        catch (Exception e) {
            // 标记写入失败只会让重投多走一次落库，由 upsert 与内存闸门兜底，不应中断收尾流程。
            log.warn("写入 terminal 落库标记失败, sessionId: {}, streamId: {}", sessionId, streamId, e);
        }
    }

    /**
     * 判断该 terminal 事件是否已完成落库。
     * <p>
     * 查询异常时返回 false，宁可重复走一次落库（由 upsert 和内存闸门保护），
     * 也不能误判为已完成而把未落库的消息 ACK 掉。
     */
    public boolean isPersisted(Long sessionId, String streamId) {
        if (sessionId == null || streamId == null) {
            return false;
        }
        try {
            Object marker = redisTemplate.opsForValue().get(buildKey(sessionId));
            return marker != null && streamId.equals(String.valueOf(marker));
        }
        catch (Exception e) {
            log.warn("读取 terminal 落库标记失败, sessionId: {}, streamId: {}", sessionId, streamId, e);
            return false;
        }
    }

    public void clear(Long sessionId) {
        if (sessionId == null) {
            return;
        }
        try {
            redisTemplate.delete(buildKey(sessionId));
        }
        catch (Exception e) {
            log.warn("清理 terminal 落库标记失败, sessionId: {}", sessionId, e);
        }
    }

    public String buildKey(Long sessionId) {
        return MARKER_KEY_PREFIX + sessionId;
    }
}
