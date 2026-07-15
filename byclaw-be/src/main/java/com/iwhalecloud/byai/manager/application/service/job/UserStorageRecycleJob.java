package com.iwhalecloud.byai.manager.application.service.job;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageRecycleApplicationService;

@Component
public class UserStorageRecycleJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserStorageRecycleJob.class);
    private static final String LOCK_KEY = "byclaw:storage-quota:recycle-lock";

    @Autowired
    private UserStorageRecycleApplicationService recycleService;

    @Scheduled(fixedDelayString = "${byclaw.storage.quota.recycle.fixed-delay:3600000}",
        initialDelayString = "${byclaw.storage.quota.recycle.initial-delay:120000}")
    public void purgeExpired() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = RedisUtil.lock(LOCK_KEY, lockValue, 900);
            if (!locked) {
                return;
            }
            int count = recycleService.purgeExpired();
            LOGGER.info("用户存储回收站清理完成, purged={}", count);
        }
        catch (Exception e) {
            LOGGER.error("用户存储回收站清理异常", e);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(LOCK_KEY, lockValue);
            }
        }
    }
}
