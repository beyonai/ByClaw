package com.iwhalecloud.byai.manager.qo.permissiongroup;

import lombok.Getter;
import lombok.Setter;

/**
 * 权限组目录查询对象
 */
@Getter
@Setter
public class PermissionGroupCategoryQueryQO {

    /**
     * 目录名称（模糊查询）
     */
    private String categoryName;

    /**
     * 目录编码（精确查询）
     */
    private String categoryCode;

    /**
     * 父级目录ID
     */
    private Long parentId;

    /**
     * 状态：active-启用, inactive-禁用
     */
    private String status;

    /**
     * 组织ID
     */
    private Long orgId;

    /**
     * 是否查询树形结构
     */
    private Boolean tree;

    /**
     * 当前页码
     */
    private Long pageIndex = 1L;

    /**
     * 每页条数
     */
    private Long pageSize = 10L;

}

