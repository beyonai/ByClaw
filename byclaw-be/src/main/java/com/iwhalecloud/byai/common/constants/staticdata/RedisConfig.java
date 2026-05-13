package com.iwhalecloud.byai.common.constants.staticdata;

/**
 * @author he.duming
 * @date 2026-03-05 15:17:18
 * @description TODO
 */
public final class RedisConfig {

    private RedisConfig() {
    }

    /**
     * 静态参数编码，单个缓存
     */
    public static final String SYSTEM_CONFIG_CODE_KEY = "byai:SystemConfig:paramCode";

    /**
     * 静态参数列表分组，列表分组缓存
     */
    public static final String SYSTEM_CONFIG_GROUP_CODE_KEY = "byai:SystemConfigList:paramGroupCode";

    /**
     * 模型关键key
     */
    public static final String AI_MODEL_KEY = "byai:aimodel:config";

    /**
     * 模型类型
     */
    public static final String AI_MODEL_TYPE_KEY = "byai:aimodel:typelist";

    /**
     * redis中存储的重放攻击
     */
    public static final String SECURITYSIGN_CACHE_PREFIX = "byai:securitysign:";
}
