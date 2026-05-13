package com.iwhalecloud.byai.manager.dto.digitemploy;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 设置默认数字员工入参
 */
@Getter
@Setter
public class SetDefaultDigitalEmployeeDTO {

    /**
     * 数字员工资源ID
     */
    @NotNull(message = "数字员工资源ID不能为空")
    private Long resourceId;
}
