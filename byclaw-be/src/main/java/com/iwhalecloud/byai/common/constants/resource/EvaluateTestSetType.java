package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 数字员工测试集状态枚举
 */
@RequiredArgsConstructor
@Getter
public enum EvaluateTestSetType {
    SUCCESS(0, "测试集处理成功"),
    PROCESSING(1, "测试集处理中"),
    FAILED(2, "测试集处理失败");

    private final Integer code;
    private final String desc;

    public static boolean isValid(Integer code) {
        for (EvaluateTestSetType type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }

    public static EvaluateTestSetType getByCode(Integer code) {
        for (EvaluateTestSetType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return null;
    }
}
