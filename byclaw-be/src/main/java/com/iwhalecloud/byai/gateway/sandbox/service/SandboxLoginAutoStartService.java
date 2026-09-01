package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
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
    private final Set<String> inProgressUsers = ConcurrentHashMap.newKeySet();

    public SandboxLoginAutoStartService(SandboxServiceSpecEntityMapper serviceSpecMapper,
                                        SandboxService sandboxService,
                                        @Qualifier("defaultAsyncExecutor") Executor executor) {
        this.serviceSpecMapper = serviceSpecMapper;
        this.sandboxService = sandboxService;
        this.executor = TtlExecutors.getTtlExecutor(executor);
    }

    /**
     * 异步启动用户已开启自启动的全部沙箱服务，同一用户的进行中任务只保留一个。
     */
    public void trigger(String userCode) {
        String normalizedUserCode = StringUtils.trimToNull(userCode);
        if (normalizedUserCode == null || !inProgressUsers.add(normalizedUserCode)) {
            return;
        }

        try {
            executor.execute(() -> autoStart(normalizedUserCode));
        }
        catch (RuntimeException e) {
            inProgressUsers.remove(normalizedUserCode);
            LOGGER.error("提交登录沙箱自启动任务失败，用户编码：{}", normalizedUserCode, e);
        }
    }

    private void autoStart(String userCode) {
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

            for (String serviceKey : serviceKeys) {
                try {
                    sandboxService.launchSandboxWithServiceKey(userCode, serviceKey);
                }
                catch (Exception e) {
                    LOGGER.error("登录后自动启动沙箱服务失败，用户编码：{}，serviceKey：{}", userCode, serviceKey, e);
                }
            }
        }
        catch (Exception e) {
            LOGGER.error("查询登录自启动沙箱服务失败，用户编码：{}", userCode, e);
        }
        finally {
            inProgressUsers.remove(userCode);
        }
    }
}
