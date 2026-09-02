package com.iwhalecloud.byai.gateway.route;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Consumer;

import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** Ensures a user-scoped sandbox worker is online before its first Gateway send. */
@Service
public class WorkerRouteReadinessService {

    static final int SANDBOX_STARTUP_WAIT_ROUNDS = 5;

    private final WorkerRegistry workerRegistry;

    private final SandboxService sandboxService;

    private final TargetAgentResolver targetAgentResolver;

    private final ConcurrentMap<RouteKey, CompletableFuture<Void>> inFlightStarts = new ConcurrentHashMap<>();

    public WorkerRouteReadinessService(WorkerRegistry workerRegistry, SandboxService sandboxService,
            TargetAgentResolver targetAgentResolver) {
        this.workerRegistry = workerRegistry;
        this.sandboxService = sandboxService;
        this.targetAgentResolver = targetAgentResolver;
    }

    public void ensureReady(String userCode, Long resourceId, String targetAgentType,
            Consumer<ReadinessPhase> progress) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(targetAgentType)
            || !targetAgentResolver.isUserSandboxAgentType(targetAgentType, userCode)) {
            return;
        }
        if (isOnline(targetAgentType)) {
            return;
        }

        Consumer<ReadinessPhase> safeProgress = progress == null ? ignored -> { } : progress;
        safeProgress.accept(ReadinessPhase.STARTING);
        RouteKey routeKey = new RouteKey(userCode, resourceId, targetAgentType);
        CompletableFuture<Void> leader = new CompletableFuture<>();
        CompletableFuture<Void> existing = inFlightStarts.putIfAbsent(routeKey, leader);
        if (existing != null) {
            safeProgress.accept(ReadinessPhase.WAITING);
            awaitExistingStart(existing);
            safeProgress.accept(ReadinessPhase.READY);
            return;
        }

        try {
            // Close the race between the initial fast-path check and becoming the single-flight leader.
            if (!isOnline(targetAgentType)) {
                launchAndWait(userCode, resourceId, targetAgentType, safeProgress);
            }
            leader.complete(null);
            safeProgress.accept(ReadinessPhase.READY);
        }
        catch (Throwable throwable) {
            leader.completeExceptionally(throwable);
            throw propagate(throwable);
        }
        finally {
            inFlightStarts.remove(routeKey, leader);
        }
    }

    private boolean isOnline(String targetAgentType) {
        WorkerRegistry.OnlineAgentCheckResult result = workerRegistry.hasOnlineAgentType(targetAgentType, true);
        return result != null && result.exists;
    }

    private void launchAndWait(String userCode, Long resourceId, String targetAgentType,
            Consumer<ReadinessPhase> progress) {
        SandboxLaunchData launchData = sandboxService.restartSandboxAfterRemoteExitWithoutWait(
            userCode, resourceId, targetAgentType);
        if (launchData == null) {
            throw readinessFailure();
        }
        for (int round = 1; round <= SANDBOX_STARTUP_WAIT_ROUNDS; round++) {
            if (sandboxService.waitWorkerReadySync(targetAgentType, SandboxService.WORKER_READY_TIMEOUT_MS)) {
                return;
            }
            if (round < SANDBOX_STARTUP_WAIT_ROUNDS) {
                progress.accept(ReadinessPhase.WAITING);
            }
        }
        throw readinessFailure();
    }

    private void awaitExistingStart(CompletableFuture<Void> existing) {
        try {
            existing.join();
        }
        catch (CompletionException exception) {
            throw propagate(exception.getCause() == null ? exception : exception.getCause());
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

    public enum ReadinessPhase {
        STARTING,
        WAITING,
        READY
    }

    private static final class RouteKey {

        private final String userCode;

        private final Long resourceId;

        private final String targetAgentType;

        private RouteKey(String userCode, Long resourceId, String targetAgentType) {
            this.userCode = userCode;
            this.resourceId = resourceId;
            this.targetAgentType = targetAgentType;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof RouteKey routeKey)) {
                return false;
            }
            return Objects.equals(userCode, routeKey.userCode)
                && Objects.equals(resourceId, routeKey.resourceId)
                && Objects.equals(targetAgentType, routeKey.targetAgentType);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userCode, resourceId, targetAgentType);
        }
    }
}
