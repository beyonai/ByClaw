package com.iwhalecloud.byai.manager.dto.staticdata;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-21 17:58:17
 * @description TODO
 */
@Getter
@Setter
public class DcSystemConfigDTO {

    @NotEmpty(message = "{dcsystemconfigdto.paramcode.notempty}")
    private String paramCode;
}
