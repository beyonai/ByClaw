package com.iwhalecloud.byai.manager.domain.permissiongroup.enums;

/**
 * 数据范围类型枚举
 */
public enum DataScopeTypeEnum {

    /**
     * 本人数据
     */
    SELF("self", "本人数据"),

    /**
     * 组织数据
     */
    ORG("org", "组织数据"),

    /**
     * 岗位数据
     */
    POSITION("position", "岗位数据"),

    /**
     * 驻地数据
     */
    STATION("station", "驻地数据");

    private final String code;
    private final String name;

    DataScopeTypeEnum(String code, String name) {
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
    public static DataScopeTypeEnum getByCode(String code) {
        for (DataScopeTypeEnum type : values()) {
            if (type.getCode().equals(code)) {
                return type;
            }
        }
        return null;
    }

}

