package com.iwhalecloud.byai.state.domain.chat.service;

import java.net.InetAddress;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

/**
 * 常驻消费后台会话事件。
 * <p>
 * 这类事件不是由当前聊天请求触发，不依赖 session 是否正在运行，因此不能复用
 * {@link SessionStreamManager} 的按 session 动态监听器。
 */
@Component
public class SessionEventStreamListener
    implements StreamListener<String, MapRecord<String, String, String>>, ApplicationListener<ContextClosedEvent> {

    private static final Logger log = LoggerFactory.getLogger(SessionEventStreamListener.class);

    static final String DEFAULT_STREAM_KEY = "byai_gateway:session_event:data_stream";
    static final String DEFAULT_CONSUMER_GROUP = "byclaw_session_event_group";
    private static final String CONSUMER_NAME_PREFIX = "byclaw-session-event:";
    private static final String DEDUP_KEY_PREFIX = "byai_gateway:session_event:dedup:";
    private static final String INIT_EVENT_TYPE = "_init";
    private static final Duration DEDUP_TTL = Duration.ofDays(7);

    private final RedisConnectionFactory redisConnectionFactory;
    private final RedisTemplate<String, Object> redisTemplate;
    private final SessionStreamEventRouter sessionStreamEventRouter;

    @Value("${byclaw.session-event-stream.key:" + DEFAULT_STREAM_KEY + "}")
    private String streamKey;

    @Value("${byclaw.session-event-stream.consumer-group:" + DEFAULT_CONSUMER_GROUP + "}")
    private String consumerGroup;

    private StreamMessageListenerContainer<String, MapRecord<String, String, String>> container;

    public SessionEventStreamListener(RedisConnectionFactory redisConnectionFactory,
        RedisTemplate<String, Object> redisTemplate,
        SessionStreamEventRouter sessionStreamEventRouter) {
        this.redisConnectionFactory = redisConnectionFactory;
        this.redisTemplate = redisTemplate;
        this.sessionStreamEventRouter = sessionStreamEventRouter;
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (container != null) {
            return;
        }

        createConsumerGroupIfAbsent();
        StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
            StreamMessageListenerContainerOptions.builder()
                .pollTimeout(Duration.ofSeconds(2))
                .build();
        container = StreamMessageListenerContainer.create(redisConnectionFactory, options);
        container.receive(
            Consumer.from(consumerGroup, buildConsumerName()),
            StreamOffset.create(streamKey, ReadOffset.lastConsumed()),
            this
        );
        container.start();
        log.info("后台会话事件 Stream 监听已启动, streamKey={}, consumerGroup={}", streamKey, consumerGroup);
    }

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        JSONObject dataJson = parseMessage(message);
        if (dataJson == null) {
            acknowledge(message);
            return;
        }
        dataJson.put("stream_id", message.getId().getValue());

        String streamId = message.getId().getValue();
        String dedupKey = DEDUP_KEY_PREFIX + streamId;
        if (!tryAcquireDedup(dedupKey)) {
            log.info("后台会话事件已处理，跳过重复消费, streamKey={}, messageId={}",
                message.getStream(), streamId);
            acknowledge(message);
            return;
        }

        try {
            sessionStreamEventRouter.dispatchBackgroundAnswerMessage(dataJson);
            acknowledge(message);
        }
        catch (Exception e) {
            releaseDedup(dedupKey);
            log.error("处理后台会话事件失败，将保留 pending, streamKey={}, messageId={}",
                message.getStream(), streamId, e);
        }
    }

    @Override
    public synchronized void onApplicationEvent(ContextClosedEvent event) {
        if (container == null) {
            return;
        }
        try {
            container.stop();
            log.info("后台会话事件 Stream 监听已停止, streamKey={}", streamKey);
        }
        catch (Exception e) {
            log.warn("停止后台会话事件 Stream 监听异常, streamKey={}", streamKey, e);
        }
        finally {
            container = null;
        }
    }

    private JSONObject parseMessage(MapRecord<String, String, String> message) {
        String rawData = message.getValue().get("data");
        if (StringUtils.isBlank(rawData)) {
            log.warn("后台会话事件 data 字段为空, streamKey={}, messageId={}", message.getStream(), message.getId());
            return null;
        }
        try {
            return JSON.parseObject(rawData);
        }
        catch (Exception e) {
            log.warn("后台会话事件 data 字段解析失败, streamKey={}, messageId={}, raw={}",
                message.getStream(), message.getId(), rawData, e);
            return null;
        }
    }

    private boolean tryAcquireDedup(String dedupKey) {
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(dedupKey, "1", DEDUP_TTL);
        return Boolean.TRUE.equals(acquired);
    }

    private void releaseDedup(String dedupKey) {
        try {
            redisTemplate.delete(dedupKey);
        }
        catch (Exception e) {
            log.warn("释放后台会话事件幂等 key 失败, dedupKey={}", dedupKey, e);
        }
    }

    private void createConsumerGroupIfAbsent() {
        try {
            ensureStreamExists();
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.from("0-0"), consumerGroup);
            log.info("已创建后台会话事件 Stream 消费者组, streamKey={}, consumerGroup={}", streamKey, consumerGroup);
        }
        catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("BUSYGROUP")) {
                log.debug("后台会话事件 Stream 消费者组已存在, streamKey={}, consumerGroup={}", streamKey,
                    consumerGroup);
            }
            else {
                log.warn("创建后台会话事件 Stream 消费者组异常，将继续启动, streamKey={}, consumerGroup={}, reason={}",
                    streamKey, consumerGroup, e.getMessage());
            }
        }
    }

    private void ensureStreamExists() {
        if (Boolean.TRUE.equals(redisTemplate.hasKey(streamKey))) {
            return;
        }
        JSONObject initPayload = new JSONObject();
        initPayload.put("event_type", INIT_EVENT_TYPE);
        redisTemplate.opsForStream().add(StreamRecords.mapBacked(Map.of("data", initPayload.toJSONString()))
            .withStreamKey(streamKey));
        log.info("后台会话事件 Stream 不存在，已初始化创建, streamKey={}", streamKey);
    }

    private void acknowledge(MapRecord<String, String, String> message) {
        try {
            redisTemplate.opsForStream().acknowledge(streamKey, consumerGroup, message.getId());
        }
        catch (Exception e) {
            log.warn("ack 后台会话事件 Stream 消息失败, streamKey={}, messageId={}", streamKey, message.getId(), e);
        }
    }

    private String buildConsumerName() {
        return CONSUMER_NAME_PREFIX + resolveHostName() + ":" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String resolveHostName() {
        try {
            return InetAddress.getLocalHost().getHostName();
        }
        catch (Exception e) {
            return "unknown-host";
        }
    }
}
