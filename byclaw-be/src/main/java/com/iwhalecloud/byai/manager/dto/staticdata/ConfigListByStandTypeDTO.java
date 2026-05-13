package com.iwhalecloud.byai.manager.dto.staticdata;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-21 18:00:23
 * @description TODO
 */
@Getter
@Setter
public class ConfigListByStandTypeDTO {

    @NotEmpty(message = "{configlistbystandtypedto.type.notempty}")
    private String standType;
}
