package com.iwhalecloud.byai.state.domain.artifact.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactMapper;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactDataRecordMapper;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactStatus;
import com.iwhalecloud.byai.state.domain.artifact.storage.ArtifactStoragePort;
import java.time.LocalDateTime;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Claims expired artifacts with a conditional update before deleting shared storage content.
 */
@Slf4j
@Service
public class ArtifactCleanupService {

    private final ArtifactMapper artifactMapper;
    private final ArtifactStoragePort storage;
    private final ArtifactDataRecordMapper dataRecordMapper;

    public ArtifactCleanupService(ArtifactMapper artifactMapper, ArtifactStoragePort storage,
        ArtifactDataRecordMapper dataRecordMapper) {
        this.artifactMapper = artifactMapper;
        this.storage = storage;
        this.dataRecordMapper = dataRecordMapper;
    }

    @Async
    public void deleteAsync(String artifactId) {
        ArtifactRecord record = artifactMapper.selectById(artifactId);
        if (record != null && ArtifactStatus.DELETING.name().equals(record.getStatus())) {
            cleanAndMarkDeleted(record);
        }
    }

    @Scheduled(fixedDelayString = "${artifact.cleanup.fixed-delay-ms:3600000}")
    public void cleanExpired() {
        LocalDateTime now = LocalDateTime.now();
        List<ArtifactRecord> expired = artifactMapper.selectList(new LambdaQueryWrapper<ArtifactRecord>()
            .in(ArtifactRecord::getStatus, ArtifactStatus.READY.name(), ArtifactStatus.FAILED.name())
            .le(ArtifactRecord::getExpiresAt, now));
        for (ArtifactRecord record : expired) {
            int claimed = artifactMapper.update(null, new LambdaUpdateWrapper<ArtifactRecord>()
                .eq(ArtifactRecord::getArtifactId, record.getArtifactId())
                .eq(ArtifactRecord::getStatus, record.getStatus())
                .set(ArtifactRecord::getStatus, ArtifactStatus.DELETING.name())
                .set(ArtifactRecord::getUpdateTime, now));
            if (claimed == 1) {
                record.setStatus(ArtifactStatus.DELETING.name());
                cleanAndMarkDeleted(record);
            }
        }

        // A stale DELETING record represents a previous failed cleanup or an interrupted BE instance.
        LocalDateTime retryBefore = now.minusMinutes(10);
        List<ArtifactRecord> staleDeleting = artifactMapper.selectList(new LambdaQueryWrapper<ArtifactRecord>()
            .eq(ArtifactRecord::getStatus, ArtifactStatus.DELETING.name())
            .le(ArtifactRecord::getUpdateTime, retryBefore));
        for (ArtifactRecord record : staleDeleting) {
            int claimed = artifactMapper.update(null, new LambdaUpdateWrapper<ArtifactRecord>()
                .eq(ArtifactRecord::getArtifactId, record.getArtifactId())
                .eq(ArtifactRecord::getStatus, ArtifactStatus.DELETING.name())
                .le(ArtifactRecord::getUpdateTime, retryBefore)
                .set(ArtifactRecord::getUpdateTime, now));
            if (claimed == 1) {
                cleanAndMarkDeleted(record);
            }
        }
    }

    public void cleanStorage(ArtifactRecord record) {
        try {
            storage.deletePrefix(record.getStorageType(), record.getStorageRoot(), record.getStoragePrefix());
        }
        catch (Exception e) {
            log.warn("清理Artifact存储失败, artifactId={}", record.getArtifactId(), e);
        }
    }

    private void cleanAndMarkDeleted(ArtifactRecord record) {
        try {
            storage.deletePrefix(record.getStorageType(), record.getStorageRoot(), record.getStoragePrefix());
            dataRecordMapper.deleteByArtifactId(record.getArtifactId());
            artifactMapper.update(null, new LambdaUpdateWrapper<ArtifactRecord>()
                .eq(ArtifactRecord::getArtifactId, record.getArtifactId())
                .eq(ArtifactRecord::getStatus, ArtifactStatus.DELETING.name())
                .set(ArtifactRecord::getStatus, ArtifactStatus.DELETED.name())
                .set(ArtifactRecord::getUpdateTime, LocalDateTime.now()));
        }
        catch (Exception e) {
            log.error("删除Artifact失败，保留DELETING状态等待下次清理, artifactId={}", record.getArtifactId(), e);
        }
    }
}
