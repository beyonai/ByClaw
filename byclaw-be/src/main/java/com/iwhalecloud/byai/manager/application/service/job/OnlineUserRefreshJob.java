package com.iwhalecloud.byai.manager.application.service.job;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * 权限缓存定时刷新任务 每天定时刷新权限缓存，支持集群部署、分类分页刷新、缓存一致性校验和邮件通知
 */
@RefreshScope
@Component
@ConditionalOnProperty(prefix = "online.refresh", name = "enabled", havingValue = "true", matchIfMissing = true)
public class OnlineUserRefreshJob {

    private static final Logger logger = LoggerFactory.getLogger(OnlineUserRefreshJob.class);


    /**
     * 分布式锁的秒数 默认100秒
     */
    @Value("${privilege.refresh.lockTimeout:60}")
    private int lockTimeout;

    /**
     * 定时刷新权限缓存（每天两分钟点，cron可配置）
     */
    @Scheduled(cron = "${privilege.refresh.cron:0 */5 * * * ?}")
    public void refreshPrivilegeGrantJob() {
        // 分布式锁，防止集群重复执行
        boolean locked = false;

        String lockKey = "online:refresh:lock";
        String lockKeyValue = UUID.randomUUID().toString();

        try {

            locked = RedisUtil.lock(lockKey, lockKeyValue, lockTimeout);
            if (!locked) {
                logger.info("[OnlineUserRefreshJob] 其他节点正在执行，当前节点跳过");
                return;
            }

            // 清除缓存中的数据
            this.cleanExpiredUsers();
        }
        catch (Exception e) {
            logger.error("[OnlineUserRefreshJob] 刷新异常", e);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockKeyValue);
            }
        }
    }

    /**
     * 清理过期用户（定时任务调用，如每5分钟执行一次）
     */
    public void cleanExpiredUsers() {

        logger.info("[cleanExpiredUsers] 刷新在线用户数量");

        // 1. 获取所有在线用户
        Set<String> onlineUserIds = RedisUtil.members(Constants.ONLINE_USERS_SET_KEY);
        if (onlineUserIds.isEmpty()) {
            return;
        }

        // 2. 检查每个用户的活跃键是否过期，过期则从Set中移除
        for (String userId : onlineUserIds) {
            String activeKey = Constants.USER_ACTIVE_PREFIX + userId;
            Boolean exists = RedisUtil.hasKey(activeKey);
            if (Boolean.FALSE.equals(exists)) {
                // 活跃键已过期，说明用户离线
                RedisUtil.removeSet(Constants.ONLINE_USERS_SET_KEY, userId);
            }
        }
    }

}