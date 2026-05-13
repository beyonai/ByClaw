package com.iwhalecloud.byai.common.constants.env;

/**
 * @author he.duming
 * @date 2026-03-06 14:33:19
 * @description TODO
 */
public final class EnvConfigKey {

    private EnvConfigKey() {
    }

    public static final String SERVER_SERVLET_CONTEXT_PATH = "server.servlet.context-path";

    public static final String APP_BYAI_URL = "chat.server.byai";

    public static final String APP_BYAI_FE_URL = "chat.server.byaiDns";

    public static final String SEARCH_SERVICE_BASE_URL = "sys.search_service_base_url";

    public static final String FEIGN_KNOWLEDGE_URL = "feign.knowledge.url";

    /**
     * dochain服务相关
     */
    public static final String DOCCHAIN_URL = "feign.docChain.url";

    public static final String DOCCHAIN_HEADER_API_KEY = "feign.docChain.header.X-Api-Key";

    public static final String DOCCHAIN_PARAMS_TOPIC = "feign.docChain.params.topicId";

    /**
     * RERANKER相关配置
     */
    public static final String RERANKER_MODEL = "sys.reranker_model";

    public static final String RERANKER_API_KEY = "sys.reranker_api_key";

    public static final String RERANKER_BASE_URL = "sys.reranker_base_url";

    /**
     * langfuse相关配置
     */
    public static final String LANGFUSE_SECRET_KEY = "sys.langfuse_secret_key";

    public static final String LANGFUSE_PUBLIC_KEY = "sys.langfuse_public_key";

    public static final String LANGFUSE_HOST = "sys.langfuse_host";

    public static final String LANGFUSE_ENV = "sys.langfuse_env";

    public static final String DIGIT_NUM_LIMIT = "sys.digit_num_limit";

    /**
     * python相关
     */
    public static final String PYTHON_WEB_URL = "sys.python_web_url";

    public static final String PYTHON_ACCESS_KEY = "sys.python_access_key";

    public static final String PYTHON_SECRET_KEY = "sys.python_secret_key";

}
