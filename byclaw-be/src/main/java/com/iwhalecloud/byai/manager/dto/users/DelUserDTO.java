package com.iwhalecloud.byai.manager.dto.users;

import lombok.Getter;
import lombok.Setter;

import jakarta.validation.constraints.NotNull;

/**
 * @author he.duming
 * @date 2025-04-14 00:42:08
 * @description TODO
 */
@Getter
@Setter
public class DelUserDTO {
    /**
     * 删除用户标识，不允许为空
     */
    @NotNull(message = "{deluserdto.userid.notnull}")
    private Long userId;

    @NotNull(message = "{deluserdto.orgid.notnull}")
    private Long orgId;

}
