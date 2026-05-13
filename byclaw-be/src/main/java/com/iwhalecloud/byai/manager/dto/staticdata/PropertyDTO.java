package com.iwhalecloud.byai.manager.dto.staticdata;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-06-29 14:49:42
 * @description TODO
 */
@Getter
@Setter
public class PropertyDTO {

    @NotEmpty(message = "{propertydto.key.notempty}")
    private String key;

}
