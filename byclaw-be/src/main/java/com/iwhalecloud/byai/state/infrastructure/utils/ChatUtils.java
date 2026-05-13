package com.iwhalecloud.byai.state.infrastructure.utils;

import java.util.HashMap;
import java.util.Map;
import com.iwhalecloud.byai.common.constants.env.EnvConfigKey;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;

public final class ChatUtils {
    private ChatUtils() {
    }

    /**
     * 截断前num个字符
     *
     * @param input 输入字符串
     * @param num 截取长度
     * @return 截取后的字符串
     */
    public static String truncateString(String input, int num) {
        if (input == null) {
            return "";
        }
        int length = input.length();
        return length > num ? input.substring(0, num) : input;
    }

    /**
     * 获取语言配置
     *
     * @return 语言字符串
     */
    public static String getLanguage() {
        String language = I18nUtil.CHINSES;
        try {
            language = ApplicationContextUtil.getRequest().getAttribute(I18nUtil.LANGUAGE).toString();
        }
        catch (Exception e) {
            // 默认中文
        }
        return language;
    }

    /**
     * 联网检索参数拼接
     *
     * @return 参数Map
     */
    public static Map<String, Object> getConnectParams() {
        Map<String, Object> result = new HashMap<>();
        Map<String, Object> params = new HashMap<>();
        params.put("topic_id", ApplicationContextUtil.getEnvProperty(EnvConfigKey.DOCCHAIN_PARAMS_TOPIC));
        Map<String, Object> header = new HashMap<>();
        header.put("X-Api-Key", ApplicationContextUtil.getEnvProperty(EnvConfigKey.DOCCHAIN_HEADER_API_KEY));
        result.put("params", params);
        result.put("header", header);
        return result;
    }
}