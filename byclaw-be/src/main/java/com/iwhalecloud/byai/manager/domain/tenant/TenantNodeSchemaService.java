package com.iwhalecloud.byai.manager.domain.tenant;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipInputStream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

/** Sends the versioned baseline bundle to the tenant Node and waits for its audited result. */
@Service
public class TenantNodeSchemaService {

    private static final String BUNDLED_BASELINES = "classpath*:tenant/baseline/*__baseline.zip";

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final Path bundlePath;
    private final String sandboxBaseUrl;
    private final String sandboxApiKey;
    private final String internalToken;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public TenantNodeSchemaService(JdbcTemplate jdbc, ObjectMapper objectMapper,
                                   @Value("${BYCLAW_TENANT_BASELINE_BUNDLE:}") String bundlePath,
                                   @Value("${BYCLAW_SANDBOX_BASE_URL:}") String sandboxBaseUrl,
                                   @Value("${BYCLAW_SANDBOX_API_KEY:}") String sandboxApiKey,
                                   @Value("${BYCLAW_TENANT_INTERNAL_TOKEN:}") String internalToken) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.bundlePath = bundlePath == null || bundlePath.isBlank() ? null : Path.of(bundlePath);
        this.sandboxBaseUrl = sandboxBaseUrl;
        this.sandboxApiKey = sandboxApiKey;
        this.internalToken = internalToken;
    }

    public boolean initialized(long enterpriseId) {
        String version;
        try { version = metadata(readBundle()).version(); }
        catch (IOException e) { throw new IllegalStateException("cannot read tenant baseline bundle", e); }
        Integer count = jdbc.queryForObject("SELECT count(*) FROM byai.tenant_schema_audit "
            + "WHERE enterprise_id=? AND is_current=TRUE AND status='VERIFIED' AND observed_version=?",
            Integer.class, enterpriseId, version);
        return count != null && count > 0;
    }

    public void initialize(long enterpriseId, long generation, long dbRecordId, TenantSandboxView node,
                           String requestId) throws Exception {
        if (internalToken == null || internalToken.isBlank() || sandboxBaseUrl == null || sandboxBaseUrl.isBlank()) {
            throw new IllegalStateException("tenant schema internal HTTP configuration is missing");
        }
        byte[] bundle = readBundle();
        BundleMetadata metadata = metadata(bundle);
        String auditId = UUID.randomUUID().toString().replace("-", "");
        Integer lastAttempt = jdbc.queryForObject("SELECT COALESCE(MAX(attempt_no),0) FROM byai.tenant_schema_audit "
            + "WHERE enterprise_id=? AND request_id=?", Integer.class, enterpriseId, requestId);
        int attemptNo = (lastAttempt == null ? 0 : lastAttempt) + 1;
        String bundleDigest = sha256(bundle);
        jdbc.update("INSERT INTO byai.tenant_schema_audit (audit_id,enterprise_id,request_id,operation_type,"
                + "trigger_type,byclaw_release_version,attempt_no,target_version,bundle_digest,"
                + "db_sandbox_record_id,generation,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            auditId, enterpriseId, requestId, "INIT", "AUTO_PROVISION", metadata.version(), attemptNo,
            metadata.version(), bundleDigest, dbRecordId, generation, "PENDING");
        ObjectNode task = objectMapper.createObjectNode();
        task.put("protocolVersion", 1);
        task.put("auditId", auditId);
        task.put("requestId", requestId);
        task.put("attemptNo", attemptNo);
        task.put("enterpriseId", Long.toString(enterpriseId));
        task.put("dbSandboxRecordId", Long.toString(dbRecordId));
        task.put("generation", Long.toString(generation));
        task.put("fencingToken", "1");
        task.put("operationType", "INIT");
        task.put("triggerType", "AUTO_PROVISION");
        task.put("byclawReleaseVersion", metadata.version());
        task.putNull("fromVersion");
        task.put("targetVersion", metadata.version());
        task.put("bundleDigest", bundleDigest);
        task.put("deadline", Instant.now().plus(Duration.ofMinutes(10)).toString());
        var scripts = task.putArray("scripts");
        var script = scripts.addObject();
        script.put("version", metadata.version());
        script.putNull("parentVersion");
        script.put("path", metadata.sqlPath());
        script.put("sha256", metadata.sqlDigest());

        try {
            URI base = nodeUri(node.endpoint());
            waitForDatabase(base, enterpriseId, generation);
            String boundary = "byclaw-" + auditId;
            byte[] upload = multipart(boundary, objectMapper.writeValueAsBytes(task), bundle);
            HttpResponse<byte[]> accepted = send(base.resolve(base.getPath() + "/internal/v1/schema-tasks"),
                "POST", upload, "multipart/form-data; boundary=" + boundary, enterpriseId, generation,
                Map.of("Idempotency-Key", auditId + ":" + attemptNo));
            if (accepted.statusCode() != 202) {
                throw new IllegalStateException("tenant Node rejected schema initialization: HTTP " + accepted.statusCode());
            }
            Instant deadline = Instant.now().plus(Duration.ofMinutes(8));
            URI taskUrl = base.resolve(base.getPath() + "/internal/v1/schema-tasks/" + auditId);
            while (Instant.now().isBefore(deadline)) {
                Thread.sleep(2000);
                HttpResponse<byte[]> response = send(taskUrl, "GET", null, null, enterpriseId, generation, Map.of());
                if (response.statusCode() != 200) continue;
                JsonNode result = objectMapper.readTree(response.body());
                String status = result.path("status").asText();
                if ("VERIFIED".equals(status)) {
                    String auditStatus = jdbc.queryForObject("SELECT status FROM byai.tenant_schema_audit WHERE audit_id=?",
                        String.class, auditId);
                    if ("VERIFIED".equals(auditStatus)) return;
                }
                if ("FAILED".equals(status) || "NEEDS_ATTENTION".equals(status)) {
                    throw new IllegalStateException("tenant schema initialization failed: "
                        + result.path("errorCode").asText(status));
                }
            }
            throw new IllegalStateException("tenant schema initialization timed out");
        }
        catch (Exception e) {
            String reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            jdbc.update("UPDATE byai.tenant_schema_audit SET status='FAILED',error_code='BE_DISPATCH_FAILED',"
                    + "failure_reason=?,finished_at=? WHERE audit_id=? AND status='PENDING'",
                reason.substring(0, Math.min(reason.length(), 500)), java.sql.Timestamp.from(Instant.now()), auditId);
            throw e;
        }
    }

    byte[] readBundle() throws IOException {
        if (bundlePath != null) {
            if (!Files.isRegularFile(bundlePath)) {
                throw new IllegalStateException("tenant schema bundle file is missing: " + bundlePath);
            }
            return Files.readAllBytes(bundlePath);
        }
        Resource selected = null;
        String selectedVersion = null;
        for (Resource resource : new PathMatchingResourcePatternResolver().getResources(BUNDLED_BASELINES)) {
            String filename = resource.getFilename();
            if (filename == null || !filename.matches("V[0-9]+(\\.[0-9]+)*__baseline\\.zip")) continue;
            String version = filename.substring(0, filename.indexOf("__baseline.zip"));
            if (selectedVersion == null || compareVersions(version, selectedVersion) > 0) {
                selected = resource;
                selectedVersion = version;
            }
        }
        if (selected == null) throw new IllegalStateException("bundled tenant schema baseline is missing");
        try (InputStream input = selected.getInputStream()) {
            return input.readAllBytes();
        }
    }

    static int compareVersions(String left, String right) {
        String[] a = left.substring(1).split("\\.");
        String[] b = right.substring(1).split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            BigInteger x = new BigInteger(i < a.length ? a[i] : "0");
            BigInteger y = new BigInteger(i < b.length ? b[i] : "0");
            int comparison = x.compareTo(y);
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    private URI nodeUri(String endpoint) {
        if (endpoint == null || endpoint.isBlank()) throw new IllegalStateException("tenant Node endpoint is missing");
        String value = endpoint.startsWith("/")
            ? sandboxBaseUrl.replaceAll("/+$", "") + endpoint : endpoint;
        URI uri = URI.create(value);
        if (!"http".equals(uri.getScheme()) || uri.getHost() == null) {
            throw new IllegalStateException("tenant Node HTTP endpoint is invalid");
        }
        return uri;
    }

    private void waitForDatabase(URI base, long enterpriseId, long generation) throws Exception {
        URI health = base.resolve(base.getPath() + "/internal/v1/health/db");
        Instant deadline = Instant.now().plus(Duration.ofSeconds(90));
        while (Instant.now().isBefore(deadline)) {
            try {
                if (send(health, "GET", null, null, enterpriseId, generation, Map.of()).statusCode() == 200) return;
            }
            catch (IOException ignored) {
                // The sandbox can be reachable before Node starts listening.
            }
            Thread.sleep(2000);
        }
        throw new IllegalStateException("tenant Node database health check timed out");
    }

    private HttpResponse<byte[]> send(URI uri, String method, byte[] body, String contentType,
                                      long enterpriseId, long generation, Map<String, String> extra)
        throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15))
            .header("X-Byclaw-Internal-Token", internalToken)
            .header("X-Enterprise-Id", Long.toString(enterpriseId))
            .header("X-Tenant-Generation", Long.toString(generation));
        if (sandboxApiKey != null && !sandboxApiKey.isBlank()) {
            request.header("OPEN-SANDBOX-API-KEY", sandboxApiKey);
        }
        if (contentType != null) request.header("Content-Type", contentType);
        extra.forEach(request::header);
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofByteArray(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private byte[] multipart(String boundary, byte[] task, byte[] bundle) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"task\"\r\n"
            + "Content-Type: application/json\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(task);
        out.write(("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"bundle\"; "
            + "filename=\"baseline.zip\"\r\nContent-Type: application/zip\r\n\r\n")
            .getBytes(StandardCharsets.UTF_8));
        out.write(bundle);
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private BundleMetadata metadata(byte[] bundle) throws IOException {
        String version = null;
        byte[] manifest = null;
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(bundle))) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                if (entry.getName().matches("baseline/V[0-9]+(\\.[0-9]+)*/manifest\\.json")) {
                    manifest = zip.readAllBytes();
                    break;
                }
            }
        }
        if (manifest != null) version = objectMapper.readTree(manifest).path("version").asText();
        if (version == null || !version.matches("V[0-9]+(\\.[0-9]+)*")) {
            throw new IllegalStateException("tenant baseline bundle has no valid version manifest");
        }
        String sqlPath = "baseline/" + version + "/__ddl.sql";
        byte[] sql = null;
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(bundle))) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                if (entry.getName().equals(sqlPath)) sql = zip.readAllBytes();
            }
        }
        if (sql == null) throw new IllegalStateException("tenant baseline bundle has no DDL script");
        return new BundleMetadata(version, sqlPath, sha256(sql));
    }

    private String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception e) { throw new IllegalStateException("SHA-256 unavailable", e); }
    }

    private record BundleMetadata(String version, String sqlPath, String sqlDigest) {
    }
}
