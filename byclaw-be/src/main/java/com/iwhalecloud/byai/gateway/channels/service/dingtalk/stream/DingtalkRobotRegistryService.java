package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.open.app.api.OpenDingTalkClient;
import com.dingtalk.open.app.api.OpenDingTalkStreamClientBuilder;
import com.dingtalk.open.app.api.security.AuthClientCredential;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener.DingtalkBotListener;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener.DingtalkStreamBotLifecycle;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class DingtalkRobotRegistryService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkRobotRegistryService.class);
    private static final String DING_TALK_CHANNEL = "DingTalk";

    private final DingtalkStreamProperties properties;
    private final DingtalkBotListener dingtalkBotListener;
    private final SsResExtDigEmployeeService ssResExtDigEmployeeService;
    private final DingtalkRobotConfigService dingtalkRobotConfigService;
    private final DingtalkTokenService dingtalkTokenService;
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final ExecutorService streamExecutor = Executors.newCachedThreadPool(new StreamThreadFactory());
    private final Object refreshLock = new Object();

    private final Map<String, OpenDingTalkClient> openDingTalkClients = new ConcurrentHashMap<>();
    private final Map<String, DingtalkRobotChannelConfig> activeRobotConfigs = new ConcurrentHashMap<>();

    public DingtalkRobotRegistryService(
            DingtalkStreamProperties properties,
            DingtalkBotListener dingtalkBotListener,
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            DingtalkRobotConfigService dingtalkRobotConfigService,
            DingtalkTokenService dingtalkTokenService) {
        this.properties = properties;
        this.dingtalkBotListener = dingtalkBotListener;
        this.ssResExtDigEmployeeService = ssResExtDigEmployeeService;
        this.dingtalkRobotConfigService = dingtalkRobotConfigService;
        this.dingtalkTokenService = dingtalkTokenService;
    }

    public void initializeRobotClients() {
        synchronized (refreshLock) {
            List<ResourceExtDigEmployeeDto> digitalEmployees = findDingTalkDigitalEmployees();
            if (digitalEmployees.isEmpty()) {
                logger.warn("No DingTalk robot configs found from digital employees. Skip startup.");
                return;
            }
            for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
                if (digitalEmployee != null) {
                    registerRobotClientsForResource(digitalEmployee.getResourceId());
                }
            }
            started.set(!openDingTalkClients.isEmpty());
            logger.info("DingTalk stream bot registration finished. registeredClientCount={}", openDingTalkClients.size());
        }
    }

    public void registerRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (!properties.isEnabled() || resourceId == null) {
                return;
            }
            ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
            if (digitalEmployee == null) {
                logger.warn("Skip register DingTalk robot clients because resource not found. resourceId={}", resourceId);
                return;
            }
            List<DingtalkRobotChannelConfig> robotConfigs = dingtalkRobotConfigService.buildRobotConfigs(digitalEmployee);
            if (robotConfigs.isEmpty()) {
                logger.info("No DingTalk robot configs found for resource. resourceId={}", resourceId);
                return;
            }
            dingtalkRobotConfigService.replaceRobotConfigsForResource(resourceId, robotConfigs);
            for (DingtalkRobotChannelConfig robotConfig : robotConfigs) {
                if (activeRobotConfigs.containsKey(robotConfig.getRobotCode())) {
                    logger.info("Skip register existing DingTalk stream bot. robotCode={}, resourceId={}",
                            robotConfig.getRobotCode(), robotConfig.getResourceId());
                    continue;
                }
                startRobotClient(robotConfig);
            }
            started.set(!openDingTalkClients.isEmpty());
        }
    }

    public void refreshRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (!properties.isEnabled() || resourceId == null) {
                return;
            }
            ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
            List<DingtalkRobotChannelConfig> desiredRobotConfigs = digitalEmployee == null
                    ? Collections.emptyList()
                    : dingtalkRobotConfigService.buildRobotConfigs(digitalEmployee);
            Map<String, DingtalkRobotChannelConfig> desiredRobotConfigMap = new HashMap<>();
            for (DingtalkRobotChannelConfig desiredRobotConfig : desiredRobotConfigs) {
                desiredRobotConfigMap.put(desiredRobotConfig.getRobotCode(), desiredRobotConfig);
            }
            List<DingtalkRobotChannelConfig> currentRobotConfigs = new ArrayList<>(dingtalkRobotConfigService.getRobotConfigsByResourceId(resourceId));

            for (DingtalkRobotChannelConfig currentConfig : currentRobotConfigs) {
                DingtalkRobotChannelConfig desiredConfig = desiredRobotConfigMap.get(currentConfig.getRobotCode());
                if (desiredConfig == null) {
                    stopRobotClient(currentConfig.getRobotCode());
                    activeRobotConfigs.remove(currentConfig.getRobotCode());
                    logger.info("Unregister DingTalk stream bot due to config removal. robotCode={}, resourceId={}",
                            currentConfig.getRobotCode(), currentConfig.getResourceId());
                    continue;
                }
                if (isConfigChanged(currentConfig, desiredConfig)) {
                    stopRobotClient(currentConfig.getRobotCode());
                    activeRobotConfigs.remove(currentConfig.getRobotCode());
                    logger.info("Re-register DingTalk stream bot due to config change. robotCode={}, resourceId={}",
                            desiredConfig.getRobotCode(), desiredConfig.getResourceId());
                }
            }

            dingtalkRobotConfigService.replaceRobotConfigsForResource(resourceId, desiredRobotConfigs);
            for (DingtalkRobotChannelConfig desiredConfig : desiredRobotConfigs) {
                if (!activeRobotConfigs.containsKey(desiredConfig.getRobotCode())) {
                    startRobotClient(desiredConfig);
                }
            }

            started.set(!openDingTalkClients.isEmpty());
            logger.info("DingTalk stream bot resource refresh finished. resourceId={}, activeClientCount={}",
                    resourceId, openDingTalkClients.size());
        }
    }

    public void unregisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (resourceId == null) {
                return;
            }
            List<DingtalkRobotChannelConfig> currentRobotConfigs = new ArrayList<>(dingtalkRobotConfigService.getRobotConfigsByResourceId(resourceId));
            for (DingtalkRobotChannelConfig currentRobotConfig : currentRobotConfigs) {
                stopRobotClient(currentRobotConfig.getRobotCode());
                activeRobotConfigs.remove(currentRobotConfig.getRobotCode());
                logger.info("Unregister DingTalk stream bot by resource. robotCode={}, resourceId={}",
                        currentRobotConfig.getRobotCode(), currentRobotConfig.getResourceId());
            }
            dingtalkRobotConfigService.removeRobotConfigsByResourceId(resourceId);
            started.set(!openDingTalkClients.isEmpty());
        }
    }

    @PreDestroy
    public void shutdownAll() {
        synchronized (refreshLock) {
            if (started.get()) {
                for (String robotCode : new HashMap<>(openDingTalkClients).keySet()) {
                    stopRobotClient(robotCode);
                    activeRobotConfigs.remove(robotCode);
                }
            }
            streamExecutor.shutdownNow();
        }
    }

    public List<ResourceExtDigEmployeeDto> findDingTalkDigitalEmployees() {
        List<ResourceExtDigEmployeeDto> digitalEmployees = ssResExtDigEmployeeService.findOnlineDigitalEmployees(DING_TALK_CHANNEL);
        if (digitalEmployees != null) {
            for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
                logger.info("DingTalk digital employee. resourceId={}, resourceName={}, machineChannelPresent={}",
                        digitalEmployee == null ? null : digitalEmployee.getResourceId(),
                        digitalEmployee == null ? null : digitalEmployee.getResourceName(),
                        digitalEmployee != null
                                && digitalEmployee.getSsResExtDigEmployee() != null
                                && StringUtils.hasText(digitalEmployee.getSsResExtDigEmployee().getMachineChannel()));
            }
        }
        return digitalEmployees == null ? Collections.emptyList() : digitalEmployees;
    }

    private void startRobotClient(DingtalkRobotChannelConfig robotConfig) {
        logger.info("Register DingTalk stream bot. robotCode={}, resourceId={}, resourceName={}, appId={}, clientIdSuffix={}",
                robotConfig.getRobotCode(),
                robotConfig.getResourceId(),
                robotConfig.getResourceName(),
                robotConfig.getAppId(),
                maskClientId(robotConfig.getClientId()));

        OpenDingTalkStreamClientBuilder builder = OpenDingTalkStreamClientBuilder
                .custom()
                .credential(new AuthClientCredential(robotConfig.getClientId(), robotConfig.getClientSecret()))
                .registerCallbackListener(DingtalkStreamBotLifecycle.BOT_MESSAGE_TOPIC, dingtalkBotListener);

        OpenDingTalkClient client = builder.build();
        openDingTalkClients.put(robotConfig.getRobotCode(), client);
        activeRobotConfigs.put(robotConfig.getRobotCode(), robotConfig);
        streamExecutor.submit(() -> {
            try {
                client.start();
                logger.info("DingTalk stream bot started. topic={}, robotCode={}, resourceId={}, resourceName={}, appId={}",
                        DingtalkStreamBotLifecycle.BOT_MESSAGE_TOPIC,
                        robotConfig.getRobotCode(),
                        robotConfig.getResourceId(),
                        robotConfig.getResourceName(),
                        robotConfig.getAppId());
            } catch (Exception e) {
                logger.error("Failed to start DingTalk stream bot. robotCode={}, resourceId={}, resourceName={}, appId={}",
                        robotConfig.getRobotCode(),
                        robotConfig.getResourceId(),
                        robotConfig.getResourceName(),
                        robotConfig.getAppId(),
                        e);
            }
        });
    }

    private void stopRobotClient(String robotCode) {
        OpenDingTalkClient client = openDingTalkClients.remove(robotCode);
        dingtalkTokenService.evictAccessTokensByRobotCode(robotCode);
        if (client == null) {
            return;
        }
        try {
            client.stop();
            logger.info("DingTalk stream bot stopped. robotCode={}", robotCode);
        } catch (Exception e) {
            logger.warn("Failed to stop DingTalk stream bot gracefully. robotCode={}", robotCode, e);
        }
    }

    private boolean isConfigChanged(DingtalkRobotChannelConfig currentConfig, DingtalkRobotChannelConfig desiredConfig) {
        return !safeEquals(currentConfig.getClientId(), desiredConfig.getClientId())
                || !safeEquals(currentConfig.getClientSecret(), desiredConfig.getClientSecret())
                || !safeEquals(currentConfig.getAppId(), desiredConfig.getAppId())
                || !safeEquals(currentConfig.getCardTemplateId(), desiredConfig.getCardTemplateId())
                || !safeEquals(currentConfig.getResourceId(), desiredConfig.getResourceId())
                || !safeEquals(currentConfig.getResourceName(), desiredConfig.getResourceName());
    }

    private boolean safeEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }

    private String maskClientId(String clientId) {
        if (!StringUtils.hasText(clientId)) {
            return "";
        }
        int length = clientId.length();
        return length <= 4 ? clientId : clientId.substring(length - 4);
    }

    private static class StreamThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "dingtalk-stream-bot-" + counter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }
}
