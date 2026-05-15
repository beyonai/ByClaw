package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DingtalkRobotConfigService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkRobotConfigService.class);
    private static final String DING_TALK_CHANNEL = "DingTalk";

    private final ObjectMapper objectMapper;
    private final Map<String, DingtalkRobotChannelConfig> robotConfigCache = new ConcurrentHashMap<>();

    public DingtalkRobotConfigService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public List<DingtalkRobotChannelConfig> refreshRobotConfigs(List<ResourceExtDigEmployeeDto> digitalEmployees) {
        robotConfigCache.clear();
        if (digitalEmployees == null || digitalEmployees.isEmpty()) {
            return Collections.emptyList();
        }

        List<DingtalkRobotChannelConfig> configs = new ArrayList<>();
        for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
            configs.addAll(parseRobotConfigs(digitalEmployee));
        }
        for (DingtalkRobotChannelConfig config : configs) {
            DingtalkRobotChannelConfig previous = robotConfigCache.put(config.getRobotCode(), config);
            if (previous != null) {
                logger.warn("Duplicate DingTalk robotCode detected. robotCode={}, previousResourceId={}, currentResourceId={}",
                        config.getRobotCode(), previous.getResourceId(), config.getResourceId());
            }
        }
        return new ArrayList<>(robotConfigCache.values());
    }

    public List<DingtalkRobotChannelConfig> buildRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        return parseRobotConfigs(digitalEmployee);
    }

    public void replaceRobotConfigsForResource(Long resourceId, List<DingtalkRobotChannelConfig> robotConfigs) {
        removeRobotConfigsByResourceId(resourceId);
        if (robotConfigs == null || robotConfigs.isEmpty()) {
            return;
        }
        for (DingtalkRobotChannelConfig robotConfig : robotConfigs) {
            DingtalkRobotChannelConfig previous = robotConfigCache.put(robotConfig.getRobotCode(), robotConfig);
            if (previous != null && !safeEquals(previous.getResourceId(), robotConfig.getResourceId())) {
                logger.warn("Duplicate DingTalk robotCode detected during replace. robotCode={}, previousResourceId={}, currentResourceId={}",
                        robotConfig.getRobotCode(), previous.getResourceId(), robotConfig.getResourceId());
            }
        }
    }

    public void removeRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        List<String> robotCodes = new ArrayList<>();
        for (Map.Entry<String, DingtalkRobotChannelConfig> entry : robotConfigCache.entrySet()) {
            if (safeEquals(resourceId, entry.getValue().getResourceId())) {
                robotCodes.add(entry.getKey());
            }
        }
        for (String robotCode : robotCodes) {
            robotConfigCache.remove(robotCode);
        }
    }

    public List<DingtalkRobotChannelConfig> getRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        List<DingtalkRobotChannelConfig> result = new ArrayList<>();
        for (DingtalkRobotChannelConfig robotConfig : robotConfigCache.values()) {
            if (safeEquals(resourceId, robotConfig.getResourceId())) {
                result.add(robotConfig);
            }
        }
        return result;
    }

    public DingtalkRobotChannelConfig getRobotConfig(String robotCode) {
        if (!StringUtils.hasText(robotCode)) {
            throw new IllegalStateException("DingTalk robotCode is empty");
        }
        DingtalkRobotChannelConfig config = robotConfigCache.get(robotCode);
        if (config == null) {
            throw new IllegalStateException("DingTalk robot config not found, robotCode=" + robotCode);
        }
        return config;
    }

    private List<DingtalkRobotChannelConfig> parseRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        if (digitalEmployee == null || digitalEmployee.getSsResExtDigEmployee() == null) {
            return Collections.emptyList();
        }
        String machineChannel = digitalEmployee.getSsResExtDigEmployee().getMachineChannel();
        if (!StringUtils.hasText(machineChannel)) {
            return Collections.emptyList();
        }

        try {
            JsonNode root = objectMapper.readTree(machineChannel);
            List<DingtalkRobotChannelConfig> configs = new ArrayList<>();
            collectRobotConfigs(root, digitalEmployee, configs);
            return configs;
        } catch (Exception e) {
            logger.warn("Parse machineChannel failed. resourceId={}", digitalEmployee.getResourceId(), e);
            return Collections.emptyList();
        }
    }

    private void collectRobotConfigs(JsonNode node, ResourceExtDigEmployeeDto digitalEmployee,
                                     List<DingtalkRobotChannelConfig> configs) {
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
        if (!DING_TALK_CHANNEL.equalsIgnoreCase(channel)) {
            return;
        }

        String robotCode = getText(node, "robotCode");
        String clientId = getText(node, "clientId");
        String clientSecret = getText(node, "clientSecret");
        if (!StringUtils.hasText(robotCode) || !StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            logger.warn("Skip DingTalk robot config due to missing credentials. resourceId={}, robotCode={}, clientIdPresent={}, clientSecretPresent={}",
                    digitalEmployee.getResourceId(), robotCode, StringUtils.hasText(clientId), StringUtils.hasText(clientSecret));
            return;
        }

        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setResourceId(digitalEmployee.getResourceId());
        config.setResourceName(digitalEmployee.getResourceName());
        config.setChannel(channel);
        config.setRobotCode(robotCode);
        config.setClientId(clientId);
        config.setClientSecret(clientSecret);
        config.setAppId(getText(node, "appId"));
        config.setCardTemplateId(getText(node, "AICardId"));
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
