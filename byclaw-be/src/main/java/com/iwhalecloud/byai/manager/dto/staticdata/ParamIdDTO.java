package com.iwhalecloud.byai.manager.dto.staticdata;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-01-07 23:15:01
 * @description TODO
 */
@Getter
@Setter
public class ParamIdDTO {

    /**
     * 参数ID
     */
    @NotNull(message = "参数ID不能为空")
    private Long paramId;
}
