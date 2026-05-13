package com.iwhalecloud.byai.manager.application.runner;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisApplicationService;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 用户权限Redis缓存初始化
 * 实现 ApplicationRunner 接口，在服务启动时自动执行。
 * 内部采用异步方式写入Redis，不阻塞服务启动。
 *
 * @author he.duming
 * @date 2025-05-10
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InitUserResourcesAuthRedisRunner implements ApplicationRunner {

    private static final Logger logger = LoggerFactory.getLogger(InitUserResourcesAuthRedisRunner.class);

    /**
     * 防止同一进程内重复执行（例如上下文刷新场景）
     */
    private final AtomicBoolean initialized = new AtomicBoolean(false);

    /**
     * 是否启用用户权限缓存加载
     */
    @Value("${INIT_USER_AUTH_RESOURCES_REDIS_ENABLED:false}")
    private boolean loadUserAuthEnabled;

    @Value("${load.to.redis.batchSize:1000}")
    private int batchSize;

    @Autowired
    private UserService userService;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private AuthRedisApplicationService authRedisApplicationService;

    /**
     * 应用启动后异步全量写入 Redis，Order 设为最低优先级确保其它 Runner 先执行
     */
    @Override
    public void run(ApplicationArguments args) {
        if (!loadUserAuthEnabled) {
            logger.info("用户资源权限Redis缓存初始化开关 INIT_USER_AUTH_RESOURCES_REDIS_ENABLED={}，跳过初始化", loadUserAuthEnabled);
            return;
        }

        if (!initialized.compareAndSet(false, true)) {
            logger.info("用户权限Redis全量初始化已执行过，跳过重复执行");
            return;
        }

        // 异步执行，不阻塞服务启动
        CompletableFuture.runAsync(this::doFullInit);
        logger.info("用户权限Redis全量初始化已提交异步执行");
    }

    /**
     * 全量初始化核心逻辑：
     * 1. 分页查询活跃用户
     * 2. 每页批量查询所有用户权限（1次SQL替代N次）
     * 3. Redis Pipeline批量写入
     */
    private void doFullInit() {
        long startTime = System.currentTimeMillis();
        logger.info("开始异步全量初始化用户权限到Redis缓存...");

        int totalUsers = 0;
        int pageIndex = 1;

        try {
            while (true) {
                QueryWrapper<Users> queryWrapper = new QueryWrapper<>();
                queryWrapper.eq("state", UserState.ACTIVE);
                queryWrapper.orderByAsc("user_id");

                /**
                 * 批量加载用户数
                 */
                Page<Users> page = new Page<>(pageIndex, batchSize, false);
                List<Users> users = userService.selectList(page, queryWrapper);

                if (users == null || users.isEmpty()) {
                    break;
                }

                // 提取用户ID列表
                List<Long> userIds = new ArrayList<>();
                for (Users user : users) {
                    if (user.getUserId() != null) {
                        userIds.add(user.getUserId());
                    }
                }

                if (!userIds.isEmpty()) {
                    try {
                        // 逐用户构建权限（包含USER直接授权 + ORG/POST/STATION继承授权）
                        Map<Long, Map<String, String>> batchResult = new HashMap<>();
                        for (Long userId : userIds) {
                            try {
                                batchResult.put(userId, authApplicationService.buildUserAuthResources(userId));
                            } catch (Exception e) {
                                logger.error("构建用户{}权限失败：{}", userId, e.getMessage(), e);
                                batchResult.put(userId, new HashMap<>());
                            }
                        }

                        // Pipeline批量写入Redis
                        authRedisApplicationService.pipelineBatchWriteUserAuth(batchResult);

                        totalUsers += userIds.size();
                    } catch (Exception e) {
                        logger.error("批量处理第{}页用户权限失败：{}", pageIndex, e.getMessage(), e);
                    }
                    logger.info("全量初始化用户权限到Redis，进度：已处理{}个用户", totalUsers);
                }

                // 如果返回的记录数不等于批次大小，说明已经是最后一页
                if (users.size() != batchSize) {
                    break;
                }

                pageIndex++;
            }

            long costTime = (System.currentTimeMillis() - startTime) / 1000;
            logger.info("全量初始化用户权限到Redis缓存完成，总共处理{}个用户，耗时{}秒", totalUsers, costTime);

        } catch (Exception e) {
            logger.error("全量初始化用户权限到Redis缓存失败：{}", e.getMessage(), e);
        }
    }

}
