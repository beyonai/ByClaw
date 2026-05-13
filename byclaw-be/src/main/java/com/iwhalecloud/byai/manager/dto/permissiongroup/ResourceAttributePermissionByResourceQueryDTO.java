package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 查询指定资源的属性权限列表数据传输对象
 */
@Getter
@Setter
public class ResourceAttributePermissionByResourceQueryDTO {

    /**
     * 资源ID
     */
    @NotNull(message = "资源ID不能为空")
    private Long resourceId;

}

