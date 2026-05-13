package com.iwhalecloud.byai.manager.application.service.user;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.storage.ObjectStorage;

/**
 * 用户默认桶初始化服务。
 * 负责把用户编码映射为默认桶名，并调用底层对象存储执行存在即跳过的创建逻辑。
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18
 */
@Service
public class UserBucketProvisioningService {

    private static final Logger LOGGER = LoggerFactory.getLogger(UserBucketProvisioningService.class);

    @Autowired
    private ObjectStorage objectStorage;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    @Value("${file.storage.type:minio}")
    private String storageType;

    /**
     * 用户创建主流程不因 MinIO 初始化失败而回滚。
     * 因此这里提供一个静默包装方法：真实失败只打日志，方便后续补偿或人工排查。
     */
    public void ensureUserBucketQuietly(String userCode) {
        try {
            ensureUserBucket(userCode);
        } catch (Exception e) {
            LOGGER.error("初始化用户默认MinIO桶失败, userCode={}", userCode, e);
        }
    }

    /**
     * 依据用户编码生成默认桶名，并交给底层对象存储执行“存在即跳过”的创建逻辑。
     */
    public void ensureUserBucket(String userCode) {
        if (!isMinioStorage()) {
            LOGGER.info("当前文件存储类型不是minio，跳过用户默认MinIO桶初始化, storageType={}, userCode={}",
                storageType, userCode);
            return;
        }
        String bucketName = userBucketNamingService.buildUserBucketName(userCode);
        LOGGER.info("开始初始化用户默认MinIO桶, userCode={}, bucketName={}", userCode, bucketName);
        objectStorage.init(bucketName);
        LOGGER.info("用户默认MinIO桶初始化完成, userCode={}, bucketName={}", userCode, bucketName);
    }

    private boolean isMinioStorage() {
        return StringUtils.equalsIgnoreCase(StringUtils.trimToEmpty(storageType), "minio");
    }
}
