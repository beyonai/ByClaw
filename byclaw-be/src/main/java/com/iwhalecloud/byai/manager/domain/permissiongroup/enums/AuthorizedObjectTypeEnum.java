package com.iwhalecloud.byai.manager.domain.permissiongroup.enums;

/**
 * 授权对象类型枚举
 */
public enum AuthorizedObjectTypeEnum {

    /**
     * 用户
     */
    USER("user", "用户"),

    /**
     * 组织
     */
    ORG("org", "组织"),

    /**
     * 角色
     */
    ROLE("role", "角色"),

    /**
     * 岗位
     */
    POSITION("position", "岗位");

    private final String code;
    private final String name;

    AuthorizedObjectTypeEnum(String code, String name) {
        this.code = code;
        this.name = name;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    /**
     * 根据编码获取枚举
     *
     * @param code 编码
     * @return 枚举
     */
    public static AuthorizedObjectTypeEnum getByCode(String code) {
        for (AuthorizedObjectTypeEnum type : values()) {
            if (type.getCode().equals(code)) {
                return type;
            }
        }
        return null;
    }

}

