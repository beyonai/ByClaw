package com.iwhalecloud.byai.common.constants.auth;

/**
 * @author he.duming
 * @date 2025-04-25 10:27:17
 * @description 权限授予对象类型,USER:人员,ORG:组织,POST:岗位
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
}
