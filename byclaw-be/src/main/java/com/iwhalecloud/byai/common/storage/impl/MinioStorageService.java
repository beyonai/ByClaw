package com.iwhalecloud.byai.common.storage.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.AbstractFileIngressStorageService;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.config.MinioConfig;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.common.storage.util.MinioBucketNameValidator;

import io.minio.BucketExistsArgs;
import io.minio.CopyObjectArgs;
import io.minio.CopySource;
import io.minio.GetObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.ObjectWriteResponse;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.StatObjectResponse;
import io.minio.messages.Item;
import io.minio.Result;
import io.minio.errors.ErrorResponseException;

/**
 * MinIO 存储基础设施实现。
 *
 * 职责说明：
 * 1. 负责 MinIO client 的创建与底层 SDK 调用；
 * 2. 提供文件上传、下载、删除、元数据查询等通用存储能力；
 * 3. 对外暴露“存在即跳过”的建桶能力，供上层业务复用。
 *
 * 不负责：
 * 1. 用户、租户等业务对象和桶名之间的映射规则；
 * 2. 失败是否影响主流程的业务决策；
 * 3. 业务侧的日志语义和补偿策略。
 *
 * 因此，如果是“管理员创建用户后初始化默认桶”这类场景，
 * 应由应用服务编排，再通过更轻量的桶管理服务复用当前类。
 *
 * @author he.duming
 * @date 2025-12-18 20:52:38
 */
@Component
public class MinioStorageService extends AbstractFileIngressStorageService<MinioClient> {

    private static final Logger logger = LoggerFactory.getLogger(MinioStorageService.class);


    @Autowired
    private MinioConfig minioConfig;

    @Autowired
    private MinioBucketMountSupport minioBucketMountSupport;

    @Value("${file.storage.type:minio}")
    private String storageType;

    /**
     * 获取存储类型
     *
     * @return 存储类型标识
     */
    @Override
    public String getStorageType() {
        return StorageType.MINIO;
    }

    /**
     * 对外暴露“存在即跳过，不存在则创建”的桶管理能力。
     * 这样上层业务在需要动态建桶时，可以直接复用当前 MinIO 存储实现，
     * 不必重复维护一套 MinIO client 构造与 bucketExists / makeBucket 逻辑。
     *
     * @param bucketName 存储桶名称
     * @return true 表示本次新创建，false 表示桶已存在
     */
    public boolean createBucketIfAbsent(String bucketName) {
        // 这里只提供纯技术语义：存在返回 false，新建返回 true。
        // 是否记录业务日志、是否允许失败不回滚，由上层应用服务决定。
        MinioBucketNameValidator.validate(bucketName);
        return doCreateBucket(bucketName);
    }

    @Override
    public void init(String bucketOrRoot) {
        createBucketIfAbsent(bucketOrRoot);
    }

    @Override
    public void mount(String bucketOrRoot) {
        createBucketIfAbsent(bucketOrRoot);
        minioBucketMountSupport.mountSingleBucketOnAllTargets(storageType, bucketOrRoot);
    }

    /**
     * 向指定桶下覆盖写入对象内容。
     *
     * 职责边界：
     * 1. 这里不关心 userCode、sessionId 等业务语义；
     * 2. 这里只负责确保 bucket 存在后，将字节数组按 objectKey 写入 MinIO；
     * 3. 上层应用服务负责对象路径规划、内容类型选择和异常兜底策略。
     *
     * @param bucketName 存储桶
     * @param objectKey 对象路径
     * @param bytes 文件内容
     * @param contentType 内容类型
     */
    public void uploadBytes(String bucketName, String objectKey, byte[] bytes, String contentType) {
        try {
            createBucketIfAbsent(bucketName);
            PutObjectArgs putObjectArgs = PutObjectArgs.builder()
                .bucket(bucketName)
                .object(objectKey)
                .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                .contentType(contentType)
                .build();
            getClient().putObject(putObjectArgs);
        }
        catch (Exception e) {
            logger.error("MinIO对象写入失败, bucketName={}, objectKey={}", bucketName, objectKey, e);
            throw new BaseException("MinIO对象写入失败: " + objectKey, e);
        }
    }

    /**
     * 判断对象是否存在。
     * 这个能力主要给“追加写”“按行读取”等需要先判断文件是否存在的上层场景复用。
     *
     * @param bucketName 存储桶
     * @param objectKey 对象路径
     * @return true-对象存在，false-对象不存在
     */
    public boolean objectExists(String bucketName, String objectKey) {
        try {
            StatObjectArgs statObjectArgs = StatObjectArgs.builder().bucket(bucketName).object(objectKey).build();
            getClient().statObject(statObjectArgs);
            return true;
        }
        catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())
                || "NoSuchObject".equals(e.errorResponse().code())
                || "NoSuchBucket".equals(e.errorResponse().code())) {
                return false;
            }
            throw new BaseException("查询MinIO对象失败: " + objectKey, e);
        }
        catch (Exception e) {
            throw new BaseException("查询MinIO对象失败: " + objectKey, e);
        }
    }

    /**
     * 列举指定前缀下的对象键列表。
     * 用于 MinIO 场景下模拟“目录遍历”“目录重命名”“目录删除”等能力。
     */
    public List<String> listObjectKeys(String bucketName, String prefix) {
        List<String> objectKeys = new ArrayList<>();
        try {
            Iterable<Result<Item>> results = getClient().listObjects(
                ListObjectsArgs.builder().bucket(bucketName).prefix(prefix).recursive(true).build());
            for (Result<Item> result : results) {
                Item item = result.get();
                if (item != null && StringUtils.isNotBlank(item.objectName())) {
                    objectKeys.add(item.objectName());
                }
            }
            return objectKeys;
        }
        catch (ErrorResponseException e) {
            if ("NoSuchBucket".equals(e.errorResponse().code())) {
                return objectKeys;
            }
            throw new BaseException("列举MinIO对象失败: " + prefix, e);
        }
        catch (Exception e) {
            throw new BaseException("列举MinIO对象失败: " + prefix, e);
        }
    }

    /**
     * 复制对象到新路径。
     * MinIO 没有原生 rename，这个能力会被上层“copy + delete”逻辑复用。
     */
    public void copyObject(String bucketName, String sourceObjectKey, String targetObjectKey) {
        try {
            CopySource source = CopySource.builder()
                .bucket(bucketName)
                .object(sourceObjectKey)
                .build();
            CopyObjectArgs copyObjectArgs = CopyObjectArgs.builder()
                .bucket(bucketName)
                .object(targetObjectKey)
                .source(source)
                .build();
            getClient().copyObject(copyObjectArgs);
        }
        catch (Exception e) {
            throw new BaseException("复制MinIO对象失败: " + sourceObjectKey + " -> " + targetObjectKey, e);
        }
    }

    /**
     * 删除对象；若对象不存在则安静跳过。
     */
    public void deleteObjectIfExists(String bucketName, String objectKey) {
        if (!objectExists(bucketName, objectKey)) {
            return;
        }
        try {
            RemoveObjectArgs removeObjectArgs = RemoveObjectArgs.builder().bucket(bucketName).object(objectKey).build();
            getClient().removeObject(removeObjectArgs);
        }
        catch (Exception e) {
            throw new BaseException("删除MinIO对象失败: " + objectKey, e);
        }
    }

    @Override
    public FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType) {
        try {
            String bucketName = location.getBucketOrRoot();
            String objectKey = location.getPath();
            createBucketIfAbsent(bucketName);
            PutObjectArgs putObjectArgs = PutObjectArgs.builder()
                .bucket(bucketName)
                .object(objectKey)
                .stream(inputStream, size, -1)
                .contentType(contentType)
                .build();
            ObjectWriteResponse response = getClient().putObject(putObjectArgs);
            FileMetadata metadata = new FileMetadata();
            metadata.setBucketName(bucketName);
            metadata.setFileUrl(generateFileAccessUrl(bucketName, objectKey));
            metadata.setFileName(FilenameUtils.getName(objectKey));
            metadata.setFileSize(size);
            metadata.setContentType(contentType);
            metadata.setFileType(FilenameUtils.getExtension(objectKey));
            metadata.setFileTag(response.etag());
            metadata.setStorageType(getStorageType());
            return metadata;
        }
        catch (Exception e) {
            throw new BaseException("MinIO对象写入失败: " + (location == null ? null : location.getPath()), e);
        }
    }

    @Override
    public InputStream get(StorageLocation location) {
        return doDownloadFile(location.getPath(), location.getBucketOrRoot());
    }

    @Override
    public boolean exists(StorageLocation location) {
        return objectExists(location.getBucketOrRoot(), location.getPath());
    }

    @Override
    public List<StorageObject> list(StoragePrefix prefix, Integer maxDepth) {
        if (maxDepth != null && maxDepth < 0) {
            throw new IllegalArgumentException("list maxDepth cannot be negative");
        }
        List<StorageObject> objects = new ArrayList<>();
        for (String objectKey : listObjectKeys(prefix.getBucketOrRoot(), prefix.getPrefix())) {
            if (!isWithinDepth(prefix.getPrefix(), objectKey, maxDepth)) {
                continue;
            }
            objects.add(StorageObject.builder()
                .bucketOrRoot(prefix.getBucketOrRoot())
                .path(objectKey)
                .build());
        }
        return objects;
    }

    private boolean isWithinDepth(String prefix, String objectKey, Integer maxDepth) {
        if (maxDepth == null) {
            return true;
        }
        return relativePathDepth(prefix, objectKey) <= maxDepth;
    }

    private int relativePathDepth(String prefix, String objectKey) {
        String relativePath = relativizeObjectKey(prefix, objectKey);
        String normalized = StringUtils.trimToEmpty(relativePath).replace('\\', '/').replaceAll("/+", "/");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (StringUtils.isBlank(normalized)) {
            return 0;
        }
        return normalized.split("/").length;
    }

    private String relativizeObjectKey(String prefix, String objectKey) {
        String normalizedPrefix = StringUtils.trimToEmpty(prefix).replace('\\', '/').replaceAll("/+", "/");
        String normalizedObjectKey = StringUtils.trimToEmpty(objectKey).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.equals(normalizedPrefix, normalizedObjectKey)) {
            return "";
        }
        if (normalizedPrefix.endsWith("/") && normalizedObjectKey.startsWith(normalizedPrefix)) {
            return normalizedObjectKey.substring(normalizedPrefix.length());
        }
        String prefixDirectory = normalizedPrefix + "/";
        if (normalizedObjectKey.startsWith(prefixDirectory)) {
            return normalizedObjectKey.substring(prefixDirectory.length());
        }
        if (normalizedObjectKey.startsWith(normalizedPrefix)) {
            return normalizedObjectKey.substring(normalizedPrefix.length());
        }
        return normalizedObjectKey;
    }

    @Override
    public void delete(StorageLocation location) {
        deleteObjectIfExists(location.getBucketOrRoot(), location.getPath());
    }

    @Override
    public void copy(StorageLocation source, StorageLocation target) {
        if (!StringUtils.equals(source.getBucketOrRoot(), target.getBucketOrRoot())) {
            throw new BaseException("MinIO跨桶复制暂未支持: " + source.getBucketOrRoot() + " -> " + target.getBucketOrRoot());
        }
        copyObject(source.getBucketOrRoot(), source.getPath(), target.getPath());
    }

    /**
     * 创建MinIO客户端
     *
     * @return MinIO客户端实例
     * @throws BaseException 客户端创建失败时抛出异常
     */
    @Override
    protected MinioClient createStorageClient() {
        try {

            // MinIO 新配置改为 host + api.port，这里仍通过配置对象统一拼出 endpoint，
            // 避免底层 SDK 初始化逻辑在各处散落 host/port 拼接细节。
            String endpoint = minioConfig.getEndpoint();
            String accessKey = minioConfig.getAccessKey();
            String secretKey = minioConfig.getSecretKey();
            boolean secure = Boolean.TRUE.equals(minioConfig.getSecure());

            validateMinioClientConfig(endpoint, accessKey, secretKey);
            String normalizedEndpoint = normalizeEndpoint(endpoint, secure);
            MinioClient.Builder builder = MinioClient.builder()
                .endpoint(normalizedEndpoint)
                .credentials(accessKey, secretKey);
            return builder.build();
        }
        catch (Exception e) {
            logger.error("创建MinIO客户端失败, endpoint={}, secure={}, accessKeyPresent={}, secretKeyPresent={}",
                minioConfig.getEndpoint(), Boolean.TRUE.equals(minioConfig.getSecure()),
                StringUtils.isNotBlank(minioConfig.getAccessKey()), StringUtils.isNotBlank(minioConfig.getSecretKey()), e);
            throw new BaseException(I18nUtil.get("storage.minio.create.client.failed", e.getMessage()), e);
        }
    }

    private static void validateMinioClientConfig(String endpoint, String accessKey, String secretKey) {
        if (StringUtils.isBlank(endpoint)) {
            throw new BaseException("MinIO配置缺失: endpoint不能为空，请检查 file.storage.minio.host / api.port");
        }
        if (StringUtils.isBlank(accessKey)) {
            throw new BaseException("MinIO配置缺失: accessKey不能为空，请检查 file.storage.minio.access_key");
        }
        if (StringUtils.isBlank(secretKey)) {
            throw new BaseException("MinIO配置缺失: secretKey不能为空，请检查 file.storage.minio.secret_key");
        }
    }

    private static String normalizeEndpoint(String endpoint, boolean secure) {
        if (endpoint == null) {
            return null;
        }
        String trimmed = endpoint.trim();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed;
        }
        return (secure ? "https://" : "http://") + trimmed;
    }

    /**
     * 上传文件到MinIO
     *
     * @param multipartFile 待上传的文件
     * @param storagePath 存储路径
     * @param bucketName 存储桶名称
     * @return 文件元数据信息
     * @throws BaseException 文件上传失败时抛出异常
     */
    @Override
    protected FileMetadata doUploadFile(MultipartFile multipartFile, String storagePath, String bucketName,
                                        FileStorageContext fileStorageContext) {
        try {
            String objectName = storagePath + multipartFile.getOriginalFilename();
            PutObjectArgs putObjectArgs = PutObjectArgs.builder().bucket(bucketName).object(objectName)
                .stream(multipartFile.getInputStream(), multipartFile.getSize(), -1).build();

            ObjectWriteResponse objectWriteResponse = getClient().putObject(putObjectArgs);

            String fileUrl = this.generateFileAccessUrl(bucketName, objectName);

            return buildFileMetadata(multipartFile, fileUrl, bucketName, objectWriteResponse.etag());
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 从MinIO下载文件
     *
     * @param fileId 文件ID
     * @param bucketName 存储桶名称
     * @return 文件输入流
     * @throws BaseException 文件不存在或下载失败时抛出异常
     */
    @Override
    protected InputStream doDownloadFile(String fileId, String bucketName) {
        try {
            GetObjectArgs getObjectArgs = GetObjectArgs.builder().bucket(bucketName).object(fileId).build();

            InputStream inputStream = getClient().getObject(getObjectArgs);

            if (inputStream == null) {
                throw new BaseException(I18nUtil.get("storage.minio.file.not.exist.or.unreadable", fileId));
            }

            return inputStream;

        }
        catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) {
                throw new BaseException(I18nUtil.get("storage.minio.file.not.exist", fileId), e);
            }
            throw new BaseException(I18nUtil.get("storage.minio.file.download.failed", e.getMessage()), e);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 删除MinIO中的文件
     *
     * @param objectUrl 对象URL地址
     * @param bucketName 存储桶名称
     * @throws BaseException 文件删除失败时抛出异常
     */
    @Override
    protected void doDeleteFile(String objectUrl, String bucketName) {
        try {
            RemoveObjectArgs removeObjectArgs = RemoveObjectArgs.builder().bucket(bucketName).object(objectUrl).build();

            getClient().removeObject(removeObjectArgs);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 获取MinIO对象的元数据信息
     *
     * @param objectKey 对象键
     * @param bucketName 存储桶名称
     * @return 文件元数据信息
     * @throws BaseException 文件不存在或获取元数据失败时抛出异常
     */
    @Override
    protected FileMetadata doGetObjectMetadata(String objectKey, String bucketName) {
        try {
            StatObjectArgs statObjectArgs = StatObjectArgs.builder().bucket(bucketName).object(objectKey).build();
            StatObjectResponse statObjectResponse = getClient().statObject(statObjectArgs);
            String fileUrl = generateFileAccessUrl(bucketName, objectKey);

            // 构建文件元数据
            FileMetadata fileMetadata = new FileMetadata();
            fileMetadata.setFileUrl(fileUrl);
            fileMetadata.setFileName(FilenameUtils.getName(objectKey));
            fileMetadata.setFileSize(statObjectResponse.size());
            fileMetadata.setContentType(statObjectResponse.contentType());
            fileMetadata.setFileType(FilenameUtils.getExtension(objectKey));
            fileMetadata.setBucketName(bucketName);
            fileMetadata.setFileTag(statObjectResponse.etag());
            fileMetadata.setStorageType(getStorageType());
            return fileMetadata;
        }
        catch (ErrorResponseException e) {
            if ("NoSuchKey".equals(e.errorResponse().code())) {
                throw new BaseException(I18nUtil.get("storage.minio.file.not.exist", objectKey), e);
            }
            throw new BaseException(I18nUtil.get("storage.minio.get.file.metadata.failed", e.getMessage()), e);
        }
        catch (Exception e) {
            throw new BaseException(I18nUtil.get("storage.minio.get.file.metadata.failed", e.getMessage()), e);
        }
    }



    /**
     * 创建MinIO存储桶
     *
     * @param bucketName 存储桶名称
     * @return 创建是否成功（如果桶已存在返回false，新创建返回true）
     * @throws BaseException 创建存储桶失败时抛出异常
     */
    @Override
    protected boolean doCreateBucket(String bucketName) {
        try {
            BucketExistsArgs bucketExistsArgs = BucketExistsArgs.builder().bucket(bucketName).build();
            boolean bucketExists = getClient().bucketExists(bucketExistsArgs);

            if (!bucketExists) {
                MakeBucketArgs makeBucketArgs = MakeBucketArgs.builder().bucket(bucketName).build();
                getClient().makeBucket(makeBucketArgs);
                return true;
            }
            return false;
        }
        catch (Exception e) {
            logger.error("创建MinIO存储桶失败, bucketName={}, endpoint={}, secure={}",
                bucketName, minioConfig.getEndpoint(), Boolean.TRUE.equals(minioConfig.getSecure()), e);
            throw new BaseException(I18nUtil.get("storage.minio.create.bucket.failed", bucketName), e);
        }
    }

}
