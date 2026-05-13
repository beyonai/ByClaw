package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 删除授权对象数据权限数据传输对象
 */
@Getter
@Setter
public class DeleteAuthorizedObjectDataPermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 用户ID
     */
    @NotNull(message = "{user.id.notnull}")
    private Long userId;

}
