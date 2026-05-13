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
 * 权限组排除授权对象关联实体类
 * 对应数据库表：permission_group_excluded_objects
 */
@Getter
@Setter
@TableName("permission_group_excluded_objects")
public class PermissionGroupExcludedObject {

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
     * 排除对象ID
     */
    @TableField("excluded_object_id")
    private Long excludedObjectId;

    /**
     * 对象类型：user-用户, org-组织, role-角色, position-岗位
     */
    @TableField("object_type")
    private String objectType;

    /**
     * 排除开始时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    @TableField("effective_at")
    private Date effectiveAt;

    /**
     * 排除结束时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    @TableField("expires_at")
    private Date expiresAt;

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
