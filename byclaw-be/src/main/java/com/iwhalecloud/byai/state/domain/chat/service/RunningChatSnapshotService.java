package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Date;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.List;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.TypeReference;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RunningChatSnapshotService {

    private static final String KEY_PREFIX = "byai:chat:running:snapshot:";

    private static final long SNAPSHOT_TTL_SECONDS = 30 * 60L;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public void save(ChatProcessContext ctx) {
        save(ctx, ctx == null ? null : ctx.traceId, ctx == null ? null : ctx.messageContext);
    }

    public void save(ChatProcessContext ctx, String traceId, MessageContext messageContext) {
        if (ctx == null || ctx.sessionId == null || messageContext == null) {
            return;
        }
        String snapshotTraceId = StringUtils.defaultIfBlank(traceId, ctx.traceId);
        Long modelAnswerMessageId = resolveSnapshotMessageId(ctx, snapshotTraceId, messageContext);
        if (modelAnswerMessageId == null || StringUtils.isBlank(snapshotTraceId)) {
            return;
        }

        try {
            RunningChatSnapshotResponse snapshot = buildSnapshot(ctx, snapshotTraceId, messageContext,
                modelAnswerMessageId, resolveSnapshotClientRequestId(ctx, snapshotTraceId));
            redisTemplate.opsForValue().set(buildKey(ctx.sessionId, snapshotTraceId, modelAnswerMessageId),
                JSON.toJSONString(snapshot), SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
        }
        catch (Exception e) {
            log.warn("保存运行中会话快照失败, sessionId: {}, traceId: {}", ctx.sessionId, snapshotTraceId, e);
        }
    }

    public RunningChatSnapshotResponse get(Long sessionId, String traceId, Long modelAnswerMessageId) {
        if (sessionId == null) {
            return null;
        }

        String value = null;
        if (StringUtils.isNotBlank(traceId) || modelAnswerMessageId != null) {
            value = (String) redisTemplate.opsForValue().get(buildKey(sessionId, traceId, modelAnswerMessageId));
            if (StringUtils.isBlank(value) && modelAnswerMessageId != null) {
                String key = findKeyByMessageId(modelAnswerMessageId);
                value = key == null ? null : (String) redisTemplate.opsForValue().get(key);
            }
        }
        else {
            value = findBySession(sessionId);
        }
        if (StringUtils.isBlank(value)) {
            return null;
        }

        try {
            return JSON.parseObject(value, RunningChatSnapshotResponse.class);
        }
        catch (Exception e) {
            log.warn("解析运行中会话快照失败, sessionId: {}, traceId: {}", sessionId, traceId, e);
            return null;
        }
    }

    public MessageContext hydrateMessageContext(ChatRuntimeState state) {
        return hydrateMessageContext(state, null);
    }

    /**
     * 从快照重建 {@link MessageContext}。
     *
     * @param watermarkHolder 非空时，将快照已聚合到的最后一条 Stream 消息 ID（水位线）写入其 index 0，
     *                        供续聚合时跳过已计入的事件，避免重复拼接。
     */
    public MessageContext hydrateMessageContext(ChatRuntimeState state, String[] watermarkHolder) {
        if (state == null || state.getSessionId() == null) {
            return null;
        }
        try {
            RunningChatSnapshotResponse snapshot = get(state.getSessionId(), state.getTraceId(),
                state.getModelAnswerMessageId());
            if (snapshot == null) {
                return null;
            }
            if (watermarkHolder != null && watermarkHolder.length > 0) {
                watermarkHolder[0] = snapshot.getSnapshotStreamId();
            }
            MessageContext messageContext = new MessageContext(
                AgentTypeEnum.getNameCode(
                    state.getAssistantChatDto() == null ? null : state.getAssistantChatDto().getAgentType()),
                state.getModelAnswerMessageId(),
                snapshot.getTaskId() == null ? state.getTaskId() : snapshot.getTaskId());
            messageContext.setAnswerText(new StringBuilder(StringUtils.defaultString(snapshot.getMessageContent())));
            messageContext.setResComIds(snapshot.getResComIds());
            messageContext.setMsgStatus(snapshot.getMsgStatus());
            if (StringUtils.isNotBlank(snapshot.getMessageStruct())) {
                messageContext.setAnswerMessageList(JSON.parseArray(snapshot.getMessageStruct(), AnswerDelta.class));
                if (CollectionUtils.isNotEmpty(messageContext.getAnswerMessageList())) {
                    List<StringBuilder> textList = Lists.newArrayList();
                    messageContext.getAnswerMessageList().forEach(message -> textList.add(new StringBuilder(message.getChoices().get(0).getDelta().getContent())));
                    messageContext.setAnswerList(textList);
                }
            }
            if (StringUtils.isNotBlank(snapshot.getInferLog())) {
                messageContext.setReasonMessageList(JSON.parseArray(snapshot.getInferLog(), AnswerDelta.class));
                if (CollectionUtils.isNotEmpty(messageContext.getReasonMessageList())) {
                    List<StringBuilder> textList = Lists.newArrayList();
                    messageContext.getReasonMessageList().forEach(message -> textList.add(new StringBuilder(message.getChoices().get(0).getDelta().getContent())));
                    messageContext.setReasonList(textList);
                }
            }
            messageContext.restoreSegmentCursor();
            if (StringUtils.isNotBlank(snapshot.getRelatedResources())) {
                MessageResourceDto resourceDto = JSON.parseObject(snapshot.getRelatedResources(),
                    new TypeReference<MessageResourceDto>() {});
                if (resourceDto != null && resourceDto.getResources() != null) {
                    messageContext.setChatRelatedResource(resourceDto.getResources());
                }
            }
            return messageContext;
        }
        catch (Exception e) {
            log.warn("恢复运行中 MessageContext 失败, sessionId: {}, traceId: {}", state.getSessionId(),
                state.getTraceId(), e);
            return null;
        }
    }

    public void touch(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null || StringUtils.isBlank(ctx.traceId)) {
            return;
        }
        redisTemplate.expire(buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId), SNAPSHOT_TTL_SECONDS,
            TimeUnit.SECONDS);
    }

    public void delete(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null || StringUtils.isBlank(ctx.traceId)) {
            return;
        }
        redisTemplate.delete(buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId));
    }

    /**
     * 按本轮回答归属删除快照。
     * <p>
     * 快照承载恢复时重建已聚合内容的能力，因此 {@code modelAnswerMessageId} 为空（调用方无法识别
     * 具体是哪一轮回答）时不做任何删除，避免把仍待恢复的会话内容一并清空。
     *
     * @param sessionId 会话 ID
     * @param modelAnswerMessageId 本次停止对应的回答消息 ID，为空表示归属未知
     */
    public void delete(Long sessionId, Long modelAnswerMessageId) {
        if (sessionId == null || modelAnswerMessageId == null) {
            return;
        }
        deleteBySession(sessionId, modelAnswerMessageId);
    }

    /**
     * 根据 messageId 在所有运行中的快照里定位匹配的快照。
     *
     * @param messageId 消息ID（即 modelAnswerMessageId）
     * @return 命中的快照，未命中返回 null
     */
    public RunningChatSnapshotResponse findByMessageId(Long messageId) {
        if (messageId == null) {
            return null;
        }
        String key = findKeyByMessageId(messageId);
        if (key == null) {
            return null;
        }
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return JSON.parseObject(value, RunningChatSnapshotResponse.class);
        }
        catch (Exception e) {
            log.warn("解析运行中会话快照失败, key: {}", key, e);
            return null;
        }
    }

    /**
     * 将更新后的快照写回 Redis 并保留 TTL。 优先使用 (sessionId, traceId / modelAnswerMessageId) 直接拼 key（O(1)）； 拿不到时回退到全量扫描。
     *
     * @param snapshot 待写回的快照
     * @return 是否写回成功
     */
    public boolean updateSnapshot(RunningChatSnapshotResponse snapshot) {
        if (snapshot == null || snapshot.getSessionId() == null || snapshot.getModelAnswerMessageId() == null) {
            return false;
        }
        String key = resolveKey(snapshot.getSessionId(), snapshot.getTraceId(), snapshot.getModelAnswerMessageId());
        if (key == null) {
            return false;
        }
        try {
            Long ttl = redisTemplate.getExpire(key, TimeUnit.SECONDS);
            long expire = (ttl != null && ttl > 0) ? ttl : SNAPSHOT_TTL_SECONDS;
            redisTemplate.opsForValue().set(key, JSON.toJSONString(snapshot), expire, TimeUnit.SECONDS);
            return true;
        }
        catch (Exception e) {
            log.warn("更新运行中会话快照失败, sessionId: {}, messageId: {}", snapshot.getSessionId(),
                snapshot.getModelAnswerMessageId(), e);
            return false;
        }
    }

    /**
     * 优先按精确 key 命中，回退到按 messageId 全量扫描。
     */
    private String resolveKey(Long sessionId, String traceId, Long messageId) {
        if (sessionId != null && (StringUtils.isNotBlank(traceId) || messageId != null)) {
            String preciseKey = buildKey(sessionId, traceId, messageId);
            Boolean exists = redisTemplate.hasKey(preciseKey);
            if (Boolean.TRUE.equals(exists)) {
                return preciseKey;
            }
        }
        return findKeyByMessageId(messageId);
    }

    private String findKeyByMessageId(Long messageId) {
        if (messageId == null) {
            return null;
        }
        String pattern = KEY_PREFIX + "*";
        try {
            Set<String> keys = redisTemplate.keys(pattern);
            if (keys == null || keys.isEmpty()) {
                return null;
            }
            return keys.stream().filter(key -> isSameMessage(key, messageId)).findFirst().orElse(null);
        }
        catch (Exception e) {
            log.warn("按 messageId 查询运行中会话快照失败, messageId: {}", messageId, e);
            return null;
        }
    }

    private RunningChatSnapshotResponse buildSnapshot(ChatProcessContext ctx) {
        return buildSnapshot(ctx, ctx.traceId, ctx.messageContext, ctx.modelAnswerMessageId, ctx.clientRequestId);
    }

    private RunningChatSnapshotResponse buildSnapshot(ChatProcessContext ctx, String traceId,
        MessageContext messageContext, Long modelAnswerMessageId, String clientRequestId) {
        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        snapshot.setRunning(true);
        snapshot.setTraceId(traceId);
        snapshot.setClientRequestId(clientRequestId);
        snapshot.setModelAnswerMessageId(modelAnswerMessageId);
        // 持久化水位线取 max，保证单调不退：recovery 重投递旧 pending 时不会把水位线拉低，
        // 避免下次重启后已聚合区间被重复 append。
        snapshot.setSnapshotStreamId(StreamIdUtil.max(ctx.currentStreamId, ctx.hydratedStreamId, ctx.currentStreamId));
        snapshot.setMessageId(modelAnswerMessageId);
        snapshot.setSessionId(ctx.sessionId);
        snapshot.setTaskId(ctx.taskId);
        snapshot.setUsage(ChatUseageEnum.SYSTEM_RESPONSE.getCode());
        snapshot.setCreatorId(ctx.userId);
        snapshot.setMetadata(messageContext.getAnswerMessageList().stream().anyMatch(item -> item.getSeq() != null)
            || messageContext.getReasonMessageList().stream().anyMatch(item -> item.getSeq() != null)
                ? withV2RenderMetadata(ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getMetadata())
                : ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getMetadata());
        snapshot.setCreateTime(
            messageContext.getFirstResponseTime() == null ? new Date() : messageContext.getFirstResponseTime());
        snapshot.setMessageContent(messageContext.returnAnswerText());
        snapshot.setResComIds(messageContext.getResComIds());
        snapshot.setMsgStatus(MsgStatus.APPEND.getCode());
        snapshot.setAccessTerminal(ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getAccessTerminal());

        if (CollectionUtils.isNotEmpty(messageContext.getAnswerMessageList())) {
            snapshot.setMessageStruct(JSON.toJSONString(messageContext.getAnswerMessageList()));
        }
        if (CollectionUtils.isNotEmpty(messageContext.getReasonMessageList())) {
            snapshot.setInferLog(JSON.toJSONString(messageContext.getReasonMessageList()));
        }

        MessageResourceDto messageResourceDto = new MessageResourceDto();
        messageResourceDto.setResources(messageContext.getChatRelatedResource());
        snapshot.setRelatedResources(JSON.toJSONString(messageResourceDto));
        return snapshot;
    }

    private String withV2RenderMetadata(String metadata) {
        JSONObject value;
        try {
            value = StringUtils.isBlank(metadata) ? new JSONObject() : JSON.parseObject(metadata);
        }
        catch (Exception e) {
            value = new JSONObject();
        }
        value.put("messageRenderVersion", "v2");
        return value.toJSONString();
    }

    private Long resolveSnapshotMessageId(ChatProcessContext ctx, String traceId, MessageContext messageContext) {
        if (StringUtils.isNotBlank(traceId)) {
            try {
                return TraceIdCodec.decode(traceId).getModelAnswerMessageId();
            }
            catch (Exception ignored) {
                // 非 TraceIdCodec 编码的历史 traceId，继续使用上下文兜底。
            }
        }
        if (messageContext != null && messageContext.getMessageId() != null) {
            return messageContext.getMessageId();
        }
        return ctx == null ? null : ctx.modelAnswerMessageId;
    }

    private String resolveSnapshotClientRequestId(ChatProcessContext ctx, String traceId) {
        if (ctx != null && StringUtils.isNotBlank(traceId)) {
            JSONObject laneMetadata = ctx.getMultiAgentLaneMetadata(traceId);
            if (laneMetadata != null) {
                String laneClientRequestId = laneMetadata.getString("clientRequestId");
                if (StringUtils.isNotBlank(laneClientRequestId)) {
                    return laneClientRequestId;
                }
            }
        }
        return ctx == null ? null : ctx.clientRequestId;
    }

    private String findBySession(Long sessionId) {
        String pattern = KEY_PREFIX + sessionId + ":*";
        try {
            Set<String> keys = redisTemplate.keys(pattern);
            if (keys == null || keys.isEmpty()) {
                return null;
            }
            return keys.stream()
                .findFirst()
                .map(key -> (String) redisTemplate.opsForValue().get(key))
                .orElse(null);
        }
        catch (Exception e) {
            log.warn("按 session 查询运行中会话快照失败, sessionId: {}", sessionId, e);
            return null;
        }
    }

    private void deleteBySession(Long sessionId, Long modelAnswerMessageId) {
        String pattern = KEY_PREFIX + sessionId + ":*";
        try {
            Set<String> keys = redisTemplate.keys(pattern);
            if (keys == null || keys.isEmpty()) {
                return;
            }
            keys.stream()
                .filter(key -> isSameMessage(key, modelAnswerMessageId))
                .forEach(redisTemplate::delete);
        }
        catch (Exception e) {
            log.warn("删除运行中会话快照失败, sessionId: {}", sessionId, e);
        }
    }

    private boolean isSameMessage(String key, Long modelAnswerMessageId) {
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return false;
        }
        try {
            RunningChatSnapshotResponse snapshot = JSON.parseObject(value, RunningChatSnapshotResponse.class);
            return modelAnswerMessageId.equals(snapshot.getModelAnswerMessageId());
        }
        catch (Exception e) {
            log.warn("解析运行中会话快照失败, key: {}", key, e);
            return false;
        }
    }

    private String buildKey(Long sessionId, String traceId, Long modelAnswerMessageId) {
        if (StringUtils.isNotBlank(traceId)) {
            return KEY_PREFIX + sessionId + ":" + traceId;
        }
        return KEY_PREFIX + sessionId + ":" + modelAnswerMessageId;
    }
}
