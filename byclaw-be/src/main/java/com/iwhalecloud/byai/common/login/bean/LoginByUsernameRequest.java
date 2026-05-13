package com.iwhalecloud.byai.common.login.bean;

import java.io.Serializable;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class LoginByUsernameRequest implements Serializable {

    /**
     * 登录类型：1.用户名+密码+图形验证码、2.用户名+密码+短信验证、3.手机号码+密码+短信验证码、4.手机号码+短信验证码
     * 、5.用户名+密码、6.手机号码+图形数字验证码、7.用户名或手机号码+密码+图形数字验证码、8.钉钉动态令牌：工号+口令
     */
    private String loginType;

    private String accountCode;

    private String accountPwd;

    private String encrypt;

}
