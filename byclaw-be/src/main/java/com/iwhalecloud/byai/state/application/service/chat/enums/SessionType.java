package com.iwhalecloud.byai.state.application.service.chat.enums;

/**
 * @author he.duming
 * @date 2025-05-23 14:35:42
 * @description TODO
 */
public final class SessionType {

    private SessionType() {
    }

    /**
     * 超级助手
     */
    public static final String SUPER_AGENT = "SUPER_AGENT";

    /**
     * 鲸智-问数
     */
    public static final String CHAT_BI = "CHAT_BI";

    /**
     * 鲸智-慧笔
     */
    public static final String WRITER = "WRITER";

    /**
     * 鲸智-鲸灵
     */
    public static final String DIGI_HUM = "DIGI_HUM";

    /**
     * 普通数字员工
     */
    public static final String AGENT = "AGENT";
}