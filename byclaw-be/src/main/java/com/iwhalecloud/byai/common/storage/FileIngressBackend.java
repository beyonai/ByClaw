package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;

/**
 * Backend capability contract used by {@link FileIngressService}.
 */
public interface FileIngressBackend {

    String getStorageType();

    boolean createBucketIfNeeded(String bucketName);

    FileMetadata upload(MultipartFile multipartFile, String storagePath, String bucketName,
        FileStorageContext fileStorageContext);

    InputStream download(String filePath, String bucketName);

    void deleteByPath(String filePath, String bucketName);

    FileMetadata getMetadata(String filePath, String bucketName);
}
