package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * 权限资源视图对象
 */
@Getter
@Setter
public class PermissionResourceVO {

    /**
     * 资源ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long resourceId;

    /**
     * 权限组ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long permissionGroupId;

    /**
     * 权限组编码
     */
    private String groupCode;

    private String groupName;
    /**
     * 权限组描述
     */
    private String groupDesc;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源类型
     */
    private String resourceType;

    /**
     * 父资源ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long parentId;

    /**
     * 权限类型列表
     */
    private List<String> permissionTypes;

    /**
     * 是否有查看权限
     */
    private Boolean hasRead;

    /**
     * 是否有编辑权限
     */
    private Boolean hasWrite;

    /**
     * 是否有删除权限
     */
    private Boolean hasDelete;

    /**
     * 是否有导出权限
     */
    private Boolean hasExport;

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
     * 子资源列表
     */
    private List<PermissionResourceVO> children;

}

