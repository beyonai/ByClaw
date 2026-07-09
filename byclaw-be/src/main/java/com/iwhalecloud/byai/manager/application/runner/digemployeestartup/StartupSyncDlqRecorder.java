package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 启动期同步失败 DLQ 记录器（PR-4）。
 * <p>
 * 失败原因（如单 chunk 处理失败、整页 prefetch 失败、时长超时、Pipeline 失败）写入
 * Redis List {@code byai:dig-employee:startup-sync:dlq}，单条记录为 JSON-like 分隔文本。
 * <p>
 * 调用方契约：
 * <ul>
 *     <li>{@link #recordFailure} 失败时仅记 warn 日志，<strong>不抛出异常</strong>，确保不阻塞同步主流程</li>
 *     <li>{@link #getDlqSize} 仅返回 List 当前长度（LRANGE 0 -1 后取 size）</li>
 *     <li>{@link #getRecentFailures} 拉取最多 N 条最近失败</li>
 *     <li>List 容量上限 1000 条（PRPUSH 后 LTRIM 截断），避免内存膨胀</li>
 * </ul>
 *
 * <p>数据结构（每条）: {@code <resourceId>|<bizType>|<reason>|<failureTimeISO8601>}
 */
@Component
public class StartupSyncDlqRecorder {

    private static final Logger logger = LoggerFactory.getLogger(StartupSyncDlqRecorder.class);

    /** DLQ Redis key, 命名与 PRD §4.4 一致 */
    public static final String DLQ_KEY = "byai:dig-employee:startup-sync:dlq";

    /** DLQ 容量上限 (FIFO 截断) */
    private static final long DLQ_MAX_SIZE = 1000L;

    private final StringRedisTemplate redisTemplate;
    private final DigEmployeeStartupSyncProperties properties;

    public StartupSyncDlqRecorder(StringRedisTemplate redisTemplate,
                                 DigEmployeeStartupSyncProperties properties) {
        this.redisTemplate = redisTemplate;
        this.properties = properties;
    }

    /**
     * 记录一次失败到 DLQ。
     *
     * @param resourceId 失败资源 ID (主资源 / 关联资源均可,纯 metadata)
     * @param bizType 失败资源所属业务类型 (DIG_EMPLOYEE / TOOLKIT / MCP / AGENT / KG_* / VIEW / OBJECT / SKILL)
     * @param reason 失败原因 (异常 message / "TIMEOUT" / "DLQ_FULL" 等)
     */
    public void recordFailure(Long resourceId, String bizType, String reason) {
        if (properties == null || !Boolean.TRUE.equals(properties.getDlqEnabled())) {
            // 关闭 DLQ → 仅记 warn, 不写 Redis
            logger.debug("DLQ 已关闭, 仅记 warn 日志: resourceId={}, bizType={}, reason={}",
                resourceId, bizType, reason);
            return;
        }
        try {
            String entry = String.join("|",
                String.valueOf(resourceId == null ? "" : resourceId),
                String.valueOf(bizType == null ? "" : bizType),
                String.valueOf(reason == null ? "" : reason.replace('|', '/')),
                Instant.now().toString());
            // RPUSH + LTRIM (保留最近 DLQ_MAX_SIZE 条) - 一次 pipeline 减少网络往返
            redisTemplate.opsForList().rightPush(DLQ_KEY, entry);
            redisTemplate.opsForList().trim(DLQ_KEY, -DLQ_MAX_SIZE, -1);
        }
        catch (Exception e) {
            logger.warn("DLQ 写入失败(不阻塞同步主流程): resourceId={}, bizType={}, reason={}, err={}",
                resourceId, bizType, reason, e.getMessage(), e);
        }
    }

    /**
     * 获取当前 DLQ 长度 (LRANGE 0 -1 + size)。
     * 失败返回 -1。
     */
    public long getDlqSize() {
        try {
            Long size = redisTemplate.opsForList().size(DLQ_KEY);
            return size == null ? -1L : size;
        }
        catch (Exception e) {
            logger.warn("DLQ size 查询失败: {}", e.getMessage(), e);
            return -1L;
        }
    }

    /**
     * 拉取最多 N 条最近失败记录（按 RPUSH 顺序倒序 - 最新失败在前）。
     * 失败返回空列表。
     *
     * @param n 拉取条数
     * @return 失败记录列表（最新在前）
     */
    public List<String> getRecentFailures(int n) {
        if (n <= 0) {
            return Collections.emptyList();
        }
        try {
            List<String> raw = redisTemplate.opsForList().range(DLQ_KEY, -n, -1);
            if (raw == null || raw.isEmpty()) {
                return Collections.emptyList();
            }
            // 倒序: 最新失败在前
            List<String> reversed = new ArrayList<>(raw);
            Collections.reverse(reversed);
            return reversed;
        }
        catch (Exception e) {
            logger.warn("DLQ range 查询失败: {}", e.getMessage(), e);
            return Collections.emptyList();
        }
    }
}
