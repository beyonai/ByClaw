package com.iwhalecloud.byai.common.constants.login;

/**
 * @author he.duming
 * @date 2025-04-14 14:19:19
 * @description 放到session中的字段
 */
public final class ShareSessionKey {


    private ShareSessionKey() {
    }

    /***
     * 用户编码
     */
    public static final String USER_CODE = "USER_CODE";


    /**
     * 共享用户信息
     */
    public static final String SHARE_CURRENT_USER = "SHARE_CURRENT_USER";


    /**
     * 用户管理组织
     */
    public static final String SHARE_CURRENT_MANAGE_ORG = "SHARE_CURRENT_MANAGE_ORG";

    /**
     * 用户关联组织-岗位-角色
     */
    public static final String SHARE_USERS_ORGANIZATIONS = "SHARE_USERS_ORGANIZATIONS";

}
