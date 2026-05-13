package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 删除权限组目录数据传输对象
 */
@Getter
@Setter
public class DeleteCategoryDTO {

    /**
     * 目录ID
     */
    @NotNull(message = "{permissiongroupcategory.id.notnull}")
    private Long id;

}

