package com.iwhalecloud.byai.manager.dto.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-30 01:40:43
 * @description TODO
 */
@Getter
@Setter
public class OpenOrgDTO {

    @NotNull(groups = Mod.class, message = "{openorgdto.orgid.notnull}")
    private Long orgId;

    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{openorgdto.name.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "{openorgdto.name.size}")
    private String orgName;

    private String orgCode;

    private Long parentOrgId;

    private Integer orgIndex;

    /**
     * 是否生成新的主键映射外系统数�?
     */
    private boolean newPrimaryKey;
}
