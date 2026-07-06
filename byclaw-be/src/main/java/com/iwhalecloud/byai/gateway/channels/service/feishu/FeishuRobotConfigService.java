package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuRobotChannelConfig;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 飞书机器人配置缓存。
 *
 * <p>配置来源与钉钉保持一致：数字员工扩展表的 machineChannel 字段。
 * 这里不直接访问数据库，而是接收数字员工 DTO 后解析，以便启动扫描、保存后刷新和测试入口复用。</p>
 */
@Service
public class FeishuRobotConfigService {

    private static final Logger logger = LoggerFactory.getLogger(FeishuRobotConfigService.class);
    private static final String FEISHU_CHANNEL = "Feishu";

    private final ObjectMapper objectMapper;
    private final Map<String, FeishuRobotChannelConfig> robotConfigCache = new ConcurrentHashMap<>();

    public FeishuRobotConfigService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public List<FeishuRobotChannelConfig> buildRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        return parseRobotConfigs(digitalEmployee);
    }

    public void replaceRobotConfigsForResource(Long resourceId, List<FeishuRobotChannelConfig> robotConfigs) {
        removeRobotConfigsByResourceId(resourceId);
        if (robotConfigs == null || robotConfigs.isEmpty()) {
            return;
        }
        for (FeishuRobotChannelConfig robotConfig : robotConfigs) {
            FeishuRobotChannelConfig previous = robotConfigCache.put(robotConfig.getAppId(), robotConfig);
            if (previous != null && !safeEquals(previous.getResourceId(), robotConfig.getResourceId())) {
                logger.warn("Duplicate Feishu appId detected during replace. appId={}, previousResourceId={}, currentResourceId={}",
                        robotConfig.getAppId(), previous.getResourceId(), robotConfig.getResourceId());
            }
        }
    }

    public void removeRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        List<String> appIds = new ArrayList<>();
        for (Map.Entry<String, FeishuRobotChannelConfig> entry : robotConfigCache.entrySet()) {
            if (safeEquals(resourceId, entry.getValue().getResourceId())) {
                appIds.add(entry.getKey());
            }
        }
        for (String appId : appIds) {
            robotConfigCache.remove(appId);
        }
    }

    public List<FeishuRobotChannelConfig> getRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        List<FeishuRobotChannelConfig> result = new ArrayList<>();
        for (FeishuRobotChannelConfig robotConfig : robotConfigCache.values()) {
            if (safeEquals(resourceId, robotConfig.getResourceId())) {
                result.add(robotConfig);
            }
        }
        return result;
    }

    public FeishuRobotChannelConfig getRobotConfig(String appId) {
        if (!StringUtils.hasText(appId)) {
            throw new IllegalStateException("Feishu appId is empty");
        }
        FeishuRobotChannelConfig config = robotConfigCache.get(appId);
        if (config == null) {
            throw new IllegalStateException("Feishu robot config not found, appId=" + appId);
        }
        return config;
    }

    public List<FeishuRobotChannelConfig> getAllRobotConfigs() {
        return new ArrayList<>(robotConfigCache.values());
    }

    private List<FeishuRobotChannelConfig> parseRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        if (digitalEmployee == null || digitalEmployee.getSsResExtDigEmployee() == null) {
            return Collections.emptyList();
        }
        String machineChannel = digitalEmployee.getSsResExtDigEmployee().getMachineChannel();
        if (!StringUtils.hasText(machineChannel)) {
            return Collections.emptyList();
        }

        try {
            JsonNode root = objectMapper.readTree(machineChannel);
            List<FeishuRobotChannelConfig> configs = new ArrayList<>();
            collectRobotConfigs(root, digitalEmployee, configs);
            return configs;
        } catch (Exception e) {
            logger.warn("Parse Feishu machineChannel failed. resourceId={}", digitalEmployee.getResourceId(), e);
            return Collections.emptyList();
        }
    }

    private void collectRobotConfigs(JsonNode node, ResourceExtDigEmployeeDto digitalEmployee,
                                     List<FeishuRobotChannelConfig> configs) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                collectRobotConfigs(item, digitalEmployee, configs);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }

        String channel = getText(node, "channel");
        if (!FEISHU_CHANNEL.equalsIgnoreCase(channel)) {
            return;
        }

        String appId = getText(node, "appId");
        String appSecret = getText(node, "appSecret");
        if (!StringUtils.hasText(appId) || !StringUtils.hasText(appSecret)) {
            logger.warn("Skip Feishu robot config due to missing credentials. resourceId={}, appIdPresent={}, appSecretPresent={}",
                    digitalEmployee.getResourceId(), StringUtils.hasText(appId), StringUtils.hasText(appSecret));
            return;
        }

        FeishuRobotChannelConfig config = new FeishuRobotChannelConfig();
        config.setResourceId(digitalEmployee.getResourceId());
        config.setResourceName(digitalEmployee.getResourceName());
        config.setChannel(channel);
        config.setAppId(appId);
        config.setAppSecret(appSecret);
        config.setVerificationToken(getText(node, "verificationToken"));
        config.setEncryptKey(getText(node, "encryptKey"));
        config.setBotId(getText(node, "botId"));
        config.setCardTemplateId(getText(node, "cardTemplateId"));
        configs.add(config);
    }

    private String getText(JsonNode node, String fieldName) {
        JsonNode valueNode = node.get(fieldName);
        return valueNode == null || valueNode.isNull() ? null : valueNode.asText();
    }

    private boolean safeEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }
}
