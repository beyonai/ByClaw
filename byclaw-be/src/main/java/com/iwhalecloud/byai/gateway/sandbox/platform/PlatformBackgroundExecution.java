package com.iwhalecloud.byai.gateway.sandbox.platform;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public final class PlatformBackgroundExecution {
    private final boolean legacy;

    public PlatformBackgroundExecution(Environment env) {
        String mode = env.getProperty("byclaw.platform.execution-mode", "legacy");
        if (!"legacy".equals(mode) && !"remote".equals(mode))
            throw new IllegalArgumentException("execution-mode must be legacy or remote");
        legacy = "legacy".equals(mode);
    }

    public boolean isLegacyExecutor() {
        return legacy;
    }
}
