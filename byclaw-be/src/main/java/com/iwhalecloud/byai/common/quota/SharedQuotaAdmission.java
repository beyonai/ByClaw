package com.iwhalecloud.byai.common.quota;

import java.util.Optional;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

/**
 * Package admission shares a database write guard with the actual membership mutation.
 * The UPDATE lock survives arbitrary Redis lease expiry and is released only at transaction end.
 */
@Component
public class SharedQuotaAdmission {
    public static final String BUSINESS_ENTERPRISE_EXT = "group_business_enterprise_id";
    private final SharedQuotaReader reader;
    private final JdbcTemplate jdbc;
    public SharedQuotaAdmission(SharedQuotaReader reader, JdbcTemplate jdbc) { this.reader = reader; this.jdbc = jdbc; }

    public Optional<QuotaSnapshot> beginEnterprise(Long enterpriseId) {
        var snapshot = read(enterpriseId);
        if (snapshot.isEmpty()) return snapshot;
        lock("ENTERPRISE_MEMBER", snapshot.orElseThrow().enterpriseId());
        // A package may have been lowered while this transaction waited behind another writer.
        return read(enterpriseId);
    }

    public Optional<QuotaSnapshot> beginGroup(Long enterpriseId, Long sessionId) {
        var snapshot = read(enterpriseId);
        if (snapshot.isEmpty()) return snapshot;
        lock("LEGACY_GROUP_MEMBER", sessionId);
        return read(enterpriseId);
    }

    /**
     * Serializes creation of enterprise-owned workgroups and re-reads the
     * snapshot after waiting for another creator. Member writes keep using
     * the per-group guard above, so unrelated groups do not contend here.
     */
    public Optional<QuotaSnapshot> beginWorkgroup(Long enterpriseId) {
        var snapshot = read(enterpriseId);
        if (snapshot.isEmpty()) return snapshot;
        lock("ENTERPRISE_WORKGROUP", enterpriseId);
        return read(enterpriseId);
    }

    /**
     * Final guard for generic session-member writers, using persisted session ownership instead of a request DTO.
     * Private H_AS sessions do not read commercial Redis state; a duplicate LIMITED group identity is a no-op.
     */
    public boolean admitPersistedGroupMember(Long sessionId, String type, Long memberId) {
        var sessions = jdbc.query("SELECT enterprise_id,session_type FROM byai.byai_session WHERE session_id=?",
            (rs, index) -> new StoredSession(rs.getObject(1, Long.class), rs.getString(2)), sessionId);
        if (sessions.isEmpty() || !"hs_as".equalsIgnoreCase(sessions.getFirst().type())) return true;
        if (memberId == null || memberId <= 0 || !("USER".equals(type) || "AGENT".equals(type))) {
            throw new IllegalArgumentException("groupchat.member.invalid");
        }
        var markers = jdbc.query("SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=? AND ext_param_code=?",
            (rs, index) -> rs.getString(1), sessionId, BUSINESS_ENTERPRISE_EXT);
        Long enterpriseId = persistedEnterprise(sessions.getFirst().enterpriseId(), markers);
        if (enterpriseId == null) return true;
        var snapshot = beginGroup(enterpriseId, sessionId);
        if (snapshot.isEmpty()) return true;
        if (markers.isEmpty()) throw unconfirmedOwnership();
        // Recheck identity under the database guard, since a Redis coordination lease can expire.
        Long existing = jdbc.queryForObject("SELECT COUNT(*) FROM byai.byai_session_member WHERE session_id=? AND mem_obj_type=? AND mem_obj_id=?",
            Long.class, sessionId, type, memberId);
        if (existing != null && existing > 0) return false;
        checkGroupMembers(snapshot, sessionId, type, 1);
        return true;
    }

    private Long persistedEnterprise(Long storedEnterprise, List<String> markers) {
        if (markers.isEmpty()) return storedEnterprise == null || storedEnterprise <= 0 ? null : storedEnterprise;
        if (markers.size() != 1) throw unconfirmedOwnership();
        String value = markers.getFirst();
        if ("NONE".equals(value)) return null;
        try {
            if (value == null || !value.matches("[1-9][0-9]*")) throw new IllegalArgumentException();
            Long enterpriseId = Long.valueOf(value);
            if (!Objects.equals(enterpriseId, storedEnterprise)) throw new IllegalArgumentException();
            return enterpriseId;
        } catch (IllegalArgumentException invalid) { throw unconfirmedOwnership(); }
    }

    private static ResponseStatusException unconfirmedOwnership() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "groupchat.quota.enterprise.unconfirmed");
    }

    private record StoredSession(Long enterpriseId, String type) { }

    public void checkMembers(Optional<QuotaSnapshot> snapshot, int additions) {
        if (snapshot.isEmpty() || additions == 0) return;
        QuotaSnapshot value = snapshot.orElseThrow();
        Long current = jdbc.queryForObject("SELECT COUNT(*) FROM byai.tenant_user_membership WHERE enterprise_id=? AND status='ACTIVE'",
            Long.class, value.enterpriseId());
        check(current, additions, value.memberLimit(), "tenant.member.limit.reached");
    }

    public void checkGroupMembers(Optional<QuotaSnapshot> snapshot, Long sessionId, String type, int additions) {
        if (snapshot.isEmpty() || additions == 0) return;
        QuotaSnapshot value = snapshot.orElseThrow();
        int limit = switch (type) {
            case "USER" -> value.groupMemberLimit();
            case "AGENT" -> value.agentLimit();
            default -> throw new IllegalArgumentException("Unsupported quota member type");
        };
        Long current = jdbc.queryForObject("SELECT COUNT(*) FROM byai.byai_session_member WHERE session_id=? AND mem_obj_type=?",
            Long.class, sessionId, type);
        check(current, additions, limit, "USER".equals(type) ? "groupchat.member.limit.reached" : "groupchat.agent.limit.reached");
    }

    /** Initial group batches have no persisted members; count the deduplicated owner and assistant too. */
    public void checkInitialGroupForEnterprise(Long enterpriseId, int humans, int agents) {
        checkInitialWorkgroup(enterpriseId, humans, agents);
    }

    /** Initial group batches have no persisted members; count the deduplicated owner and assistant too. */
    public void checkInitialGroup(Optional<QuotaSnapshot> snapshot, int humans, int agents) {
        if (snapshot.isEmpty()) return;
        check(0L, humans, snapshot.orElseThrow().groupMemberLimit(), "groupchat.member.limit.reached");
        check(0L, agents, snapshot.orElseThrow().agentLimit(), "groupchat.agent.limit.reached");
    }

    /** Checks the effective, non-closed hs_as groups for one enterprise. */
    public void checkWorkgroupCapacity(Optional<QuotaSnapshot> snapshot, Long enterpriseId, int additions) {
        if (snapshot.isEmpty() || additions == 0) return;
        if (enterpriseId == null || enterpriseId <= 0) throw new IllegalArgumentException("Quota enterprise id must be positive");
        Long current = jdbc.queryForObject(
            "SELECT COUNT(*) FROM byai.byai_session WHERE enterprise_id=? AND session_type='hs_as' "
                + "AND (state IS NULL OR state NOT IN ('CLOSED','GROUP_DISSOLVED'))",
            Long.class, enterpriseId);
        check(current, additions, snapshot.orElseThrow().groupLimit(), "groupchat.group.limit.reached");
    }

    /** Combined initial-group check used before any project, authorization or Node side effects. */
    public void checkInitialWorkgroup(Long enterpriseId, int humans, int agents) {
        var snapshot = beginWorkgroup(enterpriseId);
        if (snapshot.isEmpty()) return;
        checkWorkgroupCapacity(snapshot, enterpriseId, 1);
        checkInitialGroup(snapshot, humans, agents);
    }

    private Optional<QuotaSnapshot> read(Long enterpriseId) {
        if (enterpriseId == null || enterpriseId <= 0) return Optional.empty();
        var value = reader.read(enterpriseId);
        if (quotaProperties != null && quotaProperties.isCommercialManaged() && value.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "QUOTA_UNAVAILABLE");
        }
        if (quotaProperties != null && quotaProperties.isCommercialManaged() && value.isPresent() && !value.orElseThrow().commerciallyEffective()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "QUOTA_POLICY_NOT_EFFECTIVE");
        }
        return value;
    }
    @org.springframework.beans.factory.annotation.Autowired private SharedQuotaProperties quotaProperties;
    private SharedQuotaProperties properties() { return quotaProperties; }
    private void lock(String scope, Long id) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Quota admission requires the membership mutation transaction");
        }
        if (id == null || id <= 0) throw new IllegalArgumentException("Quota scope id must be positive");
        // Insertion races converge on one row; the following UPDATE serializes every count and write.
        jdbc.update("INSERT INTO byai.quota_write_guard(scope,subject_id,version) VALUES(?,?,0) ON CONFLICT DO NOTHING", scope, id);
        if (jdbc.update("UPDATE byai.quota_write_guard SET version=version+1 WHERE scope=? AND subject_id=?", scope, id) != 1) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant.quota.guard.unavailable");
        }
    }
    private static void check(Long current, int additions, int limit, String reason) {
        if (additions < 0) throw new IllegalArgumentException("Quota additions cannot be negative");
        if (current == null || current + (long) additions > limit) throw new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
}
