package com.iwhalecloud.byai.common.constants.resource;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * WorkAgent类型枚举
 */
@RequiredArgsConstructor
@Getter
public enum WorkerAgentType {

    BYCLAW_EXE("BYCLAW_EXE", "openclaw"),
    BYCLAW_DATA("BYCLAW_DATA", "datacloud"),
    BYCLAW_QA("BYCLAW_QA", "搜问"),
    BYCLAW_CODE("BYCLAW_CODE", "编码"),
    DEBUG("DEBUG", "调试的woker"),
    NONE("NONE", "API、SSE等直接调用的worker");

    private final String code;
    private final String desc;

    public static boolean isValid(String code) {
        for (WorkerAgentType type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }


    public static List<String> getSupportedTypes() {
        List<String> types = new ArrayList<>();
        for (WorkerAgentType type : values()) {
            types.add(type.code);
        }
        return types;
    }

    public static WorkerAgentType getByCode(String code) {
        for (WorkerAgentType type : values()) {
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
