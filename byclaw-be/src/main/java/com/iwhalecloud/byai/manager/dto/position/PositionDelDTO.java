package com.iwhalecloud.byai.manager.dto.position;

import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-23 20:53:03
 * @description TODO
 */
@Getter
@Setter
public class PositionDelDTO {

    @NotNull(groups = Mod.class, message = "{positiondeldto.positionid.notnull}")
    private Long positionId;

}
