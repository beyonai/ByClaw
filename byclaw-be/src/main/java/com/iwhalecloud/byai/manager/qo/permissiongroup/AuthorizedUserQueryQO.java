package com.iwhalecloud.byai.manager.qo.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 权限组授权用户查询对象
 */
@Getter
@Setter
public class AuthorizedUserQueryQO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    private List<Long> permissionGroupIds;

    private List<String> userCodeList;

    private List<Long> userScopeUserList;

    private List<Long> userScopeOrgList;

    private List<Long> userScopePositionList;

    /**
     * 用户名称（模糊查询）
     */
    private String userName;

    /**
     * 用户编码（模糊查询）
     */
    private String userCode;

    /**
     * 组织ID（可选，用于过滤特定组织的用户）
     */
    private Long orgId;

    private String dimensionType;

    private List<Long> objIdList;

    private Long currentUserId;


    /**
     * 当前页码
     */
    private Long pageIndex = 1L;

    /**
     * 每页条数
     */
    private Long pageSize = 10L;

}
