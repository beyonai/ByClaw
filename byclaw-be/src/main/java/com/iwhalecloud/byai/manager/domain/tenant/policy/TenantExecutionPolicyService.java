package com.iwhalecloud.byai.manager.domain.tenant.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** Authoritative immutable policies; unsupported runtime consumers never imply activation. */
@Service
public class TenantExecutionPolicyService {
    private static final Set<String> MODES = Set.of("PREPARED", "ENABLED", "READ_ONLY", "SUSPENDED");
    private static final Set<String> LIMITS = Set.of("memberLimit", "groupLimit", "groupMemberLimit",
        "storageBytes", "agentLimit", "parallelTaskLimit");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final boolean enabled;
    private final Clock clock;
    private final Set<Long> exemptions;

    @Autowired
    public TenantExecutionPolicyService(JdbcTemplate jdbc, ObjectMapper mapper,
        @Value("${byclaw.tenant-policy.enabled:false}") boolean enabled,
        @Value("${byclaw.tenant-policy.exempt-enterprise-ids:}") String exemptions) {
        this(jdbc, mapper, enabled, Clock.systemUTC(), Arrays.stream(exemptions.split(","))
            .map(String::trim).filter(s -> !s.isEmpty()).map(Long::valueOf).collect(Collectors.toUnmodifiableSet()));
    }

    TenantExecutionPolicyService(JdbcTemplate jdbc, ObjectMapper mapper, boolean enabled, Clock clock) {
        this(jdbc, mapper, enabled, clock, Set.of());
    }

    TenantExecutionPolicyService(JdbcTemplate jdbc, ObjectMapper mapper, boolean enabled, Clock clock,
        Set<Long> exemptions) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.enabled = enabled;
        this.clock = clock;
        this.exemptions = Set.copyOf(exemptions);
        if (this.exemptions.stream().anyMatch(id -> id <= 0)) throw new IllegalArgumentException("invalid exemption");
    }

    @Transactional
    public void prepare(long enterpriseId, JsonNode initialPolicy) {
        requireTransaction();
        JsonNode policy = validate(initialPolicy, 1);
        if (!"PREPARED".equals(policy.path("accessMode").asText())) throw new IllegalArgumentException("initial policy must be PREPARED");
        if (enterpriseId <= 0) throw new IllegalArgumentException("invalid enterprise id");
        jdbc.update("INSERT INTO byai.tenant_policy_cursor(enterprise_id,desired_revision,generation) VALUES (?,1,'0')", enterpriseId);
        jdbc.update("INSERT INTO byai.tenant_execution_policy(enterprise_id,revision,payload) VALUES (?,1,?)", enterpriseId, policy.toString());
        // The existing config marker is checked before new policy tables for old-deployment compatibility.
        if (jdbc.queryForObject("SELECT count(*) FROM byai.tenant_config WHERE enterprise_id=? AND params_code='COMMERCIAL_MANAGED' AND params_value='true'", Integer.class, enterpriseId) == 0)
            throw new IllegalStateException("commercial marker must be reserved before policy preparation");
        bridgeMemberLimit(enterpriseId, policy);
    }

    @Transactional
    public PolicyView update(long enterpriseId, long expectedRevision, JsonNode snapshot) {
        requireTransaction();
        if (expectedRevision < 1 || expectedRevision == Long.MAX_VALUE) throw denied("POLICY_REVISION_CONFLICT");
        JsonNode policy = validate(snapshot, expectedRevision + 1);
        long next = expectedRevision + 1;
        if (jdbc.update("UPDATE byai.tenant_policy_cursor SET desired_revision=? WHERE enterprise_id=? AND desired_revision=?", next, enterpriseId, expectedRevision) != 1)
            throw denied("POLICY_REVISION_CONFLICT");
        jdbc.update("INSERT INTO byai.tenant_execution_policy(enterprise_id,revision,payload) VALUES (?,?,?)", enterpriseId, next, policy.toString());
        bridgeMemberLimit(enterpriseId, policy);
        return projection(enterpriseId);
    }

    @Transactional
    public void setGeneration(long enterpriseId, String generation) {
        requireTransaction();
        if (generation == null || !generation.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException("invalid generation");
        // A generation is monotonic; duplicate notifications are harmless and stale ones are rejected.
        int changed = jdbc.update("UPDATE byai.tenant_policy_cursor SET generation=? WHERE enterprise_id=? AND CAST(generation AS BIGINT)<=?", generation, enterpriseId, Long.parseLong(generation));
        if (changed != 1) throw denied("POLICY_GENERATION_CONFLICT");
    }

    @Transactional
    public void acknowledge(long enterpriseId, long revision, String generation, String consumerKey) {
        requireTransaction();
        if (!"main-service".equals(consumerKey)) throw denied("POLICY_CAPABILITY_UNSUPPORTED");
        // This conditional update holds the cursor until ACK insert commits, fencing concurrent generations.
        if (jdbc.update("UPDATE byai.tenant_policy_cursor SET desired_revision=desired_revision WHERE enterprise_id=? AND desired_revision=? AND generation=?", enterpriseId, revision, generation) != 1)
            throw denied("POLICY_ACK_STALE");
        // The cursor update above serializes ACK writers for this tenant until this transaction commits.
        // Check the full identity under that fence; openGauss does not support PostgreSQL ON CONFLICT.
        Integer existing = jdbc.queryForObject("SELECT count(*) FROM byai.tenant_policy_consumer "
            + "WHERE enterprise_id=? AND policy_revision=? AND consumer_key=? AND generation=?",
            Integer.class, enterpriseId, revision, consumerKey, generation);
        if (existing != null && existing > 0) return;
        jdbc.update("INSERT INTO byai.tenant_policy_consumer(enterprise_id,policy_revision,consumer_key,generation,applied_at) VALUES (?,?,?,?,?)",
            enterpriseId, revision, consumerKey, generation, Timestamp.from(clock.instant()));
    }

    public void requireExecution(long enterpriseId) {
        if (enterpriseId <= 0) throw denied("POLICY_TENANT_MISSING");
        // Deployment exemptions cannot be self-granted by a commercial policy request.
        if (exemptions.contains(enterpriseId)) return;
        if (!enabled && !managed(enterpriseId)) return;
        PolicyView view = projection(enterpriseId);
        if (view.desiredRevision() == null) throw denied("POLICY_MISSING");
        Instant now = clock.instant();
        if ((view.effectiveFrom() != null && now.isBefore(Instant.parse(view.effectiveFrom())))
            || (view.effectiveUntil() != null && !now.isBefore(Instant.parse(view.effectiveUntil()))))
            throw denied("POLICY_NOT_EFFECTIVE");
        if (!"ENABLED".equals(view.accessMode())) throw denied("POLICY_EXECUTION_DISABLED");
        throw denied("POLICY_CAPABILITY_UNSUPPORTED");
    }

    /** SaaS tenant creation must enter the authenticated commercial reservation transaction. */
    public void requireLegacyCreationAllowed() {
        if (enabled) throw denied("COMMERCIAL_CREATION_REQUIRED");
    }

    public void requireCurrentExecution() {
        var info = com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo();
        if (info == null || info.getEnterpriseId() == null) {
            if (enabled) throw denied("POLICY_TENANT_MISSING");
            return;
        }
        requireExecution(info.getEnterpriseId());
    }

    public PolicyView projection(long enterpriseId) {
        var rows = jdbc.query("SELECT c.desired_revision,c.generation,p.payload FROM byai.tenant_policy_cursor c JOIN byai.tenant_execution_policy p ON p.enterprise_id=c.enterprise_id AND p.revision=c.desired_revision WHERE c.enterprise_id=?",
            (rs, index) -> new Stored(rs.getLong(1), rs.getString(2), parse(rs.getString(3))), enterpriseId);
        if (rows.isEmpty()) return new PolicyView(Long.toString(enterpriseId), null, null, null, null, null, false, capabilities());
        Stored row = rows.get(0);
        return new PolicyView(Long.toString(enterpriseId), Long.toString(row.revision()), row.generation(), row.policy().path("accessMode").asText(), text(row.policy(), "effectiveFrom"), text(row.policy(), "effectiveUntil"), false, capabilities());
    }

    private boolean managed(long enterpriseId) {
        return jdbc.queryForObject("SELECT count(*) FROM byai.tenant_config WHERE enterprise_id=? AND params_code='COMMERCIAL_MANAGED' AND params_value='true'", Integer.class, enterpriseId) > 0;
    }

    private JsonNode validate(JsonNode policy, long revision) {
        if (policy == null || !policy.isObject()) throw new IllegalArgumentException("policy must be an object");
        policy.fieldNames().forEachRemaining(key -> { if (!Set.of("revision", "accessMode", "effectiveFrom", "effectiveUntil", "limits").contains(key)) throw new IllegalArgumentException("unknown policy field"); });
        if (!policy.path("revision").isTextual() || !Long.toString(revision).equals(policy.path("revision").asText()))
            throw new IllegalArgumentException("policy revision does not match expected successor");
        if (!MODES.contains(policy.path("accessMode").asText())) throw new IllegalArgumentException("invalid access mode");
        String from = text(policy, "effectiveFrom"), until = text(policy, "effectiveUntil");
        if (from != null) Instant.parse(from);
        if (until != null) Instant.parse(until);
        if (from != null && until != null && !Instant.parse(from).isBefore(Instant.parse(until))) throw new IllegalArgumentException("invalid effective interval");
        JsonNode limits = policy.get("limits");
        if (limits == null || !limits.isObject() || limits.size() != LIMITS.size())
            throw new IllegalArgumentException("all policy limits are required");
        limits.fields().forEachRemaining(entry -> {
            JsonNode value = entry.getValue();
            boolean storage = "storageBytes".equals(entry.getKey());
            if (!LIMITS.contains(entry.getKey()) || (storage ? !value.isTextual() : !value.isIntegralNumber())
                || !value.asText().matches("[0-9]{1,19}")) throw new IllegalArgumentException("invalid quota");
            var number = new java.math.BigInteger(value.asText());
            if (number.compareTo(java.math.BigInteger.valueOf(storage ? Long.MAX_VALUE : Integer.MAX_VALUE)) > 0
                || ("memberLimit".equals(entry.getKey()) && number.signum() == 0))
                throw new IllegalArgumentException("invalid quota range");
        });
        if ("ENABLED".equals(policy.path("accessMode").asText())) {
            if (from == null || until == null) throw new IllegalArgumentException("enabled policy needs effective interval");
            throw denied("POLICY_CAPABILITY_UNSUPPORTED");
        }
        return policy.deepCopy();
    }

    private void bridgeMemberLimit(long enterpriseId, JsonNode policy) {
        JsonNode member = policy.path("limits").get("memberLimit");
        if (member == null) return;
        // Serialize policy changes with application-side member admission before reading the snapshot.
        int changed = jdbc.update("UPDATE byai.tenant_config SET params_version=COALESCE(params_version,0)+1 WHERE enterprise_id=? AND params_code='PACKAGE_CONTENT_SNAPSHOT'", enterpriseId);
        if (changed != 1) throw denied("POLICY_PACKAGE_SNAPSHOT_MISSING");
        String raw = jdbc.queryForObject("SELECT params_value FROM byai.tenant_config WHERE enterprise_id=? AND params_code='PACKAGE_CONTENT_SNAPSHOT'", String.class, enterpriseId);
        ObjectNode snapshot = (ObjectNode) parse(raw);
        snapshot.put("memberLimit", member.asInt());
        jdbc.update("UPDATE byai.tenant_config SET params_value=? WHERE enterprise_id=? AND params_code='PACKAGE_CONTENT_SNAPSHOT'", snapshot.toString(), enterpriseId);
    }

    private JsonNode parse(String raw) {
        try { return mapper.readTree(raw); }
        catch (Exception error) { throw denied("POLICY_UNAVAILABLE"); }
    }
    private static String text(JsonNode node, String key) {
        JsonNode value = node.get(key);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw new IllegalArgumentException("invalid policy instant");
        return value.asText();
    }
    private static void requireTransaction() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("policy mutation requires transaction");
    }
    public static Map<String, Boolean> capabilities() {
        // Existing internal member checks do not yet cover every invitation and membership writer.
        return Map.of("memberLimit", false, "groupLimit", false, "groupMemberLimit", false,
            "storageBytes", false, "agentLimit", false, "parallelTaskLimit", false, "nodePolicyConsumer", false);
    }
    private static PolicyDeniedException denied(String code) { return new PolicyDeniedException(code); }
    private record Stored(long revision, String generation, JsonNode policy) {}
    public record PolicyView(String enterpriseId, String desiredRevision, String generation, String accessMode,
        String effectiveFrom, String effectiveUntil, boolean fullyApplied, Map<String, Boolean> capabilities) {}
    public static class PolicyDeniedException extends ResponseStatusException {
        public PolicyDeniedException(String code) { super(HttpStatus.CONFLICT, code); }
    }
}
