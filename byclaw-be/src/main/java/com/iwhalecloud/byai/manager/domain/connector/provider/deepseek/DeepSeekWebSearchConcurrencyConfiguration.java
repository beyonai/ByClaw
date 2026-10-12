package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DeepSeekWebSearchConcurrencyConfiguration {
    static final int GLOBAL_CONCURRENCY = 8;
    static final int QUEUE_CAPACITY = 64;

    @Bean(name = "deepSeekWebSearchExecutor", destroyMethod = "shutdown")
    public ExecutorService deepSeekWebSearchExecutor() {
        AtomicInteger sequence = new AtomicInteger();
        ThreadFactory factory = task -> {
            Thread thread = new Thread(task, "deepseek-web-search-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
        return new ThreadPoolExecutor(
            GLOBAL_CONCURRENCY,
            GLOBAL_CONCURRENCY,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(QUEUE_CAPACITY),
            factory,
            new ThreadPoolExecutor.AbortPolicy());
    }
}
