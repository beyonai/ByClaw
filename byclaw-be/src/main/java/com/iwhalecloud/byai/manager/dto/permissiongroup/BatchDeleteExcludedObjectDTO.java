package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批量删除排除对象数据传输对象
 */
@Getter
@Setter
public class BatchDeleteExcludedObjectDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 关联ID列表
     */
    @NotEmpty(message = "{excludedobject.ids.notempty}")
    private List<Long> ids;

}
