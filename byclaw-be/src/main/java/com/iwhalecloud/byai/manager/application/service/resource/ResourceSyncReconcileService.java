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
    @Autowired private com.iwhalecloud.byai.manager.mapper.auth.AuthorizationTaskMapper manualTasks;
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

    @Autowired @org.springframework.beans.factory.annotation.Qualifier("resourceSyncExecutor")
    private java.util.concurrent.Executor executor;
    private final java.util.Set<Long> scheduled = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final java.util.concurrent.ScheduledExecutorService heartbeats = java.util.concurrent.Executors.newScheduledThreadPool(2, r -> {
        Thread thread = new Thread(r, "resource-sync-heartbeat"); thread.setDaemon(true); return thread;
    });

    @jakarta.annotation.PreDestroy public void shutdown() { heartbeats.shutdownNow(); }

    @Scheduled(fixedDelayString = "${byai.resource-sync.reconcile-delay-ms:10000}")
    public void reconcilePending() {
        for (ResourceSyncJob job : jobs.pending()) {
            if (!scheduled.add(job.getSyncJobId())) continue;
            try {
                executor.execute(() -> {
                    try { reconcileNow(job.getSyncJobId()); }
                    finally { scheduled.remove(job.getSyncJobId()); }
                });
            } catch (java.util.concurrent.RejectedExecutionException busy) { scheduled.remove(job.getSyncJobId()); }
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
        var renewal = heartbeats.scheduleAtFixedRate(() -> {
            try { jobs.heartbeat(job.getSyncJobId(), job.getRetryCount() + 1); }
            catch (RuntimeException failure) { log.warn("资源同步心跳暂时失败 jobId={}", job.getSyncJobId(), failure); }
        }, 10, 10, java.util.concurrent.TimeUnit.SECONDS);
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
            ResourceSyncJob committed = jobs.selectById(job.getSyncJobId());
            String summary = committed == null ? job.getResultSummary() : committed.getResultSummary();
            Map<String, Object> failure = summary == null ? new LinkedHashMap<>() : new LinkedHashMap<>(JSON.parseObject(summary));
            failure.put("phase", "FAILED");
            failure.put("message", job.getRetryCount() + 1 < job.getRetryLimit() ? "处理暂未完成，后台将自动重试，可稍后刷新进度" : "处理未完成，请查看后重试");
            finish(job, "FAILED", failure);
            log.error("资源同步关联任务失败, jobId={}", job.getSyncJobId(), exception);
        } finally {
            renewal.cancel(false);
            CurrentUserHolder.setLoginInfo(previous);
        }
    }

    void reconcile(ResourceSyncJob job) {
        SsResource resource = resources.findById(job.getResourceId());
        if (!current(resource, job)) {
            finish(job, "SUPERSEDED", previousResult(job));
            return;
        }
        JSONObject progress = previousResult(job);
        if (manualTasks != null && manualTasks.selectCount(new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.auth.AuthorizationTask>()
            .eq(com.iwhalecloud.byai.manager.entity.auth.AuthorizationTask::getResourceId, job.getResourceId())
            .isNotNull(com.iwhalecloud.byai.manager.entity.auth.AuthorizationTask::getActiveResource)) > 0) {
            progress.put("phase", "WAITING");
            progress.put("message", "正在等待该资源已有的手工授权任务，请稍后刷新；如前一个任务失败，请先处理该任务");
            jobs.defer(job.getSyncJobId(), job.getRetryCount() + 1, progress.toJSONString());
            return;
        }
        if (!progress.getBooleanValue("authorizationApplied") && job.getAuthorizationIntent() != null) {
            progress.put("phase", "AUTHORIZING");
            progress.put("message", "正在计算授权范围并批量保存授权");
            checkpoint(job, progress);
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                fence(job);
                if (!JSON.parseObject(job.getAuthorizationIntent()).isEmpty()) {
                    if (!"A".equals(users.findById(job.getOperatorUserId()).getState())) throw new IllegalStateException("同步操作人已停用");
                    sync.requireSyncPrincipal();
                }
                Set<Long> affected = sync.applyAuthorization(resource, job);
                job.setAuthRefreshUserIds(JSON.toJSONString(affected));
                progress.put("authorizationApplied", true);
                progress.put("totalUsers", affected.size());
                progress.put("completedUsers", 0);
                // The checkpoint and grant writes are one transaction: retries cannot reapply old permissions.
                checkpoint(job, progress);
            });
        }
        if (job.getAuthRefreshUserIds() != null && !progress.getBooleanValue("authorizationEffective")) {
            List<Long> affected = JSON.parseArray(job.getAuthRefreshUserIds(), Long.class);
            progress.put("phase", "AUTHORIZING");
            progress.put("message", "授权已保存，正在同步生效");
            progress.put("totalUsers", affected.size());
            for (int start = progress.getIntValue("completedUsers"); start < affected.size(); start += 100) {
                int end = Math.min(start + 100, affected.size());
                List<Long> batch = affected.subList(start, end);
                new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    fence(job);
                    auth.refreshResourceSyncAuth(resources.findById(job.getResourceId()), batch);
                    progress.put("completedUsers", end);
                    checkpoint(job, progress);
                });
            }
        }
        progress.put("authorizationApplied", true);
        progress.put("authorizationEffective", true);
        progress.put("phase", "CONFIGURING");
        progress.put("message", "授权已完成，正在更新数字员工配置");
        checkpoint(job, progress);
        if ("SKILL".equals(resource.getResourceBizType())) {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                fence(job);
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
            Set<Long> active = sync.activeUsers(expanded);
            skipped += expanded.size() - active.size();
            if (skipped > 0) skipReasons.put("INACTIVE_USER", skipped);
            Map<Long, List<Long>> assistantsByUser = new LinkedHashMap<>();
            List<Long> activeIds = new java.util.ArrayList<>(active);
            for (int offset = 0; offset < activeIds.size(); offset += 500) {
                for (var row : scopeMapper.personalAssistantsBatch(
                    activeIds.subList(offset, Math.min(offset + 500, activeIds.size())))) {
                    assistantsByUser.computeIfAbsent(row.userId(), ignored -> new java.util.ArrayList<>()).add(row.employeeId());
                }
            }
            for (int start = 0; start < activeIds.size(); start += 500) {
                List<Long> batch = activeIds.subList(start, Math.min(start + 500, activeIds.size()));
                List<Long> employeeIds = batch.stream().flatMap(id -> assistantsByUser.getOrDefault(id, List.of()).stream())
                    .filter(Objects::nonNull).distinct().toList();
                Map<Long, SsResource> candidates = new LinkedHashMap<>();
                resources.findByIds(employeeIds).forEach(value -> candidates.put(value.getResourceId(), value));
                Map<Long, com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee> extensions = new LinkedHashMap<>();
                employeeExt.findByIds(employeeIds).forEach(value -> extensions.put(value.getResourceId(), value));
                Map<Long, SsResource> candidateByUser = new LinkedHashMap<>();
                for (Long userId : batch) {
                    List<Long> assistants = assistantsByUser.getOrDefault(userId, List.of());
                    String reason = assistants.size() > 1 ? "AMBIGUOUS_PERSONAL_ASSISTANT"
                        : assistants.isEmpty() || assistants.get(0) == null ? "NO_PERSONAL_ASSISTANT" : null;
                    SsResource employee = reason == null ? candidates.get(assistants.get(0)) : null;
                    if (reason == null && !eligibleConfiguration(employee, resource, extensions.get(assistants.get(0)))) {
                        reason = "INELIGIBLE_PERSONAL_ASSISTANT_OR_RESOURCE";
                    }
                    if (reason != null) { skipped++; skipReasons.merge(reason, 1, Integer::sum); }
                    else candidateByUser.put(userId, employee);
                }
                Set<Long> permitted = auth.resourceSyncPermittedUsers(resource, candidateByUser);
                for (var entry : candidateByUser.entrySet()) {
                    if (!permitted.contains(entry.getKey())) {
                        skipped++; skipReasons.merge("INELIGIBLE_PERSONAL_ASSISTANT_OR_RESOURCE", 1, Integer::sum);
                    } else desired.computeIfAbsent(entry.getValue().getResourceId(), ignored -> new LinkedHashSet<>()).add(entry.getKey());
                }
            }
        }

        // Cleanup does not request new assistant configuration; missing recipients are not incomplete work.
        if (!"RECONCILE".equals(job.getAssociationMode())) { skipped = 0; skipReasons.clear(); }

        Set<Long> targets = new LinkedHashSet<>(desired.keySet());
        sources.automaticSourcesForSynchronization(job.getResourceId()).forEach(source -> targets.add(source.getDigitalEmployeeId()));
        if (Boolean.TRUE.equals(job.getPackageChanged())) {
            relations.list(new LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getRelResourceId, job.getResourceId()))
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
        JSONObject work = previousResult(job);
        Set<Long> completed = new LinkedHashSet<>();
        if (work.getJSONArray("_completedEmployeeIds") != null) completed.addAll(work.getJSONArray("_completedEmployeeIds").toJavaList(Long.class));
        completed.retainAll(targets);
        work.put("employeeCount", targets.size());
        work.put("skippedUserCount", skipped);
        work.put("skipReasons", skipReasons);
        Set<Long> failures = new LinkedHashSet<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        checkpoint(job, work);
        int sinceCheckpoint = 0;
        long lastCheckpoint = System.currentTimeMillis();
        for (Long employeeId : targets.stream().sorted().toList()) {
            if (completed.contains(employeeId)) continue;
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
                // Hold the same revision fence while publishing so a newer import cannot be overwritten.
                new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    fence(job);
                    if (resources.findById(employeeId) != null) runtime.refreshForResourceSync(employeeId);
                });
                completed.add(employeeId);
            } catch (Exception exception) {
                failures.add(employeeId);
                log.error("资源同步员工关联/运行态刷新失败, jobId={}, employeeId={}", job.getSyncJobId(), employeeId, exception);
            }
            if (++sinceCheckpoint >= 25 || System.currentTimeMillis() - lastCheckpoint >= 2000
                || completed.size() + failures.size() == targets.size()) {
                sinceCheckpoint = 0;
                lastCheckpoint = System.currentTimeMillis();
                work.put("_completedEmployeeIds", completed.stream().map(String::valueOf).toList());
                work.put("completedEmployeeCount", completed.size());
                work.put("pendingEmployeeIds", targets.stream().filter(id -> !completed.contains(id)).map(String::valueOf).toList());
                work.put("failedEmployeeCount", failures.size());
                checkpoint(job, work);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>(work);
        result.putAll(counts);
        result.put("phase", failures.isEmpty() ? "DONE" : "PARTIAL");
        result.put("message", failures.isEmpty() ? (skipped == 0 ? "授权及数字员工配置更新已完成" : "授权已完成，部分人员未配置数字员工，请查看跳过原因") : "授权已完成，部分员工配置更新失败，后台将重试");
        result.put("employeeCount", targets.size());
        result.put("skippedUserCount", skipped);
        result.put("skipReasons", skipReasons);
        result.put("failedEmployeeIds", failures.stream().map(String::valueOf).toList());
        result.put("pendingEmployeeIds", failures.stream().map(String::valueOf).toList());
        result.put("failedEmployeeCount", failures.size());
        finish(job, failures.isEmpty() ? "COMPLETED" : "PARTIAL", result);
    }

    private boolean eligibleConfiguration(SsResource employee, SsResource resource,
        com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee extension) {
        return employee != null && "DIG_EMPLOYEE".equals(employee.getResourceBizType())
            && Objects.equals(employee.getResourceStatus(), 2) && Objects.equals(resource.getResourceStatus(), 2)
            && !"BY_SUPER".equals(employee.getWorkerAgentType())
            && !(employee.getResourceCode() != null && employee.getResourceCode().endsWith("_main"))
            && extension != null && !"017".equals(extension.getAgentType());
    }

    private boolean eligible(SsResource employee, SsResource resource, Long userId) {
        return employee != null && eligibleConfiguration(employee, resource, employeeExt.findById(employee.getResourceId()))
            && EnterpriseResourceSyncContext.checkUsePermission(employee, () -> auth.hasResourceUsePermission(employee, userId))
            && EnterpriseResourceSyncContext.checkUsePermission(resource, () -> auth.hasResourceUsePermission(resource, userId));
    }

    private Map<String, Integer> reconcileEmployee(ResourceSyncJob job, Long employeeId, Set<Long> desiredUsers) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        fence(job);
        SsResource resource = resources.findByIdForUpdate(job.getResourceId());
        if (!current(resource, job)) throw new IllegalStateException("同步版本已失效");
        SsResource employee = resources.findByIdForUpdate(employeeId);
        List<SsResourceRelDetail> existing = relations.list(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, employeeId).eq(SsResourceRelDetail::getRelResourceId, resource.getResourceId()));
        List<ResourceBindingSource> ledger = sources.sourcesForSynchronization(employeeId, resource.getResourceId());
        Set<Long> validUsers = new LinkedHashSet<>();
        if (!"NONE".equals(job.getAssociationMode())) {
            for (Long user : desiredUsers) {
                if ("CLEANUP_ONLY".equals(job.getAssociationMode()) && ledger.stream().noneMatch(source ->
                    ResourceBindingSourceService.SYNC.equals(source.getSourceType()) && "A".equals(source.getStatusCd())
                    && Objects.equals(user, source.getSourceUserId()))) continue;
                if (!scopeMapper.activeUsers(List.of(user)).contains(user)) continue;
                List<Long> assistants = scopeMapper.personalAssistants(user);
                if (assistants.size() == 1 && Objects.equals(assistants.get(0), employeeId)
                    && eligible(employee, resource, user)) validUsers.add(user);
            }
        }
        if (!existing.isEmpty() && ledger.isEmpty() && !"SKILL".equals(resource.getResourceBizType())) {
            sources.retainForSynchronization(job.getComAcctId(), employeeId, resource.getResourceId(), "LEGACY", null, null);
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
                sources.retainForSynchronization(job.getComAcctId(), employeeId, resource.getResourceId(), ResourceBindingSourceService.SYNC,
                    user, job.getSyncRevision());
                if (!active) counts.merge("addedSourceCount", 1, Integer::sum);
            }
        }
        List<ResourceBindingSource> activeSources = sources.sourcesForSynchronization(employeeId, resource.getResourceId())
            .stream().filter(source -> "A".equals(source.getStatusCd())).toList();
        boolean hasLedger = !activeSources.isEmpty();
        if (existing.isEmpty() && "RECONCILE".equals(job.getAssociationMode()) && !validUsers.isEmpty()
            && activeSources.stream().anyMatch(source -> ResourceBindingSourceService.SYNC.equals(source.getSourceType()))
            && employee != null) {
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
        return resource != null && Objects.equals(resource.getResourceId(), job.getResourceId())
            && "enterprise".equals(resource.getOwnerType()) && !Objects.equals(resource.getResourceStatus(), -1)
            && Objects.equals(resource.getThirdSyncRevision(), job.getSyncRevision());
    }

    private JSONObject previousResult(ResourceSyncJob job) {
        return job.getResultSummary() == null ? new JSONObject() : JSON.parseObject(job.getResultSummary());
    }

    private boolean persistTargets(ResourceSyncJob job, Set<Long> targets) {
        return Boolean.TRUE.equals(new TransactionTemplate(transactionManager).execute(status -> {
            fence(job);
            // Inheritance cannot miss an already committed mutation.
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

    private void fence(ResourceSyncJob job) {
        if (jobs.fenceResource(job.getResourceId(), job.getSyncRevision()) != 1
            || jobs.owned(job.getSyncJobId(), job.getRetryCount() + 1) != 1) {
            throw new IllegalStateException("同步任务已被更新版本或其他执行者接管");
        }
    }

    private void checkpoint(ResourceSyncJob job, JSONObject progress) {
        String summary = progress.toJSONString();
        int updated = jobs.update(null, new LambdaUpdateWrapper<ResourceSyncJob>()
            .eq(ResourceSyncJob::getSyncJobId, job.getSyncJobId()).eq(ResourceSyncJob::getStatus, ResourceSyncJob.RUNNING)
            .eq(ResourceSyncJob::getRetryCount, job.getRetryCount() + 1)
            .set(ResourceSyncJob::getResultSummary, summary).set(ResourceSyncJob::getAuthRefreshUserIds, job.getAuthRefreshUserIds())
            .set(ResourceSyncJob::getUpdateTime, new Date()));
        if (updated != 1) throw new IllegalStateException("同步任务执行权已失效");
        job.setResultSummary(summary);
    }

    private void finish(ResourceSyncJob job, String status, Map<String, ?> result) {
        job.setStatus(List.of("PARTIAL", "FAILED").contains(status) ? status + "_V3" : status);
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
