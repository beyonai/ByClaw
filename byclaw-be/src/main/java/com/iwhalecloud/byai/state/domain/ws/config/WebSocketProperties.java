package com.iwhalecloud.byai.state.domain.ws.config;

import io.netty.handler.logging.LogLevel;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;


/**
 * WebSocket服务器配置属性类
 */
@Configuration
@ConfigurationProperties(prefix = "websocket")
public class WebSocketProperties {
    /**
     * WebSocket帧的最大大小（以字节为单位）
     * 用于限制单个WebSocket消息的大小，防止内存溢出
     * 默认值：65536字节（64KB）
     */
    private int maxFrameSize = 65536;

    /**
     * 读空闲超时时间（以秒为单位）
     * 在指定时间内如果没有收到客户端的数据，会触发IdleStateEvent事件
     * 默认值：60秒
     */
    private int idleTimeout = 60;

    /**
     * 写空闲超时时间（以秒为单位）
     * 在指定时间内如果没有向客户端发送数据，会触发IdleStateEvent事件
     * 默认值：0秒（禁用）
     */
    private long writerIdleTime = 0L;

    /**
     * 所有类型空闲超时时间（以秒为单位）
     * 在指定时间内如果没有读写操作，会触发IdleStateEvent事件
     * 默认值：0秒（禁用）
     */
    private long allIdleTime = 0L;

    /**
     * WebSocket服务端点路径
     * 客户端通过此路径建立WebSocket连接
     * 默认值：/conversationServer/chat
     */
    private String websocketPath = "/byaiService/ws";

    /**
     * WebSocket通道日志级别
     * 控制Netty通道的日志输出级别
     * 可选值：TRACE, DEBUG, INFO, WARN, ERROR
     * 默认值：INFO
     */
    private LogLevel logLevel = LogLevel.DEBUG;

    public int getMaxFrameSize() {
        return maxFrameSize;
    }

    public void setMaxFrameSize(int maxFrameSize) {
        this.maxFrameSize = maxFrameSize;
    }

    public int getIdleTimeout() {
        return idleTimeout;
    }

    public void setIdleTimeout(int idleTimeout) {
        this.idleTimeout = idleTimeout;
    }

    public long getWriterIdleTime() {
        return writerIdleTime;
    }

    public void setWriterIdleTime(long writerIdleTime) {
        this.writerIdleTime = writerIdleTime;
    }

    public long getAllIdleTime() {
        return allIdleTime;
    }

    public void setAllIdleTime(long allIdleTime) {
        this.allIdleTime = allIdleTime;
    }

    public String getWebsocketPath() {
        return websocketPath;
    }

    public void setWebsocketPath(String websocketPath) {
        this.websocketPath = websocketPath;
    }

    public LogLevel getLogLevel() {
        return logLevel;
    }

    public void setLogLevel(LogLevel logLevel) {
        this.logLevel = logLevel;
    }
}
