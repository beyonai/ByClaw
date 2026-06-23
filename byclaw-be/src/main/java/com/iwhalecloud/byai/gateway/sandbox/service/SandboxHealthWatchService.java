package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

@Service
public class SandboxHealthWatchService {

    private static final String WATCH_KEY_PREFIX = "byclaw:sandbox:health:watch:";

    private final SandboxHealthConfigService configService;
    private final SandboxProperties properties;

    public SandboxHealthWatchService(SandboxHealthConfigService configService, SandboxProperties properties) {
        this.configService = configService;
        this.properties = properties;
    }

    public void touch(String userCode, String serviceType) {
        touch(userCode, serviceType, properties.getHealth().getWatchTtlSeconds(), "HEARTBEAT");
    }

    public void touch(String userCode, String serviceType, long ttlSeconds, String source) {
        if (!configService.isEnabled() || StringUtils.isAnyBlank(userCode, serviceType)) {
            return;
        }
        long effectiveTtl = ttlSeconds > 0 ? ttlSeconds : properties.getHealth().getWatchTtlSeconds();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userCode", userCode);
        payload.put("serviceType", serviceType);
        payload.put("source", StringUtils.defaultIfBlank(source, "UNKNOWN"));
        payload.put("touchedAt", System.currentTimeMillis());
        RedisUtil.setString(key(userCode, serviceType), JSON.toJSONString(payload), effectiveTtl, TimeUnit.SECONDS);
    }

    public static String key(String userCode, String serviceType) {
        return WATCH_KEY_PREFIX + userCode + ":" + serviceType;
    }
}
