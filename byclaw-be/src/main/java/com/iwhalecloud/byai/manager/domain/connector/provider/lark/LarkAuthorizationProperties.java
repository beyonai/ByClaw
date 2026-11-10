package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Data;

@Data
@ConfigurationProperties(prefix = "byclaw.connector.lark")
public class LarkAuthorizationProperties {

    private int maxOutputBytes = 512 * 1024;
    private int maxConcurrency = 32;
    private Duration initializationOutputTimeout = Duration.ofSeconds(15);

    public boolean isSandboxExecutor() {
        return true;
    }
}
