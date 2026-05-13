package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批量删除授权对象数据权限数据传输对象
 */
@Getter
@Setter
public class BatchDeleteAuthorizedObjectDataPermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 授权对象ID列表
     */
    @NotEmpty(message = "{authorizedobject.ids.notempty}")
    private List<Long> authorizedObjectIds;

}
