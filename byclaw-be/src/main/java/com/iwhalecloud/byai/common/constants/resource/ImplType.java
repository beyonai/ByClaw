package com.iwhalecloud.byai.common.constants.resource;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Woker调用实现方式枚举类
 */
@RequiredArgsConstructor
@Getter
public enum ImplType {

    ASK_AGENT("ASK_AGENT", "独立Agent实现方式，通过framework CallAgent"),
    ASK_PERSONAL("ASK_PERSONAL", "个人开发的Agent实现方式"),
    API("API", "API实现方式"),
    SSE("SSE", "SSE实现方式");

    private final String code;
    private final String desc;

    public static boolean isValid(String code) {
        for (ImplType type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }


    public static List<String> getSupportedTypes() {
        List<String> types = new ArrayList<>();
        for (ImplType type : values()) {
            types.add(type.code);
        }
        return types;
    }

    public static ImplType getByCode(String code) {
        for (ImplType type : values()) {
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
