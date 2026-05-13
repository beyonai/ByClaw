package com.iwhalecloud.byai.common.storage.impl;


import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.HashSet;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListFilesRequest;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.WhaleAgentFileItem;
import com.iwhalecloud.byai.common.storage.AbstractFileIngressStorageService;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

import feign.Response;

/**
 * Whale-Agent存储服务实现类 提供基于rest api的文件存储功能
 *
 * @author he.duming
 * @date 2025-12-18 20:52:38
 */
@Component
public class WhaleAgentStorageService extends AbstractFileIngressStorageService<FeignWhaleAgentService> {

    private static final Logger logger = LoggerFactory.getLogger(WhaleAgentStorageService.class);
    private static final String SHARE_TYPE_PUBLIC = "public";
    private static final String SHARE_TYPE_PRIVATE = "private";
    private static final String UPLOAD_FAILED_KEY = "storage.whaleagent.upload.failed";
    private static final String DOWNLOAD_FAILED_KEY = "storage.whaleagent.download.failed";
    private static final String LIST_FAILED_KEY = "storage.whaleagent.list.failed";
    private static final String EXISTS_FAILED_KEY = "storage.whaleagent.exists.failed";
    private static final String DELETE_FAILED_KEY = "storage.whaleagent.delete.failed";

    @Autowired
    FeignWhaleAgentService feignWhaleAgentService;

    /**
     * 获取存储类型
     *
     * @return 存储类型标识
     */
    @Override
    public String getStorageType() {
        return StorageType.WHALE_AGENT;
    }

    @Override
    protected FeignWhaleAgentService createStorageClient() {
        return feignWhaleAgentService;
    }

    @Override
    protected FileMetadata doUploadFile(MultipartFile multipartFile, String storagePath, String bucketName, FileStorageContext fileStorageContext) {
        String originalFilename = multipartFile.getOriginalFilename();
        if (StringUtils.isBlank(originalFilename)) {
            throw new IllegalArgumentException("WhaleAgent upload file name cannot be empty");
        }
        String filePath = buildRemoteFilePath(storagePath, bucketName, originalFilename);
        return uploadFile(multipartFile, bucketName, filePath, SHARE_TYPE_PUBLIC);
    }

    @Override
    protected InputStream doDownloadFile(String fileId, String bucketName) {
        String filePath = buildRemoteFilePath(fileId, bucketName);
        return downloadFile(filePath, SHARE_TYPE_PUBLIC);
    }

    @Override
    protected void doDeleteFile(String objectUrl, String bucketName) {
        String remoteFilePath = buildRemoteFilePath(objectUrl, bucketName);
        deleteFile(remoteFilePath, SHARE_TYPE_PUBLIC);
    }

    @Override
    protected FileMetadata doGetObjectMetadata(String objectKey, String bucketName) {
        return null;
    }

    @Override
    protected boolean doCreateBucket(String bucketName) {
        return true;
    }

    @Override
    public void init(String bucketOrRoot) {
        // Whale-Agent 侧没有 MinIO bucket 这类需要预创建的存储单元。
    }

    @Override
    public void mount(String bucketOrRoot) {
        // Whale-Agent 侧没有 MinIO bucket 挂载语义。
    }

    @Override
    public FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType) {
        if (location == null) {
            throw new IllegalArgumentException("storage location cannot be null");
        }
        String objectPath = location.getPath();
        String fileName = FilenameUtils.getName(objectPath);
        MultipartFile multipartFile = new InputStreamMultipartFile(fileName, inputStream, size, contentType);
        String filePath = buildRemoteFilePath(objectPath, location.getBucketOrRoot());
        return uploadFile(multipartFile, location.getBucketOrRoot(), filePath,
            resolveShareType(location == null ? null : location.getShareType(), SHARE_TYPE_PRIVATE));
    }

    @Override
    public InputStream get(StorageLocation location) {
        if (location == null) {
            throw new IllegalArgumentException("storage location cannot be null");
        }
        String filePath = buildRemoteFilePath(location.getPath(), location.getBucketOrRoot());
        return downloadFile(filePath, resolveShareType(location.getShareType(), SHARE_TYPE_PRIVATE));
    }

    @Override
    public boolean exists(StorageLocation location) {
        String filePath = location == null ? null : location.getPath();
        String bucketName = location == null ? null : location.getBucketOrRoot();
        String remoteFilePath = buildRemoteFilePath(filePath, bucketName);
        String fileShareType = resolveShareType(location == null ? null : location.getShareType(), SHARE_TYPE_PRIVATE);
        KnowledgeResponse<Boolean> response = callWhaleAgent(EXISTS_FAILED_KEY, () -> feignWhaleAgentService.existsFile(
            new WhaleAgentListFilesRequest(remoteFilePath, fileShareType)));
        validateExistsResponse(response);
        return Boolean.TRUE.equals(response.getResultObject());
    }

    @Override
    public List<StorageObject> list(StoragePrefix prefix, Integer maxDepth) {
        if (maxDepth != null && maxDepth < 0) {
            throw new IllegalArgumentException("list maxDepth cannot be negative");
        }
        String prefixPath = normalizePrefixPath(prefix == null ? null : prefix.getPrefix());
        String remoteFilePath = buildRemotePrefixPath(prefixPath, prefix == null ? null : prefix.getBucketOrRoot());
        String fileShareType = resolveShareType(prefix == null ? null : prefix.getShareType(), SHARE_TYPE_PRIVATE);
        return listByDepth(prefix, remoteFilePath, fileShareType, maxDepth);
    }

    private List<StorageObject> listByDepth(StoragePrefix prefix, String remoteFilePath, String fileShareType,
        Integer maxDepth) {
        List<StorageObject> objects = new ArrayList<>();
        List<ListPath> pendingPaths = new ArrayList<>();
        Set<String> visitedRemotePaths = new HashSet<>();
        pendingPaths.add(new ListPath(remoteFilePath, 1));

        for (int index = 0; index < pendingPaths.size(); index++) {
            ListPath currentPath = pendingPaths.get(index);
            if (maxDepth != null && currentPath.depth() > maxDepth) {
                continue;
            }
            String visitedKey = ensureTrailingSlash(normalizeListRemotePrefix(currentPath.remoteFilePath()));
            if (!visitedRemotePaths.add(visitedKey)) {
                continue;
            }

            KnowledgeResponse<List<WhaleAgentFileItem>> response = callWhaleAgent(LIST_FAILED_KEY,
                () -> feignWhaleAgentService.listFiles(
                    new WhaleAgentListFilesRequest(currentPath.remoteFilePath(), fileShareType)));
            validateListResponse(response);

            List<StorageObject> listedObjects = mapStorageObjects(prefix, response.getResultObject());
            objects.addAll(listedObjects);
            if (maxDepth != null && currentPath.depth() >= maxDepth) {
                continue;
            }
            for (StorageObject object : listedObjects) {
                if (object == null || StringUtils.isBlank(object.getPath()) || !object.getPath().endsWith("/")) {
                    continue;
                }
                pendingPaths.add(new ListPath(normalizePrefixPath(object.getPath()), currentPath.depth() + 1));
            }
        }
        return objects;
    }

    @Override
    public void delete(StorageLocation location) {
        String filePath = location == null ? null : location.getPath();
        String bucketName = location == null ? null : location.getBucketOrRoot();
        String remoteFilePath = buildRemoteFilePath(filePath, bucketName);
        deleteFile(remoteFilePath, resolveShareType(location == null ? null : location.getShareType(), SHARE_TYPE_PRIVATE));
    }

    @Override
    public void copy(StorageLocation source, StorageLocation target) {
        throw unsupported("copy");
    }

    private UnsupportedOperationException unsupported(String operation) {
        return new UnsupportedOperationException(
            "WhaleAgent storage " + operation + " API is not configured on FeignWhaleAgentService yet");
    }

    private <T> T callWhaleAgent(String messageKey, Supplier<T> supplier) {
        try {
            return supplier.get();
        }
        catch (BaseException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error("WhaleAgent storage feign call failed, messageKey={}", messageKey, e);
            throw new BaseException(messageKey, e);
        }
    }

    private void validateUploadResponse(KnowledgeResponse<Void> response) {
        if (response == null) {
            throw new BaseException(UPLOAD_FAILED_KEY);
        }
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new BaseException(UPLOAD_FAILED_KEY);
        }
    }

    private void validateListResponse(KnowledgeResponse<List<WhaleAgentFileItem>> response) {
        if (response == null) {
            throw new BaseException(LIST_FAILED_KEY);
        }
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new BaseException(LIST_FAILED_KEY);
        }
    }

    private void validateExistsResponse(KnowledgeResponse<Boolean> response) {
        if (response == null) {
            throw new BaseException(EXISTS_FAILED_KEY);
        }
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new BaseException(EXISTS_FAILED_KEY);
        }
    }

    private void validateDeleteResponse(KnowledgeResponse<Void> response) {
        if (response == null) {
            throw new BaseException(DELETE_FAILED_KEY);
        }
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new BaseException(DELETE_FAILED_KEY);
        }
    }

    private String buildRemoteFilePath(String storagePath, String bucketName, String fileName) {
        String normalizedDirectory = normalizeDirectory(storagePath);
        String normalizedBucket = normalizeBucket(bucketName);
        String joinedDirectory = StringUtils.isBlank(normalizedBucket)
            ? normalizedDirectory
            : normalizedBucket + normalizedDirectory;
        return joinedDirectory + fileName;
    }

    private String buildRemoteFilePath(String filePath, String bucketName) {
        String normalizedPath = normalizeAbsolutePath(filePath);
        String normalizedBucket = normalizeBucket(bucketName);
        return StringUtils.isBlank(normalizedBucket) ? normalizedPath : normalizedBucket + normalizedPath;
    }

    private String buildRemotePrefixPath(String prefixPath, String bucketName) {
        String normalizedPath = normalizePrefixPath(prefixPath);
        String normalizedBucket = normalizeBucket(bucketName);
        return StringUtils.isBlank(normalizedBucket) ? normalizedPath : normalizedBucket + normalizedPath;
    }

    private String normalizeDirectory(String storagePath) {
        String normalized = StringUtils.defaultString(storagePath).trim().replace('\\', '/').replaceAll("/+", "/");
        if (normalized.isEmpty() || "/".equals(normalized)) {
            return "/";
        }
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        if (!normalized.endsWith("/")) {
            normalized = normalized + "/";
        }
        return normalized;
    }

    private String normalizeAbsolutePath(String filePath) {
        String normalized = StringUtils.defaultString(filePath).trim().replace('\\', '/').replaceAll("/+", "/");
        if (normalized.isEmpty() || "/".equals(normalized)) {
            throw new IllegalArgumentException("WhaleAgent download file path cannot be empty");
        }
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        return normalized;
    }

    private String normalizePrefixPath(String prefixPath) {
        String normalized = StringUtils.defaultString(prefixPath).trim().replace('\\', '/').replaceAll("/+", "/");
        if (normalized.isEmpty()) {
            return "/";
        }
        if ("/".equals(normalized)) {
            return "/";
        }
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        return normalized;
    }

    private String normalizeBucket(String bucketName) {
        if (StringUtils.isBlank(bucketName)) {
            return "";
        }
        String normalized = FilenameUtils.separatorsToUnix(bucketName.trim()).replaceAll("/+", "/");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized.isEmpty() ? "" : "/" + normalized;
    }

    private FileMetadata uploadFile(MultipartFile multipartFile, String bucketName, String filePath, String fileShareType) {
        KnowledgeResponse<Void> response = callWhaleAgent(UPLOAD_FAILED_KEY,
            () -> feignWhaleAgentService.uploadFile(filePath, fileShareType, multipartFile));
        validateUploadResponse(response);
        return buildFileMetadata(multipartFile, filePath, bucketName, null);
    }

    private InputStream downloadFile(String filePath, String fileShareType) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("filePath", filePath);
        request.put("fileShareType", fileShareType);
        Response response = callWhaleAgent(DOWNLOAD_FAILED_KEY, () -> feignWhaleAgentService.downloadFile(request));
        if (response == null || response.body() == null) {
            throw new BaseException(DOWNLOAD_FAILED_KEY);
        }
        try (response; InputStream inputStream = response.body().asInputStream()) {
            return new java.io.ByteArrayInputStream(inputStream.readAllBytes());
        }
        catch (Exception e) {
            logger.error("WhaleAgent storage download response read failed", e);
            throw new BaseException(DOWNLOAD_FAILED_KEY, e);
        }
    }

    private void deleteFile(String remoteFilePath, String fileShareType) {
        KnowledgeResponse<Void> response = callWhaleAgent(DELETE_FAILED_KEY, () -> feignWhaleAgentService.deleteFile(
            new WhaleAgentListFilesRequest(remoteFilePath, fileShareType)));
        validateDeleteResponse(response);
    }

    private String resolveShareType(String shareType, String defaultShareType) {
        if (StringUtils.equalsIgnoreCase(shareType, SHARE_TYPE_PUBLIC)) {
            return SHARE_TYPE_PUBLIC;
        }
        if (StringUtils.equalsIgnoreCase(shareType, SHARE_TYPE_PRIVATE)) {
            return SHARE_TYPE_PRIVATE;
        }
        return defaultShareType;
    }

    private List<StorageObject> mapStorageObjects(StoragePrefix prefix, List<WhaleAgentFileItem> resultObject) {
        if (resultObject == null || resultObject.isEmpty()) {
            return List.of();
        }
        return resultObject.stream()
            .filter(item -> item != null && StringUtils.isNotBlank(item.getFilePath()))
            .map(item -> toStorageObject(prefix, item))
            .toList();
    }

    private StorageObject toStorageObject(StoragePrefix prefix, WhaleAgentFileItem item) {
        String objectPath = FilenameUtils.separatorsToUnix(item.getFilePath()).replaceAll("/+", "/");
        while (objectPath.startsWith("/")) {
            objectPath = objectPath.substring(1);
        }
        if (Boolean.TRUE.equals(item.getDirectory()) && !objectPath.endsWith("/")) {
            objectPath = objectPath + "/";
        }
        return StorageObject.builder()
            .bucketOrRoot(prefix == null ? null : prefix.getBucketOrRoot())
            .path(objectPath)
            .size(item.getSize())
            .build();
    }

    private String normalizeListRemotePrefix(String remoteFilePath) {
        String normalized = FilenameUtils.separatorsToUnix(StringUtils.defaultString(remoteFilePath)).replaceAll("/+", "/");
        return normalized.isEmpty() ? "/" : normalized;
    }

    private String ensureTrailingSlash(String value) {
        if (StringUtils.isBlank(value) || value.endsWith("/")) {
            return value;
        }
        return value + "/";
    }

    private record ListPath(String remoteFilePath, int depth) {
    }

    private static class InputStreamMultipartFile implements MultipartFile {

        private final String fileName;
        private final InputStream inputStream;
        private final long size;
        private final String contentType;

        private InputStreamMultipartFile(String fileName, InputStream inputStream, long size, String contentType) {
            this.fileName = fileName;
            this.inputStream = inputStream;
            this.size = size;
            this.contentType = contentType;
        }

        @Override
        public String getName() {
            return fileName;
        }

        @Override
        public String getOriginalFilename() {
            return fileName;
        }

        @Override
        public String getContentType() {
            return contentType;
        }

        @Override
        public boolean isEmpty() {
            return size == 0;
        }

        @Override
        public long getSize() {
            return size;
        }

        @Override
        public byte[] getBytes() throws java.io.IOException {
            return inputStream.readAllBytes();
        }

        @Override
        public InputStream getInputStream() {
            return inputStream;
        }

        @Override
        public void transferTo(java.io.File dest) throws java.io.IOException, IllegalStateException {
            try (java.io.OutputStream outputStream = java.nio.file.Files.newOutputStream(dest.toPath())) {
                inputStream.transferTo(outputStream);
            }
        }
    }
}
