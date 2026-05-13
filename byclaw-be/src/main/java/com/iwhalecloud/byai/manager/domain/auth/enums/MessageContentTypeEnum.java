package com.iwhalecloud.byai.manager.domain.auth.enums;

import lombok.Getter;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/7
 */
@Getter
public enum MessageContentTypeEnum {

    /**
    * 文本消息
    */
    TEXT("1002", "text"),

    /**
    * 图表消息
    */
    ECHART("2001", "echart"),

    /**
    * 慧笔大纲
    */
    WRITER_OUTLINE("2004", "writer_outline"),

    /**
     * 慧笔文章
     */
    WRITER_ARTICLE("2005", "writer_article"),

    /**
     * 规划任务
     */
    TASK("2008", "task"),

    /**
    * 表单消息
    */
    FORM("2002", "form"),

    /**
     * 审批消息
     */
    APPROVE("2007", "approve"),

    /**
     * 数字员工卡片消息
     */
    DIGIT("2003", "digit"),

    /**
     * 数字员工执行卡片消息
     */
    DIGIT_EXEC("2015", "digit_exec"),

    /**
     * 思考过程标题消息
     */
    THINK_TITLE("3003", "think_title"),

    /**
     * 思考过程引用消息
     */
    THINK_RESOURCE("3004", "think_resource"),

    /**
     * 思考过程文本消息
     */
    THINK_TEXT("1002", "think_text"),

    /**
     * 任务完成
     */
    TASK_FINISHED("3009", "task_finished"),

    /**
     * 用户输入
     */
    TASK_USER_INPUT("3013", "task_user_input"),


    /**
     * 创建文件
     */
    TASK_CREATE_FILE("3010", "task_create_file"),

    /**
     * 任务标题
     */
    TASK_TITLE("3011", "task_title"),


    /**
     * bot动态解释卡片
     */
    BOT_CARD("2011", "bot_card"),
    /**
     * ui-agent卡片
     */
    UI_AGENT_CARD("2010", "ui_agent_card"),
    /**
     * 图表卡片
     */
    ECHART_CARD("2001", "echart_card"),

    /**
     * 待办通知卡片
     */
    NOTIFICATION_TODO_CARD("5001", "notification_todo_card"),

    /**
     * 待办通知卡片 任务指派
     */
    NOTIFICATION_TODO_TASK_ASSIGN_CARD("2019", "notification_todo_task_assign_card"),

    /**
     * 上下架通知卡片
     */
    NOTIFICATION_PUBLISH_CARD("5004", "notification_publish_card");

    private final String code;

    private final String msg;

    MessageContentTypeEnum(String code, String msg) {
        this.code = code;
        this.msg = msg;
    }


    public static MessageContentTypeEnum getByCode(String code) {
        for (MessageContentTypeEnum value : values()) {
            if (value.code.equals(code)) {
                return value;
            }
        }
        return null;
    }
}
