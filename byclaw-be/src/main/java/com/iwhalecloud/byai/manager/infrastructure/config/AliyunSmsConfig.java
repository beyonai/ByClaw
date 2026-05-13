package com.iwhalecloud.byai.manager.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

@Data
@Configuration
@ConfigurationProperties(prefix = "aliyun.sms")
public class AliyunSmsConfig {

    private String accessKeyId;

    private String accessKeySecret;

    private String signName;

    private String endpoint;

    // 不同业务场景的模板代码
    private Templates templates;

    @Data
    public static class Templates {
        private String login; // 登录验证码模板

        private String register; // 注册验证码模板
    }
}