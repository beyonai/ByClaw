package com.iwhalecloud.byai.manager.dto.openapi;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-30 13:44:52
 * @description TODO
 */
@Getter
@Setter
public class OpenDelUserDTO {

    @NotNull(message = "{opendeluserdto.userid.notnull}")
    private Long userId;
}
