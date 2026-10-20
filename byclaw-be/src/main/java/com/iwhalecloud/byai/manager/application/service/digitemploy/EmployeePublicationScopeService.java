package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationAdminService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.EmployeePublicationTargetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.EmployeePublishScopeMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Publication decisions and live audiences are stored independently. */
@Service
@RequiredArgsConstructor
public class EmployeePublicationScopeService {
    private final EmployeePublicationTargetMapper targets;
    private final EmployeePublishScopeMapper scopes;
    private final OrganizationAdminService admins;
    private final OrganizationService organizations;
    private final SequenceService sequence;

    public boolean hasOrganizationReviewRole() { return !admins.managedOrgIds().isEmpty(); }
    public record OrganizationOption(String orgId, String parentOrgId, String orgName) { }

    public List<OrganizationOption> options() {
        Set<Long> allowed = admins.allowedOrgIds();
        if (allowed.isEmpty()) return List.of();
        return organizations.selectList(null, new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.organization.Organization>()
            .in(com.iwhalecloud.byai.manager.entity.organization.Organization::getOrgId, allowed))
            .stream().map(o -> new OrganizationOption(String.valueOf(o.getOrgId()), String.valueOf(o.getParentOrgId()), o.getOrgName())).toList();
    }

    public List<EmployeePublicationTarget> targets(DigitalEmployeePublication publication) {
        List<EmployeePublicationTarget> rows = targets.selectList(new LambdaQueryWrapper<EmployeePublicationTarget>()
            .eq(EmployeePublicationTarget::getTenantId, publication.getTenantId())
            .eq(EmployeePublicationTarget::getRequestId, publication.getRequestId())
            .orderByAsc(EmployeePublicationTarget::getOrgId));
        Set<Long> managed = DigitalEmployeeGovernanceService.isAdministrator() ? Set.of() : admins.managedOrgIds();
        rows.forEach(row -> row.setCanReview("PENDING".equals(row.getStatus())
            && (DigitalEmployeeGovernanceService.isAdministrator() || row.getOrgId() != -1L && managed.contains(row.getOrgId()))));
        return rows;
    }

    public Set<Long> visibleRequestIds() {
        Set<Long> managed = admins.managedOrgIds();
        if (managed.isEmpty()) return Set.of();
        return targets.selectList(new LambdaQueryWrapper<EmployeePublicationTarget>()
            .eq(EmployeePublicationTarget::getTenantId, CurrentUserHolder.getEnterpriseId())
            .in(EmployeePublicationTarget::getOrgId, managed)).stream()
            .map(EmployeePublicationTarget::getRequestId).collect(java.util.stream.Collectors.toSet());
    }

    public List<Long> liveOrgIds(Long resourceId, Long tenantId) {
        return scopes.selectList(new LambdaQueryWrapper<EmployeePublishScope>()
            .eq(EmployeePublishScope::getTenantId, tenantId).eq(EmployeePublishScope::getResourceId, resourceId))
            .stream().map(EmployeePublishScope::getOrgId).toList();
    }

    public void configure(DigitalEmployeePublication publication, List<Long> selected) {
        if (!"DRAFT".equals(publication.getStatus())) throw new BaseException("仅草稿可修改发布范围");
        List<Long> normalized = normalize(selected);
        if (publication.isScopeUpdate()) {
            List<Long> live = liveOrgIds(publication.getOfficialId(), publication.getTenantId());
            if (!new HashSet<>(normalized).equals(new HashSet<>(live))) {
                throw new BaseException("共享版本更新必须包含当前全部已发布组织，发布范围不能在更新中变更");
            }
        }
        targets.delete(new LambdaQueryWrapper<EmployeePublicationTarget>()
            .eq(EmployeePublicationTarget::getTenantId, publication.getTenantId())
            .eq(EmployeePublicationTarget::getRequestId, publication.getRequestId()));
        for (Long org : normalized) insertTarget(publication, org);
    }

    public void initialize(DigitalEmployeePublication publication) {
        if (!targets(publication).isEmpty()) return;
        List<Long> live = publication.getOfficialId() == null ? List.of()
            : liveOrgIds(publication.getOfficialId(), publication.getTenantId());
        for (Long org : live.isEmpty() ? List.of(-1L) : live) insertTarget(publication, org);
    }

    public void copy(DigitalEmployeePublication previous, DigitalEmployeePublication next) {
        List<Long> selected = !previous.isScopeUpdate()
            ? targets(previous).stream().map(EmployeePublicationTarget::getOrgId).toList()
            : liveOrgIds(previous.getOfficialId(), previous.getTenantId());
        for (Long org : selected.isEmpty() ? List.of(-1L) : selected) insertTarget(next, org);
    }

    private void insertTarget(DigitalEmployeePublication publication, Long orgId) {
        EmployeePublicationTarget target = new EmployeePublicationTarget();
        target.setTargetId(sequence.nextVal()); target.setTenantId(publication.getTenantId());
        target.setRequestId(publication.getRequestId()); target.setOrgId(orgId);
        target.setOrgName(orgId == -1L ? "全公司" : organizations.findById(orgId).getOrgName());
        boolean alreadyLive = !publication.isScopeUpdate() && publication.getOfficialId() != null
            && liveOrgIds(publication.getOfficialId(), publication.getTenantId()).contains(orgId);
        target.setStatus(alreadyLive ? "APPROVED" : "PENDING"); target.setRevision(0L); target.setCreatedAt(new Date());
        if (alreadyLive) target.setComment("沿用当前已生效范围，员工配置保持不变");
        targets.insert(target);
    }

    public List<Long> normalize(List<Long> selected) {
        if (selected == null || selected.isEmpty() || selected.stream().anyMatch(Objects::isNull)) {
            throw new BaseException("请选择全公司或至少一个组织");
        }
        if (selected.contains(-1L)) {
            if (new HashSet<>(selected).size() != 1) throw new BaseException("全公司不能与具体组织同时选择");
            return List.of(-1L);
        }
        Set<Long> allowed = admins.allowedOrgIds();
        if (!allowed.containsAll(selected)) throw new BaseException("发布组织不属于当前企业");
        // A selected ancestor already includes its descendants: do not create overlapping approval targets.
        return selected.stream().distinct().filter(org -> selected.stream().noneMatch(other -> !other.equals(org)
            && organizations.findSelfAndDescendantOrgIds(other).contains(org))).sorted().toList();
    }

    public boolean canReview(DigitalEmployeePublication publication) {
        if (!Objects.equals(publication.getTenantId(), CurrentUserHolder.getEnterpriseId())) return false;
        Set<Long> managed = DigitalEmployeeGovernanceService.isAdministrator() ? Set.of() : admins.managedOrgIds();
        return targets(publication).stream().anyMatch(t -> (reviewable(t)
            || List.of("FAILED", "APPLYING").contains(publication.getStatus()) && "APPROVED".equals(t.getStatus())) && (DigitalEmployeeGovernanceService.isAdministrator()
            || t.getOrgId() != -1L && managed.contains(t.getOrgId())));
    }

    public boolean canView(DigitalEmployeePublication publication) {
        Set<Long> managed = DigitalEmployeeGovernanceService.isAdministrator() ? Set.of() : admins.managedOrgIds();
        return !"DRAFT".equals(publication.getStatus())
            && Objects.equals(publication.getTenantId(), CurrentUserHolder.getEnterpriseId())
            && targets(publication).stream().anyMatch(t -> t.getOrgId() != -1L && managed.contains(t.getOrgId()));
    }

    public boolean hasReviewAuthority(DigitalEmployeePublication publication) {
        return DigitalEmployeeGovernanceService.isAdministrator() || canView(publication);
    }

    public boolean hasRejected(DigitalEmployeePublication publication) {
        return targets(publication).stream().anyMatch(t -> "REJECTED".equals(t.getStatus()));
    }

    public boolean hasPending(DigitalEmployeePublication publication) {
        return targets(publication).stream().anyMatch(this::reviewable);
    }

    public void resetDecisions(DigitalEmployeePublication publication) {
        targets.update(null, new LambdaUpdateWrapper<EmployeePublicationTarget>()
            .eq(EmployeePublicationTarget::getTenantId, publication.getTenantId())
            .eq(EmployeePublicationTarget::getRequestId, publication.getRequestId())
            .set(EmployeePublicationTarget::getStatus, "PENDING")
            .setSql("revision = revision + 1")
            .set(EmployeePublicationTarget::getReviewerId, null)
            .set(EmployeePublicationTarget::getReviewerName, null)
            .set(EmployeePublicationTarget::getReviewedAt, null)
            .set(EmployeePublicationTarget::getComment, null));
    }

    public List<EmployeePublicationTarget> review(DigitalEmployeePublication publication, List<Long> orgIds,
        boolean approved, String comment) {
        Set<Long> managed = DigitalEmployeeGovernanceService.isAdministrator() ? Set.of() : admins.managedOrgIds();
        List<EmployeePublicationTarget> pending = targets(publication).stream().filter(this::reviewable)
            .filter(t -> DigitalEmployeeGovernanceService.isAdministrator() || t.getOrgId() != -1L && managed.contains(t.getOrgId()))
            .filter(t -> orgIds == null || orgIds.contains(t.getOrgId())).toList();
        if (pending.isEmpty()) throw new BaseException("目标组织已处理或没有审核权限");
        if (orgIds != null && !pending.stream().map(EmployeePublicationTarget::getOrgId).toList().containsAll(orgIds)) {
            throw new BaseException("部分目标组织已处理或超出审核范围");
        }
        for (EmployeePublicationTarget target : pending) {
            int changed = targets.update(null, new LambdaUpdateWrapper<EmployeePublicationTarget>()
                .eq(EmployeePublicationTarget::getTargetId, target.getTargetId())
                .eq(EmployeePublicationTarget::getTenantId, publication.getTenantId())
                .eq(EmployeePublicationTarget::getRevision, target.getRevision())
                .eq(EmployeePublicationTarget::getStatus, target.getStatus())
                .set(EmployeePublicationTarget::getStatus, approved ? "APPROVED" : "REJECTED")
                .set(EmployeePublicationTarget::getRevision, target.getRevision() + 1)
                .set(EmployeePublicationTarget::getReviewerId, CurrentUserHolder.getCurrentUserId())
                .set(EmployeePublicationTarget::getReviewerName, CurrentUserHolder.getCurrentUserName())
                .set(EmployeePublicationTarget::getReviewedAt, new Date())
                .set(EmployeePublicationTarget::getComment, org.apache.commons.lang3.StringUtils.left(comment, 2000)));
            if (changed != 1) throw new BaseException("目标组织已被其他审核人处理，请刷新");
        }
        return targets(publication);
    }

    private boolean reviewable(EmployeePublicationTarget target) {
        return "PENDING".equals(target.getStatus());
    }

    public List<Long> approvedOrgs(DigitalEmployeePublication publication) {
        return targets(publication).stream().filter(t -> "APPROVED".equals(t.getStatus()))
            .map(EmployeePublicationTarget::getOrgId).toList();
    }

    public boolean allApproved(DigitalEmployeePublication publication) {
        List<EmployeePublicationTarget> rows = targets(publication);
        return !rows.isEmpty() && rows.stream().allMatch(t -> "APPROVED".equals(t.getStatus()));
    }

    public void activate(DigitalEmployeePublication publication, Long resourceId) {
        Set<Long> existing = new HashSet<>(liveOrgIds(resourceId, publication.getTenantId()));
        for (Long org : approvedOrgs(publication)) {
            if (!existing.add(org)) continue;
            EmployeePublishScope scope = new EmployeePublishScope();
            scope.setScopeId(sequence.nextVal()); scope.setTenantId(publication.getTenantId());
            scope.setResourceId(resourceId); scope.setRequestId(publication.getRequestId());
            scope.setOrgId(org); scope.setCreatedAt(new Date()); scopes.insert(scope);
        }
    }

    public boolean canReviewApplicant(SsResource resource, Long applicant) {
        if (!DigitalEmployeeGovernanceService.isEmployee(resource) || !"enterprise".equals(resource.getOwnerType())
            || !Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            || Objects.equals(applicant, CurrentUserHolder.getCurrentUserId())) return false;
        Set<Long> covered = admins.audienceMembers(liveOrgIds(resource.getResourceId(), resource.getComAcctId()));
        covered.retainAll(admins.managedOrgIds());
        return admins.userOrgIds(applicant).stream().anyMatch(covered::contains);
    }
}
