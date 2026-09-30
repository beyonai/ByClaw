package com.iwhalecloud.byai.manager.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class SmsCaptchaRequest {

    /**
     * 加密后的手机�?用于数据库查�?
     */
    @NotBlank(message = "手机号不能为空")
    @Size(max = 512)
    private String phone;

    /**
     * 业务类型�?-登录�?-注册
     */
    @NotBlank(message = "业务类型不能为空")
    @Pattern(regexp = "[12]", message = "业务类型必须为1或2")
    private String bizType; // 1-登录�?-注册

    /**
     * 图形验证�?
     */
    @NotBlank(message = "图形验证码不能为空")
    @Size(max = 64)
    private String captcha;

}
