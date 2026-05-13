package com.iwhalecloud.byai.common.constants;

/**
 * 学量池，存放公共常量，非公共类常请自定义类型存放
 */
public final class Constants {

    private Constants() {
    }

    /**
     * 通用Y代表是
     */
    public static final String YES_VALUE_Y = "Y";

    /**
     * 通用N代表否
     */
    public static final String NO_VALUE_N = "N";

    /**
     * 通用true代表真
     */
    public static final String YES_VALUE_TRUE = "true";

    /**
     * 通用false代表假
     */
    public static final String NO_VALUE_FALSE = "false";

    /**
     * 有效状态
     */
    public static final String STATUS_00A = "00A";

    public static final String STATUS_ENABLED = "OOA";

    /**
     * 无效状态
     */
    public static final String STATUS_00X = "00X";

    /***
     * 字符编码
     */
    public static final String CHARSET_UTF8 = "UTF-8";

    /**
     * 登录类型：1.用户名+密码+图形验证码、2.用户名+密码+短信验证、3.手机号码+密码+短信验证码、4.手机号码+短信验证码 、5.用户名+密码、6.手机号码+图形数字验证码
     */
    public static final String LOGIN_TYPE = "LOGIN_TYPE";

    /**
     * 智能体默认的团队空间ID
     */
    public static final String AGENT_SPACE_ID = "AGENT_RESOURCE_PROJECT_ID";

    /**
     * 数据云MCP服务URL配置参数编码
     */
    public static final String UI_DATA_CLOUD_MCP = "UI_DATA_CLOUD_MCP";

    /**
     * 智能体默认的团队空间ID
     */
    public static final String AGENT_RESOURCE_PROJECT_ID = "AGENT_RESOURCE_PROJECT_ID";

    /**
     * 是否启用审批流程
     */
    public static final String ENABLE_APPROVE = "ENABLE_APPROVE";

    /**
     * 智能体响应成功
     */
    public static final String RESPONSE_SUCCESS = "0";

    /**
     * redis中存储的驻地标识
     */
    public static final String SHARE_STATION = "SHARE_STATION_";

    /**
     * redis中存储的用户Id
     */
    public static final String SHARE_BFM_USER = "SHARE_BFM_USER_";

    /**
     * redis中存储的用户编码
     */
    public static final String SHARE_BFM_USER_CODE = "SHARE_BFM_USER_CODE_";

    /**
     * redis中存储的用户编码
     */
    public static final String SHARE_ORGANIZATION = "SHARE_ORGANIZATION_";

    /**
     * redis中存储的用户编码对应的组织列表信息
     */
    public static final String SHARE_USER_ORG_POST = "SHARE_USER_ORG_POST_";

    /**
     * redis中存储的岗位信息
     */
    public static final String SHARE_POSITION = "SHARE_POSITION_";

    /**
     * 分享组织权限
     */
    public static final String SHARE_ORG_ = "_SHARE_ORG_";

    /**
     * 分享用户权限
     */
    public static final String SHARE_USER_ = "_SHARE_USER_";

    public static final String SMART_OFFICE = "smart_office";

    public static final String SEARCH_QUERY_MODE = "search_query";

    /**
     * 用户提问
     */
    public static final Integer CHAT_QUESTION = 1;

    /**
     * 系统回答
     */
    public static final Integer CHAT_ANSWER = 2;

    public static final String RELOBJ_AGENT = "AGE_";

    public static final String RELOBJ_ASSISTANT = "SU_";

    public static final String RESOBJ_AGENT = "AGENT";

    public static final String ACCESSTERMINAL = "ACCESSTERMINAL";

    /**
     * 反馈配置
     */
    public static final String FEEDBACK_TYPE = "FEEDBACK";

    /**
     * 评估配置
     */
    public static final String EVALUATE_TYPE = "EVALUATE_TYPE";

    /**
     * redis中存储的重放攻击
     */
    public static final String SECURITYSIGN_CACHE_PREFIX = "byai:securitysign:";

    /**
     * 允许退订
     */
    public static final String ALLOW_UNSUBSCRIBE = "001";

    /**
     * 不允许退订
     */
    public static final String NOT_ALLOW_UNSUBSCRIBE = "002";

    /**
     * redis中的个人使用权限
     */
    public static final String PERSON_AVAILABLE_PRIV = "DATASET:AUTHORITY:1_RED_READ_PERSON_";

    /**
     * redis中的个人使用权限
     */
    public static final String PERSON_AVAILABLE_PRIV_BALCK = "DATASET:AUTHORITY:1_BLACK_READ_PERSON_";

    /***
     * 存储在线用户的Set键名
     */
    public static final String ONLINE_USERS_SET_KEY = "online:users";

    /**
     * 用户活跃过期键的前缀（每个用户一个键）
     */
    public static final String USER_ACTIVE_PREFIX = "user:active:";

    public static final String LOGIN = "1";

    public static final String REGISTER = "2";

    /**
     * 百应系统在全程调度的restfulAPI数据源
     */
    public static final String BYAI_MANAGER_SYS_CODE = "ByaiManager";

    // 将所有属性声明移到内部类之前
    public static final String UDAL = "udal";

    public static final String THIRD_AGENT_URL = "THIRD_AGENT_URL";

    public static final String DB_TABLE = "DB_TABLE";

    public static final String OUT_PARAM = "out_param";

    /**
     * 通用YES代表是
     */
    public static final String YES_VALUE_YES = "YES";

    /**
     * 通用NO代表否
     */
    public static final String NO_VALUE_NO = "NO";

    public static final String ACCESS_TERMINAL = "accessTerminal";

    public static final String MSG_SPLICE = "-";

    public static final String MSG_AGENT = "agent";

    public static final String MSG_ROLE = "role";

    public static final String ROLE_AGENT_TO_USER = "agent-user";

    public static final String DEFAULT_BYAI_AGENT = "AGENT_TYPE";

    /**
     * 系统提示词
     */
    public static final String SYSTEM_PROMPT = "SYSTEM_PROMPT";

    /**
     * 过滤的数字员工阈值
     */
    public static final String CHAT_DIGITAL_EMPLOYEE_THRESHOLD = "CHAT_DIGITAL_EMPLOYEE_THRESHOLD";

    /**
     * 目录层级最大深度
     */
    public static final Integer CATALOG_PATH_MAX_DEPTH_LEVEL = 3;

    public static final String CURL = "CURL";

    /**
     * 数字员工类型
     */
    public static final String DIGITAL_EMPLOYEE = "DIGITAL_EMPLOYEE";

    /**
     * 反馈桶名称
     */
    public static final String BUCKET_NAME_FEEDBACK = "byai-feedback";

    /**
     * 图标桶名称
     */
    public static final String BUCKET_NAME_ICON = "byai-icon";

    public static final class ResourceBizType {

        public static final String DIG_EMPLOYEE = "DIG_EMPLOYEE";

        public static final String AGENT = "AGENT";

        public static final String DOC = "DOC";

        public static final String DB = "DB";

        public static final String PLUGIN = "PLUGIN";

        public static final String TOOL = "TOOL";

        public static final String MCP = "MCP";

        public static final String OBJECT = "OBJECT";

        public static final String ACTION = "ACTION";

        public static final String VIEW = "VIEW";

        public static final String MCP_TOOL = "MCP_TOOL";

        public static final String TOOLKIT = "TOOLKIT";

        public static final String KG_DOC = "KG_DOC";

        public static final String KG_QA = "KG_QA";

        public static final String KG_TERM = "KG_TERM";

        public static final String KG_DB = "KG_DB";

        public static final String DB_DATASET = "DB_DATASET";

        public static final String NOTIFICATION = "NOTIFICATION";
    }

    public static final class ResponseStatus {

        public static final Integer SUCCESS = 0;

        public static final Integer FALSE = -1;

    }

}
