package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 查询权限组详情数据传输对象
 */
@Getter
@Setter
public class PermissionGroupDetailQueryDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "权限组ID不能为空")
    private Long id;

}

