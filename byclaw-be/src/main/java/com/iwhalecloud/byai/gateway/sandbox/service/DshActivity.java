package com.iwhalecloud.byai.gateway.sandbox.service;

import org.apache.commons.lang3.StringUtils;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * DSH 沙箱最近一次通过活动 Stream 上报的状态。
 *
 * @param userCode 沙箱所属用户
 * @param state busy 或 releasable
 * @param receivedAt 后端收到该条记录的时间（后端时钟，毫秒）
 * @param streamId Redis Stream 记录 ID，用于丢弃乱序到达的旧记录
 * @param at 容器侧生成时间，仅供排查
 * @param lastActiveAt 容器侧最后忙碌时间，仅供排查
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DshActivity(String userCode, String state, long receivedAt, String streamId, String at,
    String lastActiveAt) {

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

    /** 最近一次上报在静默阈值内收到时视为新鲜。 */
    @JsonIgnore
    public boolean isFresh(long nowMillis, long silentMillis) {
        return nowMillis - receivedAt <= silentMillis;
    }

    /** 当前记录的 Stream ID 是否严格早于另一条记录；无法解析时不视为更早。 */
    @JsonIgnore
    public boolean isOlderThan(DshActivity other) {
        if (other == null) {
            return false;
        }
        long[] mine = parseStreamId(streamId);
        long[] theirs = parseStreamId(other.streamId());
        if (mine == null || theirs == null) {
            return false;
        }
        return mine[0] < theirs[0] || (mine[0] == theirs[0] && mine[1] < theirs[1]);
    }

    private static long[] parseStreamId(String id) {
        if (StringUtils.isBlank(id)) {
            return null;
        }
        String[] parts = id.split("-", 2);
        try {
            return new long[] {Long.parseLong(parts[0]), parts.length > 1 ? Long.parseLong(parts[1]) : 0L};
        }
        catch (NumberFormatException e) {
            return null;
        }
    }
}
