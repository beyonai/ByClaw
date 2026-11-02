package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
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
    private final long waitMillis;

    public ResourceSyncDispatcher(ResourceSyncReconcileService reconciler,
        @Qualifier("resourceSyncExecutor") Executor executor,
        @Value("${byai.resource-sync.response-wait-ms:5000}") long waitMillis) {
        this.reconciler = reconciler;
        this.executor = executor;
        this.waitMillis = Math.max(0, Math.min(waitMillis, 10000));
    }

    public Map<String, Object> dispatch(Long jobId) {
        try {
            var future = CompletableFuture.supplyAsync(() -> reconciler.reconcileNow(jobId), executor);
            ResourceSyncJob result = future.get(waitMillis, TimeUnit.MILLISECONDS);
            if (result != null) return result.associationResult();
        } catch (TimeoutException timeout) {
            // Do not cancel: the worker continues; durable status is available through queryResourceSyncJob.
            log.info("资源已接收，运行配置仍在同步, jobId={}", jobId);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            log.warn("等待资源同步结果被中断, jobId={}", jobId);
        } catch (Exception failure) {
            // Rejection or process failure leaves a durable job for the scheduler, never a false COMPLETED result.
            log.warn("资源同步即时执行未完成，保留后台恢复任务, jobId={}", jobId, failure);
        }
        return Map.of("jobId", String.valueOf(jobId), "status", "PENDING", "effective", false,
            "result", Map.of());
    }
}
