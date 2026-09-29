package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
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

/** Tenant-owned sandbox launch path, separate from personal sandbox auto-start. */
@Service
public class TenantSandboxService {

    private static final String DB_TYPE = "tenant-opengauss";
    private static final Set<String> PROFILES = Set.of("s", "m", "l");

    private final SandboxLifecycleFacade lifecycleFacade;
    private final OpenSandboxClient openSandboxClient;
    private final SandboxServiceSpecRepository specRepository;
    private final SsSandboxRecordMapper recordMapper;
    private final ObjectMapper objectMapper;
    private final String image;
    private final String volumeRoot;

    public TenantSandboxService(SandboxLifecycleFacade lifecycleFacade, OpenSandboxClient openSandboxClient,
                                SandboxServiceSpecRepository specRepository,
                                SsSandboxRecordMapper recordMapper, ObjectMapper objectMapper,
                                @Value("${IMAGE_OPENGAUSS:}") String image,
                                @Value("${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:}") String volumeRoot) {
        this.lifecycleFacade = lifecycleFacade;
        this.openSandboxClient = openSandboxClient;
        this.specRepository = specRepository;
        this.recordMapper = recordMapper;
        this.objectMapper = objectMapper;
        this.image = image;
        this.volumeRoot = volumeRoot;
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
