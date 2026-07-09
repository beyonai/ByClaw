package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryUpdate;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.FileToMarkdownResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.feign.request.knowledge.FolderDelete;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.ProcessStatus;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.dto.resource.DatasetIdDto;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeReadFileRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeUploadConflictCheckRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeUploadConflictCheckResponse;
import com.iwhalecloud.byai.manager.dto.resource.RemoveFileDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.resource.qo.DatasetQo;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportItem;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportResult;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetVo;
import com.iwhalecloud.byai.state.domain.resource.vo.KnowledgeCapabilityVo;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileReadResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchResult;
import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.application.service.dataset.OpenClawKnowledgeDocumentService;
import jakarta.validation.Valid;

/**
 * 数据集资源接口，对应数据库表 ss_resource（资源主数据）。 基础路径 /datasetController，子路径与当前类中映射一致（如
 * /page、/createDataset、/updateDataset、/deleteDataset、/detail/{resourceId}）。
 *
 * @author he.duming
 */
@Validated
@RestController
@RequestMapping("/datasetController")
public class DatasetController {

    private final Logger logger = LoggerFactory.getLogger(DatasetController.class);

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    @Autowired
    private OpenClawKnowledgeDocumentService openClawKnowledgeDocumentService;

    /**
     * 分页查询资源列表。
     *
     * @param datasetQo 分页参数与筛选条件（业务类型、目录、状态等）
     * @return 分页结果
     */
    @PostMapping("/selectDatasetByQo")
    public ResponseUtil<PageInfo<DatasetVo>> selectDatasetByQo(@RequestBody @Valid DatasetQo datasetQo) {
        PageInfo<DatasetVo> pageInfo = datasetApplicationService.selectDatasetByQo(datasetQo);
        datasetApplicationService.selectDatasetByQo(datasetQo);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.list.query.success"), pageInfo);
    }

    /**
     * 新增资源。
     *
     * @param datasetDto 资源实体，字段与 ss_resource 表一致
     * @return 新建记录的 resource_id，失败或待实现时见 resultCode
     */
    @PostMapping("/createDataset")
    public ResponseUtil<SsResource> createDataset(@RequestBody DatasetDto datasetDto) {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.create.success"),
            datasetApplicationService.createDataset(datasetDto));
    }

    /**
     * 按主键更新资源。
     *
     * @param datasetDto 必须包含 resource_id
     * @return 是否更新成功
     */
    @PostMapping("/updateDataset")
    public ResponseUtil<String> updateDataset(@RequestBody DatasetDto datasetDto) {
        datasetApplicationService.updateDataset(datasetDto);
        return ResponseUtil.success(I18nUtil.get("dataset.update.success"));
    }

    /**
     * 按主键删除资源。
     *
     * @param datasetIdDto 资源标识
     * @return 是否删除成功
     */
    @PostMapping("/deleteDataset")
    public ResponseUtil<Boolean> deleteDataset(@RequestBody DatasetIdDto datasetIdDto) {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.delete.success"),
            datasetApplicationService.deleteDataset(datasetIdDto.getResourceId()));
    }

    /**
     * 按主键查询单条资源。
     *
     * @param resourceId ss_resource.resource_id
     * @return 资源实体
     */
    @GetMapping("/detail")
    public ResponseUtil<DatasetDetailVo> detail(@RequestParam("resourceId") Long resourceId) {
        DatasetDetailVo datasetDetailVo = datasetApplicationService.detail(resourceId);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.detail.query.success"), datasetDetailVo);
    }

    /**
     * 查询知识库页面可用能力开关。
     *
     * @author qin.guoquan
     * @date 2026-04-22 15:10:00
     */
    @GetMapping("/queryKnowledgeCapability")
    public ResponseUtil<KnowledgeCapabilityVo> queryKnowledgeCapability() {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.knowledge.capability.query.success"),
            datasetApplicationService.queryKnowledgeCapability());
    }

    /**
     * 创建文件夹
     *
     * @param folder 创建文件一首歌
     * @return ResponseUtil
     */
    @PostMapping("/createFolder")
    public ResponseUtil<KbDirectoryCreate> createFolder(@RequestBody Folder folder) {
        KbDirectoryCreate kbDirectoryCreate = datasetApplicationService.createFolder(folder);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.folder.create.success"), kbDirectoryCreate);
    }

    /**
     * 重命名目录
     *
     * @param folder 目录对象
     * @return ResponseUtil
     */
    @PostMapping("/renameFolder")
    public ResponseUtil<KbDirectoryUpdate> renameFolder(@RequestBody Folder folder) {
        KbDirectoryUpdate kbDirectoryUpdate = datasetApplicationService.renameFolder(folder);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.folder.rename.success"), kbDirectoryUpdate);
    }

    /**
     * 删除目录
     *
     * @param folderDelete 目录标识
     * @return ResponseUtil
     */
    @PostMapping("/deleteFolder")
    public ResponseUtil<SsResource> deleteFolder(@RequestBody FolderDelete folderDelete) {
        datasetApplicationService.deleteFolder(folderDelete);
        return ResponseUtil.success(I18nUtil.get("dataset.folder.delete.success"));
    }

    /**
     * 列出文件资源
     *
     * @return ResponseUtil
     */
    @PostMapping("/queryDirAndFileByLevel")
    public ResponseUtil<List<DirAndFileVo>> queryDirAndFileByLevel(@RequestBody DirAndFileQo dirAndFileQo) {
        List<DirAndFileVo> dirAndFileVos = datasetApplicationService.queryDirAndFileByLevel(dirAndFileQo);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.dir.file.query.success"), dirAndFileVos);
    }

    /**
     * 按关键字递归搜索知识库目录和文件。
     *
     * @return ResponseUtil
     */
    @PostMapping("/searchDirAndFile")
    public ResponseUtil<List<DirAndFileVo>> searchDirAndFile(@RequestBody DirAndFileQo dirAndFileQo) {
        List<DirAndFileVo> dirAndFileVos = datasetApplicationService.searchDirAndFile(dirAndFileQo);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.dir.file.query.success"), dirAndFileVos);
    }

    /**
     * 上传前检查同路径同名文件，供前端做覆盖确认。
     *
     * @param request 检查请求
     * @return 冲突文件路径
     */
    @PostMapping("/checkUploadFileConflicts")
    public ResponseUtil<KnowledgeUploadConflictCheckResponse> checkUploadFileConflicts(
        @RequestBody KnowledgeUploadConflictCheckRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.dir.file.query.success"),
            datasetApplicationService.checkUploadFileConflicts(request));
    }

    /***
     * 上传文件到知识库
     *
     * @param resourceId 资源标识
     * @param directoryPath 文件目录路径
     * @param fileDescription 文件描述
     * @param processFrontMatter 是否解析 Markdown 文件中的 YAML front matter
     * @param overwrite 同路径同名文件存在时是否覆盖
     * @return ResponseUtil
     */
    @PostMapping(value = "/uploadFiles", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<UploadResult> uploadFiles(@RequestPart("files") MultipartFile[] files,
        @RequestPart("resourceId") Long resourceId, @RequestPart(value = "directoryPath") String directoryPath,
        @RequestPart(value = "fileDescription", required = false) String fileDescription,
        @RequestPart(value = "processFrontMatter", required = false) String processFrontMatter,
        @RequestPart(value = "overwrite", required = false) String overwrite) {
        try {

            directoryPath = new String(directoryPath.getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8);
            UploadResult uploadResult = datasetApplicationService.uploadFiles(files, resourceId, directoryPath,
                fileDescription, Boolean.valueOf(processFrontMatter), Boolean.valueOf(overwrite));
            return ResponseUtil.successResponse(I18nUtil.get("dataset.file.upload.success"), uploadResult);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 构建流程触发
     *
     * @param datasetBuild 构建对象
     * @return ResponseUtil
     */
    @PostMapping(value = "/build")
    public ResponseUtil<Void> build(@RequestBody DatasetBuild datasetBuild) {
        datasetApplicationService.build(datasetBuild);
        return ResponseUtil.success(I18nUtil.get("dataset.build.success"));
    }

    /**
     * 原始文件同步转换为 Markdown 文件流。只执行转换，不落知识库、不创建构建任务、不切片、不向量化。
     *
     * @param fileContent 原始文件二进制内容
     * @return Markdown 文件流
     */
    @PostMapping(value = "/fileToMarkdown", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<StreamingResponseBody> fileToMarkdown(@RequestPart("fileContent") MultipartFile fileContent) {
        try {
            FileToMarkdownResult result = datasetApplicationService.fileToMarkdown(fileContent);
            StreamingResponseBody responseBody = outputStream -> outputStream.write(result.getContent());
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(result.getContentType()))
                .header("Content-Disposition", buildContentDisposition(result.getFileName()))
                .body(responseBody);
        }
        catch (Exception e) {
            logger.error("文件转Markdown失败", e);
            String errorMessage = e.getMessage() == null ? "文件转Markdown失败" : e.getMessage();
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(outputStream -> outputStream.write(errorMessage.getBytes(StandardCharsets.UTF_8)));
        }
    }

    /**
     * 接收 OpenClaw 生成的 Markdown 文档，上传到知识库并立即触发构建。
     *
     * @param resourceId 知识库资源标识
     * @param directoryPath 知识库目录路径，默认根目录 /
     * @param docName 文档文件名，未传时自动生成
     * @param doc OpenClaw 生成的 Markdown 文档内容
     * @param language 预留语言参数，默认 zh-CN
     * @return 构建结果
     */
    @GetMapping(value = "/buildKnowledgeFromDoc", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> buildKnowledgeFromDoc(@RequestParam("resourceId") Long resourceId,
        @RequestParam(value = "directoryPath", required = false, defaultValue = "/") String directoryPath,
        @RequestParam(value = "docName", required = false) String docName, @RequestParam("doc") String doc,
        @RequestParam(value = "language", required = false, defaultValue = "zh-CN") String language) {
        try {
            return ResponseEntity.ok(
                openClawKnowledgeDocumentService.buildKnowledgeFromDoc(resourceId, directoryPath, docName, doc,
                    language));
        }
        catch (Exception e) {
            logger.error("OpenClaw文档构建知识库失败", e);
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    /**
     * 文件下载
     *
     * @param resourceId 资源标识
     * @param directoryPath 文件目录路径
     */
    @GetMapping(value = "/download")
    public void download(@RequestParam("resourceId") Long resourceId,
        @RequestParam("directoryPath") String directoryPath, HttpServletResponse response) {
        datasetApplicationService.download(resourceId, directoryPath, response);
    }

    /**
     * 读取知识库文件 Markdown 内容，供技能侧按资源 ID 调用。
     *
     * @param request 文件读取参数
     * @return 文件内容
     */
    @PostMapping(value = "/readFile")
    public ResponseUtil<KbFileReadResult> readFile(@RequestBody KnowledgeReadFileRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.dir.file.query.success"),
            datasetApplicationService.readFile(request));
    }

    /**
     * 知识库 chunk 检索，供技能侧按资源 ID 列表调用。
     *
     * @param request 检索参数
     * @return chunk 检索结果
     */
    @PostMapping(value = "/knowledgeItems/search")
    public ResponseUtil<KnowledgeSearchResult> searchKnowledgeItems(@RequestBody KnowledgeSearchRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.dir.file.query.success"),
            datasetApplicationService.searchKnowledgeItems(request));
    }

    /**
     * 删除文件
     *
     * @param removeFileDto 删除文件信息
     */
    @PostMapping(value = "/removeFile")
    public ResponseUtil<String> removeFile(@RequestBody RemoveFileDto removeFileDto) {
        datasetApplicationService.removeFile(removeFileDto);
        return ResponseUtil.success(I18nUtil.get("dataset.file.remove.success"));
    }

    /**
     * 知识库JSON导入
     *
     * @param ownerType 资源归属类型：enterprise-企业，personal-个人
     * @param file 知识库JSON文件
     * @return resourceId
     */
    @PostMapping(value = "/importDatasetJson", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<ObjectZipImportResult> importDatasetJson(
        @RequestParam(value = "ownerType", required = false) String ownerType,
        @RequestParam(value = "catalogId", required = false) Long catalogId, @RequestPart("file") MultipartFile[] file) {
        if (file != null && file.length > 1) {
            return ResponseUtil.successResponse(I18nUtil.get("dataset.import.success"),
                importDatasetJsonBatch(ownerType, catalogId, file));
        }
        try {
            Long resourceId = datasetApplicationService.importDatasetJson(ownerType, catalogId, file[0]);
            return ResponseUtil.successResponse(I18nUtil.get("dataset.import.success"),
                buildDatasetImportSuccessResult(file[0], resourceId));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("知识库JSON导入异常", e);
            return ResponseUtil.fail(I18nUtil.get("dataset.import.failed",
                e.getMessage() != null ? e.getMessage() : I18nUtil.get("system.internal.error")));
        }
    }

    private ObjectZipImportResult importDatasetJsonBatch(String ownerType, Long catalogId, MultipartFile[] files) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.setTotal(files == null ? 0 : files.length);
        if (files == null) {
            return result;
        }
        for (MultipartFile multipartFile : files) {
            try {
                Long resourceId = datasetApplicationService.importDatasetJson(ownerType, catalogId, multipartFile);
                result.getItems().add(buildDatasetImportSuccessItem(multipartFile, resourceId));
            }
            catch (Exception e) {
                result.getItems().add(buildDatasetImportFailedItem(multipartFile, e));
            }
        }
        fillImportSummary(result);
        return result;
    }

    private ObjectZipImportResult buildDatasetImportSuccessResult(MultipartFile file, Long resourceId) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.getItems().add(buildDatasetImportSuccessItem(file, resourceId));
        fillImportSummary(result);
        return result;
    }

    private ObjectZipImportItem buildDatasetImportSuccessItem(MultipartFile file, Long resourceId) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        String fileName = file == null ? null : file.getOriginalFilename();
        item.setResourceCode(fileName);
        item.setResourceName(fileName);
        item.setResourceId(String.valueOf(resourceId));
        item.setSuccess(true);
        return item;
    }

    private ObjectZipImportItem buildDatasetImportFailedItem(MultipartFile file, Exception e) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        String fileName = file == null ? null : file.getOriginalFilename();
        item.setResourceCode(fileName);
        item.setResourceName(fileName);
        item.setSuccess(false);
        item.setMessage(e.getMessage() != null ? e.getMessage() : I18nUtil.get("dataset.import.failed"));
        return item;
    }

    private void fillImportSummary(ObjectZipImportResult result) {
        if (result.getTotal() <= 0) {
            result.setTotal(result.getItems().size());
        }
        List<ObjectZipImportItem> successItems = result.getItems().stream().filter(ObjectZipImportItem::isSuccess)
            .collect(Collectors.toList());
        List<ObjectZipImportItem> createdItems = successItems.stream().filter(item -> !item.isUpdated())
            .collect(Collectors.toList());
        List<ObjectZipImportItem> updatedItems = successItems.stream().filter(ObjectZipImportItem::isUpdated)
            .collect(Collectors.toList());
        result.setSuccess(successItems.size());
        result.setFailed(result.getItems().size() - successItems.size());
        result.setCreatedCount(createdItems.size());
        result.setUpdatedCount(updatedItems.size());
        result.setCreatedItems(new ArrayList<>(createdItems));
        result.setUpdatedItems(new ArrayList<>(updatedItems));
    }

    private String buildContentDisposition(String fileName) {
        String resolvedFileName = fileName == null || fileName.isBlank() ? "converted.md" : fileName;
        String encoded = URLEncoder.encode(resolvedFileName, StandardCharsets.UTF_8).replace("+", "%20");
        return "attachment; filename=\"" + encoded + "\"; filename*=UTF-8''" + encoded;
    }

    /**
     * 文件状态查询
     *
     * @param resourceId 资源标识
     * @param directoryPath 文件路径
     * @return ResponseUtil
     */
    @GetMapping(value = "/fileBuildStatus")
    public ResponseUtil<ProcessStatus> fileBuildStatus(@RequestParam(value = "resourceId") Long resourceId,
        @RequestParam(value = "directoryPath") String directoryPath) {
        ProcessStatus processStatus = datasetApplicationService.fileBuildStatus(resourceId, directoryPath);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.file.build.status.query.success"), processStatus);
    }

}
