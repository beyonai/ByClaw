package com.iwhalecloud.byai.manager.dto.users;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-06-20 09:36:21
 * @description TODO
 */
@Getter
@Setter
public class UpdatePasswordDTO {

    /**
     * 用户标识
     */
    @NotNull(message = "{updatepassworddto.userid.notnull}")
    private Long userId;

    /**
     * 旧密码
     */
    @NotEmpty(message = "{updatepassworddto.oldpassword.notempty}")
    private String oldPassword;

    /**
     * 新密码
     */
    @NotEmpty(message = "{updatepassworddto.newpassword.notempty}")
    private String newPassword;

}
