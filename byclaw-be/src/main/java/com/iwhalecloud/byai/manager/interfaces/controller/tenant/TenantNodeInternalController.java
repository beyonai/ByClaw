package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.iwhalecloud.byai.manager.domain.tenant.TenantCredentialCrypto;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.server.ResponseStatusException;

/** Token authenticated callbacks shared by BE and a tenant's Node workload. */
@RestController
@RequestMapping("/internal/v1")
public class TenantNodeInternalController {

    private final TenantAdminTenantMapper tenantMapper;
    private final TenantCredentialCrypto crypto;
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final String internalToken;

    public TenantNodeInternalController(TenantAdminTenantMapper tenantMapper, TenantCredentialCrypto crypto,
                                        JdbcTemplate jdbc, ObjectMapper objectMapper,
                                        @Value("${BYCLAW_TENANT_INTERNAL_TOKEN:}") String internalToken) {
        this.tenantMapper = tenantMapper;
        this.crypto = crypto;
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.internalToken = internalToken;
    }

    @PostMapping("/tenantKms/decrypt")
    public Map<String, String> decrypt(@RequestHeader(value = "Authorization", required = false) String authorization,
                                       @RequestBody KmsRequest request) throws GeneralSecurityException, JsonProcessingException {
        authenticate(authorization);
        long enterpriseId = parseId(request.enterpriseId());
        String database = "byclaw_t_" + enterpriseId;
        String stored = tenantMapper.selectConfig(enterpriseId, "DB_PASSWORD");
        String aad = Base64.getEncoder().encodeToString(
            ("byclaw:tenant-db:v1:" + enterpriseId + ":" + database).getBytes(StandardCharsets.UTF_8));
        if (!database.equals(request.databaseName()) || !aad.equals(request.aad())
            || stored == null || request.envelope() == null
            || !objectMapper.readValue(stored, Map.class).equals(request.envelope())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant credential identity mismatch");
        }
        String password = crypto.decrypt(enterpriseId, database, stored);
        return Map.of("plaintext", Base64.getEncoder().encodeToString(password.getBytes(StandardCharsets.UTF_8)));
    }

    @GetMapping("/tenants/{enterpriseId}/schema/current")
    public Map<String, Object> current(@RequestHeader(value = "Authorization", required = false) String authorization,
                                       @PathVariable long enterpriseId) {
        authenticate(authorization);
        if (enterpriseId <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        var rows = jdbc.query("SELECT audit_id, observed_version FROM byai.tenant_schema_audit "
                + "WHERE enterprise_id=? AND is_current=TRUE", (rs, row) -> {
                    Map<String, Object> value = new HashMap<>();
                    value.put("auditId", rs.getString(1));
                    value.put("observedVersion", rs.getString(2));
                    value.put("isCurrent", true);
                    return value;
                }, enterpriseId);
        return rows.isEmpty() ? Collections.singletonMap("currentVersion", null) : rows.getFirst();
    }

    @Transactional
    @PostMapping("/tenantSchemaTaskReports")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(@RequestHeader(value = "Authorization", required = false) String authorization,
                       @RequestBody Map<String, Object> payload) {
        authenticate(authorization);
        JsonNode result = objectMapper.valueToTree(payload);
        long enterpriseId = parseId(result.path("enterpriseId").asText());
        long generation = parseId(result.path("generation").asText());
        String auditId = result.path("auditId").asText();
        int attemptNo = result.path("attemptNo").asInt();
        String status = result.path("status").asText();
        if (!auditId.matches("[A-Za-z0-9_-]{1,64}") || attemptNo <= 0
            || !java.util.Set.of("VERIFIED", "FAILED", "NEEDS_ATTENTION", "RECONCILING")
                .contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid schema task report");
        }
        int count = jdbc.queryForObject("SELECT count(*) FROM byai.tenant_schema_audit WHERE audit_id=? "
            + "AND enterprise_id=? AND generation=? AND attempt_no=?", Integer.class,
            auditId, enterpriseId, generation, attemptNo);
        if (count != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "schema task audit mismatch");
        if ("VERIFIED".equals(status)) {
            jdbc.update("UPDATE byai.tenant_schema_audit SET is_current=FALSE WHERE enterprise_id=? AND is_current=TRUE",
                enterpriseId);
        }
        String observed = result.path("observedVersion").isTextual()
            ? result.path("observedVersion").asText() : null;
        String reason = result.path("failureReason").isTextual()
            ? result.path("failureReason").asText() : null;
        if (reason != null) reason = reason.substring(0, Math.min(reason.length(), 500));
        jdbc.update("UPDATE byai.tenant_schema_audit SET status=?, observed_version=?, is_current=?, "
                + "step_details_json=?::jsonb, sqlstate=?, error_code=?, failure_reason=?, "
                + "started_at=COALESCE(started_at,?), finished_at=? "
                + "WHERE audit_id=? AND enterprise_id=? AND generation=? AND attempt_no=?",
            status, observed, "VERIFIED".equals(status), result.path("steps").toString(),
            result.path("sqlState").isTextual() ? result.path("sqlState").asText() : null,
            result.path("errorCode").isTextual() ? result.path("errorCode").asText() : null,
            reason, timestamp(result.path("startedAt").asText(null)),
            timestamp(result.path("finishedAt").asText(null)), auditId, enterpriseId, generation, attemptNo);
    }

    private Timestamp timestamp(String value) {
        if (value == null) return null;
        try { return Timestamp.from(Instant.parse(value)); }
        catch (Exception e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid report timestamp"); }
    }

    private long parseId(String value) {
        if (value == null || !value.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant identity");
        }
        try { return Long.parseLong(value); }
        catch (NumberFormatException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant identity"); }
    }

    private void authenticate(String authorization) {
        byte[] expected = ("Bearer " + internalToken).getBytes(StandardCharsets.UTF_8);
        byte[] actual = authorization == null ? new byte[0] : authorization.getBytes(StandardCharsets.UTF_8);
        if (internalToken == null || internalToken.isBlank() || !MessageDigest.isEqual(expected, actual)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant Node token required");
        }
    }

    public record KmsRequest(String enterpriseId, String databaseName, String aad, Map<String, Object> envelope) {
    }
}
