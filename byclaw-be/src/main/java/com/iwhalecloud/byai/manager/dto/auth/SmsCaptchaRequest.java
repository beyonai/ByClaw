package com.iwhalecloud.byai.manager.dto.auth;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SmsCaptchaRequest {

    /**
     * 加密后的手机�?用于数据库查�?
     */
    @NotBlank(message = "手机号不能为空")
    private String phone;

    /**
     * 业务类型�?-登录�?-注册
     */
    @NotBlank(message = "业务类型不能为空")
    private String bizType; // 1-登录�?-注册

    /**
     * 图形验证�?
     */
    @NotBlank(message = "图形验证码不能为空")
    private String captcha;

}