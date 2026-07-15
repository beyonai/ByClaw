package com.iwhalecloud.byai.manager.application.service.job;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageUsageScanner;

@Component
@ConditionalOnProperty(prefix = "byclaw.storage.quota.scan", name = "enabled", havingValue = "true", matchIfMissing = true)
public class UserStorageUsageJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserStorageUsageJob.class);
    private static final String LOCK_KEY = "byclaw:storage-quota:scan-lock";

    @Autowired
    private UserStorageUsageScanner scanner;

    @Scheduled(fixedDelayString = "${byclaw.storage.quota.scan.fixed-delay:300000}",
        initialDelayString = "${byclaw.storage.quota.scan.initial-delay:60000}")
    public void scan() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = RedisUtil.lock(LOCK_KEY, lockValue, 240);
            if (!locked) {
                return;
            }
            int count = scanner.scanAll(200);
            LOGGER.info("用户存储空间扫描完成, scanned={}", count);
        }
        catch (Exception e) {
            LOGGER.error("用户存储空间扫描异常", e);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(LOCK_KEY, lockValue);
            }
        }
    }
}
