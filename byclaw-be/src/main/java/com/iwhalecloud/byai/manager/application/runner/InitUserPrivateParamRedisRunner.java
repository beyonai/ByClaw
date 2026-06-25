package com.iwhalecloud.byai.manager.application.runner;

import java.util.concurrent.atomic.AtomicBoolean;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 服务启动后异步全量同步用户个人参数配置到 Redis。
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InitUserPrivateParamRedisRunner implements ApplicationRunner {

    private static final Logger logger = LoggerFactory.getLogger(InitUserPrivateParamRedisRunner.class);

    private final AtomicBoolean initialized = new AtomicBoolean(false);

    @Value("${init.user.private.param.redis.runner.enabled:true}")
    private boolean enabled;

    @Autowired
    private UserPrivateParamApplicationService userPrivateParamApplicationService;

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            logger.info("开关init.user.private.param.redis.runner.enabled={}，不加载用户个人参数配置到Redis", enabled);
            return;
        }
        if (!initialized.compareAndSet(false, true)) {
            logger.info("用户个人参数配置Redis全量同步已执行过，跳过重复执行");
            return;
        }
        userPrivateParamApplicationService.syncAllPrivateParamCache();
        logger.info("用户个人参数配置Redis全量同步已提交异步执行");
    }
}
