package com.iwhalecloud.byai.gateway.channels.controller;

import java.util.HashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuRobotConfigService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.event.FeishuBotEventHandler;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.feishu.support.FeishuEventDecryptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 飞书机器人事件回调入口。
 *
 * <p>该接口必须允许飞书开放平台匿名访问，因此不走系统登录态。
 * 入口只做 URL challenge、token 校验和事件分发，实际聊天逻辑交给异步 handler，
 * 确保飞书回调能快速收到 200 响应。</p>
 */
@RestController
@RequestMapping("/feishu/bot")
@ConditionalOnProperty(name = "channel.stream.enabled", havingValue = "true")
public class FeishuBotEventController {

    private static final Logger logger = LoggerFactory.getLogger(FeishuBotEventController.class);

    private final ObjectMapper objectMapper;
    private final FeishuRobotConfigService feishuRobotConfigService;
    private final FeishuEventDecryptor feishuEventDecryptor;
    private final FeishuBotEventHandler feishuBotEventHandler;

    public FeishuBotEventController(
            ObjectMapper objectMapper,
            FeishuRobotConfigService feishuRobotConfigService,
            FeishuEventDecryptor feishuEventDecryptor,
            FeishuBotEventHandler feishuBotEventHandler
    ) {
        this.objectMapper = objectMapper;
        this.feishuRobotConfigService = feishuRobotConfigService;
        this.feishuEventDecryptor = feishuEventDecryptor;
        this.feishuBotEventHandler = feishuBotEventHandler;
    }

    @PostMapping("/events")
    public ResponseEntity<Map<String, Object>> receiveEvent(@RequestBody String body) {
        try {
            JsonNode root = objectMapper.readTree(body);
            if (root.has("encrypt")) {
                root = decryptEventRoot(root);
            }

            if (isUrlVerificationRequest(root)) {
                return handleChallenge(root);
            }

            if (!validateEventToken(root)) {
                logger.warn("Reject Feishu event because verification token mismatch. appId={}",
                        root.path("header").path("app_id").asText(""));
                return ResponseEntity.status(403).body(Map.of("msg", "verification token mismatch"));
            }

            feishuBotEventHandler.handleEvent(root);
            return ResponseEntity.ok(new HashMap<>());
        } catch (IllegalArgumentException e) {
            logger.warn("Reject Feishu event callback. msg={}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of("msg", e.getMessage()));
        } catch (Exception e) {
            logger.error("Handle Feishu event callback failed", e);
            return ResponseEntity.internalServerError().body(Map.of("msg", e.getMessage()));
        }
    }

    /**
     * 飞书加密回调的外层 JSON 只有 encrypt 字段，不包含 appId。
     * 因此这里会使用当前系统已配置的飞书机器人 Encrypt Key 逐个尝试解密；
     * 解密成功后再走原有 challenge / token / event 处理流程。
     */
    private JsonNode decryptEventRoot(JsonNode encryptedRoot) {
        String encryptedPayload = encryptedRoot.path("encrypt").asText("");
        if (!StringUtils.hasText(encryptedPayload)) {
            throw new IllegalArgumentException("Feishu encrypt payload is empty");
        }

        Exception lastError = null;
        for (FeishuRobotChannelConfig config : feishuRobotConfigService.getAllRobotConfigs()) {
            if (!StringUtils.hasText(config.getEncryptKey())) {
                continue;
            }
            try {
                String plainText = feishuEventDecryptor.decrypt(encryptedPayload, config.getEncryptKey());
                JsonNode decryptedRoot = objectMapper.readTree(plainText);
                logger.info("Decrypt Feishu event callback succeeded. appId={}, resourceId={}",
                        config.getAppId(), config.getResourceId());
                return decryptedRoot;
            } catch (Exception e) {
                lastError = e;
                logger.debug("Try decrypt Feishu event failed. appId={}, resourceId={}",
                        config.getAppId(), config.getResourceId(), e);
            }
        }

        int configuredKeyCount = 0;
        for (FeishuRobotChannelConfig config : feishuRobotConfigService.getAllRobotConfigs()) {
            if (StringUtils.hasText(config.getEncryptKey())) {
                configuredKeyCount++;
            }
        }
        throw new IllegalArgumentException("No Feishu encryptKey can decrypt callback. configuredKeyCount="
                + configuredKeyCount, lastError);
    }

    private ResponseEntity<Map<String, Object>> handleChallenge(JsonNode root) {
        String challenge = extractChallenge(root);
        if (!StringUtils.hasText(challenge)) {
            logger.warn("Reject Feishu challenge because challenge is empty.");
            return ResponseEntity.badRequest().body(Map.of("msg", "challenge is empty"));
        }

        String token = extractVerificationToken(root);
        if (!isKnownVerificationToken(token)) {
            logger.warn("Reject Feishu challenge because verification token is unknown.");
            return ResponseEntity.status(403).body(Map.of("msg", "verification token mismatch"));
        }

        Map<String, Object> response = new HashMap<>();
        response.put("challenge", challenge);
        return ResponseEntity.ok(response);
    }

    /**
     * 飞书 URL 校验主流格式是顶层 challenge/token/type；
     * 部分事件版本或网关适配可能会把字段放在 event/header 下，这里兼容读取，避免平台保存时误判 challenge 未返回。
     */
    private boolean isUrlVerificationRequest(JsonNode root) {
        return StringUtils.hasText(extractChallenge(root))
                || "url_verification".equals(root.path("type").asText(""))
                || "url_verification".equals(root.path("header").path("event_type").asText(""))
                || "url_verification".equals(root.path("event").path("type").asText(""));
    }

    private String extractChallenge(JsonNode root) {
        String challenge = root.path("challenge").asText("");
        if (StringUtils.hasText(challenge)) {
            return challenge;
        }

        challenge = root.path("event").path("challenge").asText("");
        if (StringUtils.hasText(challenge)) {
            return challenge;
        }

        return root.path("event").path("challenge_code").asText("");
    }

    private String extractVerificationToken(JsonNode root) {
        String token = root.path("token").asText("");
        if (StringUtils.hasText(token)) {
            return token;
        }

        token = root.path("header").path("token").asText("");
        if (StringUtils.hasText(token)) {
            return token;
        }

        return root.path("event").path("token").asText("");
    }

    private boolean validateEventToken(JsonNode root) {
        String appId = root.path("header").path("app_id").asText("");
        String requestToken = root.path("header").path("token").asText("");
        if (!StringUtils.hasText(appId)) {
            return false;
        }
        FeishuRobotChannelConfig config;
        try {
            config = feishuRobotConfigService.getRobotConfig(appId);
        } catch (Exception e) {
            logger.warn("Reject Feishu event because appId is not configured. appId={}", appId);
            return false;
        }
        String configuredToken = config.getVerificationToken();
        // token 未配置时只校验 appId 是否存在；便于内网测试，但生产建议配置 verificationToken。
        return !StringUtils.hasText(configuredToken) || configuredToken.equals(requestToken);
    }

    private boolean isKnownVerificationToken(String token) {
        for (FeishuRobotChannelConfig config : feishuRobotConfigService.getAllRobotConfigs()) {
            if (!StringUtils.hasText(config.getVerificationToken()) && !StringUtils.hasText(token)) {
                return true;
            }
            if (StringUtils.hasText(config.getVerificationToken()) && config.getVerificationToken().equals(token)) {
                return true;
            }
        }
        return false;
    }
}
