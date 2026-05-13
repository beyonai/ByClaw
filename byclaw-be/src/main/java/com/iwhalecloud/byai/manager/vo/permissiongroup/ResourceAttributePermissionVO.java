package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 资源属性权限视图对象
 */
@Getter
@Setter
public class ResourceAttributePermissionVO {

    /**
     * 关联ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 资源ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long resourceId;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源属性ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long resourceAttributeId;

    /**
     * 资源属性名称
     */
    private String attributeName;

    /**
     * 资源属性编码
     */
    private String attributeCode;

    /**
     * 数据范围类型：self-本人、org-组织、position-岗位、station-驻地等
     */
    private String dataScopeType;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long createBy;

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

}

