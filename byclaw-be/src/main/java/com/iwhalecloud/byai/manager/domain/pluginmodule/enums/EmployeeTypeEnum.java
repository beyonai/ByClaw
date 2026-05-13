package com.iwhalecloud.byai.manager.domain.pluginmodule.enums;

import lombok.Getter;

@Getter
public enum EmployeeTypeEnum {

    SEARCHQUERY("SEARCH_QUERY", "搜问"),
    FUNCTION_CLOUD("FUNCTION_CLOUD", "FunctionCloud"),
    DATA_CLOUD("DATA_CLOUD", "DataCloud");

    private final String code;
    private final String desc;

    EmployeeTypeEnum(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }
}
