package com.iwhalecloud.byai.state.domain.chat.service;

/**
 * Redis Stream ID 比较工具。
 * <p>
 * Stream ID 形如 {@code <millis>-<seq>}，两段均为非负整数。用于在重启恢复 / 历史批次续聚合时
 * 以「已聚合到的最后一条消息 ID」作为水位线，跳过 PEL 中重新投递的、已计入快照的事件，避免重复拼接。
 */
public final class StreamIdUtil {

    private StreamIdUtil() {
    }

    /**
     * 比较两个 Stream ID。
     *
     * @return 负数表示 {@code a < b}，0 表示相等或不可比，正数表示 {@code a > b}
     */
    public static int compare(String a, String b) {
        long[] pa = parse(a);
        long[] pb = parse(b);
        if (pa == null || pb == null) {
            // 任一不可解析时视为不可比，返回 0 交由调用方按保守策略处理（不跳过）。
            return 0;
        }
        if (pa[0] != pb[0]) {
            return Long.compare(pa[0], pb[0]);
        }
        return Long.compare(pa[1], pb[1]);
    }

    /**
     * 判断 {@code streamId} 是否已被水位线覆盖（即已计入快照，续聚合时应跳过）。
     * <p>
     * 仅当 {@code streamId} 与 {@code watermark} 均可解析、且 {@code streamId <= watermark} 时返回 true。
     * 任一不可解析（null / 空 / 非法格式）一律返回 false，保守地照常聚合，避免误丢真实事件。
     */
    public static boolean isProcessedByWatermark(String streamId, String watermark) {
        long[] cur = parse(streamId);
        long[] mark = parse(watermark);
        if (cur == null || mark == null) {
            return false;
        }
        if (cur[0] != mark[0]) {
            return cur[0] < mark[0];
        }
        return cur[1] <= mark[1];
    }

    /**
     * 返回两个 Stream ID 中较大的一个；不可比时返回 {@code fallback}。
     * 用于推进水位线，保证其单调不退。
     */
    public static String max(String a, String b, String fallback) {
        long[] pa = parse(a);
        long[] pb = parse(b);
        if (pa == null) {
            return pb == null ? fallback : b;
        }
        if (pb == null) {
            return a;
        }
        if (pa[0] != pb[0]) {
            return pa[0] >= pb[0] ? a : b;
        }
        return pa[1] >= pb[1] ? a : b;
    }

    /**
     * 解析 Stream ID 为 {@code [millis, seq]}，缺省 seq 补 0；非法格式返回 null。
     */
    private static long[] parse(String id) {
        if (id == null || id.isEmpty()) {
            return null;
        }
        try {
            int dash = id.indexOf('-');
            if (dash < 0) {
                return new long[] {Long.parseLong(id.trim()), 0L};
            }
            long millis = Long.parseLong(id.substring(0, dash).trim());
            String seqPart = id.substring(dash + 1).trim();
            long seq = seqPart.isEmpty() ? 0L : Long.parseLong(seqPart);
            return new long[] {millis, seq};
        }
        catch (NumberFormatException e) {
            return null;
        }
    }
}
