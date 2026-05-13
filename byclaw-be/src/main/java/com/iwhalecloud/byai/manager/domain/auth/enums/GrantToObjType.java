package com.iwhalecloud.byai.manager.domain.auth.enums;

/**
 * @author he.duming
 * @date 2025-05-06 15:13:14
 * @description TODO
 */
public final class GrantToObjType {

    private GrantToObjType() {
    }

    /**
     * 人员
     */
    public static final String USER = "USER";

    /**
     * 组织
     */
    public static final String ORG = "ORG";

    /**
     * 岗位
     */
    public static final String POST = "POST";

    /**
     * 驻地
     */
    public static final String STATION = "STATION";


    /**
     * 角色
     */
    public static final String ROLE = "ROLE";


    /**
     * 使用组织管理
     */
    public static final String MAN_ORG = "MAN_ORG";


    /**
     * 使用组织管理
     */
    public static final String MAN_USER = "MAN_USER";
}
