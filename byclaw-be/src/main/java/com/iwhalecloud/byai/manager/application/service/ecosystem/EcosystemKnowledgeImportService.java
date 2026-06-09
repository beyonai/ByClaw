package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 生态采集知识库导入服务。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class EcosystemKnowledgeImportService {

    /**
     * 知识库文件上传和索引构建应用服务。
     */
    @Autowired
    private DatasetApplicationService datasetApplicationService;

    /**
     * 将采集生成的 Markdown 文件导入指定个人知识库，并触发知识库构建。
     *
     * @param task 采集任务
     * @param targetConfig 任务目标配置，包含 knowledgeBaseResourceId / knowledgeBaseId
     * @param markdownFiles 待导入 Markdown 文件
     * @return 导入结果
     */
    public ImportResult importMarkdown(EcosystemTaskVo task,
                                       Map<String, Object> targetConfig,
        List<EcosystemArtifactStorageService.MarkdownImportFile> markdownFiles) {
        if (!"knowledgeBase".equalsIgnoreCase(task.getImportTarget())) {
            throw new IllegalArgumentException(i18n("ecosystem.import.error.only.knowledge.base"));
        }
        Long resourceId = resolveResourceId(targetConfig);
        if (resourceId == null) {
            throw new IllegalArgumentException(i18n("ecosystem.import.error.knowledge.base.required"));
        }
        if (markdownFiles == null || markdownFiles.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.import.error.markdown.empty"));
        }

        String directoryPath = normalizeDirectoryPath(null, task.getSourceName(), stringValue(task.getTaskId()));
        MultipartFile[] files = markdownFiles.stream()
            .map(file -> new MultipartFileUtil("files", file.getFileName(), "text/markdown", file.getBytes()))
            .toArray(MultipartFile[]::new);
        try {
            UploadResult uploadResult = datasetApplicationService.uploadFiles(files, resourceId, directoryPath,
                i18n("ecosystem.import.upload.remark", task.getTaskName()));
            // 知识库构建接口按文件路径查找对象，不能只传目录；用 uploadFiles 返回的真实路径逐个触发索引。
            for (UploadItem uploadItem : uploadResult.getUploadItems()) {
                DatasetBuild datasetBuild = new DatasetBuild();
                datasetBuild.setResourceId(resourceId);
                datasetBuild.setDirectoryPath(uploadItem.getFilePath());
                datasetApplicationService.build(datasetBuild);
            }

            ImportResult result = new ImportResult();
            result.setResourceId(resourceId);
            result.setDirectoryPath(directoryPath);
            result.setUploadedCount(uploadResult.getUploadItems().size());
            result.setMessage(i18n("ecosystem.import.success.message", uploadResult.getResourceName()));
            return result;
        }
        catch (IOException e) {
            throw new IllegalStateException(i18n("ecosystem.import.error.failed", e.getMessage()), e);
        }
    }

    /**
     * 从目标配置中解析真实知识库资源 ID。
     */
    private Long resolveResourceId(Map<String, Object> targetConfig) {
        Object resourceId = targetConfig.get("knowledgeBaseResourceId");
        if (resourceId == null) {
            resourceId = targetConfig.get("knowledgeBaseId");
        }
        if (resourceId == null) {
            return null;
        }
        try {
            return Long.parseLong(String.valueOf(resourceId));
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 规范化导入目录，确保 DatasetApplicationService 使用以 / 开头且不以 / 结尾的路径。
     */
    private String normalizeDirectoryPath(String directoryPath, String sourceName, String taskId) {
        String value = directoryPath;
        if (value == null || value.trim().isEmpty()) {
            String taskSegment = taskId == null ? String.valueOf(System.currentTimeMillis()) : String.valueOf(taskId);
            value = i18n("ecosystem.import.directory", sourceName, taskSegment);
        }
        value = value.trim().replace('\\', '/');
        while (value.startsWith("/")) {
            value = value.substring(1);
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return "/" + value;
    }

    /**
     * 对象转字符串，保留 null 语义。
     */
    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 获取国际化文案。
     */
    private String i18n(String key, Object... args) {
        return I18nUtil.get(key, args);
    }

    /**
     * 生态采集 Markdown 入库结果。
     */
    public static class ImportResult {

        /**
         * 知识库资源 ID。
         */
        private Long resourceId;

        /**
         * 本次导入到知识库中的目录路径。
         */
        private String directoryPath;

        /**
         * 成功上传的 Markdown 文件数量。
         */
        private int uploadedCount;

        /**
         * 导入结果提示文案。
         */
        private String message;

        public Long getResourceId() {
            return resourceId;
        }

        public void setResourceId(Long resourceId) {
            this.resourceId = resourceId;
        }

        public String getDirectoryPath() {
            return directoryPath;
        }

        public void setDirectoryPath(String directoryPath) {
            this.directoryPath = directoryPath;
        }

        public int getUploadedCount() {
            return uploadedCount;
        }

        public void setUploadedCount(int uploadedCount) {
            this.uploadedCount = uploadedCount;
        }

        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }
    }
}
