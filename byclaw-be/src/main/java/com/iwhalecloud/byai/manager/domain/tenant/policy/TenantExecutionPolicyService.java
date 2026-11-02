package com.iwhalecloud.byai.manager.domain.tenant.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.quota.SharedQuotaReader;
import com.iwhalecloud.byai.common.quota.QuotaSnapshot;
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

/** HACU owns commercial rules; read its shared Redis snapshot without a local rule copy. */
@Service
public class TenantExecutionPolicyService {
    private static final Set<String> MODES = Set.of("PREPARED", "ENABLED", "READ_ONLY", "SUSPENDED");
    private static final Set<String> LIMITS = Set.of("memberLimit", "groupLimit", "groupMemberLimit",
        "storageBytes", "agentLimit", "parallelTaskLimit");
    private final JdbcTemplate jdbc;
    private final SharedQuotaReader quotas;
    private final ObjectMapper mapper;
    private final boolean enabled;
    private final Clock clock;
    private final Set<Long> exemptions;

    @Autowired
    public TenantExecutionPolicyService(JdbcTemplate jdbc, ObjectMapper mapper, SharedQuotaReader quotas,
        @Value("${byclaw.tenant-policy.enabled:false}") boolean enabled,
        @Value("${byclaw.tenant-policy.exempt-enterprise-ids:}") String exemptions) {
        this(jdbc, mapper, quotas, enabled, Clock.systemUTC(), Arrays.stream(exemptions.split(","))
            .map(String::trim).filter(s -> !s.isEmpty()).map(Long::valueOf).collect(Collectors.toUnmodifiableSet()));
    }

    TenantExecutionPolicyService(JdbcTemplate jdbc, ObjectMapper mapper, SharedQuotaReader quotas, boolean enabled, Clock clock) {
        this(jdbc, mapper, quotas, enabled, clock, Set.of());
    }

    TenantExecutionPolicyService(JdbcTemplate jdbc, ObjectMapper mapper, SharedQuotaReader quotas, boolean enabled, Clock clock,
        Set<Long> exemptions) {
        this.jdbc = jdbc;
        this.quotas = java.util.Objects.requireNonNull(quotas);
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
        jdbc.update("INSERT INTO byai.tenant_operation_state(enterprise_id,policy_revision,runtime_generation) VALUES (?,1,'0')", enterpriseId);
        // The existing config marker is checked before new policy tables for old-deployment compatibility.
        if (jdbc.queryForObject("SELECT count(*) FROM byai.tenant_config WHERE enterprise_id=? AND params_code='COMMERCIAL_MANAGED' AND params_value='true'", Integer.class, enterpriseId) == 0)
            throw new IllegalStateException("commercial marker must be reserved before policy preparation");
    }

    @Transactional
    public PolicyView update(long enterpriseId, long expectedRevision, JsonNode snapshot) {
        requireTransaction();
        if (expectedRevision < 1 || expectedRevision == Long.MAX_VALUE) throw denied("POLICY_REVISION_CONFLICT");
        JsonNode policy = validate(snapshot, expectedRevision + 1);
        long next = expectedRevision + 1;
        QuotaSnapshot published = quotas.readRequired(enterpriseId);
        if (!Long.toString(next).equals(published.revision())) throw unavailable();
        // 请求只用于确认 HACU 已发布的快照，绝不在 ByClaw 保存或发布商业规则。
        if (!policy.path("accessMode").asText().equals(published.accessMode())
            || !sameInstant(text(policy, "effectiveFrom"), published.effectiveFrom())
            || !sameInstant(text(policy, "effectiveUntil"), published.effectiveTo())
            || policy.path("limits").path("memberLimit").asInt() != published.memberLimit()
            || policy.path("limits").path("groupLimit").asInt() != published.groupLimit()
            || policy.path("limits").path("groupMemberLimit").asInt() != published.groupMemberLimit()
            || policy.path("limits").path("agentLimit").asInt() != published.agentLimit())
            throw denied("POLICY_PUBLICATION_CONFLICT");
        if (jdbc.update("UPDATE byai.tenant_operation_state SET policy_revision=? WHERE enterprise_id=? AND policy_revision=?", next, enterpriseId, expectedRevision) != 1)
            throw denied("POLICY_REVISION_CONFLICT");
        return projection(enterpriseId);
    }

    @Transactional
    public void setGeneration(long enterpriseId, String generation) {
        requireTransaction();
        if (generation == null || !generation.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException("invalid generation");
        // A generation is monotonic; duplicate notifications are harmless and stale ones are rejected.
        int changed = jdbc.update("UPDATE byai.tenant_operation_state SET runtime_generation=? WHERE enterprise_id=? AND CAST(runtime_generation AS BIGINT)<=?", generation, enterpriseId, Long.parseLong(generation));
        if (changed != 1) throw denied("POLICY_GENERATION_CONFLICT");
    }

    @Transactional
    public void acknowledge(long enterpriseId, long revision, String generation, String consumerKey) {
        requireTransaction();
        if (!"main-service".equals(consumerKey)) throw denied("POLICY_CAPABILITY_UNSUPPORTED");
        QuotaSnapshot published = quotas.readRequired(enterpriseId);
        if (!Long.toString(revision).equals(published.revision())) throw denied("POLICY_ACK_STALE");
        // 这里只保存技术确认的版本，不复制规则正文或有效期。
        if (jdbc.update("UPDATE byai.tenant_operation_state SET policy_revision=? WHERE enterprise_id=? AND runtime_generation=?", revision, enterpriseId, generation) != 1)
            throw denied("POLICY_ACK_STALE");
        // 只保留主服务最近一次确认，同一版本/代次重复确认不覆盖首次确认时间。
        Integer existing = jdbc.queryForObject("SELECT count(*) FROM byai.tenant_operation_state "
            + "WHERE enterprise_id=? AND applied_rule_revision=? AND applied_runtime_generation=?",
            Integer.class, enterpriseId, revision, generation);
        if (existing != null && existing > 0) return;
        jdbc.update("UPDATE byai.tenant_operation_state SET applied_rule_revision=?,applied_runtime_generation=?,rule_applied_at=? WHERE enterprise_id=?",
            revision, generation, Timestamp.from(clock.instant()), enterpriseId);
    }

    public void requireExecution(long enterpriseId) {
        if (enterpriseId <= 0) throw denied("POLICY_TENANT_MISSING");
        // Deployment exemptions cannot be self-granted by a commercial policy request.
        if (exemptions.contains(enterpriseId)) return;
        if (!enabled && !managed(enterpriseId)) return;
        requireNotDeleting(enterpriseId);
        PolicyView view = projection(enterpriseId);
        if (view.desiredRevision() == null) throw denied("POLICY_MISSING");
        Instant now = clock.instant();
        if (view.effectiveFrom() == null || view.effectiveUntil() == null
            || (view.effectiveFrom() != null && now.isBefore(Instant.parse(view.effectiveFrom())))
            || (view.effectiveUntil() != null && !now.isBefore(Instant.parse(view.effectiveUntil()))))
            throw denied("POLICY_NOT_EFFECTIVE");
        if (!"ENABLED".equals(view.accessMode())) throw denied("POLICY_EXECUTION_DISABLED");
        // ENABLED and its effective interval decide admission; incomplete quota consumers do not deny all use.
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
        QuotaSnapshot snapshot = quotas.readRequired(enterpriseId);
        var generations = jdbc.query("SELECT runtime_generation FROM byai.tenant_operation_state WHERE enterprise_id=?",
            (rs, index) -> rs.getString(1), enterpriseId);
        return new PolicyView(Long.toString(enterpriseId), snapshot.revision(),
            generations.isEmpty() ? null : generations.getFirst(), snapshot.accessMode(),
            instant(snapshot.effectiveFrom()), instant(snapshot.effectiveTo()), false, capabilities());
    }

    /** 技术开通允许 PREPARED；必须等到 HACU 的初始快照实际发布后才能创建资源。 */
    public void requireProvisioning(long enterpriseId) {
        requireNotDeleting(enterpriseId);
        QuotaSnapshot snapshot = quotas.readRequired(enterpriseId);
        if (!Set.of("PREPARED", "ENABLED").contains(snapshot.accessMode())) throw denied("POLICY_EXECUTION_DISABLED");
        Instant now = clock.instant();
        if ((snapshot.effectiveFrom() != null && now.isBefore(snapshot.effectiveFrom().toInstant()))
            || (snapshot.effectiveTo() != null && !now.isBefore(snapshot.effectiveTo().toInstant())))
            throw denied("POLICY_NOT_EFFECTIVE");
        if ("ENABLED".equals(snapshot.accessMode()) && (snapshot.effectiveFrom() == null || snapshot.effectiveTo() == null))
            throw denied("POLICY_NOT_EFFECTIVE");
    }

    private void requireNotDeleting(long enterpriseId) {
        var states = jdbc.query("SELECT params_value FROM byai.tenant_config WHERE enterprise_id=? AND params_code='PROVISION_STATE'",
            (rs, index) -> rs.getString(1), enterpriseId);
        if (!states.isEmpty()) {
            try {
                if (Set.of("DELETING", "DELETE_FAILED", "DELETED").contains(mapper.readTree(states.getFirst()).path("status").asText()))
                    throw denied("POLICY_EXECUTION_DISABLED");
            } catch (PolicyDeniedException denied) { throw denied; }
            catch (Exception invalid) { throw unavailable(); }
        }
    }

    private static String instant(java.time.OffsetDateTime value) { return value == null ? null : value.toInstant().toString(); }
    private static boolean sameInstant(String requested, java.time.OffsetDateTime published) {
        return requested == null ? published == null : published != null && Instant.parse(requested).equals(published.toInstant());
    }
    private static ResponseStatusException unavailable() {
        return new SharedQuotaReader.SharedQuotaUnavailableException();
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
            // Accept the access state independently of the capability report; do not fabricate consumer ACKs.
        }
        return policy.deepCopy();
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
    public record PolicyView(String enterpriseId, String desiredRevision, String generation, String accessMode,
        String effectiveFrom, String effectiveUntil, boolean fullyApplied, Map<String, Boolean> capabilities) {}
    public static class PolicyDeniedException extends ResponseStatusException {
        public PolicyDeniedException(String code) { super(HttpStatus.CONFLICT, code); }
    }
}
