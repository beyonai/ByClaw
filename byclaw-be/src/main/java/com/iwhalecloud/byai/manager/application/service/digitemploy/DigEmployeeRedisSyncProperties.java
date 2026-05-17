package com.iwhalecloud.byai.manager.application.service.digitemploy;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 数字员工 Redis 同步配置。
 */
@ConfigurationProperties(prefix = "byai.dig-employee")
public class DigEmployeeRedisSyncProperties {

    /**
     * 是否将完整数字员工 JSON 同步到 Redis（键 {@code DIG_EMPLOYEE_{resourceId}}）。
     */
    private boolean jsonRedisSyncEnabled = true;

    public boolean isJsonRedisSyncEnabled() {
        return jsonRedisSyncEnabled;
    }

    public void setJsonRedisSyncEnabled(boolean jsonRedisSyncEnabled) {
        this.jsonRedisSyncEnabled = jsonRedisSyncEnabled;
    }
}
