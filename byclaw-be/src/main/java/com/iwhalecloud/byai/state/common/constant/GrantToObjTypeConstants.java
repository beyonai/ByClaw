package com.iwhalecloud.byai.state.common.constant;

/**
 * @author he.duming
 * @date 2025-04-25 10:27:17
 * @description 权限授予对象类型,USER:人员,ORG:组织,POST:岗位
 */
public final class GrantToObjTypeConstants {

    private GrantToObjTypeConstants() {
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
     * 使用权限
     */
    public static final String USE_PRIV = "AVAILABLE_USE";


    /**
     * 管理权限
     */
    public static final String MANAGER_PRIV = "ALLOW_MANAGE";

    /**
     * 管理权限
     */
    public static final String FORCE_PRIV = "FORCE_USE";


    /**
     * 分享权限
     */
    public static final String SHARE_PRIV = "SHARE_USE";


    /**
     * 使用权限
     */
    public static final String AVAILABLE_USE = "AVAILABLE_USE";

    /**
     * 文档
     */
    public static final String DOC = "DOC";

    public static final String AGENT = "AGENT";


    public static final String RED = "RED";

    public static final String BLACK = "BLACK";





}
