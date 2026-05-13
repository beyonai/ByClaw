package com.iwhalecloud.byai.common.constants.login;

/**
 * @author he.duming
 * @date 2025-06-18 14:55:50
 * @description 用户的登陆类型
 */
public final class LoginType {

    private LoginType() {
    }

    /**
     * 用户名+密码登陆
     */
    public static final String USERNAME = "username";

    /**
     * 鲸加登陆
     */
    public static final String IWHALE = "iwhale";

    /**
     * 钉钉登陆
     */
    public static final String DINGTALK = "dingtalk";

    /**
     * 手机号码登陆
     */
    public static final String PHONE = "phone";

    /**
     * 单点登陆
     */
    public static final String SSO = "sso";

    /**
     * CAS登陆
     */
    public static final String CAS = "cas";

    /**
     * 飞连登陆
     */
    public static final String FEI_lIAN = "feiLian";

    /**
     * APPLE 登录
     */
    public static final String APPLE = "apple";
}
