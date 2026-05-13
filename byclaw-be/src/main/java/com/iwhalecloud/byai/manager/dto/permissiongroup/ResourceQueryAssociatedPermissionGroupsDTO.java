package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 查询资源关联权限组信息数据传输对象
 * 用于查询指定资源关联的所有权限组信息
 */
@Getter
@Setter
public class ResourceQueryAssociatedPermissionGroupsDTO {

    /**
     * 资源ID
     */
    @NotNull(message = "资源ID不能为空")
    private Long resourceId;

}
