package com.iwhalecloud.byai.manager.entity.permissiongroup;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 资源属性权限实体类
 * 记录资源属性与数据权限范围的映射关系
 */
@Getter
@Setter
@TableName("resource_attribute_permissions")
public class PermissionGroupResourceAttribute {

    /**
     * 关联ID（自增）
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 资源ID
     */
    @TableField("resource_id")
    private Long resourceId;

    /**
     * 资源属性ID
     */
    @TableField("resource_attribute_id")
    private Long resourceAttributeId;

    /**
     * 数据范围类型：self-本人、org-组织、position-岗位、station-驻地等
     */
    @TableField("data_scope_type")
    private String dataScopeType;

    /**
     * 创建人ID
     */
    @TableField("create_by")
    private Long createBy;

    /**
     * 创建时间
     */
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
    @TableField("update_time")
    private Date updateTime;

}

