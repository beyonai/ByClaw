package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminMemberMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Platform-admin membership operations share transaction-local enterprise quota admission. */
@Service
public class TenantAdminMemberService {

    private final TenantAdminMemberMapper memberMapper;
    private final ObjectMapper objectMapper;
    private final SequenceService sequenceService;
    private final SharedQuotaAdmission quotaAdmission;

    public TenantAdminMemberService(TenantAdminMemberMapper memberMapper, ObjectMapper objectMapper,
                                    SequenceService sequenceService, SharedQuotaAdmission quotaAdmission) {
        this.memberMapper = memberMapper;
        this.objectMapper = objectMapper;
        this.sequenceService = sequenceService;
        this.quotaAdmission = quotaAdmission;
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
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.userCode.invalid");
        }

        if (memberMapper.countEnterprise(enterpriseId) != 1)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant.notFound");
        var quota = quotaAdmission.beginEnterprise(enterpriseId);
        // Members can be prepared while the tenant sandbox is provisioning;
        // TenantContextService still rejects business access until READY.

        TenantMemberRow user = memberMapper.selectActiveUserByCode(userCode);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant.userCode.notFound");
        }
        TenantMemberRow existing = memberMapper.selectMember(enterpriseId, user.getUserId());
        if (existing != null) {
            if (!"ACTIVE".equals(existing.getStatus())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.member.disabled");
            }
            return toView(existing);
        }

        quotaAdmission.checkMembers(quota, 1);
        memberMapper.insertMember(sequenceService.nextVal(), enterpriseId, user.getUserId(),
            CurrentUserHolder.getCurrentUserId());
        return new TenantMemberView(Long.toString(user.getUserId()), userCode, user.getUserName(), "MEMBER", "ACTIVE");
    }

    /** Called only after Node has validated the accepted group invitation and its inviter. */
    @Transactional
    public void joinByInvitation(long enterpriseId, long inviterId) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant.login.required");
        var quota = quotaAdmission.beginEnterprise(enterpriseId);
        try {
            if (!"READY".equals(objectMapper.readTree(memberMapper.selectProvisionState(enterpriseId))
                .path("status").asText()))
                throw new IllegalArgumentException();
        }
        catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.not.ready");
        }
        TenantMemberRow inviter = memberMapper.selectMember(enterpriseId, inviterId);
        if (inviter == null || !"ACTIVE".equals(inviter.getStatus()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant.inviter.membership.required");
        TenantMemberRow existing = memberMapper.selectMember(enterpriseId, userId);
        if (existing != null) {
            if (!"ACTIVE".equals(existing.getStatus()))
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.member.disabled");
            return;
        }
        quotaAdmission.checkMembers(quota, 1);
        if (memberMapper.insertMember(sequenceService.nextVal(), enterpriseId, userId, inviterId) != 1)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.membership.unconfirmed");
    }

    private TenantMemberView toView(TenantMemberRow row) {
        return new TenantMemberView(Long.toString(row.getUserId()), row.getUserCode(), row.getUserName(),
            row.getRole(), row.getStatus());
    }

    private void requirePlatformAdmin() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant.admin.required");
        }
    }

    private long parseEnterpriseId(String text) {
        if (text == null || !text.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.enterpriseId.invalid");
        }
        try {
            return Long.parseLong(text);
        }
        catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.enterpriseId.invalid");
        }
    }

    public record TenantMemberView(String userId, String userCode, String userName, String role, String status) {
    }
}
