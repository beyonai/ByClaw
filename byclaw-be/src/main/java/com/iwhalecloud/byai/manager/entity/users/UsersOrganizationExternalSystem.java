package com.iwhalecloud.byai.manager.entity.users;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_users_organization_external_system")
public class UsersOrganizationExternalSystem {

    /**
     * 用户组织外部系统ID
     */
    @TableId(value = "po_users_organization_external_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{usersorganizationexternalsystem.id.notnull}")
    private Long poUsersOrganizationExternalId;

    /**
     * 用户外部系统ID
     */
    @NotNull(groups = {
        Add.class, Mod.class
    }, message = "{usersorganizationexternalsystem.userid.notnull}")
    private Long poUserExternalSystemId;

    /**
     * 组织外部系统ID
     */
    @NotNull(groups = {
        Add.class, Mod.class
    }, message = "{usersorganizationexternalsystem.orgid.notnull}")
    private Long poOrgExternalSystemId;

    /**
     * 来源类型
     */
    private Integer sourceType;

    /**
     * 用户组织ID
     */
    private Long usersOrganizationId;
}