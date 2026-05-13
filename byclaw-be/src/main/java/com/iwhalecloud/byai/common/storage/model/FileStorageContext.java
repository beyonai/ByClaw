package com.iwhalecloud.byai.common.storage.model;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

import com.iwhalecloud.byai.common.storage.constants.StorageCategory;

import lombok.Getter;
import lombok.Setter;

/**
 * 对象存储上下文
 *
 * @author hux
 * @date 2025-08-26
 */
public final class FileStorageContext {

    @Setter
    @Getter
    private String storageType;

    @Getter
    private final StorageCategory storageCategory;

    @Getter
    private boolean useOriginalName = true;

    /**
     * true：SFTP/FTP 上传根目录使用 {@code pathResource}，并在远端创建 {@link #storagePath} 子目录
     */
    @Getter
    private final boolean ftpUsePathResourceRoot;

    /**
     * true：SFTP/FTP 上传根目录使用 {@code path}，并在远端创建 {@link #storagePath} 子目录
     */
    @Getter
    private final boolean ftpUsePathRoot;

    /**
     * 当需要覆盖 FTP/SFTP 默认根目录时使用的自定义绝对根路径。 主要用于把资源产物统一挂到 file.storage.ftp.path，而不是历史上的 ftp.pathResource。
     */
    @Getter
    private final String ftpCustomAbsoluteBasePath;

    private final String storagePath;

    private FileStorageContext(StorageCategory storageCategory, String storagePath, boolean useOriginalName,
        boolean ftpUsePathResourceRoot, boolean ftpUsePathRoot, String ftpCustomAbsoluteBasePath) {
        this.storageCategory = storageCategory;
        this.storagePath = storagePath;
        this.useOriginalName = useOriginalName;
        this.ftpUsePathResourceRoot = ftpUsePathResourceRoot;
        this.ftpUsePathRoot = ftpUsePathRoot;
        this.ftpCustomAbsoluteBasePath = ftpCustomAbsoluteBasePath;
    }

    private FileStorageContext(StorageCategory storageCategory, String storagePath) {
        this(storageCategory, storagePath, true, false, false, null);
    }

    private FileStorageContext(StorageCategory storageCategory, String storagePath, boolean useOriginalName) {
        this(storageCategory, storagePath, useOriginalName, false, false, null);
    }

    public String getPath() {
        if (storagePath == null || storagePath.isEmpty()) {
            return "";
        }
        if (!storagePath.endsWith("/")) {
            return storagePath + "/";
        }
        return storagePath;
    }

    public static FileStorageContext icon(Long userId) {
        String path = StorageCategory.ICON.getPathTemplate().replace("{userId}", String.valueOf(userId))
            .replace("{date}", getDatePath());
        return new FileStorageContext(StorageCategory.ICON, path);
    }

    public static FileStorageContext datasetFile(Long datasetId, Long fileId) {
        String path = StorageCategory.DATASET.getPathTemplate().replace("{datasetId}", String.valueOf(datasetId))
            .replace("{fileId}", String.valueOf(fileId));
        return new FileStorageContext(StorageCategory.DATASET, path);
    }

    public static FileStorageContext chatFile(Long userId) {
        String path = StorageCategory.CHAT_FILE.getPathTemplate().replace("{userId}", String.valueOf(userId))
            .replace("{date}", getDatePath());
        return new FileStorageContext(StorageCategory.CHAT_FILE, path);
    }

    public static FileStorageContext searchFile(Long sessionId, Long requestId) {
        String path = StorageCategory.SEARCH_FILE.getPathTemplate().replace("{sessionId}", String.valueOf(sessionId))
            .replace("{requestId}", String.valueOf(requestId));
        return new FileStorageContext(StorageCategory.SEARCH_FILE, path);
    }

    public static FileStorageContext searchImport(Long sessionId, Long fileId) {
        String path = StorageCategory.SEARCH_IMPORT.getPathTemplate().replace("{sessionId}", String.valueOf(sessionId))
            .replace("{fileId}", String.valueOf(fileId));
        return new FileStorageContext(StorageCategory.SEARCH_FILE, path, true);
    }

    public static FileStorageContext file(Long userId) {
        String path = StorageCategory.FILE.getPathTemplate().replace("{userId}", String.valueOf(userId))
            .replace("{date}", getDatePath());
        return new FileStorageContext(StorageCategory.FILE, path);
    }

    /**
     * 会话上传mino
     *
     * @param userCode 用户编码
     * @param sessionId 会话标识
     * @return FileStorageContext
     */
    public static FileStorageContext sessionImport(String userCode, Long sessionId) {
        String path = StorageCategory.SESSION_IMPORT.getPathTemplate().replace("{userCode}", userCode)
            .replace("{sessionId}", String.valueOf(sessionId));
        return new FileStorageContext(StorageCategory.FILE, path);
    }

    /**
     * SFTP/FTP：直接使用配置 {@code path}（如 MID_FTP_PATH）作为上传根目录，不追加任何业务子目录。 类别使用
     * {@link StorageCategory#FILE}，实际远端路径由底层存储实现回退到 ftp.path。
     *
     * @param useOriginalName 是否保留原始文件名
     */
    public static FileStorageContext ftpPathRoot(boolean useOriginalName) {
        return new FileStorageContext(StorageCategory.FILE, null, useOriginalName, false, false, null);
    }

    /**
     * SFTP/FTP：根目录由配置 {@code path}（如 MID_FTP_PATH）指定，在其下 {@code relativeSubDir} 上传；服务端自动建目录。
     *
     * @param relativeSubDir 相对子路径，可含多级；首尾 {@code /} 可选
     * @param useOriginalName 是否保留原始文件名
     */
    public static FileStorageContext ftpPathWithSubdirectory(String relativeSubDir, boolean useOriginalName) {
        String p = relativeSubDir == null ? "" : relativeSubDir.trim().replace('\\', '/');
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        while (p.endsWith("/") && p.length() > 1) {
            p = p.substring(0, p.length() - 1);
        }
        if (!p.isEmpty()) {
            p = p + "/";
        }
        return new FileStorageContext(StorageCategory.FILE, p, useOriginalName, false, true, null);
    }

    /**
     * SFTP/FTP：根目录由配置 {@code pathResource}（如 MID_FTP_PATH_RESOURCE）指定，在其下 {@code relativeSubDir} 上传；服务端自动建目录。 类别使用
     * {@link StorageCategory#FILE}，实际远端路径不依赖 FILE 的路径模板。
     *
     * @param relativeSubDir 相对子路径，可含多级；首尾 {@code /} 可选
     * @param useOriginalName 是否保留原始文件名
     */
    public static FileStorageContext ftpPathResourceWithSubdirectory(String relativeSubDir, boolean useOriginalName) {
        String p = relativeSubDir == null ? "" : relativeSubDir.trim().replace('\\', '/');
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        while (p.endsWith("/") && p.length() > 1) {
            p = p.substring(0, p.length() - 1);
        }
        if (!p.isEmpty()) {
            p = p + "/";
        }
        return new FileStorageContext(StorageCategory.FILE, p, useOriginalName, true, false, null);
    }

    /**
     * SFTP/FTP：显式指定一个绝对根目录，并在其下上传到相对子目录。 适用于资源产物等“路径根由业务统一配置”的场景。
     *
     * @param absoluteBasePath 绝对根目录，例如 /data/byai/openclaw/public/resource/
     * @param relativeSubDir 相对子路径，可含多级；首尾 {@code /} 可选
     * @param useOriginalName 是否保留原始文件名
     */
    public static FileStorageContext ftpCustomBasePathWithSubdirectory(String absoluteBasePath, String relativeSubDir,
        boolean useOriginalName) {
        String p = relativeSubDir == null ? "" : relativeSubDir.trim().replace('\\', '/');
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        while (p.endsWith("/") && p.length() > 1) {
            p = p.substring(0, p.length() - 1);
        }
        if (!p.isEmpty()) {
            p = p + "/";
        }
        return new FileStorageContext(StorageCategory.FILE, p, useOriginalName, false, false, absoluteBasePath);
    }

    public static String getDatePath() {
        // 获取当前日期，格式 yyyyMMdd
        return LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
    }

    /**
     * 沙箱工作空间文件上传上下文。storagePath 挂载绝对路径（如 "/data/byai/openclaw/userCode/.openclaw/"）。 不设置
     * ftpUsePathResourceRoot，适用于所有后端（MinIO/FTP/SFTP/Local）。
     *
     * @param storagePath 挂载绝对路径
     * @param storageType 存储类型
     * @return 沙箱工作空间文件存储上下文
     */
    public static FileStorageContext sandboxWorkspace(String storagePath, String storageType) {
        FileStorageContext fileStorageContext = new FileStorageContext(StorageCategory.FILE,
            storagePath == null ? "" : storagePath);
        fileStorageContext.setStorageType(storageType);
        return fileStorageContext;
    }

}
