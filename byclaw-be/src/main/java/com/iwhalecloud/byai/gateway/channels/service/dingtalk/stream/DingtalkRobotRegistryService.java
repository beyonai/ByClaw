package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.open.app.api.OpenDingTalkClient;
import com.dingtalk.open.app.api.OpenDingTalkStreamClientBuilder;
import com.dingtalk.open.app.api.security.AuthClientCredential;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener.DingtalkBotListener;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener.DingtalkStreamBotLifecycle;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle.DingtalkConnectionLockService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.RobotConfigParseResult;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

@Service
public class DingtalkRobotRegistryService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkRobotRegistryService.class);
    private static final String DING_TALK_CHANNEL = "DingTalk";

    private final DingtalkStreamProperties properties;
    private final DingtalkBotListener dingtalkBotListener;
    private final SsResExtDigEmployeeService ssResExtDigEmployeeService;
    private final DingtalkRobotConfigService dingtalkRobotConfigService;
    private final DingtalkTokenService dingtalkTokenService;
    private final DingtalkConnectionLockService connectionLockService;
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final AtomicBoolean shutdown = new AtomicBoolean(false);
    private final ExecutorService streamExecutor;
    private final ScheduledExecutorService lifecycleScheduler;
    private final Function<DingtalkRobotChannelConfig, OpenDingTalkClient> openDingTalkClientFactory;
    private final Object refreshLock = new Object();

    private final Map<String, OpenDingTalkClient> openDingTalkClients = new ConcurrentHashMap<>();
    private final Map<String, DingtalkRobotChannelConfig> activeRobotConfigs = new ConcurrentHashMap<>();
    private final Set<String> startingRobotCodes = ConcurrentHashMap.newKeySet();
    private final Map<String, String> leaseOwnerTokens = new ConcurrentHashMap<>();
    private final Map<String, Long> leaseValidUntilNanos = new ConcurrentHashMap<>();
    private final Map<String, Long> currentGenerations = new ConcurrentHashMap<>();
    private final Map<OpenDingTalkClient, AtomicBoolean> clientStopFlags = new ConcurrentHashMap<>();
    private final Set<OpenDingTalkClient> startAttemptsInFlight = ConcurrentHashMap.newKeySet();
    private final Map<OpenDingTalkClient, CompletableFuture<Void>> startAttemptSettled = new ConcurrentHashMap<>();
    private final Set<String> stopFailedRobotCodes = ConcurrentHashMap.newKeySet();
    private final AtomicLong generationSequence = new AtomicLong();

    @org.springframework.beans.factory.annotation.Autowired
    public DingtalkRobotRegistryService(
            DingtalkStreamProperties properties,
            DingtalkBotListener dingtalkBotListener,
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            DingtalkRobotConfigService dingtalkRobotConfigService,
            DingtalkTokenService dingtalkTokenService,
            DingtalkConnectionLockService connectionLockService) {
        this(
                properties,
                dingtalkBotListener,
                ssResExtDigEmployeeService,
                dingtalkRobotConfigService,
                dingtalkTokenService,
                connectionLockService,
                null,
                Executors.newCachedThreadPool(new StreamThreadFactory()),
                Executors.newSingleThreadScheduledExecutor(new LifecycleThreadFactory())
        );
    }

    DingtalkRobotRegistryService(
            DingtalkStreamProperties properties,
            DingtalkBotListener dingtalkBotListener,
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            DingtalkRobotConfigService dingtalkRobotConfigService,
            DingtalkTokenService dingtalkTokenService,
            DingtalkConnectionLockService connectionLockService,
            Function<DingtalkRobotChannelConfig, OpenDingTalkClient> openDingTalkClientFactory,
            ExecutorService streamExecutor) {
        this(
                properties,
                dingtalkBotListener,
                ssResExtDigEmployeeService,
                dingtalkRobotConfigService,
                dingtalkTokenService,
                connectionLockService,
                openDingTalkClientFactory,
                streamExecutor,
                Executors.newSingleThreadScheduledExecutor(new LifecycleThreadFactory())
        );
    }

    DingtalkRobotRegistryService(
            DingtalkStreamProperties properties,
            DingtalkBotListener dingtalkBotListener,
            SsResExtDigEmployeeService ssResExtDigEmployeeService,
            DingtalkRobotConfigService dingtalkRobotConfigService,
            DingtalkTokenService dingtalkTokenService,
            DingtalkConnectionLockService connectionLockService,
            Function<DingtalkRobotChannelConfig, OpenDingTalkClient> openDingTalkClientFactory,
            ExecutorService streamExecutor,
            ScheduledExecutorService lifecycleScheduler) {
        this.properties = properties;
        this.dingtalkBotListener = dingtalkBotListener;
        this.ssResExtDigEmployeeService = ssResExtDigEmployeeService;
        this.dingtalkRobotConfigService = dingtalkRobotConfigService;
        this.dingtalkTokenService = dingtalkTokenService;
        this.connectionLockService = connectionLockService;
        this.openDingTalkClientFactory = openDingTalkClientFactory == null
                ? this::buildOpenDingTalkClient
                : openDingTalkClientFactory;
        this.streamExecutor = streamExecutor;
        this.lifecycleScheduler = lifecycleScheduler;
        long renewInterval = Math.max(1L, properties.getLifecycle().getLeaseRenewIntervalSeconds());
        this.lifecycleScheduler.scheduleWithFixedDelay(
                this::renewConnectionLeasesQuietly,
                renewInterval,
                renewInterval,
                TimeUnit.SECONDS
        );
    }

    public void initializeRobotClients() {
        reconcileRobotClients();
    }

    public void reconcileRobotClients() {
        if (!properties.isEnabled() || shutdown.get()) {
            return;
        }
        synchronized (refreshLock) {
            List<ResourceExtDigEmployeeDto> digitalEmployees = findDingTalkDigitalEmployees();
            Set<Long> onlineResourceIds = ConcurrentHashMap.newKeySet();
            for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
                if (digitalEmployee != null && digitalEmployee.getResourceId() != null) {
                    onlineResourceIds.add(digitalEmployee.getResourceId());
                    doRefreshRobotClientsForResource(digitalEmployee.getResourceId());
                }
            }
            for (Long configuredResourceId : dingtalkRobotConfigService.getConfiguredResourceIds()) {
                if (!onlineResourceIds.contains(configuredResourceId)) {
                    doUnregisterRobotClientsForResource(configuredResourceId);
                }
            }
            started.set(!openDingTalkClients.isEmpty());
            logger.info("DingTalk stream bot reconciliation finished. registeredClientCount={}",
                    openDingTalkClients.size());
        }
    }

    public void registerRobotClientsForResource(Long resourceId) {
        if (!properties.isEnabled() || resourceId == null) {
            return;
        }
        validateResourceConfig(resourceId);
        runAfterCommitOrNow(() -> {
            synchronized (refreshLock) {
                doRegisterRobotClientsForResource(resourceId);
            }
        });
    }

    private void runAfterCommitOrNow(Runnable task) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
            return;
        }
        task.run();
    }

    private void validateResourceConfig(Long resourceId) {
        ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
        if (digitalEmployee != null) {
            dingtalkRobotConfigService.validateAndBuildRobotConfigs(digitalEmployee);
        }
    }

    public void forceRegisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (resourceId == null) {
                return;
            }
            doRegisterRobotClientsForResource(resourceId);
        }
    }

    private void doRegisterRobotClientsForResource(Long resourceId) {
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
            if (activeRobotConfigs.containsKey(robotConfig.getRobotCode())
                    || startingRobotCodes.contains(robotConfig.getRobotCode())
                    || stopFailedRobotCodes.contains(robotConfig.getRobotCode())) {
                logger.info("Skip register existing DingTalk stream bot. robotCode={}, resourceId={}",
                        robotConfig.getRobotCode(), robotConfig.getResourceId());
                continue;
            }
            startRobotClient(robotConfig);
        }
        started.set(!openDingTalkClients.isEmpty());
    }

    public void refreshRobotClientsForResource(Long resourceId) {
        if (!properties.isEnabled() || resourceId == null) {
            return;
        }
        validateResourceConfig(resourceId);
        runAfterCommitOrNow(() -> {
            synchronized (refreshLock) {
                doRefreshRobotClientsForResource(resourceId);
            }
        });
    }

    private void doRefreshRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            ResourceExtDigEmployeeDto digitalEmployee = ssResExtDigEmployeeService.findExtDigEmployeeById(resourceId);
            RobotConfigParseResult parseResult = digitalEmployee == null
                    ? new RobotConfigParseResult(List.of(), false, List.of())
                    : dingtalkRobotConfigService.parseRobotConfigsResult(digitalEmployee);
            if (!parseResult.errors().isEmpty()) {
                logger.error("Keep last accepted DingTalk runtime because committed config is invalid. resourceId={}, errorCodes={}",
                        resourceId,
                        parseResult.errors().stream().map(RobotConfigParseResult.ParseError::code).distinct().toList());
                return;
            }
            List<DingtalkRobotChannelConfig> desiredRobotConfigs = digitalEmployee == null
                    ? Collections.emptyList()
                    : parseResult.configs();
            Map<String, DingtalkRobotChannelConfig> desiredRobotConfigMap = new HashMap<>();
            for (DingtalkRobotChannelConfig desiredRobotConfig : desiredRobotConfigs) {
                desiredRobotConfigMap.put(desiredRobotConfig.getRobotCode(), desiredRobotConfig);
            }
            List<DingtalkRobotChannelConfig> currentRobotConfigs = new ArrayList<>(dingtalkRobotConfigService.getRobotConfigsByResourceId(resourceId));

            for (DingtalkRobotChannelConfig currentConfig : currentRobotConfigs) {
                DingtalkRobotChannelConfig desiredConfig = desiredRobotConfigMap.get(currentConfig.getRobotCode());
                if (desiredConfig == null) {
                    if (!stopRobotClient(currentConfig.getRobotCode(), true)) {
                        return;
                    }
                    activeRobotConfigs.remove(currentConfig.getRobotCode());
                    logger.info("Unregister DingTalk stream bot due to config removal. robotCode={}, resourceId={}",
                            currentConfig.getRobotCode(), currentConfig.getResourceId());
                    continue;
                }
                if (isConfigChanged(currentConfig, desiredConfig)) {
                    if (!stopRobotClient(currentConfig.getRobotCode(), false)) {
                        return;
                    }
                    activeRobotConfigs.remove(currentConfig.getRobotCode());
                    logger.info("Re-register DingTalk stream bot due to config change. robotCode={}, resourceId={}",
                            desiredConfig.getRobotCode(), desiredConfig.getResourceId());
                }
            }

            dingtalkRobotConfigService.replaceRobotConfigsForResource(resourceId, desiredRobotConfigs);
            for (DingtalkRobotChannelConfig desiredConfig : desiredRobotConfigs) {
                if (dingtalkRobotConfigService.isConflictedRobotCode(desiredConfig.getRobotCode())) {
                    stopRobotClient(desiredConfig.getRobotCode(), true);
                    activeRobotConfigs.remove(desiredConfig.getRobotCode());
                    logger.error("Stop DingTalk stream runtime because robotCode has multiple owners. robotCode={}",
                            desiredConfig.getRobotCode());
                    continue;
                }
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
        if (resourceId == null) {
            return;
        }
        runAfterCommitOrNow(() -> {
            synchronized (refreshLock) {
                doUnregisterRobotClientsForResource(resourceId);
            }
        });
    }

    private void doUnregisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            List<DingtalkRobotChannelConfig> currentRobotConfigs = new ArrayList<>(dingtalkRobotConfigService.getRobotConfigsByResourceId(resourceId));
            for (DingtalkRobotChannelConfig currentRobotConfig : currentRobotConfigs) {
                if (!stopRobotClient(currentRobotConfig.getRobotCode(), true)) {
                    return;
                }
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
            shutdown.set(true);
            if (started.get()) {
                for (String robotCode : new HashMap<>(openDingTalkClients).keySet()) {
                    stopRobotClient(robotCode, true);
                    activeRobotConfigs.remove(robotCode);
                }
            }
            streamExecutor.shutdownNow();
            lifecycleScheduler.shutdownNow();
            for (String robotCode : new ArrayList<>(leaseOwnerTokens.keySet())) {
                if (!stopFailedRobotCodes.contains(robotCode)) {
                    releaseConnectionLease(robotCode);
                }
            }
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
        String robotCode = robotConfig.getRobotCode();
        if (stopFailedRobotCodes.contains(robotCode)) {
            logger.error("Skip DingTalk stream runtime rebuild after stop failure. robotCode={}", robotCode);
            return;
        }
        if (!startingRobotCodes.add(robotCode)) {
            logger.info("Skip register starting DingTalk stream bot. robotCode={}, resourceId={}",
                    robotCode, robotConfig.getResourceId());
            return;
        }

        if (!acquireConnectionLease(robotCode)) {
            startingRobotCodes.remove(robotCode);
            logger.info("Skip register DingTalk stream bot because lease is held by another instance. robotCode={}, resourceId={}",
                    robotCode, robotConfig.getResourceId());
            return;
        }

        long generation = generationSequence.incrementAndGet();
        currentGenerations.put(robotCode, generation);
        startRobotClientAttempt(robotConfig, generation, 1);
    }

    private void startRobotClientAttempt(
            DingtalkRobotChannelConfig robotConfig, long generation, int attemptNumber) {
        String robotCode = robotConfig.getRobotCode();
        if (!isCurrentGeneration(robotCode, generation)) {
            return;
        }

        logger.info("Register DingTalk stream bot. robotCode={}, resourceId={}, resourceName={}, appId={}, clientIdSuffix={}",
                robotCode,
                robotConfig.getResourceId(),
                robotConfig.getResourceName(),
                robotConfig.getAppId(),
                maskClientId(robotConfig.getClientId()));

        OpenDingTalkClient client;
        try {
            client = openDingTalkClientFactory.apply(robotConfig);
        } catch (RuntimeException e) {
            handleSynchronousStartFailure(robotConfig, generation, attemptNumber, e);
            return;
        }
        clientStopFlags.put(client, new AtomicBoolean());
        openDingTalkClients.put(robotCode, client);
        startAttemptsInFlight.add(client);
        startAttemptSettled.put(client, new CompletableFuture<>());
        try {
            streamExecutor.submit(() -> runStartAttempt(robotConfig, generation, attemptNumber, client));
        } catch (RejectedExecutionException e) {
            startAttemptsInFlight.remove(client);
            CompletableFuture<Void> settled = startAttemptSettled.remove(client);
            if (settled != null) {
                settled.complete(null);
            }
            openDingTalkClients.remove(robotCode, client);
            if (stopClientQuietly(client, robotCode)) {
                handleSynchronousStartFailure(robotConfig, generation, attemptNumber, e);
            }
        }
    }

    private void runStartAttempt(
            DingtalkRobotChannelConfig robotConfig,
            long generation,
            int attemptNumber,
            OpenDingTalkClient client) {
        String robotCode = robotConfig.getRobotCode();
        try {
            if (!isCurrentClientIdentity(robotCode, generation, client)) {
                return;
            }
            if (!isConnectionLeaseLocallyValid(robotCode)) {
                closeExpiredLeaseClient(robotCode, generation, client);
                return;
            }
            try {
                client.start();
                if (!isCurrentClientIdentity(robotCode, generation, client)) {
                    return;
                }
                if (!isConnectionLeaseLocallyValid(robotCode)) {
                    closeExpiredLeaseClient(robotCode, generation, client);
                    return;
                }
                activeRobotConfigs.put(robotCode, robotConfig);
                logger.info("DingTalk stream bot started. topic={}, robotCode={}, resourceId={}, resourceName={}, appId={}",
                        DingtalkStreamBotLifecycle.BOT_MESSAGE_TOPIC,
                        robotCode,
                        robotConfig.getResourceId(),
                        robotConfig.getResourceName(),
                        robotConfig.getAppId());
            } catch (Exception e) {
                openDingTalkClients.remove(robotCode, client);
                activeRobotConfigs.remove(robotCode);
                dingtalkTokenService.evictAccessTokensByRobotCode(robotCode);
                if (stopClientQuietly(client, robotCode)) {
                    handleSynchronousStartFailure(robotConfig, generation, attemptNumber, e);
                }
            }
        } finally {
            startAttemptsInFlight.remove(client);
            CompletableFuture<Void> settled = startAttemptSettled.remove(client);
            if (settled != null) {
                settled.complete(null);
            }
            if (!openDingTalkClients.containsValue(client)) {
                clientStopFlags.remove(client);
            }
        }
    }

    private void handleSynchronousStartFailure(
            DingtalkRobotChannelConfig robotConfig, long generation, int attemptNumber, Exception failure) {
        String robotCode = robotConfig.getRobotCode();
        if (!isCurrentGeneration(robotCode, generation)) {
            return;
        }
        int maxAttempts = Math.max(1, properties.getLifecycle().getMaxStartAttempts());
        List<Long> retryDelays = properties.getLifecycle().getStartRetryDelaysMillis();
        if (attemptNumber >= maxAttempts || retryDelays == null || retryDelays.size() < attemptNumber) {
            clearStartingIfCurrent(robotCode, generation);
            logger.error("Failed to start DingTalk stream bot after retry budget. robotCode={}, resourceId={}, attempt={}",
                    robotCode, robotConfig.getResourceId(), attemptNumber, failure);
            return;
        }
        long delayMillis = Math.max(0L, retryDelays.get(attemptNumber - 1));
        logger.warn("Retry DingTalk stream SDK runtime after synchronous start failure. robotCode={}, resourceId={}, attempt={}",
                robotCode, robotConfig.getResourceId(), attemptNumber, failure);
        try {
            lifecycleScheduler.schedule(
                    () -> startRobotClientAttempt(robotConfig, generation, attemptNumber + 1),
                    delayMillis,
                    TimeUnit.MILLISECONDS
            );
        } catch (RejectedExecutionException e) {
            clearStartingIfCurrent(robotCode, generation);
            logger.warn("Skip DingTalk stream retry because lifecycle scheduler is closed. robotCode={}", robotCode, e);
        }
    }

    private void clearStartingIfCurrent(String robotCode, long generation) {
        if (Long.valueOf(generation).equals(currentGenerations.get(robotCode))) {
            startingRobotCodes.remove(robotCode);
        }
    }

    private OpenDingTalkClient buildOpenDingTalkClient(DingtalkRobotChannelConfig robotConfig) {
        OpenDingTalkStreamClientBuilder builder = OpenDingTalkStreamClientBuilder
                .custom()
                .credential(new AuthClientCredential(robotConfig.getClientId(), robotConfig.getClientSecret()))
                .registerCallbackListener(DingtalkStreamBotLifecycle.BOT_MESSAGE_TOPIC, dingtalkBotListener);
        return builder.build();
    }

    private boolean stopRobotClient(String robotCode, boolean releaseLease) {
        currentGenerations.remove(robotCode);
        startingRobotCodes.remove(robotCode);
        OpenDingTalkClient client = openDingTalkClients.remove(robotCode);
        dingtalkTokenService.evictAccessTokensByRobotCode(robotCode);
        if (client == null) {
            if (releaseLease) {
                releaseConnectionLease(robotCode);
            }
            return !stopFailedRobotCodes.contains(robotCode);
        }
        try {
            CompletableFuture<Void> settled = startAttemptSettled.get(client);
            if (settled != null && !settled.isDone()) {
                settled.get(Math.max(1L, properties.getLifecycle().getShutdownTimeoutSeconds()), TimeUnit.SECONDS);
            }
            stopClientOnce(client, robotCode);
            stopFailedRobotCodes.remove(robotCode);
            logger.info("DingTalk stream bot stopped. robotCode={}", robotCode);
        } catch (Exception e) {
            stopFailedRobotCodes.add(robotCode);
            logger.warn("Failed to stop DingTalk stream bot gracefully. robotCode={}", robotCode, e);
            return false;
        }
        if (releaseLease) {
            releaseConnectionLease(robotCode);
        }
        return true;
    }

    private void stopClientOnce(OpenDingTalkClient client, String robotCode) throws Exception {
        AtomicBoolean stopFlag = clientStopFlags.computeIfAbsent(client, ignored -> new AtomicBoolean());
        if (stopFlag.compareAndSet(false, true)) {
            client.stop();
        }
        if (!openDingTalkClients.containsValue(client) && !startAttemptsInFlight.contains(client)) {
            clientStopFlags.remove(client, stopFlag);
        }
    }

    private boolean stopClientQuietly(OpenDingTalkClient client, String robotCode) {
        try {
            stopClientOnce(client, robotCode);
            return true;
        } catch (Exception e) {
            stopFailedRobotCodes.add(robotCode);
            currentGenerations.remove(robotCode);
            startingRobotCodes.remove(robotCode);
            logger.warn("Failed to stop stale DingTalk stream client. robotCode={}", robotCode, e);
            return false;
        }
    }

    private boolean isCurrentGeneration(String robotCode, long generation) {
        return !shutdown.get()
                && Long.valueOf(generation).equals(currentGenerations.get(robotCode))
                && isConnectionLeaseLocallyValid(robotCode);
    }

    private boolean isCurrentClientIdentity(String robotCode, long generation, OpenDingTalkClient client) {
        return !shutdown.get()
                && Long.valueOf(generation).equals(currentGenerations.get(robotCode))
                && openDingTalkClients.get(robotCode) == client;
    }

    private boolean isConnectionLeaseLocallyValid(String robotCode) {
        Long validUntil = leaseValidUntilNanos.get(robotCode);
        return validUntil != null && System.nanoTime() < validUntil;
    }

    private void closeExpiredLeaseClient(String robotCode, long generation, OpenDingTalkClient client) {
        if (!Long.valueOf(generation).equals(currentGenerations.get(robotCode))) {
            return;
        }
        currentGenerations.remove(robotCode, generation);
        openDingTalkClients.remove(robotCode, client);
        activeRobotConfigs.remove(robotCode);
        startingRobotCodes.remove(robotCode);
        stopClientQuietly(client, robotCode);
        releaseConnectionLease(robotCode);
        logger.error("Discard DingTalk stream runtime because the local lease deadline expired. robotCode={}", robotCode);
    }

    boolean isRobotClientActive(String robotCode) {
        return activeRobotConfigs.containsKey(robotCode);
    }

    void renewConnectionLeases() {
        for (Map.Entry<String, String> entry : new HashMap<>(leaseOwnerTokens).entrySet()) {
            boolean renewed;
            try {
                renewed = isConnectionLeaseLocallyValid(entry.getKey())
                        && connectionLockService.renew(entry.getKey(), entry.getValue());
            } catch (RuntimeException e) {
                renewed = false;
                logger.error("DingTalk stream connection lease renewal failed. robotCode={}", entry.getKey(), e);
            }
            if (!renewed) {
                synchronized (refreshLock) {
                    if (safeEquals(leaseOwnerTokens.get(entry.getKey()), entry.getValue())) {
                        logger.error("Lost DingTalk stream connection lease. Stop local runtime. robotCode={}", entry.getKey());
                        stopRobotClient(entry.getKey(), true);
                        activeRobotConfigs.remove(entry.getKey());
                    }
                }
            } else {
                leaseValidUntilNanos.put(entry.getKey(), newLeaseValidUntilNanos());
            }
        }
    }

    private void renewConnectionLeasesQuietly() {
        try {
            renewConnectionLeases();
        } catch (RuntimeException e) {
            logger.error("Failed to renew DingTalk stream connection leases", e);
        }
    }

    private boolean acquireConnectionLease(String robotCode) {
        if (leaseOwnerTokens.containsKey(robotCode)) {
            return true;
        }
        String ownerToken = connectionLockService.newOwnerToken();
        if (!connectionLockService.acquire(robotCode, ownerToken)) {
            return false;
        }
        leaseOwnerTokens.put(robotCode, ownerToken);
        leaseValidUntilNanos.put(robotCode, newLeaseValidUntilNanos());
        return true;
    }

    private void releaseConnectionLease(String robotCode) {
        String ownerToken = leaseOwnerTokens.remove(robotCode);
        leaseValidUntilNanos.remove(robotCode);
        if (ownerToken != null) {
            connectionLockService.release(robotCode, ownerToken);
        }
    }

    private long newLeaseValidUntilNanos() {
        long ttlSeconds = Math.max(1L, connectionLockService.ttlSeconds());
        long safetySeconds = Math.max(1L, Math.min(ttlSeconds / 3L,
                properties.getLifecycle().getLeaseRenewIntervalSeconds()));
        long validSeconds = Math.max(1L, ttlSeconds - safetySeconds);
        return System.nanoTime() + TimeUnit.SECONDS.toNanos(validSeconds);
    }

    private boolean isConfigChanged(DingtalkRobotChannelConfig currentConfig, DingtalkRobotChannelConfig desiredConfig) {
        return !safeEquals(currentConfig.getClientId(), desiredConfig.getClientId())
                || !safeEquals(currentConfig.getClientSecret(), desiredConfig.getClientSecret());
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

    private static class LifecycleThreadFactory implements ThreadFactory {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "dingtalk-stream-lifecycle");
            thread.setDaemon(true);
            return thread;
        }
    }
}
