package com.iwhalecloud.byai.common.storage;

import java.util.List;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;

@Service
public class ByclawUserFS extends ByclawFS implements UserFS {

    private static final String FS_ROOT_PATH = "/by";
    private static final String SHARE_TYPE_PRIVATE = "private";

    private UserStorageQuotaApplicationService storageQuotaService;

    public ByclawUserFS(ObjectStorage objectStorage) {
        super(objectStorage);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ByclawUserFS(ObjectStorage objectStorage, UserStorageQuotaApplicationService storageQuotaService) {
        super(objectStorage);
        this.storageQuotaService = storageQuotaService;
    }

    @Override
    protected Object beforeWrite(long size) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (storageQuotaService == null || userId == null) {
            return null;
        }
        storageQuotaService.reserveWrite(userId, size);
        return new WriteReservation(userId, size);
    }

    @Override
    protected void afterWrite(Object reservation, boolean success) {
        if (!(reservation instanceof WriteReservation writeReservation)) {
            return;
        }
        if (success) {
            storageQuotaService.commitWrite(writeReservation.userId(), writeReservation.bytes());
        }
        else {
            storageQuotaService.releaseWrite(writeReservation.userId(), writeReservation.bytes());
        }
    }

    private record WriteReservation(Long userId, long bytes) {
    }

    @Override
    public List<String> list(String filePath, Integer maxDepth) {
        return super.list(filePath, maxDepth == null ? DEFAULT_LIST_DEPTH : maxDepth);
    }

    @Override
    public String getBucketOrRoot() {
        return UserBucketNameResolver.buildUserBucketName(CurrentUserHolder.getCurrentUserCode());
    }

    @Override
    public String getShareType() {
        return SHARE_TYPE_PRIVATE;
    }

    @Override
    public String getFsRootPath() {
        return FS_ROOT_PATH;
    }
}
