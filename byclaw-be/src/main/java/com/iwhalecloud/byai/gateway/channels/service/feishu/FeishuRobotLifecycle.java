package com.iwhalecloud.byai.gateway.channels.service.feishu;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 应用启动时加载飞书机器人配置缓存。
 */
@Component
public class FeishuRobotLifecycle {

    private static final Logger logger = LoggerFactory.getLogger(FeishuRobotLifecycle.class);

    private final FeishuRobotRegistryService feishuRobotRegistryService;

    public FeishuRobotLifecycle(FeishuRobotRegistryService feishuRobotRegistryService) {
        this.feishuRobotRegistryService = feishuRobotRegistryService;
    }

    @PostConstruct
    public void init() {
        try {
            feishuRobotRegistryService.initializeRobotConfigs();
        } catch (Exception e) {
            logger.warn("Initialize Feishu robot configs failed", e);
        }
    }
}
