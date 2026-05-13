package com.iwhalecloud.byai.state.common.config;

import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.epoll.EpollEventLoopGroup;
import io.netty.channel.epoll.EpollServerSocketChannel;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.util.concurrent.DefaultEventExecutorGroup;
import io.netty.util.concurrent.EventExecutorGroup;
import lombok.extern.slf4j.Slf4j;

/**
 * Netty Server Configuration.
 * <p>
 * This configuration class sets up the Netty server with the following components:
 * - Boss EventLoopGroup: Handles incoming connections
 * - Worker EventLoopGroup: Handles the traffic of accepted connections
 * - ServerBootstrap: Sets up the server with necessary channel options
 * - WebEventExecutorGroup: Handles business logic processing
 * <p>
 * The configuration supports both NIO and Epoll modes:
 * - NIO: Default mode, works on all platforms
 * - Epoll: Linux-specific optimization, provides better performance
 */
@Configuration
@Slf4j
public class NettyConfig {
    /**
     * Flag to determine whether to use Epoll (Linux) or NIO (Default) mode.
     * Set to true in production on Linux systems for better performance.
     */
    @Value("${netty.epoll:false}")
    boolean epoll;

    /**
     * Creates the boss EventLoopGroup.
     * <p>
     * The boss group accepts incoming connections. Once the connection is accepted,
     * it is handed over to the worker group for processing.
     * <p>
     * Note: The group needs explicit shutdown when the application stops.
     *
     * @param nettyProperties Configuration properties for Netty server
     * @return EventLoopGroup configured either as EpollEventLoopGroup (Linux) or NioEventLoopGroup
     */
    @Bean("bossGroup")
    public EventLoopGroup bossGroup(NettyProperties nettyProperties) {
        if (epoll){
            log.info("current use EpollEventLoopGroup");
            return new EpollEventLoopGroup(nettyProperties.getBossThreads());
        }
        log.info("current use NioEventLoopGroup");
        return new NioEventLoopGroup(nettyProperties.getBossThreads());
    }

    /**
     * Creates the worker EventLoopGroup.
     * <p>
     * The worker group handles all the traffic of accepted connections:
     * - Reads data from accepted connections
     * - Writes data to accepted connections
     * - Handles all I/O operations
     * <p>
     * Important notes:
     * 1. Requires explicit shutdown when application stops
     * 2. Use NioEventLoopGroup for development
     * 3. Use EpollEventLoopGroup for production on Linux systems
     *
     * @param nettyProperties Configuration properties for Netty server
     * @return EventLoopGroup configured either as EpollEventLoopGroup (Linux) or NioEventLoopGroup
     */
    @Bean("workerGroup")
    public EventLoopGroup workerGroup(NettyProperties nettyProperties) {
        if (epoll){
            log.info("current use EpollEventLoopGroup");
            return new EpollEventLoopGroup(nettyProperties.getWorkerThreads());
        }
        log.info("current use NioEventLoopGroup");
        return new NioEventLoopGroup(nettyProperties.getWorkerThreads());
    }

    /**
     * Creates and configures the ServerBootstrap.
     * <p>
     * The ServerBootstrap is configured with:
     * - Boss and worker event loop groups
     * - Channel type (Epoll or NIO)
     * - Connection timeout (3000ms)
     * - Keep-alive enabled
     * - TCP no delay enabled
     *
     * @param bossGroup The boss EventLoopGroup that accepts incoming connections
     * @param workerGroup The worker EventLoopGroup that handles the traffic
     * @return Configured ServerBootstrap instance
     */
    @Bean
    public ServerBootstrap serverBootstrap(@Qualifier("bossGroup") EventLoopGroup bossGroup,
                                           @Qualifier("workerGroup")EventLoopGroup workerGroup) {
        ServerBootstrap bootstrap = new ServerBootstrap();
        if (epoll){
            bootstrap.group(bossGroup, workerGroup)
                    .channel(EpollServerSocketChannel.class)
                    .childOption(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000)
                    .childOption(ChannelOption.SO_KEEPALIVE, true)
                    .childOption(ChannelOption.TCP_NODELAY, true);
            return bootstrap;
        }
        else {
            bootstrap.group(bossGroup, workerGroup)
                    .channel(NioServerSocketChannel.class)
                    .childOption(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000)
                    .childOption(ChannelOption.SO_KEEPALIVE, true)
                    .childOption(ChannelOption.TCP_NODELAY, true);
            return bootstrap;
        }
    }

    /**
     * Creates an EventExecutorGroup for handling WebSocket business logic.
     * <p>
     * This executor group is separate from the main event loop groups and is used
     * to process business logic without blocking the I/O threads.
     *
     * @param threadCount Number of threads in the executor group (default: 8)
     * @return Configured EventExecutorGroup instance
     */
    @Bean("webEventExecutorGroup")
    public EventExecutorGroup webEventExecutorGroup(
            @Value("${netty.web.thread.count:8}") int threadCount) {
        return new DefaultEventExecutorGroup(threadCount, new NamedThreadFactory("webEventExecutorGroup"));
    }

    @Bean("broadcastEventExecutorGroup")
    public EventExecutorGroup broadcastEventExecutorGroup(
            @Value("${netty.broadcast.thread.count:8}") int threadCount) {
        return new DefaultEventExecutorGroup(threadCount, new NamedThreadFactory("broadcastEventExecutorGroup"));
    }

    /**
     * Custom thread factory for creating named threads.
     * <p>
     * Creates threads with custom names in the format: prefix-sequence_number
     * This helps in identifying threads in logs and thread dumps.
     */
    public static class NamedThreadFactory implements ThreadFactory {
        private final String prefix;
        private final AtomicInteger threadNumber = new AtomicInteger(1);

        /**
         * Creates a new NamedThreadFactory with the specified prefix.
         *
         * @param prefix The prefix to use for thread names
         */
        public NamedThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable r) {
            return new Thread(r, prefix + "-" + threadNumber.getAndIncrement());
        }
    }
}