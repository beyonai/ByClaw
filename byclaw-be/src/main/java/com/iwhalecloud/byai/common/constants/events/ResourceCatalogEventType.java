package com.iwhalecloud.byai.common.constants.events;

/**
 * 同步kafka事件类型
 */
public final class ResourceCatalogEventType {

    private ResourceCatalogEventType() {
    }

    /**
     * 资源目录新增事件类型
     */
    public static final String CREATE = "catalogCreate";

    /**
     * 资源目录更新事件类型
     */
    public static final String UPDATE = "catalogUpdate";

    /**
     * 资源目录删除事件类型
     */
    public static final String DELETE = "catalogDelete";

}
