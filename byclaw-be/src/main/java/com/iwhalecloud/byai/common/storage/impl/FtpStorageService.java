package com.iwhalecloud.byai.common.storage.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.net.ftp.FTPClient;
import org.apache.commons.net.ftp.FTPFile;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.UrlUtil;
import com.iwhalecloud.byai.common.storage.AbstractFileIngressStorageService;
import com.iwhalecloud.byai.common.storage.config.FtpConfig;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

/**
 * FTP存储服务实现类 提供基于FTP的文件存储功能
 *
 * @author he.duming
 * @date 2025-12-18 20:52:38
 */
@Component
public class FtpStorageService extends AbstractFileIngressStorageService<FTPClient> {

    private static final Logger logger = LoggerFactory.getLogger(FtpStorageService.class);


    @Autowired
    private FtpConfig ftpConfig;

    /**
     * 获取存储类型
     *
     * @return 存储类型标识
     */
    @Override
    public String getStorageType() {
        return StorageType.FTP;
    }

    /**
     * 创建MinIO客户端
     *
     * @return MinIO客户端实例
     * @throws BaseException 客户端创建失败时抛出异常
     */
    @Override
    protected FTPClient createStorageClient() {
        try {
            FTPClient ftpClient = new FTPClient();
            ftpClient.connect(ftpConfig.getHost(), ftpConfig.getPort());
            if (ftpClient.login(ftpConfig.getUser(), ftpConfig.getPwd())) {
                // 设置文件传输类型（二进制）
                ftpClient.setFileType(FTPClient.BINARY_FILE_TYPE);
            }
            return ftpClient;
        }
        catch (Exception e) {
            logger.error("创建FTPClient客户端失败", e);
            throw new BaseException(e.getMessage(), e);
        }
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

            FTPClient ftpClient = getClient();

            boolean useResourceRoot = fileStorageContext != null && fileStorageContext.isFtpUsePathResourceRoot()
                && StringUtils.isNotBlank(ftpConfig.getPathResource());
            boolean usePathRoot = fileStorageContext != null && fileStorageContext.isFtpUsePathRoot()
                && StringUtils.isNotBlank(ftpConfig.getPath());
            boolean useCustomBasePath = fileStorageContext != null
                && StringUtils.isNotBlank(fileStorageContext.getFtpCustomAbsoluteBasePath());

            String targetDir;
            String pathForUrl;
            if (useCustomBasePath) {
                String base = stripTrailingSlashes(fileStorageContext.getFtpCustomAbsoluteBasePath());
                String sub = normalizeRelativeSubdir(storagePath);
                targetDir = sub.isEmpty() ? base : base + "/" + sub;
                pathForUrl = targetDir;
            } else if (useResourceRoot) {
                String base = stripTrailingSlashes(ftpConfig.getPathResource());
                String sub = normalizeRelativeSubdir(storagePath);
                targetDir = sub.isEmpty() ? base : base + "/" + sub;
                pathForUrl = targetDir;
            }
            else if (usePathRoot) {
                String base = stripTrailingSlashes(ftpConfig.getPath());
                String sub = normalizeRelativeSubdir(storagePath);
                targetDir = sub.isEmpty() ? base : base + "/" + sub;
                pathForUrl = targetDir;
            }
            else {
                targetDir = stripTrailingSlashes(ftpConfig.getPath());
                pathForUrl = ftpConfig.getPath();
            }

            if (targetDir.startsWith("/")) {
                ensureFtpAbsolutePathExists(ftpClient, targetDir);
            }
            if (!ftpClient.changeWorkingDirectory(targetDir)) {
                throw new BaseException("FTP 进入目录失败: " + targetDir);
            }
            ftpClient.enterLocalPassiveMode();
            String originalFilename = multipartFile.getOriginalFilename();
            ftpClient.storeFile(originalFilename, multipartFile.getInputStream());

            return buildFileMetadata(multipartFile, UrlUtil.concatUrl(pathForUrl, originalFilename), bucketName, null);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    private static String stripTrailingSlashes(String s) {
        if (s == null) {
            return "";
        }
        String t = s.trim().replace('\\', '/');
        while (t.length() > 1 && t.endsWith("/")) {
            t = t.substring(0, t.length() - 1);
        }
        return t;
    }

    private static String normalizeRelativeSubdir(String storagePath) {
        if (storagePath == null) {
            return "";
        }
        String t = storagePath.trim().replace('\\', '/');
        while (t.startsWith("/")) {
            t = t.substring(1);
        }
        while (t.endsWith("/") && t.length() > 1) {
            t = t.substring(0, t.length() - 1);
        }
        return t;
    }

    /**
     * 校验路径安全性，防止路径遍历攻击
     *
     * @param path 待校验路径
     * @throws BaseException 路径不安全时抛出异常
     */
    private static void validatePathSecurity(String path) {
        if (StringUtils.isBlank(path)) {
            return;
        }

        String normalized = path.replace('\\', '/');

        // Check for path traversal patterns
        if (normalized.contains("../") || normalized.contains("/..") || normalized.equals("..")) {
            throw new BaseException("FTP 路径安全校验失败: 不允许包含 '..' 路径遍历");
        }

        // Check for absolute path outside allowed scope (starting with /)
        // This is acceptable if the base path is absolute, but we log it
        if (normalized.startsWith("/") && !normalized.startsWith(stripTrailingSlashes(""))) {
            logger.debug("FTP 路径使用绝对路径: {}", path);
        }
    }

    private static void ensureFtpAbsolutePathExists(FTPClient ftp, String absoluteDir) throws IOException {
        String dir = absoluteDir.replace('\\', '/');
        if (!dir.startsWith("/")) {
            return;
        }
        String[] parts = dir.split("/");
        StringBuilder current = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) {
                continue;
            }
            current.append("/").append(part);
            String path = current.toString();
            if (!ftp.changeWorkingDirectory(path)) {
                if (!ftp.makeDirectory(path)) {
                    throw new BaseException("FTP 创建目录失败: " + path);
                }
                if (!ftp.changeWorkingDirectory(path)) {
                    throw new BaseException("FTP 进入目录失败: " + path);
                }
            }
        }
    }

    /**
     * 从FTP下载文件
     *
     * @param fileId 文件ID
     * @param bucketName 存储桶名称
     * @return 文件输入流
     * @throws BaseException 文件不存在或下载失败时抛出异常
     */
    @Override
    protected InputStream doDownloadFile(String fileId, String bucketName) {
        validatePathSecurity(fileId);

        try {
            FTPClient ftpClient = getClient();
            ftpClient.enterLocalPassiveMode();

            // Parse path: consistent with doDeleteFile
            String normalizedPath = fileId.replace('\\', '/');
            int lastSlashIndex = normalizedPath.lastIndexOf('/');
            String targetDir = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : "";
            String fileName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : normalizedPath;

            if (StringUtils.isBlank(fileName)) {
                throw new BaseException("FTP 下载文件失败: 文件名为空");
            }

            if (StringUtils.isNotBlank(targetDir) && !ftpClient.changeWorkingDirectory(targetDir)) {
                throw new BaseException("FTP 进入目录失败: " + targetDir);
            }

            // Retrieve file stream from FTP
            InputStream inputStream = ftpClient.retrieveFileStream(fileName);
            if (inputStream == null) {
                throw new BaseException("FTP 下载文件失败: " + normalizedPath);
            }

            return inputStream;
        }
        catch (Exception e) {
            logger.error("FTP下载文件失败: {}", fileId, e);
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
        validatePathSecurity(objectUrl);

        try {
            FTPClient ftpClient = getClient();
            ftpClient.enterLocalPassiveMode();

            String normalizedPath = objectUrl.replace('\\', '/');
            int lastSlashIndex = normalizedPath.lastIndexOf('/');
            String targetDir = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : "";
            String fileName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : normalizedPath;

            if (StringUtils.isBlank(fileName)) {
                throw new BaseException("FTP 删除文件失败: 文件名为空");
            }
            if (StringUtils.isNotBlank(targetDir) && !ftpClient.changeWorkingDirectory(targetDir)) {
                throw new BaseException("FTP 进入目录失败: " + targetDir);
            }
            if (!ftpClient.deleteFile(fileName)) {
                throw new BaseException("FTP 删除文件失败: " + normalizedPath);
            }
        }
        catch (Exception e) {
            logger.error("FTP删除文件失败: {}", objectUrl, e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 获取FTP对象的元数据信息
     *
     * @param objectKey 对象键
     * @param bucketName 存储桶名称
     * @return 文件元数据信息
     * @throws BaseException 文件不存在或获取元数据失败时抛出异常
     */
    @Override
    protected FileMetadata doGetObjectMetadata(String objectKey, String bucketName) {
        validatePathSecurity(objectKey);

        try {
            FTPClient ftpClient = getClient();
            ftpClient.enterLocalPassiveMode();

            // Parse path: consistent with doDownloadFile
            String normalizedPath = objectKey.replace('\\', '/');
            int lastSlashIndex = normalizedPath.lastIndexOf('/');
            String targetDir = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : "";
            String fileName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : normalizedPath;

            if (StringUtils.isBlank(fileName)) {
                throw new BaseException("FTP 获取元数据失败: 文件名为空");
            }

            if (StringUtils.isNotBlank(targetDir) && !ftpClient.changeWorkingDirectory(targetDir)) {
                throw new BaseException("FTP 进入目录失败: " + targetDir);
            }

            // List files to get metadata
            FTPFile[] files = ftpClient.listFiles(fileName);
            if (files == null || files.length == 0) {
                throw new BaseException("FTP 文件不存在: " + normalizedPath);
            }

            FTPFile ftpFile = files[0];
            FileMetadata metadata = new FileMetadata();
            metadata.setBucketName(bucketName);
            metadata.setFileName(fileName);
            metadata.setFileUrl(objectKey);
            metadata.setFileSize(ftpFile.getSize());
            metadata.setFileType(FilenameUtils.getExtension(fileName));
            metadata.setStorageType(getStorageType());
            if (ftpFile.getTimestamp() != null) {
                metadata.setLastModified(ftpFile.getTimestamp().toInstant().toString());
            }

            return metadata;
        }
        catch (Exception e) {
            logger.error("FTP获取文件元数据失败: {}", objectKey, e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 创建文件上传路径
     *
     * @param bucketName 存储桶名称
     * @return 是否创建成功
     */
    @Override
    protected boolean doCreateBucket(String bucketName) {
        return true;
    }

    /**
     * 上传对象到FTP存储
     *
     * @param location 存储位置
     * @param inputStream 文件输入流
     * @param size 文件大小
     * @param contentType 内容类型
     * @return 文件元数据
     */
    @Override
    public FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType) {
        validatePathSecurity(location.getPath());

        try {
            FTPClient ftpClient = getClient();

            String bucketName = location.getBucketOrRoot();
            String path = location.getPath();

            // Parse path: consistent with doUploadFile
            String normalizedPath = path.replace('\\', '/');
            int lastSlashIndex = normalizedPath.lastIndexOf('/');
            String targetDir = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : "";
            String fileName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : normalizedPath;

            if (StringUtils.isBlank(fileName)) {
                throw new BaseException("FTP 上传文件失败: 文件名为空");
            }

            // Ensure directory exists
            if (StringUtils.isNotBlank(targetDir) && targetDir.startsWith("/")) {
                ensureFtpAbsolutePathExists(ftpClient, targetDir);
            }

            if (StringUtils.isNotBlank(targetDir) && !ftpClient.changeWorkingDirectory(targetDir)) {
                throw new BaseException("FTP 进入目录失败: " + targetDir);
            }

            ftpClient.enterLocalPassiveMode();
            boolean success = ftpClient.storeFile(fileName, inputStream);
            if (!success) {
                throw new BaseException("FTP 上传文件失败: " + path);
            }

            // Build metadata
            FileMetadata metadata = new FileMetadata();
            metadata.setBucketName(bucketName);
            metadata.setFileName(fileName);
            metadata.setFileUrl(path);
            metadata.setFileSize(size);
            metadata.setContentType(contentType);
            metadata.setFileType(FilenameUtils.getExtension(fileName));
            metadata.setStorageType(getStorageType());

            return metadata;
        }
        catch (Exception e) {
            logger.error("FTP上传文件失败: {}", location.getPath(), e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 从FTP存储获取对象
     *
     * @param location 存储位置
     * @return 文件输入流
     */
    @Override
    public InputStream get(StorageLocation location) {
        return doDownloadFile(location.getPath(), location.getBucketOrRoot());
    }

    /**
     * 检查FTP对象是否存在
     *
     * @param location 存储位置
     * @return true-存在，false-不存在
     */
    @Override
    public boolean exists(StorageLocation location) {
        try {
            FTPClient ftpClient = getClient();
            ftpClient.enterLocalPassiveMode();

            String normalizedPath = location.getPath().replace('\\', '/');
            int lastSlashIndex = normalizedPath.lastIndexOf('/');
            String targetDir = lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : "";
            String fileName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : normalizedPath;

            if (StringUtils.isBlank(fileName)) {
                return false;
            }

            if (StringUtils.isNotBlank(targetDir) && !ftpClient.changeWorkingDirectory(targetDir)) {
                return false;
            }

            FTPFile[] files = ftpClient.listFiles(fileName);
            return files != null && files.length > 0;
        }
        catch (Exception e) {
            logger.error("FTP检查文件是否存在失败: {}", location.getPath(), e);
            return false;
        }
    }

    /**
     * 从FTP存储删除对象
     *
     * @param location 存储位置
     */
    @Override
    public void delete(StorageLocation location) {
        doDeleteFile(location.getPath(), location.getBucketOrRoot());
    }

    /**
     * 列举FTP存储中的对象
     *
     * @param prefix 存储前缀
     * @param maxDepth 最大递归深度（null表示无限制）
     * @return 对象列表
     */
    @Override
    public List<StorageObject> list(StoragePrefix prefix, Integer maxDepth) {
        List<StorageObject> result = new ArrayList<>();
        try {
            FTPClient ftpClient = getClient();
            ftpClient.enterLocalPassiveMode();

            String bucketOrRoot = prefix.getBucketOrRoot();
            String prefixPath = prefix.getPrefix();
            boolean recursive = prefix.isRecursive();

            // Normalize prefix path
            String normalizedPrefix = StringUtils.isNotBlank(prefixPath)
                ? prefixPath.replace('\\', '/')
                : "";

            // Change to the prefix directory
            if (StringUtils.isNotBlank(normalizedPrefix)) {
                if (!ftpClient.changeWorkingDirectory(normalizedPrefix)) {
                    // Directory doesn't exist, return empty list
                    return result;
                }
            }

            // List files
            if (recursive) {
                listRecursive(ftpClient, normalizedPrefix, bucketOrRoot, result, 0,
                    maxDepth != null ? maxDepth : Integer.MAX_VALUE);
            } else {
                listNonRecursive(ftpClient, normalizedPrefix, bucketOrRoot, result);
            }

            return result;
        }
        catch (Exception e) {
            logger.error("FTP列举对象失败: {}", prefix.getPrefix(), e);
            throw new BaseException(e.getMessage(), e);
        }
    }

    /**
     * 非递归列举当前目录
     */
    private void listNonRecursive(FTPClient ftpClient, String currentPath, String bucketOrRoot,
                                   List<StorageObject> result) throws IOException {
        FTPFile[] files = ftpClient.listFiles();
        if (files == null) {
            return;
        }

        for (FTPFile file : files) {
            String fileName = file.getName();
            if (".".equals(fileName) || "..".equals(fileName)) {
                continue;
            }

            String fullPath = StringUtils.isNotBlank(currentPath)
                ? currentPath + "/" + fileName
                : fileName;

            StorageObject obj = StorageObject.builder()
                .bucketOrRoot(bucketOrRoot)
                .path(fullPath)
                .size(file.getSize())
                .isDir(file.isDirectory())
                .lastModified(file.getTimestamp() != null
                    ? file.getTimestamp().toInstant().toString()
                    : null)
                .build();

            result.add(obj);
        }
    }

    /**
     * 递归列举目录
     */
    private void listRecursive(FTPClient ftpClient, String currentPath, String bucketOrRoot,
                               List<StorageObject> result, int currentDepth, int maxDepth) throws IOException {
        if (currentDepth >= maxDepth) {
            return;
        }

        FTPFile[] files = ftpClient.listFiles();
        if (files == null) {
            return;
        }

        for (FTPFile file : files) {
            String fileName = file.getName();
            if (".".equals(fileName) || "..".equals(fileName)) {
                continue;
            }

            String fullPath = StringUtils.isNotBlank(currentPath)
                ? currentPath + "/" + fileName
                : fileName;

            StorageObject obj = StorageObject.builder()
                .bucketOrRoot(bucketOrRoot)
                .path(fullPath)
                .size(file.getSize())
                .isDir(file.isDirectory())
                .lastModified(file.getTimestamp() != null
                    ? file.getTimestamp().toInstant().toString()
                    : null)
                .build();

            result.add(obj);

            // Recurse into subdirectories
            if (file.isDirectory()) {
                String savedWorkingDir = ftpClient.printWorkingDirectory();
                if (ftpClient.changeWorkingDirectory(fileName)) {
                    listRecursive(ftpClient, fullPath, bucketOrRoot, result, currentDepth + 1, maxDepth);
                    ftpClient.changeWorkingDirectory(savedWorkingDir);
                }
            }
        }
    }

    /**
     * 复制FTP对象
     * FTP协议不支持服务端复制，通过下载+上传实现
     *
     * @param source 源位置
     * @param destination 目标位置
     */
    @Override
    public void copy(StorageLocation source, StorageLocation destination) {
        InputStream sourceStream = null;
        try {
            // Download from source
            sourceStream = get(source);
            if (sourceStream == null) {
                throw new BaseException("FTP 复制文件失败: 源文件不存在 " + source.getPath());
            }

            // Get source metadata for size and content type
            FileMetadata sourceMetadata = doGetObjectMetadata(source.getPath(), source.getBucketOrRoot());
            long size = sourceMetadata != null ? sourceMetadata.getFileSize() : 0;
            String contentType = sourceMetadata != null ? sourceMetadata.getContentType() : null;

            // Upload to destination
            put(destination, sourceStream, size, contentType);

            logger.info("FTP复制文件成功: {} -> {}", source.getPath(), destination.getPath());
        }
        catch (Exception e) {
            logger.error("FTP复制文件失败: {} -> {}", source.getPath(), destination.getPath(), e);
            throw new BaseException(e.getMessage(), e);
        }
        finally {
            if (sourceStream != null) {
                try {
                    sourceStream.close();
                }
                catch (IOException e) {
                    logger.warn("关闭FTP流失败", e);
                }
            }
        }
    }

}
