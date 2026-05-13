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
 * 授权对象实体类
 * 对应数据库表：authorized_objects
 */
@Getter
@Setter
@TableName("authorized_objects")
public class AuthorizedObject {

    /**
     * 主键ID
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 对象类型：user-用户, org-组织, role-角色, position-岗位
     */
    @TableField("object_type")
    private String objectType;

    /**
     * 对象ID（关联到对应类型的表）
     */
    @TableField("object_id")
    private Long objectId;

    /**
     * 对象名称（冗余存储，方便查询展示）
     */
    @TableField("object_name")
    private String objectName;

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

