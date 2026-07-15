package com.iwhalecloud.byai.manager.application.service.job;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageDowngradeApplicationService;

@Component
@ConditionalOnProperty(prefix = "byclaw.storage.quota.downgrade", name = "enabled",
    havingValue = "true", matchIfMissing = true)
public class UserStorageDowngradeJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserStorageDowngradeJob.class);
    private static final String LOCK_KEY = "byclaw:storage-quota:downgrade-lock";

    @Autowired
    private UserStorageDowngradeApplicationService downgradeService;

    @Scheduled(fixedDelayString = "${byclaw.storage.quota.downgrade.fixed-delay:300000}",
        initialDelayString = "${byclaw.storage.quota.downgrade.initial-delay:90000}")
    public void process() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = RedisUtil.lock(LOCK_KEY, lockValue, 240);
            if (!locked) {
                return;
            }
            int count = downgradeService.processOpenDowngrades(100);
            LOGGER.info("用户存储增值包取消降级任务完成, processed={}", count);
        }
        catch (Exception e) {
            LOGGER.error("用户存储增值包取消降级任务异常", e);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(LOCK_KEY, lockValue);
            }
        }
    }
}
