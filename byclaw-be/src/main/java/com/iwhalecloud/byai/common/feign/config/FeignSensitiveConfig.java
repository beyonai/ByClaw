package com.iwhalecloud.byai.common.feign.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Data
@Component
@ConfigurationProperties(prefix = "feign.sensitive")
public class FeignSensitiveConfig {
    
    /**
     * 是否启用敏感信息脱敏
     */
    private boolean enabled = true;
    
    /**
     * 脱敏替换字符
     */
    private String maskChar = "*****";

    private List<String> sensitiveFieldList = new ArrayList<>();

    /**
     * 敏感字段列表
     */
    public FeignSensitiveConfig() {
        sensitiveFieldList.add("password");
        sensitiveFieldList.add("token");
        sensitiveFieldList.add("secret");
        sensitiveFieldList.add("authorization");
        sensitiveFieldList.add("accessToken");
        sensitiveFieldList.add("refreshToken");
    }
} 