package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.model.SkillRelationSource;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest;
import com.iwhalecloud.byai.manager.entity.resource.ResourceBindingSource;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncScopeMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable, revision-guarded reconciliation; each employee commits independently and failures remain retryable. */
@Service
public class ResourceSyncReconcileService {
    private static final Logger log = LoggerFactory.getLogger(ResourceSyncReconcileService.class);
    @Autowired private ResourceSyncJobMapper jobs;
    @Autowired private ResourceSyncScopeMapper scopeMapper;
    @Autowired private EnterpriseResourceSyncService sync;
    @Autowired private ResourceBindingSourceService sources;
    @Autowired private SsResourceService resources;
    @Autowired private SsResourceRelDetailService relations;
    @Autowired private SsResExtDigEmployeeService employeeExt;
    @Autowired private UserService users;
    @Autowired private com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper userOrganizations;
    @Autowired private SequenceService sequence;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired @Lazy private AuthApplicationService auth;
    @Autowired @Lazy private DigitalEmployeeApplicationService employees;
    @Autowired private DigitalEmployeeRuntimeRefreshService runtime;
    @Autowired private com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService skills;

    @Scheduled(fixedDelayString = "${byai.resource-sync.reconcile-delay-ms:10000}")
    public void reconcilePending() {
        for (ResourceSyncJob job : jobs.pending()) {
            if (jobs.claim(job.getSyncJobId(), job.getRetryCount()) != 1) continue;
            executeClaimed(job);
        }
    }

    /** Called after import commits; the scheduled path is only a durable retry/recovery fallback. */
    public ResourceSyncJob reconcileNow(Long jobId) {
        ResourceSyncJob job = jobs.selectById(jobId);
        if (job == null) throw new IllegalArgumentException("同步任务不存在");
        if (jobs.claim(jobId, job.getRetryCount()) == 1) executeClaimed(job);
        return jobs.selectById(jobId);
    }

    private void executeClaimed(ResourceSyncJob job) {
        job.setStatus(ResourceSyncJob.RUNNING);
        LoginInfo previous = CurrentUserHolder.getLoginInfo();
        try {
            LoginInfo operator = new LoginInfo();
            var user = users.findById(job.getOperatorUserId());
            if (user == null) throw new IllegalStateException("同步操作人不存在");
            operator.setUserId(user.getUserId());
            operator.setUserCode(user.getUserCode());
            operator.setEnterpriseId(job.getComAcctId());
            operator.setComAcctId(job.getComAcctId());
            operator.setUsersOrganizations(userOrganizations.selectList(
                new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UsersOrganization>()
                    .eq(com.iwhalecloud.byai.manager.entity.users.UsersOrganization::getUserId, user.getUserId()))
                .stream().map(row -> {
                    var organization = new com.iwhalecloud.byai.common.login.bean.UsersOrganization();
                    organization.setOrgId(row.getOrgId());
                    organization.setPositionId(row.getPositionId());
                    organization.setUserType(row.getUserType());
                    return organization;
                }).toList());
            operator.setUserManageOrgs(List.of());
            CurrentUserHolder.setLoginInfo(operator);
            reconcile(job);
        } catch (Exception exception) {
            Map<String, Object> failure = job.getResultSummary() == null ? new LinkedHashMap<>()
                : new LinkedHashMap<>(JSON.parseObject(job.getResultSummary()));
            failure.put("error", exception.getClass().getSimpleName());
            finish(job, "FAILED", failure);
            log.error("资源同步关联任务失败, jobId={}", job.getSyncJobId(), exception);
        } finally {
            CurrentUserHolder.setLoginInfo(previous);
        }
    }

    void reconcile(ResourceSyncJob job) {
        SsResource resource = resources.findById(job.getResourceId());
        if (!current(resource, job)) {
            finish(job, "SUPERSEDED", previousResult(job));
            return;
        }
        if (job.getAuthRefreshUserIds() != null) {
            auth.refreshResourceSyncAuth(JSON.parseArray(job.getAuthRefreshUserIds(), Long.class));
        }
        if ("SKILL".equals(resource.getResourceBizType())) {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                if (!current(resources.findByIdForUpdate(job.getResourceId()), job)) {
                    throw new IllegalStateException("技能同步版本已失效");
                }
                skills.publishEnterpriseSyncArtifacts(job.getResourceId());
            });
        }
        Map<Long, Set<Long>> desired = new LinkedHashMap<>();
        int skipped = 0;
        Map<String, Integer> skipReasons = new LinkedHashMap<>();
        if (!"NONE".equals(job.getAssociationMode()) && job.getAuthScope() != null) {
            JSONObject input = JSON.parseObject(job.getAuthScope());
            JSONObject wrapper = new JSONObject();
            wrapper.put("resourceBizType", "TOOLKIT");
            wrapper.put("autoAuthorize", true);
            wrapper.put("authScope", input);
            Set<Long> expanded = sync.expand(EnterpriseResourceSyncRequest.parse(wrapper).scope());
            Set<Long> active = sync.activeTenantUsers(expanded, job.getComAcctId());
            skipped += expanded.size() - active.size();
            if (skipped > 0) skipReasons.put("INACTIVE_OR_NON_TENANT_USER", skipped);
            Map<Long, List<Long>> defaultsByUser = new LinkedHashMap<>();
            List<Long> activeIds = new java.util.ArrayList<>(active);
            for (int offset = 0; offset < activeIds.size(); offset += 500) {
                for (var row : scopeMapper.personalAssistantsBatch(
                    activeIds.subList(offset, Math.min(offset + 500, activeIds.size())), job.getComAcctId())) {
                    defaultsByUser.computeIfAbsent(row.userId(), ignored -> new java.util.ArrayList<>()).add(row.employeeId());
                }
            }
            for (Long userId : active) {
                List<Long> defaults = defaultsByUser.getOrDefault(userId, List.of());
                String reason = defaults.size() > 1 ? "AMBIGUOUS_PERSONAL_ASSISTANT"
                    : defaults.isEmpty() || defaults.get(0) == null ? "NO_PERSONAL_ASSISTANT" : null;
                SsResource employee = reason == null ? resources.findById(defaults.get(0)) : null;
                if (reason == null && !eligible(employee, resource, job, userId)) reason = "INELIGIBLE_PERSONAL_ASSISTANT_OR_RESOURCE";
                if (reason != null) {
                    skipped++;
                    skipReasons.merge(reason, 1, Integer::sum);
                    continue;
                }
                desired.computeIfAbsent(employee.getResourceId(), ignored -> new LinkedHashSet<>()).add(userId);
            }
        }
        Set<Long> targets = new LinkedHashSet<>(desired.keySet());
        sources.automaticSources(job.getComAcctId(), job.getResourceId()).forEach(source -> targets.add(source.getDigitalEmployeeId()));
        if (Boolean.TRUE.equals(job.getPackageChanged())) {
            relations.list(new LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getRelResourceId, job.getResourceId())
                .eq(SsResourceRelDetail::getComAcctId, job.getComAcctId()))
                .forEach(relation -> targets.add(relation.getResourceId()));
        }
        // Persist refresh targets before mutating relations, so the next revision can inherit committed work.
        JSONObject old = previousResult(job);
        for (String key : List.of("failedEmployeeIds", "pendingEmployeeIds")) {
            if (old.getJSONArray(key) != null) {
                old.getJSONArray(key).forEach(id -> targets.add(Long.valueOf(id.toString())));
            }
        }
        if (!persistTargets(job, targets)) {
            finish(job, "SUPERSEDED", previousResult(job));
            return;
        }
        Set<Long> failures = new LinkedHashSet<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Long employeeId : targets.stream().sorted().toList()) {
            try {
                Map<String, Integer> delta = new TransactionTemplate(transactionManager).execute(status ->
                    reconcileEmployee(job, employeeId, desired.getOrDefault(employeeId, Set.of())));
                if (delta == null) throw new IllegalStateException("关联事务未返回结果");
                delta.forEach((key, count) -> counts.merge(key, count, Integer::sum));
                // A superseded revision must never publish an older runtime configuration.
                if (!current(resources.findById(job.getResourceId()), job)) {
                    finish(job, "SUPERSEDED", previousResult(job));
                    return;
                }
                if (resources.findById(employeeId) != null) runtime.refreshForResourceSync(employeeId);
            } catch (Exception exception) {
                failures.add(employeeId);
                log.error("资源同步员工关联/运行态刷新失败, jobId={}, employeeId={}", job.getSyncJobId(), employeeId, exception);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>(counts);
        result.put("employeeCount", targets.size());
        result.put("skippedUserCount", skipped);
        result.put("skipReasons", skipReasons);
        result.put("failedEmployeeIds", failures.stream().map(String::valueOf).toList());
        result.put("pendingEmployeeIds", failures.stream().map(String::valueOf).toList());
        result.put("failedEmployeeCount", failures.size());
        finish(job, failures.isEmpty() ? "COMPLETED" : "PARTIAL", result);
    }

    private boolean eligible(SsResource employee, SsResource resource, ResourceSyncJob job, Long userId) {
        if (employee == null || !"DIG_EMPLOYEE".equals(employee.getResourceBizType())
            || !Objects.equals(employee.getComAcctId(), job.getComAcctId())
            || !Objects.equals(employee.getResourceStatus(), 2) || !Objects.equals(resource.getResourceStatus(), 2)
            || "BY_SUPER".equals(employee.getWorkerAgentType())
            || employee.getResourceCode() != null && employee.getResourceCode().endsWith("_main")) return false;
        var extension = employeeExt.findById(employee.getResourceId());
        if (extension == null || "017".equals(extension.getAgentType())) return false;
        return auth.hasResourceUsePermission(employee, userId) && auth.hasResourceUsePermission(resource, userId);
    }

    private Map<String, Integer> reconcileEmployee(ResourceSyncJob job, Long employeeId, Set<Long> desiredUsers) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        SsResource resource = resources.findByIdForUpdate(job.getResourceId());
        if (!current(resource, job)) throw new IllegalStateException("同步版本已失效");
        SsResource employee = resources.findByIdForUpdate(employeeId);
        if (employee != null && !Objects.equals(employee.getComAcctId(), job.getComAcctId())) {
            throw new IllegalStateException("员工企业不匹配");
        }
        List<SsResourceRelDetail> existing = relations.list(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, employeeId).eq(SsResourceRelDetail::getRelResourceId, resource.getResourceId()));
        List<ResourceBindingSource> ledger = sources.sources(job.getComAcctId(), employeeId, resource.getResourceId());
        Set<Long> validUsers = new LinkedHashSet<>();
        if (!"NONE".equals(job.getAssociationMode())) {
            for (Long user : desiredUsers) {
                if ("CLEANUP_ONLY".equals(job.getAssociationMode()) && ledger.stream().noneMatch(source ->
                    ResourceBindingSourceService.SYNC.equals(source.getSourceType()) && "A".equals(source.getStatusCd())
                    && Objects.equals(user, source.getSourceUserId()))) continue;
                if (!scopeMapper.activeTenantUsers(List.of(user), job.getComAcctId()).contains(user)) continue;
                List<Long> defaults = scopeMapper.personalAssistants(user, job.getComAcctId());
                if (defaults.size() == 1 && Objects.equals(defaults.get(0), employeeId)
                    && eligible(employee, resource, job, user)) validUsers.add(user);
            }
        }
        if (!existing.isEmpty() && ledger.isEmpty() && !"SKILL".equals(resource.getResourceBizType())) {
            sources.retain(job.getComAcctId(), employeeId, resource.getResourceId(), "LEGACY", null, null);
        }
        for (ResourceBindingSource source : ledger) {
            if (!ResourceBindingSourceService.SYNC.equals(source.getSourceType()) || !"A".equals(source.getStatusCd())) continue;
            if (!"NONE".equals(job.getAssociationMode()) && !validUsers.contains(source.getSourceUserId())) {
                sources.revoke(source);
                counts.merge("removedSourceCount", 1, Integer::sum);
            }
        }
        if ("RECONCILE".equals(job.getAssociationMode())) {
            for (Long user : validUsers) {
                boolean active = ledger.stream().anyMatch(source -> ResourceBindingSourceService.SYNC.equals(source.getSourceType())
                    && "A".equals(source.getStatusCd()) && Objects.equals(user, source.getSourceUserId()));
                sources.retain(job.getComAcctId(), employeeId, resource.getResourceId(), ResourceBindingSourceService.SYNC,
                    user, job.getSyncRevision());
                if (!active) counts.merge("addedSourceCount", 1, Integer::sum);
            }
        }
        boolean hasLedger = sources.hasActive(job.getComAcctId(), employeeId, resource.getResourceId());
        if (existing.isEmpty() && "RECONCILE".equals(job.getAssociationMode()) && !validUsers.isEmpty()
            && sources.hasAutomatic(job.getComAcctId(), employeeId, resource.getResourceId()) && employee != null) {
            SsResourceRelDetail relation = new SsResourceRelDetail();
            relation.setResourceRelDetailId(sequence.nextVal());
            relation.setResourceId(employeeId);
            relation.setRelResourceId(resource.getResourceId());
            relation.setComAcctId(job.getComAcctId());
            relation.setCreateBy(job.getOperatorUserId());
            relation.setCreateTime(new Date());
            relation.setRelStatus(1);
            relation.setRelTypeName("SKILL".equals(resource.getResourceBizType()) ? "DIG_EMPLOYEE_SKILL"
                : employeeId + ":" + resource.getResourceId());
            if ("SKILL".equals(resource.getResourceBizType())) {
                relation.setRelResourceInfo(SkillRelationSource.parse("{\"manual\":false,\"sourceGroupIds\":[]}").toJson());
            }
            if (!relations.save(relation)) throw new IllegalStateException("新增关联失败");
            counts.merge("addedRelationCount", 1, Integer::sum);
        } else if (!hasLedger && !"NONE".equals(job.getAssociationMode())) {
            for (SsResourceRelDetail relation : existing) {
                if ("SKILL".equals(resource.getResourceBizType())
                    && SkillRelationSource.parse(relation.getRelResourceInfo()).hasAnySource()) continue;
                if (!relations.removeById(relation.getResourceRelDetailId())) throw new IllegalStateException("撤销关联失败");
                counts.merge("removedRelationCount", 1, Integer::sum);
            }
        }
        if (employee != null) employees.rebuildAndSaveDigitalEmployeeRelSkills(employeeId);
        return counts;
    }

    private boolean current(SsResource resource, ResourceSyncJob job) {
        return resource != null && Objects.equals(resource.getResourceId(), job.getResourceId()) && "enterprise".equals(resource.getOwnerType())
            && !Objects.equals(resource.getResourceStatus(), -1) && Objects.equals(resource.getComAcctId(), job.getComAcctId())
            && Objects.equals(resource.getThirdSyncRevision(), job.getSyncRevision());
    }

    private JSONObject previousResult(ResourceSyncJob job) {
        return job.getResultSummary() == null ? new JSONObject() : JSON.parseObject(job.getResultSummary());
    }

    private boolean persistTargets(ResourceSyncJob job, Set<Long> targets) {
        return Boolean.TRUE.equals(new TransactionTemplate(transactionManager).execute(status -> {
            // Same resource lock as completeImport: inheritance cannot miss an already committed mutation.
            if (!current(resources.findByIdForUpdate(job.getResourceId()), job)) return false;
            JSONObject result = previousResult(job);
            result.put("pendingEmployeeIds", targets.stream().map(String::valueOf).toList());
            String summary = result.toJSONString();
            int updated = jobs.update(null, new LambdaUpdateWrapper<ResourceSyncJob>()
                .eq(ResourceSyncJob::getSyncJobId, job.getSyncJobId()).eq(ResourceSyncJob::getStatus, ResourceSyncJob.RUNNING)
                .eq(ResourceSyncJob::getRetryCount, job.getRetryCount() + 1)
                .set(ResourceSyncJob::getResultSummary, summary).set(ResourceSyncJob::getUpdateTime, new Date()));
            if (updated == 1) job.setResultSummary(summary);
            return updated == 1;
        }));
    }

    private void finish(ResourceSyncJob job, String status, Map<String, ?> result) {
        job.setStatus(List.of("PARTIAL", "FAILED").contains(status) ? status + "_V2" : status);
        job.setResultSummary(JSON.toJSONString(result));
        job.setRetryCount(job.getRetryCount() + 1);
        job.setUpdateTime(new Date());
        job.setNextRetryTime(new Date(System.currentTimeMillis() + Math.min(300000L, 10000L << Math.min(job.getRetryCount(), 5))));
        // A worker whose lease was reclaimed must not overwrite the newer worker's result.
        jobs.update(null, new LambdaUpdateWrapper<ResourceSyncJob>()
            .eq(ResourceSyncJob::getSyncJobId, job.getSyncJobId()).eq(ResourceSyncJob::getStatus, ResourceSyncJob.RUNNING)
            .eq(ResourceSyncJob::getRetryCount, job.getRetryCount())
            .set(ResourceSyncJob::getStatus, job.getStatus()).set(ResourceSyncJob::getResultSummary, job.getResultSummary())
            .set(ResourceSyncJob::getUpdateTime, job.getUpdateTime()).set(ResourceSyncJob::getNextRetryTime, job.getNextRetryTime()));
    }
}
