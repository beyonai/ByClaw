package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 资源关联多个权限组数据传输对象
 * 用于实现一个资源可以关联多个权限组的功能
 */
@Getter
@Setter
public class ResourceAssociatePermissionGroupsDTO {

    /**
     * 资源ID
     */
    @NotNull(message = "资源ID不能为空")
    private Long resourceId;

    /**
     * 权限组ID列表
     */
    @NotNull(message = "权限组ID列表不能为空")
    private List<Long> permissionGroupIds;

}
