package com.iwhalecloud.byai.state.domain.men.enums;

import lombok.Getter;

/**
 * 任务状态枚举
 */
@Getter
public enum MenTaskStatusEnum {
    SUBMITTED("Submitted", "已提交"),
    WORKING("Working", "进行中"),
    INPUTREQUIRED("InputRequired", "待用户输入"),
    COMPLETED("Completed", "已完成"),
    CANCELED("Canceled", "已取消"),
    FAILED("Failed", "任务失败"),
    REJECTED("Rejected", "拒绝任务"),
    AUTHREQUIRED("AuthRequired", "待用户授权"),
    UNKNOWN("Unknown", "未知任务类型");

    private final String code;
    private final String desc;

    MenTaskStatusEnum(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    /**
     * 根据名称获取枚举值，不存在则返回null
     */
    public static MenTaskStatusEnum fromName(String name) {
        try {
            return MenTaskStatusEnum.valueOf(name.toUpperCase());
        }
        catch (Exception e) {
            return null;
        }
    }


    /**
     * 检查枚举是否有效
     */
    public static boolean isValid(String name) {
        return fromName(name) != null;
    }


    /**
     * 根据 code 获取枚举值（如 "Submitted" -> SUBMITTED）
     */
    public static MenTaskStatusEnum fromCode(String code) {
        if (code == null || code.isEmpty()) {
            return null;
        }
        for (MenTaskStatusEnum value : values()) {
            if (value.getCode().equals(code.trim())) {
                return value;
            }
        }
        return null;
    }
} 