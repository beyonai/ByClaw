package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 更新功能权限数据传输对象
 * 用于单独更新权限组的功能权限配置
 */
@Getter
@Setter
public class UpdateResourcePermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 功能权限配置列表
     */
    private List<PermissionResourceDTO> resourcePermissions;

}

