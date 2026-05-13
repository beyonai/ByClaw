package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * 权限组目录视图对象
 */
@Getter
@Setter
public class PermissionGroupCategoryVO {

    /**
     * 目录ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 目录名称
     */
    private String categoryName;

    /**
     * 父级目录ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long parentId;

    /**
     * 父级目录名称
     */
    private String parentName;

    /**
     * 目录编码
     */
    private String categoryCode;

    /**
     * 目录描述
     */
    private String description;

    /**
     * 图标
     */
    private String icon;

    /**
     * 排序顺序
     */
    private Integer sortOrder;

    /**
     * 状态：active-启用, inactive-禁用
     */
    private String status;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long createBy;

    /**
     * 创建人名称
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
     * 更新时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    /**
     * 组织ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long orgId;

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 该目录下的权限组数量
     */
    private Integer permissionGroupCount;

    /**
     * 子目录列表（树形结构用）
     */
    private List<PermissionGroupCategoryVO> children;

}

