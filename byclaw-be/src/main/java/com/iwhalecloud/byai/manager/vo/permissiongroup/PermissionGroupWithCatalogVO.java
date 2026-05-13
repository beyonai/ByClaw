package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 权限组（含目录信息）视图对象
 * 用于权限组和目录联合查询的权限组信息返回
 */
@Getter
@Setter
public class PermissionGroupWithCatalogVO {

    /**
     * 权限组ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long groupId;

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
    private String comments;

    /**
     * 创建时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createDate;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long userId;

    /**
     * 所属目录信息
     */
    private CatalogSimpleVO biCatalog;

}

