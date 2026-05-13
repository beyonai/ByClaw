package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 更新数据权限数据传输对象
 * 用于单独更新权限组的数据权限配置
 */
@Getter
@Setter
public class UpdateDataPermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 数据范围类型：self-本人, org-组织, position-岗位, station-驻地
     */
    private String dataScopeType;

    /**
     * 数据范围配置（JSON格式，用于custom类型的自定义配置）
     */
    private String dataScopeConfig;

    /**
     * 字段权限配置（JSON格式，配置可见字段）
     */
    private String fieldPermissions;

    /**
     * 行级权限配置（JSON格式，配置数据过滤条件）
     */
    private String rowPermissions;

}

