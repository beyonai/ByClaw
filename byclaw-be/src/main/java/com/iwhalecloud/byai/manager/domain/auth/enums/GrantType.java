package com.iwhalecloud.byai.manager.domain.auth.enums;

/**
 * @author he.duming
 * @date 2025-05-06 15:23:26
 * @description TODO
 */

public final class GrantType {

    private GrantType() {
    }

    /**
     * 使用授权
     */
    public static final String AVAILABLE_USE = "AVAILABLE_USE";

    /**
     * 强制使用
     */
    public static final String FORCE_USE = "FORCE_USE";

    /**
     * 管理授权
     */
    public static final String ALLOW_MANAGE = "ALLOW_MANAGE";

    /**
     * 分享授权
     */
    public static final String SHARE_USE = "SHARE_USE";

    /**
     * 归属授权
     */
    public static final String OWNER = "OWNER";

}
