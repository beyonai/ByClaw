package com.iwhalecloud.byai.state.application.service.recorder;

import java.util.regex.Pattern;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "recorder.save-adapter")
public class RecorderSaveProperties implements InitializingBean {

    private static final Pattern SAFE_INSTANCE = Pattern.compile(
        "[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?"
    );
    private static final int DEFAULT_TIMEOUT_MS = 30_000;

    private boolean productionEnabled;
    private String instance = "bycli";
    private final int timeoutMs;

    public RecorderSaveProperties() {
        this(DEFAULT_TIMEOUT_MS);
    }

    RecorderSaveProperties(int timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public boolean isProductionEnabled() {
        return productionEnabled;
    }

    public void setProductionEnabled(boolean productionEnabled) {
        this.productionEnabled = productionEnabled;
    }

    public String getInstance() {
        return instance;
    }

    public void setInstance(String instance) {
        this.instance = instance;
    }

    public int getTimeoutMs() {
        return timeoutMs;
    }

    @Override
    public void afterPropertiesSet() {
        if (!productionEnabled) {
            return;
        }
        if (!isSafeInstance(instance)) {
            throw new IllegalStateException("recorder save adapter instance must be a safe path segment");
        }
        if (timeoutMs <= 0) {
            throw new IllegalStateException("recorder save adapter timeout is invalid");
        }
    }

    private static boolean isSafeInstance(String value) {
        return value != null && SAFE_INSTANCE.matcher(value).matches();
    }
}
