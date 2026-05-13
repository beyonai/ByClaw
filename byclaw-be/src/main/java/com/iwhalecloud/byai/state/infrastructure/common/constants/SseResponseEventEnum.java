package com.iwhalecloud.byai.state.infrastructure.common.constants;

public class SseResponseEventEnum {

    public static final String error = "error";

    public static final String answer = "answer";

    public static final String moduleStatus = "moduleStatus";

    public static final String reasoningLogStart = "reasoningLogStart";

    public static final String reasoningLogDelta = "reasoningLogDelta";

    public static final String reasoningLogEnd = "reasoningLogEnd";

    public static final String answerStart = "answerStart";

    public static final String answerDelta = "answerDelta";

    public static final String answerEnd = "answerEnd";

    public static final String appStreamResponse = "appStreamResponse"; // sse response request

    public static final String taskCreate = "taskCreate"; // 智办规划生成子任务

    public static final String stepComplete = "stepComplete"; // 智办规划每个步骤完成

    public static final String resComComplete = "resComComplete"; // 卡片返回事件(暂时只给前端使用
    public static final String tokenCount = "tokenCount"; // token返回事件

    /**
     * 创建会话时间
     */
    public static final String createSession = "createSession";

    /**
     * 清空数据
     */
    public static final String initMessage = "initMessage";

    /**
     * 任务停止（用户记录任务状态和没一步的历史）
     */
    public static final String stopTask = "taskStop";

    /**
     * 初始化事件
     */
    public static final String initialization = "initialization";
}
