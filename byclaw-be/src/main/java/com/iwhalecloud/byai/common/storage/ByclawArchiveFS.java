package com.iwhalecloud.byai.common.storage;

import java.util.List;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;

@Service
public class ByclawArchiveFS extends ByclawFS implements ArchiveFS {

    public static final String FS_ROOT_PATH = "";

    private static final String SHARE_TYPE_PRIVATE = "private";

    public ByclawArchiveFS(ObjectStorage objectStorage) {
        super(objectStorage);
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
