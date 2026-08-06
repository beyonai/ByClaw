package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Data;

@Data
@ConfigurationProperties(prefix = "byclaw.connector.lark")
public class LarkAuthorizationProperties {

    private String authorizationExecutor = "be";
    private String sandboxServiceKey = "openclaw";
    private int maxOutputBytes = 512 * 1024;
    private int maxConcurrency = 32;

    public boolean isSandboxExecutor() {
        return "sandbox".equalsIgnoreCase(authorizationExecutor);
    }
}
