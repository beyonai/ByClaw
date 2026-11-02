package com.iwhalecloud.byai.gateway.route;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.concurrent.Executor;
import java.util.concurrent.ForkJoinPool;
import com.alibaba.ttl.TtlRunnable;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import org.springframework.context.i18n.LocaleContextHolder;

import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;

/** Ensures a user-scoped sandbox worker is online before its first Gateway send. */
@Service
public class WorkerRouteReadinessService {

    private final long readinessTimeoutMs;

    private final WorkerRegistry workerRegistry;

    private final SandboxService sandboxService;

    private final TargetAgentResolver targetAgentResolver;

    private final ConcurrentMap<RouteKey, CompletableFuture<Void>> inFlightStarts = new ConcurrentHashMap<>();

    private final ConcurrentMap<ResolutionKey, CompletableFuture<String>> inFlightResolutions = new ConcurrentHashMap<>();

    private final ConcurrentMap<RouteKey, CompletableFuture<Boolean>> inFlightChecks = new ConcurrentHashMap<>();

    @Autowired(required = false)
    @org.springframework.beans.factory.annotation.Qualifier("sandboxStartupExecutor")
    private Executor startupExecutor = ForkJoinPool.commonPool();

    public long startupDeadline() {
        return System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(readinessTimeoutMs);
    }

    public String resolveTarget(String userCode, Long resourceId, String workerAgentType, String sourceAgentType,
            long deadline) {
        ResolutionKey key = new ResolutionKey(userCode, resourceId, workerAgentType, sourceAgentType,
            TenantRequestContextHolder.get());
        return joinStartup(inFlightResolutions, key, () -> targetAgentResolver.resolveAgentType(
            workerAgentType, resourceId, sourceAgentType, userCode), deadline);
    }

    public WorkerRouteReadinessService(WorkerRegistry workerRegistry, SandboxService sandboxService,
            TargetAgentResolver targetAgentResolver) {
        this(workerRegistry, sandboxService, targetAgentResolver, SandboxService.WORKER_READY_TIMEOUT_MS);
    }

    @Autowired
    public WorkerRouteReadinessService(WorkerRegistry workerRegistry, SandboxService sandboxService,
            TargetAgentResolver targetAgentResolver,
            @Value("${byclaw.gateway.worker-readiness-timeout-ms:${BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS:60000}}") long readinessTimeoutMs) {
        if (readinessTimeoutMs < 1) throw new IllegalArgumentException("Worker readiness timeout must be positive");
        this.readinessTimeoutMs = readinessTimeoutMs;
        this.workerRegistry = workerRegistry;
        this.sandboxService = sandboxService;
        this.targetAgentResolver = targetAgentResolver;
    }

    public void ensureReady(String userCode, Long resourceId, String targetAgentType,
            Consumer<ReadinessPhase> progress) {
        ensureReady(userCode, resourceId, targetAgentType, progress, startupDeadline());
    }

    public void ensureReady(String userCode, Long resourceId, String targetAgentType,
            Consumer<ReadinessPhase> progress, long deadline) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(targetAgentType)) return;
        // Pure name filtering keeps unrelated workers out of the startup executor.
        if (!targetAgentType.startsWith("BYCLAW_DSH_SHARED_")
            && !StringUtils.equalsAnyIgnoreCase(targetAgentType, "BYCLAW_EXE_" + userCode,
                "BYCLAW_CODE_" + userCode, "HARNESS_" + userCode, "BYCLAW_DSH_" + userCode)) return;
        Consumer<ReadinessPhase> safeProgress = progress == null ? ignored -> { } : progress;
        // All potentially remote checks, including shared target ownership, share this deadline.
        RouteKey key = new RouteKey(userCode, resourceId, targetAgentType, TenantRequestContextHolder.get());
        boolean needsLaunch = joinStartup(inFlightChecks, key,
            () -> targetAgentResolver.isUserSandboxAgentType(targetAgentType, userCode) && !isOnline(targetAgentType), deadline);
        if (!needsLaunch) return;
        safeProgress.accept(ReadinessPhase.STARTING);
        safeProgress.accept(ReadinessPhase.WAITING);
        joinStartup(inFlightStarts, key, () -> {
            if (targetAgentResolver.isUserSandboxAgentType(targetAgentType, userCode) && !isOnline(targetAgentType)) {
                launchAndWait(userCode, resourceId, targetAgentType, deadline);
            }
            return null;
        }, deadline);
        safeProgress.accept(ReadinessPhase.READY);
    }

    private <K, T> T joinStartup(ConcurrentMap<K, CompletableFuture<T>> pending, K key, Supplier<T> action,
            long deadline) {
        checkInterrupted();
        if (deadline <= System.nanoTime()) throw readinessFailure();
        CompletableFuture<T> leader = new CompletableFuture<>();
        CompletableFuture<T> existing = pending.putIfAbsent(key, leader);
        if (existing == null) {
            TenantRequestContext tenant = TenantRequestContextHolder.get();
            var locale = LocaleContextHolder.getLocaleContext();
            try {
                startupExecutor.execute(TtlRunnable.get(() -> {
                    TenantRequestContext previousTenant = TenantRequestContextHolder.get();
                    var previousLocale = LocaleContextHolder.getLocaleContext();
                    try {
                        TenantRequestContextHolder.set(tenant);
                        LocaleContextHolder.setLocaleContext(locale);
                        // Queued work which never acquired ownership must not start after its budget.
                        if (deadline <= System.nanoTime()) throw readinessFailure();
                        leader.complete(action.get());
                    }
                    catch (Throwable failure) { leader.completeExceptionally(failure); }
                    finally {
                        TenantRequestContextHolder.set(previousTenant);
                        LocaleContextHolder.setLocaleContext(previousLocale);
                        pending.remove(key, leader);
                    }
                }));
            }
            catch (RuntimeException rejected) {
                pending.remove(key, leader);
                leader.completeExceptionally(rejected);
            }
            existing = leader;
        }
        // Caller timeout/cancel never cancels or removes the authoritative remote operation.
        return awaitExistingStart(existing, deadline);
    }

    private boolean isOnline(String targetAgentType) {
        WorkerRegistry.OnlineAgentCheckResult result = workerRegistry.hasOnlineAgentType(targetAgentType, true);
        return result != null && result.exists;
    }

    private void launchAndWait(String userCode, Long resourceId, String targetAgentType,
            long deadline) {
        checkInterrupted();
        SandboxLaunchData launchData = sandboxService.launchSandboxForTargetWithoutWait(
            userCode, resourceId, targetAgentType);
        if (launchData == null) throw readinessFailure();
        checkInterrupted();
        // A launch completing at the deadline may already have registered its worker.
        if (isOnline(targetAgentType)) return;
        // Launch RPC time consumes the same budget; never restart a fresh minute five times.
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw readinessFailure();
        boolean ready = sandboxService.waitWorkerReadySync(targetAgentType,
            Math.max(1, TimeUnit.NANOSECONDS.toMillis(remaining)));
        checkInterrupted();
        if (!ready) throw readinessFailure();
    }

    private <T> T awaitExistingStart(CompletableFuture<T> existing, long deadline) {
        try {
            return existing.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
        }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Gateway worker readiness interrupted", exception);
        }
        catch (TimeoutException exception) {
            // A timed-out follower must not remove or cancel the authoritative leader's startup.
            throw readinessFailure();
        }
        catch (ExecutionException exception) {
            throw propagate(exception.getCause() == null ? exception : exception.getCause());
        }
    }

    private void checkInterrupted() {
        if (Thread.currentThread().isInterrupted()) {
            throw new IllegalStateException("Gateway worker readiness interrupted");
        }
    }

    private RuntimeException propagate(Throwable throwable) {
        if (throwable instanceof RuntimeException runtimeException) {
            return runtimeException;
        }
        return new IllegalStateException("Gateway worker readiness failed", throwable);
    }

    private IllegalStateException readinessFailure() {
        return new IllegalStateException("Gateway worker did not become ready");
    }

    private record ResolutionKey(String userCode, Long resourceId, String workerAgentType, String sourceAgentType, TenantRequestContext tenant) {}

    public enum ReadinessPhase {
        STARTING,
        WAITING,
        READY
    }

    private record RouteKey(String userCode, Long resourceId, String targetAgentType, TenantRequestContext tenant) {}
}
