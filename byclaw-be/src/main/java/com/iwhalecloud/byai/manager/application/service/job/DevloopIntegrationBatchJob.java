package com.iwhalecloud.byai.manager.application.service.job;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 需求级就绪批量集成定时任务。
 * 每分钟醒一次做「检查」,持 Redis 分布式锁保证集群单节点执行;真正是否触发由各项目测试配置 cron 决定。
 * 具体挑就绪需求、并发额度、起 run 的策略都在 DevloopApplicationService,job 只负责节流与单节点保证。
 */
@Component
@ConditionalOnProperty(
    prefix = "devloop.integration.batch",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true)
public class DevloopIntegrationBatchJob {

    private static final Logger logger =
        LoggerFactory.getLogger(DevloopIntegrationBatchJob.class);

    @Value("${devloop.integration.batch.lockTimeout:120}")
    private int lockTimeout;

    @Autowired
    private DevloopApplicationService devloopApplicationService;

    /**
     * 定时批量集成入口:获取分布式锁后交由应用服务遍历启用项目按各自 cron 触发。
     * job 每分钟醒一次,是批量触发频率的精度上限(最低每分钟)。
     */
    @Scheduled(cron = "${devloop.integration.batch.cron:0 * * * * ?}")
    public void executeBatch() {
        String lockKey = "devloop:integration:batch:lock";
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = RedisUtil.lock(lockKey, lockValue, lockTimeout);
            if (!locked) {
                logger.debug("[IntegrationBatch] Another node is running, skip");
                return;
            }
            devloopApplicationService.runScheduledIntegrationBatches();
            // 同一持锁周期内顺带处理失败打回:失败执行归因后驱动会话重工或建缺陷,幂等去重。
            devloopApplicationService.runKickbackSweep();
        } catch (Exception e) {
            logger.error("[IntegrationBatch] 批量集成调度异常", e);
        } finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockValue);
            }
        }
    }
}
