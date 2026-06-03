package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.files.FileStatus;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.file.FilesMapper;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemRunVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 生态采集产物落地服务。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class EcosystemArtifactStorageService {

    /**
     * 统一文件入口服务；实际写 MinIO、FTP、SFTP、Local 由文件存储配置决定。
     */
    @Autowired
    private FileIngressService fileIngressService;

    /**
     * files 表 Mapper，用于写入采集产物对应的文件元数据。
     */
    @Autowired
    private FilesMapper filesMapper;

    /**
     * 全局序列服务，用于生成 files 表文件 ID。
     */
    @Autowired
    private SequenceService sequenceService;

    /**
     * JSON 序列化器，用于生成 raw 和 manifest 产物。
     */
    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 将 OpenCLI 采集结果落到统一文件存储，并返回可入库的 Markdown 文件和产物视图。
     *
     * @param runId 本次采集运行 ID
     * @param task 采集任务配置
     * @param collectionResult OpenCLI 采集结果
     * @return 存储结果，包含对象存储路径、产物清单和待导入 Markdown 文件
     */
    public StorageResult store(Long runId, EcosystemTaskVo task, OpenCliRunner.CollectionResult collectionResult) {
        String artifactBasePath = "ecosystem/users/" + currentUserId() + "/runs/" + runId + "/";
        FileStorageContext storageContext = FileStorageContext.sandboxWorkspace(artifactBasePath, null);
        StorageResult result = new StorageResult();
        result.setStoragePath(artifactBasePath);

        int index = 1;
        for (OpenCliRunner.CollectionItem item : collectionResult.getItems()) {
            String fileName = uniqueFileName(index++, item.getFileName(), ".md");
            byte[] bytes = item.getMarkdown().getBytes(StandardCharsets.UTF_8);
            StoredFile storedFile = uploadAndPersist(fileName, "text/markdown", bytes, storageContext, task);
            storedFile.setArtifactType("MARKDOWN");
            storedFile.setArtifactName(item.getTitle());
            storedFile.setSourceUrl(item.getSourceUrl());
            storedFile.setItemCount(1);
            result.getArtifacts().add(toArtifactVo(storedFile));
            result.getMarkdownFiles().add(new MarkdownImportFile(fileName, bytes));
        }

        for (Path asset : listAssetFiles(collectionResult.getOutputDir())) {
            StoredFile storedFile = uploadAndPersist(asset.getFileName().toString(), contentType(asset),
                readBytes(asset), storageContext, task);
            storedFile.setArtifactType("ASSET");
            storedFile.setArtifactName(asset.getFileName().toString());
            storedFile.setItemCount(1);
            result.getArtifacts().add(toArtifactVo(storedFile));
        }

        StoredFile rawFile = uploadAndPersist("raw-opencli-output.json", "application/json",
            rawPayload(collectionResult).getBytes(StandardCharsets.UTF_8), storageContext, task);
        rawFile.setArtifactType("RAW");
        rawFile.setArtifactName(i18n("ecosystem.artifact.raw.name", task.getSourceName()));
        rawFile.setItemCount(collectionResult.getItems().size());
        result.getArtifacts().add(toArtifactVo(rawFile));

        StoredFile manifestFile = uploadAndPersist("manifest.json", "application/json",
            manifestPayload(runId, task, collectionResult, result).getBytes(StandardCharsets.UTF_8), storageContext,
            task);
        manifestFile.setArtifactType("MANIFEST");
        manifestFile.setArtifactName("manifest.json");
        manifestFile.setItemCount(1);
        result.getArtifacts().add(toArtifactVo(manifestFile));

        return result;
    }

    /**
     * 上传单个采集产物，并同步写入 files 表元数据。
     *
     * @param fileName 文件名
     * @param contentType MIME 类型
     * @param bytes 文件内容
     * @param storageContext 文件存储上下文
     * @param task 采集任务，用于关联知识库资源
     * @return 已存储文件的轻量信息
     */
    private StoredFile uploadAndPersist(String fileName, String contentType, byte[] bytes,
                                        FileStorageContext storageContext, EcosystemTaskVo task) {
        Long fileId = sequenceService.nextVal();
        MultipartFile multipartFile = new MultipartFileUtil("file", fileName, contentType, bytes);
        FileMetadata metadata = fileIngressService.uploadFile(multipartFile, storageContext);

        Files file = new Files();
        file.setFileId(fileId);
        file.setFileName(fileName);
        file.setConvertFileName(fileName);
        file.setLength((long) bytes.length);
        file.setContentType(contentType);
        file.setFileSystemType(metadata.getStorageType());
        file.setFileUrl(metadata.getFileUrl());
        file.setFileType(defaultText(metadata.getFileType(), extension(fileName)));
        file.setFileMd5(metadata.getFileMd5());
        file.setUploadDate(new Date());
        file.setCreateBy(currentUserId());
        file.setDatasetId(resolveDatasetId(task));
        file.setFileCollectId(-1L);
        file.setFileStatus(FileStatus.STATUS_00A);
        filesMapper.insert(file);

        StoredFile storedFile = new StoredFile();
        storedFile.setFileId(fileId);
        storedFile.setFileName(fileName);
        storedFile.setFileUrl(metadata.getFileUrl());
        storedFile.setContentType(contentType);
        storedFile.setFileSystemType(metadata.getStorageType());
        return storedFile;
    }

    /**
     * 只有导入个人知识库时才把 files.dataset_id 关联到知识库资源 ID。
     */
    private Long resolveDatasetId(EcosystemTaskVo task) {
        if (!"knowledgeBase".equalsIgnoreCase(task.getImportTarget())) {
            return null;
        }
        return task.getKnowledgeBaseResourceId();
    }

    /**
     * 将内部文件存储结果转换为运行产物视图，供 bykc_ec_artifact 持久化和前端展示。
     */
    private EcosystemRunVo.ArtifactVo toArtifactVo(StoredFile storedFile) {
        EcosystemRunVo.ArtifactVo artifact = new EcosystemRunVo.ArtifactVo();
        artifact.setArtifactType(storedFile.getArtifactType());
        artifact.setArtifactName(storedFile.getArtifactName());
        artifact.setStoragePath(storedFile.getFileUrl());
        artifact.setItemCount(storedFile.getItemCount());
        artifact.setFileId(storedFile.getFileId());
        artifact.setFileUrl(storedFile.getFileUrl());
        artifact.setContentType(storedFile.getContentType());
        artifact.setFileSystemType(storedFile.getFileSystemType());
        artifact.setSourceUrl(storedFile.getSourceUrl());
        return artifact;
    }

    /**
     * 生成原始 OpenCLI 输出产物，便于问题回放和运行审计。
     */
    private String rawPayload(OpenCliRunner.CollectionResult collectionResult) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("command", collectionResult.getCommand());
        payload.put("rawOutput", collectionResult.getRawOutput());
        payload.put("itemCount", collectionResult.getItems().size());
        return toJson(payload);
    }

    /**
     * 生成本次采集的 manifest，记录任务、命令、数量、存储路径和产物索引。
     */
    private String manifestPayload(Long runId, EcosystemTaskVo task, OpenCliRunner.CollectionResult collectionResult,
                                   StorageResult storageResult) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("runId", runId);
        payload.put("taskId", task.getTaskId());
        payload.put("connectorCode", task.getConnectorCode());
        payload.put("sourceUrl", task.getSourceUrl());
        payload.put("command", collectionResult.getCommand());
        payload.put("markdownCount", collectionResult.getItems().size());
        payload.put("assetCount", collectionResult.getAssetCount());
        payload.put("storagePath", storageResult.getStoragePath());
        payload.put("artifacts", storageResult.getArtifacts());
        return toJson(payload);
    }

    /**
     * 枚举 OpenCLI 输出目录中的非 Markdown 附件资产。
     */
    private List<Path> listAssetFiles(Path outputDir) {
        if (outputDir == null || !java.nio.file.Files.exists(outputDir)) {
            return List.of();
        }
        try (Stream<Path> stream = java.nio.file.Files.walk(outputDir)) {
            return stream.filter(java.nio.file.Files::isRegularFile)
                .filter(path -> !path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".md"))
                .toList();
        }
        catch (IOException e) {
            return List.of();
        }
    }

    /**
     * 读取本地临时输出文件内容；读取失败时返回空内容，避免中断整个产物落地流程。
     */
    private byte[] readBytes(Path path) {
        try {
            return java.nio.file.Files.readAllBytes(path);
        }
        catch (IOException e) {
            return new byte[0];
        }
    }

    /**
     * 生成稳定、可排序、避免非法字符的 Markdown 文件名。
     */
    private String uniqueFileName(int index, String fileName, String suffix) {
        String normalized = defaultText(fileName, i18n("ecosystem.collection.item.file.name") + index + suffix)
            .replaceAll("[\\\\/:*?\"<>|]+", "_");
        if (!normalized.toLowerCase(Locale.ROOT).endsWith(suffix)) {
            normalized += suffix;
        }
        return String.format("%03d-%s", index, normalized);
    }

    /**
     * 根据附件扩展名推断 MIME 类型。
     */
    private String contentType(Path path) {
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (name.endsWith(".gif")) {
            return "image/gif";
        }
        if (name.endsWith(".webp")) {
            return "image/webp";
        }
        return "application/octet-stream";
    }

    /**
     * 获取文件扩展名，用于 files.file_type 兜底。
     */
    private String extension(String fileName) {
        int index = fileName == null ? -1 : fileName.lastIndexOf('.');
        return index >= 0 ? fileName.substring(index + 1) : "";
    }

    /**
     * 安全序列化 JSON，失败时返回空对象，避免 manifest/raw 生成阻断主流程。
     */
    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            return "{}";
        }
    }

    /**
     * 返回去空白后的文本，空值时返回默认值。
     */
    private String defaultText(String value, String defaultValue) {
        return value == null || value.trim().isEmpty() ? defaultValue : value.trim();
    }

    /**
     * 当前登录用户 ID，用于隔离对象存储路径和文件创建人。
     */
    private Long currentUserId() {
        return CurrentUserHolder.getCurrentUserId();
    }

    /**
     * 获取国际化文案。
     */
    private String i18n(String key, Object... args) {
        return I18nUtil.get(key, args);
    }

    /**
     * 采集产物存储结果。
     */
    public static class StorageResult {

        /**
         * 本次采集产物的存储路径前缀。
         */
        private String storagePath;

        /**
         * 已存储产物视图列表。
         */
        private final List<EcosystemRunVo.ArtifactVo> artifacts = new ArrayList<>();

        /**
         * 需要继续导入知识库的 Markdown 文件列表。
         */
        private final List<MarkdownImportFile> markdownFiles = new ArrayList<>();

        public String getStoragePath() {
            return storagePath;
        }

        public void setStoragePath(String storagePath) {
            this.storagePath = storagePath;
        }

        public List<EcosystemRunVo.ArtifactVo> getArtifacts() {
            return artifacts;
        }

        public List<MarkdownImportFile> getMarkdownFiles() {
            return markdownFiles;
        }
    }

    /**
     * 待导入知识库的 Markdown 文件内容。
     */
    public static class MarkdownImportFile {

        /**
         * Markdown 文件名。
         */
        private final String fileName;

        /**
         * Markdown 文件字节内容。
         */
        private final byte[] bytes;

        public MarkdownImportFile(String fileName, byte[] bytes) {
            this.fileName = fileName;
            this.bytes = bytes;
        }

        public String getFileName() {
            return fileName;
        }

        public byte[] getBytes() {
            return bytes;
        }
    }

    /**
     * 单个上传文件的内部中间态。
     */
    private static class StoredFile {

        /**
         * files 表文件 ID。
         */
        private Long fileId;

        /**
         * 文件名。
         */
        private String fileName;

        /**
         * 文件访问地址。
         */
        private String fileUrl;

        /**
         * 文件 MIME 类型。
         */
        private String contentType;

        /**
         * 文件存储后端类型。
         */
        private String fileSystemType;

        /**
         * 产物类型，MARKDOWN / ASSET / RAW / MANIFEST。
         */
        private String artifactType;

        /**
         * 产物展示名称。
         */
        private String artifactName;

        /**
         * 原始来源链接。
         */
        private String sourceUrl;

        /**
         * 产物条目数。
         */
        private Integer itemCount;

        public Long getFileId() {
            return fileId;
        }

        public void setFileId(Long fileId) {
            this.fileId = fileId;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }

        public String getFileUrl() {
            return fileUrl;
        }

        public void setFileUrl(String fileUrl) {
            this.fileUrl = fileUrl;
        }

        public String getContentType() {
            return contentType;
        }

        public void setContentType(String contentType) {
            this.contentType = contentType;
        }

        public String getFileSystemType() {
            return fileSystemType;
        }

        public void setFileSystemType(String fileSystemType) {
            this.fileSystemType = fileSystemType;
        }

        public String getArtifactType() {
            return artifactType;
        }

        public void setArtifactType(String artifactType) {
            this.artifactType = artifactType;
        }

        public String getArtifactName() {
            return artifactName;
        }

        public void setArtifactName(String artifactName) {
            this.artifactName = artifactName;
        }

        public String getSourceUrl() {
            return sourceUrl;
        }

        public void setSourceUrl(String sourceUrl) {
            this.sourceUrl = sourceUrl;
        }

        public Integer getItemCount() {
            return itemCount;
        }

        public void setItemCount(Integer itemCount) {
            this.itemCount = itemCount;
        }
    }
}
