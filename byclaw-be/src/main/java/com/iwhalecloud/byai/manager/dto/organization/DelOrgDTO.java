package com.iwhalecloud.byai.manager.dto.organization;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-14 01:08:43
 * @description 删除组织对象
 */
@Getter
@Setter
public class DelOrgDTO {
    /**
     * 删除组织标识不允许为空
     */
    @NotNull(message = "{delorgdto.orgid.notnull}")
    private Long orgId;
}
