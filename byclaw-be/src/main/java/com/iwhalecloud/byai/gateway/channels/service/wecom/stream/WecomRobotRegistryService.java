package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomWsClient;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomWsClientFactory;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomWsClientListener;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomWsCmd;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyQueue;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyDispatcher;

import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Discovers WeCom digital employees and maintains one long connection per bot,
 * mirroring {@code DingtalkRobotRegistryService} but with a local
 * {@link WecomWsClient} + Redis single-active lock (plan §Task 9).
 *
 * <p>Per bot: acquire the Redis lock (fencing token) → build a
 * {@link WecomWsClient} whose reply queue/dispatcher are bound to that socket →
 * route callbacks to the shared {@link WecomMessageListener}. A scheduler renews
 * the lock; if the lock is lost, that bot's connection is stopped.
 */
@Service
public class WecomRobotRegistryService {

    private static final Logger logger = LoggerFactory.getLogger(WecomRobotRegistryService.class);
    private static final String WECOM_CHANNEL = "WeCom";
    private static final long ACK_TIMEOUT_MS = 5_000L;
    private static final int MAX_REPLY_QUEUE_SIZE = 500;

    private final WecomStreamProperties properties;
    private final WecomRobotConfigService configService;
    private final WecomConnectionLockService lockService;
    private final WecomWsClientFactory clientFactory;
    private final WecomMessageListener messageListener;
    private final SsResExtDigEmployeeService digEmployeeService;
    private final ObjectMapper objectMapper;

    private final Object refreshLock = new Object();
    private final Map<String, Connection> connections = new ConcurrentHashMap<>();
    private final ScheduledExecutorService lockRenewer =
            Executors.newSingleThreadScheduledExecutor(new NamedThreadFactory("wecom-lock-renew"));

    public WecomRobotRegistryService(WecomStreamProperties properties,
                                     WecomRobotConfigService configService,
                                     WecomConnectionLockService lockService,
                                     WecomWsClientFactory clientFactory,
                                     WecomMessageListener messageListener,
                                     SsResExtDigEmployeeService digEmployeeService,
                                     ObjectMapper objectMapper) {
        this.properties = properties;
        this.configService = configService;
        this.lockService = lockService;
        this.clientFactory = clientFactory;
        this.messageListener = messageListener;
        this.digEmployeeService = digEmployeeService;
        this.objectMapper = objectMapper;
    }

    /** One running bot connection: client + its per-connection reply queue/dispatcher. */
    private static final class Connection {
        final WecomRobotChannelConfig config;
        final WecomWsClient client;
        final WecomReplyQueue replyQueue;

        Connection(WecomRobotChannelConfig config, WecomWsClient client, WecomReplyQueue replyQueue) {
            this.config = config;
            this.client = client;
            this.replyQueue = replyQueue;
        }
    }

    /** Startup discovery: connect every online WeCom digital employee we can lock. */
    public void initializeRobotClients() {
        synchronized (refreshLock) {
            if (!properties.isEnabled()) {
                logger.info("WeCom stream disabled. Set channel.stream.enabled=true to enable.");
                return;
            }
            List<ResourceExtDigEmployeeDto> employees = findWecomDigitalEmployees();
            for (ResourceExtDigEmployeeDto employee : employees) {
                if (employee != null) {
                    registerRobotClientsForResource(employee.getResourceId());
                }
            }
            startLockRenewer();
            logger.info("WeCom stream bot registration finished. connectedBots={}", connections.size());
        }
    }

    /**
     * Run a registry mutation AFTER the current DB transaction commits (if one
     * is active), else immediately. Starting/refreshing external long
     * connections inside an open transaction would act on uncommitted state and
     * hold connection work against the tx; deferring to afterCommit avoids that.
     */
    private void runAfterCommitOrNow(Runnable task) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }

    public void registerRobotClientsForResource(Long resourceId) {
        runAfterCommitOrNow(() -> doRegisterRobotClientsForResource(resourceId));
    }

    private void doRegisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (!properties.isEnabled() || resourceId == null) {
                return;
            }
            ResourceExtDigEmployeeDto employee = digEmployeeService.findExtDigEmployeeById(resourceId);
            if (employee == null) {
                return;
            }
            List<WecomRobotChannelConfig> configs = configService.buildRobotConfigs(employee);
            configService.replaceRobotConfigsForResource(resourceId, configs);
            for (WecomRobotChannelConfig config : configs) {
                startConnection(config);
            }
        }
    }

    public void refreshRobotClientsForResource(Long resourceId) {
        runAfterCommitOrNow(() -> doRefreshRobotClientsForResource(resourceId));
    }

    private void doRefreshRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (!properties.isEnabled() || resourceId == null) {
                return;
            }
            ResourceExtDigEmployeeDto employee = digEmployeeService.findExtDigEmployeeById(resourceId);
            List<WecomRobotChannelConfig> desired = employee == null
                    ? Collections.emptyList()
                    : configService.buildRobotConfigs(employee);
            Map<String, WecomRobotChannelConfig> desiredByBot = new ConcurrentHashMap<>();
            for (WecomRobotChannelConfig c : desired) {
                desiredByBot.put(c.getBotId(), c);
            }
            List<WecomRobotChannelConfig> current = configService.getRobotConfigsByResourceId(resourceId);
            for (WecomRobotChannelConfig cur : current) {
                WecomRobotChannelConfig want = desiredByBot.get(cur.getBotId());
                if (want == null || isChanged(cur, want)) {
                    stopConnection(cur.getBotId());
                }
            }
            configService.replaceRobotConfigsForResource(resourceId, desired);
            for (WecomRobotChannelConfig c : desired) {
                if (!connections.containsKey(c.getBotId())) {
                    startConnection(c);
                }
            }
        }
    }

    public void unregisterRobotClientsForResource(Long resourceId) {
        runAfterCommitOrNow(() -> doUnregisterRobotClientsForResource(resourceId));
    }

    private void doUnregisterRobotClientsForResource(Long resourceId) {
        synchronized (refreshLock) {
            if (resourceId == null) {
                return;
            }
            for (WecomRobotChannelConfig c : configService.getRobotConfigsByResourceId(resourceId)) {
                stopConnection(c.getBotId());
            }
            configService.removeRobotConfigsByResourceId(resourceId);
        }
    }

    private void startConnection(WecomRobotChannelConfig config) {
        String botId = config.getBotId();
        if (connections.containsKey(botId)) {
            logger.info("WeCom bot already connected, skip. resourceId={}", config.getResourceId());
            return;
        }
        if (!lockService.acquire(botId)) {
            logger.info("WeCom bot lock held by another instance, skip. resourceId={}", config.getResourceId());
            return;
        }

        // Exception-safe: if client build/connect throws after acquiring the
        // lock, release the lock and drop the connection entry so a dead bot
        // never holds the lock without a usable connection.
        try {
            // Build the connection: client first (so its sendRaw feeds the queue),
            // then queue+dispatcher, then a listener adapter routing callbacks.
            final Connection[] holder = new Connection[1];
            WecomWsClient client = clientFactory.create(config, new ConnectionListener(() -> holder[0]));
            WecomReplyQueue replyQueue = new WecomReplyQueue(
                    client::sendRaw, lockRenewer, ACK_TIMEOUT_MS, MAX_REPLY_QUEUE_SIZE);
            Connection connection = new Connection(config, client, replyQueue);
            holder[0] = connection;
            connections.put(botId, connection);
            client.connect();
            logger.info("WeCom bot connecting. resourceId={}", config.getResourceId());
        } catch (RuntimeException e) {
            connections.remove(botId);
            lockService.release(botId);
            logger.error("Failed to start WeCom bot, released lock. resourceId={}", config.getResourceId(), e);
        }
    }

    private void stopConnection(String botId) {
        Connection connection = connections.remove(botId);
        if (connection != null) {
            try {
                connection.client.disconnect();
                connection.replyQueue.failAll("connection stopped");
            } catch (Exception e) {
                logger.warn("Error stopping WeCom bot. resourceId={}", connection.config.getResourceId(), e);
            }
        }
        lockService.release(botId);
    }

    private void startLockRenewer() {
        long renewPeriod = Math.max(10L, lockService.lockTtlSeconds() / 3);
        lockRenewer.scheduleAtFixedRate(() -> {
            for (Connection connection : new ArrayList<>(connections.values())) {
                String botId = connection.config.getBotId();
                if (!lockService.renew(botId)) {
                    logger.warn("WeCom bot lock lost, stopping connection. resourceId={}",
                            connection.config.getResourceId());
                    stopConnection(botId);
                }
            }
        }, renewPeriod, renewPeriod, TimeUnit.SECONDS);
    }

    private List<ResourceExtDigEmployeeDto> findWecomDigitalEmployees() {
        List<ResourceExtDigEmployeeDto> employees = digEmployeeService.findOnlineDigitalEmployees(WECOM_CHANNEL);
        return employees == null ? Collections.emptyList() : employees;
    }

    private boolean isChanged(WecomRobotChannelConfig a, WecomRobotChannelConfig b) {
        return !safeEquals(a.getBotId(), b.getBotId())
                || !safeEquals(a.getSecret(), b.getSecret())
                || !safeEquals(a.getResourceId(), b.getResourceId());
    }

    private boolean safeEquals(Object l, Object r) {
        return l == null ? r == null : l.equals(r);
    }

    @PreDestroy
    public void shutdownAll() {
        synchronized (refreshLock) {
            for (String botId : new ArrayList<>(connections.keySet())) {
                stopConnection(botId);
            }
            lockRenewer.shutdownNow();
        }
    }

    /** Per-connection listener: routes frames to the shared listener + reply queue. */
    private final class ConnectionListener implements WecomWsClientListener {
        private final java.util.function.Supplier<Connection> self;
        private WecomReplyDispatcher dispatcher;

        ConnectionListener(java.util.function.Supplier<Connection> self) {
            this.self = self;
        }

        private synchronized WecomReplyDispatcher dispatcher() {
            if (dispatcher == null) {
                Connection c = self.get();
                dispatcher = new WecomReplyDispatcher(objectMapper, c.replyQueue);
            }
            return dispatcher;
        }

        @Override
        public void onCallback(WecomWsFrame frame) {
            String cmd = frame.getCmd();
            if (WecomWsCmd.EVENT_CALLBACK.equals(cmd)) {
                messageListener.onEventCallback(frame, dispatcher());
            } else {
                messageListener.onMessageCallback(frame, dispatcher());
            }
        }

        @Override
        public void onReplyAck(WecomWsFrame frame) {
            self.get().replyQueue.onAck(frame);
        }

        @Override
        public boolean canReconnect() {
            // Ownership gate before a network-drop reconnect: CAS-renew the Redis
            // lock. If we no longer own it (TTL expired while we were down and
            // another instance took the bot over), returning false stops this
            // client instead of reconnecting and kicking the new owner offline.
            Connection c = self.get();
            if (c == null) {
                return false;
            }
            String botId = c.config.getBotId();
            boolean stillOwner = lockService.renew(botId);
            if (!stillOwner) {
                logger.warn("WeCom reconnect denied: lock no longer owned. resourceId={}",
                        c.config.getResourceId());
            }
            return stillOwner;
        }

        @Override
        public void onServerTakeover(String reason) {
            Connection c = self.get();
            if (c != null) {
                stopConnection(c.config.getBotId());
            }
        }

        @Override
        public void onExhausted(String reason) {
            // Terminal: reconnect/auth retries exhausted. Stop the connection and
            // release the Redis lock so another instance can take the bot over.
            Connection c = self.get();
            if (c != null) {
                logger.warn("WeCom bot exhausted ({}), releasing for takeover. resourceId={}",
                        reason, c.config.getResourceId());
                stopConnection(c.config.getBotId());
            }
        }

        @Override
        public void onDisconnected(String reason) {
            Connection c = self.get();
            if (c != null) {
                c.replyQueue.failAll("connection closed: " + reason);
            }
        }
    }

    private static final class NamedThreadFactory implements ThreadFactory {
        private final String prefix;
        private final AtomicInteger counter = new AtomicInteger(1);

        NamedThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, prefix + "-" + counter.getAndIncrement());
            t.setDaemon(true);
            return t;
        }
    }
}
