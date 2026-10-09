package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.FileVisitResult;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.io.IOException;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Tenant-owned sandbox launch path, separate from personal sandbox auto-start. */
@Service
public class TenantSandboxService {

    private static final Logger LOG = LoggerFactory.getLogger(TenantSandboxService.class);

    private static final String DB_TYPE = "tenant-opengauss";
    private static final String NODE_TYPE = "tenant-data-node";
    private static final Set<String> PROFILES = Set.of("s", "m", "l");

    private final SandboxLifecycleFacade lifecycleFacade;
    private final OpenSandboxClient openSandboxClient;
    private final SandboxServiceSpecRepository specRepository;
    private final SsSandboxRecordMapper recordMapper;
    private final ObjectMapper objectMapper;
    private final String image;
    private final String nodeImage;
    private final String volumeRoot;
    private final String redisHost;
    private final String redisPort;
    private final String redisDatabase;
    private final String redisUsername;
    private final String redisPassword;
    private final String beInternalUrl;
    private final String internalToken;
    private final String nodeAdvertiseHost;

    public TenantSandboxService(SandboxLifecycleFacade lifecycleFacade, OpenSandboxClient openSandboxClient,
                                SandboxServiceSpecRepository specRepository,
                                SsSandboxRecordMapper recordMapper, ObjectMapper objectMapper,
                                @Value("${IMAGE_OPENGAUSS:}") String image,
                                @Value("${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:}") String volumeRoot,
                                @Value("${IMAGE_TENANT_NODE:}") String nodeImage,
                                @Value("${BYCLAW_TENANT_REDIS_HOST:host.containers.internal}") String redisHost,
                                @Value("${BYCLAW_TENANT_REDIS_PORT:6379}") String redisPort,
                                @Value("${REDIS_DATABASE:0}") String redisDatabase,
                                @Value("${REDIS_USERNAME:default}") String redisUsername,
                                @Value("${REDIS_PASSWORD:}") String redisPassword,
                                @Value("${BYCLAW_TENANT_BE_INTERNAL_URL:}") String beInternalUrl,
                                @Value("${BYCLAW_TENANT_INTERNAL_TOKEN:}") String internalToken,
                                @Value("${BYCLAW_TENANT_NODE_ADVERTISE_HOST:host.containers.internal}") String nodeAdvertiseHost) {
        this.lifecycleFacade = lifecycleFacade;
        this.openSandboxClient = openSandboxClient;
        this.specRepository = specRepository;
        this.recordMapper = recordMapper;
        this.objectMapper = objectMapper;
        this.image = image;
        this.nodeImage = nodeImage;
        this.volumeRoot = volumeRoot;
        this.redisHost = redisHost;
        this.redisPort = redisPort;
        this.redisDatabase = redisDatabase;
        this.redisUsername = redisUsername;
        this.redisPassword = redisPassword;
        this.beInternalUrl = beInternalUrl;
        this.internalToken = internalToken;
        this.nodeAdvertiseHost = nodeAdvertiseHost;
    }

    public TenantSandboxView launchDataNode(long enterpriseId, String profileKey, long dbRecordId,
                                            long generation) {
        if (enterpriseId <= 0 || dbRecordId <= 0 || generation <= 0
            || profileKey == null || !PROFILES.contains(profileKey)
            || nodeImage == null || nodeImage.isBlank() || volumeRoot == null || volumeRoot.isBlank()
            || redisHost == null || redisHost.isBlank() || redisPassword == null || redisPassword.isBlank()
            || beInternalUrl == null || !beInternalUrl.startsWith("http://")
            || internalToken == null || internalToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node launch configuration is incomplete");
        }
        SsSandboxRecord active = recordMapper.selectActiveTenantByResourceAndType(enterpriseId, NODE_TYPE);
        if (active != null) {
            SandboxDetail detail = active.getSandboxId() == null ? null
                : openSandboxClient.getSandboxIfExists(active.getSandboxId());
            if ("RUNNING".equals(active.getStatus()) && detail != null && detail.getStatus() != null
                && "Running".equalsIgnoreCase(detail.getStatus().getState())) {
                return new TenantSandboxView(active.getId(), active.getSandboxId(), active.getEndpoint());
            }
            if (!"RUNNING".equals(active.getStatus()) || recordMapper.updateStatusToFailed(active.getId(),
                    "tenant Node sandbox is no longer reachable", new Date(), active.getLockVersion()) != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node sandbox launch is in progress");
            }
        }
        SandboxServiceSpec spec = specRepository.findByServiceKeyAndProfile(NODE_TYPE, profileKey)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node spec unavailable"));
        if (!"TENANT".equals(spec.getOwnerScope()) || spec.getResourceLimits() == null
            || spec.getResourceLimits().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node resource profile is unavailable");
        }
        Date now = new Date();
        SsSandboxRecord record = new SsSandboxRecord();
        record.setOwnerScope("TENANT");
        record.setEnterpriseId(enterpriseId);
        record.setResourceId(enterpriseId);
        record.setUserCode("tenant-node-" + enterpriseId);
        record.setSandboxType(NODE_TYPE);
        record.setServiceType(NODE_TYPE);
        record.setProfileKey(profileKey);
        record.setResourceRequests(toJson(spec.getResourceRequests()));
        record.setResourceLimits(toJson(spec.getResourceLimits()));
        record.setStatus("STARTING");
        record.setAutoRelease(0);
        record.setLeasePolicy("MANUAL");
        record.setVersion(0);
        record.setLockVersion(0);
        record.setCreateTime(now);
        record.setUpdateTime(now);
        record.setLastAccessTime(now);
        recordMapper.insert(record);
        SandboxLaunchRequest request = new SandboxLaunchRequest();
        request.setUserCode(record.getUserCode());
        request.setSandboxType(NODE_TYPE);
        request.setProfileKey(profileKey);
        Map<String, String> envs = new LinkedHashMap<>();
        envs.put("TENANT_ID", Long.toString(enterpriseId));
        envs.put("TENANT_GENERATION", Long.toString(generation));
        envs.put("DB_SANDBOX_RECORD_ID", Long.toString(dbRecordId));
        envs.put("IMAGE_TENANT_NODE", nodeImage);
        envs.put("NODE_ADVERTISE_HOST", nodeAdvertiseHost);
        envs.put("BYCLAW_SANDBOX_FILE_VOLUME_ROOT", volumeRoot);
        envs.put("BE_INTERNAL_URL", beInternalUrl);
        envs.put("KMS_DECRYPT_URL", beInternalUrl + "/internal/v1/tenantKms/decrypt");
        envs.put("INTERNAL_API_TOKEN", internalToken);
        envs.put("REDIS_HOST", redisHost);
        envs.put("REDIS_PORT", redisPort);
        envs.put("REDIS_DATABASE", redisDatabase);
        envs.put("REDIS_USERNAME", redisUsername);
        envs.put("REDIS_PASSWORD", redisPassword);
        request.setEnvs(envs);
        request.setMetadata(Map.of("ownerScope", "TENANT", "enterpriseId", Long.toString(enterpriseId),
            "recordId", Long.toString(record.getId())));
        SandboxResponse<SandboxLaunchData> response = lifecycleFacade.launchSandbox(request);
        if (response == null || !response.isSuccess() || response.getData() == null) {
            String reason = response == null ? "OpenSandbox did not return a response" : response.getMessage();
            reason = reason == null || reason.isBlank() ? "tenant Node launch failed"
                : reason.replace(redisPassword, "[redacted]").replace(internalToken, "[redacted]");
            reason = reason.substring(0, Math.min(reason.length(), 500));
            recordMapper.updateStatusToFailed(record.getId(), reason, new Date(), 0);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, reason);
        }
        SandboxLaunchData data = response.getData();
        if (recordMapper.updateLaunchSuccess(record.getId(), data.getSandboxId(), data.getEndpoint(),
                data.getGatewayToken(), data.getTimeoutSeconds(), data.getRemoteExpiresAt(), null, null,
                new Date(), 0) != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node record changed during launch");
        }
        return new TenantSandboxView(record.getId(), data.getSandboxId(), data.getEndpoint());
    }

    /** Recreates only the tenant Node sandbox from the configured image; the DB sandbox is retained. */
    public TenantSandboxView recreateDataNode(long enterpriseId, String profileKey, long dbRecordId,
                                              long generation) {
        SsSandboxRecord active = recordMapper.selectActiveTenantByResourceAndType(enterpriseId, NODE_TYPE);
        if (active != null) {
            if (!"RUNNING".equals(active.getStatus()) || active.getSandboxId() == null
                || active.getLockVersion() == null) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node replacement is in progress");
            }
            openSandboxClient.deleteSandbox(active.getSandboxId());
            if (recordMapper.updateStatusToReleased(active.getId(), "tenant Node image replacement",
                new Date(), active.getLockVersion()) != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant Node record changed during replacement");
            }
        }
        return launchDataNode(enterpriseId, profileKey, dbRecordId, generation);
    }

    public SsSandboxRecord latestRecord(long enterpriseId, String sandboxType) {
        requireTenantType(sandboxType);
        return recordMapper.selectLatestTenantByResourceAndType(enterpriseId, sandboxType);
    }

    public boolean isRunning(SsSandboxRecord record) {
        if (record == null || !"RUNNING".equals(record.getStatus()) || record.getSandboxId() == null) {
            return false;
        }
        SandboxDetail detail = openSandboxClient.getSandboxIfExists(record.getSandboxId());
        return detail != null && detail.getStatus() != null
            && "Running".equalsIgnoreCase(detail.getStatus().getState());
    }

    /** Live provider observation. UNKNOWN means OpenSandbox could not be queried, not that the sandbox stopped. */
    public String providerStatus(SsSandboxRecord record) {
        if (record == null || record.getSandboxId() == null || record.getSandboxId().isBlank()) {
            return "MISSING";
        }
        try {
            SandboxDetail detail = openSandboxClient.getSandboxIfExists(record.getSandboxId());
            if (detail == null) return "MISSING";
            if (detail.getStatus() == null || detail.getStatus().getState() == null) return "UNKNOWN";
            return "Running".equalsIgnoreCase(detail.getStatus().getState()) ? "RUNNING" : "STOPPED";
        }
        catch (RuntimeException e) {
            LOG.warn("Could not verify tenant sandbox provider status for record {}: {}",
                record.getId(), e.getClass().getSimpleName());
            return "UNKNOWN";
        }
    }

    /** Release one current tenant sandbox before replacing it; the tenant's persistent volume is retained. */
    public void releaseForReplacement(long enterpriseId, String sandboxType, long recordId) {
        requireTenantType(sandboxType);
        SsSandboxRecord latest = latestRecord(enterpriseId, sandboxType);
        if (latest == null || latest.getId() == null || latest.getId() != recordId
            || !Set.of("RUNNING", "FAILED").contains(latest.getStatus())
            || latest.getLockVersion() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox is not the current restartable record");
        }
        SsSandboxRecord active = recordMapper.selectActiveTenantByResourceAndType(enterpriseId, sandboxType);
        if (active != null && !active.getId().equals(latest.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "another tenant sandbox is active");
        }
        if (latest.getSandboxId() != null && !latest.getSandboxId().isBlank()) {
            openSandboxClient.deleteSandbox(latest.getSandboxId());
        }
        if (recordMapper.markReleased(latest.getId(), "tenant sandbox restart", new Date(),
            latest.getLockVersion()) != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox record changed during restart");
        }
    }

    /** Remove every provider instance before removing the tenant's private database and Node volumes. */
    public void deleteTenantResources(long enterpriseId) {
        if (enterpriseId <= 0 || volumeRoot == null || volumeRoot.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant resource location");
        }
        List<SsSandboxRecord> records = recordMapper.selectTenantRecords(enterpriseId);
        for (SsSandboxRecord record : records) {
            if (record.getSandboxId() != null && !record.getSandboxId().isBlank()) {
                openSandboxClient.deleteSandbox(record.getSandboxId());
                if (openSandboxClient.getSandboxIfExists(record.getSandboxId()) != null) {
                    throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                        "tenant sandbox still exists after delete request");
                }
            }
            if (!"RELEASED".equals(record.getStatus()) && recordMapper.markReleased(record.getId(),
                "tenant deleted", new Date(), record.getLockVersion()) != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox changed during deletion");
            }
        }
        Path root = Path.of(volumeRoot).toAbsolutePath().normalize();
        Path tenants = root.resolve("tenants");
        Path tenantDirectory = tenants.resolve(Long.toString(enterpriseId));
        if (!tenantDirectory.startsWith(tenants) || Files.isSymbolicLink(tenants)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "invalid tenant volume path");
        }
        if (!Files.exists(tenantDirectory)) return;
        try {
            Files.walkFileTree(tenantDirectory, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.delete(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path directory, IOException error) throws IOException {
                    if (error != null) throw error;
                    Files.delete(directory);
                    return FileVisitResult.CONTINUE;
                }
            });
        }
        catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "tenant volume deletion failed", e);
        }
    }

    private void requireTenantType(String sandboxType) {
        if (!DB_TYPE.equals(sandboxType) && !NODE_TYPE.equals(sandboxType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant sandbox type");
        }
    }

    public TenantSandboxView launchOpenGauss(long enterpriseId, String profileKey, String dbName,
                                             String dbUser, String dbPassword) {
        if (enterpriseId <= 0 || profileKey == null || !PROFILES.contains(profileKey)
            || !("byclaw_t_" + enterpriseId).equals(dbName)
            || !("bc_t_" + enterpriseId + "_admin").equals(dbUser)
            || dbPassword == null || dbPassword.isBlank()
            || image == null || image.isBlank() || volumeRoot == null || volumeRoot.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox launch configuration is incomplete");
        }

        SsSandboxRecord active = recordMapper.selectActiveTenantByResourceAndType(enterpriseId, DB_TYPE);
        if (active != null) {
            if (isReusable(active)) {
                return new TenantSandboxView(active.getId(), active.getSandboxId(), active.getEndpoint());
            }
            if (!"RUNNING".equals(active.getStatus()) || recordMapper.updateStatusToFailed(active.getId(),
                    "tenant database sandbox is no longer reachable", new Date(), active.getLockVersion()) != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant database sandbox launch is in progress");
            }
        }
        SandboxServiceSpec spec = specRepository.findByServiceKeyAndProfile(DB_TYPE, profileKey)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "tenant OpenGauss spec unavailable"));
        if (!"TENANT".equals(spec.getOwnerScope())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant OpenGauss spec scope mismatch");
        }
        if (spec.getResourceLimits() == null || spec.getResourceLimits().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant OpenGauss resource profile is unavailable");
        }
        prepareEntrypoint(enterpriseId);

        Date now = new Date();
        SsSandboxRecord record = new SsSandboxRecord();
        record.setOwnerScope("TENANT");
        record.setEnterpriseId(enterpriseId);
        record.setResourceId(enterpriseId);
        // OpenSandbox uses userCode in a volume name, which accepts lowercase DNS labels only.
        record.setUserCode("tenant-" + enterpriseId);
        record.setSandboxType(DB_TYPE);
        record.setServiceType(DB_TYPE);
        record.setProfileKey(profileKey);
        record.setResourceRequests(toJson(spec.getResourceRequests()));
        record.setResourceLimits(toJson(spec.getResourceLimits()));
        record.setStatus("STARTING");
        record.setAutoRelease(0);
        record.setLeasePolicy("MANUAL");
        record.setVersion(0);
        record.setLockVersion(0);
        record.setCreateTime(now);
        record.setUpdateTime(now);
        record.setLastAccessTime(now);
        recordMapper.insert(record);

        SandboxLaunchRequest request = new SandboxLaunchRequest();
        request.setUserCode(record.getUserCode());
        request.setSandboxType(DB_TYPE);
        request.setProfileKey(profileKey);
        Map<String, String> envs = new LinkedHashMap<>();
        envs.put("TENANT_ID", Long.toString(enterpriseId));
        envs.put("ENTERPRISE_ID", Long.toString(enterpriseId));
        envs.put("DB_NAME", dbName);
        envs.put("DB_USER", dbUser);
        envs.put("DB_PASSWORD", dbPassword);
        envs.put("IMAGE_OPENGAUSS", image);
        envs.put("BYCLAW_SANDBOX_FILE_VOLUME_ROOT", volumeRoot);
        request.setEnvs(envs);
        request.setMetadata(Map.of("ownerScope", "TENANT", "enterpriseId", Long.toString(enterpriseId),
            "recordId", Long.toString(record.getId()), "byclawTcpPort", "5432"));

        SandboxResponse<SandboxLaunchData> response = lifecycleFacade.launchSandbox(request);
        if (response == null || !response.isSuccess() || response.getData() == null) {
            String providerReason = response == null ? "OpenSandbox did not return a response" : response.getMessage();
            String failureReason = providerReason == null || providerReason.isBlank()
                ? "tenant database sandbox launch failed" : providerReason.replace(dbPassword, "[redacted]");
            failureReason = failureReason.substring(0, Math.min(failureReason.length(), 500));
            recordMapper.updateStatusToFailed(record.getId(), failureReason, new Date(), 0);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, failureReason);
        }
        SandboxLaunchData data = response.getData();
        int updated = recordMapper.updateLaunchSuccess(record.getId(), data.getSandboxId(), data.getEndpoint(),
            data.getGatewayToken(), data.getTimeoutSeconds(), data.getRemoteExpiresAt(), null, null, new Date(), 0);
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox record changed during launch");
        }
        return new TenantSandboxView(record.getId(), data.getSandboxId(), data.getEndpoint());
    }

    private String toJson(Object value) {
        if (value == null) return null;
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            throw new IllegalStateException("sandbox resource serialization failed", e);
        }
    }

    private void prepareEntrypoint(long enterpriseId) {
        Path root = Path.of(volumeRoot).toAbsolutePath().normalize();
        Path tenantDirectory = root.resolve("tenants").resolve(Long.toString(enterpriseId)).resolve("opengauss");
        Path target = tenantDirectory.resolve("byclaw-tenant-entrypoint.py");
        try {
            Files.createDirectories(tenantDirectory);
            try (var source = new ClassPathResource("tenant/opengauss-entrypoint.py").getInputStream()) {
                Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
        catch (IOException e) {
            throw new IllegalStateException("tenant OpenGauss startup script could not be prepared", e);
        }
    }

    private boolean isReusable(SsSandboxRecord record) {
        if (!"RUNNING".equals(record.getStatus()) || record.getSandboxId() == null
            || record.getEndpoint() == null || !record.getEndpoint().startsWith("tcp://")) return false;
        SandboxDetail detail = openSandboxClient.getSandboxIfExists(record.getSandboxId());
        return detail != null && detail.getStatus() != null
            && "Running".equalsIgnoreCase(detail.getStatus().getState());
    }

    public record TenantSandboxView(long recordId, String sandboxId, String endpoint) {
    }
}
