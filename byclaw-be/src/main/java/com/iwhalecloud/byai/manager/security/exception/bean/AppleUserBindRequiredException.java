package com.iwhalecloud.byai.manager.security.exception.bean;

import lombok.Getter;
import org.springframework.security.core.AuthenticationException;

/**
 * @description 苹果用户需要绑定异常
 * 当苹果登录验证通过但无法找到对应系统用户时抛出此异常，
 * 提示用户通过手机号关联或注册新用户
 */
@Getter
public class AppleUserBindRequiredException extends AuthenticationException {

    /**
     * 苹果用户需要绑定的错误码
     */
    public static final int APPLE_BIND_REQUIRED_CODE = -100;

    /**
     * 苹果用户ID
     */
    private final String appleUserId;

    /**
     * 苹果用户邮箱
     */
    private final String appleEmail;

    /**
     * 绑定token，用于后续绑定验证
     */
    private final String bindToken;

    /**
     * 构造函数
     *
     * @param appleUserId 苹果用户ID
     * @param appleEmail 苹果用户邮箱
     * @param bindToken 绑定token
     * @param message 错误消息
     */
    public AppleUserBindRequiredException(String appleUserId, String appleEmail,
                                          String bindToken, String message) {
        super(message);
        this.appleUserId = appleUserId;
        this.appleEmail = appleEmail;
        this.bindToken = bindToken;
    }
}
