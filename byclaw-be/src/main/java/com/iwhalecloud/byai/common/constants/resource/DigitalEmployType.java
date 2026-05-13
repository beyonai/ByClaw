package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 数字员工类型枚举
 * @author qin.guoquan
 * @date 2026-04-25 23:38:38
 */
@RequiredArgsConstructor
@Getter
public enum DigitalEmployType {

    AGENT_TYPE_ASSISTANT("001", "助手型"),
    AGENT_TYPE_DATA("005", "问数型"),
    AGENT_TYPE_QA("006", "问答型"),
    AGENT_TYPE_DEBUG("010", "调试型"),
    AGENT_TYPE_CODE("011", "编码型");

    private final String code;
    private final String desc;

    public static boolean isValid(String code) {
        for (DigitalEmployType type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }


    public static List<String> getSupportedTypes() {
        List<String> types = new ArrayList<>();
        for (DigitalEmployType type : values()) {
            types.add(type.code);
        }
        return types;
    }

    public static DigitalEmployType getByCode(String code) {
        for (DigitalEmployType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return null;
    }

    public boolean supported() {
        return getSupportedTypes().contains(this.code);

    }
}
