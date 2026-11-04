package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import java.util.Map;
import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Runs outside the import transaction and never turns a committed import into an HTTP failure. */
@Component
public class ResourceSyncDispatcher {
    private static final Logger log = LoggerFactory.getLogger(ResourceSyncDispatcher.class);
    private final ResourceSyncReconcileService reconciler;
    private final Executor executor;

    public ResourceSyncDispatcher(ResourceSyncReconcileService reconciler,
        @Qualifier("resourceSyncExecutor") Executor executor,
        @Value("${byai.resource-sync.response-wait-ms:5000}") long waitMillis) {
        this.reconciler = reconciler;
        this.executor = executor;
    }

    public Map<String, Object> dispatch(Long jobId) {
        try {
            executor.execute(() -> {
                try { reconciler.reconcileNow(jobId); }
                catch (Exception failure) { log.warn("资源同步保留后台恢复任务, jobId={}", jobId, failure); }
            });
        } catch (Exception failure) {
            log.warn("资源同步队列繁忙，任务已持久化等待调度, jobId={}", jobId, failure);
        }
        return Map.of("jobId", String.valueOf(jobId), "status", "PENDING", "effective", false, "result", Map.of());
    }
}
