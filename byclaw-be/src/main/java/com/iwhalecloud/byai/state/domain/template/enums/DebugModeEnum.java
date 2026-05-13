package com.iwhalecloud.byai.state.domain.template.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum DebugModeEnum {

    DEBUG_0(0, "普通会话"),
    DEBUG_1(1, "调试会话"),
    DEBUG_2(2, "模板会话");

    /**
     * 模板类型编码
     */
    private final Integer num;

    /**
     * 模板类型显示名称
     */
    private final String desc;
}
