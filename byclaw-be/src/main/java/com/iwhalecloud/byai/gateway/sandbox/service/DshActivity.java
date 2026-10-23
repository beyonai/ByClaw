package com.iwhalecloud.byai.gateway.sandbox.service;

import org.apache.commons.lang3.StringUtils;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * DSH 沙箱最近一次通过活动 Stream 上报的状态。
 *
 * @param userCode 沙箱所属用户
 * @param state busy 或 releasable
 * @param receivedAt 该条记录进入 Redis 的时间（取自 Stream ID 的毫秒部分，即 Redis 服务器时钟；无法解析时为后端收到时间）
 * @param streamId Redis Stream 记录 ID，用于丢弃乱序到达的旧记录
 * @param at 容器侧生成时间，仅供排查
 * @param lastActiveAt 容器侧最后忙碌时间，仅供排查
 * @param sandboxType 上报方声明的沙箱类型（工具沙箱条目带 serviceKey；宿主自身条目为空）
 * @param kind 条目种类：{@code tool-env} 表示 DSH 宿主代工具沙箱上报；空表示沙箱自身上报
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DshActivity(String userCode, String state, long receivedAt, String streamId, String at,
    String lastActiveAt, String sandboxType, String kind) {
    public static final String KIND_TOOL_ENV = "tool-env";


    public static final String STATE_BUSY = "busy";

    public static final String STATE_RELEASABLE = "releasable";

    @JsonIgnore
    public boolean isBusy() {
        return STATE_BUSY.equals(state);
    }

    @JsonIgnore
    public boolean isReleasable() {
        return STATE_RELEASABLE.equals(state);
    }

    /** 由 DSH 宿主代某个工具沙箱上报的条目。 */
    @JsonIgnore
    public boolean isToolEnvironment() {
        return KIND_TOOL_ENV.equals(kind);
    }

    /** 最近一次上报在静默阈值内收到时视为新鲜。 */
    @JsonIgnore
    public boolean isFresh(long nowMillis, long silentMillis) {
        return nowMillis - receivedAt <= silentMillis;
    }

    /**
     * Stream ID 的毫秒部分（{@code <millis>-<seq>}），即 Redis 服务器写入该条记录的时间。多实例消费时所有实例看到
     * 同一时钟，静默判断不受后端实例之间的时钟偏差影响。
     *
     * @return 毫秒时间戳；无法解析时返回 -1
     */
    public static long streamIdMillis(String streamId) {
        if (StringUtils.isBlank(streamId)) {
            return -1L;
        }
        String millis = StringUtils.substringBefore(streamId, "-");
        try {
            long value = Long.parseLong(millis);
            return value > 0 ? value : -1L;
        }
        catch (NumberFormatException e) {
            return -1L;
        }
    }
}
