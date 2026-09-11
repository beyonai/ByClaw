package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhaleai.byai.framework.common.Constants;

/**
 * 群聊专用 Gateway Stream 路由器。它不创建普通聊天上下文，只把事件交给群聊最终正文处理器。
 */
@Service
public class GroupChatStreamRouter {
    private static final String CONSUMER_GROUP = "byclaw_group_chat_execution";
    private static final String CONSUMER_NAME = "group-chat-router";
    private final RedisTemplate<String, Object> redisTemplate;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final GroupChatExecutionEventHandler eventHandler;
    private final Map<String, String> offsets = new ConcurrentHashMap<>();

    public GroupChatStreamRouter(RedisTemplate<String, Object> redisTemplate,
        ByaiGroupChatExecutionMapper executionMapper, GroupChatExecutionEventHandler eventHandler) {
        this.redisTemplate = redisTemplate;
        this.executionMapper = executionMapper;
        this.eventHandler = eventHandler;
    }

    @Scheduled(fixedDelayString = "${byclaw.group-chat.stream-poll-ms:500}")
    public void pollRunningExecutions() {
        for (ByaiGroupChatExecution execution : executionMapper.selectRunningExecutions()) {
            poll(execution);
        }
    }

    public void poll(ByaiGroupChatExecution execution) {
        if (execution == null || execution.getGatewaySessionId() == null) {
            return;
        }
        if (execution.getDisposition() == null || "UNKNOWN".equals(execution.getDisposition())) {
            JSONObject observation = new JSONObject();
            observation.put("event_type", "_dispositionPoll");
            eventHandler.handle(execution.getExecutionId(), execution.getGroupSessionId(),
                execution.getSourceMessageId(), execution.getReplyToMessageId(), execution.getTargetAgentId(),
                observation);
        }
        String key = Constants.QueueNames.sessionDataStream(execution.getGatewaySessionId());
        ensureConsumerGroup(key);
        var records = redisTemplate.opsForStream().read(
            Consumer.from(CONSUMER_GROUP, CONSUMER_NAME),
            StreamReadOptions.empty().count(50).block(Duration.ZERO),
            StreamOffset.create(key, ReadOffset.lastConsumed()));
        if (records == null) {
            return;
        }
        for (MapRecord<String, Object, Object> record : records) {
            offsets.put(key, record.getId().getValue());
            Object raw = record.getValue().get("data");
            if (raw == null) {
                continue;
            }
            JSONObject event = JSON.parseObject(String.valueOf(raw));
            // 保留 Redis 原始 ID 供终止事件日志定位，不覆盖上游事件标识。
            event.put("redis_stream_id", record.getId().getValue());
            event.put("executionId", execution.getExecutionId());
            event.put("initiatorUserId", execution.getInitiatorUserId());
            event.put("rootMessageId", execution.getRootMessageId());
            eventHandler.handle(execution.getExecutionId(), execution.getGroupSessionId(),
                execution.getSourceMessageId(), execution.getReplyToMessageId(), execution.getTargetAgentId(), event);
            redisTemplate.opsForStream().acknowledge(key, CONSUMER_GROUP, record.getId());
        }
    }

    private void ensureConsumerGroup(String streamKey) {
        try {
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.from("0-0"), CONSUMER_GROUP);
        }
        catch (Exception ignored) {
            // Stream 或消费组已存在时继续消费。
        }
    }
}
