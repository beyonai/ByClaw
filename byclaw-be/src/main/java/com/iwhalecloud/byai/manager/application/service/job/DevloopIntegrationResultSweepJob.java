package com.iwhalecloud.byai.manager.application.service.job;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;

import java.util.UUID;

/** Periodically closes running integration executions after their tester session reports a result. */
@Component
public class DevloopIntegrationResultSweepJob {

    private static final String LOCK_KEY = "devloop:integration:result-sweep:lock";

    private final DevloopApplicationService devloopApplicationService;

    public DevloopIntegrationResultSweepJob(DevloopApplicationService devloopApplicationService) {
        this.devloopApplicationService = devloopApplicationService;
    }

    @Scheduled(cron = "${devloop.integration.result-sweep.cron:0 * * * * ?}")
    public void execute() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = Boolean.TRUE.equals(RedisUtil.lock(LOCK_KEY, lockValue, 120));
        if (!locked) return;
        try {
            devloopApplicationService.runIntegrationResultSweep();
        }
        finally {
            RedisUtil.releaseLock(LOCK_KEY, lockValue);
        }
    }
}
