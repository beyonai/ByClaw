package com.iwhalecloud.byai.manager.domain.resource.util;

import java.util.Locale;

import org.apache.commons.lang3.StringUtils;

/**
 * 数字员工及相关资源 Redis 键命名约定。
 */
public final class DigEmployeeRedisKeys {

    /** 技能列表缓存前缀，值为 {@code querySkillsForOpenApi} 的 JSON 数组。 */
    public static final String SKILL_CACHE_PREFIX = "RESOURCE_DIG_EMPLOYEE_";

    private static final String DIG_EMPLOYEE_BIZ_TYPE = "DIG_EMPLOYEE";

    private DigEmployeeRedisKeys() {
    }

    /**
     * 完整数字员工配置快照键，与开放资源目录文件 {@code DIG_EMPLOYEE_{resourceId}.json} 基名一致。
     */
    public static String configJsonKey(long resourceId) {
        return resourceConfigJsonKey(DIG_EMPLOYEE_BIZ_TYPE, resourceId);
    }

    /**
     * 单资源标准 JSON 快照键，与开放资源目录 {@code {BIZTYPE}_{resourceId}.json} 基名一致。
     */
    public static String resourceConfigJsonKey(String resourceBizType, long resourceId) {
        String typePart = StringUtils.isBlank(resourceBizType) ? "UNKNOWN"
            : resourceBizType.toUpperCase(Locale.ROOT);
        return typePart + "_" + resourceId;
    }

    public static String skillCacheKey(long resourceId) {
        return SKILL_CACHE_PREFIX + resourceId;
    }
}
