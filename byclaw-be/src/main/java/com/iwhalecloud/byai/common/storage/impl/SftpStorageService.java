package com.iwhalecloud.byai.common.storage.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.InputStream;
import java.util.Properties;

import org.apache.commons.lang3.StringUtils;
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
import com.jcraft.jsch.Channel;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpException;

/**
 * SFTP存储服务实现类 提供基于SFTP的文件存储功能
 *
 * @author he.duming
 * @date 2025-12-18 20:52:38
 */
@Component
public class SftpStorageService extends AbstractFileIngressStorageService<Session> {

    private static final Logger logger = LoggerFactory.getLogger(SftpStorageService.class);


    @Autowired
    private FtpConfig ftpConfig;

    /**
     * 获取存储类型
     *
     * @return 存储类型标识
     */
    @Override
    public String getStorageType() {
        return StorageType.SFTP;
    }

    /**
     * 创建MinIO客户端
     *
     * @return MinIO客户端实例
     * @throws BaseException 客户端创建失败时抛出异常
     */
    @Override
    protected Session createStorageClient() {
        try {
            JSch jsch = new JSch();
            Session sshSession = jsch.getSession(ftpConfig.getUser(), ftpConfig.getHost(), ftpConfig.getPort());
            sshSession.setPassword(ftpConfig.getPwd());
            Properties sshConfig = new Properties();
            sshConfig.put("StrictHostKeyChecking", "no");
            sshSession.setConfig(sshConfig);
            sshSession.connect();
            return sshSession;
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

        ChannelSftp shannelSftp = null;
        Session session = null;

        try {

            session = this.getClient();

            Channel channel = session.openChannel("sftp");
            channel.connect();
            shannelSftp = (ChannelSftp) channel;

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
            } else if (usePathRoot) {
                String base = stripTrailingSlashes(ftpConfig.getPath());
                String sub = normalizeRelativeSubdir(storagePath);
                targetDir = sub.isEmpty() ? base : base + "/" + sub;
                pathForUrl = targetDir;
            } else {
                String path = StringUtils.isBlank(storagePath) ? ftpConfig.getPath() : storagePath;
                targetDir = stripTrailingSlashes(path);
                pathForUrl = path;
            }

            if (targetDir.startsWith("/")) {
                ensureSftpAbsolutePathExists(shannelSftp, targetDir);
            }
            shannelSftp.cd(targetDir);

            String originalFilename = multipartFile.getOriginalFilename();
            shannelSftp.put(multipartFile.getInputStream(), originalFilename);

            return buildFileMetadata(multipartFile, UrlUtil.concatUrl(pathForUrl, originalFilename), bucketName, null);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(e.getMessage(), e);
        }
        finally {
            this.closeSftp(session, shannelSftp);
        }
    }

    /** 去掉首尾空白与尾部 /，保留首部 /（用于绝对目录） */
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

    /** 业务子目录：去掉首尾 /，不含盘符 */
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
     * 逐级创建绝对路径目录（以 / 开头）
     */
    private static void ensureSftpAbsolutePathExists(ChannelSftp sftp, String absoluteDir) throws SftpException {
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
            try {
                sftp.stat(path);
            }
            catch (SftpException e) {
                if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    sftp.mkdir(path);
                }
                else {
                    throw e;
                }
            }
        }
    }

    /**
     * 关闭sftp连接
     *
     * @param sshSession session
     * @param sftp ChannelSftp
     */
    private void closeSftp(Session sshSession, ChannelSftp sftp) {
        // 关闭session
        if (sshSession != null && sshSession.isConnected()) {
            sshSession.disconnect();
        }
        // 判断连接
        if (sftp != null && sftp.isConnected()) {
            sftp.disconnect();
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
        ChannelSftp shannelSftp = null;
        Session session = null;
        try {
            session = this.getClient();
            Channel channel = session.openChannel("sftp");
            channel.connect();
            shannelSftp = (ChannelSftp) channel;
            shannelSftp.rm(objectUrl.replace('\\', '/'));
        }
        catch (Exception e) {
            logger.error("SFTP删除文件失败: {}", objectUrl, e);
            throw new BaseException(e.getMessage(), e);
        }
        finally {
            this.closeSftp(session, shannelSftp);
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
