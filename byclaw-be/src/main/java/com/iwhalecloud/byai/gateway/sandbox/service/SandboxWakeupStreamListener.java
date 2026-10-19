package com.iwhalecloud.byai.gateway.sandbox.service;

import java.net.InetAddress;
import java.time.Duration;
import java.util.concurrent.Executor;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.beans.factory.annotation.Qualifier;
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

import com.iwhaleai.byai.framework.common.Constants;

/**
 * Listens to control-plane wakeup events and connects them to sandbox lifecycle management.
 */
@Component
public class SandboxWakeupStreamListener
    implements StreamListener<String, MapRecord<String, String, String>>, ApplicationListener<ContextClosedEvent> {

    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.gateway.sandbox.platform.PlatformBackgroundExecution platformExecution;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryStore recoveryStore;
    private final Object admission = new Object();
    private boolean accepting;
    private int inFlight;
    private int pollTasks;

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxWakeupStreamListener.class);

    static final String DEFAULT_CONSUMER_GROUP = "byclaw_sandbox_wakeup_group";
    private static final String CONSUMER_NAME_PREFIX = "byclaw-sandbox-wakeup:";

    private final RedisConnectionFactory redisConnectionFactory;
    private final RedisTemplate<String, Object> redisTemplate;
    private final SandboxWakeupMessageHandler messageHandler;
    private final Executor sandboxWakeupStreamExecutor;

    @Value("${byclaw.sandbox.wakeup-stream.enabled:true}")
    private boolean enabled;

    /** 控制面管理 Stream Key 由 Gateway 框架统一生成，避免生产端与消费端命名不一致。 */
    private final String streamKey = Constants.QueueNames.controlPlaneManagementStream();

    @Value("${byclaw.sandbox.wakeup-stream.consumer-group:" + DEFAULT_CONSUMER_GROUP + "}")
    private String consumerGroup;

    private StreamMessageListenerContainer<String, MapRecord<String, String, String>> container;

    public SandboxWakeupStreamListener(RedisConnectionFactory redisConnectionFactory,
        RedisTemplate<String, Object> redisTemplate,
        SandboxWakeupMessageHandler messageHandler,
        @Qualifier("sandboxWakeupStreamExecutor") Executor sandboxWakeupStreamExecutor) {
        this.redisConnectionFactory = redisConnectionFactory;
        this.redisTemplate = redisTemplate;
        this.messageHandler = messageHandler;
        this.sandboxWakeupStreamExecutor = sandboxWakeupStreamExecutor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (!platformExecution.isLegacyExecutor()) return;
        if (!enabled) {
            LOGGER.info("沙箱唤醒 Stream 监听未启用，streamKey={}", streamKey);
            return;
        }
        if (container != null) {
            return;
        }

        createConsumerGroupIfAbsent();
        StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
            StreamMessageListenerContainerOptions.builder()
                .pollTimeout(Duration.ofSeconds(2))
                .executor(this::submitPoll)
                .build();
        container = StreamMessageListenerContainer.create(redisConnectionFactory, options);
        container.receive(
            Consumer.from(consumerGroup, buildConsumerName()),
            StreamOffset.create(streamKey, ReadOffset.lastConsumed()),
            this
        );
        synchronized (admission) { accepting = true; }
        try { container.start(); } catch (RuntimeException failure) { onApplicationEvent(null); throw failure; }
        LOGGER.info("沙箱唤醒 Stream 监听已启动，streamKey={}，consumerGroup={}", streamKey, consumerGroup);
    }

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        synchronized (admission) {
            if (!accepting || !platformExecution.isLegacyExecutor()) return;
            inFlight++;
        }
        try {
            LOGGER.debug("收到沙箱唤醒 Stream 消息，streamKey={}，messageId={}，value={}",
                message.getStream(), message.getId(), message.getValue());
            Map<String, String> values = message.getValue();
            messageHandler.handle(values);
            acknowledge(message);
        }
        catch (Exception e) {
            LOGGER.error("处理沙箱唤醒 Stream 消息失败，streamKey={}，messageId={}，将保留 pending",
                message.getStream(), message.getId(), e);
            recordRecoveryFailure(message, e);
        }
        finally { synchronized (admission) { inFlight--; admission.notifyAll(); } }
    }

    private void recordRecoveryFailure(MapRecord<String, String, String> message, Exception failure) {
        try {
            recoveryStore.audit(message.getStream(), consumerGroup, message.getId().getValue(), Map.of(
                "operator", "system", "action", "AUTO_WAKE", "outcome", "FAILED",
                "time", Long.toString(System.currentTimeMillis()),
                "reason", "自动唤醒失败，原消息保留待确认",
                "error", "自动唤醒失败（" + failure.getClass().getSimpleName() + "），请结合服务日志排查"));
        } catch (RuntimeException auditFailure) {
            LOGGER.warn("沙箱恢复失败记录写入失败，messageId={}，原消息继续保留", message.getId());
        }
    }

    @Override
    public synchronized void onApplicationEvent(ContextClosedEvent event) {
        synchronized (admission) { accepting = false; }
        if (container == null) {
            return;
        }
        try {
            container.stop();
            LOGGER.info("沙箱唤醒 Stream 监听已停止，streamKey={}", streamKey);
        }
        catch (Exception e) {
            LOGGER.warn("停止沙箱唤醒 Stream 监听异常，streamKey={}", streamKey, e);
        }
        finally {
            container = null;
            boolean interrupted = false;
            synchronized (admission) {
                while (inFlight > 0 || pollTasks > 0) { try { admission.wait(); } catch (InterruptedException e) { interrupted = true; } }
            }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private void submitPoll(Runnable poll) {
        synchronized (admission) { pollTasks++; }
        try { sandboxWakeupStreamExecutor.execute(() -> { try { poll.run(); } finally { synchronized (admission) { pollTasks--; admission.notifyAll(); } } }); }
        catch (RuntimeException failure) { synchronized (admission) { pollTasks--; admission.notifyAll(); } throw failure; }
    }

    private void createConsumerGroupIfAbsent() {
        try {
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.latest(), consumerGroup);
            LOGGER.info("已创建沙箱唤醒 Stream 消费者组，streamKey={}，consumerGroup={}", streamKey, consumerGroup);
        }
        catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("BUSYGROUP")) {
                LOGGER.debug("沙箱唤醒 Stream 消费者组已存在，streamKey={}，consumerGroup={}", streamKey, consumerGroup);
            }
            else {
                LOGGER.warn("创建沙箱唤醒 Stream 消费者组异常，将继续启动，streamKey={}，consumerGroup={}，reason={}",
                    streamKey, consumerGroup, e.getMessage());
            }
        }
    }

    private void acknowledge(MapRecord<String, String, String> message) {
        try {
            redisTemplate.opsForStream().acknowledge(streamKey, consumerGroup, message.getId());
        }
        catch (Exception e) {
            LOGGER.warn("ack 沙箱唤醒 Stream 消息失败，streamKey={}，messageId={}", streamKey, message.getId(), e);
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
