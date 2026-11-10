package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationAdminService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePublishScope;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourcePublishScopeMapper;
import java.util.*;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Reads publication metadata only. Never writes grants or runtime associations. */
@Service @RequiredArgsConstructor
public class ResourcePublicationAccess {
    public static final Set<String> TYPES = Set.of("SKILL", "TOOL", "TOOLKIT", "MCP", "AGENT", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM");
    private final OrganizationAdminService admins;
    private final OrganizationService organizations;
    private final ResourcePublishScopeMapper scopes;

    public record OrganizationLabel(String orgId, String orgName) { }
    public record QueryContext(Long tenantId, boolean catalog, boolean administrator, List<Long> validOrgIds,
        List<Long> viewerOrgIds, String mode, List<Long> filterOrgIds) { }

    public static boolean supported(SsResource resource) {
        return resource != null && "enterprise".equals(resource.getOwnerType()) && TYPES.contains(resource.getResourceBizType());
    }
    public static String mode(SsResource resource) {
        return Objects.requireNonNullElse(resource.getPublishScopeMode(), "LEGACY");
    }
    public boolean administrator() {
        return CurrentUserHolder.isAdminVip() || CurrentUserHolder.isPlatformManager();
    }
    public Map<Long, Organization> organizationMap() {
        Set<Long> allowed = admins.allowedOrgIds();
        if (allowed.isEmpty()) return Map.of();
        return organizations.selectList(null, new LambdaQueryWrapper<Organization>().in(Organization::getOrgId, allowed))
            .stream().collect(Collectors.toMap(Organization::getOrgId, o -> o));
    }
    public Set<Long> ancestors(Collection<Long> ids, Map<Long, Organization> orgs) {
        Set<Long> result = new HashSet<>();
        for (Long member : ids) {
            Set<Long> visited = new HashSet<>();
            for (Long id = member; id != null && orgs.containsKey(id) && visited.add(id); id = orgs.get(id).getParentOrgId()) result.add(id);
        }
        return result;
    }
    public List<Long> normalize(ResourcePublishScope requested) {
        if (requested == null) throw new BaseException("请选择发布范围");
        List<Long> ids = requested.selectedIds();
        if (ids.equals(List.of(-1L))) return ids;
        Map<Long, Organization> orgs = organizationMap();
        if (!orgs.keySet().containsAll(ids)) throw new BaseException("发布组织不属于当前企业或已失效");
        return ids.stream().filter(id -> ids.stream().noneMatch(parent -> !parent.equals(id)
            && ancestors(List.of(id), orgs).contains(parent))).sorted().toList();
    }
    public List<Long> liveIds(Long resourceId) {
        return scopes.selectList(new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope>()
            .eq(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getTenantId, CurrentUserHolder.getEnterpriseId())
            .eq(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getResourceId, resourceId))
            .stream().map(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getOrgId).sorted().toList();
    }
    public List<OrganizationLabel> labels(List<Long> ids) {
        Map<Long, Organization> orgs = organizationMap();
        return ids.stream().filter(id -> id == -1 || orgs.containsKey(id))
            .map(id -> new OrganizationLabel(id.toString(), id == -1 ? "全公司" : orgs.get(id).getOrgName())).toList();
    }
    public record Batch(Map<Long, List<Long>> scopes, Map<Long, Organization> organizations, Set<Long> audience) { }
    public Batch loadBatch(Collection<SsResource> resources) {
        List<Long> ids = resources.stream().filter(ResourcePublicationAccess::supported)
            .filter(r -> Objects.equals(r.getComAcctId(), CurrentUserHolder.getEnterpriseId()))
            .map(SsResource::getResourceId).distinct().toList();
        if (ids.isEmpty()) return new Batch(Map.of(), Map.of(), Set.of());
        Map<Long, List<Long>> live = scopes.selectList(new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope>()
            .eq(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getTenantId, CurrentUserHolder.getEnterpriseId())
            .in(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getResourceId, ids)).stream()
            .collect(Collectors.groupingBy(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getResourceId,
                Collectors.mapping(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getOrgId, Collectors.toList())));
        Map<Long, Organization> orgs = organizationMap();
        return new Batch(live, orgs, ancestors(admins.userOrgIds(CurrentUserHolder.getCurrentUserId()), orgs));
    }
    public List<OrganizationLabel> labels(Long resourceId, Batch batch) {
        return batch.scopes().getOrDefault(resourceId, List.of()).stream().sorted()
            .filter(id -> id == -1 || batch.organizations().containsKey(id))
            .map(id -> new OrganizationLabel(id.toString(), id == -1 ? "全公司" : batch.organizations().get(id).getOrgName())).toList();
    }
    public boolean inAudience(SsResource resource) {
        return !supported(resource) || "LEGACY".equals(mode(resource)) || inAudience(resource, loadBatch(List.of(resource)));
    }
    public boolean inAudience(SsResource resource, Batch batch) {
        if (!supported(resource) || "LEGACY".equals(mode(resource))) return true;
        if (!Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId()) || "NONE".equals(mode(resource))) return false;
        List<Long> live = batch.scopes().getOrDefault(resource.getResourceId(), List.of());
        return live.contains(-1L) || live.stream().anyMatch(batch.audience()::contains);
    }
    public boolean canReviewOrg(Long orgId) {
        if (administrator()) return orgId == -1 || admins.allowedOrgIds().contains(orgId);
        return orgId != -1 && admins.managedOrgIds().contains(orgId);
    }
    public Set<Long> reviewOrgIds() {
        Set<Long> ids = new HashSet<>(administrator() ? admins.allowedOrgIds() : admins.managedOrgIds());
        if (administrator()) ids.add(-1L);
        return ids;
    }
    public void prepareQuery(ResourceUseAuthQo query) {
        query.setPublicationQuery(null);
        if (query.getResourceBizTypeList() != null && !query.getResourceBizTypeList().isEmpty()
            && query.getResourceBizTypeList().stream().noneMatch(TYPES::contains)) return;
        // Missing ownerType is also a catalog query; it must not bypass enterprise scope checks.
        if ("personal".equals(query.getOwnerType()) && !Boolean.TRUE.equals(query.getIncludeAllEnterpriseOwnerType())) return;
        boolean management = Set.of("CREATED_BY_ME", "MANAGEABLE_BY_ME", "MANAGED_BY_ME")
            .contains(Objects.requireNonNullElse(query.getPermission(), ""));
        boolean catalog = !Boolean.TRUE.equals(query.getAvailableOnly()) && !management;
        String mode = Objects.requireNonNullElse(query.getAudienceScopeMode(), "ALL");
        if (!Set.of("ALL", "COMPANY", "ORGS", "UNSET").contains(mode)) throw new BaseException("无效的发布组织筛选");
        Map<Long, Organization> orgs = organizationMap();
        Set<Long> filter = new HashSet<>();
        if ("ORGS".equals(mode)) {
            List<Long> selected = query.getAudienceOrgIds();
            if (selected == null || selected.isEmpty() || selected.size() > 200 || selected.stream().anyMatch(Objects::isNull)
                || !orgs.keySet().containsAll(selected)) throw new BaseException("请选择当前企业的有效组织");
            filter.addAll(selected);
            if (!Boolean.FALSE.equals(query.getAudienceIncludeDescendants())) {
                orgs.keySet().stream().filter(id -> !Collections.disjoint(ancestors(List.of(id), orgs), selected)).forEach(filter::add);
            }
        }
        query.setPublicationQuery(new QueryContext(CurrentUserHolder.getEnterpriseId(), catalog, administrator(), orgs.keySet().stream().sorted().toList(),
            ancestors(admins.userOrgIds(CurrentUserHolder.getCurrentUserId()), orgs).stream().sorted().toList(),
            mode, filter.stream().sorted().toList()));
    }
}
