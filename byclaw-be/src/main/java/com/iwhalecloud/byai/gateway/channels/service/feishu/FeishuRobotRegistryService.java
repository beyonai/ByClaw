package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.gateway.channels.service.feishu.config.FeishuStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.feishu.event.FeishuBotEventHandler;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.feishu.support.FeishuLongConnectionEventAdapter;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.lark.oapi.event.EventDispatcher;
import com.lark.oapi.service.im.ImService;
import com.lark.oapi.service.im.v1.model.P2MessageReceiveV1;
import com.lark.oapi.ws.Client;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 飞书机器人长连接注册服务。
 *
 * <p>飞书开放平台切换为“使用长连接接收事件”后，事件不再 POST 到本服务的 HTTP 回调地址。
 * 本服务需要像钉钉 Stream 一样，为每个配置了 appId/appSecret 的数字员工启动一个官方 SDK
 * WebSocket client，并订阅 {@code im.message.receive_v1} 事件。</p>
 *
 * <p>事件到达后不会在这里写聊天业务逻辑，而是通过 {@link FeishuLongConnectionEventAdapter}
 * 转成原 HTTP 回调一致的 JSON 结构，再交给 {@link FeishuBotEventHandler} 处理。这样用户匹配、
 * 去重、会话、卡片流式回复都只有一份实现。</p>
 */
@Service
public class FeishuRobotRegistryService {

    private static final Logger logger = LoggerFactory.getLogger(FeishuRobotRegistryService.class);
    private static final String FEISHU_CHANNEL = "Feishu";
    private static final long CLIENT_READY_TIMEOUT_MS = 10_000L;

    private final FeishuStreamProperties properties;
    private final SsResExtDigEmployeeService ssResExtDigEmployeeService;
    private final FeishuRobotConfigService feishuRobotConfigService;
    private final FeishuTokenService feishuTokenService;
    private final FeishuBotEventHandler feishuBotEventHandler;
    private final FeishuLongConnectionEventAdapter eventAdapter;
    private final Function<FeishuRobotChannelConfig, Client> feishuClientFactory;
    private final ExecutorService streamExecutor;
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final Object refreshLock = new Object();

    /**
     * appId 是飞书应用的稳定标识，也正好是 machineChannel 中数字员工绑定机器人的 key。
     */
    private final Map<String, Client> feishuClients = new ConcurrentHashMap<>();
    private final Map<String, FeishuRobotChannelConfig> activeRobotConfigs = new ConcurrentHashMap<>();
    private final Set<String> startingAppIds = ConcurrentHashMap.newKeySet();

    @org.springframework.beans.factory.annotation.Autowired
    public FeishuRobotRegistryService(
            FeishuStreamProperties properties,
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            FeishuRobotConfigService feishuRobotConfigService,
            FeishuTokenService feishuTokenService,
            FeishuBotEventHandler feishuBotEventHandler,
            FeishuLongConnectionEventAdapter eventAdapter
    ) {
        this(
                properties,
                ssResExtDigEmployeeService,
                feishuRobotConfigService,
                feishuTokenService,
                feishuBotEventHandler,
                eventAdapter,
                null,
                Executors.newCachedThreadPool(new StreamThreadFactory())
        );
    }

    FeishuRobotRegistryService(
            FeishuStreamProperties properties,
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            FeishuRobotConfigService feishuRobotConfigService,
            FeishuTokenService feishuTokenService,
            FeishuBotEventHandler feishuBotEventHandler,
            FeishuLongConnectionEventAdapter eventAdapter,
            Function<FeishuRobotChannelConfig, Client> feishuClientFactory,
            ExecutorService streamExecutor
    ) {
        this.properties = properties;
        this.ssResExtDigEmployeeService = ssResExtDigEmployeeService;
        this.feishuRobotConfigService = feishuRobotConfigService;
        this.feishuTokenService = feishuTokenService;
        this.feishuBotEventHandler = feishuBotEventHandler;
        this.eventAdapter = eventAdapter;
        this.feishuClientFactory = feishuClientFactory == null
                ? this::buildFeishuClient
                : feishuClientFactory;
        this.streamExecutor = streamExecutor;
    }

    public void initializeRobotClients() {
        synchronized (refreshLock) {
            List<ResourceExtDigEmployeeDto> digitalEmployees = findFeishuDigitalEmployees();
            if (digitalEmployees.isEmpty()) {
                logger.info("No Feishu robot configs found from digital employees. Skip startup.");
                return;
            }
            for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
                if (digitalEmployee != null) {
                    doRegisterRobotClientsForResource(digitalEmployee.getResourceId());
                }
            }
            started.set(!feishuClients.isEmpty());
            logger.info("Feishu long-connection bot registration finished. activeClientCount={}",
                    feishuClients.size());
        }
    }

    public void registerRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (!properties.isEnabled() || resourceId == null) {
                return;
            }
            doRegisterRobotClientsForResource(resourceId);
        }
    }

    public void refreshRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (!properties.isEnabled() || resourceId == null) {
                return;
            }

            ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
            List<FeishuRobotChannelConfig> desiredConfigs = digitalEmployee == null
                    ? Collections.emptyList()
                    : feishuRobotConfigService.buildRobotConfigs(digitalEmployee);

            Map<String, FeishuRobotChannelConfig> desiredConfigMap = new HashMap<>();
            for (FeishuRobotChannelConfig desiredConfig : desiredConfigs) {
                desiredConfigMap.put(desiredConfig.getAppId(), desiredConfig);
            }

            List<FeishuRobotChannelConfig> currentConfigs =
                    new ArrayList<>(feishuRobotConfigService.getRobotConfigsByResourceId(resourceId));
            for (FeishuRobotChannelConfig currentConfig : currentConfigs) {
                FeishuRobotChannelConfig desiredConfig = desiredConfigMap.get(currentConfig.getAppId());
                if (desiredConfig == null || isConfigChanged(currentConfig, desiredConfig)) {
                    stopRobotClient(currentConfig.getAppId());
                    activeRobotConfigs.remove(currentConfig.getAppId());
                    logger.info("Unregister Feishu long-connection bot due to config change/removal. appId={}, resourceId={}",
                            currentConfig.getAppId(), currentConfig.getResourceId());
                }
            }

            feishuRobotConfigService.replaceRobotConfigsForResource(resourceId, desiredConfigs);
            for (FeishuRobotChannelConfig desiredConfig : desiredConfigs) {
                if (!activeRobotConfigs.containsKey(desiredConfig.getAppId())
                        && !startingAppIds.contains(desiredConfig.getAppId())) {
                    startRobotClient(desiredConfig);
                }
            }

            started.set(!feishuClients.isEmpty());
            logger.info("Feishu long-connection bot resource refresh finished. resourceId={}, activeClientCount={}",
                    resourceId, feishuClients.size());
        }
    }

    public void unregisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (resourceId == null) {
                return;
            }
            List<FeishuRobotChannelConfig> currentConfigs =
                    new ArrayList<>(feishuRobotConfigService.getRobotConfigsByResourceId(resourceId));
            for (FeishuRobotChannelConfig currentConfig : currentConfigs) {
                stopRobotClient(currentConfig.getAppId());
                activeRobotConfigs.remove(currentConfig.getAppId());
                logger.info("Unregister Feishu long-connection bot by resource. appId={}, resourceId={}",
                        currentConfig.getAppId(), currentConfig.getResourceId());
            }
            feishuRobotConfigService.removeRobotConfigsByResourceId(resourceId);
            started.set(!feishuClients.isEmpty());
        }
    }

    @PreDestroy
    public void shutdownAll() {
        synchronized (refreshLock) {
            if (started.get()) {
                for (String appId : new ArrayList<>(feishuClients.keySet())) {
                    stopRobotClient(appId);
                    activeRobotConfigs.remove(appId);
                }
            }
            streamExecutor.shutdownNow();
        }
    }

    private void doRegisterRobotClientsForResource(Long resourceId) {
        ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
        if (digitalEmployee == null) {
            logger.warn("Skip register Feishu long-connection bots because resource not found. resourceId={}",
                    resourceId);
            return;
        }

        List<FeishuRobotChannelConfig> robotConfigs = feishuRobotConfigService.buildRobotConfigs(digitalEmployee);
        if (robotConfigs.isEmpty()) {
            logger.info("No Feishu robot configs found for resource. resourceId={}", resourceId);
            return;
        }

        feishuRobotConfigService.replaceRobotConfigsForResource(resourceId, robotConfigs);
        for (FeishuRobotChannelConfig robotConfig : robotConfigs) {
            if (activeRobotConfigs.containsKey(robotConfig.getAppId())
                    || startingAppIds.contains(robotConfig.getAppId())) {
                logger.info("Skip register existing Feishu long-connection bot. appId={}, resourceId={}",
                        robotConfig.getAppId(), robotConfig.getResourceId());
                continue;
            }
            startRobotClient(robotConfig);
        }
        started.set(!feishuClients.isEmpty());
    }

    private void startRobotClient(FeishuRobotChannelConfig robotConfig) {
        String appId = robotConfig.getAppId();
        if (!startingAppIds.add(appId)) {
            logger.info("Skip register starting Feishu long-connection bot. appId={}, resourceId={}",
                    appId, robotConfig.getResourceId());
            return;
        }

        logger.info("Register Feishu long-connection bot. appId={}, resourceId={}, resourceName={}",
                appId, robotConfig.getResourceId(), robotConfig.getResourceName());

        Client client;
        try {
            client = feishuClientFactory.apply(robotConfig);
        } catch (RuntimeException e) {
            startingAppIds.remove(appId);
            throw e;
        }
        feishuClients.put(appId, client);
        streamExecutor.submit(() -> {
            try {
                client.start();
                client.awaitReady(CLIENT_READY_TIMEOUT_MS);
                activeRobotConfigs.put(appId, robotConfig);
                logger.info("Feishu long-connection bot started. appId={}, resourceId={}, resourceName={}",
                        appId, robotConfig.getResourceId(), robotConfig.getResourceName());
            } catch (Exception e) {
                feishuClients.remove(appId, client);
                activeRobotConfigs.remove(appId);
                feishuTokenService.evictTenantAccessToken(appId);
                closeClientQuietly(client, appId);
                logger.error("Failed to start Feishu long-connection bot. appId={}, resourceId={}, resourceName={}",
                        appId, robotConfig.getResourceId(), robotConfig.getResourceName(), e);
            } finally {
                startingAppIds.remove(appId);
            }
        });
    }

    private Client buildFeishuClient(FeishuRobotChannelConfig robotConfig) {
        // 飞书长连接在建连阶段使用 appId/appSecret 鉴权，后续推送给 SDK 的事件是明文。
        // 官方 Java 长连接示例要求 EventDispatcher.newBuilder 的 token/encryptKey 传空字符串；
        // HTTP 回调场景下的 Verification Token / Encrypt Key 校验仍保留在 FeishuBotEventController。
        EventDispatcher eventDispatcher = EventDispatcher
                .newBuilder("", "")
                .onP2MessageReceiveV1(new ImService.P2MessageReceiveV1Handler() {
                    @Override
                    public void handle(P2MessageReceiveV1 event) {
                        handleMessageReceiveEvent(robotConfig, event);
                    }
                })
                .build();

        return new Client.Builder(robotConfig.getAppId(), robotConfig.getAppSecret())
                .eventHandler(eventDispatcher)
                .autoReconnect(true)
                .onReconnecting(() -> logger.warn(
                        "Feishu long-connection bot reconnecting. appId={}, resourceId={}",
                        robotConfig.getAppId(), robotConfig.getResourceId()))
                .onReconnected(() -> logger.info(
                        "Feishu long-connection bot reconnected. appId={}, resourceId={}",
                        robotConfig.getAppId(), robotConfig.getResourceId()))
                .build();
    }

    private void handleMessageReceiveEvent(FeishuRobotChannelConfig robotConfig, P2MessageReceiveV1 event) {
        try {
            JsonNode root = eventAdapter.toEventRoot(event, robotConfig);
            feishuBotEventHandler.handleEvent(root);
        } catch (Exception e) {
            logger.error("Handle Feishu long-connection event failed. appId={}, resourceId={}",
                    robotConfig.getAppId(), robotConfig.getResourceId(), e);
        }
    }

    private void stopRobotClient(String appId) {
        startingAppIds.remove(appId);
        Client client = feishuClients.remove(appId);
        feishuTokenService.evictTenantAccessToken(appId);
        if (client == null) {
            return;
        }
        closeClientQuietly(client, appId);
    }

    private void closeClientQuietly(Client client, String appId) {
        try {
            client.close();
            logger.info("Feishu long-connection bot stopped. appId={}", appId);
        } catch (Exception e) {
            logger.warn("Failed to stop Feishu long-connection bot gracefully. appId={}", appId, e);
        }
    }

    private List<ResourceExtDigEmployeeDto> findFeishuDigitalEmployees() {
        List<ResourceExtDigEmployeeDto> digitalEmployees =
                ssResExtDigEmployeeService.findOnlineDigitalEmployees(FEISHU_CHANNEL);
        return digitalEmployees == null ? Collections.emptyList() : digitalEmployees;
    }

    private boolean isConfigChanged(FeishuRobotChannelConfig currentConfig, FeishuRobotChannelConfig desiredConfig) {
        return !safeEquals(currentConfig.getAppSecret(), desiredConfig.getAppSecret())
                || !safeEquals(currentConfig.getVerificationToken(), desiredConfig.getVerificationToken())
                || !safeEquals(currentConfig.getEncryptKey(), desiredConfig.getEncryptKey())
                || !safeEquals(currentConfig.getBotId(), desiredConfig.getBotId())
                || !safeEquals(currentConfig.getCardTemplateId(), desiredConfig.getCardTemplateId())
                || !safeEquals(currentConfig.getResourceId(), desiredConfig.getResourceId())
                || !safeEquals(currentConfig.getResourceName(), desiredConfig.getResourceName());
    }

    private boolean safeEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }

    private static class StreamThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "feishu-stream-bot-" + counter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }
}
