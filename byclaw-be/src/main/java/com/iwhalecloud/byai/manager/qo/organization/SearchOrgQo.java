package com.iwhalecloud.byai.manager.qo.organization;

import lombok.Getter;
import lombok.Setter;

import jakarta.validation.constraints.NotNull;

/**
 * @author he.duming
 * @date 2025-04-14 01:16:54
 * @description TODO
 */
@Getter
@Setter
public class SearchOrgQo {

    /**
     * 查询组织标识，不允许为空
     */
    @NotNull(message = "{searchorgqo.orgid.notnull}")
    private Long orgId;

}
