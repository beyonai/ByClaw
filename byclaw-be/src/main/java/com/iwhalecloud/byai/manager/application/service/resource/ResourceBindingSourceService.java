package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.resource.ResourceBindingSource;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceBindingSourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Source ledger is independent of SkillRelationSource's strict versioned JSON. Caller holds the employee lock. */
@Service
public class ResourceBindingSourceService {
    public static final String SYNC = "THIRD_PARTY_SYNC";
    @Autowired private ResourceBindingSourceMapper mapper;
    @Autowired private SequenceService sequence;
    @Autowired private com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper jobs;

    public List<ResourceBindingSource> sources(Long tenant, Long employee, Long resource) {
        return mapper.selectList(new LambdaQueryWrapper<ResourceBindingSource>()
            .eq(ResourceBindingSource::getComAcctId, tenant)
            .eq(ResourceBindingSource::getDigitalEmployeeId, employee)
            .eq(ResourceBindingSource::getResourceId, resource));
    }

    public List<ResourceBindingSource> automaticSources(Long tenant, Long resource) {
        return mapper.selectList(new LambdaQueryWrapper<ResourceBindingSource>()
            .eq(ResourceBindingSource::getComAcctId, tenant).eq(ResourceBindingSource::getResourceId, resource)
            .eq(ResourceBindingSource::getSourceType, SYNC).eq(ResourceBindingSource::getStatusCd, "A"));
    }

    public boolean hasAutomatic(Long tenant, Long employee, Long resource) {
        return sources(tenant, employee, resource).stream()
            .anyMatch(source -> SYNC.equals(source.getSourceType()) && "A".equals(source.getStatusCd()));
    }

    public boolean hasActive(Long tenant, Long employee, Long resource) {
        return sources(tenant, employee, resource).stream().anyMatch(source -> "A".equals(source.getStatusCd()));
    }

    public void retain(Long tenant, Long employee, Long resource, String type, Long user, Long revision) {
        String key = SYNC.equals(type) ? "USER:" + user : type;
        ResourceBindingSource source = sources(tenant, employee, resource).stream()
            .filter(row -> type.equals(row.getSourceType()) && key.equals(row.getSourceKey())).findFirst().orElse(null);
        boolean insert = source == null;
        if (insert) {
            source = new ResourceBindingSource();
            source.setBindingSourceId(sequence.nextVal());
            source.setComAcctId(tenant);
            source.setDigitalEmployeeId(employee);
            source.setResourceId(resource);
            source.setSourceType(type);
            source.setSourceKey(key);
            source.setSourceUserId(user);
            source.setCreateBy(CurrentUserHolder.getCurrentUserId());
            source.setCreateTime(new Date());
        }
        source.setSyncRevision(revision);
        source.setStatusCd("A");
        source.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        source.setUpdateTime(new Date());
        if (insert) mapper.insert(source); else mapper.updateById(source);
    }

    public void revoke(ResourceBindingSource source) {
        source.setStatusCd("X");
        source.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        source.setUpdateTime(new Date());
        mapper.updateById(source);
    }

    public void markManual(SsResource employee, List<SsResource> resources) {
        if (!"enterprise".equals(employee.getOwnerType())) return;
        for (SsResource resource : resources) {
            // Skills already have manual/group facts in their relation JSON.
            if (!"SKILL".equals(resource.getResourceBizType())
                && com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest.TYPES.contains(resource.getResourceBizType())) {
                retain(employee.getComAcctId(), employee.getResourceId(), resource.getResourceId(), "MANUAL", null, null);
            }
        }
    }

    public void removeManual(Long tenant, Long employee, Long resource) {
        for (ResourceBindingSource source : sources(tenant, employee, resource)) {
            if (!SYNC.equals(source.getSourceType()) && "A".equals(source.getStatusCd())) revoke(source);
        }
    }

    public void clearForDeletedResource(Long resourceId) {
        mapper.update(null, new LambdaUpdateWrapper<ResourceBindingSource>()
            .and(ids -> ids.eq(ResourceBindingSource::getResourceId, resourceId)
                .or().eq(ResourceBindingSource::getDigitalEmployeeId, resourceId))
            .eq(ResourceBindingSource::getStatusCd, "A").set(ResourceBindingSource::getStatusCd, "X")
            .set(ResourceBindingSource::getUpdateTime, new Date()));
        jobs.update(null, new LambdaUpdateWrapper<com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob>()
            .eq(com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob::getResourceId, resourceId)
            .in(com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob::getStatus,
                List.of("PENDING", "RUNNING", "PARTIAL", "FAILED"))
            .set(com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob::getStatus, "SUPERSEDED")
            .set(com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob::getUpdateTime, new Date()));
    }

    /** Explicit full configuration deletion removes all source facts together with the physical relation. */
    public void clear(Long tenant, Long employee, Long resource) {
        mapper.update(null, new LambdaUpdateWrapper<ResourceBindingSource>()
            .eq(ResourceBindingSource::getComAcctId, tenant).eq(ResourceBindingSource::getDigitalEmployeeId, employee)
            .eq(ResourceBindingSource::getResourceId, resource).eq(ResourceBindingSource::getStatusCd, "A")
            .set(ResourceBindingSource::getStatusCd, "X").set(ResourceBindingSource::getUpdateTime, new Date())
            .set(ResourceBindingSource::getUpdateBy, CurrentUserHolder.getCurrentUserId()));
    }
}
