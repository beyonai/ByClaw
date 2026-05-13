package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 数字员工评估类型枚举
 */
@RequiredArgsConstructor
@Getter
public enum EvaluateType {
    TEST_SET_ACCURACY("TEST_SET_ACCURACY", "测试集回答准确率"),
    ACTUAL_USE_ACCURACY("ACTUAL_USE_ACCURACY", "实际使用回复准确率"),
    CONVERSATION_ERROR_RATE("CONVERSATION_ERROR_RATE", "对话异常率"),
    AVG_FIRST_RESPONSE_DURATION("AVG_FIRST_RESPONSE_DURATION", "平均首词响应时长"),
    PERSONA_SPECIFICATION_SCORE("PERSONA_SPECIFICATION_SCORE", "人设描述规范度"),
    ABILITY_POST_MATCHING_SCORE("ABILITY_POST_MATCHING_SCORE", "能力描述与岗位匹配度");

    private final String code;
    private final String desc;

    public static boolean isValid(String code) {
        for (EvaluateType type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }

    public static EvaluateType getByCode(String code) {
        for (EvaluateType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return null;
    }
}
