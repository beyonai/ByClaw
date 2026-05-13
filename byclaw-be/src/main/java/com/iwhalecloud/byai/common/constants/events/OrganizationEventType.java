package com.iwhalecloud.byai.common.constants.events;

public final class OrganizationEventType {

    private OrganizationEventType() {
    }

    /**
     * 组织新增事件类型
     */
    public static final String CREATE = "organizationCreate";

    /**
     * 组织更新事件类型
     */
    public static final String UPDATE = "organizationUpdate";

    /**
     * 组织删除事件类型
     */
    public static final String DELETE = "organizationDelete";
}
