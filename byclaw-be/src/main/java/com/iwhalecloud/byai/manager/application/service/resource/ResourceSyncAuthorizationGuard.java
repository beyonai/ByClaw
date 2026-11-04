package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.AuthorizationSubjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import java.util.List;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Pending replacements may restrict existing grants but never grant early access. */
@Component
public class ResourceSyncAuthorizationGuard {
    @Autowired private ResourceSyncJobMapper jobs;
    @Autowired private AuthorizationSubjectMapper subjects;
    private static final ThreadLocal<Long> APPLIED = new ThreadLocal<>();

    public static void knownApplied(Long id, Runnable action) {
        Long previous = APPLIED.get();
        APPLIED.set(id);
        try { action.run(); }
        finally { if (previous == null) APPLIED.remove(); else APPLIED.set(previous); }
    }

    public boolean allows(SsResource resource, Long userId, boolean view) {
        if (resource.getThirdSyncRevision() == null || resource.getThirdSyncRevision() == 0
            || Objects.equals(APPLIED.get(), resource.getResourceId())) return true;
        var job = jobs.latest(resource.getResourceId());
        if (job == null || job.getAuthorizationIntent() == null) return true;
        var result = job.getResultSummary() == null ? new com.alibaba.fastjson.JSONObject() : JSON.parseObject(job.getResultSummary());
        if (result.getBooleanValue("authorizationApplied")) return true;
        var intent = JSON.parseObject(job.getAuthorizationIntent());
        if (view ? !intent.containsKey("viewAuth") : !intent.getBooleanValue("autoAuthorize")) return true;
        if (view && !intent.getBooleanValue("viewAuth")) return false;
        var scope = EnterpriseResourceSyncService.scope(intent.getJSONObject(view ? "viewScope" : "useScope"));
        if (scope == null || userId == null) return false;
        if (scope.userIds().contains(userId)) return true;
        for (var row : subjects.memberships(List.of(userId))) {
            if ("POST".equals(row.getSubjectType()) && scope.postIds().contains(row.getSubjectId())) return true;
            if ("ORG".equals(row.getSubjectType())) {
                if (scope.orgIds().contains(row.getSubjectId())) return true;
                if (row.getSubjectPath() != null) for (String part : row.getSubjectPath().split("\\.")) {
                    if (!part.isBlank() && scope.orgIds().contains(Long.valueOf(part))) return true;
                }
            }
        }
        return false;
    }

    /** Must run in the grant/submission transaction. Existing queued manual work is allowed to finish first. */
    public void beforeManualWrite(Long resourceId, boolean existingTask) {
        jobs.lockResource(resourceId);
        if (existingTask) return;
        var job = jobs.latest(resourceId);
        if (job != null && !List.of("COMPLETED", "SUPERSEDED").contains(job.publicStatus())) {
            throw new com.iwhalecloud.byai.common.exception.BaseException("该资源正在同步授权，请查看同步进度后重试");
        }
    }
}
