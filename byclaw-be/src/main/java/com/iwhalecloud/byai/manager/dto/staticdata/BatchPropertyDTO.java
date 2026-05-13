package com.iwhalecloud.byai.manager.dto.staticdata;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-06-29 16:39:03
 * @description TODO
 */
@Getter
@Setter
public class BatchPropertyDTO {

    @NotEmpty(message = "{batchpropertydto.keys.notempty}")
    private List<String> keys;
}
