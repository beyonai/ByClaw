package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批量删除权限组资源数据传输对象
 */
@Getter
@Setter
public class BatchDeleteResourcePermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 资源ID列表
     */
    @NotEmpty(message = "{resource.ids.notempty}")
    private List<Long> resourceIds;

}

