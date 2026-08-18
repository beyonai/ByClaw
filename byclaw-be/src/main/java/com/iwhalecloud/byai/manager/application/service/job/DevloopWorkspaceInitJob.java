package com.iwhalecloud.byai.manager.application.service.job;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.WorkspaceInitService;

/**
 * 工作区初始化状态轮询任务。
 * 架构数字员工在沙箱里做初始化，只往会话状态文件写进展，不回调平台；项目状态要靠平台自己来读，所以需要这个 job。
 * 持 Redis 分布式锁保证集群单节点执行；挑项目与判超时的策略都在 WorkspaceInitService，job 只负责节流与单节点保证。
 */
@Component
@ConditionalOnProperty(
    prefix = "devloop.workspace.init",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true)
public class DevloopWorkspaceInitJob {

    private static final Logger logger = LoggerFactory.getLogger(DevloopWorkspaceInitJob.class);

    @Value("${devloop.workspace.init.lockTimeout:120}")
    private int lockTimeout;

    @Autowired
    private WorkspaceInitService workspaceInitService;

    /**
     * 轮询入口。半分钟一轮：初始化期间项目禁用建需求/启动任务，用户就等在这个 banner 前面，跟集成回收那种后台批处理不同，
     * 收口慢一分钟是能被直接感知的；只查「正在初始化的研发项目」，通常个位数，每项目一次定点文件读，代价很小。
     */
    @Scheduled(cron = "${devloop.workspace.init.cron:0/30 * * * * ?}")
    public void executeSweep() {
        String lockKey = "devloop:workspace:init:lock";
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = RedisUtil.lock(lockKey, lockValue, lockTimeout);
            if (!locked) {
                logger.debug("[WorkspaceInit] Another node is running, skip");
                return;
            }
            workspaceInitService.sweepInitializingProjects();
        }
        catch (Exception e) {
            logger.error("[WorkspaceInit] 初始化状态轮询异常", e);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockValue);
            }
        }
    }
}
