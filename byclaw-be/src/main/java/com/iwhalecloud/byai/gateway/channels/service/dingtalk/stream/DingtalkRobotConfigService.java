package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.RobotConfigParseResult;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.RobotConfigSnapshot;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class DingtalkRobotConfigService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkRobotConfigService.class);
    private static final String DING_TALK_CHANNEL = "DingTalk";

    private final ObjectMapper objectMapper;
    private final AtomicReference<RobotConfigSnapshot> configSnapshot =
            new AtomicReference<>(RobotConfigSnapshot.empty());

    public DingtalkRobotConfigService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public synchronized List<DingtalkRobotChannelConfig> refreshRobotConfigs(
            List<ResourceExtDigEmployeeDto> digitalEmployees) {
        List<DingtalkRobotChannelConfig> configs = new ArrayList<>();
        if (digitalEmployees != null) {
            for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
                configs.addAll(buildRobotConfigs(digitalEmployee));
            }
        }
        publishRuntimeSnapshot(configs);
        return configs.stream().map(this::copyConfig).toList();
    }

    public List<DingtalkRobotChannelConfig> buildRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        RobotConfigParseResult result = parseRobotConfigsResult(digitalEmployee);
        if (!result.errors().isEmpty()) {
            logger.warn("Read committed DingTalk config with validation errors. resourceId={}, errorCodes={}",
                    digitalEmployee == null ? null : digitalEmployee.getResourceId(),
                    result.errors().stream().map(RobotConfigParseResult.ParseError::code).distinct().toList());
        }
        return result.configs().stream().map(this::copyConfig).toList();
    }

    public List<DingtalkRobotChannelConfig> validateAndBuildRobotConfigs(
            ResourceExtDigEmployeeDto digitalEmployee) {
        RobotConfigParseResult result = parseRobotConfigsResult(digitalEmployee);
        if (!result.errors().isEmpty()) {
            String errorCodes = String.join(",", result.errors().stream()
                    .map(RobotConfigParseResult.ParseError::code)
                    .distinct()
                    .toList());
            throw new DingtalkRobotConfigValidationException(
                    "Invalid DingTalk robot config, resourceId="
                            + (digitalEmployee == null ? null : digitalEmployee.getResourceId())
                            + ", errorCodes=" + errorCodes);
        }
        for (DingtalkRobotChannelConfig candidate : result.configs()) {
            Set<Long> currentOwners = configSnapshot.get().ownersByRobotCode()
                    .getOrDefault(candidate.getRobotCode(), Set.of());
            Long otherOwner = currentOwners.stream()
                    .filter(owner -> !safeEquals(owner, candidate.getResourceId()))
                    .findFirst()
                    .orElse(null);
            if (otherOwner != null) {
                throw new DingtalkRobotConfigValidationException(
                        "Invalid DingTalk robot config, errorCode=ROBOT_CODE_OWNED_BY_ANOTHER_RESOURCE"
                                + ", robotCode=" + candidate.getRobotCode()
                                + ", ownerResourceId=" + otherOwner
                                + ", conflictResourceId=" + candidate.getResourceId());
            }
        }
        return result.configs().stream().map(this::copyConfig).toList();
    }

    RobotConfigParseResult parseRobotConfigsResult(ResourceExtDigEmployeeDto digitalEmployee) {
        if (digitalEmployee == null || digitalEmployee.getSsResExtDigEmployee() == null) {
            return new RobotConfigParseResult(List.of(), false, List.of());
        }
        String machineChannel = digitalEmployee.getSsResExtDigEmployee().getMachineChannel();
        if (!StringUtils.hasText(machineChannel)) {
            return new RobotConfigParseResult(List.of(), false, List.of());
        }

        try {
            JsonNode root = objectMapper.readTree(machineChannel);
            List<DingtalkRobotChannelConfig> configs = new ArrayList<>();
            List<RobotConfigParseResult.ParseError> errors = new ArrayList<>();
            Set<String> seenRobotCodes = new HashSet<>();
            boolean[] hasDingtalkNode = {false};
            collectRobotConfigs(root, digitalEmployee, configs, errors, seenRobotCodes, hasDingtalkNode);
            return new RobotConfigParseResult(configs, hasDingtalkNode[0], errors);
        } catch (Exception e) {
            logger.warn("Parse machineChannel failed. resourceId={}", digitalEmployee.getResourceId(), e);
            return new RobotConfigParseResult(List.of(), false,
                    List.of(new RobotConfigParseResult.ParseError("INVALID_JSON", null)));
        }
    }

    public synchronized void replaceRobotConfigsForResource(
            Long resourceId, List<DingtalkRobotChannelConfig> robotConfigs) {
        Map<Long, List<DingtalkRobotChannelConfig>> configsByResource = mutableConfigsByResource();
        configsByResource.remove(resourceId);
        if (robotConfigs != null && !robotConfigs.isEmpty()) {
            configsByResource.put(resourceId, robotConfigs.stream().map(this::copyConfig).toList());
        }
        publishRuntimeSnapshot(configsByResource.values().stream().flatMap(List::stream).toList());
    }

    public synchronized void removeRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        Map<Long, List<DingtalkRobotChannelConfig>> configsByResource = mutableConfigsByResource();
        configsByResource.remove(resourceId);
        publishRuntimeSnapshot(configsByResource.values().stream().flatMap(List::stream).toList());
    }

    public List<DingtalkRobotChannelConfig> getRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        return configSnapshot.get().byResourceId().getOrDefault(resourceId, List.of())
                .stream().map(this::copyConfig).toList();
    }

    public Set<Long> getConfiguredResourceIds() {
        return Set.copyOf(configSnapshot.get().ownedConfigsByResourceId().keySet());
    }

    boolean isConflictedRobotCode(String robotCode) {
        return configSnapshot.get().conflictedRobotCodes().contains(robotCode);
    }

    public DingtalkRobotChannelConfig getRobotConfig(String robotCode) {
        if (!StringUtils.hasText(robotCode)) {
            throw new IllegalStateException("DingTalk robotCode is empty");
        }
        DingtalkRobotChannelConfig config = configSnapshot.get().byRobotCode().get(robotCode);
        if (config == null) {
            throw new IllegalStateException("DingTalk robot config not found, robotCode=" + robotCode);
        }
        return copyConfig(config);
    }

    String credentialVersion(DingtalkRobotChannelConfig config) {
        return hashLengthPrefixed("dingtalk-credential-v1", config.getClientId(), config.getClientSecret());
    }

    String desiredConfigFingerprint(DingtalkRobotChannelConfig config) {
        return hashLengthPrefixed(
                "dingtalk-desired-config-v1",
                config.getRobotCode(),
                config.getClientId(),
                config.getClientSecret(),
                config.getResourceId() == null ? null : String.valueOf(config.getResourceId()),
                config.getResourceName(),
                config.getAppId(),
                config.getCardTemplateId(),
                config.getChannel()
        );
    }

    RobotConfigSnapshot currentSnapshot() {
        return configSnapshot.get();
    }

    private void collectRobotConfigs(
            JsonNode node,
            ResourceExtDigEmployeeDto digitalEmployee,
            List<DingtalkRobotChannelConfig> configs,
            List<RobotConfigParseResult.ParseError> errors,
            Set<String> seenRobotCodes,
            boolean[] hasDingtalkNode) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                collectRobotConfigs(item, digitalEmployee, configs, errors, seenRobotCodes, hasDingtalkNode);
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
        hasDingtalkNode[0] = true;

        String robotCode = getText(node, "robotCode");
        String clientId = getText(node, "clientId");
        String clientSecret = getText(node, "clientSecret");
        if (!StringUtils.hasText(robotCode) || !StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            errors.add(new RobotConfigParseResult.ParseError("MISSING_CREDENTIALS", robotCode));
            return;
        }
        if (!seenRobotCodes.add(robotCode)) {
            errors.add(new RobotConfigParseResult.ParseError("DUPLICATE_ROBOT_CODE", robotCode));
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

    private void publishRuntimeSnapshot(List<DingtalkRobotChannelConfig> configs) {
        RobotConfigSnapshot previous = configSnapshot.get();
        Map<Long, List<DingtalkRobotChannelConfig>> allByResourceId = new LinkedHashMap<>();
        Map<String, Set<Long>> ownersByRobotCode = new LinkedHashMap<>();

        for (DingtalkRobotChannelConfig source : configs) {
            DingtalkRobotChannelConfig config = copyConfig(source);
            allByResourceId.computeIfAbsent(config.getResourceId(), ignored -> new ArrayList<>()).add(config);
            ownersByRobotCode.computeIfAbsent(config.getRobotCode(), ignored -> new LinkedHashSet<>())
                    .add(config.getResourceId());
        }

        Set<String> conflicts = new LinkedHashSet<>();
        ownersByRobotCode.forEach((robotCode, owners) -> {
            if (owners.size() > 1) {
                conflicts.add(robotCode);
            }
        });
        Map<String, DingtalkRobotChannelConfig> byRobotCode = new LinkedHashMap<>();
        Map<Long, List<DingtalkRobotChannelConfig>> byResourceId = new LinkedHashMap<>();
        allByResourceId.forEach((resourceId, resourceConfigs) -> resourceConfigs.forEach(config -> {
            if (!conflicts.contains(config.getRobotCode())) {
                byRobotCode.put(config.getRobotCode(), copyConfig(config));
                byResourceId.computeIfAbsent(resourceId, ignored -> new ArrayList<>()).add(copyConfig(config));
            }
        }));
        Map<Long, List<DingtalkRobotChannelConfig>> immutableByResource = new LinkedHashMap<>();
        byResourceId.forEach((key, value) -> immutableByResource.put(key, List.copyOf(value)));
        Map<Long, List<DingtalkRobotChannelConfig>> immutableOwnedByResource = new LinkedHashMap<>();
        allByResourceId.forEach((key, value) -> immutableOwnedByResource.put(key, List.copyOf(value)));

        configSnapshot.set(new RobotConfigSnapshot(
                previous.snapshotVersion() + 1,
                byRobotCode,
                immutableByResource,
                immutableOwnedByResource,
                ownersByRobotCode,
                immutableByResource.keySet(),
                conflicts,
                Set.of()
        ));
    }

    private Map<Long, List<DingtalkRobotChannelConfig>> mutableConfigsByResource() {
        Map<Long, List<DingtalkRobotChannelConfig>> result = new HashMap<>();
        configSnapshot.get().ownedConfigsByResourceId().forEach((resourceId, configs) ->
                result.put(resourceId, configs.stream().map(this::copyConfig).toList()));
        return result;
    }

    private DingtalkRobotChannelConfig copyConfig(DingtalkRobotChannelConfig source) {
        DingtalkRobotChannelConfig copy = new DingtalkRobotChannelConfig();
        copy.setResourceId(source.getResourceId());
        copy.setResourceName(source.getResourceName());
        copy.setChannel(source.getChannel());
        copy.setClientId(source.getClientId());
        copy.setClientSecret(source.getClientSecret());
        copy.setRobotCode(source.getRobotCode());
        copy.setAppId(source.getAppId());
        copy.setCardTemplateId(source.getCardTemplateId());
        return copy;
    }

    private String hashLengthPrefixed(String marker, String... fields) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateLengthPrefixed(digest, marker);
            for (String field : fields) {
                updateLengthPrefixed(digest, field);
            }
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private void updateLengthPrefixed(MessageDigest digest, String value) {
        byte[] bytes = value == null ? new byte[0] : value.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
        digest.update(bytes);
    }

    private String getText(JsonNode node, String fieldName) {
        JsonNode valueNode = node.get(fieldName);
        return valueNode == null || valueNode.isNull() ? null : valueNode.asText();
    }

    private boolean safeEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }
}
