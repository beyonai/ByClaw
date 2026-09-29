package com.iwhalecloud.byai.manager.domain.tenant;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Resumable first stage of tenant provisioning: DB sandbox, credential probe, Redis snapshot. */
@Service
public class TenantDbProvisioningService {

    private static final Logger LOG = LoggerFactory.getLogger(TenantDbProvisioningService.class);
    private static final Duration LOCK_TTL = Duration.ofMinutes(10);

    private final TenantAdminTenantMapper tenantMapper;
    private final TenantSandboxService sandboxService;
    private final TenantCredentialCrypto credentialCrypto;
    private final TenantConfigPublisher configPublisher;
    private final SequenceService sequenceService;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final Executor taskExecutor;

    public TenantDbProvisioningService(TenantAdminTenantMapper tenantMapper, TenantSandboxService sandboxService,
                                       TenantCredentialCrypto credentialCrypto, TenantConfigPublisher configPublisher,
                                       SequenceService sequenceService,
                                       StringRedisTemplate redisTemplate, ObjectMapper objectMapper,
                                       @Qualifier("projectInitExecutor") Executor taskExecutor) {
        this.tenantMapper = tenantMapper;
        this.sandboxService = sandboxService;
        this.credentialCrypto = credentialCrypto;
        this.configPublisher = configPublisher;
        this.sequenceService = sequenceService;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.taskExecutor = taskExecutor;
    }

    public void request(long enterpriseId) {
        taskExecutor.execute(() -> provision(enterpriseId));
    }

    public void provision(long enterpriseId) {
        String lockKey = "tenant:provision:db:" + enterpriseId;
        String token = UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(lockKey, token, LOCK_TTL))) return;
        try {
            provisionLocked(enterpriseId);
        }
        catch (Exception e) {
            LOG.warn("Tenant DB provisioning failed for enterprise {}: {}", enterpriseId,
                e.getClass().getSimpleName());
            String reason = e instanceof ResponseStatusException statusException
                ? statusException.getReason() : e.getClass().getSimpleName() + ": " + e.getMessage();
            if (reason == null || reason.isBlank()) reason = "tenant provisioning failed";
            upsertConfig(enterpriseId, "PROVISION_FAILURE_REASON",
                reason.substring(0, Math.min(reason.length(), 500)));
            setState(enterpriseId, "FAILED");
        }
        finally {
            DefaultRedisScript<Long> release = new DefaultRedisScript<>(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                Long.class);
            redisTemplate.execute(release, java.util.List.of(lockKey), token);
        }
    }

    private void provisionLocked(long enterpriseId) throws Exception {
        Map<String, String> config = readConfig(enterpriseId);
        if (!config.containsKey("PROVISION_REQUEST_ID")) return;
        String state = status(config.get("PROVISION_STATE"));
        if ("READY".equals(state) || "REDIS_PUBLISHED".equals(state)) return;
        JsonNode packageContent = objectMapper.readTree(config.get("PACKAGE_CONTENT_SNAPSHOT"));
        String profileKey = packageContent.path("profileKey").asText();
        String dbName = "byclaw_t_" + enterpriseId;
        String dbUser = "bc_t_" + enterpriseId + "_admin";
        String envelope = config.get("DB_PASSWORD");
        String password;
        if (envelope == null) {
            password = credentialCrypto.newPassword();
            envelope = credentialCrypto.encrypt(enterpriseId, dbName, password);
            upsertConfig(enterpriseId, "DB_PASSWORD", envelope);
            upsertConfig(enterpriseId, "DB_CREDENTIAL_VERSION", "1");
        }
        else {
            password = decrypt(enterpriseId, dbName, envelope);
            if (!credentialCrypto.isOpenGaussCompatible(password)) {
                password = credentialCrypto.newPassword();
                upsertConfig(enterpriseId, "DB_PASSWORD", credentialCrypto.encrypt(enterpriseId, dbName, password));
                upsertConfig(enterpriseId, "DB_CREDENTIAL_VERSION", "2");
            }
        }
        upsertConfig(enterpriseId, "DB_NAME", dbName);
        upsertConfig(enterpriseId, "DB_USER", dbUser);

        TenantSandboxView sandbox = sandboxService.launchOpenGauss(enterpriseId, profileKey, dbName, dbUser, password);
        setState(enterpriseId, "DB_PROVIDER_READY");
        HostPort endpoint = parseEndpoint(sandbox.endpoint());
        probeDatabase(endpoint, dbName, dbUser, password);
        // Workloads in the shared container network use the stable sandbox container
        // identity, while this process probes through the host-published TCP endpoint.
        upsertConfig(enterpriseId, "DB_HOST", "tenant-db-" + enterpriseId + "-"
            + sandbox.sandboxId().replace("-", ""));
        upsertConfig(enterpriseId, "DB_PORT", "5432");
        upsertConfig(enterpriseId, "DB_SANDBOX_RECORD_ID", Long.toString(sandbox.recordId()));
        setState(enterpriseId, "DB_ADMIN_VERIFIED");
        tenantMapper.deleteConfig(enterpriseId, "PROVISION_FAILURE_REASON");
        Map<String, String> snapshot = readConfig(enterpriseId);
        snapshot.put("PROVISION_STATE", stateJson("REDIS_PUBLISHED"));
        if (!configPublisher.publish(enterpriseId, snapshot)) {
            throw new IllegalStateException("tenant Redis snapshot rejected by fencing check");
        }
        setState(enterpriseId, "REDIS_PUBLISHED");
    }

    private String decrypt(long enterpriseId, String dbName, String envelope) throws GeneralSecurityException {
        return credentialCrypto.decrypt(enterpriseId, dbName, envelope);
    }

    private void probeDatabase(HostPort endpoint, String dbName, String dbUser, String password) throws Exception {
        String url = "jdbc:postgresql://" + endpoint.host() + ":" + endpoint.port() + "/" + dbName
            + "?connectTimeout=5&socketTimeout=5";
        Exception lastFailure = null;
        for (int attempt = 0; attempt < 12; attempt++) {
            try (Connection connection = DriverManager.getConnection(url, dbUser, password);
                 Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT current_user, current_database()")) {
                if (result.next() && dbUser.equals(result.getString(1)) && dbName.equals(result.getString(2))) {
                    return;
                }
                throw new IllegalStateException("tenant DB identity probe mismatch");
            }
            catch (Exception e) {
                lastFailure = e;
                Thread.sleep(5000);
            }
        }
        throw new IllegalStateException("tenant DB connection probe failed", lastFailure);
    }

    private HostPort parseEndpoint(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("tenant DB endpoint is missing");
        URI uri = URI.create(value.contains("://") ? value : "tcp://" + value);
        if (uri.getHost() == null || uri.getPort() <= 0) {
            throw new IllegalArgumentException("tenant DB endpoint is not a TCP host and port");
        }
        return new HostPort(uri.getHost(), uri.getPort());
    }

    private Map<String, String> readConfig(long enterpriseId) {
        Map<String, String> rows = new HashMap<>();
        for (TenantConfigRow row : tenantMapper.selectConfigs(enterpriseId)) {
            rows.put(row.getParamsCode(), row.getParamsValue());
        }
        return rows;
    }

    private String status(String json) {
        if (json == null) return "UNAVAILABLE";
        try {
            return objectMapper.readTree(json).path("status").asText("UNAVAILABLE");
        }
        catch (Exception e) {
            return "UNAVAILABLE";
        }
    }

    private void setState(long enterpriseId, String status) {
        upsertConfig(enterpriseId, "PROVISION_STATE", stateJson(status));
    }

    private void upsertConfig(long enterpriseId, String code, String value) {
        if (tenantMapper.updateConfig(enterpriseId, code, value) == 0) {
            tenantMapper.insertConfig(sequenceService.nextVal(), enterpriseId, code, value);
        }
    }

    private String stateJson(String status) {
        try {
            return objectMapper.writeValueAsString(Map.of("status", status, "generation", 1, "fencingToken", 1));
        }
        catch (Exception e) {
            throw new IllegalStateException("tenant provision state serialization failed", e);
        }
    }

    private record HostPort(String host, int port) {
    }
}
