package com.iwhalecloud.byai.manager.application.service.auth;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Map;
import java.util.Set;

/**
 * 用户权限Redis异步同步服务
 * 专门用于异步同步用户权限到Redis，避免在同一个类内部调用导致@Async不生效的问题
 *
 * @author he.duming
 * @date 2025-05-10
 */
@Service
public class AuthRedisSyncService {

    private static final Logger logger = LoggerFactory.getLogger(AuthRedisSyncService.class);


    @Autowired
    @Lazy
    private AuthApplicationService authApplicationService;

    @Autowired
    private AuthRedisApplicationService authRedisApplicationService;

    /**
     * 异步批量同步用户权限到Redis
     *
     * @param userIds 用户标识集合
     */
    @Async
    public void asyncSyncUsersAuthToRedis(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return;
        }

        int batchSize = 100;
        java.util.List<Long> userIdList = new java.util.ArrayList<>(userIds);
        int total = userIdList.size();
        int successCount = 0;
        int failCount = 0;

        for (int i = 0; i < userIdList.size(); i += batchSize) {
            java.util.List<Long> batch = userIdList.subList(i, Math.min(i + batchSize, userIdList.size()));
            for (Long userId : batch) {
                try {
                    asyncSyncUserAuthToRedis(userId);
                    successCount++;
                } catch (Exception e) {
                    failCount++;
                    logger.error("异步同步用户{}权限到Redis失败：{}", userId, e.getMessage());
                }
            }
            logger.info("异步批量同步用户权限到Redis进度：{}/{}", Math.min(i + batchSize, total), total);
        }

        logger.info("异步批量同步用户权限到Redis完成，总数：{}，成功：{}，失败：{}", total, successCount, failCount);
    }

    /**
     * 异步同步单个用户权限到Redis
     *
     * @param userId 用户标识
     */
    @Async
    public void asyncSyncUserAuthToRedis(Long userId) {
        if (userId == null) {
            return;
        }

        try {
            Map<String, String> resourceAuthMap = authApplicationService.buildUserAuthResources(userId);
            authRedisApplicationService.writeUserAuth(userId, resourceAuthMap);
            logger.info("同步用户{}权限到Redis完成，资源数量：{}", userId, resourceAuthMap.size());
        } catch (Exception e) {
            logger.error("同步用户{}权限到Redis失败：{}", userId, e.getMessage());
        }
    }

    /**
     * 异步同步涉及授权变更的用户权限
     * <p>
     * 数字员工<strong>元数据</strong>（名称、URL、扩展字段等）变更不会经过本方法；此类变更通过
     * {@code byai.dig-employee-change.pubsub-channel} 配置的 Redis Pub/Sub 频道广播（默认 {@code byai:pub:dig_employee_change}），见
     * {@link com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher}。
     *
     * @param userIds 用户ID集合
     * @param hint 变更提示信息
     */
    @Async
    public void asyncSyncAuthChangedUsers(Set<Long> userIds, String hint) {
        if (userIds == null || userIds.isEmpty()) {
            return;
        }

        logger.info("开始异步同步授权变更用户权限，变更类型：{}，涉及用户数：{}", hint, userIds.size());
        long startTime = System.currentTimeMillis();

        try {
            asyncSyncUsersAuthToRedis(userIds);

            long costTime = System.currentTimeMillis() - startTime;
            logger.info("授权变更用户权限异步同步完成，变更类型：{}，涉及用户数：{}，耗时：{}ms", hint, userIds.size(), costTime);
        } catch (Exception e) {
            logger.error("授权变更用户权限异步同步失败，变更类型：{}，错误：{}", hint, e.getMessage());
        }
    }

}
