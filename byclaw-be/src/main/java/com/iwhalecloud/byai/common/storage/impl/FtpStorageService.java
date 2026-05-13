package com.iwhalecloud.byai.common.storage.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.io.InputStream;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.net.ftp.FTPClient;
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
     * 从MinIO下载文件
     *
     * @param fileId 文件ID
     * @param bucketName 存储桶名称
     * @return 文件输入流
     * @throws BaseException 文件不存在或下载失败时抛出异常
     */
    @Override
    protected InputStream doDownloadFile(String fileId, String bucketName) {
        return null;
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
     * 获取MinIO对象的元数据信息
     *
     * @param objectKey 对象键
     * @param bucketName 存储桶名称
     * @return 文件元数据信息
     * @throws BaseException 文件不存在或获取元数据失败时抛出异常
     */
    @Override
    protected FileMetadata doGetObjectMetadata(String objectKey, String bucketName) {
        return null;
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

}
