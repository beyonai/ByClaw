package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.ParsedFileInfo;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.common.storage.util.FileUtil;

/**
 * Object-storage oriented base class.
 *
 * It encapsulates backend client construction and common metadata helpers, but
 * intentionally does not include MultipartFile upload orchestration.
 *
 * @param <T> storage client type
 */
public abstract class AbstractObjectStorageService<T> implements ObjectStorage {

    /**
     * 创建存储客户端 子类需要实现具体的客户端创建逻辑
     *
     * @return 存储客户端实例
     */
    protected abstract T createStorageClient();

    /**
     * 获取存储客户端
     *
     * @return 存储客户端实例
     */
    protected T getClient() {
        return createStorageClient();
    }

    /**
     * 获取存储类型
     *
     * @return 存储类型标识
     */
    public abstract String getStorageType();

    /**
     * 生成文件访问URL
     *
     * @param bucketName 存储桶名称
     * @param objectName 对象名称
     * @return 文件访问URL
     */
    protected String generateFileAccessUrl(String bucketName, String objectName) {
        return FileUtil.generateFileAccessUrl(bucketName, objectName, this.getStorageType());
    }

    protected FileMetadata buildFileMetadata(MultipartFile multipartFile, String fileUrl, String bucketName,
        String fileTag) {
        FileMetadata fileMetadata = new FileMetadata();
        fileMetadata.setFileTag(fileTag);
        fileMetadata.setFileName(multipartFile.getOriginalFilename());
        fileMetadata.setFileUrl(fileUrl);
        fileMetadata.setFileSize(multipartFile.getSize());
        fileMetadata.setFileType(org.apache.commons.io.FilenameUtils.getExtension(multipartFile.getOriginalFilename()));
        fileMetadata.setContentType(multipartFile.getContentType());
        fileMetadata.setBucketName(bucketName);
        fileMetadata.setStorageType(getStorageType());
        return fileMetadata;
    }

    protected ParsedFileInfo parseFileUrl(String fileUrl) {
        return FileUtil.parseFileUrl(fileUrl);
    }

    @Override
    public FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType) {
        throw new UnsupportedOperationException(getStorageType() + " does not support put(StorageLocation)");
    }

    @Override
    public InputStream get(StorageLocation location) {
        throw new UnsupportedOperationException(getStorageType() + " does not support get(StorageLocation)");
    }

    @Override
    public boolean exists(StorageLocation location) {
        throw new UnsupportedOperationException(getStorageType() + " does not support exists(StorageLocation)");
    }

    @Override
    public List<StorageObject> list(StoragePrefix prefix, Integer maxDepth) {
        throw new UnsupportedOperationException(getStorageType() + " does not support list(StoragePrefix, Integer)");
    }

    @Override
    public void delete(StorageLocation location) {
        throw new UnsupportedOperationException(getStorageType() + " does not support delete(StorageLocation)");
    }

    @Override
    public void copy(StorageLocation source, StorageLocation target) {
        throw new UnsupportedOperationException(getStorageType() + " does not support copy(StorageLocation)");
    }
}
