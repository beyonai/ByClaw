package com.iwhalecloud.byai.common.storage;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class ByclawResourceFS extends ByclawFS implements ResourceFS {

    private static final Logger LOGGER = LoggerFactory.getLogger(ByclawResourceFS.class);

    private static final String SHARE_TYPE_PUBLIC = "public";
    private static final List<String> RESOURCE_BUCKETS = List.of("byclaw", "byclaw-datacloud", "byclaw-qa");

    public ByclawResourceFS(ObjectStorage objectStorage) {
        super(objectStorage);
    }

    @Override
    public List<String> list(String filePath, Integer maxDepth) {
        return super.list(filePath, maxDepth == null ? DEFAULT_LIST_DEPTH : maxDepth);
    }

    @Override
    public void init() {
        RESOURCE_BUCKETS.forEach(bucket -> {
            try {
                initBucket(bucket);
                mountBucket(bucket);
            }
            catch (Exception e) {
                LOGGER.error("公共bucket初始化失败，继续处理后续bucket, bucket={}", bucket, e);
            }
        });
    }

    @Override
    public String getBucketOrRoot() {
        return "byclaw";
    }

    @Override
    public String getShareType() {
        return SHARE_TYPE_PUBLIC;
    }

    @Override
    public String getFsRootPath() {
        return "";
    }
}
