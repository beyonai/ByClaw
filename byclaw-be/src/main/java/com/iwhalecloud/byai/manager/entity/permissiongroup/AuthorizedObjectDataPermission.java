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
 * 授权对象数据权限实体类
 * 对应数据库表：authorized_object_data_permissions
 * 为权限组中的每个授权对象单独设置数据权限配置
 */
@Getter
@Setter
@TableName("authorized_object_data_permissions")
public class AuthorizedObjectDataPermission {

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
     * 用户ID（直接存储用户ID）
     */
    @TableField("user_id")
    private Long userId;

    /**
     * 权限配置JSON字符串
     */
    @TableField("permissions")
    private String permissions;

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
