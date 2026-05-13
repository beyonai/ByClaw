package com.iwhalecloud.byai.manager.vo.users;

import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-10 16:32:09
 * @description TODO
 */
@Getter
@Setter
public class UsersOrganizationVo extends UsersOrganization {

    /**
     * 组织名称
     */
    private String orgName;

    /**
     * 角色名称
     */
    private String roleName;

    /**
     * 岗位名称
     */
    private String positionName;

}
