package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TemplatePreparingException;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Starts a dedicated Harness for the platform enterprise independently of database provisioning. */
@Component
public class TenantHarnessProvisioningWorker {

    private static final Logger LOG = LoggerFactory.getLogger(TenantHarnessProvisioningWorker.class);
    private static final long PLATFORM_ENTERPRISE_ID = 1L;
    private static final String SOURCE = "byclaw";
    private static final String COMMAND_TYPE = "HARNESS_START";
    private static final String REQUEST_ID = "tenant-harness-start-1";

    private final TenantCommandStore commands;
    private final EnterpriseInfoService enterprises;
    private final SequenceService ids;
    private final TenantSandboxService sandboxes;
    private final WorkerRegistry registry;
    private final ObjectMapper json;
    private final Executor executor;
    private final long readinessTimeoutMs;
    private final String worker = UUID.randomUUID().toString();
    private final AtomicBoolean scanning = new AtomicBoolean();

    public TenantHarnessProvisioningWorker(TenantCommandStore commands, EnterpriseInfoService enterprises,
            SequenceService ids, TenantSandboxService sandboxes, WorkerRegistry registry, ObjectMapper json,
            @Qualifier("projectInitExecutor") Executor executor,
            @Value("${byclaw.gateway.worker-readiness-timeout-ms:${BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS:60000}}")
            long readinessTimeoutMs) {
        this.commands = commands;
        this.enterprises = enterprises;
        this.ids = ids;
        this.sandboxes = sandboxes;
        this.registry = registry;
        this.json = json;
        this.executor = executor;
        this.readinessTimeoutMs = readinessTimeoutMs;
    }

    public HarnessStatus submit(long operatorId, String profileKey) {
        requireEnterprise();
        // The other durable tenant workers also leave shared database tasks to deployment instances.
        if (RuntimeEnvironment.isDevelopment()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant.harness.worker.disabled");
        }

        var command = commands.byRequest(SOURCE, REQUEST_ID);
        if (command == null) {
            sandboxes.validateHarnessProfile(profileKey);
            String snapshot = json.createObjectNode().put("profileKey", profileKey).toString();
            try {
                commands.insert(ids.nextVal(), SOURCE, REQUEST_ID, TenantCommandRequest.digest(snapshot),
                    COMMAND_TYPE, PLATFORM_ENTERPRISE_ID, operatorId, snapshot);
                return view(commands.byRequest(SOURCE, REQUEST_ID));
            } catch (DuplicateKeyException concurrentRequest) {
                command = commands.byRequest(SOURCE, REQUEST_ID);
                if (command == null) throw concurrentRequest;
            }
        }

        HarnessStatus current = view(command);
        if (!current.profileKey().equals(profileKey)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.harness.profile.conflict");
        }
        if (current.workerReady()) return current;

        commands.requeueHarness(command);
        return view(commands.find(Long.parseLong(command.commandId())));
    }

    public HarnessStatus status() {
        requireEnterprise();
        return view(commands.byRequest(SOURCE, REQUEST_ID));
    }

    private void requireEnterprise() {
        if (enterprises.findById(PLATFORM_ENTERPRISE_ID) == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant.harness.enterprise.notFound");
        }
    }

    private HarnessStatus view(TenantCommandStore.Command command) {
        SsSandboxRecord record = sandboxes.latestHarnessRecord(PLATFORM_ENTERPRISE_ID);
        boolean ready = record != null && record.getId() != null && "RUNNING".equals(record.getStatus())
            && record.getSandboxId() != null && !record.getSandboxId().isBlank() && registered(record.getId());
        return new HarnessStatus(command == null ? "NOT_REQUESTED" : command.status(),
            command == null ? null : command.commandId(),
            record == null || record.getId() == null ? null : record.getId().toString(),
            record == null ? null : record.getSandboxId(), ready,
            command == null ? null : profile(Long.parseLong(command.commandId())),
            command == null ? null : command.errorCode());
    }

    private String profile(long commandId) {
        try {
            return json.readTree(commands.snapshot(commandId)).required("profileKey").asText();
        } catch (JsonProcessingException invalid) {
            throw new IllegalStateException("Invalid Harness task snapshot", invalid);
        }
    }

    @Scheduled(initialDelayString = "${tenant.harness.initial-delay-ms:10000}",
        fixedDelayString = "${tenant.harness.poll-delay-ms:5000}")
    public void scan() {
        if (RuntimeEnvironment.isDevelopment() || !scanning.compareAndSet(false, true)) return;
        try {
            executor.execute(() -> {
                try {
                    for (long commandId : commands.candidates(COMMAND_TYPE)) {
                        process(commandId);
                    }
                } catch (RuntimeException failure) {
                    LOG.warn("Harness task scan interrupted by {}", failure.getClass().getSimpleName());
                } finally {
                    scanning.set(false);
                }
            });
        } catch (RuntimeException failure) {
            scanning.set(false);
            throw failure;
        }
    }

    void process(long commandId) {
        var command = commands.find(commandId);
        if (command == null || !COMMAND_TYPE.equals(command.type()) || !SOURCE.equals(command.sourceSystem())
            || !REQUEST_ID.equals(command.requestId())
            || !Long.toString(PLATFORM_ENTERPRISE_ID).equals(command.enterpriseId())) return;

        var lease = commands.claim(commandId, worker, Duration.ofMinutes(30));
        if (lease == null) return;
        long recordId;
        try {
            requireEnterprise();
            String providerRequestKey = "command-" + commandId + ":HARNESS_CREATE";
            commands.beginHarnessCreate(lease, providerRequestKey);
            var instance = sandboxes.ensureHarness(lease.enterpriseId(), profile(commandId), providerRequestKey);
            recordId = instance.recordId();
            commands.recordHarnessInstance(lease, recordId);
        } catch (TemplatePreparingException pending) {
            commands.deferHarnessTemplate(lease);
            return;
        } catch (TenantCommandException stale) {
            throw stale;
        } catch (RuntimeException failure) {
            LOG.warn("Harness task {} could not confirm creation ({})", commandId, failure.getClass().getSimpleName());
            commands.finish(lease, "MANUAL_REQUIRED", "HARNESS_CREATE", "HARNESS_START_REQUIRES_RECHECK");
            return;
        }

        boolean ready;
        try {
            ready = awaitWorker(recordId);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            commands.finish(lease, "FAILED", "HARNESS_WORKER_WAIT", "HARNESS_WORKER_INTERRUPTED");
            return;
        }
        if (ready) {
            commands.finish(lease, "SUCCEEDED", "READY", null);
        } else {
            commands.finish(lease, "FAILED", "HARNESS_WORKER_WAIT", "HARNESS_WORKER_TIMEOUT");
        }
    }

    private boolean awaitWorker(long recordId) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(readinessTimeoutMs);
        do {
            if (registered(recordId)) return true;
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) return false;
            TimeUnit.NANOSECONDS.sleep(Math.min(remaining, TimeUnit.SECONDS.toNanos(1)));
        } while (true);
    }

    private boolean registered(long recordId) {
        try {
            return SandboxService.isTenantHarnessWorkerOnline(registry, PLATFORM_ENTERPRISE_ID, recordId);
        } catch (RuntimeException unavailable) {
            LOG.debug("Could not read Harness Worker for record {}", recordId, unavailable);
            return false;
        }
    }

    public record HarnessStatus(String status, String taskId, String recordId, String sandboxId,
                                boolean workerReady, String profileKey, String errorCode) { }
}
