package com.iwhalecloud.byai.manager.dto.enterprise;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 企业删除入参。
 */
@Getter
@Setter
public class EnterpriseRemoveDTO {

    /**
     * 企业标识
     */
    @NotNull(message = "{enterprise.id.required}")
    private Long enterpriseId;
}
