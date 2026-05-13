package com.iwhalecloud.byai.manager.entity.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 默认数据权限实体类
 * 对应数据库表：default_data_permissions
 */
@Getter
@Setter
@TableName("default_data_permissions")
public class DefaultDataPermission {

    /**
     * 主键ID
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 权限组ID
     */
    @TableField("permission_group_id")
    private Long permissionGroupId;

    /**
     * 数据范围类型：self-本人, org-组织, position-岗位, station-驻地
     */
    @TableField("data_scope_type")
    private String dataScopeType;

    /**
     * 数据范围配置（JSON格式，用于custom类型的自定义配置）
     */
    @TableField("data_scope_config")
    private String dataScopeConfig;

    /**
     * 字段权限配置（JSON格式，配置可见字段）
     */
    @TableField("field_permissions")
    private String fieldPermissions;

    /**
     * 行级权限配置（JSON格式，配置数据过滤条件）
     */
    @TableField("row_permissions")
    private String rowPermissions;

    /**
     * 状态：active-启用, inactive-禁用
     */
    @TableField("status")
    private String status;

    /**
     * 创建人ID
     */
    @TableField("create_by")
    private Long createBy;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    @TableField("create_time")
    private Date createTime;

    /**
     * 更新人ID
     */
    @TableField("update_by")
    private Long updateBy;

    /**
     * 更新时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    @TableField("update_time")
    private Date updateTime;

}

