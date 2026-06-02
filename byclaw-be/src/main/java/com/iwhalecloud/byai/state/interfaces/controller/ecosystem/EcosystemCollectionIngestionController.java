package com.iwhalecloud.byai.state.interfaces.controller.ecosystem;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.ecosystem.EcosystemArtifactStorageService;
import com.iwhalecloud.byai.manager.application.service.ecosystem.EcosystemKnowledgeImportService;
import com.iwhalecloud.byai.manager.application.service.ecosystem.OpenCliRunner;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemRunVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 生态采集入库步骤接口。
 * 用于按步骤补齐 OpenCLI 采集、采集产物落地和 Markdown 知识库导入能力。
 *
 * @author qin.guoquan
 * @date 2026-06-01
 */
@RestController
@RequestMapping("/ecosystemCollection/ingestion")
public class EcosystemCollectionIngestionController {

    /**
     * OpenCLI 运行器，负责真实采集。
     */
    @Autowired
    private OpenCliRunner openCliRunner;

    /**
     * 采集产物落地服务，负责文件存储和 files 元数据写入。
     */
    @Autowired
    private EcosystemArtifactStorageService artifactStorageService;

    /**
     * Markdown 知识库导入服务。
     */
    @Autowired
    private EcosystemKnowledgeImportService knowledgeImportService;

    /**
     * 全局序列服务，用于缺省生成运行 ID。
     */
    @Autowired
    private SequenceService sequenceService;

    /**
     * 执行一次 OpenCLI 采集，并返回可继续落地产物或导入知识库的归一化结果。
     *
     * @param request 采集任务和可选运行 ID
     * @return OpenCLI 采集结果
     */
    @PostMapping("/opencli/collect")
    public ResponseUtil<CollectionResultPayload> collectWithOpenCli(@RequestBody OpenCliCollectRequest request) {
        EcosystemTaskVo task = requireTask(request == null ? null : request.getTask());
        Long runId = request == null || request.getRunId() == null ? sequenceService.nextVal() : request.getRunId();
        OpenCliRunner.CollectionResult collectionResult = openCliRunner.collect(task, runId);
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.ingestion.opencli.collect.success"),
            toPayload(collectionResult));
    }

    /**
     * 将 OpenCLI 采集输出落为运行产物，包括 Markdown、附件、raw 和 manifest。
     *
     * @param request 运行 ID、采集任务和采集输出
     * @return 产物存储结果
     */
    @PostMapping("/artifacts/store")
    public ResponseUtil<StorageResultPayload> storeArtifacts(@RequestBody ArtifactStoreRequest request) {
        if (request == null) {
            throw new IllegalArgumentException(I18nUtil.get("ecosystem.error.run.action.request.empty"));
        }
        EcosystemTaskVo task = requireTask(request.getTask());
        Long runId = request.getRunId() == null ? sequenceService.nextVal() : request.getRunId();
        OpenCliRunner.CollectionResult collectionResult = toCollectionResult(request.getCollectionResult());
        EcosystemArtifactStorageService.StorageResult storageResult =
            artifactStorageService.store(runId, task, collectionResult);
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.ingestion.artifact.store.success"),
            toPayload(storageResult));
    }

    /**
     * 将 Markdown 文件导入指定知识库，并触发知识库构建。
     *
     * @param request 采集任务、目标知识库配置和 Markdown 文件
     * @return 知识库导入结果
     */
    @PostMapping("/knowledge/import")
    public ResponseUtil<EcosystemKnowledgeImportService.ImportResult> importMarkdown(
        @RequestBody KnowledgeImportRequest request) {
        if (request == null) {
            throw new IllegalArgumentException(I18nUtil.get("ecosystem.error.run.action.request.empty"));
        }
        EcosystemTaskVo task = requireTask(request.getTask());
        if (request.getTargetConfig() == null || request.getTargetConfig().isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("ecosystem.import.error.knowledge.base.required"));
        }
        List<EcosystemArtifactStorageService.MarkdownImportFile> markdownFiles = toMarkdownFiles(request);
        EcosystemKnowledgeImportService.ImportResult importResult =
            knowledgeImportService.importMarkdown(task, request.getTargetConfig(), markdownFiles);
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.ingestion.knowledge.import.success"),
            importResult);
    }

    private EcosystemTaskVo requireTask(EcosystemTaskVo task) {
        if (task == null) {
            throw new IllegalArgumentException(I18nUtil.get("ecosystem.error.task.id.empty"));
        }
        return task;
    }

    private CollectionResultPayload toPayload(OpenCliRunner.CollectionResult result) {
        CollectionResultPayload payload = new CollectionResultPayload();
        payload.setCommand(result.getCommand());
        payload.setOutputDir(result.getOutputDir() == null ? null : result.getOutputDir().toString());
        payload.setRawOutput(result.getRawOutput());
        payload.setAssetCount(result.getAssetCount());
        List<CollectionItemPayload> items = new ArrayList<>();
        for (OpenCliRunner.CollectionItem item : result.getItems()) {
            CollectionItemPayload itemPayload = new CollectionItemPayload();
            itemPayload.setTitle(item.getTitle());
            itemPayload.setFileName(item.getFileName());
            itemPayload.setSourceUrl(item.getSourceUrl());
            itemPayload.setMarkdown(item.getMarkdown());
            items.add(itemPayload);
        }
        payload.setItems(items);
        return payload;
    }

    private StorageResultPayload toPayload(EcosystemArtifactStorageService.StorageResult result) {
        StorageResultPayload payload = new StorageResultPayload();
        payload.setStoragePath(result.getStoragePath());
        payload.setArtifacts(result.getArtifacts());
        List<MarkdownFilePayload> markdownFiles = new ArrayList<>();
        for (EcosystemArtifactStorageService.MarkdownImportFile markdownFile : result.getMarkdownFiles()) {
            MarkdownFilePayload markdownFilePayload = new MarkdownFilePayload();
            markdownFilePayload.setFileName(markdownFile.getFileName());
            markdownFilePayload.setMarkdown(new String(markdownFile.getBytes(), StandardCharsets.UTF_8));
            markdownFilePayload.setSize(markdownFile.getBytes().length);
            markdownFiles.add(markdownFilePayload);
        }
        payload.setMarkdownFiles(markdownFiles);
        return payload;
    }

    private OpenCliRunner.CollectionResult toCollectionResult(CollectionResultPayload payload) {
        if (payload == null) {
            throw new IllegalArgumentException(I18nUtil.get("ecosystem.error.opencli.empty.output"));
        }
        OpenCliRunner.CollectionResult result = new OpenCliRunner.CollectionResult();
        result.setCommand(payload.getCommand());
        result.setOutputDir(resolveOutputDir(payload.getOutputDir()));
        result.setRawOutput(payload.getRawOutput());
        result.setAssetCount(payload.getAssetCount());
        List<OpenCliRunner.CollectionItem> items = new ArrayList<>();
        for (CollectionItemPayload item : safeList(payload.getItems())) {
            items.add(new OpenCliRunner.CollectionItem(item.getTitle(), item.getFileName(), item.getSourceUrl(),
                item.getMarkdown()));
        }
        result.setItems(items);
        return result;
    }

    private Path resolveOutputDir(String outputDir) {
        if (outputDir == null || outputDir.trim().isEmpty()) {
            return null;
        }
        Path outputPath = Paths.get(outputDir).toAbsolutePath().normalize();
        Path tempRoot = Paths.get(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize();
        if (!outputPath.startsWith(tempRoot) || outputPath.getFileName() == null
            || !outputPath.getFileName().toString().startsWith("bykc-ec-")) {
            throw new IllegalArgumentException(I18nUtil.get("ecosystem.error.opencli.output.dir.invalid"));
        }
        return outputPath;
    }

    private List<EcosystemArtifactStorageService.MarkdownImportFile> toMarkdownFiles(KnowledgeImportRequest request) {
        List<MarkdownFilePayload> markdownPayloads = request.getMarkdownFiles();
        if ((markdownPayloads == null || markdownPayloads.isEmpty()) && request.getCollectionResult() != null) {
            markdownPayloads = new ArrayList<>();
            for (CollectionItemPayload item : safeList(request.getCollectionResult().getItems())) {
                MarkdownFilePayload markdownFilePayload = new MarkdownFilePayload();
                markdownFilePayload.setFileName(item.getFileName());
                markdownFilePayload.setMarkdown(item.getMarkdown());
                markdownPayloads.add(markdownFilePayload);
            }
        }
        List<EcosystemArtifactStorageService.MarkdownImportFile> markdownFiles = new ArrayList<>();
        for (MarkdownFilePayload markdownFile : safeList(markdownPayloads)) {
            if (markdownFile == null) {
                continue;
            }
            markdownFiles.add(new EcosystemArtifactStorageService.MarkdownImportFile(markdownFile.getFileName(),
                markdownBytes(markdownFile)));
        }
        return markdownFiles;
    }

    private byte[] markdownBytes(MarkdownFilePayload markdownFile) {
        if (markdownFile.getContentBase64() != null && !markdownFile.getContentBase64().trim().isEmpty()) {
            return Base64.getDecoder().decode(markdownFile.getContentBase64());
        }
        return markdownFile.getMarkdown() == null ? new byte[0] : markdownFile.getMarkdown().getBytes(StandardCharsets.UTF_8);
    }

    private <T> List<T> safeList(List<T> values) {
        return values == null ? List.of() : values;
    }

    public static class OpenCliCollectRequest {

        private Long runId;

        private EcosystemTaskVo task;

        public Long getRunId() {
            return runId;
        }

        public void setRunId(Long runId) {
            this.runId = runId;
        }

        public EcosystemTaskVo getTask() {
            return task;
        }

        public void setTask(EcosystemTaskVo task) {
            this.task = task;
        }
    }

    public static class ArtifactStoreRequest {

        private Long runId;

        private EcosystemTaskVo task;

        private CollectionResultPayload collectionResult;

        public Long getRunId() {
            return runId;
        }

        public void setRunId(Long runId) {
            this.runId = runId;
        }

        public EcosystemTaskVo getTask() {
            return task;
        }

        public void setTask(EcosystemTaskVo task) {
            this.task = task;
        }

        public CollectionResultPayload getCollectionResult() {
            return collectionResult;
        }

        public void setCollectionResult(CollectionResultPayload collectionResult) {
            this.collectionResult = collectionResult;
        }
    }

    public static class KnowledgeImportRequest {

        private EcosystemTaskVo task;

        private Map<String, Object> targetConfig;

        private List<MarkdownFilePayload> markdownFiles;

        private CollectionResultPayload collectionResult;

        public EcosystemTaskVo getTask() {
            return task;
        }

        public void setTask(EcosystemTaskVo task) {
            this.task = task;
        }

        public Map<String, Object> getTargetConfig() {
            return targetConfig;
        }

        public void setTargetConfig(Map<String, Object> targetConfig) {
            this.targetConfig = targetConfig;
        }

        public List<MarkdownFilePayload> getMarkdownFiles() {
            return markdownFiles;
        }

        public void setMarkdownFiles(List<MarkdownFilePayload> markdownFiles) {
            this.markdownFiles = markdownFiles;
        }

        public CollectionResultPayload getCollectionResult() {
            return collectionResult;
        }

        public void setCollectionResult(CollectionResultPayload collectionResult) {
            this.collectionResult = collectionResult;
        }
    }

    public static class CollectionResultPayload {

        private List<String> command;

        private String outputDir;

        private String rawOutput;

        private List<CollectionItemPayload> items;

        private int assetCount;

        public List<String> getCommand() {
            return command;
        }

        public void setCommand(List<String> command) {
            this.command = command;
        }

        public String getOutputDir() {
            return outputDir;
        }

        public void setOutputDir(String outputDir) {
            this.outputDir = outputDir;
        }

        public String getRawOutput() {
            return rawOutput;
        }

        public void setRawOutput(String rawOutput) {
            this.rawOutput = rawOutput;
        }

        public List<CollectionItemPayload> getItems() {
            return items;
        }

        public void setItems(List<CollectionItemPayload> items) {
            this.items = items;
        }

        public int getAssetCount() {
            return assetCount;
        }

        public void setAssetCount(int assetCount) {
            this.assetCount = assetCount;
        }
    }

    public static class CollectionItemPayload {

        private String title;

        private String fileName;

        private String sourceUrl;

        private String markdown;

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }

        public String getFileName() {
            return fileName;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }

        public String getSourceUrl() {
            return sourceUrl;
        }

        public void setSourceUrl(String sourceUrl) {
            this.sourceUrl = sourceUrl;
        }

        public String getMarkdown() {
            return markdown;
        }

        public void setMarkdown(String markdown) {
            this.markdown = markdown;
        }
    }

    public static class StorageResultPayload {

        private String storagePath;

        private List<EcosystemRunVo.ArtifactVo> artifacts;

        private List<MarkdownFilePayload> markdownFiles;

        public String getStoragePath() {
            return storagePath;
        }

        public void setStoragePath(String storagePath) {
            this.storagePath = storagePath;
        }

        public List<EcosystemRunVo.ArtifactVo> getArtifacts() {
            return artifacts;
        }

        public void setArtifacts(List<EcosystemRunVo.ArtifactVo> artifacts) {
            this.artifacts = artifacts;
        }

        public List<MarkdownFilePayload> getMarkdownFiles() {
            return markdownFiles;
        }

        public void setMarkdownFiles(List<MarkdownFilePayload> markdownFiles) {
            this.markdownFiles = markdownFiles;
        }
    }

    public static class MarkdownFilePayload {

        private String fileName;

        private String markdown;

        private String contentBase64;

        private Integer size;

        public String getFileName() {
            return fileName;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }

        public String getMarkdown() {
            return markdown;
        }

        public void setMarkdown(String markdown) {
            this.markdown = markdown;
        }

        public String getContentBase64() {
            return contentBase64;
        }

        public void setContentBase64(String contentBase64) {
            this.contentBase64 = contentBase64;
        }

        public Integer getSize() {
            return size;
        }

        public void setSize(Integer size) {
            this.size = size;
        }
    }
}
