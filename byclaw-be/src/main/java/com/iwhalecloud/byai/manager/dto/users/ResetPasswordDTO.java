package com.iwhalecloud.byai.manager.dto.users;

import com.iwhalecloud.byai.manager.validate.users.annotation.OrgIdValidator;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-23 19:20:11
 * @description TODO
 */
@Getter
@Setter
public class ResetPasswordDTO {

    @NotNull(message = "{resetpassworddto.userid.notnull}")
    private Long userId;

    @NotNull(message = "{resetpassworddto.orgid.notnull}")
    @OrgIdValidator(message = "{resetpassworddto.orgid.valid}")
    private Long orgId;
}
