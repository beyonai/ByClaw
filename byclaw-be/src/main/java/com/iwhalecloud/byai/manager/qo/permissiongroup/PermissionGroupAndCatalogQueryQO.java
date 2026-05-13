package com.iwhalecloud.byai.manager.qo.permissiongroup;

import lombok.Getter;
import lombok.Setter;

/**
 * 权限组和目录联合查询对象
 * 用于同时查询权限组目录和权限组信息
 */
@Getter
@Setter
public class PermissionGroupAndCatalogQueryQO {

    /**
     * 查询条件（用于模糊匹配目录名称和权限组名称）
     */
    private String queryCondition;

    /**
     * 用户ID（可选，用于过滤特定用户的数据）
     */
    private Long userId;

    /**
     * 组织ID（可选，用于多租户过滤）
     */
    private Long orgId;

}

