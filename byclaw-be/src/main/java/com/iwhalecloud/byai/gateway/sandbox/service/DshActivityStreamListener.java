package com.iwhalecloud.byai.gateway.sandbox.service;

import java.net.InetAddress;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
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
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.stereotype.Component;

/**
 * 消费 DSH 沙箱活动 Stream（{@code @byclaw/dsh-idle-reporter} 上报），按 workerId 记录最新状态及后端收到时间。
 */
@Component
public class DshActivityStreamListener
    implements StreamListener<String, MapRecord<String, String, String>>, ApplicationListener<ContextClosedEvent> {

    private static final Logger LOGGER = LoggerFactory.getLogger(DshActivityStreamListener.class);

    static final String DEFAULT_STREAM_KEY = "byclaw:dsh:sandbox:activity";
    static final String DEFAULT_CONSUMER_GROUP = "byclaw_dsh_activity_group";
    private static final String CONSUMER_NAME_PREFIX = "byclaw-dsh-activity:";

    /** 读取异常后的退避时间，避免 Redis 不可用时空转刷日志。 */
    private static final long ERROR_BACKOFF_MS = 1_000L;

    private final RedisConnectionFactory redisConnectionFactory;
    private final RedisTemplate<String, Object> redisTemplate;
    private final DshActivityStateStore stateStore;
    private final Executor dshActivityStreamExecutor;

    @Value("${byclaw.sandbox.dsh-activity.enabled:true}")
    private boolean enabled;

    @Value("${byclaw.sandbox.dsh-activity.stream-key:" + DEFAULT_STREAM_KEY + "}")
    private String streamKey = DEFAULT_STREAM_KEY;

    @Value("${byclaw.sandbox.dsh-activity.consumer-group:" + DEFAULT_CONSUMER_GROUP + "}")
    private String consumerGroup = DEFAULT_CONSUMER_GROUP;

    @Value("${byclaw.sandbox.dsh-activity.silent-seconds:90}")
    private long silentSeconds = 90L;

    private StreamMessageListenerContainer<String, MapRecord<String, String, String>> container;

    /** 本实例连续正常消费的起点（毫秒）；0 表示未在消费。启动及每次读取 / 写入异常都会重置。 */
    private volatile long consumingSince;

    private volatile boolean readFailing;

    public DshActivityStreamListener(RedisConnectionFactory redisConnectionFactory,
        RedisTemplate<String, Object> redisTemplate,
        DshActivityStateStore stateStore,
        @Qualifier("dshActivityStreamExecutor") Executor dshActivityStreamExecutor) {
        this.redisConnectionFactory = redisConnectionFactory;
        this.redisTemplate = redisTemplate;
        this.stateStore = stateStore;
        this.dshActivityStreamExecutor = dshActivityStreamExecutor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (!enabled) {
            LOGGER.info("DSH 活动 Stream 监听未启用，streamKey={}", streamKey);
            return;
        }
        if (container != null) {
            return;
        }
        if (silentSeconds <= 0) {
            LOGGER.error("DSH 活动 Stream 监听未启动：silent-seconds 必须大于 0，当前值={}", silentSeconds);
            return;
        }

        createConsumerGroupIfAbsent();
        StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
            StreamMessageListenerContainerOptions.builder()
                .pollTimeout(Duration.ofSeconds(2))
                .executor(dshActivityStreamExecutor)
                .build();
        container = StreamMessageListenerContainer.create(redisConnectionFactory, options);
        // 读取异常不取消订阅：Redis 短暂故障后继续消费，异常期间由 consumingSince 推迟静默释放。
        container.register(
            StreamMessageListenerContainer.StreamReadRequest
                .builder(StreamOffset.create(streamKey, ReadOffset.lastConsumed()))
                .consumer(Consumer.from(consumerGroup, buildConsumerName()))
                .autoAcknowledge(false)
                .cancelOnError(e -> false)
                .errorHandler(this::handleReadError)
                .build(),
            this
        );
        container.start();
        consumingSince = System.currentTimeMillis();
        LOGGER.info("DSH 活动 Stream 监听已启动，streamKey={}，consumerGroup={}，silentSeconds={}",
            streamKey, consumerGroup, silentSeconds);
    }

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        readFailing = false;
        try {
            if (handle(message.getValue(), message.getId().getValue(), System.currentTimeMillis())) {
                LOGGER.debug("已记录 DSH 活动状态，messageId={}，value={}", message.getId(), message.getValue());
            }
            acknowledge(message);
        }
        catch (Exception e) {
            // 状态写入失败等同于漏收上报：推迟本实例的静默释放，避免把漏写的沙箱误判为静默
            consumingSince = System.currentTimeMillis();
            LOGGER.error("处理 DSH 活动 Stream 消息失败，静默释放检查推迟，streamKey={}，messageId={}，将保留 pending",
                message.getStream(), message.getId(), e);
        }
    }

    /**
     * 校验并记录一条上报；格式不合法的记录忽略（调用方照常 ack）。
     *
     * @return 是否写入状态
     */
    boolean handle(Map<String, String> values, String streamId, long receivedAt) {
        String sandboxId = values == null ? null : StringUtils.trimToNull(values.get("sandboxId"));
        String userCode = values == null ? null : StringUtils.trimToNull(values.get("userCode"));
        String state = values == null ? null : StringUtils.trimToNull(values.get("state"));
        if (sandboxId == null || userCode == null
            || !(DshActivity.STATE_BUSY.equals(state) || DshActivity.STATE_RELEASABLE.equals(state))) {
            LOGGER.debug("忽略不合法的 DSH 活动记录，streamId={}，value={}", streamId, values);
            return false;
        }
        DshActivity activity = new DshActivity(userCode, state, receivedAt, streamId,
            values.get("at"), values.get("lastActiveAt"));
        return stateStore.record(sandboxId, activity);
    }

    /**
     * 静默释放检查是否可以执行：本实例已连续正常消费至少 silent-seconds，
     * 避免后端重启或 Redis 故障恢复后把所有沙箱误判为静默。
     */
    public boolean isSilentCheckReady(long nowMillis) {
        long since = consumingSince;
        return enabled && container != null && since > 0
            && nowMillis - since >= TimeUnit.SECONDS.toMillis(silentSeconds);
    }

    @Override
    public synchronized void onApplicationEvent(ContextClosedEvent event) {
        if (container == null) {
            return;
        }
        try {
            container.stop();
            LOGGER.info("DSH 活动 Stream 监听已停止，streamKey={}", streamKey);
        }
        catch (Exception e) {
            LOGGER.warn("停止 DSH 活动 Stream 监听异常，streamKey={}", streamKey, e);
        }
        finally {
            container = null;
            consumingSince = 0L;
        }
    }

    void handleReadError(Throwable error) {
        consumingSince = System.currentTimeMillis();
        String reason = error == null ? null : error.getMessage();
        if (!readFailing) {
            readFailing = true;
            LOGGER.warn("读取 DSH 活动 Stream 异常，静默释放检查推迟，streamKey={}，consumerGroup={}，reason={}",
                streamKey, consumerGroup, reason);
        }
        if (reason != null && reason.contains("NOGROUP")) {
            createConsumerGroupIfAbsent();
        }
        try {
            Thread.sleep(ERROR_BACKOFF_MS);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void createConsumerGroupIfAbsent() {
        try {
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.latest(), consumerGroup);
            LOGGER.info("已创建 DSH 活动 Stream 消费者组，streamKey={}，consumerGroup={}", streamKey, consumerGroup);
        }
        catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("BUSYGROUP")) {
                LOGGER.debug("DSH 活动 Stream 消费者组已存在，streamKey={}，consumerGroup={}", streamKey, consumerGroup);
            }
            else {
                LOGGER.warn("创建 DSH 活动 Stream 消费者组异常，将继续启动，streamKey={}，consumerGroup={}，reason={}",
                    streamKey, consumerGroup, e.getMessage());
            }
        }
    }

    private void acknowledge(MapRecord<String, String, String> message) {
        try {
            redisTemplate.opsForStream().acknowledge(streamKey, consumerGroup, message.getId());
        }
        catch (Exception e) {
            LOGGER.warn("ack DSH 活动 Stream 消息失败，streamKey={}，messageId={}", streamKey, message.getId(), e);
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
