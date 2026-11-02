package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationAdminService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.EmployeePublishScope;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.EmployeePublishScopeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo.AudienceOrganization;
import java.util.*;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 企业推荐卡片的生效组织范围；不以管理组织或创建者组织推断使用范围。 */
@Service
@RequiredArgsConstructor
public class EmployeeAudienceDisplayService {
    private final SsResourceMapper resources;
    private final EmployeePublishScopeMapper scopes;
    private final PrivilegeGrantMapper grants;
    private final OrganizationAdminService admins;
    private final OrganizationService organizations;

    public void fill(List<? extends DigitEmployMarketVo> rows) {
        rows.forEach(row -> row.setAudienceOrganizations(List.of()));
        Long tenant = CurrentUserHolder.getEnterpriseId();
        List<Long> ids = rows.stream().filter(row -> "enterprise".equals(row.getOwnerType()))
            .map(DigitEmployMarketVo::getId).filter(Objects::nonNull).distinct().toList();
        if (tenant == null || ids.isEmpty()) return;
        List<SsResource> employees = resources.selectList(new LambdaQueryWrapper<SsResource>()
            .eq(SsResource::getComAcctId, tenant).eq(SsResource::getOwnerType, "enterprise")
            .eq(SsResource::getResourceBizType, "DIG_EMPLOYEE").in(SsResource::getResourceId, ids));
        if (employees.isEmpty()) return;
        Map<Long, SsResource> byId = employees.stream().collect(Collectors.toMap(SsResource::getResourceId, r -> r));
        Set<Long> allowed = admins.allowedOrgIds();
        Map<Long, Organization> orgs = allowed.isEmpty() ? Map.of() : organizations.selectList(null,
            new LambdaQueryWrapper<Organization>().in(Organization::getOrgId, allowed)).stream()
            .collect(Collectors.toMap(Organization::getOrgId, o -> o));
        Set<Long> viewer = new HashSet<>(admins.managedOrgIds());
        viewer.addAll(admins.userOrgIds(CurrentUserHolder.getCurrentUserId()));
        Map<Long, Set<Long>> audience = new HashMap<>();
        List<Long> published = employees.stream().filter(DigitalEmployeeGovernanceService::isOfficialCopy)
            .map(SsResource::getResourceId).toList();
        if (!published.isEmpty()) {
            scopes.selectList(new LambdaQueryWrapper<EmployeePublishScope>()
                .eq(EmployeePublishScope::getTenantId, tenant).in(EmployeePublishScope::getResourceId, published))
                .forEach(scope -> audience.computeIfAbsent(scope.getResourceId(), key -> new HashSet<>()).add(scope.getOrgId()));
        }
        List<Long> direct = employees.stream().filter(r -> !DigitalEmployeeGovernanceService.isOfficialCopy(r))
            .map(SsResource::getResourceId).toList();
        if (!direct.isEmpty()) fillDirectAudience(direct, audience);
        Set<Long> roots = orgs.values().stream().filter(org -> !orgs.containsKey(org.getParentOrgId()))
            .map(Organization::getOrgId).collect(Collectors.toSet());
        for (DigitEmployMarketVo row : rows) {
            SsResource employee = byId.get(row.getId());
            if (employee == null) continue;
            Set<Long> selected = new HashSet<>(audience.getOrDefault(row.getId(), Set.of()));
            selected.removeIf(id -> id != -1L && !orgs.containsKey(id));
            if (selected.contains(-1L) || !DigitalEmployeeGovernanceService.isOfficialCopy(employee)
                && !roots.isEmpty() && selected.containsAll(roots)) {
                row.setAudienceOrganizations(List.of(new AudienceOrganization("-1", "全公司")));
                continue;
            }
            boolean full = DigitalEmployeeGovernanceService.isAdministrator()
                || Objects.equals(employee.getCreateBy(), CurrentUserHolder.getCurrentUserId());
            row.setAudienceOrganizations(selected.stream()
                .filter(id -> full || viewer.stream().anyMatch(member -> covers(id, member, orgs)))
                .filter(id -> selected.stream().noneMatch(parent -> !parent.equals(id) && covers(parent, id, orgs)))
                .sorted().map(id -> new AudienceOrganization(String.valueOf(id), orgs.get(id).getOrgName())).toList());
        }
    }

    private void fillDirectAudience(List<Long> ids, Map<Long, Set<Long>> audience) {
        Date now = new Date();
        List<PrivilegeGrant> effective = grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
            .in(PrivilegeGrant::getGrantObjId, ids).eq(PrivilegeGrant::getGrantObjType, "DIG_EMPLOYEE")
            .eq(PrivilegeGrant::getGrantToObjType, "ORG").eq(PrivilegeGrant::getStatusCd, "A")
            .in(PrivilegeGrant::getGrantType, "FORCE_USE", "AVAILABLE_USE")
            .and(q -> q.isNull(PrivilegeGrant::getEffDate).or().le(PrivilegeGrant::getEffDate, now))
            .and(q -> q.isNull(PrivilegeGrant::getExpDate).or().gt(PrivilegeGrant::getExpDate, now)));
        for (PrivilegeGrant grant : effective) {
            if (!"RED".equals(grant.getGrantToType()) || grant.getGrantToObjId() == null) continue;
            boolean denied = effective.stream().anyMatch(black -> "BLACK".equals(black.getGrantToType())
                && Objects.equals(black.getGrantObjId(), grant.getGrantObjId())
                && Objects.equals(black.getGrantToObjId(), grant.getGrantToObjId()));
            if (!denied) audience.computeIfAbsent(grant.getGrantObjId(), key -> new HashSet<>()).add(grant.getGrantToObjId());
        }
    }

    private boolean covers(Long root, Long member, Map<Long, Organization> orgs) {
        Set<Long> visited = new HashSet<>();
        for (Long id = member; id != null && visited.add(id); ) {
            if (root.equals(id)) return true;
            Organization org = orgs.get(id);
            id = org == null ? null : org.getParentOrgId();
        }
        return false;
    }
}
