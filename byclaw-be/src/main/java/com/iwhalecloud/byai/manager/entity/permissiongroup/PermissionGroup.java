package com.iwhalecloud.byai.manager.entity.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 权限组实体类
 * 对应数据库表：permission_groups
 */
@Getter
@Setter
@TableName("permission_groups")
public class PermissionGroup {

    /**
     * 权限组ID
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 权限组编码
     */
    @NotEmpty(message = "{permissiongroup.groupcode.notempty}")
    @Size(max = 100, message = "{permissiongroup.groupcode.size}")
    @TableField("group_code")
    private String groupCode;

    /**
     * 权限组名称
     */
    @NotEmpty(message = "{permissiongroup.groupname.notempty}")
    @Size(max = 200, message = "{permissiongroup.groupname.size}")
    @TableField("group_name")
    private String groupName;

    /**
     * 权限组描述
     */
    @Size(max = 500, message = "{permissiongroup.description.size}")
    @TableField("description")
    private String description;

    /**
     * 状态：active-启用, inactive-禁用
     */
    @TableField("status")
    private String status;

    /**
     * 所属组织ID
     */
    @TableField("org_id")
    private Long orgId;

    /**
     * 父权限组ID（支持层级结构）
     */
    @TableField("parent_id")
    private Long parentId;

    /**
     * 分类ID
     */
    @TableField("category_id")
    private Long categoryId;

    /**
     * 排序顺序
     */
    @TableField("sort_order")
    private Integer sortOrder;

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

