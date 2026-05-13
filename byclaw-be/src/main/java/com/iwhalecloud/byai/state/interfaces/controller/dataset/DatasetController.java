package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import java.nio.charset.StandardCharsets;
import java.util.List;

import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryUpdate;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.feign.request.knowledge.FolderDelete;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.ProcessStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.dto.resource.DatasetIdDto;
import com.iwhalecloud.byai.manager.dto.resource.RemoveFileDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.resource.qo.DatasetQo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetVo;
import com.iwhalecloud.byai.state.domain.resource.vo.KnowledgeCapabilityVo;
import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
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
    private SsResourceService ssResourceService;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

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
        DatasetDetailVo datasetDetailVo = ssResourceService.findDatasetDetailById(resourceId);
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

    /***
     * 上传文件到知识库
     *
     * @param resourceId 资源标识
     * @param directoryPath 文件目录路径
     * @param fileDescription 文件描述
     * @return ResponseUtil
     */
    @PostMapping(value = "/uploadFiles", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<UploadResult> uploadFiles(@RequestPart("files") MultipartFile[] files,
        @RequestPart("resourceId") Long resourceId, @RequestPart(value = "directoryPath") String directoryPath,
        @RequestPart(value = "fileDescription", required = false) String fileDescription) {
        try {

            directoryPath = new String(directoryPath.getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8);
            UploadResult uploadResult = datasetApplicationService.uploadFiles(files, resourceId, directoryPath,
                fileDescription);
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
    public ResponseUtil<Long> importDatasetJson(@RequestParam(value = "ownerType", required = false) String ownerType,
        @RequestParam(value = "catalogId", required = false) Long catalogId, @RequestPart("file") MultipartFile file) {
        try {
            Long resourceId = datasetApplicationService.importDatasetJson(ownerType, catalogId, file);
            return ResponseUtil.successResponse(I18nUtil.get("dataset.import.success"), resourceId);
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
