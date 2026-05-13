package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.ws.config.WebSocketProperties;

import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelPipeline;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.handler.logging.LoggingHandler;
import io.netty.handler.timeout.IdleStateHandler;
import io.netty.util.concurrent.EventExecutorGroup;

@Component
public class WebSocketServerInitializer extends ChannelInitializer<SocketChannel> {
    @Autowired
    @Qualifier("webEventExecutorGroup")
    private EventExecutorGroup webEventExecutorGroup;

    private final HttpRequestHandler httpRequestHandler;
    private final WebSocketHandler webSocketHandler;
    private final WebSocketProperties webSocketProperties;


    public WebSocketServerInitializer(HttpRequestHandler httpRequestHandler,
                                      WebSocketHandler webSocketHandler,
                                      WebSocketProperties webSocketProperties) {
        this.httpRequestHandler = httpRequestHandler;
        this.webSocketHandler = webSocketHandler;
        this.webSocketProperties = webSocketProperties;
    }

    @Override
    protected void initChannel(SocketChannel ch) {
        ChannelPipeline pipeline = ch.pipeline();
        pipeline.addLast("logger", new LoggingHandler(webSocketProperties.getLogLevel()));
        // 1. HTTP 编解码器：将字节流解析为 HTTP 请求/响应对象
        pipeline.addLast(new HttpServerCodec());
        // 2. HTTP 消息聚合器：将 HTTP 的多个片段聚合成一条完整的消息（如 FullHttpRequest）
        pipeline.addLast(new HttpObjectAggregator(webSocketProperties.getMaxFrameSize()));
        // 3. 处理 HTTP 请求（如握手前的认证、静态资源等）
        pipeline.addLast(httpRequestHandler);
        // 4. 空闲检测：检测读/写/全通道空闲，便于心跳和断线重连
        pipeline.addLast(new IdleStateHandler(
                webSocketProperties.getIdleTimeout(),
                webSocketProperties.getWriterIdleTime(),
                webSocketProperties.getAllIdleTime(),
                TimeUnit.SECONDS));
        // 5. WebSocket 协议处理器：升级 HTTP 为 WebSocket，处理握手、Ping/Pong、关闭帧等
        pipeline.addLast(new WebSocketServerProtocolHandler(webSocketProperties.getWebsocketPath(), true));
        // 6. 业务 WebSocket 消息处理器：处理实际的 WebSocket 文本帧、业务逻辑
        pipeline.addLast(webEventExecutorGroup, webSocketHandler);
    }
} 