package com.iwhalecloud.byai.manager.domain.resource.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 资源业务类型枚举
 */
@RequiredArgsConstructor
@Getter
public enum ResourceTypeEnum {

    COMBIN("COMBIN", "组合资源"), ATOM("ATOM", "原子资源");

    private final String code;

    private final String desc;

    public static boolean isValid(String code) {
        for (ResourceTypeEnum type : values()) {
            if (type.code.equals(code)) {
                return true;
            }
        }
        return false;
    }

}
