package com.iwhalecloud.byai.manager.application.service.auth;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.auth.AuthorizationTask;
import com.iwhalecloud.byai.manager.mapper.auth.AuthorizationTaskMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthorizationTaskQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable queue + transactional cache outbox. No process-local queue is used as the source of truth. */
@Service
public class AuthorizationTaskService {
    private static final Logger log = LoggerFactory.getLogger(AuthorizationTaskService.class);
    private static final long LEASE_MS = 120_000;
    @Autowired private AuthorizationTaskMapper tasks;
    @Autowired @Lazy private AuthApplicationService auth;
    @Autowired private AuthRedisSyncService redis;
    @Autowired private com.iwhalecloud.byai.manager.mapper.auth.AuthorizationSubjectMapper subjects;
    @Autowired private com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper grants;
    @Autowired @Lazy private LoginApplicationService logins;
    @Autowired private UserService users;
    @Autowired private PlatformTransactionManager transactions;
    @Autowired private com.iwhalecloud.byai.manager.domain.enterprise.service.TenantUserMembershipService memberships;
    @Autowired private com.iwhalecloud.byai.manager.application.service.resource.ResourceSyncAuthorizationGuard syncGuard;
    private final AtomicBoolean running = new AtomicBoolean();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> daemon(r, "authorization-worker"));
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor(r -> daemon(r, "authorization-heartbeat"));

    private static Thread daemon(Runnable runnable, String name) {
        Thread thread = new Thread(runnable, name);
        thread.setDaemon(true);
        return thread;
    }

    public AuthorizationTask submit(AuthorizationTaskQo request) {
        requireActor();
        validateTargets(request.getSetting());
        auth.validateAuthorizationTask(request.getSetting(), "MANAGE".equals(request.getOperation()));
        String payload = JSON.toJSONString(request.getSetting());
        String hash = hash(request.getOperation() + ":" + payload);
        AuthorizationTask previous = byRequest(request.getRequestId());
        if (previous != null) return sameRequest(previous, hash);
        long now = System.currentTimeMillis();
        AuthorizationTask task = new AuthorizationTask();
        task.setTaskId(UUID.randomUUID().toString());
        task.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        task.setOperatorId(CurrentUserHolder.getCurrentUserId());
        task.setResourceId(request.getSetting().getResourceId());
        task.setOperation(request.getOperation());
        task.setRequestId(request.getRequestId());
        task.setRequestHash(hash);
        task.setPayload(payload);
        task.setStatus("QUEUED");
        task.setPhase("WAITING");
        task.setProgress(0);
        task.setCompletedUsers(0);
        task.setTotalUsers(0);
        task.setDataApplied(0);
        task.setAttempts(0);
        task.setCreatedAt(now);
        task.setUpdatedAt(now);
        task.setRetryAt(now);
        task.setActiveResource(task.getEnterpriseId() + ":" + task.getResourceId());
        task.setMessage("已进入后台队列，可关闭窗口，稍后查看进度");
        try {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                if (syncGuard != null) syncGuard.beforeManualWrite(task.getResourceId(), false);
                tasks.insert(task);
            });
        } catch (DuplicateKeyException duplicate) {
            previous = byRequest(request.getRequestId());
            if (previous != null) return sameRequest(previous, hash);
            throw new BaseException("该资源已有未完成的授权任务，请先查看进度或处理失败任务");
        }
        return task;
    }

    private void validateTargets(ResourceMemberSettingQo setting) {
        List<com.iwhalecloud.byai.manager.dto.auth.AuthDTO> targets = new ArrayList<>();
        if (setting.getRedList() != null) targets.addAll(setting.getRedList());
        if (setting.getBlackList() != null) targets.addAll(setting.getBlackList());
        if (targets.size() > 20000) throw new BaseException("单次授权对象不能超过20000个，请使用组织或岗位授权");
        for (var target : targets) {
            if (target == null || target.getGrantToObjId() == null || target.getGrantToObjType() == null
                || !Set.of("USER", "ORG", "POST", "STATION").contains(target.getGrantToObjType())) {
                throw new BaseException("授权对象无效，请重新选择");
            }
        }
    }

    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }

    private AuthorizationTask sameRequest(AuthorizationTask task, String hash) {
        if (!Objects.equals(task.getRequestHash(), hash)) throw new BaseException("请求标识已被其他授权内容使用，请重新提交");
        return task;
    }

    private void requireActor() {
        if (CurrentUserHolder.getCurrentUserId() == null || CurrentUserHolder.getEnterpriseId() == null) throw new BaseException("请重新登录");
    }

    private LambdaQueryWrapper<AuthorizationTask> own() {
        requireActor();
        return new LambdaQueryWrapper<AuthorizationTask>()
            .eq(AuthorizationTask::getEnterpriseId, CurrentUserHolder.getEnterpriseId())
            .eq(AuthorizationTask::getOperatorId, CurrentUserHolder.getCurrentUserId());
    }

    public AuthorizationTask byRequest(String requestId) {
        return tasks.selectOne(own().eq(AuthorizationTask::getRequestId, requestId));
    }

    public AuthorizationTask get(String id) {
        AuthorizationTask task = tasks.selectOne(own().eq(AuthorizationTask::getTaskId, id));
        if (task == null) throw new BaseException("授权任务不存在或无权查看");
        return task;
    }

    public List<AuthorizationTask> latest(Long resourceId) {
        try {
            PageHelper.startPage(1, 10, false);
            return tasks.selectList(own().eq(AuthorizationTask::getResourceId, resourceId)
                .orderByDesc(AuthorizationTask::getCreatedAt));
        } finally { PageHelper.clearPage(); }
    }

    public AuthorizationTask retry(String id) {
        AuthorizationTask task = get(id);
        if (!"FAILED".equals(task.getStatus())) return task;
        if (task.getDataApplied() == 0) auth.validateAuthorizationTask(JSON.parseObject(task.getPayload(), ResourceMemberSettingQo.class), "MANAGE".equals(task.getOperation()));
        tasks.update(null, new LambdaUpdateWrapper<AuthorizationTask>().eq(AuthorizationTask::getTaskId, id)
            .eq(AuthorizationTask::getStatus, "FAILED").set(AuthorizationTask::getStatus, "QUEUED")
            .set(AuthorizationTask::getAttempts, 0).set(AuthorizationTask::getRetryAt, System.currentTimeMillis())
            .set(AuthorizationTask::getMessage, "正在等待重试").set(AuthorizationTask::getUpdatedAt, System.currentTimeMillis()));
        return get(id);
    }

    public AuthorizationTask cancel(String id) {
        AuthorizationTask task = get(id);
        if (!"FAILED".equals(task.getStatus()) || task.getDataApplied() != 0) throw new BaseException("仅未保存授权数据的失败任务可以放弃；已保存的任务请重试生效同步");
        tasks.update(null, new LambdaUpdateWrapper<AuthorizationTask>().eq(AuthorizationTask::getTaskId, id)
            .eq(AuthorizationTask::getStatus, "FAILED").eq(AuthorizationTask::getDataApplied, 0)
            .set(AuthorizationTask::getStatus, "CANCELLED").set(AuthorizationTask::getActiveResource, null)
            .set(AuthorizationTask::getMessage, "已放弃，授权数据未修改").set(AuthorizationTask::getUpdatedAt, System.currentTimeMillis()));
        return get(id);
    }

    @Scheduled(fixedDelayString = "${byai.authorization.poll-ms:2000}")
    public void poll() {
        if (!running.compareAndSet(false, true)) return;
        try {
            worker.execute(() -> {
                try { runNext(); }
                catch (Exception exception) { log.error("授权后台队列处理失败", exception); }
                finally { running.set(false); }
            });
        } catch (RejectedExecutionException exception) { running.set(false); }
    }

    void runNext() {
        long now = System.currentTimeMillis();
        List<AuthorizationTask> pending;
        try {
            PageHelper.startPage(1, 1, false);
            // Recover a running job before starting a later job, preserving cache update order.
            pending = tasks.selectList(new LambdaQueryWrapper<AuthorizationTask>()
                .and(q -> q.in(AuthorizationTask::getStatus, List.of("QUEUED", "RETRYING"))
                    .le(AuthorizationTask::getRetryAt, now).or(r -> r.eq(AuthorizationTask::getStatus, "RUNNING")
                        .lt(AuthorizationTask::getLeaseUntil, now)))
                .orderByDesc(AuthorizationTask::getStatus).orderByAsc(AuthorizationTask::getCreatedAt));
        } finally { PageHelper.clearPage(); }
        if (pending.isEmpty()) return;
        AuthorizationTask task = pending.get(0);
        String token = UUID.randomUUID().toString();
        LambdaUpdateWrapper<AuthorizationTask> claim = new LambdaUpdateWrapper<AuthorizationTask>()
            .eq(AuthorizationTask::getTaskId, task.getTaskId()).eq(AuthorizationTask::getStatus, task.getStatus())
            .eq(AuthorizationTask::getAttempts, task.getAttempts());
        if ("RUNNING".equals(task.getStatus())) claim.lt(AuthorizationTask::getLeaseUntil, now);
        claim.set(AuthorizationTask::getStatus, "RUNNING").set(AuthorizationTask::getWorkerSlot, "AUTHORIZATION")
            .set(AuthorizationTask::getLeaseToken, token).set(AuthorizationTask::getLeaseUntil, now + LEASE_MS)
            .set(AuthorizationTask::getAttempts, task.getAttempts() + 1).set(AuthorizationTask::getUpdatedAt, now);
        try { if (tasks.update(null, claim) != 1) return; }
        catch (DuplicateKeyException busy) { return; } // Unique worker slot coordinates all application instances.
        task.setLeaseToken(token);
        task.setAttempts(task.getAttempts() + 1);
        execute(task);
    }

    private LambdaUpdateWrapper<AuthorizationTask> ownedLease(AuthorizationTask task) {
        return new LambdaUpdateWrapper<AuthorizationTask>().eq(AuthorizationTask::getTaskId, task.getTaskId())
            .eq(AuthorizationTask::getStatus, "RUNNING").eq(AuthorizationTask::getLeaseToken, task.getLeaseToken());
    }

    private void checkedUpdate(AuthorizationTask task, LambdaUpdateWrapper<AuthorizationTask> update) {
        if (tasks.update(null, update.set(AuthorizationTask::getUpdatedAt, System.currentTimeMillis())) != 1) {
            throw new IllegalStateException("Authorization task lease lost");
        }
    }

    private void execute(AuthorizationTask task) {
        LoginInfo previous = CurrentUserHolder.getLoginInfo();
        ScheduledFuture<?> renewal = heartbeat.scheduleAtFixedRate(() -> {
            try { checkedUpdate(task, ownedLease(task).set(AuthorizationTask::getLeaseUntil, System.currentTimeMillis() + LEASE_MS)); }
            catch (RuntimeException exception) { log.warn("授权任务续租失败 taskId={}", task.getTaskId(), exception); }
        }, 10, 10, TimeUnit.SECONDS);
        try {
            if (task.getDataApplied() == 0) {
                loadActor(task);
                checkedUpdate(task, ownedLease(task).set(AuthorizationTask::getPhase, "SAVING")
                    .set(AuthorizationTask::getProgress, 10).set(AuthorizationTask::getMessage, "正在校验并批量保存授权"));
                try (AuthorizationTaskExecution execution = new AuthorizationTaskExecution()) {
                    new TransactionTemplate(transactions).executeWithoutResult(status -> {
                        ResourceMemberSettingQo setting = JSON.parseObject(task.getPayload(), ResourceMemberSettingQo.class);
                        auth.validateAuthorizationTask(setting, "MANAGE".equals(task.getOperation()));
                        if ("MANAGE".equals(task.getOperation())) auth.setResourceManagers(setting);
                        else auth.setResourceUsers(setting);
                        AuthorizationCachePlan plan = execution.plan();
                        String json = JSON.toJSONString(plan);
                        // Fenced outbox update commits atomically with authorization rows. A lost lease rolls everything back.
                        checkedUpdate(task, ownedLease(task).set(AuthorizationTask::getDataApplied, 1)
                            .set(AuthorizationTask::getCachePlan, json).set(AuthorizationTask::getPhase, "SYNCING")
                            .set(AuthorizationTask::getProgress, 60).set(AuthorizationTask::getTotalUsers, plan.getUserIds().size())
                            .set(AuthorizationTask::getMessage, "授权已保存，正在同步生效"));
                        task.setCachePlan(json);
                    });
                }
                task.setDataApplied(1);
            }
            AuthorizationCachePlan plan = JSON.parseObject(task.getCachePlan(), AuthorizationCachePlan.class);
            if (plan == null) throw new IllegalStateException("Authorization cache outbox is missing");
            checkedUpdate(task, ownedLease(task).set(AuthorizationTask::getPhase, "SYNCING").set(AuthorizationTask::getProgress, 60).set(AuthorizationTask::getCompletedUsers, 0));
            reconcileSets(plan);
            int completed = 0;
            List<Long> userIds = new ArrayList<>(plan.getUserIds());
            for (int offset = 0; offset < userIds.size(); offset += 100) {
                List<Long> batch = userIds.subList(offset, Math.min(offset + 100, userIds.size()));
                try (AuthorizationPermissionSnapshot snapshot = new AuthorizationPermissionSnapshot(null, batch, subjects, grants)) {
                    for (Long userId : batch) {
                        redis.syncUserNow(userId);
                        completed++;
                    }
                }
                checkedUpdate(task, ownedLease(task).set(AuthorizationTask::getCompletedUsers, completed)
                    .set(AuthorizationTask::getProgress, 60 + 39 * completed / Math.max(1, userIds.size()))
                    .set(AuthorizationTask::getMessage, "授权已保存，正在同步生效"));
            }
            checkedUpdate(task, ownedLease(task).set(AuthorizationTask::getStatus, "SUCCEEDED")
                .set(AuthorizationTask::getPhase, "DONE").set(AuthorizationTask::getProgress, 100)
                .set(AuthorizationTask::getActiveResource, null).set(AuthorizationTask::getWorkerSlot, null)
                .set(AuthorizationTask::getCachePlan, null).set(AuthorizationTask::getPayload, null)
                .set(AuthorizationTask::getMessage, "授权成功，已同步生效"));
        } catch (Exception exception) {
            // Read the committed checkpoint: a commit callback failure must never cause stale data to be reapplied.
            AuthorizationTask committed = tasks.selectById(task.getTaskId());
            boolean applied = committed != null && Integer.valueOf(1).equals(committed.getDataApplied());
            boolean retry = task.getAttempts() < 3 && !(exception instanceof BaseException);
            String message = applied ? "授权已保存，生效同步失败" : "授权未保存，处理失败";
            if (exception instanceof BaseException) message += "：" + Objects.toString(exception.getMessage(), "权限校验失败");
            message = message.substring(0, Math.min(500, message.length()));
            tasks.update(null, ownedLease(task).set(AuthorizationTask::getStatus, retry ? "RETRYING" : "FAILED")
                .set(AuthorizationTask::getWorkerSlot, null).set(AuthorizationTask::getRetryAt, System.currentTimeMillis() + 5000L * task.getAttempts())
                .set(AuthorizationTask::getMessage, message + (retry ? "，将自动重试" : "，请查看后重试"))
                .set(AuthorizationTask::getUpdatedAt, System.currentTimeMillis()));
            log.error("授权任务失败 taskId={}, dataApplied={}", task.getTaskId(), applied, exception);
        } finally {
            renewal.cancel(false);
            CurrentUserHolder.setLoginInfo(previous);
        }
    }

    /** Reconcile touched pairs against current rows; a delayed retry cannot replay a revoked grant. */
    void reconcileSets(AuthorizationCachePlan plan) {
        Map<String, Set<String>> touched = new LinkedHashMap<>();
        plan.getAdditions().forEach((key, values) -> touched.computeIfAbsent(key, ignored -> new HashSet<>()).addAll(values));
        plan.getRemovals().forEach((key, values) -> touched.computeIfAbsent(key, ignored -> new HashSet<>()).addAll(values));
        Set<Long> resourceIds = new HashSet<>();
        touched.values().forEach(values -> values.forEach(value -> resourceIds.add(Long.valueOf(value.substring(value.lastIndexOf('_') + 1)))));
        Map<String, Set<String>> current = new HashMap<>();
        List<Long> ids = new ArrayList<>(resourceIds);
        for (int offset = 0; offset < ids.size(); offset += 500) {
            for (var grant : grants.selectList(new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant>()
                .in(com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant::getGrantObjId, ids.subList(offset, Math.min(offset + 500, ids.size())))
                .eq(com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant::getStatusCd, "A")
                .in(com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant::getGrantType, "AVAILABLE_USE", "FORCE_USE"))) {
                current.computeIfAbsent(auth.buildPrivilegeGrantKey(grant), ignored -> new HashSet<>()).add(auth.buildPrivilegeGrantValue(grant));
            }
        }
        Map<String, Set<String>> add = new LinkedHashMap<>();
        Map<String, Set<String>> remove = new LinkedHashMap<>();
        touched.forEach((key, values) -> values.forEach(value -> {
            Map<String, Set<String>> target = current.getOrDefault(key, Set.of()).contains(value) ? add : remove;
            target.computeIfAbsent(key, ignored -> new HashSet<>()).add(value);
        }));
        RedisUtil.removeSets(remove);
        RedisUtil.addSets(add);
    }

    private void loadActor(AuthorizationTask task) {
        var user = users.findById(task.getOperatorId());
        Date now = new Date();
        if (user == null || !"A".equals(user.getState()) || "Y".equals(user.getIsLocked())
            || (user.getUserEffDate() != null && user.getUserEffDate().after(now))
            || (user.getUserExpDate() != null && !user.getUserExpDate().after(now))) throw new BaseException("提交人账号已失效");
        if (!Long.valueOf(1).equals(task.getEnterpriseId())
            && memberships.findActiveByUserIdAndEnterpriseId(task.getOperatorId(), task.getEnterpriseId()) == null) {
            throw new BaseException("提交人已不属于该企业");
        }
        LoginInfo login = logins.getLoginInfo(user);
        login.setEnterpriseId(task.getEnterpriseId());
        login.setComAcctId(task.getEnterpriseId());
        CurrentUserHolder.setLoginInfo(login);
    }

    @PreDestroy public void shutdown() { worker.shutdownNow(); heartbeat.shutdownNow(); }
}
