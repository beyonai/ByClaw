package com.iwhalecloud.byai.manager.security.exception.bean;

import lombok.Getter;
import org.springframework.security.core.AuthenticationException;

/**
 * @author he.duming
 * @date 2025-06-18 11:14:47
 * @description 自定义异常信息
 */
@Getter
public class LoginAuthenticationException extends AuthenticationException {

    private Long userId;

    private String loginType;

    private String errorCode;

    public LoginAuthenticationException(Long userId, String loginType, String errorCode, String errorMsg) {
        super(errorMsg);
        this.userId = userId;
        this.loginType = loginType;
        this.errorCode = errorCode;
    }
}