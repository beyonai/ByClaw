package com.iwhalecloud.byai.common.constants.users;

/**
 * 外系统类型 0-本系统用户；1-钉钉；2-企业微信
 * 
 * @author he.duming
 * @date 2025-04-14 17:59:18
 * @description 外系统类型
 */
public final class SourceType {

    private SourceType() {
    }

    /**
     * 鲸加用户
     */
    public static final Integer LOCAL = 0;

    /**
     * 钉钉
     */
    public static final Integer DING_TALK = 1;

    /**
     * 企业微信
     */
    public static final Integer WE_CHAT = 2;

}
