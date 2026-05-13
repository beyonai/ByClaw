package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 查询目录详情数据传输对象
 */
@Getter
@Setter
public class CategoryDetailQueryDTO {

    /**
     * 目录ID
     */
    @NotNull(message = "目录ID不能为空")
    private Long id;

}

