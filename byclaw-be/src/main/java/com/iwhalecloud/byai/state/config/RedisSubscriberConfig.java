package com.iwhalecloud.byai.state.config;

import org.springframework.context.annotation.Configuration;

/**
 * Redis Stream 订阅配置
 * <p>
 * 注意：此类不再在服务启动时创建全局监听容器。
 * 改为按需动态监听，由 {@link com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager}
 * 在每次对话请求的 gatewayClient.sendMessage() 成功之后，为对应 session 启动独立的监听容器。
 * 监听 Stream Key 格式为：byai_gateway:session:{sessionId}:data_stream
 */
@Configuration
public class RedisSubscriberConfig {
}
