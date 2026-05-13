package com.iwhalecloud.byai.manager.qo.users;

import com.iwhalecloud.byai.common.qo.QueryObject;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-14 00:45:19
 * @description TODO
 */
@Getter
@Setter
public class UsersByOrgIdQo extends QueryObject {

    /**
     * 查询用户标识，不允许为空
     */
    @NotNull(message = "{usersbyorgidqo.orgid.notnull}")
    private Long orgId;

    /**
     * 是否包含子组织的成员
     */
    private boolean containsChildren;

    /**
     * 关键字搜�?
     */
    private String keyword;

    /**
     * 岗位信息查询
     */
    private Long positionId;

    /***
     * ORD_USER:普通用�?ORG_MAN:组织管理,PLAT_MAN:平台管理,PLAT_DEVOPS:平台运维,DEV_USER:技术开�?
     */
    private String userType;

}
