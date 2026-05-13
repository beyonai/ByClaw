package com.iwhalecloud.byai.common.log.exception;

public class ServiceCode {
    /**
     * 记忆引擎消息模块发生报错
     */
    public static final String MEMORY_SYSTEM_MESSAGE_ERROR = "MEMORY_SYSTEM_MESSAGE_ERROR";

    /**
     * 记忆引擎检索模块发生报错
     */
    public static final String MEMORY_SYSTEM_SEARCH_ERROR = "MEMORY_SYSTEM_SEARCH_ERROR";

    /**
     * 智能体模块发生报错
     */
    public static final String INTELLIGENT_AGENT_PLATFORM_ERROR = "INTELLIGENT_AGENT_PLATFORM_ERROR";

    /**
     * bymanager模块发生报错
     */
    public static final String BYAI_MANAGER_PLATFORM_ERROR = "BYAI_MANAGER_PLATFORM_ERROR";


    /**
     * chatbi模块发生报错
     */
    public static final String CHATBI_PLATFORM_ERROR = "CHATBI_PLATFORM_ERROR";

    /**
     * docchain模块发生报错
     */
    public static final String DOCCHAIN_PLATFORM_ERROR = "DOCCHAIN_ERROR";
    /**
     * 数字人模块发生错误
     */
    public static final String DIGITAL_HUMAN_ERROR = "DIGITAL_HUMAN_ERROR";

    public static final String REQUEST_ID = "requestId";

    public static class Module {
        /**
         * 智能体模块
         */
        public static final String APP_AGENT = "APP_AGENT";
        /**
         * chatbi模块
         */
        public static final String APP_CHATBI = "APP_CHATBI";
        /**
         * docchain
         */
        public static final String APP_DOCCHAIN = "APP_DOCCHAIN";
        /**
         * 慧笔
         */
        public static final String APP_WRITER = "APP_WRITER";
        /**
         * 数字人
         */
        public static final String APP_DH = "APP_DH";
        /**
         * APP_BY
         */
        public static final String APP_BY = "APP_BY";
        /**
         * 记忆引擎search
         */
        public static final String APP_MEMORY_SEARCH = "APP_MEMORY_SEARCH";
    }

}
