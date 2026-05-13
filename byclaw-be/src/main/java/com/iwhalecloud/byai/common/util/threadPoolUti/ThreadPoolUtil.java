package com.iwhalecloud.byai.common.util.threadPoolUti;

import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.alibaba.ttl.threadpool.TtlExecutors;

/**
 * 线程池工具类
 **/
public final class ThreadPoolUtil {

    /**
     * 创建带名称的线程池
     * @param corePoolSize     核心线程数
     * @param maxPoolSize      最大线程数
     * @param queueCapacity    任务队列容量
     * @param keepAliveSeconds 线程空闲存活时间（秒）
     * @param threadPoolName   线程池名称（用于线程命名）
     * @return 包装后的线程池（支持TTL）
     */
    public static Executor getThreadPool(
            int corePoolSize,
            int maxPoolSize,
            int queueCapacity,
            int keepAliveSeconds,
            String threadPoolName) {

        // 自定义ThreadFactory，设置线程名称
        ThreadFactory threadFactory = new ThreadFactory() {
            private final AtomicInteger threadCount = new AtomicInteger(1);

            @Override
            public Thread newThread(Runnable r) {
                Thread thread = new Thread(r);
                thread.setName(String.format("%s-thread-%d", threadPoolName, threadCount.getAndIncrement()));
                return thread;
            }
        };

        // 创建ThreadPoolExecutor
        ThreadPoolExecutor threadPool = new ThreadPoolExecutor(
                corePoolSize,
                maxPoolSize,
                keepAliveSeconds,
                TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(queueCapacity),
                threadFactory,  // 使用自定义ThreadFactory
                new ThreadPoolExecutor.CallerRunsPolicy()
        );

        // 包装TTL（如果需要传递线程上下文）
        return TtlExecutors.getTtlExecutor(threadPool);
    }
}
