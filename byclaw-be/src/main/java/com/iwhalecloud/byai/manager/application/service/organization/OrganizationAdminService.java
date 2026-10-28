package com.iwhalecloud.byai.manager.application.service.organization;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminMemberMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantOrganizationMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import com.iwhalecloud.byai.manager.qo.organization.OrgTreeQo;
import com.iwhalecloud.byai.manager.vo.organization.OrgTreeVo;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reads current role assignments rather than trusting roles captured by an older login. */
@Service
@RequiredArgsConstructor
public class OrganizationAdminService {
    private final UsersOrganizationMapper memberships;
    private final UsersOrganizationService membershipService;
    private final OrganizationService organizations;
    private final UsersMapper users;
    private final TenantOrganizationMapper tenantOrganizations;
    private final TenantAdminMemberMapper tenantMembers;
    private final OrganizationMapper organizationMapper;

    public record Member(String userId, String userName, boolean administrator) { }

    private void requireCreationParent(Long parentOrgId) {
        Long tenant = CurrentUserHolder.getEnterpriseId();
        boolean platformAdmin = CurrentUserHolder.isAdminVip() || CurrentUserHolder.isPlatformManager();
        if (tenant == null || parentOrgId == null || (parentOrgId != -1 && parentOrgId <= 0)) {
            throw new BaseException("请选择有效的上级组织");
        }
        if (parentOrgId != -1) requireOrganization(parentOrgId);
        if (!platformAdmin && !managedOrgIds().contains(parentOrgId)) {
            throw new BaseException("无权在该组织下新增组织");
        }
    }

    private List<Member> enterpriseCandidates() {
        Long tenant = CurrentUserHolder.getEnterpriseId();
        List<Long> ids;
        if (tenantMembers.selectProvisionState(tenant) == null) {
            Set<Long> orgIds = allowedOrgIds();
            if (orgIds.isEmpty()) return List.of();
            ids = tenantOrganizations.selectActiveUsersByOrgIds(new ArrayList<>(orgIds)).stream()
                .map(com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow::getUserId).distinct().toList();
        } else {
            ids = tenantMembers.selectMembers(tenant).stream().filter(row -> "ACTIVE".equals(row.getStatus()))
                .map(com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow::getUserId).distinct().toList();
        }
        if (ids.isEmpty()) return List.of();
        return users.selectBatchIds(ids).stream().filter(user -> "A".equals(user.getState()))
            .map(user -> new Member(String.valueOf(user.getUserId()), user.getUserName(), false)).toList();
    }

    private void requireSelectionAccess(Long orgId, Long parentOrgId) {
        if (orgId == null) {
            requireCreationParent(parentOrgId);
        } else {
            requireOrganization(orgId);
            if (!CurrentUserHolder.isAdminVip() && !CurrentUserHolder.isPlatformManager() && !managedOrgIds().contains(orgId)) {
                throw new BaseException("无权设置该组织的管理员");
            }
        }
    }

    public List<OrgTreeVo> getAdministratorOrganizations(Long orgId, Long parentOrgId) {
        requireSelectionAccess(orgId, parentOrgId);
        Set<Long> allowed = allowedOrgIds();
        return organizationMapper.getOrgTree(new OrgTreeQo()).stream()
            .filter(organization -> allowed.contains(organization.getOrgId())).toList();
    }

    public List<Member> getAdministratorCandidates(Long orgId, Long parentOrgId, Long memberOrgId) {
        requireSelectionAccess(orgId, parentOrgId);
        // 精确匹配成员所属组织，不包含子组织。
        return members(memberOrgId);
    }

    @Transactional(rollbackFor = Exception.class)
    public void createOrganization(Organization organization) {
        requireCreationParent(organization.getParentOrgId());
        Set<Long> selected = organization.getAdministratorIds() == null ? Set.of()
            : new LinkedHashSet<>(organization.getAdministratorIds());
        Set<Long> valid = new HashSet<>();
        enterpriseCandidates().forEach(member -> valid.add(Long.valueOf(member.userId())));
        if (!valid.containsAll(selected)) throw new BaseException("组织管理员必须是当前企业的有效成员");
        organizations.addOrg(organization);
        Long tenant = CurrentUserHolder.getEnterpriseId();
        if (tenantMembers.selectProvisionState(tenant) != null) {
            tenantOrganizations.insertAttachment(tenant, organization.getOrgId(), CurrentUserHolder.getCurrentUserId());
        }
        selected.forEach(userId -> addRole(organization.getOrgId(), userId, UserType.ORG_MAN, null));
    }

    public Set<Long> managedOrgIds() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || !activeTenantMember(userId)) return Set.of();
        Set<Long> result = new HashSet<>();
        for (UsersOrganization role : memberships.selectList(new LambdaQueryWrapper<UsersOrganization>()
            .eq(UsersOrganization::getUserId, userId))) {
            if (UserType.matchesAny(role.getUserType(), UserType.ORG_MAN)) {
                result.addAll(organizations.findSelfAndDescendantOrgIds(role.getOrgId()));
            }
        }
        result.retainAll(allowedOrgIds());
        return result;
    }

    public Set<Long> userOrgIds(Long userId) {
        if (userId == null || !activeTenantMember(userId)) return Set.of();
        Set<Long> allowed = allowedOrgIds();
        Set<Long> result = new HashSet<>();
        memberships.selectList(new LambdaQueryWrapper<UsersOrganization>().eq(UsersOrganization::getUserId, userId))
            .forEach(row -> { if (allowed.contains(row.getOrgId())) result.add(row.getOrgId()); });
        return result;
    }

    public Set<Long> allowedOrgIds() {
        Long tenant = CurrentUserHolder.getEnterpriseId();
        if (tenant == null) return Set.of();
        // Legacy deployment-level organizations have no tenant provisioning record.
        if (tenantMembers.selectProvisionState(tenant) == null) {
            Set<Long> result = new HashSet<>();
            organizations.getTopOrgList().forEach(id -> result.addAll(organizations.findSelfAndDescendantOrgIds(id)));
            return result;
        }
        return new HashSet<>(tenantOrganizations.selectAttachedOrgIds(tenant));
    }

    public Set<Long> audienceMembers(Collection<Long> roots) {
        Set<Long> result = new HashSet<>();
        Set<Long> allowed = allowedOrgIds();
        for (Long root : roots) {
            if (Objects.equals(root, -1L)) result.addAll(allowed);
            else result.addAll(organizations.findSelfAndDescendantOrgIds(root));
        }
        result.retainAll(allowed);
        return result;
    }

    public boolean activeTenantMember(Long userId) {
        Long tenant = CurrentUserHolder.getEnterpriseId();
        if (tenant == null) return false;
        if (tenantMembers.selectProvisionState(tenant) == null) return true;
        var membership = tenantMembers.selectMember(tenant, userId);
        return membership != null && "ACTIVE".equals(membership.getStatus());
    }

    public List<Member> members(Long orgId) {
        requireOrganization(orgId);
        List<UsersOrganization> rows = memberships.selectList(new LambdaQueryWrapper<UsersOrganization>()
            .eq(UsersOrganization::getOrgId, orgId));
        Set<Long> admins = new HashSet<>();
        rows.stream().filter(r -> UserType.matchesAny(r.getUserType(), UserType.ORG_MAN))
            .forEach(r -> admins.add(r.getUserId()));
        List<Long> ids = rows.stream().map(UsersOrganization::getUserId).distinct().toList();
        if (ids.isEmpty()) return List.of();
        return users.selectBatchIds(ids).stream().filter(u -> "A".equals(u.getState()) && activeTenantMember(u.getUserId()))
            .map(u -> new Member(String.valueOf(u.getUserId()), u.getUserName(), admins.contains(u.getUserId()))).toList();
    }

    @Transactional(rollbackFor = Exception.class)
    public void setAdministrators(Long orgId, List<Long> userIds) {
        requireOrganization(orgId);
        if (!CurrentUserHolder.isAdminVip() && !CurrentUserHolder.isPlatformManager() && !managedOrgIds().contains(orgId)) {
            throw new BaseException("无权设置该组织的管理员");
        }
        if (userIds == null) throw new BaseException("请提供组织管理员列表");
        Set<Long> selected = new HashSet<>(userIds);
        List<Member> candidates = enterpriseCandidates();
        Set<Long> valid = new HashSet<>();
        candidates.forEach(m -> valid.add(Long.valueOf(m.userId())));
        if (!valid.containsAll(selected)) throw new BaseException("组织管理员必须是当前企业的有效成员");
        List<UsersOrganization> roles = memberships.selectList(new LambdaQueryWrapper<UsersOrganization>()
            .eq(UsersOrganization::getOrgId, orgId));
        Set<Long> existing = new HashSet<>();
        Set<Long> restoredMembers = new HashSet<>();
        for (UsersOrganization role : roles) {
            if (!UserType.matchesAny(role.getUserType(), UserType.ORG_MAN)) continue;
            existing.add(role.getUserId());
            if (!selected.contains(role.getUserId())) {
                membershipService.removeByPrimaryKey(role.getId());
                // Removing the administrator role must not remove the user's organization membership.
                boolean otherRole = roles.stream().anyMatch(r -> Objects.equals(r.getUserId(), role.getUserId())
                    && !UserType.matchesAny(r.getUserType(), UserType.ORG_MAN));
                if (!otherRole && restoredMembers.add(role.getUserId())) addRole(orgId, role.getUserId(), UserType.ORD_USER, role.getPositionId());
            }
        }
        selected.stream().filter(id -> !existing.contains(id)).forEach(id -> addRole(orgId, id, UserType.ORG_MAN,
            roles.stream().filter(r -> Objects.equals(r.getUserId(), id)).findFirst().map(UsersOrganization::getPositionId).orElse(null)));
    }

    private void addRole(Long orgId, Long userId, String type, Long positionId) {
        UsersOrganization role = new UsersOrganization();
        role.setOrgId(orgId); role.setUserId(userId); role.setUserType(type); role.setPositionId(positionId);
        membershipService.save(role);
    }

    private void requireOrganization(Long orgId) {
        if (orgId == null || !allowedOrgIds().contains(orgId) || organizations.findById(orgId) == null) {
            throw new BaseException("组织不存在或不属于当前企业");
        }
    }
}
