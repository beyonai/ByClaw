package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.HashMap;
import java.util.Map;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import org.springframework.stereotype.Service;

@Service
public class SandboxHealthConfigService {

    public static final String SWITCH_KEY = "byclaw:sandbox:health:switch";

    private final SandboxProperties properties;

    public SandboxHealthConfigService(SandboxProperties properties) {
        this.properties = properties;
    }

    public boolean isEnabled() {
        if (!properties.getHealth().isEnabled()) {
            return false;
        }
        String cached = RedisUtil.getString(SWITCH_KEY);
        if (cached == null || cached.isBlank()) {
            return false;
        }
        return Boolean.parseBoolean(cached);
    }

    public Map<String, Object> getGlobalSwitch() {
        Map<String, Object> result = new HashMap<>();
        String cached = RedisUtil.getString(SWITCH_KEY);
        result.put("hardEnabled", properties.getHealth().isEnabled());
        result.put("enabled", properties.getHealth().isEnabled() && Boolean.parseBoolean(cached));
        result.put("runtimeEnabled", Boolean.parseBoolean(cached));
        result.put("cacheKey", SWITCH_KEY);
        return result;
    }

    public void saveGlobalSwitch(boolean enabled) {
        RedisUtil.setString(SWITCH_KEY, String.valueOf(enabled));
    }
}
