package com.iwhalecloud.byai.state.domain.ws;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.ws.handler.WebSocketServerInitializer;
import com.iwhalecloud.byai.state.common.config.NettyProperties;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFuture;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

@Component
@Slf4j
public class NettyServerApplication implements ApplicationRunner {

    private Channel serverChannel;

    @Autowired
    NettyProperties nettyProperties;

    private final WebSocketServerInitializer initializer;
    private final ServerBootstrap serverBootstrap;

    public NettyServerApplication(
            WebSocketServerInitializer initializer,
            ServerBootstrap serverBootstrap) {
        this.initializer = initializer;
        this.serverBootstrap = serverBootstrap;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        try {
            serverBootstrap.childHandler(initializer);
            ChannelFuture future = serverBootstrap.bind(nettyProperties.getPort()).sync();
            serverChannel = future.channel();
            log.info("Netty WebSocket server started on port {}", nettyProperties.getPort());
        } catch (Exception e) {
            log.error("Failed to start Netty server", e);
            throw e;
        }
    }

    @PreDestroy
    public void stop() {
        if (serverChannel != null) {
            serverChannel.close();
            log.info("Netty WebSocket server stopped");
        }
    }
}