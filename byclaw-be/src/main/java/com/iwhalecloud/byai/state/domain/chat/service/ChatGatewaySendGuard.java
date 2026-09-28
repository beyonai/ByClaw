package com.iwhalecloud.byai.state.domain.chat.service;

/** 协调运行态注册和出站发送；作用域必须在等待流式响应前释放。 */
public interface ChatGatewaySendGuard {
    Lease open(ChatProcessContext context) throws Exception;
    void beforeSend(ChatProcessContext context);

    interface Lease extends AutoCloseable {
        @Override
        void close() throws Exception;
    }
}
