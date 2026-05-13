package com.iwhalecloud.byai.manager.domain.permissiongroup.enums;

/**
 * 权限类型枚举
 */
public enum PermissionTypeEnum {

    /**
     * 查看权限
     */
    READ("read", "查看"),

    /**
     * 编辑权限
     */
    WRITE("write", "编辑"),

    /**
     * 删除权限
     */
    DELETE("delete", "删除"),

    /**
     * 导出权限
     */
    EXPORT("export", "导出"),

    /**
     * 执行权限
     */
    EXECUTE("execute", "执行"),

    /**
     * 管理权限
     */
    MANAGE("manage", "管理");

    private final String code;
    private final String name;

    PermissionTypeEnum(String code, String name) {
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
    public static PermissionTypeEnum getByCode(String code) {
        for (PermissionTypeEnum type : values()) {
            if (type.getCode().equals(code)) {
                return type;
            }
        }
        return null;
    }

}

