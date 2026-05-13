package com.iwhalecloud.byai.common.feign.util;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.common.feign.config.FeignSensitiveConfig;
import org.apache.commons.lang3.StringUtils;

/**
 * 敏感信息工具类
 */
public final class MaskSensitiveUtil {

    // 防止实例化
    private MaskSensitiveUtil() {
        throw new UnsupportedOperationException(I18nUtil.get("utility.class.instantiation.forbidden"));
    }


    /**
     * 对敏感信息进行脱敏处理
     */
    public static String maskSensitiveInfo(String content, FeignSensitiveConfig sensitiveConfig) {
        if (StringUtils.isBlank(content) || !sensitiveConfig.isEnabled()) {
            return content;
        }
        
        String result = content;
        for (String field : sensitiveConfig.getSensitiveFieldList()) {
            result = result.replaceAll(
                String.format("(\"%s\"\\s*:\\s*\")(.*?)(\")", field),
                "$1" + sensitiveConfig.getMaskChar() + "$3"
            );
        }
        return result;
    }

} 