package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceRegistry;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceRegistrationTarget;
import jakarta.annotation.PreDestroy;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import redis.clients.jedis.Jedis;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 资源级服务注册/反注册服务。
 *
 * 设计目标：
 * 1. 统一接收资源导入后生成的 targetContent，解析 domainName/domainURL 并注册。
 * 2. 导入更新时支持先反注册旧服务，再注册新服务。
 * 3. 删除资源时做反注册。
 * 4. 所有注册/反注册失败只记录日志，不影响原导入、更新、删除主流程。
 *
 * @author qin.guoquan
 * @date 2026-04-20 16:03:38
 */
@Service
public class ResourceDiscoveryRegistrationService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourceDiscoveryRegistrationService.class);

    private static final int DEFAULT_WEIGHT = 1;

    private static final int DEFAULT_HEARTBEAT_SECONDS = 5;

    private static final String SD_SERVICES_KEY = "byai_gateway:sd:services";

    private static final String SD_INSTANCE_DETAILS_PREFIX = "byai_gateway:sd:instances:";

    private static final String SD_ACTIVE_INSTANCES_PREFIX = "byai_gateway:sd:active:";

    @Autowired
    private RedisClient redisClient;

    /**
     * 资源服务注册器缓存。
     *
     * 不能复用应用本身的 ServiceRegistry Bean，否则会覆盖应用实例自己的 currentInstance，
     * 因此这里按资源服务名单独 new ServiceRegistry(redisClient) 并维护自己的生命周期。
     */
    private final Map<String, ServiceRegistry> resourceRegistryMap = new ConcurrentHashMap<>();

    public void registerAfterCommit(String resourceBizType, Long resourceId, String resourceCode, String targetContent) {
        ResourceRegistrationTarget target = buildTarget(resourceBizType, resourceId, resourceCode, targetContent);
        if (target == null) {
            return;
        }
        LOGGER.info(
            "资源服务注册任务已提交, action=register, resourceBizType={}, resourceId={}, resourceCode={}, serviceName={}, serviceUrl={}",
            resourceBizType, resourceId, resourceCode, target.getServiceName(), target.getServiceUrl());
        runAfterCommit(() -> registerQuietly(target));
    }

    public void reregisterAfterCommit(String resourceBizType, Long resourceId, String resourceCode,
        String oldTargetContent, String newTargetContent) {
        ResourceRegistrationTarget oldTarget = buildTarget(resourceBizType, resourceId, resourceCode, oldTargetContent);
        ResourceRegistrationTarget newTarget = buildTarget(resourceBizType, resourceId, resourceCode, newTargetContent);
        if (oldTarget == null && newTarget == null) {
            return;
        }
        LOGGER.info(
            "资源服务注册任务已提交, action=reregister, resourceBizType={}, resourceId={}, resourceCode={}, oldServiceName={}, newServiceName={}, oldServiceUrl={}, newServiceUrl={}",
            resourceBizType, resourceId, resourceCode,
            oldTarget == null ? null : oldTarget.getServiceName(),
            newTarget == null ? null : newTarget.getServiceName(),
            oldTarget == null ? null : oldTarget.getServiceUrl(),
            newTarget == null ? null : newTarget.getServiceUrl());
        runAfterCommit(() -> {
            if (oldTarget != null) {
                unregisterQuietly(oldTarget.getServiceName(), resourceBizType, resourceId, resourceCode);
            }
            if (newTarget != null) {
                registerQuietly(newTarget);
            }
        });
    }

    public void unregisterAfterCommit(String resourceBizType, Long resourceId, String resourceCode, String targetContent) {
        ResourceRegistrationTarget target = buildTarget(resourceBizType, resourceId, resourceCode, targetContent);
        if (target == null) {
            return;
        }
        LOGGER.info(
            "资源服务注册任务已提交, action=unregister, resourceBizType={}, resourceId={}, resourceCode={}, serviceName={}, serviceUrl={}",
            resourceBizType, resourceId, resourceCode, target.getServiceName(), target.getServiceUrl());
        runAfterCommit(() -> unregisterQuietly(target.getServiceName(), resourceBizType, resourceId, resourceCode));
    }

    private void runAfterCommit(Runnable task) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            LOGGER.info("资源服务注册任务将在事务提交后执行");
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    LOGGER.info("资源服务注册任务开始执行 afterCommit 回调");
                    task.run();
                }
            });
            return;
        }
        LOGGER.info("资源服务注册任务当前无事务上下文，立即执行");
        task.run();
    }

    private void registerQuietly(ResourceRegistrationTarget target) {
        try {
            LOGGER.info(
                "资源服务开始注册, serviceName={}, serviceUrl={}, host={}, port={}, path={}, metadata={}",
                target.getServiceName(), target.getServiceUrl(), target.getHost(), target.getPort(), target.getPath(),
                target.getMetadata());
            ServiceRegistry oldRegistry = resourceRegistryMap.remove(target.getServiceName());
            if (oldRegistry != null) {
                try {
                    oldRegistry.unregister();
                } catch (Exception e) {
                    LOGGER.warn("资源服务旧注册实例注销失败，继续覆盖注册, serviceName={}, reason={}",
                        target.getServiceName(), e.getMessage());
                }
            }
            cleanupRegistryKeys(target.getServiceName());

            ServiceRegistry registry = new ServiceRegistry(redisClient);

            // 注册地址
            registry.register(target.getServiceName(), target.getHost(), target.getPort(), target.getPath(),
                DEFAULT_WEIGHT, target.getMetadata(), DEFAULT_HEARTBEAT_SECONDS);

            resourceRegistryMap.put(target.getServiceName(), registry);

            LOGGER.info(
                "资源服务注册成功, serviceName={}, serviceUrl={}, host={}, port={}, path={}, metadata={}",
                target.getServiceName(), target.getServiceUrl(), target.getHost(), target.getPort(), target.getPath(),
                target.getMetadata());
        } catch (Exception e) {
            LOGGER.error("资源服务注册失败，不影响原流程, serviceName={}, serviceUrl={}, reason={}",
                target.getServiceName(), target.getServiceUrl(), e.getMessage(), e);
        }
    }

    private void unregisterQuietly(String serviceName, String resourceBizType, Long resourceId, String resourceCode) {
        if (StringUtils.isBlank(serviceName)) {
            return;
        }
        try {
            LOGGER.info("资源服务开始反注册, serviceName={}, resourceBizType={}, resourceId={}, resourceCode={}",
                serviceName, resourceBizType, resourceId, resourceCode);
            ServiceRegistry registry = resourceRegistryMap.remove(serviceName);
            if (registry != null) {
                try {
                    registry.unregister();
                } catch (Exception e) {
                    LOGGER.warn("资源服务注册实例注销失败，继续做Redis清理, serviceName={}, reason={}",
                        serviceName, e.getMessage());
                }
            }
            cleanupRegistryKeys(serviceName);
            LOGGER.info("资源服务反注册完成, serviceName={}, resourceBizType={}, resourceId={}, resourceCode={}",
                serviceName, resourceBizType, resourceId, resourceCode);
        } catch (Exception e) {
            LOGGER.error("资源服务反注册失败，不影响原流程, serviceName={}, resourceBizType={}, resourceId={}, reason={}",
                serviceName, resourceBizType, resourceId, e.getMessage(), e);
        }
    }

    private void cleanupRegistryKeys(String serviceName) {
        try (Jedis jedis = redisClient.getResource()) {
            String instancesKey = SD_INSTANCE_DETAILS_PREFIX + serviceName;
            String activeKey = SD_ACTIVE_INSTANCES_PREFIX + serviceName;
            Map<String, String> instanceMap = jedis.hgetAll(instancesKey);
            if (instanceMap != null && !instanceMap.isEmpty()) {
                String[] instanceIds = instanceMap.keySet().toArray(new String[0]);
                jedis.hdel(instancesKey, instanceIds);
                jedis.zrem(activeKey, instanceIds);
            }
            jedis.del(instancesKey);
            jedis.del(activeKey);
            jedis.srem(SD_SERVICES_KEY, serviceName);
        }
    }

    private ResourceRegistrationTarget buildTarget(String resourceBizType, Long resourceId, String resourceCode,
        String targetContent) {
        if (StringUtils.isBlank(targetContent)) {
            LOGGER.info("资源targetContent为空，跳过服务注册目标解析, resourceBizType={}, resourceId={}, resourceCode={}",
                resourceBizType, resourceId, resourceCode);
            return null;
        }
        try {
            JSONObject root = JSON.parseObject(targetContent);
            if (root == null) {
                return null;
            }
            String serviceName = StringUtils.trimToEmpty(root.getString("domainName"));
            String serviceUrl = StringUtils.trimToEmpty(root.getString("domainURL"));
            if (StringUtils.isBlank(serviceName) || StringUtils.isBlank(serviceUrl)) {
                LOGGER.warn(
                    "资源targetContent缺少domainName或domainURL，跳过服务注册, resourceBizType={}, resourceId={}, resourceCode={}, domainName={}, domainURL={}",
                    resourceBizType, resourceId, resourceCode, serviceName, serviceUrl);
                return null;
            }

            URI uri = URI.create(serviceUrl);
            String host = StringUtils.trimToEmpty(uri.getHost());
            if (StringUtils.isBlank(host)) {
                LOGGER.warn("资源domainURL无法解析host，跳过服务注册, serviceName={}, serviceUrl={}", serviceName, serviceUrl);
                return null;
            }
            int port = resolvePort(uri);
            if (port <= 0) {
                LOGGER.warn("资源domainURL无法解析端口，跳过服务注册, serviceName={}, serviceUrl={}", serviceName, serviceUrl);
                return null;
            }

            ResourceRegistrationTarget target = new ResourceRegistrationTarget();
            target.setServiceName(serviceName);
            target.setServiceUrl(serviceUrl);
            target.setHost(host);
            target.setPort(port);
            target.setPath(StringUtils.defaultIfBlank(uri.getRawPath(), "/"));
            target.setMetadata(buildMetadata(resourceBizType, resourceId, resourceCode, serviceUrl, uri));
            LOGGER.info(
                "资源服务注册目标解析完成, resourceBizType={}, resourceId={}, resourceCode={}, serviceName={}, serviceUrl={}, host={}, port={}, path={}",
                resourceBizType, resourceId, resourceCode, target.getServiceName(), target.getServiceUrl(),
                target.getHost(), target.getPort(), target.getPath());
            return target;
        } catch (Exception e) {
            LOGGER.error(
                "资源targetContent解析服务注册目标失败，跳过本次注册/反注册, resourceBizType={}, resourceId={}, resourceCode={}, reason={}",
                resourceBizType, resourceId, resourceCode, e.getMessage(), e);
            return null;
        }
    }

    private int resolvePort(URI uri) {
        if (uri.getPort() > 0) {
            return uri.getPort();
        }
        if (StringUtils.equalsIgnoreCase(uri.getScheme(), "http")) {
            return 80;
        }
        if (StringUtils.equalsIgnoreCase(uri.getScheme(), "https")) {
            return 443;
        }
        return -1;
    }

    private Map<String, Object> buildMetadata(String resourceBizType, Long resourceId, String resourceCode,
        String serviceUrl, URI uri) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("resourceBizType", resourceBizType);
        metadata.put("resourceId", resourceId);
        metadata.put("resourceCode", resourceCode);
        metadata.put("domainURL", serviceUrl);
        metadata.put("scheme", uri.getScheme());
        metadata.put("path", StringUtils.defaultIfBlank(uri.getRawPath(), "/"));
        if (StringUtils.isNotBlank(uri.getRawQuery())) {
            metadata.put("query", uri.getRawQuery());
        }
        return metadata;
    }

    @PreDestroy
    public void shutdown() {
        resourceRegistryMap.forEach((serviceName, registry) -> {
            try {
                if (registry != null && registry.getCurrentInstance() != null) {
                    registry.unregister();
                }
            } catch (Exception e) {
                LOGGER.warn("应用关闭时资源服务注销失败, serviceName={}, reason={}", serviceName, e.getMessage());
            }
        });
        resourceRegistryMap.clear();
    }
}
