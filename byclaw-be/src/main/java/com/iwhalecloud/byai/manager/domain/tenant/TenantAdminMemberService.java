package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminMemberMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Platform-admin membership operations, serialized by the package snapshot row. */
@Service
public class TenantAdminMemberService {

    private final TenantAdminMemberMapper memberMapper;
    private final ObjectMapper objectMapper;
    private final SequenceService sequenceService;

    public TenantAdminMemberService(TenantAdminMemberMapper memberMapper, ObjectMapper objectMapper,
                                    SequenceService sequenceService) {
        this.memberMapper = memberMapper;
        this.objectMapper = objectMapper;
        this.sequenceService = sequenceService;
    }

    @Transactional(readOnly = true)
    public List<TenantMemberView> list(String enterpriseIdText) {
        requirePlatformAdmin();
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        return memberMapper.selectMembers(enterpriseId).stream().map(this::toView).toList();
    }

    @Transactional
    public TenantMemberView add(String enterpriseIdText, String userCode) {
        requirePlatformAdmin();
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        if (userCode == null || !userCode.matches("[a-zA-Z0-9_]{3,50}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid user code");
        }

        String packageSnapshot = memberMapper.selectPackageSnapshotForUpdate(enterpriseId);
        if (packageSnapshot == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant package snapshot unavailable");
        }
        int memberLimit = memberLimit(packageSnapshot);
        // Members can be prepared while the tenant sandbox is provisioning;
        // TenantContextService still rejects business access until READY.

        TenantMemberRow user = memberMapper.selectActiveUserByCode(userCode);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "user code not found");
        }
        TenantMemberRow existing = memberMapper.selectMember(enterpriseId, user.getUserId());
        if (existing != null) {
            if (!"ACTIVE".equals(existing.getStatus())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "disabled membership requires explicit re-enable");
            }
            return toView(existing);
        }

        if (memberMapper.countActiveMembers(enterpriseId) >= memberLimit) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant member limit reached");
        }
        memberMapper.insertMember(sequenceService.nextVal(), enterpriseId, user.getUserId(),
            CurrentUserHolder.getCurrentUserId());
        return new TenantMemberView(Long.toString(user.getUserId()), userCode, user.getUserName(), "MEMBER", "ACTIVE");
    }

    private TenantMemberView toView(TenantMemberRow row) {
        return new TenantMemberView(Long.toString(row.getUserId()), row.getUserCode(), row.getUserName(),
            row.getRole(), row.getStatus());
    }

    private int memberLimit(String json) {
        try {
            int limit = objectMapper.readTree(json).path("memberLimit").asInt();
            if (limit > 0) return limit;
        }
        catch (Exception ignored) {
            // Invalid package snapshots cannot authorize a member write.
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "invalid tenant package snapshot");
    }

    private void requirePlatformAdmin() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
    }

    private long parseEnterpriseId(String text) {
        if (text == null || !text.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
        try {
            return Long.parseLong(text);
        }
        catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
    }

    public record TenantMemberView(String userId, String userCode, String userName, String role, String status) {
    }
}
