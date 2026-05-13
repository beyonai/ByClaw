package com.iwhalecloud.byai.manager.dto.users;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;

/**
 * APP端刷新Token登录请求DTO
 * 
 * @author AI Assistant
 * @date 2025-01-XX
 */
@Getter
@Setter
public class AppRefreshTokenLoginRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 刷新Token
     */
    @NotBlank(message = "refreshToken不能为空")
    private String refreshToken;
}

