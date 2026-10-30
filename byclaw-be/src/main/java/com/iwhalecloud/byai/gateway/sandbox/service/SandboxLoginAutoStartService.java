package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import com.alibaba.ttl.TtlRunnable;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.common.exception.StoragePreparingException;
import jakarta.annotation.PreDestroy;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.ttl.threadpool.TtlExecutors;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;

/**
 * 用户登录后的沙箱服务自启动编排。
 */
@Service
public class SandboxLoginAutoStartService {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxLoginAutoStartService.class);

    private final SandboxServiceSpecEntityMapper serviceSpecMapper;
    private final SandboxService sandboxService;
    private final Executor executor;
    private final ScheduledExecutorService retryScheduler;

    private static ScheduledExecutorService newRetryScheduler() {
        return Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "sandbox-login-retry");
            thread.setDaemon(true);
            return thread;
        });
    }
    private static final int MAX_RETRIES = 80;
    private final Map<String, Object> inProgressUsers = new ConcurrentHashMap<>();

    @Autowired
    public SandboxLoginAutoStartService(SandboxServiceSpecEntityMapper serviceSpecMapper,
                                        SandboxService sandboxService,
                                        @Qualifier("defaultAsyncExecutor") Executor executor) {
        this(serviceSpecMapper, sandboxService, executor, newRetryScheduler());
    }

    SandboxLoginAutoStartService(SandboxServiceSpecEntityMapper serviceSpecMapper,
                                SandboxService sandboxService, Executor executor,
                                ScheduledExecutorService retryScheduler) {
        this.retryScheduler = retryScheduler;
        this.serviceSpecMapper = serviceSpecMapper;
        this.sandboxService = sandboxService;
        this.executor = TtlExecutors.getTtlExecutor(executor);
    }

    @PreDestroy
    public void shutdown() {
        inProgressUsers.clear();
        retryScheduler.shutdownNow();
    }

    /**
     * 异步启动用户已开启自启动的全部沙箱服务，同一用户的进行中任务只保留一个。
     */
    public void trigger(String userCode) {
        String normalizedUserCode = StringUtils.trimToNull(userCode);
        Object generation = new Object();
        if (normalizedUserCode == null || inProgressUsers.putIfAbsent(normalizedUserCode, generation) != null) {
            return;
        }

        try {
            executor.execute(() -> autoStart(normalizedUserCode, generation));
        }
        catch (RuntimeException e) {
            inProgressUsers.remove(normalizedUserCode, generation);
            LOGGER.error("提交登录沙箱自启动任务失败，用户编码：{}", normalizedUserCode, e);
        }
    }

    private void autoStart(String userCode, Object generation) {
        boolean pending = false;
        try {
            List<SandboxServiceSpecEntity> specs = serviceSpecMapper.selectAutoStartSpecs();
            if (specs == null || specs.isEmpty()) {
                return;
            }

            Set<String> serviceKeys = new LinkedHashSet<>();
            for (SandboxServiceSpecEntity spec : specs) {
                if (spec != null && StringUtils.isNotBlank(spec.getServiceKey())) {
                    serviceKeys.add(spec.getServiceKey().trim());
                }
            }

            if (serviceKeys.contains(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE)) {
                String preferred = StringUtils.trimToNull(sandboxService.getPreferredServiceKey(userCode));
                if (preferred != null) {
                    serviceKeys.remove(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
                    serviceKeys.add(preferred);
                }
            }

            pending = launchPending(userCode, serviceKeys, 0, generation);
        }
        catch (Exception e) {
            LOGGER.error("查询登录自启动沙箱服务失败，用户编码：{}", userCode, e);
        }
        finally {
            if (!pending) inProgressUsers.remove(userCode, generation);
        }
    }

    // Retain only services blocked by storage; successful services must not be launched again.
    private boolean launchPending(String userCode, Set<String> serviceKeys, int attempt, Object generation) {
        if (inProgressUsers.get(userCode) != generation) return false;
        Set<String> pending = new LinkedHashSet<>();
        for (String serviceKey : serviceKeys) {
            if (inProgressUsers.get(userCode) != generation) return false;
            try {
                sandboxService.launchSandboxWithServiceKey(userCode, serviceKey);
            }
            catch (Exception failure) {
                if (isStoragePreparing(failure) && attempt < MAX_RETRIES) {
                    pending.add(serviceKey);
                }
                else {
                    LOGGER.error("登录沙箱启动结束，用户编码：{}，serviceKey：{}，attempt：{}",
                        userCode, serviceKey, attempt, failure);
                }
            }
        }
        if (pending.isEmpty()) return false;
        LOGGER.info("登录沙箱等待存储就绪，用户编码：{}，services：{}，attempt：{}",
            userCode, pending, attempt);
        Runnable retry = TtlRunnable.get(() -> {
            try {
                executor.execute(() -> {
                    boolean scheduled = false;
                    try {
                        scheduled = launchPending(userCode, pending, attempt + 1, generation);
                    }
                    finally {
                        if (!scheduled) inProgressUsers.remove(userCode, generation);
                    }
                });
            }
            catch (RuntimeException failure) {
                inProgressUsers.remove(userCode, generation);
                LOGGER.error("提交登录沙箱重试失败，用户编码：{}", userCode, failure);
            }
        });
        retryScheduler.schedule(retry, 15, TimeUnit.SECONDS);
        return true;
    }

    /** A manual release cancels queued login retries; a later login starts a new generation. */
    public void cancel(String userCode) {
        if (userCode != null) inProgressUsers.remove(userCode.trim());
    }

    private boolean isStoragePreparing(Exception failure) {
        if (!(failure instanceof BdpRuntimeException businessFailure)) return false;
        String code = businessFailure.getErrorService();
        return failure instanceof StoragePreparingException
            || "SHARED_USER_NAS_WAITING_QUOTA".equals(code)
            || "SHARED_USER_NAS_PREPARING_STORAGE".equals(code)
            || "NAS_SPACE_NOT_READY".equals(code)
            || "NAS_SPACE_NOT_READY".equals(failure.getMessage());
    }
}
