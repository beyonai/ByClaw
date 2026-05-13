package com.iwhalecloud.byai.common.util;

import com.iwhalecloud.byai.common.constants.env.EnvConfigKey;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import org.apache.commons.lang3.StringUtils;

/**
 * @author he.duming
 * @date 2026-03-06 18:04:03
 * @description 补全Url工具类
 */
public final class UrlUtil {
    private UrlUtil() {
    }

    /**
     * 获取智能体地址，拼接到/knowledge
     *
     * @return String
     */
    public static String getCompletionKnowledgeUrl() {
        String feignKnowledgeUrl = ApplicationContextUtil.getEnvProperty(EnvConfigKey.FEIGN_KNOWLEDGE_URL);
        return concatUrl(feignKnowledgeUrl, "knowledge");
    }

    /**
     * 获取会话地址，拼接到/conversationService
     * 
     * @return String
     */
    public static String getCompletionConversationUrl() {
        String appByaiUrl = ApplicationContextUtil.getEnvProperty(EnvConfigKey.APP_BYAI_URL);
        String contextPath = ApplicationContextUtil.getEnvProperty(EnvConfigKey.SERVER_SERVLET_CONTEXT_PATH);
        return concatUrl(appByaiUrl, contextPath);
    }

    /**
     * 获取python聊天地址
     * 
     * @return String
     */
    public static String getCompletionPythonAssistantChatURL() {
        String pythonWebUrl = ApplicationContextUtil.getEnvProperty(EnvConfigKey.PYTHON_WEB_URL);
        return concatUrl(pythonWebUrl, "/bePyMain/unified-exec");
    }

    /**
     * 获取python同步事件地址
     *
     * @return String
     */
    public static String getCompletionPythonSyncChatEventUrL() {
        String pythonWebUrl = ApplicationContextUtil.getEnvProperty(EnvConfigKey.PYTHON_WEB_URL);
        return concatUrl(pythonWebUrl, "/append-event");
    }



    /**
     * 获取python知识库检索的接口
     *
     * @return String
     */
    public static String getCompletionPythonKnowledgeRetrieveUrl() {
        String pythonWebUrl = ApplicationContextUtil.getEnvProperty(EnvConfigKey.PYTHON_WEB_URL);
        return concatUrl(pythonWebUrl, "/api/search");
    }


    /**
     * 拼接请求地址
     * 
     * @param url 基础地址
     * @param concatUrl 被拼接的地址
     * @return String
     */
    public static String concatUrl(String url, String concatUrl) {
        if (StringUtils.isBlank(url)) {
            return concatUrl;
        }
        if (StringUtils.isBlank(concatUrl)) {
            return url;
        }
        return url.endsWith("/") ? url.concat(concatUrl) : url.concat("/").concat(concatUrl);
    }

}
