package com.iwhalecloud.byai.common.storage;

import java.util.List;

import org.springframework.stereotype.Service;

@Service
public class ByclawKnowledgeResourceFS extends ByclawFS implements KnowledgeResourceFS {

    private static final String BUCKET_NAME = "byclaw-qa";

    private static final String SHARE_TYPE_PRIVATE = "private";

    public ByclawKnowledgeResourceFS(ObjectStorage objectStorage) {
        super(objectStorage);
    }

    @Override
    public List<String> list(String filePath, Integer maxDepth) {
        return super.list(filePath, maxDepth == null ? DEFAULT_LIST_DEPTH : maxDepth);
    }

    @Override
    public void init() {
        initBucket(BUCKET_NAME);
        mountBucket(BUCKET_NAME);
    }

    @Override
    public String getBucketOrRoot() {
        return BUCKET_NAME;
    }

    @Override
    public String getShareType() {
        return SHARE_TYPE_PRIVATE;
    }

    @Override
    public String getFsRootPath() {
        return "";
    }
}
