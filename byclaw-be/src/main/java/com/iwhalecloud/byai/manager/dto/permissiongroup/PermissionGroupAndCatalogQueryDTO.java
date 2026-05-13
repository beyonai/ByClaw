package com.iwhalecloud.byai.manager.dto.permissiongroup;

import lombok.Getter;
import lombok.Setter;

/**
 * 权限组和目录联合查询请求DTO
 * 用于接收前端的查询参数
 */
@Getter
@Setter
public class PermissionGroupAndCatalogQueryDTO {

    /**
     * 查询条件（用于模糊匹配目录名称和权限组名称）
     */
    private String queryCondition;

}

