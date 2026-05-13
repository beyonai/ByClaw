package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 授权对象数据权限列表查询数据传输对象
 */
@Getter
@Setter
public class AuthorizedObjectDataPermissionListQueryDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

}
