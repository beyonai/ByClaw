package com.iwhalecloud.byai.common.feign.request.conversation;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

/**
 * 待办请求数据DTO
 */
@Data
public class TodoRequestDTO {

    /**
     * 资源ID
     */
    @NotNull(message = "资源ID不能为空")
    private Long resourceId;

    /**
     * 申请/审批理由
     */
    private String reason;

    /**
     * 审批类型：apply/publish
     */
    @NotBlank(message = "审批类型不能为空")
    private String approveType;

    /**
     * 待办请求响应数据
     */
    @Data
    public static class TodoResponseData {

        /**
         * 操作类型
         */
        private String operType = "add";

        /**
         * 任务类型
         */
        private String taskType = "APPROVE";

        /**
         * 系统编码
         */
        private String systemCode = "BYAI";

        /**
         * 任务扩展ID
         */
        private String taskExtId = "";

        /**
         * 标题
         */
        private String title;

        /**
         * 页面ID
         */
        private String pageId;

        /**
         * 内容
         */
        private String content;

        /**
         * 内容类型
         */
        private String contentType = "2011";

        /**
         * 接收用户编码列表
         */
        private List<String> recUserCode;

        /**
         * 发送用户编码
         */
        private String sendUserCode;

        /**
         * 内容显示卡片
         */
        private String contentShowCard;

        /**
         * 资源发布代办资源类型
         */
        private String resourceBizType;

        /**
         * 资源发布代办资源id
         */
        private Long resourceId;
    }

    /**
     * 内容显示卡片
     */
    @Data
    public static class ContentShowCard {

        /**
         * 页面标题
         */
        private String pageTitle;

        /**
         * 流程信息
         */
        private Flow flow;

        /**
         * 通过参数
         */
        private AuthParam authPassParam;

        /**
         * 不通过参数
         */
        private AuthParam authNotPassParam;

        /**
         * 指派任务 卡片类型 用于小铃铛中区分回显
         */
        private String cardType = "APPROVE";
    }

    /**
     * 新版内容显示卡片 - 支持复杂卡片结构 2019
     */
    @Data
    public static class ContentShowCardComplex {

        /**
         * 卡片标题
         */
        private String title;

        /**
         * 卡片内容
         */
        private CardContent content;

        /**
         * 按钮列表
         */
        private List<Button> buttons;

        /**
         * 指派任务 卡片类型 用于小铃铛中区分回显
         */
        private String cardType;

        /**
         * 指派任务 资源ID
         */
        private Long resourceId;
    }

    /**
     * 卡片内容
     */
    @Data
    public static class CardContent {

        /**
         * 内容块列表
         */
        private List<Block> blocks;
    }

    /**
     * 内容块
     */
    @Data
    public static class Block {

        /**
         * 块类型：text/agentInfo等
         */
        private String type;

        /**
         * 文本内容（type=text时使用）
         */
        private String text;

        /**
         * 智能体ID（type=agentInfo时使用）
         */
        private String agentId;

        private Integer rows;
    }

    /**
     * 按钮
     */
    @Data
    public static class Button {

        /**
         * 按钮key
         */
        private String key;

        /**
         * 按钮文本
         */
        private String text;

        /**
         * 禁用时显示的文本
         */
        private String disabledText;

        /**
         * 按钮动作
         */
        private ButtonAction action;
    }

    /**
     * 按钮动作
     */
    @Data
    public static class ButtonAction {

        /**
         * 动作类型：chat/url/link/custom等
         */
        private String type;

        /**
         * 智能体ID（type=chat时使用）
         */
        private String agentId;

        /**
         * 消息内容（type=chat时使用）
         */
        private String message;

        /**
         * 扩展参数（type=chat时使用）
         */
        private Map<String, Object> extParams;

        /**
         * 跳转URL（type=url/link/custom时使用）
         */
        private String url;

        /**
         * 目标窗口（type=url时使用）
         */
        private String target;

        /**
         * 资源ID（type=link/custom时使用）
         */
        private Long resourceId;

        /**
         * 窗口宽度（type=link/custom时使用）
         */
        private Integer width;

        /**
         * 资源业务类型（type=link/custom时使用）
         */
        private String resourceBizType;

        /**
         * 动作标题（type=link/custom时使用）
         */
        private String title;
    }

    /**
     * 流程信息
     */
    @Data
    public static class Flow {

        /**
         * 流程定义名称
         */
        @JsonProperty("PROC_DEF_NAME")
        private String PROC_DEF_NAME;

        /**
         * 创建员工编码名称
         */
        @JsonProperty("CREATE_STAFF_CODE_NAME")
        private String CREATE_STAFF_CODE_NAME;

        /**
         * 任务开始时间
         */
        @JsonProperty("TASK_START_TIME")
        private String TASK_START_TIME;

        /**
         * 流程实例ID
         */
        @JsonProperty("PROC_INST_ID")
        private String PROC_INST_ID = "-1";

        /**
         * 流程名称
         */
        @JsonProperty("FLOW_NAME")
        private String FLOW_NAME = "";

        /**
         * 审核用户
         */
        @JsonProperty("CHECK_USER")
        private String CHECK_USER = "";

        /**
         * 数字员工名称（用于任务指派卡片）
         */
        @JsonProperty("DIG_EMPLOYEE_NAME")
        private String DIG_EMPLOYEE_NAME;

        /**
         * 数字员工的资源ID（用于任务指派卡片）
         */
        @JsonProperty("DIG_EMPLOYEE_ID")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long DIG_EMPLOYEE_ID;

        /**
         * 数字员工头像（用于任务指派卡片）
         */
        @JsonProperty("DIG_EMPLOYEE_AVATAR")
        private String DIG_EMPLOYEE_AVATAR;

        /**
         * 数字员工描述（用于任务指派卡片）
         */
        @JsonProperty("DIG_EMPLOYEE_DESC")
        private String DIG_EMPLOYEE_DESC;

        /**
         * 指派理由意见（用于任务指派卡片）
         */
        @JsonProperty("ASSIGN_REASON_OPINION")
        private String ASSIGN_REASON_OPINION;

    }

    /**
     * 授权参数
     */
    @Data
    public static class AuthParam {

        /**
         * 通知地址
         */
        private String url = "/open/api/approve";

        /**
         * 应用密钥
         */
        private String appkey = "appkey";

        /**
         * 请求方法
         */
        private String methed = "POST";

        /**
         * 请求头
         */
        private Map<String, Object> headers = Map.of("Content-Type", "application/json");

        /**
         * 请求体参数
         */
        private Map<String, Object> bodyParams;
    }
}
