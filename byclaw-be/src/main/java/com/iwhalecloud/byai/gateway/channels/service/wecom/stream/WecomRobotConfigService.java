package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomRobotChannelConfig;
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

/**
 * Parses WeCom robot configs out of a digital employee's {@code machineChannel}
 * JSON, mirroring {@code DingtalkRobotConfigService}.
 *
 * <p>The channel discriminator is {@value #WECOM_CHANNEL} — it MUST match the
 * string passed to {@code findOnlineDigitalEmployees(...)} (the SQL
 * {@code machine_channel like '%WeCom%'} filter) and the {@code channel} field
 * in the config JSON, or discovery/parse return nothing (plan §7.5).
 *
 * <p>botId/secret are normalized: {@code botId = botId ?: robotCode},
 * {@code secret = secret ?: clientSecret} for DingTalk-compatible saved forms.
 */
@Service
public class WecomRobotConfigService {

    private static final Logger logger = LoggerFactory.getLogger(WecomRobotConfigService.class);
    static final String WECOM_CHANNEL = "WeCom";

    private final ObjectMapper objectMapper;
    private final Map<String, WecomRobotChannelConfig> configByBotId = new ConcurrentHashMap<>();

    public WecomRobotConfigService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public List<WecomRobotChannelConfig> buildRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        if (digitalEmployee == null || digitalEmployee.getSsResExtDigEmployee() == null) {
            return Collections.emptyList();
        }
        String machineChannel = digitalEmployee.getSsResExtDigEmployee().getMachineChannel();
        if (!StringUtils.hasText(machineChannel)) {
            return Collections.emptyList();
        }
        try {
            JsonNode root = objectMapper.readTree(machineChannel);
            List<WecomRobotChannelConfig> configs = new ArrayList<>();
            collect(root, digitalEmployee, configs);
            return configs;
        } catch (Exception e) {
            logger.warn("Parse WeCom machineChannel failed. resourceId={}", digitalEmployee.getResourceId(), e);
            return Collections.emptyList();
        }
    }

    public void replaceRobotConfigsForResource(Long resourceId, List<WecomRobotChannelConfig> configs) {
        removeRobotConfigsByResourceId(resourceId);
        if (configs == null) {
            return;
        }
        for (WecomRobotChannelConfig config : configs) {
            configByBotId.put(config.getBotId(), config);
        }
    }

    public void removeRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        configByBotId.values().removeIf(c -> resourceId.equals(c.getResourceId()));
    }

    public List<WecomRobotChannelConfig> getRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        List<WecomRobotChannelConfig> result = new ArrayList<>();
        for (WecomRobotChannelConfig config : configByBotId.values()) {
            if (resourceId.equals(config.getResourceId())) {
                result.add(config);
            }
        }
        return result;
    }

    public WecomRobotChannelConfig getRobotConfig(String botId) {
        if (!StringUtils.hasText(botId)) {
            return null;
        }
        return configByBotId.get(botId);
    }

    private void collect(JsonNode node, ResourceExtDigEmployeeDto digitalEmployee,
                         List<WecomRobotChannelConfig> configs) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                collect(item, digitalEmployee, configs);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }

        String channel = text(node, "channel");
        if (!WECOM_CHANNEL.equalsIgnoreCase(channel)) {
            return;
        }

        String botId = firstNonBlank(text(node, "botId"), text(node, "robotCode"));
        String secret = firstNonBlank(text(node, "secret"), text(node, "clientSecret"));
        if (!StringUtils.hasText(botId) || !StringUtils.hasText(secret)) {
            logger.warn("Skip WeCom robot config due to missing botId/secret. resourceId={}, botIdPresent={}, secretPresent={}",
                    digitalEmployee.getResourceId(), StringUtils.hasText(botId), StringUtils.hasText(secret));
            return;
        }

        WecomRobotChannelConfig config = new WecomRobotChannelConfig();
        config.setResourceId(digitalEmployee.getResourceId());
        config.setResourceName(digitalEmployee.getResourceName());
        config.setChannel(channel);
        config.setBotId(botId);
        config.setSecret(secret);
        config.setAgentId(text(node, "agentId"));
        config.setCorpId(text(node, "corpId"));
        config.setCorpSecret(text(node, "corpSecret"));
        configs.add(config);
    }

    private String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private String firstNonBlank(String a, String b) {
        return StringUtils.hasText(a) ? a : b;
    }
}
