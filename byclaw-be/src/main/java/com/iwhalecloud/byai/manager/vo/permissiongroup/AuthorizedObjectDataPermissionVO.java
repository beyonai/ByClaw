package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 授权对象数据权限视图对象
 */
@Getter
@Setter
public class AuthorizedObjectDataPermissionVO {

    /**
     * 主键ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long id;

    /**
     * 权限组ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long permissionGroupId;

    /**
     * 用户ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long userId;

    /**
     * 授权对象类型
     */
    private String objectType;

    /**
     * 授权对象名称
     */
    private String objectName;

    /**
     * 授权对象编码
     */
    private String objectCode;

    /**
     * 权限配置对象
     */
    private String permissions;

    /**
     * 状态
     */
    private String status;

}
