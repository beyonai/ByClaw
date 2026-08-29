package com.iwhalecloud.byai.manager.application.service.job;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;

import java.util.UUID;

/** Periodically handles failed integration executions that require rework or escalation. */
@Component
public class DevloopKickbackSweepJob {

    private static final String LOCK_KEY = "devloop:integration:kickback-sweep:lock";

    private final DevloopApplicationService devloopApplicationService;

    public DevloopKickbackSweepJob(DevloopApplicationService devloopApplicationService) {
        this.devloopApplicationService = devloopApplicationService;
    }

    @Scheduled(cron = "${devloop.integration.kickback-sweep.cron:0 * * * * ?}")
    public void execute() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = Boolean.TRUE.equals(RedisUtil.lock(LOCK_KEY, lockValue, 120));
        if (!locked) return;
        try {
            devloopApplicationService.runKickbackSweep();
        }
        finally {
            RedisUtil.releaseLock(LOCK_KEY, lockValue);
        }
    }
}
