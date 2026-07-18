package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;

/**
 * Handles control-plane wakeup messages that should bring user-scoped sandboxes back online.
 */
@Service
public class SandboxWakeupMessageHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxWakeupMessageHandler.class);

    static final String WAKE_AND_WAIT_POLICY = "WAKE_AND_WAIT";

    static final String WAKE_AND_QUEUE_POLICY = "WAKE_AND_QUEUE";

    private final SandboxService sandboxService;
    private final SandboxUserContextRunner sandboxUserContextRunner;

    public SandboxWakeupMessageHandler(@Lazy SandboxService sandboxService,
        @Lazy SandboxUserContextRunner sandboxUserContextRunner) {
        this.sandboxService = sandboxService;
        this.sandboxUserContextRunner = sandboxUserContextRunner;
    }

    boolean handle(Map<String, String> recordValues) {
        JSONObject message = parseMessage(recordValues);
        if (message == null || message.isEmpty()) {
            LOGGER.warn("沙箱唤醒消息为空或无法解析，recordValues={}", recordValues);
            return false;
        }

        String policy = message.getString("policy");
        if (!WAKE_AND_WAIT_POLICY.equals(policy) && !WAKE_AND_QUEUE_POLICY.equals(policy)) {
            LOGGER.debug("忽略非 WAKE_AND_WAIT 或 WAKE_AND_QUEUE 沙箱唤醒消息，policy={}", policy);
            return false;
        }

        String targetAgentType = resolveTargetAgentType(message);
        String userCode = resolveUserCode(message, targetAgentType);
        if (!isDefaultSandboxTarget(targetAgentType, userCode)) {
            LOGGER.debug("忽略非默认沙箱目标唤醒消息，targetAgentType={}，userCode={}", targetAgentType, userCode);
            return false;
        }

        LOGGER.info("收到默认沙箱唤醒消息，userCode={}，targetAgentType={}，executionId={}，sessionId={}，messageId={}",
            userCode, targetAgentType, message.getString("execution_id"), message.getString("session_id"),
            message.getString("message_id"));
        Long resourceId = StringUtils.startsWith(targetAgentType, WorkerAgentType.BYCLAW_CODE.getCode() + "_")
            ? SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID
            : SandboxLaunchRouting.DEFAULT_RESOURCE_ID;
        sandboxUserContextRunner.runAsUser(userCode,
            () -> sandboxService.restartSandboxAfterRemoteExit(userCode, resourceId, targetAgentType));
        return true;
    }

    private JSONObject parseMessage(Map<String, String> recordValues) {
        if (recordValues == null || recordValues.isEmpty()) {
            return null;
        }
        for (String payloadField : new String[]{"data", "payload", "message"}) {
            String rawPayload = recordValues.get(payloadField);
            if (StringUtils.isNotBlank(rawPayload)) {
                return parseObject(rawPayload);
            }
        }

        JSONObject message = new JSONObject();
        recordValues.forEach((key, value) -> message.put(key, parseValue(value)));
        return message;
    }

    private Object parseValue(String value) {
        if (StringUtils.isBlank(value)) {
            return value;
        }
        String trimmed = value.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
            return value;
        }
        try {
            return JSON.parse(value);
        } catch (Exception e) {
            return value;
        }
    }

    private JSONObject parseObject(String rawPayload) {
        try {
            return JSON.parseObject(rawPayload);
        } catch (Exception e) {
            LOGGER.warn("解析沙箱唤醒消息 JSON 失败，rawPayload={}", rawPayload, e);
            return null;
        }
    }

    private String resolveTargetAgentType(JSONObject message) {
        String targetAgentType = message.getString("target_agent_type");
        if (StringUtils.isNotBlank(targetAgentType)) {
            return targetAgentType;
        }

        JSONObject commandPayload = message.getJSONObject("command_payload");
        JSONObject header = commandPayload != null ? commandPayload.getJSONObject("header") : null;
        return header != null ? header.getString("target_agent_type") : null;
    }

    private String resolveUserCode(JSONObject message, String targetAgentType) {
        String userCode = message.getString("user_code");
        if (StringUtils.isNotBlank(userCode)) {
            return userCode;
        }

        JSONObject commandPayload = message.getJSONObject("command_payload");
        JSONObject header = commandPayload != null ? commandPayload.getJSONObject("header") : null;
        userCode = header != null ? header.getString("user_code") : null;
        if (StringUtils.isNotBlank(userCode)) {
            return userCode;
        }

        String exePrefix = WorkerAgentType.BYCLAW_EXE.getCode() + "_";
        if (StringUtils.startsWith(targetAgentType, exePrefix)) {
            return StringUtils.substringAfter(targetAgentType, exePrefix);
        }
        String codePrefix = WorkerAgentType.BYCLAW_CODE.getCode() + "_";
        if (StringUtils.startsWith(targetAgentType, codePrefix)) {
            return StringUtils.substringAfter(targetAgentType, codePrefix);
        }
        return null;
    }

    private boolean isDefaultSandboxTarget(String targetAgentType, String userCode) {
        if (StringUtils.isAnyBlank(targetAgentType, userCode)) {
            return false;
        }
        return StringUtils.equals(targetAgentType, WorkerAgentType.BYCLAW_EXE.getCode() + "_" + userCode)
            || StringUtils.equals(targetAgentType, WorkerAgentType.BYCLAW_CODE.getCode() + "_" + userCode);
    }
}
