package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.Set;

/** Narrow service boundary; authenticated source/tenant and command audit belong to the caller. */
@Service
public class TenantInternalEnterpriseService {
    private final JdbcTemplate jdbc;
    private final SequenceService sequence;
    private final SharedQuotaAdmission quotaAdmission;
    public TenantInternalEnterpriseService(JdbcTemplate jdbc, SequenceService sequence, SharedQuotaAdmission quotaAdmission) {
        this.jdbc = jdbc; this.sequence = sequence; this.quotaAdmission = quotaAdmission;
    }
    @Transactional(readOnly = true)
    public EnterpriseView getEnterprise(long enterpriseId) {
        positive(enterpriseId);
        var rows = jdbc.query("SELECT enterprise_id,com_acct_name FROM byai.po_enterprise_info WHERE enterprise_id=?",
            (rs, index) -> new EnterpriseView(Long.toString(rs.getLong(1)), rs.getString(2)), enterpriseId);
        if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "ENTERPRISE_NOT_FOUND");
        return rows.getFirst();
    }
    @Transactional
    public EnterpriseView updateEnterprise(long enterpriseId, JsonNode payload) {
        requireTransaction();
        fields(payload, Set.of("enterpriseName"));
        JsonNode name = payload.get("enterpriseName");
        if (name == null || !name.isTextual() || name.textValue().isBlank() || name.textValue().length() > 200
            || !name.textValue().equals(name.textValue().trim())) throw error(HttpStatus.BAD_REQUEST, "ENTERPRISE_NAME_INVALID");
        positive(enterpriseId);
        if (jdbc.update("UPDATE byai.po_enterprise_info SET com_acct_name=? WHERE enterprise_id=?", name.textValue(), enterpriseId) != 1)
            throw error(HttpStatus.NOT_FOUND, "ENTERPRISE_NOT_FOUND");
        return getEnterprise(enterpriseId);
    }
    @Transactional(readOnly = true)
    public List<MemberView> listMembers(long enterpriseId) {
        getEnterprise(enterpriseId);
        return jdbc.query("SELECT membership_id,user_id,role,status FROM byai.tenant_user_membership WHERE enterprise_id=? ORDER BY membership_id",
            (rs, index) -> new MemberView(Long.toString(rs.getLong(1)), Long.toString(rs.getLong(2)), rs.getString(3), rs.getString(4)), enterpriseId);
    }
    @Transactional
    public MemberView addMember(long enterpriseId, JsonNode payload) {
        requireTransaction();
        fields(payload, Set.of("userId", "role", "createdByUserId"));
        long userId = decimal(payload.get("userId")), auditUserId = decimal(payload.get("createdByUserId"));
        if (!payload.path("role").isTextual() || !"MEMBER".equals(payload.path("role").textValue()))
            throw error(HttpStatus.BAD_REQUEST, "MEMBER_ROLE_UNSUPPORTED");
        getEnterprise(enterpriseId);
        validUser(userId); validUser(auditUserId);
        var quota = quotaAdmission.beginEnterprise(enterpriseId);
        Long owners = jdbc.queryForObject("SELECT COUNT(*) FROM byai.tenant_user_membership WHERE enterprise_id=? AND status='ACTIVE' AND role='OWNER'", Long.class, enterpriseId);
        if (owners == null || owners != 1) throw error(HttpStatus.CONFLICT, "MEMBER_OWNER_INVARIANT");
        var existing = jdbc.query("SELECT membership_id,user_id,role,status FROM byai.tenant_user_membership WHERE enterprise_id=? AND user_id=?",
            (rs, index) -> new MemberView(Long.toString(rs.getLong(1)), Long.toString(rs.getLong(2)), rs.getString(3), rs.getString(4)), enterpriseId, userId);
        if (!existing.isEmpty()) {
            if (!"ACTIVE".equals(existing.getFirst().status())) throw error(HttpStatus.CONFLICT, "MEMBER_ALREADY_EXISTS");
            return existing.getFirst();
        }
        quotaAdmission.checkMembers(quota, 1);
        long id = sequence.nextVal();
        // createdByUserId is a validated base-user audit reference, never a permission grant.
        jdbc.update("INSERT INTO byai.tenant_user_membership(membership_id,enterprise_id,user_id,role,status,created_by) VALUES (?,?,?,'MEMBER','ACTIVE',?)", id, enterpriseId, userId, auditUserId);
        return new MemberView(Long.toString(id), Long.toString(userId), "MEMBER", "ACTIVE");
    }

    private void validUser(long id) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM byai.po_users WHERE user_id=? AND state='A' AND UPPER(COALESCE(is_locked,'N'))<>'Y' AND (user_eff_date IS NULL OR user_eff_date<=CURRENT_TIMESTAMP) AND (user_exp_date IS NULL OR user_exp_date>CURRENT_TIMESTAMP)", Long.class, id);
        if (count == null || count != 1) throw error(HttpStatus.BAD_REQUEST, "MEMBER_USER_INVALID");
    }
    private static void fields(JsonNode payload, Set<String> allowed) {
        if (payload == null || !payload.isObject()) throw error(HttpStatus.BAD_REQUEST, "REQUEST_FIELDS_INVALID");
        payload.fieldNames().forEachRemaining(field -> {
            if (!allowed.contains(field)) throw error(HttpStatus.BAD_REQUEST, "REQUEST_FIELDS_UNSUPPORTED");
        });
    }
    private static long decimal(JsonNode node) {
        if (node == null || !node.isTextual() || !node.textValue().matches("[1-9][0-9]*")) throw error(HttpStatus.BAD_REQUEST, "MEMBER_ID_INVALID");
        try { return Long.parseLong(node.textValue()); }
        catch (NumberFormatException exception) { throw error(HttpStatus.BAD_REQUEST, "MEMBER_ID_INVALID"); }
    }
    private static void positive(long id) {
        if (id <= 0) throw error(HttpStatus.BAD_REQUEST, "ENTERPRISE_ID_INVALID");
    }
    private static void requireTransaction() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Internal mutations require the command transaction");
    }
    private static ResponseStatusException error(HttpStatus status, String code) { return new ResponseStatusException(status, code); }
    public record EnterpriseView(String enterpriseId, String enterpriseName) { }
    public record MemberView(String membershipId, String userId, String role, String status) { }
}
