package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 可用授权对象视图对象
 */
@Getter
@Setter
public class AvailableObjectVO {

    /**
     * 对象ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long objectId;

    /**
     * 对象类型：user-用户, org-组织, role-角色, position-岗位
     */
    private String objectType;

    /**
     * 对象名称
     */
    private String objectName;

    /**
     * 对象编码（用户账号/组织编码等）
     */
    private String objectCode;

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
     * 是否已授权
     */
    private Boolean authorized;

}

