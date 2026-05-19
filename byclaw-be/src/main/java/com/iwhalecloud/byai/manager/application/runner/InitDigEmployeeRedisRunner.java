package com.iwhalecloud.byai.manager.application.runner;

import com.iwhalecloud.byai.manager.application.service.digitemploy.DigEmployeeRedisSyncProperties;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.commons.collections4.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 数字员工及其关联资源 Redis 配置快照全量初始化。
 * 实现 ApplicationRunner，在服务启动时提交异步任务，不阻塞 Spring Boot 启动。
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InitDigEmployeeRedisRunner implements ApplicationRunner {

    private static final Logger logger = LoggerFactory.getLogger(InitDigEmployeeRedisRunner.class);

    private final AtomicBoolean initialized = new AtomicBoolean(false);

    @Value("${INIT_DIG_EMPLOYEE_REDIS_ENABLED:true}")
    private boolean initDigEmployeeRedisEnabled;

    @Value("${load.to.redis.batchSize:1000}")
    private int batchSize;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private DigEmployeeRedisSyncProperties digEmployeeRedisSyncProperties;

    @Override
    public void run(ApplicationArguments args) {
        if (!initDigEmployeeRedisEnabled) {
            logger.info("数字员工Redis全量初始化开关 INIT_DIG_EMPLOYEE_REDIS_ENABLED={}，跳过初始化",
                initDigEmployeeRedisEnabled);
            return;
        }
        if (digEmployeeRedisSyncProperties == null || !digEmployeeRedisSyncProperties.isJsonRedisSyncEnabled()) {
            logger.info("byai.dig-employee.json-redis-sync-enabled=false，跳过数字员工Redis全量初始化");
            return;
        }
        if (!initialized.compareAndSet(false, true)) {
            logger.info("数字员工Redis全量初始化已执行过，跳过重复执行");
            return;
        }

        CompletableFuture.runAsync(this::doFullInit);
        logger.info("数字员工及其关联资源Redis全量初始化已提交异步执行");
    }

    private void doFullInit() {
        long startTime = System.currentTimeMillis();
        logger.info("开始异步全量初始化数字员工及其关联资源配置到Redis...");

        int totalEmployees = 0;
        int pageIndex = 1;

        try {
            while (true) {
                List<SsResource> resources = ssResourceService.pageActiveDigitalEmployees(pageIndex, batchSize);
                if (CollectionUtils.isEmpty(resources)) {
                    break;
                }

                for (SsResource resource : resources) {
                    if (resource == null || resource.getResourceId() == null) {
                        continue;
                    }
                    try {
                        digitalEmployeeApplicationService
                            .syncExistingDigEmployeeConfigToRedisQuietly(resource.getResourceId());
                        totalEmployees++;
                    }
                    catch (Exception e) {
                        logger.error("全量同步数字员工Redis失败, resourceId={}, reason={}", resource.getResourceId(),
                            e.getMessage(), e);
                    }
                }

                logger.info("数字员工Redis全量初始化进度：已处理{}个数字员工", totalEmployees);

                if (resources.size() < batchSize) {
                    break;
                }
                pageIndex++;
            }

            long costTime = (System.currentTimeMillis() - startTime) / 1000;
            logger.info("数字员工及其关联资源Redis全量初始化完成，共处理{}个数字员工，耗时{}秒", totalEmployees, costTime);
        }
        catch (Exception e) {
            logger.error("数字员工及其关联资源Redis全量初始化失败：{}", e.getMessage(), e);
        }
    }
}
