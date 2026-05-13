package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;

/**
 * Transitional base class for backends that still expose direct file-ingress
 * semantics in addition to object storage semantics.
 *
 * @param <T> storage client type
 */
public abstract class AbstractFileIngressStorageService<T> extends AbstractObjectStorageService<T>
    implements FileIngressBackend {

    protected abstract FileMetadata doUploadFile(MultipartFile multipartFile, String storagePath, String bucketName,
        FileStorageContext fileStorageContext);

    protected abstract InputStream doDownloadFile(String fileId, String bucketName);

    protected abstract void doDeleteFile(String objectUrl, String bucketName);

    protected abstract FileMetadata doGetObjectMetadata(String objectKey, String bucketName);

    protected abstract boolean doCreateBucket(String bucketName);

    @Override
    public boolean createBucketIfNeeded(String bucketName) {
        return doCreateBucket(bucketName);
    }

    @Override
    public FileMetadata upload(MultipartFile multipartFile, String storagePath, String bucketName,
        FileStorageContext fileStorageContext) {
        return doUploadFile(multipartFile, storagePath, bucketName, fileStorageContext);
    }

    @Override
    public InputStream download(String filePath, String bucketName) {
        return doDownloadFile(filePath, bucketName);
    }

    @Override
    public void deleteByPath(String filePath, String bucketName) {
        doDeleteFile(filePath, bucketName);
    }

    @Override
    public FileMetadata getMetadata(String filePath, String bucketName) {
        return doGetObjectMetadata(filePath, bucketName);
    }
}
