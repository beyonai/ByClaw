package com.iwhalecloud.byai.common.constants.auth;

/**
 * @author he.duming
 * @date 2025-04-25 10:22:08
 * @description 授权管理类型,AVAILABLE_USE:使用授权,ALLOW_MANAGE:管理授权,OWNER:归属授权,SHARE_USE:分享授权
 */
public final class GrantType {

    private GrantType() {
    }

    /**
     * 使用授权
     */
    public static final String AVAILABLE_USE = "AVAILABLE_USE";

    /**
     * 管理授权
     */
    public static final String ALLOW_MANAGE = "ALLOW_MANAGE";

    /**
     * 管理授权
     */
    public static final String FORCE_USE = "FORCE_USE";


    /**
     * 归属授权
     */
    public static final String OWNER = "OWNER";

    /**
     * 分享授权
     */
    public static final String SHARE_USE = "SHARE_USE";

}
