package com.iwhalecloud.byai.common.constants.queryconfig;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * queryConfig的code编码
 */
@RequiredArgsConstructor
@Getter
public enum QueryConfigCodeEnum {

    DIG_EMPLOYEE_USAGE_METRICS("DIG_EMPLOYEE_USAGE_METRICS", "单个数字员工使用指标"),
    DIG_EMPLOYEE_TECHNICAL_METRICS("DIG_EMPLOYEE_TECHNICAL_METRICS", "单个数字员工技术指标"),
    DIG_EMPLOYEE_EVALUATE_METRICS("DIG_EMPLOYEE_EVALUATE_METRICS", "单个数字员工评估指标"),
    DIG_EMPLOYEE_ACCURACY_METRICS("DIG_EMPLOYEE_ACCURACY_METRICS", "单个数字员工准确度指标");

    private final String code;
    private final String desc;
    
    public static boolean isValid(String code) {
        for (QueryConfigCodeEnum type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }


}
