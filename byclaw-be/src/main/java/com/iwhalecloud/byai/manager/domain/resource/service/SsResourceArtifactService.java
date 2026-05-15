package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceArtifactTypeEnum;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactPathResolver;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceArtifactMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * 资源产物映射服务。
 * @author qin.guoquan
 * @date 2026-05-13 20:52:38
 */
@Service
public class SsResourceArtifactService {

    private static final String STATUS_ACTIVE = "A";

    private static final String STATUS_INVALID = "X";

    @Autowired
    private SsResourceArtifactMapper ssResourceArtifactMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ResourceArtifactPathResolver resourceArtifactPathResolver;

    public void upsertStandardJsonArtifact(Long resourceId, String resourceBizType, String remark) {
        if (resourceId == null || StringUtils.isBlank(resourceBizType)) {
            return;
        }
        String directory = resourceArtifactPathResolver.resolveResourceDirectory(resourceBizType);
        String fileName = resourceArtifactPathResolver.buildResourceJsonFileName(resourceBizType, resourceId);
        upsertArtifact(resourceId, resourceBizType, ResourceArtifactTypeEnum.STANDARD_JSON.name(), "minio",
            directory + "/" + fileName, remark);
    }

    public SsResourceArtifact buildArtifact(String artifactType, String artifactPath, String remark) {
        SsResourceArtifact artifact = new SsResourceArtifact();
        artifact.setArtifactType(artifactType);
        artifact.setArtifactPath(normalizePath(artifactPath));
        artifact.setRemark(remark);
        return artifact;
    }

    public void upsertArtifact(Long resourceId, String resourceBizType, String artifactType, String storageType,
        String artifactPath, String remark) {
        if (resourceId == null || StringUtils.isAnyBlank(resourceBizType, artifactType, storageType, artifactPath)) {
            return;
        }
        String normalizedPath = normalizePath(artifactPath);
        LambdaQueryWrapper<SsResourceArtifact> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceArtifact::getResourceId, resourceId)
            .eq(SsResourceArtifact::getArtifactType, artifactType)
            .eq(SsResourceArtifact::getArtifactPath, normalizedPath)
            .eq(SsResourceArtifact::getStatusCd, STATUS_ACTIVE);
        SsResourceArtifact existing = ssResourceArtifactMapper.selectOne(queryWrapper);
        Date now = new Date();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (existing != null) {
            existing.setResourceBizType(resourceBizType);
            existing.setStorageType(storageType);
            existing.setRemark(remark);
            existing.setUpdateBy(currentUserId);
            existing.setUpdateTime(now);
            ssResourceArtifactMapper.updateById(existing);
            return;
        }

        SsResourceArtifact artifact = new SsResourceArtifact();
        artifact.setArtifactId(sequenceService.nextVal());
        artifact.setResourceId(resourceId);
        artifact.setResourceBizType(resourceBizType);
        artifact.setArtifactType(artifactType);
        artifact.setStorageType(storageType);
        artifact.setArtifactPath(normalizedPath);
        artifact.setStatusCd(STATUS_ACTIVE);
        artifact.setRemark(remark);
        artifact.setCreateBy(currentUserId);
        artifact.setCreateTime(now);
        artifact.setUpdateBy(currentUserId);
        artifact.setUpdateTime(now);
        artifact.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResourceArtifactMapper.insert(artifact);
    }

    public void replaceArtifacts(Long resourceId, String resourceBizType, String storageType,
        List<SsResourceArtifact> artifacts) {
        invalidateArtifactsByResourceId(resourceId);
        if (CollectionUtils.isEmpty(artifacts)) {
            return;
        }
        for (SsResourceArtifact artifact : artifacts) {
            if (artifact == null) {
                continue;
            }
            upsertArtifact(resourceId, resourceBizType, artifact.getArtifactType(), storageType,
                artifact.getArtifactPath(), artifact.getRemark());
        }
    }

    public List<SsResourceArtifact> listActiveArtifactsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResourceArtifact> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceArtifact::getResourceId, resourceId)
            .eq(SsResourceArtifact::getStatusCd, STATUS_ACTIVE);
        return ssResourceArtifactMapper.selectList(queryWrapper);
    }

    public void invalidateArtifactsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        LambdaUpdateWrapper<SsResourceArtifact> updateWrapper = new LambdaUpdateWrapper<>();
        updateWrapper.eq(SsResourceArtifact::getResourceId, resourceId)
            .eq(SsResourceArtifact::getStatusCd, STATUS_ACTIVE)
            .set(SsResourceArtifact::getStatusCd, STATUS_INVALID)
            .set(SsResourceArtifact::getUpdateBy, CurrentUserHolder.getCurrentUserId())
            .set(SsResourceArtifact::getUpdateTime, new Date());
        ssResourceArtifactMapper.update(null, updateWrapper);
    }

    public void removeArtifactsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        LambdaQueryWrapper<SsResourceArtifact> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceArtifact::getResourceId, resourceId);
        ssResourceArtifactMapper.delete(queryWrapper);
    }

    private String normalizePath(String artifactPath) {
        String normalized = StringUtils.trimToEmpty(artifactPath).replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        return normalized;
    }
}
