package com.iwhalecloud.byai.state.infrastructure.utils;

import java.util.Collection;
import java.util.Collections;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.alibaba.fastjson.JSON;
import com.iwhaleai.byai.framework.core.protocol.ActionType;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;

import lombok.extern.slf4j.Slf4j;

/**
 * askUserQuestion 恢复链路的脱敏诊断日志。
 *
 * <p>只记录路由字段、字段类型和长度，不记录用户回答、Token 或完整 metadata。</p>
 */
@Slf4j
public final class ResumeRoutingTraceLogger {

    private static final String LOG_MARKER = "[ASK_USER_QUESTION_RESUME_TRACE]";

    private ResumeRoutingTraceLogger() {
    }

    public static void logWebSocketIngress(AssistantChatDto request) {
        if (!isResume(request)) {
            return;
        }

        MetadataSnapshot metadata = parseMetadata(request.getMetadata());
        log.info("{} stage=WS_INGRESS traceId={} sessionId={} clientRequestId={} actionType={} "
                + "sourceAgentType={} metadataState={} metadataChars={} metadataKeyCount={} parentRunId={} "
                + "interactionId={} delegationId={} metadataParentMessageId={}",
            LOG_MARKER,
            request.getTraceId(),
            request.getSessionId(),
            request.getClientRequestId(),
            request.getActionType(),
            request.getSourceAgentType(),
            metadata.state,
            metadata.sourceChars,
            metadata.values.size(),
            metadataValue(metadata.values, "parent_run_id", "parentRunId"),
            metadataValue(metadata.values, "interaction_id", "interactionId"),
            metadataValue(metadata.values, "delegation_id", "delegationId"),
            metadataValue(metadata.values, "parentMessageId", "parent_message_id"));
    }

    public static void logRunningState(AssistantChatDto request, RunningChatInfo runningInfo) {
        if (!isResume(request)) {
            return;
        }

        boolean redisRunning = runningInfo != null && Boolean.TRUE.equals(runningInfo.getRunning());
        String runningTraceId = runningInfo == null ? null : runningInfo.getTraceId();
        boolean traceMatches = redisRunning
            && StringUtils.isNotBlank(request.getTraceId())
            && request.getTraceId().equals(runningTraceId);
        String decision;
        if (request.getSessionId() == null) {
            decision = "NO_SESSION";
        }
        else if (!redisRunning) {
            decision = "NOT_RUNNING_INIT_NEW_EVENT";
        }
        else if (traceMatches) {
            decision = "REUSE_RUNNING_TRACE";
        }
        else {
            decision = "REJECT_TRACE_MISMATCH";
        }

        log.info("{} stage=RUNNING_STATE traceId={} sessionId={} clientRequestId={} sourceAgentType={} "
                + "redisRunning={} runningTraceId={} traceMatches={} decision={}",
            LOG_MARKER,
            request.getTraceId(),
            request.getSessionId(),
            request.getClientRequestId(),
            request.getSourceAgentType(),
            redisRunning,
            runningTraceId,
            traceMatches,
            decision);
    }

    public static void logGatewayMetadataParseFailure(AssistantChatDto request,
                                                      String sessionId,
                                                      String traceId,
                                                      String rawMetadata,
                                                      RuntimeException error) {
        if (!isResume(request)) {
            return;
        }

        log.warn("{} stage=GATEWAY_METADATA_PARSE_FAILED traceId={} requestTraceId={} sessionId={} "
                + "clientRequestId={} metadataChars={} errorType={}",
            LOG_MARKER,
            traceId,
            request.getTraceId(),
            sessionId,
            request.getClientRequestId(),
            rawMetadata == null ? 0 : rawMetadata.length(),
            error.getClass().getSimpleName());
    }

    public static void logGatewayEgress(AssistantChatDto request,
                                        String sessionId,
                                        String traceId,
                                        String targetAgentType,
                                        String answerMessageId,
                                        String headerParentMessageId,
                                        Object content,
                                        Map<String, Object> payload,
                                        Map<String, Object> metadata,
                                        int attempt) {
        if (!isResume(request)) {
            return;
        }

        Map<String, Object> safePayload = payload == null ? Collections.emptyMap() : payload;
        Map<String, Object> safeMetadata = metadata == null ? Collections.emptyMap() : metadata;
        Object replyData = metadataValue(safePayload, "reply_data", "replyData");
        log.info("{} stage=GATEWAY_EGRESS traceId={} requestTraceId={} sessionId={} clientRequestId={} "
                + "actionType={} requestSourceAgentType={} targetAgentType={} answerMessageId={} "
                + "headerParentMessageId={} status={} contentType={} contentChars={} replyDataType={} "
                + "replyDataChars={} metadataKeyCount={} parentRunId={} interactionId={} delegationId={} "
                + "metadataParentMessageId={} attempt={}",
            LOG_MARKER,
            traceId,
            request.getTraceId(),
            sessionId,
            request.getClientRequestId(),
            request.getActionType(),
            request.getSourceAgentType(),
            targetAgentType,
            answerMessageId,
            headerParentMessageId,
            metadataValue(safePayload, "status"),
            valueType(content),
            stringLength(content),
            valueType(replyData),
            stringLength(replyData),
            safeMetadata.size(),
            metadataValue(safeMetadata, "parent_run_id", "parentRunId"),
            metadataValue(safeMetadata, "interaction_id", "interactionId"),
            metadataValue(safeMetadata, "delegation_id", "delegationId"),
            metadataValue(safeMetadata, "parentMessageId", "parent_message_id"),
            attempt);
    }

    private static boolean isResume(AssistantChatDto request) {
        return request != null && ActionType.RESUME.equalsIgnoreCase(request.getActionType());
    }

    @SuppressWarnings("unchecked")
    private static MetadataSnapshot parseMetadata(String rawMetadata) {
        if (StringUtils.isBlank(rawMetadata)) {
            return new MetadataSnapshot("ABSENT", 0, Collections.emptyMap());
        }
        try {
            Map<String, Object> values = JSON.parseObject(rawMetadata, Map.class);
            return new MetadataSnapshot("VALID", rawMetadata.length(),
                values == null ? Collections.emptyMap() : values);
        }
        catch (RuntimeException error) {
            return new MetadataSnapshot("INVALID_" + error.getClass().getSimpleName(), rawMetadata.length(),
                Collections.emptyMap());
        }
    }

    private static Object metadataValue(Map<String, Object> values, String... names) {
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            for (String name : names) {
                if (name.equalsIgnoreCase(entry.getKey())) {
                    return entry.getValue();
                }
            }
        }
        return null;
    }

    private static String valueType(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof String) {
            return "string";
        }
        if (value instanceof Collection || value.getClass().isArray()) {
            return "array";
        }
        if (value instanceof Map) {
            return "object";
        }
        return value.getClass().getSimpleName();
    }

    private static Integer stringLength(Object value) {
        return value instanceof String ? ((String) value).length() : null;
    }

    private static final class MetadataSnapshot {

        private final String state;
        private final int sourceChars;
        private final Map<String, Object> values;

        private MetadataSnapshot(String state, int sourceChars, Map<String, Object> values) {
            this.state = state;
            this.sourceChars = sourceChars;
            this.values = values;
        }
    }
}
