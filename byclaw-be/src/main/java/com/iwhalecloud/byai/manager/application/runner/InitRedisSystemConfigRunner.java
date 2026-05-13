package com.iwhalecloud.byai.manager.application.runner;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.manager.application.service.staticdata.SystemConfigApplicationService;
import com.iwhalecloud.byai.manager.application.service.staticdata.SystemConfigListApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 启动加载用户组织信息到redis缓存中
 */
@Component
public class InitRedisSystemConfigRunner implements ApplicationRunner {

    private final Logger logger = LoggerFactory.getLogger(InitRedisSystemConfigRunner.class);

    @Autowired
    private SystemConfigApplicationService systemConfigApplicationService;

    @Autowired
    private SystemConfigListApplicationService systemConfigListApplicationService;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Autowired
    private ByaiAimodelMapper byaiAimodelMapper;

    @Autowired
    private EnterpriseInfoService enterpriseInfoService;


    /**
     * 加载数据批量大小设置
     */
    @Value("${load.to.redis.batchSize:1000}")
    private Integer batchSize;

    @Autowired
    private UserService userService;



    /**
     * 加载redis开关
     */
    @Value("${init.Redis.system.config.runner.enabled:true}")
    private boolean enabled;

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            logger.info("开关init.Redis.system.config.runner.enabled={}，不加载缓存数据到redis", enabled);
            return;
        }

        // 系统配置
        systemConfigApplicationService.loadAllSystemConfigCache();

        // 数据字典配置
        systemConfigListApplicationService.loadAllSystemConfigListCache();

        // 加载启用状态的模型到Redis
        loadEnabledModelsToRedis();

        // 加载用户数据到redis
        loadUsersToRedis();
    }

    /**
     * 加载所有启用状态的模型到Redis
     */
    private void loadEnabledModelsToRedis() {
        try {
            // 查询所有启用状态的模型（OOA为启用状态的数据库代码）
            List<ByaiAimodel> enabledModels = byaiAimodelMapper.selectByCondition("OOA", null, null, null, null, null);
            if (enabledModels != null && !enabledModels.isEmpty()) {
                logger.info("开始加载启用状态的模型到Redis，共{}个模型", enabledModels.size());
                for (ByaiAimodel model : enabledModels) {
                    byaiAimodelDomainService.syncToRedis(model);
                }
                logger.info("启用状态的模型加载到Redis完成");
            } else {
                logger.info("没有启用状态的模型需要加载到Redis");
            }
        } catch (Exception e) {
            logger.error("加载启用状态的模型到Redis失败", e);
        }
    }


    /**
     * 加载用户数据到redis中
     */
    private void loadUsersToRedis() {

        Long enterpriseId = enterpriseInfoService.getEnterpriseId();

        // 从第一页开始批量写入缓存中
        for (int pageIndex = 1; true; pageIndex++) {

            QueryWrapper<Users> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("state", UserState.ACTIVE);
            queryWrapper.orderByAsc("user_id");

            Page<Users> page = new Page<>(pageIndex, batchSize, false);

            logger.info("批量加载用户数据pageIndex={},batchSize={}", pageIndex, batchSize);

            List<Users> users = userService.selectList(page, queryWrapper);
            if (ListUtil.isEmpty(users)) {
                break;
            }

            // 将用户数据加载到 Redis 中
            for (Users user : users) {
                ShareCacheUtil.setShareShareBfmUser(user, enterpriseId);
            }
        }
    }

}
