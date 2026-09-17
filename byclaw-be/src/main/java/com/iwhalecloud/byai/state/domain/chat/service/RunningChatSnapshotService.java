package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Date;
import java.util.ArrayList;
import java.util.concurrent.TimeUnit;
import java.util.List;
import java.util.function.Consumer;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.ZSetOperations.TypedTuple;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.stereotype.Service;
import org.springframework.beans.BeanUtils;

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
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RunningChatSnapshotService {

    private static final String KEY_PREFIX = "byai:chat:running:snapshot:";

    private static final String MESSAGE_INDEX_PREFIX = "byai:chat:running:message:";
    private static final String SESSION_INDEX_PREFIX = "byai:chat:running:session:";

    private static final long SNAPSHOT_TTL_SECONDS = 30 * 60L;

    private static final String EXTERNAL_CHILD_TRACE_PREFIX = "external-child-";

    private static final String SCOPED_PERSISTED_PREFIX = "byai:chat:scoped:persisted:";

    private static final String EXTERNAL_CHILD_INDEX = "byai:chat:running:external-child:index";

    static final int RECOVERY_BATCH_SIZE = 100;

    // Single-key script works in Redis Cluster. Limit cleanup work on the live consumption path.
    // Keep entries slightly longer than snapshots; a missing value is harmless during recovery.
    private static final DefaultRedisScript<Long> INDEX_EXTERNAL_CHILD = new DefaultRedisScript<>("""
        local time = redis.call('TIME')
        local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
        local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 16)
        if #expired > 0 then redis.call('ZREM', KEYS[1], unpack(expired)) end
        redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]) * 1000, ARGV[1])
        local ttl = redis.call('TTL', KEYS[1])
        if ttl < tonumber(ARGV[2]) then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
        return 1
        """, Long.class);

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
            String key = buildKey(ctx.sessionId, snapshotTraceId, modelAnswerMessageId);
            redisTemplate.opsForValue().set(key, JSON.toJSONString(snapshot), SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
            indexSnapshot(ctx.sessionId, modelAnswerMessageId, key, SNAPSHOT_TTL_SECONDS);
        }
        catch (Exception e) {
            log.warn("保存运行中会话快照失败, sessionId: {}, traceId: {}", ctx.sessionId, snapshotTraceId, e);
        }
    }

    /**
     * Save the newest complete external child-message projection before its WebSocket broadcast.
     *
     * <p>The snapshot is the reconnect baseline while the database write-behind queue may still be flushing.</p>
     */
    public boolean saveExternalChild(ByaiMessageHotDtoDto message, String streamId, boolean terminal) {
        if (message == null || message.getSessionId() == null || message.getMessageId() == null) {
            return false;
        }
        String traceId = externalChildTraceId(message.getSessionId());
        try {
            RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
            BeanUtils.copyProperties(message, snapshot);
            snapshot.setRunning(!terminal);
            snapshot.setTraceId(traceId);
            snapshot.setModelAnswerMessageId(message.getMessageId());
            snapshot.setSnapshotStreamId(streamId);
            snapshot.setMsgStatus(terminal ? MsgStatus.FINISH.getCode() : MsgStatus.APPEND.getCode());
            JSONObject metadata = JSON.parseObject(StringUtils.defaultString(message.getMetadata(), "{}"));
            snapshot.setChildRunId(StringUtils.trimToNull(metadata.getString("child_run_id")));
            snapshot.setChildTurn(metadata.getLong("child_turn"));
            indexSnapshot(message.getSessionId(), message.getMessageId(),
                buildKey(message.getSessionId(), traceId, message.getMessageId()), SNAPSHOT_TTL_SECONDS);
            saveIndexedExternalChild(buildKey(message.getSessionId(), traceId, message.getMessageId()),
                JSON.toJSONString(snapshot));
            return true;
        }
        catch (Exception e) {
            log.warn("保存外部子会话快照失败, sessionId: {}, messageId: {}", message.getSessionId(),
                message.getMessageId(), e);
            return false;
        }
    }

    private void saveIndexedExternalChild(String key, String value) {
        // Spring Data's Jedis Cluster connection does not support executePipelined.
        if (redisTemplate.getConnectionFactory() instanceof JedisConnectionFactory factory
                && factory.getClusterConfiguration() != null) {
            indexExternalChild(redisTemplate, key);
            redisTemplate.opsForValue().set(key, value, SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
            return;
        }
        redisTemplate.executePipelined(new SessionCallback<Object>() {
            @Override
            @SuppressWarnings("unchecked")
            public <K, V> Object execute(RedisOperations<K, V> operations) {
                RedisOperations<String, Object> redis = (RedisOperations<String, Object>) operations;
                indexExternalChild(redis, key);
                redis.opsForValue().set(key, value, SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
                return null;
            }
        });
    }

    private void indexExternalChild(RedisOperations<String, Object> redis, String key) {
        redis.execute(INDEX_EXTERNAL_CHILD, List.of(EXTERNAL_CHILD_INDEX), key,
            String.valueOf(SNAPSHOT_TTL_SECONDS + 60));
    }

    /** For callers needing a collected result; startup recovery uses the bounded batch overload. */
    public List<RunningChatSnapshotResponse> findExternalChildSnapshots() {
        List<RunningChatSnapshotResponse> snapshots = new ArrayList<>();
        findExternalChildSnapshots(snapshots::addAll);
        return snapshots;
    }

    /** Iterate only the dedicated index, never the Redis keyspace, including when the index is absent. */
    public void findExternalChildSnapshots(Consumer<List<RunningChatSnapshotResponse>> consumeBatch) {
        ScanOptions options = ScanOptions.scanOptions().count(RECOVERY_BATCH_SIZE).build();
        try (Cursor<TypedTuple<Object>> keys = redisTemplate.opsForZSet().scan(EXTERNAL_CHILD_INDEX, options)) {
            List<String> batch = new ArrayList<>(RECOVERY_BATCH_SIZE);
            while (keys.hasNext()) {
                if (Thread.currentThread().isInterrupted()) {
                    return;
                }
                batch.add((String) keys.next().getValue());
                // COUNT is a hint, so enforce the read/parse bound ourselves.
                if (batch.size() == RECOVERY_BATCH_SIZE) {
                    consumeBatch.accept(readExternalChildBatch(batch));
                    batch.clear();
                }
            }
            if (!batch.isEmpty() && !Thread.currentThread().isInterrupted()) {
                consumeBatch.accept(readExternalChildBatch(batch));
            }
        }
        catch (Exception e) {
            log.warn("恢复外部子会话持久化快照失败", e);
        }
    }

    private List<RunningChatSnapshotResponse> readExternalChildBatch(List<String> keys) {
        // Spring Data routes multiGet across slots in Jedis Cluster, unlike a cross-slot Lua script.
        List<Object> values = redisTemplate.opsForValue().multiGet(keys);
        List<RunningChatSnapshotResponse> snapshots = new ArrayList<>();
        if (values == null) {
            return snapshots;
        }
        for (int i = 0; i < values.size(); i++) {
            String value = (String) values.get(i);
            if (StringUtils.isBlank(value)) {
                continue;
            }
            try {
                RunningChatSnapshotResponse snapshot = JSON.parseObject(value, RunningChatSnapshotResponse.class);
                if (snapshot != null && snapshot.getSessionId() != null && snapshot.getMessageId() != null) {
                    snapshots.add(snapshot);
                }
            }
            catch (Exception e) {
                log.warn("解析外部子会话恢复快照失败, key: {}", keys.get(i), e);
            }
        }
        if (snapshots.isEmpty()) {
            return snapshots;
        }
        List<String> watermarkKeys = snapshots.stream()
            .map(snapshot -> scopedPersistedKey(snapshot.getSessionId(), snapshot.getMessageId())).toList();
        List<Object> watermarks = redisTemplate.opsForValue().multiGet(watermarkKeys);
        List<RunningChatSnapshotResponse> unpersisted = new ArrayList<>();
        for (int i = 0; i < snapshots.size(); i++) {
            RunningChatSnapshotResponse snapshot = snapshots.get(i);
            String watermark = watermarks == null ? null : (String) watermarks.get(i);
            if (!StreamIdUtil.isProcessedByWatermark(snapshot.getSnapshotStreamId(), watermark)) {
                unpersisted.add(snapshot);
            }
        }
        return unpersisted;
    }

    public boolean isExternalChildPersisted(ByaiMessageHotDtoDto message) {
        JSONObject metadata = JSON.parseObject(StringUtils.defaultString(message.getMetadata(), "{}"));
        String watermark = (String) redisTemplate.opsForValue().get(
            scopedPersistedKey(message.getSessionId(), message.getMessageId()));
        return StreamIdUtil.isProcessedByWatermark(metadata.getString("event_stream_id"), watermark);
    }

    public void markExternalChildPersisted(ByaiMessageHotDtoDto message) {
        if (message == null || message.getSessionId() == null || message.getMessageId() == null) {
            return;
        }
        try {
            JSONObject metadata = JSON.parseObject(StringUtils.defaultString(message.getMetadata(), "{}"));
            String streamId = metadata.getString("event_stream_id");
            if (StringUtils.isNotBlank(streamId)) {
                redisTemplate.opsForValue().set(scopedPersistedKey(message.getSessionId(), message.getMessageId()),
                    streamId, SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
            }
        }
        catch (Exception e) {
            log.warn("记录外部子会话已落库水位失败, sessionId: {}, messageId: {}", message.getSessionId(),
                message.getMessageId(), e);
        }
    }

    public static String externalChildTraceId(Long sessionId) {
        return EXTERNAL_CHILD_TRACE_PREFIX + sessionId;
    }

    public RunningChatSnapshotResponse getExternalChildSnapshot(Long sessionId, Long messageId) {
        if (sessionId == null) {
            return null;
        }
        // This key is deterministic even before the first event. A cache miss must not invoke KEYS.
        return get(sessionId, externalChildTraceId(sessionId), messageId);
    }

    private String scopedPersistedKey(Long sessionId, Long messageId) {
        return SCOPED_PERSISTED_PREFIX + sessionId + ":" + messageId;
    }

    public RunningChatSnapshotResponse get(Long sessionId, String traceId, Long modelAnswerMessageId) {
        if (sessionId == null) {
            return null;
        }

        String value = null;
        if (StringUtils.isNotBlank(traceId) || modelAnswerMessageId != null) {
            value = (String) redisTemplate.opsForValue().get(buildKey(sessionId, traceId, modelAnswerMessageId));
            // Both direct child reads and first-event context hydration use this deterministic trace.
            if (StringUtils.isBlank(value) && modelAnswerMessageId != null
                    && !externalChildTraceId(sessionId).equals(traceId)) {
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
            RunningChatSnapshotResponse snapshot = JSON.parseObject(value, RunningChatSnapshotResponse.class);
            return snapshot != null && sessionId.equals(snapshot.getSessionId())
                && (modelAnswerMessageId == null || modelAnswerMessageId.equals(snapshotMessageId(snapshot)))
                ? snapshot : null;
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
            return hydrateMessageContextFromSnapshot(state, snapshot, watermarkHolder);
        }
        catch (Exception e) {
            log.warn("恢复运行中 MessageContext 失败, sessionId: {}, traceId: {}", state.getSessionId(),
                state.getTraceId(), e);
            return null;
        }
    }

    /** Hydrate the already-read checkpoint; failures propagate so a durable baseline cannot become empty. */
    MessageContext hydrateMessageContextFromSnapshot(ChatRuntimeState state, RunningChatSnapshotResponse snapshot,
            String[] watermarkHolder) {
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
        messageContext.setComplete(Boolean.FALSE.equals(snapshot.getRunning())
            || MsgStatus.FINISH.getCode().equals(snapshot.getMsgStatus()));
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

    public void touch(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null || ctx.modelAnswerMessageId == null || StringUtils.isBlank(ctx.traceId)) {
            return;
        }
        redisTemplate.expire(buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId), SNAPSHOT_TTL_SECONDS,
            TimeUnit.SECONDS);
        redisTemplate.expire(MESSAGE_INDEX_PREFIX + ctx.modelAnswerMessageId, SNAPSHOT_TTL_SECONDS, TimeUnit.SECONDS);
        redisTemplate.execute(INDEX_EXTERNAL_CHILD, List.of(SESSION_INDEX_PREFIX + ctx.sessionId),
            buildKey(ctx.sessionId, ctx.traceId, ctx.modelAnswerMessageId), String.valueOf(SNAPSHOT_TTL_SECONDS + 60));
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
            RunningChatSnapshotResponse snapshot = JSON.parseObject(value, RunningChatSnapshotResponse.class);
            return snapshot != null && messageId.equals(snapshotMessageId(snapshot)) ? snapshot : null;
        }
        catch (Exception e) {
            log.warn("解析运行中会话快照失败, key: {}", key, e);
            return null;
        }
    }

    /**
     * 将更新后的快照写回 Redis 并保留 TTL。 优先使用 (sessionId, traceId / modelAnswerMessageId) 直接拼 key（O(1)）； 拿不到时查询 messageId 索引。
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
            indexSnapshot(snapshot.getSessionId(), snapshot.getModelAnswerMessageId(), key, expire);
            return true;
        }
        catch (Exception e) {
            log.warn("更新运行中会话快照失败, sessionId: {}, messageId: {}", snapshot.getSessionId(),
                snapshot.getModelAnswerMessageId(), e);
            return false;
        }
    }

    /**
     * 优先按精确 key 命中，回退到 messageId 精确索引。
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

    private Long snapshotMessageId(RunningChatSnapshotResponse snapshot) {
        return snapshot.getModelAnswerMessageId() == null ? snapshot.getMessageId() : snapshot.getModelAnswerMessageId();
    }

    private String findKeyByMessageId(Long messageId) {
        if (messageId == null) return null;
        return (String) redisTemplate.opsForValue().get(MESSAGE_INDEX_PREFIX + messageId);
    }

    private void indexSnapshot(Long sessionId, Long messageId, String key, long ttl) {
        redisTemplate.opsForValue().set(MESSAGE_INDEX_PREFIX + messageId, key, ttl, TimeUnit.SECONDS);
        redisTemplate.execute(INDEX_EXTERNAL_CHILD, List.of(SESSION_INDEX_PREFIX + sessionId), key,
            String.valueOf(ttl + 60));
    }

    private RunningChatSnapshotResponse buildSnapshot(ChatProcessContext ctx) {
        return buildSnapshot(ctx, ctx.traceId, ctx.messageContext, ctx.modelAnswerMessageId, ctx.clientRequestId);
    }

    private RunningChatSnapshotResponse buildSnapshot(ChatProcessContext ctx, String traceId,
        MessageContext messageContext, Long modelAnswerMessageId, String clientRequestId) {
        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        boolean complete = Boolean.TRUE.equals(messageContext.getComplete());
        snapshot.setRunning(!complete);
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
        snapshot.setMsgStatus(complete ? MsgStatus.FINISH.getCode() : MsgStatus.APPEND.getCode());
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
        // A session can have several running turns; a single latest-key pointer loses the others on deletion.
        try (Cursor<TypedTuple<Object>> cursor = redisTemplate.opsForZSet().scan(SESSION_INDEX_PREFIX + sessionId,
                ScanOptions.scanOptions().count(RECOVERY_BATCH_SIZE).build())) {
            List<String> keys = new ArrayList<>(RECOVERY_BATCH_SIZE);
            while (cursor.hasNext()) {
                keys.add((String) cursor.next().getValue());
                if (keys.size() == RECOVERY_BATCH_SIZE) {
                    String value = firstSessionSnapshot(sessionId, keys);
                    if (value != null) return value;
                    keys.clear();
                }
            }
            return keys.isEmpty() ? null : firstSessionSnapshot(sessionId, keys);
        }
        catch (Exception e) {
            log.warn("按 session 索引查询快照失败, sessionId: {}", sessionId, e);
            return null;
        }
    }

    private String firstSessionSnapshot(Long sessionId, List<String> keys) {
        List<Object> values = redisTemplate.opsForValue().multiGet(keys);
        if (values == null) return null;
        for (Object value : values) {
            if (!(value instanceof String json) || StringUtils.isBlank(json)) continue;
            try {
                RunningChatSnapshotResponse snapshot = JSON.parseObject(json, RunningChatSnapshotResponse.class);
                if (snapshot != null && sessionId.equals(snapshot.getSessionId())) return json;
            }
            catch (Exception ignored) {
                // Missing or malformed members cannot hide another running turn.
            }
        }
        return null;
    }

    private void deleteBySession(Long sessionId, Long modelAnswerMessageId) {
        String key = findKeyByMessageId(modelAnswerMessageId);
        // Index pointers may outlive their values. Validate ownership before deleting anything.
        if (key != null && key.startsWith(KEY_PREFIX + sessionId + ":") && isSameMessage(key, modelAnswerMessageId)) {
            redisTemplate.delete(key);
        }
    }

    private boolean isSameMessage(String key, Long modelAnswerMessageId) {
        String value = (String) redisTemplate.opsForValue().get(key);
        if (StringUtils.isBlank(value)) {
            return false;
        }
        try {
            RunningChatSnapshotResponse snapshot = JSON.parseObject(value, RunningChatSnapshotResponse.class);
            return modelAnswerMessageId.equals(snapshotMessageId(snapshot));
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
