package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Data;

@Data
@ConfigurationProperties(prefix = "byclaw.connector.lark")
public class LarkAuthorizationProperties {

    private static final String SANDBOX_SERVICE_KEY = "openclaw";

    private int maxOutputBytes = 512 * 1024;
    private int maxConcurrency = 32;

    public boolean isSandboxExecutor() {
        return true;
    }

    public String getSandboxServiceKey() {
        return SANDBOX_SERVICE_KEY;
    }
}
