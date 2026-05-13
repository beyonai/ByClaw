package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;

/**
 * Application-facing file ingress service.
 *
 * This abstraction is intentionally focused on MultipartFile and file-URL
 * semantics, and delegates backend object operations to {@link ObjectStorage}.
 */
public interface FileIngressService {

    FileMetadata uploadFile(MultipartFile multipartFile, FileStorageContext fileStorageContext, String bucketName);

    FileMetadata uploadFile(MultipartFile multipartFile, FileStorageContext fileStorageContext);

    InputStream downloadFile(String fileUrl);

    void deleteFile(String fileUrl);

    void deleteFiles(List<String> fileUrls);

    FileMetadata getObjectMetadata(String fileUrl);
}
