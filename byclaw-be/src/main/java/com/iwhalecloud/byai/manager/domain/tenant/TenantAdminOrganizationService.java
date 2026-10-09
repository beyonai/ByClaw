package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminMemberMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantOrgNodeRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantOrganizationMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Reuses the platform organization hierarchy while assigning branches to a tenant. */
@Service
public class TenantAdminOrganizationService {

    private final TenantOrganizationMapper organizationMapper;
    private final TenantAdminMemberMapper memberMapper;
    private final SequenceService sequenceService;
    private final ObjectMapper objectMapper;

    public TenantAdminOrganizationService(TenantOrganizationMapper organizationMapper,
                                          TenantAdminMemberMapper memberMapper,
                                          SequenceService sequenceService, ObjectMapper objectMapper) {
        this.organizationMapper = organizationMapper;
        this.memberMapper = memberMapper;
        this.sequenceService = sequenceService;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<OrganizationView> tree(String enterpriseIdText) {
        requirePlatformAdmin();
        long enterpriseId = parseId(enterpriseIdText);
        return organizationMapper.selectOrganizationTree(enterpriseId).stream()
            .map(row -> new OrganizationView(Long.toString(row.getOrgId()),
                Long.toString(row.getParentOrgId()), row.getOrgName(), row.getOrgIndex(),
                row.getMemberCount(), Boolean.TRUE.equals(row.getAttached())))
            .toList();
    }

    @Transactional(readOnly = true)
    public List<OrganizationMemberView> members(String enterpriseIdText, String orgIdText,
                                                 boolean includeDescendants) {
        requirePlatformAdmin();
        long enterpriseId = parseId(enterpriseIdText);
        List<Long> orgIds = branch(parseId(orgIdText), includeDescendants);
        Map<Long, TenantMemberRow> existing = new HashMap<>();
        for (TenantMemberRow row : memberMapper.selectMembers(enterpriseId)) existing.put(row.getUserId(), row);
        return organizationMapper.selectActiveUsersByOrgIds(orgIds).stream()
            .map(row -> new OrganizationMemberView(Long.toString(row.getUserId()), row.getUserCode(),
                row.getUserName(), existing.containsKey(row.getUserId())))
            .toList();
    }

    @Transactional
    public AttachResult attach(String enterpriseIdText, String orgIdText,
                               boolean includeDescendants, boolean addMembers) {
        requirePlatformAdmin();
        long enterpriseId = parseId(enterpriseIdText);
        List<Long> orgIds = branch(parseId(orgIdText), includeDescendants);
        // This row lock also serializes single-member additions and enforces the package limit.
        String snapshot = memberMapper.selectPackageSnapshotForUpdate(enterpriseId);
        if (snapshot == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant not found");
        int memberLimit = memberLimit(snapshot);
        List<TenantMemberRow> candidates = addMembers
            ? organizationMapper.selectActiveUsersByOrgIds(orgIds) : List.of();
        Map<Long, TenantMemberRow> existing = new HashMap<>();
        for (TenantMemberRow row : memberMapper.selectMembers(enterpriseId)) existing.put(row.getUserId(), row);
        List<TenantMemberRow> toAdd = candidates.stream().filter(row -> !existing.containsKey(row.getUserId())).toList();
        long activeCount = existing.values().stream().filter(row -> "ACTIVE".equals(row.getStatus())).count();
        if (activeCount + toAdd.size() > memberLimit) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "organization members exceed tenant package limit");
        }
        if (candidates.stream().anyMatch(row -> existing.containsKey(row.getUserId())
            && !"ACTIVE".equals(existing.get(row.getUserId()).getStatus()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "organization contains disabled tenant membership");
        }

        Set<Long> attached = new HashSet<>(organizationMapper.selectAttachedOrgIds(enterpriseId));
        long operatorId = CurrentUserHolder.getCurrentUserId();
        int attachedCount = 0;
        for (Long orgId : orgIds) {
            if (attached.add(orgId)) {
                organizationMapper.insertAttachment(enterpriseId, orgId, operatorId);
                attachedCount++;
            }
        }
        for (TenantMemberRow row : toAdd) {
            memberMapper.insertMember(sequenceService.nextVal(), enterpriseId, row.getUserId(), operatorId);
        }
        return new AttachResult(attachedCount, toAdd.size(), candidates.size() - toAdd.size());
    }

    private List<Long> branch(long orgId, boolean includeDescendants) {
        List<Long> branch = organizationMapper.selectBranchOrgIds(orgId);
        if (branch.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "organization not found");
        return includeDescendants ? branch : List.of(orgId);
    }

    private int memberLimit(String json) {
        try {
            int limit = objectMapper.readTree(json).path("memberLimit").asInt();
            if (limit > 0) return limit;
        }
        catch (Exception ignored) {
            // Invalid snapshots cannot authorize membership writes.
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "invalid tenant package snapshot");
    }

    private long parseId(String text) {
        if (text == null || !text.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid ID");
        }
        try {
            return Long.parseLong(text);
        }
        catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid ID", e);
        }
    }

    private void requirePlatformAdmin() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
    }

    public record OrganizationView(String orgId, String parentOrgId, String orgName, Integer orgIndex,
                                   Integer memberCount, boolean attached) {
    }

    public record OrganizationMemberView(String userId, String userCode, String userName, boolean alreadyMember) {
    }

    public record AttachResult(int attachedOrganizations, int addedMembers, int existingMembers) {
    }
}
