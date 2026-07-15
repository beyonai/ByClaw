package com.iwhalecloud.byai.manager.application.service.job;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;

/** 为存量用户幂等补齐 DB 配额记录，之后由使用量扫描任务写入真实使用量。 */
@Component
public class UserStorageQuotaBackfillJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserStorageQuotaBackfillJob.class);
    private static final String LOCK_KEY = "byclaw:storage-quota:backfill-lock";

    @Autowired
    private UserStorageQuotaApplicationService quotaService;

    @Scheduled(fixedDelayString = "${byclaw.storage.quota.backfill.fixed-delay:3600000}",
        initialDelayString = "${byclaw.storage.quota.backfill.initial-delay:90000}")
    public void backfill() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = RedisUtil.lock(LOCK_KEY, lockValue, 900);
            if (!locked) {
                return;
            }
            int count = quotaService.backfillHistoricalQuotas(200);
            LOGGER.info("历史用户存储配额补齐完成, users={}", count);
        }
        catch (Exception e) {
            LOGGER.error("历史用户存储配额补齐异常", e);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(LOCK_KEY, lockValue);
            }
        }
    }
}
