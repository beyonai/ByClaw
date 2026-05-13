package com.iwhalecloud.byai.state.domain.resource.service;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.config.FtpConfig;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.jcraft.jsch.Channel;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import org.apache.commons.net.ftp.FTPFile;
import org.apache.commons.net.ftp.FTPClient;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.Vector;
import java.util.stream.Stream;

/**
 * 资源包文件上传组件。
 * 用于把 zip/json 这类资源文件上传到开放资源目录的指定业务子目录。
 * @author qin.guoquan
 * @date 2026-04-18 15:00:08
 */
@Service
public class ResourcePackageFtpUploadService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ResourcePackageFtpUploadService.class);

    @Autowired
    private FileIngressService fileIngressService;

    @Autowired
    private FtpConfig ftpConfig;

    @Autowired
    private ResourceArtifactPathResolver pathResolver;

    public void uploadToSubdirectory(byte[] content, String subDirectory, String fileName, String contentType) {
        String absoluteBasePath = pathResolver.resolveFtpAbsoluteBasePath();
        if (StringUtils.isBlank(absoluteBasePath)) {
            LOGGER.warn("未配置 file.storage.ftp.path，跳过资源文件远程同步");
            return;
        }
        MultipartFileUtil multipartFile = new MultipartFileUtil(fileName, fileName, contentType, content);
        ObjectStorageConfiguration.setStorageType(ftpConfig.getType());
        FileStorageContext fileStorageContext = FileStorageContext.ftpCustomBasePathWithSubdirectory(absoluteBasePath, subDirectory, true);
        fileIngressService.uploadFile(multipartFile, fileStorageContext);
        LOGGER.info("资源文件已同步至开放资源目录: {}/{}", subDirectory, fileName);
    }

    /**
     * 将本地解压目录原样同步到开放资源 FTP 子目录下。
     * 目录结构保持不变，后续再追加生成的 VIEW/OBJECT JSON 文件。
     */
    public void uploadDirectoryToSubdirectory(Path localRoot, String subDirectory) {
        if (localRoot == null || !Files.isDirectory(localRoot)) {
            throw new IllegalArgumentException("本地解压目录不存在");
        }
        try (Stream<Path> pathStream = Files.walk(localRoot)) {
            pathStream
                .filter(Files::isRegularFile)
                .filter(path -> !isMacMetadataPath(localRoot, path))
                .forEach(path -> uploadSingleLocalFile(localRoot, path, subDirectory));
            LOGGER.info("资源目录已同步至开放资源目录: localRoot={}, remoteDir={}", localRoot, subDirectory);
        } catch (IOException e) {
            throw new BaseException("资源目录同步失败", e);
        }
    }

    /**
     * 在开放资源根目录下重命名文件或目录。
     * oldRelativePath/newRelativePath 都是相对于 MID_FTP_PATH_RESOURCE 的路径，例如：
     * view/import_package_owl_onto.zip -> view/VIEW_1&2.zip
     */
    public void renameWithinResourceRoot(String oldRelativePath, String newRelativePath) {
        String absoluteBasePath = pathResolver.resolveFtpAbsoluteBasePath();
        if (StringUtils.isBlank(absoluteBasePath)) {
            LOGGER.warn("未配置 file.storage.ftp.path，跳过资源文件重命名: {} -> {}", oldRelativePath, newRelativePath);
            return;
        }
        String oldAbsolutePath = buildAbsoluteResourcePath(absoluteBasePath, oldRelativePath);
        String newAbsolutePath = buildAbsoluteResourcePath(absoluteBasePath, newRelativePath);
        String storageType = StringUtils.defaultString(ftpConfig.getType()).toLowerCase();
        if (StringUtils.equals(storageType, StorageType.SFTP)) {
            renameOnSftp(oldAbsolutePath, newAbsolutePath);
            return;
        }
        if (StringUtils.equals(storageType, StorageType.FTP)) {
            renameOnFtp(oldAbsolutePath, newAbsolutePath);
            return;
        }
        throw new IllegalArgumentException("当前存储类型不支持资源文件重命名: " + ftpConfig.getType());
    }

    /**
     * 删除开放资源根目录下的文件或目录。
     * 重复导入时先清理旧的 staging/bundle 产物，避免旧 JSON 继续被后续 bundle 目录引用。
     */
    public void deleteWithinResourceRoot(String relativePath) {
        String absoluteBasePath = pathResolver.resolveFtpAbsoluteBasePath();
        if (StringUtils.isBlank(absoluteBasePath)) {
            LOGGER.warn("未配置 file.storage.ftp.path，跳过资源文件删除: {}", relativePath);
            return;
        }
        String absolutePath = buildAbsoluteResourcePath(absoluteBasePath, relativePath);
        String storageType = StringUtils.defaultString(ftpConfig.getType()).toLowerCase();
        if (StringUtils.equals(storageType, StorageType.SFTP)) {
            deleteOnSftp(absolutePath);
            return;
        }
        if (StringUtils.equals(storageType, StorageType.FTP)) {
            deleteOnFtp(absolutePath);
            return;
        }
        throw new IllegalArgumentException("当前存储类型不支持资源文件删除: " + ftpConfig.getType());
    }

    /**
     * 判断开放资源根目录下的文件是否存在。
     *
     * 目前主要给数字员工同步后的“关联资源 JSON 缺失补发”场景复用。
     * 这里统一对 FTP / SFTP 做存在性判断，避免业务层自己关心底层协议差异。
     */
    public boolean existsWithinResourceRoot(String relativePath) {
        String absoluteBasePath = pathResolver.resolveFtpAbsoluteBasePath();
        if (StringUtils.isBlank(absoluteBasePath)) {
            LOGGER.warn("未配置 file.storage.ftp.path，跳过资源文件存在性判断: {}", relativePath);
            return false;
        }
        String absolutePath = buildAbsoluteResourcePath(absoluteBasePath, relativePath);
        String storageType = StringUtils.defaultString(ftpConfig.getType()).toLowerCase();
        if (StringUtils.equals(storageType, StorageType.SFTP)) {
            return existsOnSftp(absolutePath);
        }
        if (StringUtils.equals(storageType, StorageType.FTP)) {
            return existsOnFtp(absolutePath);
        }
        throw new IllegalArgumentException("当前存储类型不支持资源文件存在性判断: " + ftpConfig.getType());
    }

    private String buildAbsoluteResourcePath(String absoluteBasePath, String relativePath) {
        String base = stripTrailingSlashes(absoluteBasePath);
        String relative = normalizeRelativeSubdir(relativePath);
        return StringUtils.isBlank(relative) ? base : base + "/" + relative;
    }

    private void uploadSingleLocalFile(Path localRoot, Path filePath, String subDirectory) {
        try {
            byte[] bytes = Files.readAllBytes(filePath);
            String relativeFilePath = normalizeRelativeSubdir(localRoot.relativize(filePath).toString());
            String remoteDir = subDirectory;
            String fileName = filePath.getFileName().toString();
            int slashIndex = relativeFilePath.lastIndexOf('/');
            if (slashIndex >= 0) {
                remoteDir = subDirectory + "/" + relativeFilePath.substring(0, slashIndex);
            }
            uploadToSubdirectory(bytes, remoteDir, fileName, "application/octet-stream");
        } catch (IOException e) {
            throw new BaseException("资源目录文件上传失败: " + filePath, e);
        }
    }

    private void renameOnFtp(String oldAbsolutePath, String newAbsolutePath) {
        FTPClient ftpClient = new FTPClient();
        try {
            ftpClient.connect(ftpConfig.getHost(), ftpConfig.getPort());
            if (!ftpClient.login(ftpConfig.getUser(), ftpConfig.getPwd())) {
                throw new BaseException("FTP 登录失败");
            }
            ftpClient.setFileType(FTPClient.BINARY_FILE_TYPE);
            ftpClient.enterLocalPassiveMode();
            ensureFtpAbsolutePathExists(ftpClient, parentDirectory(newAbsolutePath));
            if (ftpClient.listFiles(oldAbsolutePath).length == 0) {
                LOGGER.warn("资源文件FTP源路径不存在，跳过重命名: {}", oldAbsolutePath);
                return;
            }
            if (!ftpClient.rename(oldAbsolutePath, newAbsolutePath)) {
                throw new BaseException("FTP 重命名失败: " + oldAbsolutePath + " -> " + newAbsolutePath);
            }
            LOGGER.info("资源文件FTP重命名成功: {} -> {}", oldAbsolutePath, newAbsolutePath);
        } catch (Exception e) {
            LOGGER.error("资源文件FTP重命名失败: {} -> {}", oldAbsolutePath, newAbsolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } finally {
            if (ftpClient.isConnected()) {
                try {
                    ftpClient.logout();
                } catch (IOException ignored) {
                }
                try {
                    ftpClient.disconnect();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private boolean existsOnFtp(String absolutePath) {
        FTPClient ftpClient = new FTPClient();
        try {
            ftpClient.connect(ftpConfig.getHost(), ftpConfig.getPort());
            if (!ftpClient.login(ftpConfig.getUser(), ftpConfig.getPwd())) {
                throw new BaseException("FTP 登录失败");
            }
            ftpClient.setFileType(FTPClient.BINARY_FILE_TYPE);
            ftpClient.enterLocalPassiveMode();
            return ftpExists(ftpClient, absolutePath);
        } catch (Exception e) {
            LOGGER.error("资源文件FTP存在性判断失败: {}", absolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } finally {
            if (ftpClient.isConnected()) {
                try {
                    ftpClient.logout();
                } catch (IOException ignored) {
                }
                try {
                    ftpClient.disconnect();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private void deleteOnFtp(String absolutePath) {
        FTPClient ftpClient = new FTPClient();
        try {
            ftpClient.connect(ftpConfig.getHost(), ftpConfig.getPort());
            if (!ftpClient.login(ftpConfig.getUser(), ftpConfig.getPwd())) {
                throw new BaseException("FTP 登录失败");
            }
            ftpClient.setFileType(FTPClient.BINARY_FILE_TYPE);
            ftpClient.enterLocalPassiveMode();
            if (!ftpExists(ftpClient, absolutePath)) {
                LOGGER.warn("资源文件FTP源路径不存在，跳过删除: {}", absolutePath);
                return;
            }
            deleteRecursivelyOnFtp(ftpClient, absolutePath);
            LOGGER.info("资源文件FTP删除成功: {}", absolutePath);
        } catch (Exception e) {
            LOGGER.error("资源文件FTP删除失败: {}", absolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } finally {
            if (ftpClient.isConnected()) {
                try {
                    ftpClient.logout();
                } catch (IOException ignored) {
                }
                try {
                    ftpClient.disconnect();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private void renameOnSftp(String oldAbsolutePath, String newAbsolutePath) {
        Session session = null;
        ChannelSftp channelSftp = null;
        try {
            JSch jsch = new JSch();
            session = jsch.getSession(ftpConfig.getUser(), ftpConfig.getHost(), ftpConfig.getPort());
            session.setPassword(ftpConfig.getPwd());
            Properties sshConfig = new Properties();
            sshConfig.put("StrictHostKeyChecking", "no");
            session.setConfig(sshConfig);
            session.connect();

            Channel channel = session.openChannel("sftp");
            channel.connect();
            channelSftp = (ChannelSftp) channel;
            ensureSftpAbsolutePathExists(channelSftp, parentDirectory(newAbsolutePath));
            try {
                channelSftp.stat(oldAbsolutePath);
            } catch (SftpException e) {
                if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    LOGGER.warn("资源文件SFTP源路径不存在，跳过重命名: {}", oldAbsolutePath);
                    return;
                }
                throw e;
            }
            channelSftp.rename(oldAbsolutePath, newAbsolutePath);
            LOGGER.info("资源文件SFTP重命名成功: {} -> {}", oldAbsolutePath, newAbsolutePath);
        } catch (Exception e) {
            LOGGER.error("资源文件SFTP重命名失败: {} -> {}", oldAbsolutePath, newAbsolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } finally {
            if (channelSftp != null && channelSftp.isConnected()) {
                channelSftp.disconnect();
            }
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }

    private boolean existsOnSftp(String absolutePath) {
        Session session = null;
        ChannelSftp channelSftp = null;
        try {
            JSch jsch = new JSch();
            session = jsch.getSession(ftpConfig.getUser(), ftpConfig.getHost(), ftpConfig.getPort());
            session.setPassword(ftpConfig.getPwd());
            Properties sshConfig = new Properties();
            sshConfig.put("StrictHostKeyChecking", "no");
            session.setConfig(sshConfig);
            session.connect();

            Channel channel = session.openChannel("sftp");
            channel.connect();
            channelSftp = (ChannelSftp) channel;
            channelSftp.stat(absolutePath);
            return true;
        } catch (SftpException e) {
            if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                return false;
            }
            LOGGER.error("资源文件SFTP存在性判断失败: {}", absolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } catch (Exception e) {
            LOGGER.error("资源文件SFTP存在性判断失败: {}", absolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } finally {
            if (channelSftp != null && channelSftp.isConnected()) {
                channelSftp.disconnect();
            }
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }

    private void deleteOnSftp(String absolutePath) {
        Session session = null;
        ChannelSftp channelSftp = null;
        try {
            JSch jsch = new JSch();
            session = jsch.getSession(ftpConfig.getUser(), ftpConfig.getHost(), ftpConfig.getPort());
            session.setPassword(ftpConfig.getPwd());
            Properties sshConfig = new Properties();
            sshConfig.put("StrictHostKeyChecking", "no");
            session.setConfig(sshConfig);
            session.connect();

            Channel channel = session.openChannel("sftp");
            channel.connect();
            channelSftp = (ChannelSftp) channel;
            try {
                channelSftp.stat(absolutePath);
            } catch (SftpException e) {
                if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    LOGGER.warn("资源文件SFTP源路径不存在，跳过删除: {}", absolutePath);
                    return;
                }
                throw e;
            }
            deleteRecursivelyOnSftp(channelSftp, absolutePath);
            LOGGER.info("资源文件SFTP删除成功: {}", absolutePath);
        } catch (Exception e) {
            LOGGER.error("资源文件SFTP删除失败: {}", absolutePath, e);
            throw new BaseException(e.getMessage(), e);
        } finally {
            if (channelSftp != null && channelSftp.isConnected()) {
                channelSftp.disconnect();
            }
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }

    private static String parentDirectory(String absolutePath) {
        if (StringUtils.isBlank(absolutePath)) {
            return "";
        }
        String normalized = absolutePath.replace('\\', '/');
        int lastSlash = normalized.lastIndexOf('/');
        return lastSlash > 0 ? normalized.substring(0, lastSlash) : "";
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

    private static boolean ftpExists(FTPClient ftpClient, String absolutePath) throws IOException {
        FTPFile[] files = ftpClient.listFiles(absolutePath);
        return files != null && files.length > 0;
    }

    private static boolean isMacMetadataPath(Path localRoot, Path filePath) {
        Path relativePath = localRoot.relativize(filePath);
        for (Path part : relativePath) {
            String name = StringUtils.trimToEmpty(part.toString());
            if (StringUtils.equalsIgnoreCase(name, "__MACOSX") || name.startsWith("._")) {
                return true;
            }
        }
        return false;
    }

    private static void deleteRecursivelyOnFtp(FTPClient ftpClient, String absolutePath) throws IOException {
        if (ftpClient.deleteFile(absolutePath)) {
            return;
        }
        FTPFile[] files = ftpClient.listFiles(absolutePath);
        if (files == null || files.length == 0) {
            if (!ftpClient.removeDirectory(absolutePath) && !ftpClient.deleteFile(absolutePath)) {
                throw new BaseException("FTP 删除失败: " + absolutePath);
            }
            return;
        }
        for (FTPFile file : files) {
            String name = file.getName();
            if (StringUtils.equals(name, ".") || StringUtils.equals(name, "..")) {
                continue;
            }
            String childPath = absolutePath + "/" + name;
            if (file.isDirectory()) {
                deleteRecursivelyOnFtp(ftpClient, childPath);
            } else {
                if (!ftpClient.deleteFile(childPath)) {
                    throw new BaseException("FTP 删除文件失败: " + childPath);
                }
            }
        }
        if (!ftpClient.removeDirectory(absolutePath)) {
            throw new BaseException("FTP 删除目录失败: " + absolutePath);
        }
    }

    private static void deleteRecursivelyOnSftp(ChannelSftp channelSftp, String absolutePath) throws SftpException {
        SftpATTRS attrs = channelSftp.stat(absolutePath);
        if (!attrs.isDir()) {
            channelSftp.rm(absolutePath);
            return;
        }
        @SuppressWarnings("unchecked")
        Vector<ChannelSftp.LsEntry> entries = channelSftp.ls(absolutePath);
        for (ChannelSftp.LsEntry entry : entries) {
            String name = entry.getFilename();
            if (StringUtils.equals(name, ".") || StringUtils.equals(name, "..")) {
                continue;
            }
            String childPath = absolutePath + "/" + name;
            if (entry.getAttrs().isDir()) {
                deleteRecursivelyOnSftp(channelSftp, childPath);
            } else {
                channelSftp.rm(childPath);
            }
        }
        channelSftp.rmdir(absolutePath);
    }

    private static void ensureFtpAbsolutePathExists(FTPClient ftp, String absoluteDir) throws IOException {
        if (StringUtils.isBlank(absoluteDir)) {
            return;
        }
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
            }
        }
    }

    private static void ensureSftpAbsolutePathExists(ChannelSftp sftp, String absoluteDir) throws SftpException {
        if (StringUtils.isBlank(absoluteDir)) {
            return;
        }
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
            } catch (SftpException e) {
                if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    sftp.mkdir(path);
                } else {
                    throw e;
                }
            }
        }
    }
}
