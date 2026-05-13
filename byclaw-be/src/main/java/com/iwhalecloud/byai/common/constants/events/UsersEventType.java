package com.iwhalecloud.byai.common.constants.events;

/**
 * 同步kafka事件类型
 */
public final class UsersEventType {

    private UsersEventType() {
    }

    /**
     * 用户新增事件类型
     */
    public static final String CREATE = "userCreate";

    /**
     * 用户更新事件类型
     */
    public static final String UPDATE = "userUpdate";

    /**
     * 用户删除事件类型
     */
    public static final String DELETE = "userDelete";

}
