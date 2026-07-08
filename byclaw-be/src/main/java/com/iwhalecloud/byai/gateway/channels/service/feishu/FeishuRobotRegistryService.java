package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuRobotChannelConfig;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 飞书机器人配置注册服务。
 *
 * <p>飞书 MVP 采用 HTTP 事件回调，不需要像钉钉 Stream 那样创建长连接客户端。
 * 这个 registry 的职责是维护 appId -> 配置 的内存缓存，并在配置变化时清理 token 缓存。</p>
 */
@Service
public class FeishuRobotRegistryService {

    private static final Logger logger = LoggerFactory.getLogger(FeishuRobotRegistryService.class);
    private static final String FEISHU_CHANNEL = "Feishu";

    private final SsResExtDigEmployeeService ssResExtDigEmployeeService;
    private final FeishuRobotConfigService feishuRobotConfigService;
    private final FeishuTokenService feishuTokenService;
    private final Object refreshLock = new Object();

    public FeishuRobotRegistryService(
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            FeishuRobotConfigService feishuRobotConfigService,
            FeishuTokenService feishuTokenService
    ) {
        this.ssResExtDigEmployeeService = ssResExtDigEmployeeService;
        this.feishuRobotConfigService = feishuRobotConfigService;
        this.feishuTokenService = feishuTokenService;
    }

    public void initializeRobotConfigs() {
        synchronized (refreshLock) {
            List<ResourceExtDigEmployeeDto> digitalEmployees = findFeishuDigitalEmployees();
            if (digitalEmployees.isEmpty()) {
                logger.info("No Feishu robot configs found from digital employees. Skip startup cache init.");
                return;
            }
            for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
                if (digitalEmployee != null) {
                    doRefreshRobotConfigsForResource(digitalEmployee.getResourceId());
                }
            }
            logger.info("Feishu robot config cache initialized. configCount={}",
                    feishuRobotConfigService.getAllRobotConfigs().size());
        }
    }

    public void registerRobotClientsForResource(Long resourceId) {
        refreshRobotClientsForResource(resourceId);
    }

    public void refreshRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (resourceId == null) {
                return;
            }
            doRefreshRobotConfigsForResource(resourceId);
        }
    }

    public void unregisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (resourceId == null) {
                return;
            }
            List<FeishuRobotChannelConfig> currentConfigs =
                    feishuRobotConfigService.getRobotConfigsByResourceId(resourceId);
            for (FeishuRobotChannelConfig currentConfig : currentConfigs) {
                feishuTokenService.evictTenantAccessToken(currentConfig.getAppId());
            }
            feishuRobotConfigService.removeRobotConfigsByResourceId(resourceId);
            logger.info("Unregistered Feishu robot configs by resource. resourceId={}, removedCount={}",
                    resourceId, currentConfigs.size());
        }
    }

    @PreDestroy
    public void shutdownAll() {
        synchronized (refreshLock) {
            for (FeishuRobotChannelConfig config : feishuRobotConfigService.getAllRobotConfigs()) {
                feishuTokenService.evictTenantAccessToken(config.getAppId());
            }
        }
    }

    private void doRefreshRobotConfigsForResource(Long resourceId) {
        ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
        List<FeishuRobotChannelConfig> desiredConfigs = digitalEmployee == null
                ? Collections.emptyList()
                : feishuRobotConfigService.buildRobotConfigs(digitalEmployee);

        Map<String, FeishuRobotChannelConfig> desiredConfigMap = new HashMap<>();
        for (FeishuRobotChannelConfig desiredConfig : desiredConfigs) {
            desiredConfigMap.put(desiredConfig.getAppId(), desiredConfig);
        }

        List<FeishuRobotChannelConfig> currentConfigs =
                feishuRobotConfigService.getRobotConfigsByResourceId(resourceId);
        for (FeishuRobotChannelConfig currentConfig : currentConfigs) {
            FeishuRobotChannelConfig desiredConfig = desiredConfigMap.get(currentConfig.getAppId());
            if (desiredConfig == null || isConfigChanged(currentConfig, desiredConfig)) {
                feishuTokenService.evictTenantAccessToken(currentConfig.getAppId());
            }
        }

        feishuRobotConfigService.replaceRobotConfigsForResource(resourceId, desiredConfigs);
        logger.info("Feishu robot config refresh finished. resourceId={}, configCount={}",
                resourceId, desiredConfigs.size());
    }

    private List<ResourceExtDigEmployeeDto> findFeishuDigitalEmployees() {
        List<ResourceExtDigEmployeeDto> digitalEmployees =
                ssResExtDigEmployeeService.findOnlineDigitalEmployees(FEISHU_CHANNEL);
        return digitalEmployees == null ? Collections.emptyList() : digitalEmployees;
    }

    private boolean isConfigChanged(FeishuRobotChannelConfig currentConfig, FeishuRobotChannelConfig desiredConfig) {
        return !safeEquals(currentConfig.getAppSecret(), desiredConfig.getAppSecret())
                || !safeEquals(currentConfig.getVerificationToken(), desiredConfig.getVerificationToken())
                || !safeEquals(currentConfig.getEncryptKey(), desiredConfig.getEncryptKey())
                || !safeEquals(currentConfig.getBotId(), desiredConfig.getBotId())
                || !safeEquals(currentConfig.getCardTemplateId(), desiredConfig.getCardTemplateId())
                || !safeEquals(currentConfig.getResourceId(), desiredConfig.getResourceId())
                || !safeEquals(currentConfig.getResourceName(), desiredConfig.getResourceName());
    }

    private boolean safeEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }
}
