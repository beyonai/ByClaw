package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 批处理状态枚举
 */
@RequiredArgsConstructor
@Getter
public enum BatchStatus {
    FAILED("failed", "全部任务失败"),
    DONE("done", "全部任务完成"),
    RUNNING("running", "任务运行中"),
    PENDING("pending", "任务待处理"),
    MIXED("mixed", "混合状态（部分完成、部分失败等）");

    private final String code;
    private final String desc;

    public static boolean isValid(String code) {
        for (BatchStatus status : values()) {
            if (status.code.equals(code)) {
                return true;
            }
        }
        return false;
    }

    public static BatchStatus getByCode(String code) {
        for (BatchStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        return null;
    }
}