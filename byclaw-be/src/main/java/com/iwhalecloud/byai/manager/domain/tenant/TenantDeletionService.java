package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Durable, retryable removal of one platform-managed tenant and its private runtime resources. */
@Service
public class TenantDeletionService {
    private static final Logger LOG = LoggerFactory.getLogger(TenantDeletionService.class);
    private static final String DELETE_MARKER = "TENANT_DELETE_REQUESTED";

    private final TenantAdminTenantMapper tenants;
    private final TenantSandboxService sandboxes;
    private final SequenceService sequence;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final Executor executor;

    public TenantDeletionService(TenantAdminTenantMapper tenants, TenantSandboxService sandboxes,
        SequenceService sequence, StringRedisTemplate redis, ObjectMapper mapper,
        @Qualifier("projectInitExecutor") Executor executor) {
        this.tenants = tenants;
        this.sandboxes = sandboxes;
        this.sequence = sequence;
        this.redis = redis;
        this.mapper = mapper;
        this.executor = executor;
    }

    public String request(String enterpriseIdText, String confirmedName) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
        if (enterpriseIdText == null || !enterpriseIdText.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
        long enterpriseId;
        try {
            enterpriseId = Long.parseLong(enterpriseIdText);
        }
        catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID", e);
        }
        String actualName = tenants.selectManagedEnterpriseName(enterpriseId);
        if (actualName == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant not found");
        if (!actualName.equals(confirmedName)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant name confirmation does not match");
        }
        if ("DELETED".equals(status(enterpriseId))) return "COMPLETED";
        upsert(enterpriseId, DELETE_MARKER, "true");
        writeState(enterpriseId, "DELETING");
        tenants.deleteConfig(enterpriseId, "PROVISION_FAILURE_REASON");
        executor.execute(() -> deleteNow(enterpriseId));
        return "ACCEPTED";
    }

    @Scheduled(initialDelayString = "${tenant.delete.reconcile-initial-delay-ms:30000}",
        fixedDelayString = "${tenant.delete.reconcile-delay-ms:30000}")
    public void retryPending() {
        for (Long enterpriseId : tenants.selectPendingDeletions()) {
            executor.execute(() -> deleteNow(enterpriseId));
        }
    }

    void deleteNow(long enterpriseId) {
        String key = "tenant:provision:db:" + enterpriseId;
        String token = UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key, token, Duration.ofMinutes(30)))) return;
        try {
            if (!"true".equals(tenants.selectConfig(enterpriseId, DELETE_MARKER))) return;
            if ("DELETED".equals(status(enterpriseId))) {
                tenants.deleteConfig(enterpriseId, DELETE_MARKER);
                return;
            }
            writeState(enterpriseId, "DELETING");
            redis.delete("TENANT_CONFIG_" + enterpriseId);
            sandboxes.deleteTenantResources(enterpriseId);
            redis.delete("TENANT_CONFIG_" + enterpriseId);
            tenants.deleteTenantOrganizations(enterpriseId);
            tenants.deleteTenantMemberships(enterpriseId);
            tenants.deleteTenantResourceConfigs(enterpriseId);
            writeState(enterpriseId, "DELETED");
            tenants.deleteConfig(enterpriseId, DELETE_MARKER);
            LOG.info("Tenant {} and private sandbox resources were deleted", enterpriseId);
        }
        catch (Exception error) {
            LOG.error("Tenant {} deletion failed; scheduled retry remains active", enterpriseId, error);
            try {
                writeState(enterpriseId, "DELETE_FAILED");
                upsert(enterpriseId, "PROVISION_FAILURE_REASON",
                    "tenant deletion failed: " + error.getClass().getSimpleName());
            }
            catch (Exception stateError) {
                LOG.error("Tenant {} deletion failure state could not be saved", enterpriseId, stateError);
            }
        }
        finally {
            DefaultRedisScript<Long> release = new DefaultRedisScript<>(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                Long.class);
            redis.execute(release, List.of(key), token);
        }
    }

    private String status(long enterpriseId) {
        try {
            String json = tenants.selectConfig(enterpriseId, "PROVISION_STATE");
            return json == null ? "UNAVAILABLE" : mapper.readTree(json).path("status").asText("UNAVAILABLE");
        }
        catch (Exception e) {
            return "UNAVAILABLE";
        }
    }

    private void writeState(long enterpriseId, String state) {
        try {
            String old = tenants.selectConfig(enterpriseId, "PROVISION_STATE");
            ObjectNode json = old == null ? mapper.createObjectNode() :
                (ObjectNode) mapper.readTree(old);
            json.put("status", state);
            if (tenants.updateConfig(enterpriseId, "PROVISION_STATE", mapper.writeValueAsString(json)) != 1) {
                throw new IllegalStateException("tenant provision state disappeared");
            }
        }
        catch (Exception e) {
            throw new IllegalStateException("tenant deletion state could not be saved", e);
        }
    }

    private void upsert(long enterpriseId, String code, String value) {
        if (tenants.updateConfig(enterpriseId, code, value) == 0) {
            tenants.insertConfig(sequence.nextVal(), enterpriseId, code, value);
        }
    }
}
