package com.iwhalecloud.byai.manager.dto.permissiongroup;

import lombok.Getter;
import lombok.Setter;

/**
 * 数据权限配置数据传输对象
 */
@Getter
@Setter
public class DataPermissionDTO {

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

