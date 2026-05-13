package com.iwhalecloud.byai.manager.qo.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

/**
 * 可用授权对象查询对象
 * 用于查询可以添加到权限组的用户/组织列表
 */
@Getter
@Setter
public class AvailableObjectQueryQO {

    /**
     * 权限组ID（用于排除已授权的对象）
     */
    private Long permissionGroupId;

    /**
     * 对象类型：user-用户, org-组织, role-角色, position-岗位
     */
    @NotEmpty(message = "{authorizedobject.objecttype.notempty}")
    private String objectType;

    /**
     * 对象名称（模糊查询）
     */
    private String objectName;

    /**
     * 组织ID（用于筛选组织下的用户）
     */
    private Long orgId;

    /**
     * 当前页码
     */
    private Long pageIndex = 1L;

    /**
     * 每页条数
     */
    private Long pageSize = 10L;

}

