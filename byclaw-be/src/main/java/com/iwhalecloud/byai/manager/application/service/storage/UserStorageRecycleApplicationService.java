package com.iwhalecloud.byai.manager.application.service.storage;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageRecycleQuery;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageGrant;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageOperation;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageRecycle;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageGrantMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageOperationMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageQuotaMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageRecycleMapper;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@Service
public class UserStorageRecycleApplicationService {

    private static final String NAMESPACE = "byclaw-fs";
    private static final String SHARE_TYPE = "private";
    private static final String USER_PREFIX = "by";
    private static final String ACTIVE = "ACTIVE";
    private static final String ARCHIVING = "ARCHIVING";
    private static final String AVAILABLE = "AVAILABLE";
    private static final String RESTORING = "RESTORING";
    private static final String RESTORED = "RESTORED";
    private static final String PURGING = "PURGING";
    private static final String PURGED = "PURGED";
    private static final String FAILED = "FAILED";
    private static final Set<String> RECYCLE_STATUSES = Set.of(
        ARCHIVING, AVAILABLE, RESTORING, RESTORED, PURGING, PURGED, FAILED);

    @Autowired
    private UserStorageQuotaApplicationService quotaService;

    @Autowired
    private UserStorageQuotaMapper quotaMapper;

    @Autowired
    private UserStorageRecycleMapper recycleMapper;

    @Autowired
    private UserStorageOperationMapper operationMapper;

    @Autowired
    private UserStorageGrantMapper grantMapper;

    @Autowired
    private ObjectStorage objectStorage;

    @Autowired
    private SequenceService sequenceService;

    public UserStorageRecycle reset(Long userId, String requestId) {
        String normalizedRequestId = StringUtils.defaultIfBlank(requestId, UUID.randomUUID().toString());
        UserStorageRecycle existing = recycleMapper.selectOne(new LambdaQueryWrapper<UserStorageRecycle>()
            .eq(UserStorageRecycle::getRequestId, normalizedRequestId));
        if (existing != null && !FAILED.equals(existing.getRecycleStatus())) {
            return existing;
        }
        UserStorageQuota quota = quotaService.getRequired(userId);
        if (existing == null && (UserStorageQuotaApplicationService.USAGE_RESETTING.equals(quota.getUsageStatus())
            || UserStorageQuotaApplicationService.USAGE_RESTORING.equals(quota.getUsageStatus()))) {
            throw new IllegalStateException("用户存储正在执行还原或恢复");
        }

        Date now = new Date();
        UserStorageRecycle recycle;
        UserStorageOperation operation;
        if (existing == null) {
            recycle = new UserStorageRecycle();
            recycle.setRecycleId(sequenceService.nextVal());
            recycle.setUserId(userId);
            recycle.setSourceBucket(quota.getBucketName());
            recycle.setArchiveBucket(buildArchiveBucket(quota.getBucketName()));
            recycle.setArchivePath(normalizedRequestId);
            recycle.setRequestId(normalizedRequestId);
            recycle.setOperatorId(CurrentUserHolder.getCurrentUserId());
            operation = createOperation(normalizedRequestId, userId, "RESET", "PENDING", quota,
                recycle.getRecycleId());
        }
        else {
            recycle = existing;
            operation = operationMapper.selectOne(new LambdaQueryWrapper<UserStorageOperation>()
                .eq(UserStorageOperation::getRequestId, normalizedRequestId));
            if (operation == null) {
                operation = createOperation(normalizedRequestId, userId, "RESET", "PENDING", quota,
                    recycle.getRecycleId());
            }
            else {
                operation.setOperationStatus("PENDING");
                operation.setErrorMessage(null);
                operation.setFinishTime(null);
                operationMapper.updateById(operation);
            }
        }
        recycle.setArchiveBytes(0L);
        recycle.setRecycleStatus(ARCHIVING);
        recycle.setRetentionUntil(new Date(now.getTime() + Math.max(1, quotaService.getRecycleRetentionDays()) * 86400000L));
        recycle.setStartedTime(now);
        recycle.setFinishedTime(null);
        recycle.setErrorMessage(null);
        if (existing == null) {
            recycleMapper.insert(recycle);
        }
        else {
            recycleMapper.updateById(recycle);
        }

        quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_RESETTING);
        quota.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        quota.setUpdateTime(now);
        quotaMapper.updateById(quota);

        try {
            long archivedBytes = archiveOnlineSpace(quota, recycle);
            revokeActiveGrants(userId, now);
            quota.setBaseQuotaBytes(quotaService.getDefaultQuotaBytes());
            quota.setAddonQuotaBytes(0L);
            quota.setTotalQuotaBytes(quotaService.getDefaultQuotaBytes());
            quota.setUsedBytes(0L);
            quota.setReservedBytes(0L);
            quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_NORMAL);
            quota.setProvisionStatus(UserStorageQuotaApplicationService.PROVISION_READY);
            quota.setQuotaSyncStatus("PENDING");
            quota.setLastError(null);
            quota.setUpdateTime(new Date());
            quotaMapper.updateById(quota);

            recycle.setArchiveBytes(archivedBytes);
            recycle.setRecycleStatus(AVAILABLE);
            recycle.setFinishedTime(new Date());
            recycleMapper.updateById(recycle);
            finishOperation(operation, quota, archivedBytes);
            return recycle;
        }
        catch (Exception e) {
            recycle.setRecycleStatus(FAILED);
            recycle.setErrorMessage(e.getMessage());
            recycle.setFinishedTime(new Date());
            recycleMapper.updateById(recycle);
            operation.setOperationStatus("FAILED");
            operation.setErrorMessage(e.getMessage());
            operation.setFinishTime(new Date());
            operationMapper.updateById(operation);
            quota.setLastError(e.getMessage());
            quotaMapper.updateById(quota);
            throw new IllegalStateException("初始化还原失败，数据未删除", e);
        }
    }

    /**
     * Archives all online files after a quota downgrade grace period. Unlike reset, this operation keeps every
     * remaining active add-on and the already recalculated target quota unchanged.
     */
    public UserStorageRecycle archiveForDowngrade(Long userId, String requestId) {
        String normalizedRequestId = StringUtils.defaultIfBlank(requestId,
            "DOWNGRADE-ARCHIVE-" + UUID.randomUUID());
        UserStorageRecycle existing = recycleMapper.selectOne(new LambdaQueryWrapper<UserStorageRecycle>()
            .eq(UserStorageRecycle::getRequestId, normalizedRequestId));
        if (existing != null && !FAILED.equals(existing.getRecycleStatus())) {
            return existing;
        }
        UserStorageQuota quota = quotaService.getRequired(userId);
        if (existing == null && (UserStorageQuotaApplicationService.USAGE_RESETTING.equals(quota.getUsageStatus())
            || UserStorageQuotaApplicationService.USAGE_RESTORING.equals(quota.getUsageStatus()))) {
            throw new IllegalStateException("用户存储正在执行还原、恢复或降级归档");
        }

        long originalUsedBytes = quota.getUsedBytes() == null ? 0L : quota.getUsedBytes();
        Date now = new Date();
        UserStorageRecycle recycle;
        UserStorageOperation operation;
        if (existing == null) {
            recycle = new UserStorageRecycle();
            recycle.setRecycleId(sequenceService.nextVal());
            recycle.setUserId(userId);
            recycle.setSourceBucket(quota.getBucketName());
            recycle.setArchiveBucket(buildArchiveBucket(quota.getBucketName()));
            recycle.setArchivePath(normalizedRequestId);
            recycle.setRequestId(normalizedRequestId);
            recycle.setOperatorId(CurrentUserHolder.getCurrentUserId());
            operation = createOperation(normalizedRequestId, userId, "DOWNGRADE_ARCHIVE", "PENDING", quota,
                recycle.getRecycleId());
        }
        else {
            recycle = existing;
            operation = operationMapper.selectOne(new LambdaQueryWrapper<UserStorageOperation>()
                .eq(UserStorageOperation::getRequestId, normalizedRequestId));
            if (operation == null) {
                operation = createOperation(normalizedRequestId, userId, "DOWNGRADE_ARCHIVE", "PENDING", quota,
                    recycle.getRecycleId());
            }
            else {
                operation.setOperationStatus("PENDING");
                operation.setErrorMessage(null);
                operation.setFinishTime(null);
                operationMapper.updateById(operation);
            }
        }
        recycle.setArchiveBytes(0L);
        recycle.setRecycleStatus(ARCHIVING);
        recycle.setRetentionUntil(new Date(now.getTime()
            + Math.max(1, quotaService.getRecycleRetentionDays()) * 86400000L));
        recycle.setStartedTime(now);
        recycle.setFinishedTime(null);
        recycle.setErrorMessage(null);
        if (existing == null) {
            recycleMapper.insert(recycle);
        }
        else {
            recycleMapper.updateById(recycle);
        }

        quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_RESETTING);
        quota.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        quota.setUpdateTime(now);
        quotaMapper.updateById(quota);

        try {
            long archivedBytes = archiveOnlineSpace(quota, recycle);
            quota.setUsedBytes(0L);
            quota.setReservedBytes(0L);
            quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_NORMAL);
            quota.setProvisionStatus(UserStorageQuotaApplicationService.PROVISION_READY);
            quota.setQuotaSyncStatus("PENDING");
            quota.setLastError(null);
            quota.setUpdateTime(new Date());
            quotaMapper.updateById(quota);

            recycle.setArchiveBytes(archivedBytes);
            recycle.setRecycleStatus(AVAILABLE);
            recycle.setFinishedTime(new Date());
            recycleMapper.updateById(recycle);
            finishOperation(operation, quota, archivedBytes);
            return recycle;
        }
        catch (Exception e) {
            recycle.setRecycleStatus(FAILED);
            recycle.setErrorMessage(e.getMessage());
            recycle.setFinishedTime(new Date());
            recycleMapper.updateById(recycle);
            operation.setOperationStatus("FAILED");
            operation.setErrorMessage(e.getMessage());
            operation.setFinishTime(new Date());
            operationMapper.updateById(operation);
            quota.setUsageStatus(resolveStatus(quota.getTotalQuotaBytes(), originalUsedBytes));
            quota.setLastError(e.getMessage());
            quota.setUpdateTime(new Date());
            quotaMapper.updateById(quota);
            throw new IllegalStateException("降级归档失败，在线数据未删除", e);
        }
    }

    public UserStorageRecycle restore(Long userId, Long recycleId) {
        UserStorageRecycle recycle = recycleMapper.selectById(recycleId);
        if (recycle == null || !AVAILABLE.equals(recycle.getRecycleStatus())
            || !userId.equals(recycle.getUserId())) {
            throw new IllegalArgumentException("可恢复的回收站记录不存在");
        }
        UserStorageQuota quota = quotaService.getRequired(userId);
        if (quota.getTotalQuotaBytes() < recycle.getArchiveBytes()) {
            throw new IllegalStateException("当前用户容量不足以恢复回收站数据");
        }
        String operationRequestId = "RESTORE-" + recycle.getRecycleId();
        UserStorageOperation operation = operationMapper.selectOne(new LambdaQueryWrapper<UserStorageOperation>()
            .eq(UserStorageOperation::getRequestId, operationRequestId));
        if (operation == null) {
            operation = createOperation(operationRequestId, userId, "RESTORE", "PENDING", quota,
                recycle.getRecycleId());
        }
        recycle.setRecycleStatus(RESTORING);
        recycleMapper.updateById(recycle);
        quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_RESTORING);
        quotaMapper.updateById(quota);
        try {
            StoragePrefix archivePrefix = StoragePrefix.of(NAMESPACE, recycle.getArchiveBucket(),
                recycle.getArchivePath(), SHARE_TYPE);
            objectStorage.init(quota.getBucketName());
            for (StorageObject object : objectStorage.list(archivePrefix, null)) {
                if (object == null || object.isDir()) {
                    continue;
                }
                String relativePath = removeArchivePrefix(object.getPath(), recycle.getArchivePath());
                objectStorage.copy(StorageLocation.of(NAMESPACE, recycle.getArchiveBucket(), object.getPath(), SHARE_TYPE),
                    StorageLocation.of(NAMESPACE, quota.getBucketName(), relativePath, SHARE_TYPE));
            }
            objectStorage.deletePrefix(archivePrefix);
            recycle.setRecycleStatus(RESTORED);
            recycle.setFinishedTime(new Date());
            recycleMapper.updateById(recycle);
            quota.setUsedBytes(recycle.getArchiveBytes());
            quota.setReservedBytes(0L);
            quota.setUsageStatus(resolveStatus(quota.getTotalQuotaBytes(), recycle.getArchiveBytes()));
            quota.setQuotaSyncStatus("PENDING");
            quota.setUpdateTime(new Date());
            quotaMapper.updateById(quota);
            operation.setOperationStatus("SUCCESS");
            operation.setAfterQuota(quota.getTotalQuotaBytes());
            operation.setAfterUsed(recycle.getArchiveBytes());
            operation.setFinishTime(new Date());
            operationMapper.updateById(operation);
            return recycle;
        }
        catch (Exception e) {
            recycle.setRecycleStatus(FAILED);
            recycle.setErrorMessage(e.getMessage());
            recycleMapper.updateById(recycle);
            quota.setLastError(e.getMessage());
            quotaMapper.updateById(quota);
            operation.setOperationStatus("FAILED");
            operation.setErrorMessage(e.getMessage());
            operation.setFinishTime(new Date());
            operationMapper.updateById(operation);
            throw new IllegalStateException("回收站恢复失败，归档数据仍保留", e);
        }
    }

    public List<UserStorageRecycle> listByUser(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("用户标识不能为空");
        }
        return recycleMapper.selectList(new LambdaQueryWrapper<UserStorageRecycle>()
            .eq(UserStorageRecycle::getUserId, userId)
            .orderByDesc(UserStorageRecycle::getRecycleId));
    }

    public Page<UserStorageRecycle> listByUserPage(UserStorageRecycleQuery request) {
        UserStorageRecycleQuery query = normalizeRecycleQuery(request);
        LambdaQueryWrapper<UserStorageRecycle> wrapper = new LambdaQueryWrapper<UserStorageRecycle>()
            .eq(UserStorageRecycle::getUserId, query.getUserId())
            .eq(query.getRecycleStatus() != null, UserStorageRecycle::getRecycleStatus,
                query.getRecycleStatus())
            .ge(query.getCreatedStart() != null, UserStorageRecycle::getStartedTime,
                query.getCreatedStart())
            .le(query.getCreatedEnd() != null, UserStorageRecycle::getStartedTime,
                query.getCreatedEnd())
            .ge(query.getExpiredStart() != null, UserStorageRecycle::getRetentionUntil,
                query.getExpiredStart())
            .le(query.getExpiredEnd() != null, UserStorageRecycle::getRetentionUntil,
                query.getExpiredEnd())
            .orderByDesc(UserStorageRecycle::getStartedTime)
            .orderByDesc(UserStorageRecycle::getRecycleId);
        return recycleMapper.selectPage(new Page<>(query.getPageNum(), query.getPageSize()), wrapper);
    }

    private UserStorageRecycleQuery normalizeRecycleQuery(UserStorageRecycleQuery request) {
        UserStorageRecycleQuery query = request == null ? new UserStorageRecycleQuery() : request;
        if (query.getUserId() == null) {
            throw new IllegalArgumentException("用户标识不能为空");
        }
        query.setPageNum(query.getPageNum() == null || query.getPageNum() < 1 ? 1 : query.getPageNum());
        query.setPageSize(query.getPageSize() == null || query.getPageSize() < 1
            ? 10 : Math.min(query.getPageSize(), 200));
        String recycleStatus = StringUtils.upperCase(StringUtils.trimToNull(query.getRecycleStatus()), Locale.ROOT);
        if (recycleStatus != null && !RECYCLE_STATUSES.contains(recycleStatus)) {
            throw new IllegalArgumentException("不支持的临时回收站状态: " + recycleStatus);
        }
        query.setRecycleStatus(recycleStatus);
        validateTimeRange(query.getCreatedStart(), query.getCreatedEnd(), "创建时间");
        validateTimeRange(query.getExpiredStart(), query.getExpiredEnd(), "过期时间");
        return query;
    }

    private void validateTimeRange(Date start, Date end, String fieldName) {
        if (start != null && end != null && start.after(end)) {
            throw new IllegalArgumentException(fieldName + "开始时间不能晚于结束时间");
        }
    }

    /**
     * Lists one directory from an available recycle archive for the read-only admin file browser.
     */
    public List<FileBrowserItemVo> listPreviewFiles(Long userId, Long recycleId, String path) {
        UserStorageRecycle recycle = getPreviewableRecycle(userId, recycleId);
        String archiveRoot = buildPreviewArchiveRoot(recycle);
        String directoryPath = normalizePreviewPath(path, true);
        String absoluteDirectory = archiveRoot + directoryPath;
        StoragePrefix prefix = StoragePrefix.of(NAMESPACE, recycle.getArchiveBucket(), absoluteDirectory,
            SHARE_TYPE, false);
        List<FileBrowserItemVo> items = new ArrayList<>();
        for (StorageObject object : objectStorage.list(prefix, null)) {
            FileBrowserItemVo item = toPreviewItem(object, archiveRoot);
            if (item != null) {
                items.add(item);
            }
        }
        return items;
    }

    /**
     * Opens one archived file for the read-only admin preview. No write operation is exposed.
     */
    public InputStream downloadPreviewFile(Long userId, Long recycleId, String path) {
        UserStorageRecycle recycle = getPreviewableRecycle(userId, recycleId);
        String archiveRoot = buildPreviewArchiveRoot(recycle);
        String filePath = normalizePreviewPath(path, false);
        StorageLocation location = StorageLocation.of(NAMESPACE, recycle.getArchiveBucket(),
            archiveRoot + filePath, SHARE_TYPE);
        if (!objectStorage.exists(location)) {
            throw new IllegalArgumentException("回收站预览文件不存在");
        }
        return objectStorage.get(location);
    }

    public int purgeExpired() {
        List<UserStorageRecycle> records = recycleMapper.selectList(new LambdaQueryWrapper<UserStorageRecycle>()
            .eq(UserStorageRecycle::getRecycleStatus, AVAILABLE)
            .le(UserStorageRecycle::getRetentionUntil, new Date())
            .last("LIMIT 100"));
        int count = 0;
        for (UserStorageRecycle recycle : records) {
            String requestId = "PURGE-" + recycle.getRecycleId();
            UserStorageOperation operation = operationMapper.selectOne(new LambdaQueryWrapper<UserStorageOperation>()
                .eq(UserStorageOperation::getRequestId, requestId));
            try {
                if (operation == null) {
                    operation = createOperation(requestId, recycle.getUserId(), "PURGE", "PENDING",
                        quotaService.getRequired(recycle.getUserId()), recycle.getRecycleId());
                }
                recycle.setRecycleStatus(PURGING);
                recycleMapper.updateById(recycle);
                objectStorage.deletePrefix(StoragePrefix.of(NAMESPACE, recycle.getArchiveBucket(),
                    recycle.getArchivePath(), SHARE_TYPE));
                recycle.setRecycleStatus(PURGED);
                recycle.setFinishedTime(new Date());
                recycleMapper.updateById(recycle);
                operation.setOperationStatus("SUCCESS");
                operation.setFinishTime(new Date());
                operationMapper.updateById(operation);
                count++;
            }
            catch (Exception e) {
                recycle.setRecycleStatus(FAILED);
                recycle.setErrorMessage(e.getMessage());
                recycleMapper.updateById(recycle);
                if (operation != null) {
                    operation.setOperationStatus("FAILED");
                    operation.setErrorMessage(e.getMessage());
                    operation.setFinishTime(new Date());
                    operationMapper.updateById(operation);
                }
            }
        }
        return count;
    }

    private long archiveOnlineSpace(UserStorageQuota quota, UserStorageRecycle recycle) {
        objectStorage.init(recycle.getArchiveBucket());
        StoragePrefix sourcePrefix = StoragePrefix.of(NAMESPACE, quota.getBucketName(), USER_PREFIX, SHARE_TYPE);
        StoragePrefix archivePrefix = StoragePrefix.of(NAMESPACE, recycle.getArchiveBucket(), recycle.getArchivePath(), SHARE_TYPE);
        long bytes = 0L;
        List<StorageObject> objects = objectStorage.list(sourcePrefix, null);
        for (StorageObject object : objects) {
            if (object == null || object.isDir()) {
                continue;
            }
            String targetPath = recycle.getArchivePath() + "/" + object.getPath();
            objectStorage.copy(StorageLocation.of(NAMESPACE, quota.getBucketName(), object.getPath(), SHARE_TYPE),
                StorageLocation.of(NAMESPACE, recycle.getArchiveBucket(), targetPath, SHARE_TYPE));
            bytes += object.getSize() == null ? 0L : object.getSize();
        }
        objectStorage.deletePrefix(sourcePrefix);
        return bytes;
    }

    private void revokeActiveGrants(Long userId, Date now) {
        List<UserStorageGrant> grants = grantMapper.selectList(new LambdaQueryWrapper<UserStorageGrant>()
            .eq(UserStorageGrant::getUserId, userId).eq(UserStorageGrant::getGrantStatus, ACTIVE));
        for (UserStorageGrant grant : grants) {
            grant.setGrantStatus(UserStorageQuotaApplicationService.GRANT_REVOKED);
            grant.setRevokedBy(CurrentUserHolder.getCurrentUserId());
            grant.setRevokedTime(now);
            grantMapper.updateById(grant);
        }
    }

    private UserStorageOperation createOperation(String requestId, Long userId, String type, String status,
        UserStorageQuota quota, Long recycleId) {
        UserStorageOperation operation = new UserStorageOperation();
        operation.setOperationId(sequenceService.nextVal());
        operation.setRequestId(requestId);
        operation.setUserId(userId);
        operation.setOperationType(type);
        operation.setOperationStatus(status);
        operation.setOperatorId(CurrentUserHolder.getCurrentUserId());
        operation.setBeforeQuota(quota.getTotalQuotaBytes());
        operation.setBeforeUsed(quota.getUsedBytes());
        operation.setRelatedRecycleId(recycleId);
        operation.setCreateTime(new Date());
        operationMapper.insert(operation);
        return operation;
    }

    private void finishOperation(UserStorageOperation operation, UserStorageQuota quota, long archivedBytes) {
        operation.setOperationStatus("SUCCESS");
        operation.setAfterQuota(quota.getTotalQuotaBytes());
        operation.setAfterUsed(0L);
        operation.setErrorMessage("archivedBytes=" + archivedBytes);
        operation.setFinishTime(new Date());
        operationMapper.updateById(operation);
    }

    private String buildArchiveBucket(String sourceBucket) {
        String value = StringUtils.defaultString(sourceBucket, "user") + "-recycle";
        return value.length() <= 63 ? value : value.substring(0, 63).replaceAll("-+$", "");
    }

    private UserStorageRecycle getPreviewableRecycle(Long userId, Long recycleId) {
        if (userId == null || recycleId == null) {
            throw new IllegalArgumentException("用户标识和回收站标识不能为空");
        }
        UserStorageRecycle recycle = recycleMapper.selectById(recycleId);
        if (recycle == null || !userId.equals(recycle.getUserId())
            || !AVAILABLE.equals(recycle.getRecycleStatus())) {
            throw new IllegalArgumentException("可预览的回收站记录不存在");
        }
        if (StringUtils.isBlank(recycle.getArchiveBucket())) {
            throw new IllegalStateException("回收站归档位置无效");
        }
        return recycle;
    }

    private String buildPreviewArchiveRoot(UserStorageRecycle recycle) {
        String archivePath = normalizeArchivePath(recycle.getArchivePath());
        return archivePath + "/" + USER_PREFIX;
    }

    private String normalizeArchivePath(String path) {
        if (StringUtils.isBlank(path) || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) {
            throw new IllegalStateException("回收站归档路径无效");
        }
        String normalized = path.trim().replaceAll("/+", "/");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        validatePathSegments(normalized, "回收站归档路径无效");
        return normalized;
    }

    private String normalizePreviewPath(String path, boolean directory) {
        String value = StringUtils.defaultIfBlank(path, "/").trim();
        if (value.indexOf('\\') >= 0 || value.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("回收站预览路径无效");
        }
        String normalized = value.replaceAll("/+", "/");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (StringUtils.isBlank(normalized)) {
            if (directory) {
                return "/";
            }
            throw new IllegalArgumentException("预览文件路径不能为空");
        }
        validatePathSegments(normalized, "回收站预览路径无效");
        return "/" + normalized + (directory ? "/" : "");
    }

    private void validatePathSegments(String path, String message) {
        if (StringUtils.isBlank(path)) {
            throw new IllegalStateException(message);
        }
        for (String segment : path.split("/")) {
            if (StringUtils.isBlank(segment) || ".".equals(segment) || "..".equals(segment)) {
                throw new IllegalArgumentException(message);
            }
        }
    }

    private FileBrowserItemVo toPreviewItem(StorageObject object, String archiveRoot) {
        if (object == null || StringUtils.isBlank(object.getPath())) {
            return null;
        }
        String objectPath = object.getPath().replace('\\', '/').replaceAll("/+", "/");
        while (objectPath.startsWith("/")) {
            objectPath = objectPath.substring(1);
        }
        String requiredPrefix = archiveRoot + "/";
        if (!objectPath.startsWith(requiredPrefix)) {
            return null;
        }
        String relativePath = objectPath.substring(requiredPrefix.length());
        boolean directory = object.isDir() || relativePath.endsWith("/");
        while (relativePath.endsWith("/")) {
            relativePath = relativePath.substring(0, relativePath.length() - 1);
        }
        if (StringUtils.isBlank(relativePath)) {
            return null;
        }
        validatePathSegments(relativePath, "回收站归档对象路径无效");
        String[] segments = relativePath.split("/");
        FileBrowserItemVo item = new FileBrowserItemVo();
        item.setName(segments[segments.length - 1]);
        item.setPath("/" + relativePath + (directory ? "/" : ""));
        item.setDir(directory);
        item.setSize(directory ? null : object.getSize());
        item.setLastModified(object.getLastModified());
        return item;
    }

    private String removeArchivePrefix(String path, String archivePath) {
        String prefix = archivePath + "/";
        return path != null && path.startsWith(prefix) ? path.substring(prefix.length()) : path;
    }

    private String resolveStatus(long total, long used) {
        if (used >= total) {
            return UserStorageQuotaApplicationService.USAGE_EXCEEDED;
        }
        return used * 100L >= total * quotaService.getWarningPercent()
            ? UserStorageQuotaApplicationService.USAGE_WARNING
            : UserStorageQuotaApplicationService.USAGE_NORMAL;
    }
}
