package com.iwhalecloud.byai.manager.entity.permissiongroup;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 权限组目录实体类
 * 存储权限组目录信息，支持层级结构，用于分类管理权限组
 */
@Getter
@Setter
@TableName("permission_group_categories")
public class PermissionGroupCategory {

    /**
     * 目录ID（自增）
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 目录名称
     */
    @TableField("category_name")
    private String categoryName;

    /**
     * 父级目录ID（NULL表示顶级目录）
     */
    @TableField("parent_id")
    private Long parentId;

    /**
     * 目录编码（唯一标识）
     */
    @TableField("category_code")
    private String categoryCode;

    /**
     * 目录描述
     */
    @TableField("description")
    private String description;

    /**
     * 图标（图标名称或URL）
     */
    @TableField("icon")
    private String icon;

    /**
     * 排序顺序（数字越小越靠前）
     */
    @TableField("sort_order")
    private Integer sortOrder;

    /**
     * 状态：active(启用)、inactive(禁用)
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

    /**
     * 组织ID（多租户支持）
     */
    @TableField("org_id")
    private Long orgId;

}

