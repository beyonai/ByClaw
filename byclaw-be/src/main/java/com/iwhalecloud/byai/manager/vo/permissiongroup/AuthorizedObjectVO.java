package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 授权对象视图对象
 */
@Getter
@Setter
public class AuthorizedObjectVO {

    /**
     * 关联ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 授权对象ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long authorizedObjectId;

    /**
     * 对象类型：user-用户, org-组织, role-角色, position-岗位
     */
    private String objectType;

    /**
     * 对象类型名称
     */
    private String objectTypeName;

    /**
     * 对象ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long objectId;

    /**
     * 对象名称
     */
    private String objectName;

    /**
     * 授权开始时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date effectiveAt;

    /**
     * 授权结束时间
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date expiresAt;

    /**
     * 授权时间（创建时间）
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /**
     * 授权人
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long createBy;

    /**
     * 授权人姓名
     */
    private String createByName;

}

