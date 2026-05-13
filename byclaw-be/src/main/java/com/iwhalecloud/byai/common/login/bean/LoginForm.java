package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;
import java.io.Serializable;

@Getter
@Setter
public class LoginForm implements Serializable {

    private String language = "zh-CN";

    private String loginType;

    private String phone;

    private String accountCode;

    private String accountPwd;

    private String encrypt;

    private String verifyCode;

}
