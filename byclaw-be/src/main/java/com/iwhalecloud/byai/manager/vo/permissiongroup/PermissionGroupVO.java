package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * 权限组视图对象
 */
@Getter
@Setter
public class PermissionGroupVO {

    /**
     * 权限组ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 权限组编码
     */
    private String groupCode;

    /**
     * 权限组名称
     */
    private String groupName;

    /**
     * 权限组描述
     */
    private String description;

    /**
     * 状态：active-启用, inactive-禁用
     */
    private String status;

    /**
     * 所属组织ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long orgId;

    /**
     * 所属组织名称
     */
    private String orgName;

    /**
     * 父权限组ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long parentId;

    /**
     * 父权限组名称
     */
    private String parentName;

    /**
     * 分类ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long categoryId;

    /**
     * 分类名称
     */
    private String categoryName;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long createBy;

    /**
     * 创建人姓名
     */
    private String createByName;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 更新人ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long updateBy;

    /**
     * 更新人姓名
     */
    private String updateByName;

    /**
     * 更新时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /**
     * 授权对象数量
     */
    private Integer authorizedObjectCount;

    /**
     * 功能权限列表
     */
    private List<PermissionResourceVO> resourcePermissions;

    /**
     * 数据权限配置
     */
    private DataPermissionVO dataPermission;

}

