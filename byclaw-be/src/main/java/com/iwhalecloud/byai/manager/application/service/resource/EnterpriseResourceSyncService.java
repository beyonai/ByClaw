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
    @Autowired @Lazy private ResourceSyncDispatcher dispatcher;

    public void validate(EnterpriseResourceSyncRequest request) {
        // Legacy calls without new fields retain their existing import authentication behavior.
        if (request.viewAuth() != null || request.autoAuthorize() != null) requireSyncPrincipal();
        Scope scope = request.scope();
        if (scope == null) return;
        if ((long) scope.userIds().size() + scope.orgIds().size() + scope.postIds().size() > 20000) {
            throw new IllegalArgumentException("单次同步授权对象不能超过 20000 个，请优先使用组织或岗位范围");
        }
        if (!activeUsers(scope.userIds()).containsAll(scope.userIds())) {
            throw new IllegalArgumentException("授权用户不存在或已停用");
        }
        validateBatch(scope.orgIds(), scopeMapper::organizations, "授权组织不存在");
        validateBatch(scope.postIds(), scopeMapper::ordinaryPosts, "授权岗位不存在或属于数字岗位");
    }

    private void validateBatch(List<Long> ids, java.util.function.Function<List<Long>, List<Long>> query, String message) {
        for (int start = 0; start < ids.size(); start += 500) {
            List<Long> batch = ids.subList(start, Math.min(start + 500, ids.size()));
            if (!query.apply(batch).containsAll(batch)) throw new IllegalArgumentException(message);
        }
    }

    public void requireSyncPrincipal() {
        if (!hasSyncPrincipal()) {
            throw new IllegalArgumentException("资源授权同步需要资源管理员的有效登录身份");
        }
    }

    public boolean hasSyncPrincipal() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return userId != null && userId > 0 && auth.isCurrentUserGlobalResourceManager();
    }

    public void validateExisting(SsResource resource) {
        if (resource == null) return;
        if (!"enterprise".equals(resource.getOwnerType())) {
            throw new IllegalArgumentException("同编码资源必须归属企业 tab");
        }
        if (Objects.equals(resource.getResourceStatus(), -1)) {
            throw new IllegalArgumentException("已注销资源不能通过同步恢复");
        }
    }

    public Set<Long> expand(Scope scope) {
        Set<Long> result = new LinkedHashSet<>();
        if (scope == null) return result;
        result.addAll(scope.userIds());
        for (int start = 0; start < scope.orgIds().size(); start += 500) {
            result.addAll(users.findUserIdsByOrgIdListIncludingChildren(scope.orgIds().subList(start, Math.min(start + 500, scope.orgIds().size()))));
        }
        for (int start = 0; start < scope.postIds().size(); start += 500) {
            result.addAll(users.findUserIdsByPostIds(scope.postIds().subList(start, Math.min(start + 500, scope.postIds().size()))));
        }
        result.remove(null);
        return result;
    }

    public Set<Long> activeUsers(java.util.Collection<Long> userIds) {
        List<Long> ids = new ArrayList<>(userIds);
        Set<Long> result = new LinkedHashSet<>();
        for (int offset = 0; offset < ids.size(); offset += 500) {
            result.addAll(scopeMapper.activeUsers(ids.subList(offset, Math.min(offset + 500, ids.size()))));
        }
        return result;
    }

    public void completeImport(Long resourceId, EnterpriseResourceSyncRequest request, boolean packageChanged,
                               Map<String, Object> response) {
        completeImport(resourceId, request, packageChanged, response, null, null);
    }

    /** Admission never expands memberships or mutates grant rows. The durable job owns those operations. */
    public void completeImport(Long resourceId, EnterpriseResourceSyncRequest request, boolean packageChanged,
                               Map<String, Object> response, String requestId, String requestHash) {
        jobs.lockResource(resourceId);
        SsResource resource = resources.findByIdForUpdate(resourceId);
        validateExisting(resource);
        ResourceSyncJob previous = jobs.latest(resourceId);
        long revision = Math.addExact(Objects.requireNonNullElse(resource.getThirdSyncRevision(), 0L), 1L);
        resource.setThirdSyncRevision(revision);
        var intent = new com.alibaba.fastjson.JSONObject();
        var summary = new com.alibaba.fastjson.JSONObject();
        boolean unfinished = previous != null && !List.of("COMPLETED", "SUPERSEDED").contains(previous.publicStatus());
        if (unfinished) {
            var old = previous.getResultSummary() == null ? new com.alibaba.fastjson.JSONObject()
                : JSON.parseObject(previous.getResultSummary());
            if (!old.getBooleanValue("authorizationApplied") && previous.getAuthorizationIntent() != null) {
                intent.putAll(JSON.parseObject(previous.getAuthorizationIntent()));
            }
            for (String key : List.of("pendingEmployeeIds", "failedEmployeeIds")) {
                if (old.containsKey(key)) summary.put(key, old.get(key));
            }
        }
        if (request.viewAuth() != null) {
            intent.put("viewAuth", request.viewAuth());
            intent.put("viewScope", scopeJson(request.scope()));
            resource.setViewAuthControlled(true);
        }
        if (request.autoAuthorize() != null) {
            intent.remove("autoAuthorize");
            intent.remove("useScope");
            if (Boolean.TRUE.equals(request.autoAuthorize())) {
                intent.put("autoAuthorize", true);
                intent.put("useScope", scopeJson(request.scope()));
                resource.setUseAuthControlled(true);
            }
        }
        resources.updateResourceEntity(resource);
        String mode = Boolean.TRUE.equals(request.autoAuthorize()) ? "RECONCILE"
            : Boolean.FALSE.equals(request.autoAuthorize()) && request.scope() != null ? "CLEANUP_ONLY" : "NONE";
        String scope = request.scope() == null ? null : JSON.toJSONString(scopeJson(request.scope()));
        if (unfinished && request.autoAuthorize() == null) {
            mode = previous.getAssociationMode();
            scope = previous.getAuthScope();
        }
        ResourceSyncJob job = new ResourceSyncJob();
        job.setSyncJobId(sequence.nextVal());
        job.setComAcctId(Objects.requireNonNullElse(resource.getComAcctId(), 0L));
        job.setResourceId(resourceId);
        job.setSyncRevision(revision);
        job.setOperatorUserId(CurrentUserHolder.getCurrentUserId());
        job.setRequestId(requestId);
        job.setRequestHash(requestHash);
        job.setAuthorizationIntent(intent.toJSONString());
        job.setAuthScope(scope);
        job.setAuthRefreshUserIds(unfinished ? previous.getAuthRefreshUserIds() : "[]");
        job.setAssociationMode(mode);
        job.setPackageChanged(packageChanged || "SKILL".equals(resource.getResourceBizType())
            || !intent.isEmpty() || unfinished && Boolean.TRUE.equals(previous.getPackageChanged()));
        summary.put("phase", "QUEUED");
        summary.put("message", "资源已接收，正在排队授权，可离开页面稍后查看进度");
        summary.put("authorizationApplied", false);
        summary.put("authorizationEffective", false);
        job.setResultSummary(summary.toJSONString());
        job.setStatus(ResourceSyncJob.PENDING);
        job.setRetryCount(0);
        job.setNextRetryTime(new Date());
        job.setCreateTime(new Date());
        job.setUpdateTime(new Date());
        jobs.insert(job);
        putAccepted(response, job);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { dispatcher.dispatch(job.getSyncJobId()); }
        });
    }

    public ResourceSyncJob repeated(Long resourceId, String requestId, String hash) {
        if (resourceId == null || requestId == null) return null;
        ResourceSyncJob job = jobs.byRequest(resourceId, requestId);
        if (job != null && !hasSyncPrincipal() && !auth.hasResourceManagePermission(resources.findById(resourceId))) {
            throw new IllegalArgumentException("无权查询该同步请求");
        }
        if (job != null && !Objects.equals(hash, job.getRequestHash())) {
            throw new IllegalArgumentException("requestId 已用于其他同步内容，请为新请求生成新的 requestId");
        }
        return job;
    }

    public void putAccepted(Map<String, Object> response, ResourceSyncJob job) {
        response.put("resourceId", String.valueOf(job.getResourceId()));
        response.put("syncRevision", String.valueOf(job.getSyncRevision()));
        response.put("accepted", true);
        response.put("jobId", String.valueOf(job.getSyncJobId()));
        response.put("status", job.publicStatus());
        response.put("query", job.associationResult().get("query"));
        response.put("association", job.associationResult());
        response.put("authorization", Map.of("status", job.publicStatus(), "effective",
            job.getResultSummary() != null && JSON.parseObject(job.getResultSummary()).getBooleanValue("authorizationEffective")));
    }

    /** Runs in the worker's fenced transaction; grant rows and the cache checkpoint commit together. */
    public Set<Long> applyAuthorization(SsResource resource, ResourceSyncJob job) {
        var intent = job.getAuthorizationIntent() == null ? new com.alibaba.fastjson.JSONObject()
            : JSON.parseObject(job.getAuthorizationIntent());
        Set<Long> affected = new LinkedHashSet<>();
        if (job.getAuthRefreshUserIds() != null) affected.addAll(JSON.parseArray(job.getAuthRefreshUserIds(), Long.class));
        if (intent.containsKey("viewAuth")) {
            replace(resource, List.of(GrantType.ALLOW_VIEW), intent.getBooleanValue("viewAuth")
                ? scope(intent.getJSONObject("viewScope")) : null, GrantType.ALLOW_VIEW, affected);
        }
        if (intent.getBooleanValue("autoAuthorize")) {
            Scope scope = scope(intent.getJSONObject("useScope"));
            replace(resource, List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE), scope, GrantType.FORCE_USE, affected);
            List<Long> granted = new ArrayList<>(activeUsers(expand(scope)));
            for (int start = 0; start < granted.size(); start += 500) {
                grants.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<PrivilegeGrant>()
                    .eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
                    .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
                    .eq(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE).eq(PrivilegeGrant::getStatusCd, "P")
                    .eq(PrivilegeGrant::getGrantToObjType, "USER")
                    .in(PrivilegeGrant::getGrantToObjId, granted.subList(start, Math.min(start + 500, granted.size())))
                    .set(PrivilegeGrant::getStatusCd, "X").set(PrivilegeGrant::getUpdateDate, new Date())
                    .set(PrivilegeGrant::getUpdateStaff, job.getOperatorUserId()));
            }
            affected.addAll(granted);
        }
        if (resource.getCreateBy() != null) affected.add(resource.getCreateBy());
        return affected;
    }

    public static Map<String, Object> scopeJson(Scope scope) {
        return scope == null ? null : Map.of("userIds", scope.userIds(), "orgIds", scope.orgIds(), "postIds", scope.postIds());
    }

    public static Scope scope(com.alibaba.fastjson.JSONObject json) {
        if (json == null) return null;
        return new Scope(ids(json, "userIds"), ids(json, "orgIds"), ids(json, "postIds"));
    }

    private static List<Long> ids(com.alibaba.fastjson.JSONObject json, String key) {
        return json.getJSONArray(key) == null ? List.of() : json.getJSONArray(key).toJavaList(Long.class);
    }

    private void replace(SsResource resource, List<String> types, Scope scope, String newType, Set<Long> affected) {
        List<PrivilegeGrant> old = grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
            .eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
            .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
            .in(PrivilegeGrant::getGrantType, types).eq(PrivilegeGrant::getStatusCd, "A"));
        Map<String, List<Long>> oldSubjects = new LinkedHashMap<>();
        Map<String, PrivilegeGrant> desired = new LinkedHashMap<>();
        if (scope != null) {
            Map.of("USER", scope.userIds(), "ORG", scope.orgIds(), "POST", scope.postIds()).forEach((type, ids) -> ids.forEach(id -> {
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
                desired.put(type + ":" + id, grant);
            }));
        }
        List<PrivilegeGrant> remove = new ArrayList<>();
        Date now = new Date();
        for (PrivilegeGrant grant : old) {
            oldSubjects.computeIfAbsent(grant.getGrantToObjType(), ignored -> new ArrayList<>()).add(grant.getGrantToObjId());
            String key = grant.getGrantToObjType() + ":" + grant.getGrantToObjId();
            if (desired.containsKey(key) && newType.equals(grant.getGrantType()) && "RED".equals(grant.getGrantToType())
                && "READ".equals(grant.getOperType()) && Constants.NOT_ALLOW_UNSUBSCRIBE.equals(grant.getAllowUnsubscribe())
                && (grant.getEffDate() == null || !grant.getEffDate().after(now)) && grant.getExpDate() == null) {
                desired.remove(key);
            } else remove.add(grant);
        }
        grantService.updateAuthorizationBatch(remove, true);
        grantService.saveBatch(new ArrayList<>(desired.values()));
        affected.addAll(expand(new Scope(oldSubjects.getOrDefault("USER", List.of()),
            oldSubjects.getOrDefault("ORG", List.of()), oldSubjects.getOrDefault("POST", List.of()))));
        for (Long station : oldSubjects.getOrDefault("STATION", List.of())) affected.addAll(users.findUserIdsByStationId(station));
        affected.addAll(expand(scope));
    }
}
