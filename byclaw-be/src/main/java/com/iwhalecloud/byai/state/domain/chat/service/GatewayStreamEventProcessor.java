package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class GatewayStreamEventProcessor {

    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    private final Map<String, HistoryBatch> historyBatchMap = new ConcurrentHashMap<>();

    /**
     * @return true 表示该事件已经作为历史事件处理/跳过，调用方不应继续推送给当前请求。
     */
    public boolean handleHistoryEventIfNecessary(ChatProcessContext ctx, JSONObject dataJson) {
        String receivedTraceId = dataJson == null ? null : dataJson.getString("trace_id");
        if (StringUtils.isBlank(receivedTraceId)) {
            return true;
        }
        if (receivedTraceId.equals(ctx.traceId)) {
            return false;
        }
        if (!TraceIdCodec.canDecode(receivedTraceId)) {
            return true;
        }

        String eventType = normalizeEventType(ctx, dataJson);
        if (shouldIgnoreEvent(ctx, eventType, dataJson)) {
            return true;
        }

        HistoryBatch batch = historyBatchMap.computeIfAbsent(buildHistoryKey(ctx.sessionId, receivedTraceId),
            key -> createHistoryBatch(ctx, receivedTraceId));
        if (batch == null) {
            return true;
        }

        JSONObject metadata = dataJson.getJSONObject("metadata");
        String eventData = buildEventData(ctx, dataJson, metadata);
        JSONObject lineJson = new JSONObject();
        lineJson.put("event", eventType);
        lineJson.put("data", eventData);
        pythonSseService.accumulateEvent(lineJson.toJSONString(), batch.messageContext);

        if (SseResponseEventEnum.error.equals(eventType) || SseResponseEventEnum.appStreamResponse.equals(eventType)) {
            batch.messageContext.setComplete(true);
            try {
                storeHistoryBatch(ctx, batch);
                log.info("历史批次入库处理完成, traceId: {}, sessionId: {}", receivedTraceId, ctx.sessionId);
            }
            catch (Exception e) {
                log.error("历史批次入库处理失败, traceId: {}, sessionId: {}", receivedTraceId, ctx.sessionId, e);
            }
            finally {
                historyBatchMap.remove(buildHistoryKey(ctx.sessionId, receivedTraceId));
            }
        }
        return true;
    }

    public String buildEventData(ChatProcessContext ctx, JSONObject dataJson, JSONObject metadata) {
        String eventData = dataJson.getString("data");
        String sourceAgentType = dataJson.getString("source_agent_type");
        String traceId = dataJson.getString("trace_id");
        String streamId = dataJson.getString("stream_id");
        String sessionId = String.valueOf(ctx.sessionId);
        String userMessageId = String.valueOf(ctx.userMessageId);
        if (eventData == null) {
            JSONObject eventPayload = new JSONObject(dataJson);
            eventPayload.remove("event_type");
            eventPayload.remove("session_id");
            eventPayload.remove("stream_id");
            eventPayload.put("sessionId", sessionId);
            eventPayload.put("streamId", streamId);
            if (metadata != null && !metadata.isEmpty()) {
                eventPayload.put("metadata", metadata.toJSONString());
            }
            return eventPayload.toJSONString();
        }
        try {
            JSONObject dataObj = JSON.parseObject(eventData);
            if (dataObj != null) {
                dataObj.put("sourceAgentType", sourceAgentType);
                dataObj.put("sessionId", sessionId);
                dataObj.put("traceId", traceId);
                dataObj.put("streamId", streamId);
                if (metadata != null && !metadata.isEmpty()) {
                    dataObj.put("metadata", metadata.toJSONString());
                }
                if (StringUtils.isNotBlank(dataObj.getString("parentOrderId"))
                    && dataObj.getString("parentOrderId").equals(userMessageId)) {
                    dataObj.put("parentOrderId", "-1");
                }
                return dataObj.toJSONString();
            }
            return eventData;
        }
        catch (Exception e) {
            return eventData;
        }
    }

    public String normalizeEventType(ChatProcessContext ctx, JSONObject dataJson) {
        String eventType = dataJson.getString("event_type");
        String sourceAgentType = dataJson.getString("source_agent_type");
        String targetAgentType = StringUtils.defaultIfBlank(ctx.targetAgentType,
            MapParamUtil.getStringValue(ctx.getParams(), "worker_agent_type"));
        if (StringUtils.isNotBlank(sourceAgentType) && StringUtils.isNotBlank(targetAgentType)
            && !sourceAgentType.equals(targetAgentType) && SseResponseEventEnum.answerDelta.equals(eventType)) {
            return SseResponseEventEnum.reasoningLogDelta;
        }
        return eventType;
    }

    public boolean shouldIgnoreEvent(ChatProcessContext ctx, String eventType, JSONObject dataJson) {
        String sourceAgentType = dataJson.getString("source_agent_type");
        String targetAgentType = StringUtils.defaultIfBlank(ctx.targetAgentType,
            MapParamUtil.getStringValue(ctx.getParams(), "worker_agent_type"));
        return StringUtils.isNotBlank(sourceAgentType) && StringUtils.isNotBlank(targetAgentType)
            && !sourceAgentType.equals(targetAgentType) && SseResponseEventEnum.appStreamResponse.equals(eventType);
    }

    private HistoryBatch createHistoryBatch(ChatProcessContext ctx, String traceId) {
        try {
            TraceIdCodec.TraceMessageIds messageIds = TraceIdCodec.decode(traceId);
            Long historyUserMessageId = messageIds.getUserMessageId();
            Long historyModelAnswerMessageId = messageIds.getModelAnswerMessageId();
            Long taskId = resolveHistoryTaskId(historyUserMessageId);
            MessageContext historyMsgCtx = new MessageContext(
                AgentTypeEnum.getNameCode(ctx.assistantChatDto.getAgentType()),
                historyModelAnswerMessageId,
                taskId == null ? sequenceService.nextVal() : taskId);
            log.info("发现历史 traceId: {}, 创建历史批次上下文, sessionId: {}", traceId, ctx.sessionId);
            return new HistoryBatch(traceId, historyUserMessageId, historyModelAnswerMessageId, historyMsgCtx);
        }
        catch (Exception e) {
            log.warn("历史 traceId 解析失败, sessionId: {}, traceId: {}", ctx.sessionId, traceId, e);
            return null;
        }
    }

    private Long resolveHistoryTaskId(Long historyUserMessageId) {
        ByaiMessageHotDto userMessage = byaiMessageHotService.findById(historyUserMessageId);
        return userMessage == null ? null : userMessage.getTaskId();
    }

    private void storeHistoryBatch(ChatProcessContext currentCtx, HistoryBatch batch) {
        ByaiMessageHotDto existingAnswer = byaiMessageHotService.findById(batch.modelAnswerMessageId);
        boolean shouldUpdateExisting = shouldUpdateExistingHistory(currentCtx, batch.modelAnswerMessageId);
        if (existingAnswer != null && !shouldUpdateExisting) {
            log.info("历史批次目标消息已存在，跳过重复入库, sessionId: {}, traceId: {}, messageId: {}",
                currentCtx.sessionId, batch.traceId, batch.modelAnswerMessageId);
            return;
        }

        AssistantChatDto historyDto = new AssistantChatDto();
        BeanUtils.copyProperties(currentCtx.assistantChatDto, historyDto);
        if (!shouldUpdateExisting) {
            historyDto.setTaskOperateType(null);
        }

        ChatProcessContext tempCtx = new ChatProcessContext(null, historyDto);
        tempCtx.sessionId = currentCtx.sessionId;
        tempCtx.userMessageId = batch.userMessageId;
        tempCtx.modelAnswerMessageId = batch.modelAnswerMessageId;
        tempCtx.traceId = batch.traceId;
        tempCtx.taskId = batch.messageContext.getTaskId();
        tempCtx.userId = currentCtx.userId;
        tempCtx.loginInfo = currentCtx.loginInfo;
        tempCtx.taskHistoryMessages = shouldUpdateExisting ? currentCtx.taskHistoryMessages : null;
        tempCtx.askMsg = currentCtx.askMsg;

        ScriptService scriptService = ApplicationContextUtil.getBean(ScriptService.class);
        try {
            if (tempCtx.loginInfo != null) {
                CurrentUserHolder.setLoginInfo(tempCtx.loginInfo);
            }
            scriptService.resolveMemory(tempCtx, historyDto, currentCtx.sessionId, batch.messageContext,
                new ByaiMessageHotDtoDto());
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
        }
    }

    private boolean shouldUpdateExistingHistory(ChatProcessContext currentCtx, Long modelAnswerMessageId) {
        if (currentCtx == null || currentCtx.assistantChatDto == null || modelAnswerMessageId == null
            || currentCtx.taskHistoryMessages == null || currentCtx.taskHistoryMessages.size() < 2) {
            return false;
        }
        TaskOperateTypeEnum taskOperateType = currentCtx.assistantChatDto.getTaskOperateType();
        boolean isTaskUpdate = TaskOperateTypeEnum.UPDATE.equals(taskOperateType)
            || TaskOperateTypeEnum.RERUN.equals(taskOperateType)
            || TaskOperateTypeEnum.FEEDBACK.equals(taskOperateType);
        return isTaskUpdate && modelAnswerMessageId.equals(currentCtx.taskHistoryMessages.get(1).getMessageId());
    }

    private String buildHistoryKey(Long sessionId, String traceId) {
        return sessionId + ":" + traceId;
    }

    private static class HistoryBatch {

        private final String traceId;

        private final Long userMessageId;

        private final Long modelAnswerMessageId;

        private final MessageContext messageContext;

        private HistoryBatch(String traceId, Long userMessageId, Long modelAnswerMessageId,
            MessageContext messageContext) {
            this.traceId = traceId;
            this.userMessageId = userMessageId;
            this.modelAnswerMessageId = modelAnswerMessageId;
            this.messageContext = messageContext;
        }
    }
}
