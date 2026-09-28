package com.iwhalecloud.byai.manager.dto.enterprise;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 切换当前企业（租户）入参。
 */
@Getter
@Setter
public class EnterpriseSwitchDTO {

    /**
     * 目标企业标识
     */
    @NotNull(message = "{enterprise.id.required}")
    private Long enterpriseId;
}
