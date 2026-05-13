package com.iwhalecloud.byai.manager.dto.token;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-06-05 17:56:26
 * @description TODO
 */

@Getter
@Setter
public class RemoveTokenDTO {

    @NotNull(message = "{removetokendto.tokenid.notnull}")
    private Long userAccessTokenId;
}
