package com.iwhalecloud.byai.state.domain.chat.spi;

/**
 * 会话「待接单」放行钩子。
 * 研发派发会先建会话、只插一条待接单提示而不下发任务提示词(沙箱收到用户消息就会立刻开工),
 * 承接人回确认词后才真正开工。聊天主链路只认这个接口,具体规则由 manager 侧研发闭环实现,
 * 保持 state → manager 无反向依赖。
 */
public interface PendingTaskConfirmHook {

    /**
     * @return 非空 = 该会话在等接单且本次输入命中确认词,返回值为应改发给数字员工的完整任务提示词;
     *         null = 与待接单无关,调用方原样放行。
     */
    String resolveConfirmedPrompt(Long sessionId, String userInput);
}
