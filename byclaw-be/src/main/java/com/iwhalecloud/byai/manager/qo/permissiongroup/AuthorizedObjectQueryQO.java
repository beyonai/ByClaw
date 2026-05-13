package com.iwhalecloud.byai.manager.qo.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 授权对象查询对象
 */
@Getter
@Setter
public class AuthorizedObjectQueryQO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 对象类型：user-用户, org-组织, role-角色, position-岗位
     */
    private String objectType;

    /**
     * 对象名称（模糊查询）
     */
    private String objectName;

    /**
     * 当前页码
     */
    private Long pageIndex = 1L;

    /**
     * 每页条数
     */
    private Long pageSize = 10L;

}

