package com.iwhalecloud.byai.state.domain.men.enums;

import lombok.Getter;

/**
 * 任务类型枚举 APPROVE：审批，INPUT:用户协助输入，授权：AUTHORI
 */
@Getter
public enum TaskTypeEnum {

    /**
     * 审批
     */
    APPROVE("APPROVE", "审批"),
    /**
     * 用户协助输入
     */
    INPUT("INPUT", "用户协助输入"),
    /**
     * 授权
     */
    AUTHORI("AUTHORI", "授权"),
    /**
     * 固化记模板
     */
    FIXMEMORY("FIXMEMORY", "固化记模板");

    private final String code;

    private final String desc;

    TaskTypeEnum(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }
}