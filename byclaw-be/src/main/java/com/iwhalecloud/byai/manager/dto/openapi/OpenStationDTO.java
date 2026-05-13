package com.iwhalecloud.byai.manager.dto.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Del;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 外部驻地DTO 用于外部接口新增/修改驻地
 */
@Getter
@Setter
public class OpenStationDTO {
    @NotNull(groups = {
        Add.class, Mod.class, Del.class
    }, message = "{openstationdto.stationid.notnull}")
    private Long stationId;

    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{openstationdto.name.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 200, message = "{openstationdto.name.size}")
    private String stationName;

    @NotNull(groups = Add.class, message = "{openstationdto.type.notnull}")
    private Integer stationType;

    private String stationIdPath;

    @NotNull(groups = Add.class, message = "{openstationdto.parentid.notnull}")
    private Long pStationId;

    @NotNull(groups = Add.class, message = "{openstationdto.isabroad.notnull}")
    private Integer isAbroad;

    private Long comAcctId;

    /**
     * 是否生成新的主键映射外系统数�?
     */
    private boolean newPrimaryKey;
}