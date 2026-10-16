package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest;
import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest.Scope;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncScopeMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Runs within the resource import transaction; reconciliation is persisted before returning. */
@Service
public class EnterpriseResourceSyncService {
    @Autowired @Lazy private AuthApplicationService auth;
    @Autowired private SsResourceService resources;
    @Autowired private PrivilegeGrantMapper grants;
    @Autowired private PrivilegeGrantService grantService;
    @Autowired private ResourceSyncScopeMapper scopeMapper;
    @Autowired private UsersMapper users;
    @Autowired private ResourceSyncJobMapper jobs;
    @Autowired private SequenceService sequence;

    public void validate(EnterpriseResourceSyncRequest request) {
        // Legacy calls without new fields retain their existing import authentication behavior.
        if (request.viewAuth() != null || request.autoAuthorize() != null) requireSyncPrincipal();
        Scope scope = request.scope();
        if (scope == null) return;
        if (!activeTenantUsers(scope.userIds(), CurrentUserHolder.getEnterpriseId()).containsAll(scope.userIds())) {
            throw new IllegalArgumentException("授权用户不存在、已停用或不属于当前企业");
        }
        for (Long id : scope.orgIds()) {
            if (scopeMapper.organization(id) != 1 || scopeMapper.tenantOrganization(id, CurrentUserHolder.getEnterpriseId()) != 1) throw new IllegalArgumentException("授权组织不存在: " + id);
        }
        for (Long id : scope.postIds()) {
            if (scopeMapper.ordinaryPost(id) != 1) throw new IllegalArgumentException("授权岗位不存在或属于数字岗位: " + id);
        }
    }

    public void requireSyncPrincipal() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long tenantId = CurrentUserHolder.getEnterpriseId();
        if (userId == null || userId <= 0 || tenantId == null || tenantId <= 0
            || !auth.isCurrentUserGlobalResourceManager()) {
            throw new IllegalArgumentException("资源授权同步需要当前企业资源管理员的有效登录身份");
        }
    }

    public void validateExisting(SsResource resource) {
        if (resource == null) return;
        if (!"enterprise".equals(resource.getOwnerType())
            || !Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId())) {
            throw new IllegalArgumentException("同编码资源的企业或归属与本次同步不一致");
        }
        if (Objects.equals(resource.getResourceStatus(), -1)) {
            throw new IllegalArgumentException("已注销资源不能通过同步恢复");
        }
    }

    public Set<Long> expand(Scope scope) {
        Set<Long> result = new LinkedHashSet<>();
        if (scope == null) return result;
        result.addAll(scope.userIds());
        if (!scope.orgIds().isEmpty()) result.addAll(users.findUserIdsByOrgIdListIncludingChildren(scope.orgIds()));
        for (Long post : scope.postIds()) result.addAll(users.findUserIdsByPostId(post));
        result.remove(null);
        return result;
    }

    public Set<Long> activeTenantUsers(java.util.Collection<Long> userIds, Long tenant) {
        List<Long> ids = new ArrayList<>(userIds);
        Set<Long> result = new LinkedHashSet<>();
        for (int offset = 0; offset < ids.size(); offset += 500) {
            result.addAll(scopeMapper.activeTenantUsers(ids.subList(offset, Math.min(offset + 500, ids.size())), tenant));
        }
        return result;
    }

    public void completeImport(Long resourceId, EnterpriseResourceSyncRequest request, boolean packageChanged,
                               Map<String, Object> response) {
        SsResource resource = resources.findByIdForUpdate(resourceId);
        validateExisting(resource);
        long revision = Math.addExact(Objects.requireNonNullElse(resource.getThirdSyncRevision(), 0L), 1L);
        resource.setThirdSyncRevision(revision);
        Set<Long> affected = new LinkedHashSet<>();
        Set<Long> scopeUsers = expand(request.scope());
        scopeUsers = activeTenantUsers(scopeUsers, resource.getComAcctId());
        if (request.viewAuth() != null) {
            replace(resource, List.of(GrantType.ALLOW_VIEW),
                Boolean.TRUE.equals(request.viewAuth()) ? request.scope() : null, GrantType.ALLOW_VIEW, affected);
            resource.setViewAuthControlled(true);
        }
        if (Boolean.TRUE.equals(request.autoAuthorize())) {
            resource.setUseAuthControlled(true);
            replace(resource, List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE), request.scope(),
                GrantType.FORCE_USE, affected);
            for (Long userId : scopeUsers) {
                for (PrivilegeGrant pending : grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
                    .eq(PrivilegeGrant::getGrantObjId, resourceId)
                    .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
                    .eq(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE)
                    .eq(PrivilegeGrant::getStatusCd, "P")
                    .eq(PrivilegeGrant::getGrantToObjType, "USER").eq(PrivilegeGrant::getGrantToObjId, userId))) {
                    grantService.remove(pending);
                }
            }
        }
        resources.updateResourceEntity(resource);
        affected.addAll(scopeUsers);
        if (resource.getCreateBy() != null) affected.add(resource.getCreateBy());
        if (!affected.isEmpty()) {
            Set<Long> snapshot = Set.copyOf(affected);
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { auth.syncUsersAuthToRedis(snapshot); }
            });
        }
        response.put("syncRevision", String.valueOf(revision));
        response.put("authorization", Map.of("viewReplaced", request.viewAuth() != null,
            "useReplaced", Boolean.TRUE.equals(request.autoAuthorize()), "scopeUserCount", scopeUsers.size()));
        String mode = Boolean.TRUE.equals(request.autoAuthorize()) ? "RECONCILE"
            : Boolean.FALSE.equals(request.autoAuthorize()) && request.scope() != null ? "CLEANUP_ONLY" : "NONE";
        boolean refreshRequired = packageChanged || "SKILL".equals(resource.getResourceBizType())
            || request.viewAuth() != null || Boolean.TRUE.equals(request.autoAuthorize());
        Scope jobScope = request.scope();
        String inheritedResult = null;
        // Every revision inherits pending runtime refreshes; only omitted autoAuthorize inherits association intent.
        {
            List<ResourceSyncJob> previousJobs = jobs.selectList(new LambdaQueryWrapper<ResourceSyncJob>()
                .eq(ResourceSyncJob::getResourceId, resourceId).eq(ResourceSyncJob::getComAcctId, resource.getComAcctId())
                .orderByDesc(ResourceSyncJob::getSyncRevision).last("LIMIT 1"));
            if (!previousJobs.isEmpty() && !List.of("COMPLETED", "SUPERSEDED").contains(previousJobs.get(0).getStatus())) {
                ResourceSyncJob previous = previousJobs.get(0);
                inheritedResult = previous.getResultSummary();
                if (inheritedResult != null) {
                    var pending = JSON.parseObject(inheritedResult);
                    refreshRequired |= pending.getJSONArray("pendingEmployeeIds") != null
                        && !pending.getJSONArray("pendingEmployeeIds").isEmpty();
                    refreshRequired |= pending.getJSONArray("failedEmployeeIds") != null
                        && !pending.getJSONArray("failedEmployeeIds").isEmpty();
                }
                if (previous.getAuthRefreshUserIds() != null) {
                    JSON.parseArray(previous.getAuthRefreshUserIds(), Long.class).forEach(affected::add);
                }
                if (request.autoAuthorize() == null) mode = previous.getAssociationMode();
                if (request.autoAuthorize() == null && previous.getAuthScope() != null) {
                    var wrapper = new com.alibaba.fastjson.JSONObject();
                    wrapper.put("resourceBizType", "TOOLKIT");
                    wrapper.put("autoAuthorize", true);
                    wrapper.put("authScope", JSON.parseObject(previous.getAuthScope()));
                    jobScope = EnterpriseResourceSyncRequest.parse(wrapper).scope();
                }
                refreshRequired |= Boolean.TRUE.equals(previous.getPackageChanged());
            }
        }
        if (!"NONE".equals(mode) || refreshRequired) {
            ResourceSyncJob job = new ResourceSyncJob();
            job.setSyncJobId(sequence.nextVal());
            job.setComAcctId(resource.getComAcctId());
            job.setResourceId(resourceId);
            job.setSyncRevision(revision);
            job.setOperatorUserId(CurrentUserHolder.getCurrentUserId());
            job.setAuthScope(jobScope == null ? null : JSON.toJSONString(Map.of("userIds", jobScope.userIds(), "orgIds", jobScope.orgIds(), "postIds", jobScope.postIds())));
            job.setAuthRefreshUserIds(JSON.toJSONString(affected));
            job.setResultSummary(inheritedResult);
            job.setAssociationMode(mode);
            job.setPackageChanged(refreshRequired);
            job.setStatus("PENDING");
            job.setRetryCount(0);
            job.setNextRetryTime(new Date());
            job.setCreateTime(new Date());
            job.setUpdateTime(new Date());
            jobs.insert(job);
            response.put("association", Map.of("status", "PENDING", "jobId", String.valueOf(job.getSyncJobId())));
        } else {
            response.put("association", Map.of("status", "NOT_REQUESTED"));
        }
    }

    private void replace(SsResource resource, List<String> types, Scope scope, String newType, Set<Long> affected) {
        List<PrivilegeGrant> old = grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
            .eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
            .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
            .in(PrivilegeGrant::getGrantType, types).eq(PrivilegeGrant::getStatusCd, "A"));
        Map<String, List<Long>> oldSubjects = new LinkedHashMap<>();
        for (PrivilegeGrant grant : old) {
            oldSubjects.computeIfAbsent(grant.getGrantToObjType(), ignored -> new ArrayList<>()).add(grant.getGrantToObjId());
            // Include future and expired rows and every duplicate; never compare by a lossy subject map.
            grantService.remove(grant);
        }
        affected.addAll(expand(new Scope(oldSubjects.getOrDefault("USER", List.of()),
            oldSubjects.getOrDefault("ORG", List.of()), oldSubjects.getOrDefault("POST", List.of()))));
        for (Long station : oldSubjects.getOrDefault("STATION", List.of())) {
            affected.addAll(users.findUserIdsByStationId(station));
        }
        if (scope == null) return;
        Map<String, List<Long>> subjects = Map.of("USER", scope.userIds(), "ORG", scope.orgIds(), "POST", scope.postIds());
        subjects.forEach((type, ids) -> ids.forEach(id -> {
            PrivilegeGrant grant = new PrivilegeGrant();
            grant.setGrantObjId(resource.getResourceId());
            grant.setGrantObjType(resource.getResourceBizType());
            grant.setGrantType(newType);
            grant.setOperType("READ");
            grant.setGrantToObjType(type);
            grant.setGrantToObjId(id);
            grant.setGrantToType("RED");
            grant.setAllowUnsubscribe(Constants.NOT_ALLOW_UNSUBSCRIBE);
            grant.setStatusCd("A");
            grantService.save(grant);
        }));
    }
}
