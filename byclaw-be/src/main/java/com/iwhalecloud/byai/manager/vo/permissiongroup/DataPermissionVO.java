package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 数据权限视图对象
 */
@Getter
@Setter
public class DataPermissionVO {

    /**
     * 主键ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 数据范围类型：self-本人, org-组织, position-岗位, station-驻地
     */
    private String dataScopeType;

    /**
     * 数据范围类型名称
     */
    private String dataScopeTypeName;

    /**
     * 数据范围配置（JSON格式）
     */
    private String dataScopeConfig;

    /**
     * 字段权限配置（JSON格式）
     */
    private String fieldPermissions;

    /**
     * 行级权限配置（JSON格式）
     */
    private String rowPermissions;

    /**
     * 状态
     */
    private String status;

}

