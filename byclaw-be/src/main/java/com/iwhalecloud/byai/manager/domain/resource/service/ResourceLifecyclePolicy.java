package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;

import java.util.Objects;
import java.util.Set;

/** 资源中心与数字员工使用相同的状态转换；工作空间技能不属于资源记录。 */
public final class ResourceLifecyclePolicy {
    private static final Set<String> RESOURCE_TYPES = Set.of("SKILL_GROUP", "SKILL", "TOOLKIT", "MCP", "AGENT",
        "KG_DOC", "KG_QA", "KG_TERM");

    private ResourceLifecyclePolicy() {
    }

    public static boolean supports(SsResource resource) {
        return resource != null && resource.getResourceBizType() != null && RESOURCE_TYPES.contains(resource.getResourceBizType());
    }

    /** 运行态同步不能重新发布已下架或注销的资源。 */
    public static boolean isRuntimeAvailable(SsResource resource) {
        return resource != null && (!supports(resource)
            || Objects.equals(resource.getResourceStatus(), ResourceStatus.ON_SHELF.getNum()));
    }

    public static boolean canShelf(SsResource resource) {
        return resource != null && OwnerType.ENTERPRISE.equals(resource.getOwnerType())
            && (Objects.equals(resource.getResourceStatus(), ResourceStatus.DRAFT.getNum())
            || Objects.equals(resource.getResourceStatus(), ResourceStatus.OFF_SHELF.getNum()));
    }

    public static boolean canUnShelf(SsResource resource) {
        return resource != null && OwnerType.ENTERPRISE.equals(resource.getOwnerType())
            && Objects.equals(resource.getResourceStatus(), ResourceStatus.ON_SHELF.getNum());
    }

    public static boolean canDeregister(SsResource resource) {
        return resource != null && !Objects.equals(resource.getResourceStatus(), ResourceStatus.DELETE.getNum())
            && (OwnerType.PERSONAL.equals(resource.getOwnerType()) || canShelf(resource));
    }
}
