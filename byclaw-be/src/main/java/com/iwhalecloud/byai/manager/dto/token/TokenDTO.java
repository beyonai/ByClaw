package com.iwhalecloud.byai.manager.dto.token;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-06-05 17:49:05
 * @description TODO
 */
@Getter
@Setter
public class TokenDTO {

    @NotEmpty(message = "{tokendto.name.notempty}")
    @Size(max = 255, message = "{tokendto.name.size}")
    private String accessTokenName;
}
