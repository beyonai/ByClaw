package com.iwhalecloud.byai.state.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Netty 相关配置属性，自动装配 netty.workerThreads、netty.bossThreads、netty.port 等参数。
 */
@Configuration
@ConfigurationProperties(prefix = "netty")
public class NettyProperties {
    /**
     * Netty worker 线程数
     */
    private int workerThreads = Runtime.getRuntime().availableProcessors() * 2;

    /**
     * Netty boss 线程数
     */
    private int bossThreads = 1;

    /**
     * Netty 监听端口
     */
    private int port = 8082;

    public int getWorkerThreads() {
        return workerThreads;
    }

    public void setWorkerThreads(int workerThreads) {
        this.workerThreads = workerThreads;
    }

    public int getBossThreads() {
        return bossThreads;
    }

    public void setBossThreads(int bossThreads) {
        this.bossThreads = bossThreads;
    }

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }
}
