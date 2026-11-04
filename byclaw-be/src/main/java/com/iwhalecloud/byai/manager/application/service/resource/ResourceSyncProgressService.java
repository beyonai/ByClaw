package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** The API and existing resource views share one persistent progress contract. */
@Service
public class ResourceSyncProgressService {
    @Autowired private ResourceSyncJobMapper jobs;
    @Autowired private SsResourceService resources;
    @Autowired private AuthApplicationService auth;
    @Autowired private ResourceSyncDispatcher dispatcher;

    public Map<String, Object> query(Long jobId) {
        ResourceSyncJob job = jobs.selectById(jobId);
        if (job == null) throw new IllegalArgumentException("同步任务不存在或无权查看");
        SsResource resource = resources.findById(job.getResourceId());
        if (!visible(job, resource)) throw new IllegalArgumentException("同步任务不存在或无权查看");
        return response(job, resource);
    }

    public List<Map<String, Object>> queryBatch(List<Long> resourceIds) {
        if (resourceIds == null || resourceIds.size() > 100 || resourceIds.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("请提供不超过 100 个资源编号");
        }
        if (resourceIds.isEmpty()) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (ResourceSyncJob job : jobs.latestBatch(resourceIds.stream().distinct().toList())) {
            SsResource resource = resources.findById(job.getResourceId());
            if (visible(job, resource)) result.add(response(job, resource));
        }
        return result;
    }

    private boolean manager(ResourceSyncJob job, SsResource resource) {
        if (resource == null || CurrentUserHolder.getCurrentUserId() == null) return false;
        return auth.hasResourceManagePermission(resource)
            || Objects.equals(job.getOperatorUserId(), CurrentUserHolder.getCurrentUserId()) && auth.isCurrentUserGlobalResourceManager();
    }

    private boolean visible(ResourceSyncJob job, SsResource resource) {
        return resource != null && !Objects.equals(resource.getResourceStatus(), -1)
            && CurrentUserHolder.getCurrentUserId() != null && (manager(job, resource) || auth.hasResourceViewPermission(resource));
    }

    private Map<String, Object> response(ResourceSyncJob job, SsResource resource) {
        Map<String, Object> response = job.associationResult();
        boolean canManage = manager(job, resource);
        response.put("canRetry", canManage && List.of("FAILED", "PARTIAL").contains(job.publicStatus())
            && Objects.equals(job.getSyncRevision(), resource.getThirdSyncRevision()));
        if (!canManage) {
            // A normal reader sees lifecycle state, never the other recipients or their aggregate scope.
            var visible = new LinkedHashMap<String, Object>();
            var result = (Map<?, ?>) response.get("result");
            if (result.containsKey("phase")) visible.put("phase", result.get("phase"));
            visible.put("message", switch (job.publicStatus()) {
                case "COMPLETED" -> "资源同步处理已结束";
                case "FAILED", "PARTIAL" -> "资源同步暂未完成，请稍后刷新或联系管理员";
                case "SUPERSEDED" -> "已有新的同步任务，请刷新进度";
                default -> "资源授权或配置正在更新，请稍后刷新";
            });
            response.put("result", visible);
        }
        return response;
    }

    public Map<String, Object> retry(Long jobId) {
        ResourceSyncJob job = jobs.selectById(jobId);
        SsResource resource = job == null ? null : resources.findById(job.getResourceId());
        if (job == null || !manager(job, resource)) throw new IllegalArgumentException("无权重试该任务");
        if (!Objects.equals(job.getSyncRevision(), resource.getThirdSyncRevision())) throw new IllegalArgumentException("已有更新的同步任务，请刷新进度");
        if (!List.of("FAILED", "PARTIAL").contains(job.publicStatus())) return response(job, resource);
        jobs.update(null, new LambdaUpdateWrapper<ResourceSyncJob>().eq(ResourceSyncJob::getSyncJobId, jobId)
            .eq(ResourceSyncJob::getStatus, job.getStatus()).eq(ResourceSyncJob::getRetryCount, job.getRetryCount())
            .set(ResourceSyncJob::getStatus, ResourceSyncJob.PENDING)
            .set(ResourceSyncJob::getRetryLimit, job.getRetryCount() + 8)
            .set(ResourceSyncJob::getNextRetryTime, new Date()).set(ResourceSyncJob::getUpdateTime, new Date()));
        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
            new org.springframework.transaction.support.TransactionSynchronization() {
                @Override public void afterCommit() { dispatcher.dispatch(jobId); }
            });
        return response(jobs.selectById(jobId), resource);
    }
}
