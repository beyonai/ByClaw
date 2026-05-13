package com.iwhalecloud.byai.manager.qo.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 权限组授权资源分页查询条件
 */
@Getter
@Setter
public class ResourcePermissionQueryQO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 资源类型
     */
    private String resourceType;

    /**
     * 资源名称（模糊查询）
     */
    private String resourceName;

    /**
     * 权限类型
     */
    private String permissionType;

    /**
     * 当前页码
     */
    private Long pageIndex = 1L;

    /**
     * 每页条数
     */
    private Long pageSize = 10L;

}

