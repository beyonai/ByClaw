package com.iwhalecloud.byai.manager.domain.tenant;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
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
    private final TenantNodeSchemaService schemaService;
    private final SequenceService sequenceService;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final Executor taskExecutor;
    private final String dbProbeHost;

    public TenantDbProvisioningService(TenantAdminTenantMapper tenantMapper, TenantSandboxService sandboxService,
                                       TenantCredentialCrypto credentialCrypto, TenantConfigPublisher configPublisher,
                                       TenantNodeSchemaService schemaService,
                                       SequenceService sequenceService,
                                       StringRedisTemplate redisTemplate, ObjectMapper objectMapper,
                                       @Qualifier("projectInitExecutor") Executor taskExecutor,
                                       @Value("${BYCLAW_TENANT_DB_PROBE_HOST:}") String dbProbeHost) {
        this.tenantMapper = tenantMapper;
        this.sandboxService = sandboxService;
        this.credentialCrypto = credentialCrypto;
        this.configPublisher = configPublisher;
        this.schemaService = schemaService;
        this.sequenceService = sequenceService;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.taskExecutor = taskExecutor;
        this.dbProbeHost = dbProbeHost;
    }

    public void request(long enterpriseId) {
        if (deletionRequested(enterpriseId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant deletion is in progress");
        }
        taskExecutor.execute(() -> provision(enterpriseId));
    }

    public void requestRestart(long enterpriseId, String sandboxType, long recordId) {
        if (deletionRequested(enterpriseId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant deletion is in progress");
        }
        SsSandboxRecord latest = sandboxService.latestRecord(enterpriseId, sandboxType);
        if (latest == null || latest.getId() == null || latest.getId() != recordId
            || !("RUNNING".equals(latest.getStatus()) || "FAILED".equals(latest.getStatus()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox is not restartable");
        }
        taskExecutor.execute(() -> restart(enterpriseId, sandboxType, recordId));
    }

    private void restart(long enterpriseId, String sandboxType, long recordId) {
        String lockKey = "tenant:provision:db:" + enterpriseId;
        String token = UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(lockKey, token, LOCK_TTL))) return;
        boolean replacing = false;
        try {
            SsSandboxRecord latest = sandboxService.latestRecord(enterpriseId, sandboxType);
            if (latest == null || latest.getId() == null || latest.getId() != recordId
                || !("RUNNING".equals(latest.getStatus()) || "FAILED".equals(latest.getStatus()))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant sandbox changed before restart");
            }
            Map<String, String> config = readConfig(enterpriseId);
            if (!config.containsKey("PROVISION_REQUEST_ID")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant provisioning was not requested");
            }
            replacing = true;
            setState(enterpriseId, "FAILED");
            publishIfComplete(enterpriseId);
            if ("tenant-opengauss".equals(sandboxType)) {
                releaseCurrent(enterpriseId, "tenant-data-node");
            }
            sandboxService.releaseForReplacement(enterpriseId, sandboxType, recordId);
            provisionLocked(enterpriseId);
        }
        catch (Exception e) {
            LOG.warn("Tenant sandbox restart failed for enterprise {}: {}", enterpriseId,
                e.getClass().getSimpleName());
            if (replacing) {
                upsertConfig(enterpriseId, "PROVISION_FAILURE_REASON",
                    "tenant sandbox restart failed: " + e.getClass().getSimpleName());
                setState(enterpriseId, "FAILED");
                publishIfComplete(enterpriseId);
            }
        }
        finally {
            releaseLock(lockKey, token);
        }
    }

    private void releaseCurrent(long enterpriseId, String sandboxType) {
        SsSandboxRecord latest = sandboxService.latestRecord(enterpriseId, sandboxType);
        if (latest != null && ("RUNNING".equals(latest.getStatus()) || "FAILED".equals(latest.getStatus()))) {
            sandboxService.releaseForReplacement(enterpriseId, sandboxType, latest.getId());
        }
    }

    private void publishIfComplete(long enterpriseId) {
        Map<String, String> config = readConfig(enterpriseId);
        if (config.keySet().containsAll(java.util.Set.of("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER",
            "DB_PASSWORD", "DB_SANDBOX_RECORD_ID", "DB_CREDENTIAL_VERSION", "PROVISION_STATE"))) {
            configPublisher.publish(enterpriseId, config);
        }
    }

    /** Replace a READY tenant's Node with the configured image while keeping its database sandbox. */
    public TenantSandboxView recreateNode(long enterpriseId) {
        String lockKey = "tenant:provision:db:" + enterpriseId;
        String token = UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redisTemplate.opsForValue().setIfAbsent(lockKey, token, LOCK_TTL))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant provisioning is in progress");
        }
        boolean replacing = false;
        try {
            Map<String, String> config = readConfig(enterpriseId);
            JsonNode state = objectMapper.readTree(config.get("PROVISION_STATE"));
            if (!"READY".equals(state.path("status").asText())
                || state.path("generation").asLong() <= 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant is not ready");
            }
            JsonNode packageContent = objectMapper.readTree(config.get("PACKAGE_CONTENT_SNAPSHOT"));
            String profileKey = packageContent.path("profileKey").asText();
            String dbRecord = config.get("DB_SANDBOX_RECORD_ID");
            if (dbRecord == null || !dbRecord.matches("[1-9][0-9]*")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant database record is missing");
            }
            replacing = true;
            TenantSandboxView node = sandboxService.recreateDataNode(enterpriseId, profileKey,
                Long.parseLong(dbRecord), state.path("generation").asLong());
            upsertConfig(enterpriseId, "NODE_SANDBOX_RECORD_ID", Long.toString(node.recordId()));
            if (!configPublisher.publish(enterpriseId, readConfig(enterpriseId))) {
                throw new IllegalStateException("tenant Redis snapshot rejected by fencing check");
            }
            tenantMapper.deleteConfig(enterpriseId, "PROVISION_FAILURE_REASON");
            return node;
        }
        catch (Exception e) {
            if (replacing) {
                upsertConfig(enterpriseId, "PROVISION_FAILURE_REASON",
                    "tenant Node replacement failed: " + e.getClass().getSimpleName());
                setState(enterpriseId, "FAILED");
                try {
                    configPublisher.publish(enterpriseId, readConfig(enterpriseId));
                }
                catch (Exception publishError) {
                    LOG.warn("Failed to publish tenant Node replacement failure for enterprise {}: {}",
                        enterpriseId, publishError.getClass().getSimpleName());
                }
            }
            if (e instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException("tenant Node replacement failed", e);
        }
        finally {
            releaseLock(lockKey, token);
        }
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
            if (deletionRequested(enterpriseId)) return;
            // A provider read failure before any READY tenant state change is inconclusive.
            // Keep the tenant available and let the management page show an unverified live status.
            if ("READY".equals(status(tenantMapper.selectConfig(enterpriseId, "PROVISION_STATE")))) return;
            String reason = e instanceof ResponseStatusException statusException
                ? statusException.getReason() : e.getClass().getSimpleName() + ": " + e.getMessage();
            if (reason == null || reason.isBlank()) reason = "tenant provisioning failed";
            upsertConfig(enterpriseId, "PROVISION_FAILURE_REASON",
                reason.substring(0, Math.min(reason.length(), 500)));
            String lastStage = status(tenantMapper.selectConfig(enterpriseId, "PROVISION_STATE"));
            upsertConfig(enterpriseId, "PROVISION_STATE", stateJson("FAILED", lastStage));
        }
        finally {
            releaseLock(lockKey, token);
        }
    }

    private void releaseLock(String lockKey, String token) {
        DefaultRedisScript<Long> release = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            Long.class);
        redisTemplate.execute(release, java.util.List.of(lockKey), token);
    }

    private void provisionLocked(long enterpriseId) throws Exception {
        Map<String, String> config = readConfig(enterpriseId);
        if (!config.containsKey("PROVISION_REQUEST_ID")) return;
        String state = status(config.get("PROVISION_STATE"));
        if ("READY".equals(state)) {
            SsSandboxRecord db = sandboxService.latestRecord(enterpriseId, "tenant-opengauss");
            SsSandboxRecord node = sandboxService.latestRecord(enterpriseId, "tenant-data-node");
            boolean dbRunning = sandboxService.isRunning(db);
            boolean nodeRunning = sandboxService.isRunning(node);
            if (dbRunning && nodeRunning) return;
            setState(enterpriseId, "FAILED");
            publishIfComplete(enterpriseId);
            releaseCurrent(enterpriseId, "tenant-data-node");
            if (!dbRunning) releaseCurrent(enterpriseId, "tenant-opengauss");
        }
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

        setState(enterpriseId, "DB_CREATING");
        TenantSandboxView sandbox = sandboxService.launchOpenGauss(enterpriseId, profileKey, dbName, dbUser, password);
        setState(enterpriseId, "DB_PROVIDER_READY");
        HostPort endpoint = parseEndpoint(sandbox.endpoint(), sandbox.sandboxId());
        probeDatabase(endpoint, dbName, dbUser, password);
        upsertConfig(enterpriseId, "DB_HOST", endpoint.host());
        upsertConfig(enterpriseId, "DB_PORT", Integer.toString(endpoint.port()));
        upsertConfig(enterpriseId, "DB_SANDBOX_RECORD_ID", Long.toString(sandbox.recordId()));
        setState(enterpriseId, "DB_ADMIN_VERIFIED");
        tenantMapper.deleteConfig(enterpriseId, "PROVISION_FAILURE_REASON");
        Map<String, String> snapshot = readConfig(enterpriseId);
        snapshot.put("PROVISION_STATE", stateJson("REDIS_PUBLISHED"));
        if (!configPublisher.publish(enterpriseId, snapshot)) {
            throw new IllegalStateException("tenant Redis snapshot rejected by fencing check");
        }
        setState(enterpriseId, "REDIS_PUBLISHED");
        setState(enterpriseId, "NODE_CREATING");
        TenantSandboxView node = sandboxService.launchDataNode(enterpriseId, profileKey, sandbox.recordId(), 1);
        upsertConfig(enterpriseId, "NODE_SANDBOX_RECORD_ID", Long.toString(node.recordId()));
        setState(enterpriseId, "ADMIN_ONLY");
        if (!schemaService.initialized(enterpriseId)) {
            setState(enterpriseId, "SCHEMA_INIT");
            schemaService.initialize(enterpriseId, 1, sandbox.recordId(), node,
                config.get("PROVISION_REQUEST_ID"));
        }
        Map<String, String> readySnapshot = readConfig(enterpriseId);
        readySnapshot.put("PROVISION_STATE", stateJson("READY"));
        if (!configPublisher.publish(enterpriseId, readySnapshot)) {
            throw new IllegalStateException("tenant READY snapshot rejected by fencing check");
        }
        setState(enterpriseId, "READY");
    }

    private String decrypt(long enterpriseId, String dbName, String envelope) throws GeneralSecurityException {
        return credentialCrypto.decrypt(enterpriseId, dbName, envelope);
    }

    private void probeDatabase(HostPort endpoint, String dbName, String dbUser, String password) throws Exception {
        String host = dbProbeHost == null || dbProbeHost.isBlank() ? endpoint.host() : dbProbeHost;
        String url = "jdbc:postgresql://" + host + ":" + endpoint.port() + "/" + dbName
            + "?connectTimeout=5&socketTimeout=5";
        // OpenGauss may report its first ready state before the tenant role is usable,
        // then restart once more while finishing initialization. Allow that warm-up.
        retryConnectionProbe(() -> {
            try (Connection connection = DriverManager.getConnection(url, dbUser, password);
                 Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT current_user, current_database()")) {
                if (result.next() && dbUser.equals(result.getString(1)) && dbName.equals(result.getString(2))) {
                    return;
                }
                throw new IllegalStateException("tenant DB identity probe mismatch");
            }
        }, 40, 5000);
    }

    @FunctionalInterface
    interface ConnectionProbe {
        void run() throws Exception;
    }

    static void retryConnectionProbe(ConnectionProbe probe, int maxAttempts, long delayMillis) throws Exception {
        Exception lastFailure = null;
        for (int attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                probe.run();
                return;
            }
            catch (Exception e) {
                lastFailure = e;
                if (attempt + 1 < maxAttempts) Thread.sleep(delayMillis);
            }
        }
        throw new IllegalStateException("tenant DB connection probe failed", lastFailure);
    }

    static HostPort parseEndpoint(String value, String sandboxId) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("tenant DB endpoint is missing");
        if (value.stripLeading().startsWith("{")) {
            var parsed = SandboxEndpointRecordSupport.parseEndpointRecord(value);
            if (parsed.malformedJson()
                || !parsed.instanceEndpoints().containsKey(SandboxEndpointRecordSupport.OPENCLAW_INSTANCE)) {
                throw new IllegalArgumentException("tenant DB endpoint record is invalid");
            }
            value = parsed.instanceEndpoints().get(SandboxEndpointRecordSupport.OPENCLAW_INSTANCE);
        }
        URI uri = URI.create(value.contains("://") ? value : "tcp://" + value);
        if (uri.getHost() == null || uri.getPort() <= 0) {
            throw new IllegalArgumentException("tenant DB endpoint is not a TCP host and port");
        }
        if ("/proxy/5432".equals(uri.getPath())) {
            if (sandboxId == null) throw new IllegalArgumentException("tenant DB sandbox ID is missing");
            UUID.fromString(sandboxId);
            return new HostPort("sandbox-" + sandboxId, 5432);
        }
        if (uri.getPath() != null && !uri.getPath().isBlank() && !"/".equals(uri.getPath())) {
            throw new IllegalArgumentException("tenant DB endpoint has an unsupported path");
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
        if (deletionRequested(enterpriseId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant deletion is in progress");
        }
        upsertConfig(enterpriseId, "PROVISION_STATE", stateJson(status));
    }

    private boolean deletionRequested(long enterpriseId) {
        return "true".equals(tenantMapper.selectConfig(enterpriseId, "TENANT_DELETE_REQUESTED"));
    }

    private void upsertConfig(long enterpriseId, String code, String value) {
        if (tenantMapper.updateConfig(enterpriseId, code, value) == 0) {
            tenantMapper.insertConfig(sequenceService.nextVal(), enterpriseId, code, value);
        }
    }

    private String stateJson(String status) {
        return stateJson(status, null);
    }

    private String stateJson(String status, String lastStage) {
        try {
            Map<String, String> state = new HashMap<>();
            state.put("status", status);
            state.put("generation", "1");
            state.put("fencingToken", "1");
            state.put("leaseUntil", Instant.now().plus(Duration.ofHours(24)).toString());
            if (lastStage != null) state.put("lastStage", lastStage);
            return objectMapper.writeValueAsString(state);
        }
        catch (Exception e) {
            throw new IllegalStateException("tenant provision state serialization failed", e);
        }
    }

    record HostPort(String host, int port) {
    }
}
