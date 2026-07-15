package com.iwhalecloud.byai.manager.application.service.storage;

import java.util.Date;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageQuotaMapper;

@Service
public class UserStorageUsageScanner {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserStorageUsageScanner.class);
    private static final String STORAGE_NAMESPACE = "byclaw-fs";
    private static final String STORAGE_SHARE_TYPE = "private";
    private static final String USER_ROOT = "by";

    @Autowired
    private UserStorageQuotaMapper quotaMapper;

    @Autowired
    private ObjectStorage objectStorage;

    @Autowired
    private UserStorageQuotaApplicationService quotaService;

    public int scanAll(int pageSize) {
        int pageLimit = Math.max(1, pageSize);
        int scanned = 0;
        long lastId = 0L;
        while (true) {
            List<UserStorageQuota> page = quotaMapper.selectScanPage(lastId, pageLimit);
            if (page == null || page.isEmpty()) {
                return scanned;
            }
            for (UserStorageQuota quota : page) {
                lastId = quota.getStorageQuotaId();
                scanOne(quota);
                scanned++;
            }
            if (page.size() < pageLimit) {
                return scanned;
            }
        }
    }

    public long scanOne(UserStorageQuota quota) {
        if (quota == null || quota.getBucketName() == null) {
            return 0L;
        }
        try {
            long bytes = objectStorage.list(StoragePrefix.of(STORAGE_NAMESPACE, quota.getBucketName(), USER_ROOT,
                STORAGE_SHARE_TYPE), null).stream()
                .filter(item -> item != null && !item.isDir())
                .map(StorageObject::getSize)
                .filter(size -> size != null && size > 0)
                .mapToLong(Long::longValue)
                .sum();
            quotaService.recordUsage(quota, bytes, new Date());
            return bytes;
        }
        catch (Exception e) {
            LOGGER.warn("扫描用户存储空间失败, userId={}, bucket={}", quota.getUserId(), quota.getBucketName(), e);
            quotaMapper.updateScanError(quota.getStorageQuotaId(), new Date(), e.getMessage());
            return -1L;
        }
    }
}
