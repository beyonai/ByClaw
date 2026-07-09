package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import com.alibaba.fastjson2.JSON;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.Objects;

/**
 * 启动期同步失败 DLQ 记录器（PR-4 + PR-fix Major-1）。
 * <p>
 * 失败原因（如单 chunk 处理失败、整页 prefetch 失败、时长超时、Pipeline 失败）写入
 * Redis List {@code byai:dig-employee:startup-sync:dlq}，单条记录为 JSON 字符串
 * （使用项目已有的 fastjson2 序列化）。
 * <p>
 * <strong>PR-fix Major-1</strong>：由原先的 {@code resourceId|bizType|reason|time} 管道符分隔文本
 * 改为 JSON 格式。理由：原格式仅 reason 做了 {@code |} 字符过滤，resourceId / bizType 没有；
 * 如果未来 bizType 包含 {@code |}（如 {@code DOC_CHILD}）或 reason 经多次 replace 后仍残留
 * {@code |}，会导致后续解析端错位。JSON 格式天然无此问题。
 * <p>
 * 调用方契约：
 * <ul>
 *     <li>{@link #recordFailure} 失败时仅记 warn 日志，<strong>不抛出异常</strong>，确保不阻塞同步主流程</li>
 *     <li>{@link #getDlqSize} 返回 List 当前长度（LLEN）</li>
 *     <li>{@link #getRecentFailures} 拉取最多 N 条最近失败（JSON 反序列化为 {@link DLQEntry}）</li>
 *     <li>List 容量上限 1000 条（RPUSH 后 LTRIM 截断），避免内存膨胀</li>
 * </ul>
 *
 * <p>数据结构（每条 JSON）:
 * <pre>{@code
 * {
 *   "resourceId": 12345,
 *   "bizType": "TOOLKIT",
 *   "reason": "some failure reason",
 *   "failureTime": "2026-07-09T22:23:00.123Z"
 * }
 * }</pre>
 */
@Component
public class StartupSyncDlqRecorder {

    private static final Logger logger = LoggerFactory.getLogger(StartupSyncDlqRecorder.class);

    /** DLQ Redis key, 命名与 PRD §4.4 一致 */
    public static final String DLQ_KEY = "byai:dig-employee:startup-sync:dlq";

    /** DLQ 容量上限 (FIFO 截断,条数)。1000 条 × ~300B/条 ≈ 300KB Redis 内存,对启动期失败量级足够。 */
    private static final long DLQ_MAX_SIZE = 1000L;

    private final StringRedisTemplate redisTemplate;
    private final DigEmployeeStartupSyncProperties startupSyncProperties;

    public StartupSyncDlqRecorder(StringRedisTemplate redisTemplate,
                                 DigEmployeeStartupSyncProperties startupSyncProperties) {
        this.redisTemplate = redisTemplate;
        this.startupSyncProperties = startupSyncProperties;
    }

    /**
     * 记录一次失败到 DLQ。
     * <p>
     * PR-fix Major-1: 数据结构由字符串拼接改为 JSON 序列化(fastjson2)。
     * null 入参自动转 JSON null,reason 限长 500 字符防异常 message 膨胀。
     *
     * @param resourceId 失败资源 ID (主资源 / 关联资源均可,纯 metadata)
     * @param bizType 失败资源所属业务类型 (DIG_EMPLOYEE / TOOLKIT / MCP / AGENT / KG_* / VIEW / OBJECT / SKILL)
     * @param reason 失败原因 (异常 message / "TIMEOUT" / "DLQ_FULL" 等)
     */
    public void recordFailure(Long resourceId, String bizType, String reason) {
        if (startupSyncProperties == null || !Boolean.TRUE.equals(startupSyncProperties.getDlqEnabled())) {
            // 关闭 DLQ → 仅记 warn, 不写 Redis
            logger.debug("DLQ 已关闭, 仅记 warn 日志: resourceId={}, bizType={}, reason={}",
                resourceId, bizType, reason);
            return;
        }
        try {
            Map<String, Object> failure = new LinkedHashMap<>();
            failure.put("resourceId", resourceId);
            failure.put("bizType", bizType);
            failure.put("reason", reason == null ? null : truncateReason(reason));
            failure.put("failureTime", Instant.now().toString());
            String json = JSON.toJSONString(failure);
            // RPUSH + LTRIM (保留最近 DLQ_MAX_SIZE 条) - 一次 pipeline 减少网络往返
            redisTemplate.opsForList().rightPush(DLQ_KEY, json);
            redisTemplate.opsForList().trim(DLQ_KEY, -DLQ_MAX_SIZE, -1);
        }
        catch (Exception e) {
            logger.warn("DLQ 写入失败(不阻塞同步主流程): resourceId={}, bizType={}, reason={}, err={}",
                resourceId, bizType, reason, e.getMessage(), e);
        }
    }

    /**
     * reason 限长 500 字符,防异常 message 膨胀导致单条 DLQ entry 过大。
     */
    private static String truncateReason(String reason) {
        if (reason == null) return null;
        return reason.length() > 500 ? reason.substring(0, 500) + "..." : reason;
    }

    /**
     * 获取当前 DLQ 长度 (LLEN)。
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
     * 拉取最多 N 条最近失败记录（按 RPUSH 顺序倒序 - 最新失败在前），JSON 反序列化为 {@link DLQEntry}。
     * 失败返回空列表。
     *
     * @param n 拉取条数
     * @return 失败记录列表（最新在前）
     */
    public List<DLQEntry> getRecentFailures(int n) {
        if (n <= 0) {
            return Collections.emptyList();
        }
        try {
            List<String> raw = redisTemplate.opsForList().range(DLQ_KEY, -n, -1);
            if (raw == null || raw.isEmpty()) {
                return Collections.emptyList();
            }
            // 倒序: 最新失败在前
            List<DLQEntry> entries = new ArrayList<>(raw.size());
            for (int i = raw.size() - 1; i >= 0; i--) {
                try {
                    String json = raw.get(i);
                    if (json == null) continue;
                    DLQEntry entry = JSON.parseObject(json, DLQEntry.class);
                    if (entry != null) {
                        entries.add(entry);
                    }
                }
                catch (Exception parseEx) {
                    // 单条解析失败不阻塞整体
                    logger.debug("DLQ entry 解析失败(跳过该条): err={}", parseEx.getMessage());
                }
            }
            return entries;
        }
        catch (Exception e) {
            logger.warn("DLQ range 查询失败: {}", e.getMessage(), e);
            return Collections.emptyList();
        }
    }

    /**
     * DLQ 单条结构化对象（PR-fix Major-1）。
     */
    public static class DLQEntry {
        private Long resourceId;
        private String bizType;
        private String reason;
        private String failureTime;

        public DLQEntry() {}

        public Long getResourceId() { return resourceId; }
        public void setResourceId(Long resourceId) { this.resourceId = resourceId; }

        public String getBizType() { return bizType; }
        public void setBizType(String bizType) { this.bizType = bizType; }

        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }

        public String getFailureTime() { return failureTime; }
        public void setFailureTime(String failureTime) { this.failureTime = failureTime; }

        @Override
        public String toString() {
            return "DLQEntry{resourceId=" + resourceId
                + ", bizType='" + bizType + '\''
                + ", reason='" + reason + '\''
                + ", failureTime='" + failureTime + '\''
                + '}';
        }
    }
}
