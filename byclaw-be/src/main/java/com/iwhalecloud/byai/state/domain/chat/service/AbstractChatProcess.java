package com.iwhalecloud.byai.state.domain.chat.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.OutputStream;

import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;

/**
 * 聊天主流程抽象骨架（模板方法模式）。 定义了参数准备、Python SSE处理、消息存储、异常处理等主流程步骤。 子类可重写各步骤实现扩展。
 */
public abstract class AbstractChatProcess {

    private static final Logger logger = LoggerFactory.getLogger(AbstractChatProcess.class);


    /**
     * 聊天主流程入口，按顺序执行各步骤（带首词响应开始时间）。
     * <p>
     * 执行顺序：prepareParams → handleGatewayMode → storeMessage → afterProcess
     * handleGatewayMode 默认调用 handlePythonSse（原同步 Python SSE 链路）；
     * ScriptService 重写为 Gateway 模式时，方法内部会阻塞等待 Redis 监听器完成，
     * 因此 storeMessage / afterProcess 始终在此处调用，无需延迟处理。
     *
     * @param res SSE输出流
     * @param assistantChatDto 聊天请求参数
     * @param firstTextStartTime 首词响应开始时间（毫秒），如果不传则使用当前时间
     */
    public void execute(OutputStream res, AssistantChatDto assistantChatDto, long firstTextStartTime) {
        ChatProcessContext context = new ChatProcessContext(res, assistantChatDto);
        // 初始化首词响应开始时间
        context.setFirstTextStartTime(firstTextStartTime);
        context.setStartTime(firstTextStartTime);
        try {
            long time01 = System.currentTimeMillis();
            prepareParams(context);
            long time02 = System.currentTimeMillis();

            // 使用gateway sdk模式
            handleGatewayMode(context);

            long time03 = System.currentTimeMillis();
            storeMessage(context);
            long time04 = System.currentTimeMillis();
            logger.info("chat {} used time02: {},{},{}", assistantChatDto.getSessionId(), time02 - time01,
                    time03 - time02, time04 - time03);
            afterProcess(context);
        }
        catch (Exception e) {
            context.setException(e);
            handleException(context);
        }
    }

    /**
     * 参数准备：生成消息ID、组装请求参数、初始化上下文等。
     *
     * @param context 聊天流程上下文
     */
    protected abstract void prepareParams(ChatProcessContext context);

    /**
     * 处理Python SSE流：请求Python服务，处理流式响应，增量写入客户端。
     * 原有逻辑保持不变，仅在非 Gateway 模式下被 handleGatewayMode 降级调用。
     *
     * @param context 聊天流程上下文
     * @throws Exception 处理异常
     */
    protected abstract void handlePythonSse(ChatProcessContext context) throws Exception;

    /**
     * 响应流入口（可选扩展点）。
     * 推送完所有 SSE 事件（countDown），方法返回后 execute() 继续调用 storeMessage/afterProcess。
     *
     * @param context 聊天流程上下文
     * @throws Exception 处理异常
     */
    protected abstract void handleGatewayMode(ChatProcessContext context) throws Exception;

    /**
     * 消息存储：将最终消息、索引、推荐问题等存储到数据库或缓存。
     *
     * @param context 聊天流程上下文
     */
    protected abstract void storeMessage(ChatProcessContext context);

    /**
     * 可选扩展点：主流程结束后的钩子方法，默认空实现。
     *
     * @param context 聊天流程上下文
     */
    protected void afterProcess(ChatProcessContext context) {
        // 默认空实现
    }

    /**
     * 异常处理：统一处理主流程中的异常，记录索引、抛出业务异常等。
     *
     * @param context 聊天流程上下文
     */
    protected abstract void handleException(ChatProcessContext context);
}
