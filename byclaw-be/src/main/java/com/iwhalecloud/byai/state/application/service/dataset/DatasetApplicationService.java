package com.iwhalecloud.byai.state.application.service.dataset;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.request.knowledge.FolderDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.FileBuildStatus;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileToMarkdownIndex;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDelete;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.ProcessStatus;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceTargetJsonBuilder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.manager.dto.resource.DatasetImportDto;
import com.iwhalecloud.byai.manager.dto.resource.RemoveFileDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.resource.qo.DatasetQo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetVo;
import com.iwhalecloud.byai.state.domain.resource.vo.KnowledgeCapabilityVo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactPathResolver;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceDiscoveryRegistrationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceImportOwnerTypeValidator;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeDelete;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBaseInfo;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/**
 * 数据集侧对 ss_resource 表的应用服务（增删改查入口）。 业务实现待补充：持久化、权限、审计等应在后续迭代中完善。
 *
 * @author he.duming
 */
@Service
public class DatasetApplicationService {

    public static final Logger logger = LoggerFactory.getLogger(DatasetApplicationService.class);

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtDocService ssResExtDocService;

    @Autowired
    private FeignPythonBuildService feignPythonBuildService;

    @Autowired
    private ResourceArtifactStorageService resourceArtifactStorageService;

    @Autowired
    private SsResourceArtifactService ssResourceArtifactService;

    @Autowired
    private ResourceArtifactPathResolver resourceArtifactPathResolver;

    @Autowired
    private ResourceDiscoveryRegistrationService resourceDiscoveryRegistrationService;

    @Autowired
    private ResourceRuntimeInfoResolver resourceRuntimeInfoResolver;

    @Autowired
    private ResourceTargetJsonBuilder resourceTargetJsonBuilder;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Value("${file.storage.type:minio}")
    private String storageType;

    @Value("${dataset.system:}")
    private String datasetSystem;

    /**
     * ownerType 允许值：enterprise-企业，personal-个人
     */
    private static final Set<String> OWNER_TYPE = new HashSet<>(
        Arrays.asList(OwnerType.ENTERPRISE, OwnerType.PERSONAL));

    /**
     * 分页查询 ss_resource 列表。
     *
     * @return 分页结果，未实现时返回空列表分页
     */
    public PageInfo<DatasetVo> selectDatasetByQo(DatasetQo datasetQo) {
        datasetQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
        return ssResourceService.selectDatasetByQo(datasetQo);
    }

    /**
     * 查询知识库前端页面能力开关。
     * 只要 dataset.system 配有值，就表示知识库库级操作由外部知识库体系承接；
     * 本系统仅开放知识库导入和库内目录/文件操作，屏蔽知识库库级新增、编辑、删除。
     *
     * @author qin.guoquan
     * @date 2026-04-22 15:10:00
     */
    public KnowledgeCapabilityVo queryKnowledgeCapability() {
        boolean thirdPartyMode = StringUtils.isNotBlank(StringUtils.trimToEmpty(datasetSystem));
        KnowledgeCapabilityVo capabilityVo = new KnowledgeCapabilityVo();
        capabilityVo.setKnowledgeMode(thirdPartyMode ? "THIRD_PARTY" : "BYAI");
        capabilityVo.setAllowKnowledgeBaseCreate(!thirdPartyMode);
        capabilityVo.setAllowKnowledgeBaseEdit(!thirdPartyMode);
        capabilityVo.setAllowKnowledgeBaseDelete(!thirdPartyMode);
        capabilityVo.setAllowKnowledgeImport(Boolean.TRUE);
        return capabilityVo;
    }

    /**
     * 新增一条 ss_resource 记录。
     *
     * @param datasetDto 资源实体（字段含义与表结构一致）
     * @return 新建记录主键 resource_id，未实现时返回 null
     */
    public SsResource createDataset(DatasetDto datasetDto) {
        // 第三方知识库模式下禁止本系统创建库级知识库，防止绕过前端按钮直接调接口。
        validateKnowledgeBaseWritable();

        // 参数提取
        String resourceBizType = datasetDto.getResourceBizType();
        String resourceName = datasetDto.getResourceName();
        String resourceDesc = datasetDto.getResourceDesc();
        String type = datasetDto.getType();
        String ownerType = datasetDto.getOwnerType();

        // 同步创建知识库
        KnowledgeBaseInfo knowledgeBase = this.createKnowledgeBase(resourceName, resourceDesc);

        // 保存资源表
        String resourceCode = knowledgeBase.getKnCode();

        SsResource myResource = new SsResource();
        myResource.setResourceBizType(resourceBizType);
        myResource.setResourceCode(resourceCode);
        myResource.setResourceName(resourceName);
        myResource.setResourceDesc(resourceDesc);
        myResource.setResourceStatus(ResourceStatus.LIST.getNum());
        myResource.setOwnerType(ownerType);
        myResource.setCatalogId(datasetDto.getCatalogId());

        fillKnowledgeResourceImplInfo(myResource);

        myResource = ssResourceService.createResource(myResource);
        authApplicationService.ensureCreatorDefaultPrivileges(myResource);

        // 保存扩展表：
        // 仅本地知识库(type=dataset)按前端约定模板写 sourceContent/targetContent，
        // 其他类型继续沿用原有扩展表写法，避免影响外部知识库和导入链。
        SsResExtDoc extDoc;
        if (isLocalDatasetType(type)) {
            extDoc = ssResExtDocService.createSsResExtDoc(myResource.getResourceId(), type,
                myResource.getResourceCode(), resourceName, resourceDesc, ownerType);
        }
        else {
            extDoc = ssResExtDocService.createSsResExtDoc(myResource.getResourceId(), type);
        }
        // 页面新增知识库后，也按知识库导入的同一套规则把 targetContent 同步到开放资源目录。
        // 同步失败仅记日志，不影响主流程成功返回。
        syncDatasetTargetContentSafely(extDoc.getTargetContent(), resourceBizType, myResource.getResourceId(),
            "createDataset");

        return myResource;
    }

    /**
     * 创建默认个人知识库，资源保存仍复用 createDataset 主链路。
     *
     * @param userId 用户ID
     * @param userCode 用户编码
     * @param userName 用户名称
     * @return 默认个人知识库资源
     */
    public SsResource createDefaultPersonalDataset(Long userId, String userCode, String userName) {
        String safeUserCode = StringUtils.defaultIfBlank(userCode, String.valueOf(userId));
        String safeUserName = StringUtils.defaultIfBlank(userName, safeUserCode);
        String resourceName = ssResourceService.generateAvailableResourceName(safeUserName + "的个人知识库",
            ResourceBizTypeEnum.KG_DOC.name());

        DatasetDto datasetDto = new DatasetDto();
        datasetDto.setResourceBizType(ResourceBizTypeEnum.KG_DOC.name());
        datasetDto.setResourceName(resourceName);
        datasetDto.setResourceDesc(resourceName);
        datasetDto.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        datasetDto.setCatalogId(0L);
        datasetDto.setType("dataset");
        return this.createDataset(datasetDto);
    }

    /**
     * 创建知识库
     *
     * @param knName 知识库名称
     * @param knDescription 描述
     * @return KnowledgeBaseInfo
     */
    private KnowledgeBaseInfo createKnowledgeBase(String knName, String knDescription) {
        // 同步创建
        KbKnowledgeCreate knowledgeBaseCreate = new KbKnowledgeCreate();
        knowledgeBaseCreate.setKnName(knName);
        knowledgeBaseCreate.setKnDescription(knDescription);
        logger.info("创建知识库入参:{}", JSON.toJSONString(knowledgeBaseCreate));

        // 0511 add by mysoon: 这里有个缺陷，当知识库是对接嘉朗时，若人为删除了个人的默认知识库，再次登录，做个人默认知识库初始化时，永远都失败了。（因为嘉朗侧已经存在），待优化。
        PythonBuildResponse<KnowledgeBaseInfo> ret = feignPythonBuildService.createKnowledgeBase(knowledgeBaseCreate,
            true);
        logger.info("创建知识库返回:{}", JSON.toJSONString(ret));

        if (!PythonBuildResponse.RESPONSE_SUCCESS.equalsIgnoreCase(ret.getResultCode())) {
            throw new BaseException("Create Knowledge fail:" + ret.getResultMsg());
        }
        return ret.getResultObject();
    }

    /**
     * 按主键更新 ss_resource 记录。
     *
     * @param datasetDto 需包含 resourceId，其余字段为待更新内容
     */
    public void updateDataset(DatasetDto datasetDto) {

        Long resourceId = datasetDto.getResourceId();
        String resourceName = datasetDto.getResourceName();
        String resourceDesc = datasetDto.getResourceDesc();

        // 更新知识库
        SsResource ssResource = ssResourceService.findById(resourceId);
        // 第三方知识库模式下，知识库由外部知识库体系发布，本系统不允许编辑。
        validateKnowledgeBaseWritable();
        validateDatasetManagePermission(ssResource);
        ssResource = ssResourceService.updateResource(resourceId, resourceName, resourceDesc);
        if (datasetDto.getCatalogId() != null) {
            ssResource.setCatalogId(datasetDto.getCatalogId());
        }
        fillKnowledgeResourceImplInfo(ssResource);
        ssResourceService.updateResourceEntity(ssResource);

        String type = datasetDto.getType();
        // 更新知识库扩展表：
        // 当前页面更新知识库仅允许修改名称与描述，因此这里只按这两个字段刷新 targetContent，
        // 不区分 type，也不改 sourceContent，避免影响导入链的原始内容语义。
        SsResExtDoc extDoc = ssResExtDocService.updateSsResExtDocTargetContent(ssResource.getResourceId(), type,
            resourceName, resourceDesc);
        // 页面更新知识库后，也按知识库导入的同一套规则把最新 targetContent 同步到开放资源目录。
        // 同步失败仅记日志，不影响主流程成功返回。
        syncDatasetTargetContentSafely(extDoc.getTargetContent(), ssResource.getResourceBizType(),
            ssResource.getResourceId(), "updateDataset");

        // 同步python更新
        KbKnowledgeUpdate kbKnowledgeUpdate = new KbKnowledgeUpdate();
        kbKnowledgeUpdate.setKnCode(ssResource.getResourceCode());
        kbKnowledgeUpdate.setKnName(resourceName);
        kbKnowledgeUpdate.setKnDescription(resourceDesc);
        PythonBuildResponse<Void> ret = feignPythonBuildService.updateKnowledgeBase(kbKnowledgeUpdate);
        logger.info("同步更新结果:{}", JSON.toJSONString(ret));

    }

    private boolean isLocalDatasetType(String type) {
        return StringUtils.equals(StringUtils.trimToEmpty(type), "dataset");
    }

    /**
     * 知识库资源统一回填 ss_resource 的实现方式与 Worker 注册类型。
     *
     * @author qin.guoquan
     * @date 2026-04-26 10:35:00
     */
    private void fillKnowledgeResourceImplInfo(SsResource ssResource) {
        if (ssResource == null
            || !StringUtils.startsWithIgnoreCase(StringUtils.trimToEmpty(ssResource.getResourceBizType()), "KG_")) {
            return;
        }
        resourceRuntimeInfoResolver.fillResource(ssResource, resourceRuntimeInfoResolver.resolveKnowledge());
    }

    /**
     * 页面知识库保存后的 JSON 同步属于增强动作，不应阻断主流程。
     */
    private void syncDatasetTargetContentSafely(String targetContent, String resourceBizType, Long resourceId,
        String scene) {
        try {
            resourceArtifactStorageService.syncResourceJsonByBizType(targetContent, resourceBizType, resourceId);
            ssResourceArtifactService.upsertStandardJsonArtifact(resourceId, resourceBizType, scene);
            logImportedDatasetArtifactLocation(resourceBizType, resourceId);
        }
        catch (Exception e) {
            logger.error("页面知识库JSON同步失败但不影响主流程, scene={}, resourceBizType={}, resourceId={}", scene, resourceBizType,
                resourceId, e);
        }
    }

    /**
     * 按主键删除 ss_resource 记录（是否物理删除由实现决定）。
     *
     * @param resourceId 资源主键
     * @return 是否删除成功，未实现时返回 false
     */
    public Boolean deleteDataset(Long resourceId) {

        SsResource ssResource = ssResourceService.findById(resourceId);
        // 第三方知识库模式下，知识库由外部知识库体系发布，本系统不允许注销。
        validateKnowledgeBaseWritable();
        validateDatasetManagePermission(ssResource);
        SsResExtDoc extDoc = ssResExtDocService.findById(resourceId);
        String targetContent = extDoc == null ? null : extDoc.getTargetContent();

        // 软删除：把 ss_resource.resource_status 置为 REMOVED(3)，保留主表与扩展表数据，
        // 让前端"已注销"筛选项可以查询到这些记录；运行期副作用（向量库/注册等）继续清理。
        ssResource.setResourceStatus(ResourceStatus.REMOVED.getNum());
        ssResource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setUpdateTime(new Date());
        ssResourceService.updateResourceEntity(ssResource);

        KbKnowledgeDelete knowledgeDel = new KbKnowledgeDelete();
        knowledgeDel.setKnCode(ssResource.getResourceCode());
        logger.info("删除知识库入参:{}", JSON.toJSONString(knowledgeDel));
        PythonBuildResponse<Void> ret = feignPythonBuildService.deleteKnowledgeBase(knowledgeDel);
        logger.info("删除知识库返回:{}", JSON.toJSONString(ret));

        logger.info("知识库软删除完成，准备反注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}",
            ssResource.getResourceBizType(), resourceId, ssResource.getResourceCode());
        resourceDiscoveryRegistrationService.unregisterAfterCommit(ssResource.getResourceBizType(), resourceId,
            ssResource.getResourceCode(), targetContent);

        return Boolean.TRUE;
    }

    private void validateDatasetManagePermission(SsResource ssResource) {
        if (ssResource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        if (OwnerType.PERSONAL_DEFAULT.equals(ssResource.getOwnerType())) {
            throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
        }
        if (authApplicationService.hasResourceManagePermission(ssResource)) {
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
    }

    /**
     * 第三方知识库模式下，知识库库级新增、编辑、注销均需走外部知识库体系。
     * dataset.system 非空即视为第三方知识库模式，个人/企业知识库都不允许在本系统做库级操作。
     *
     * @author qin.guoquan
     * @date 2026-05-11
     */
    private void validateKnowledgeBaseWritable() {
        if (StringUtils.isBlank(StringUtils.trimToEmpty(datasetSystem))) {
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("commercial.not.support.knowledge.operation"));
    }

    /**
     * 命中同编码知识库并准备走更新时，校验当前操作用户是否具备该资源的管理权限。
     * 无权限时直接阻断导入更新，避免通过导入覆盖他人资源。
     *
     * @author qin.guoquan
     * @date 2026-05-06 18:20:00
     */
    private void validateDatasetImportUpdatePermission(SsResource existing, String resourceCode) {
        if (existing == null) {
            return;
        }
        if (authApplicationService.hasResourceManagePermission(existing)) {
            return;
        }
        String resourceName = StringUtils.defaultIfBlank(existing.getResourceName(), resourceCode);
        throw new IllegalArgumentException(I18nUtil.get("tool.resource.import.update.no.permission", resourceCode,
            resourceName));
    }

    /**
     * 按主键查询单条 ss_resource。
     *
     * @param resourceId 资源主键
     * @return 资源实体，未实现时返回 null
     */
    public DatasetDetailVo detail(Long resourceId) {
        return ssResourceService.findDatasetDetailById(resourceId);
    }

    /***
     * 上传文件到知识库
     *
     * @param files 文件信息
     * @param resourceId 资源标识
     * @param directoryPath 文件目录路径
     * @param fileDescription 文件描述
     * @throws IOException 异常信息
     */
    public UploadResult uploadFiles(MultipartFile[] files, Long resourceId, String directoryPath,
        String fileDescription) throws IOException {

        SsResource ssResource = ssResourceService.findById(resourceId);

        UploadResult uploadResult = new UploadResult();
        uploadResult.setResourceId(resourceId);
        uploadResult.setResourceCode(ssResource.getResourceCode());
        uploadResult.setResourceName(ssResource.getResourceName());

        for (MultipartFile multipartFile : files) {

            // 上传文件到知识库
            KbFileImport kbFileImport = new KbFileImport();
            kbFileImport.setKnCode(ssResource.getResourceCode());

            if (StringUtil.isEmpty(directoryPath)) {
                kbFileImport.setFilePath("/" + multipartFile.getOriginalFilename());
            }
            else {
                kbFileImport.setFilePath(directoryPath + "/" + multipartFile.getOriginalFilename());
            }
            kbFileImport
                .setFileDescription(fileDescription != null ? fileDescription : multipartFile.getOriginalFilename());
            kbFileImport.setMultipartFile(multipartFile);
            PythonBuildResponse<KbImportResult> importRet = feignPythonBuildService.importKnowledgeItem(kbFileImport);
            logger.info("导入文件:{}", JSON.toJSONString(importRet));

            UploadItem uploadItem = new UploadItem();
            uploadItem.setFileName(multipartFile.getOriginalFilename());
            uploadItem.setFilePath(kbFileImport.getFilePath());
            uploadResult.getUploadItems().add(uploadItem);
        }

        return uploadResult;
    }

    /**
     * 知识构建
     *
     * @param datasetBuild 构建对象
     */
    public void build(DatasetBuild datasetBuild) {

        SsResource ssResource = ssResourceService.findById(datasetBuild.getResourceId());

        // 构建知识文件
        KbFileToMarkdownIndex kbFileToMarkdownIndex = new KbFileToMarkdownIndex();
        kbFileToMarkdownIndex.setKnCode(ssResource.getResourceCode());
        kbFileToMarkdownIndex.setFilePath(datasetBuild.getDirectoryPath());

        logger.info("知识构建入参是:{}", JSON.toJSONString(kbFileToMarkdownIndex));
        PythonBuildResponse<Void> buildRet = feignPythonBuildService.fileToMarkdownIndex(kbFileToMarkdownIndex);
        logger.info("构建结果是:{}", JSON.toJSONString(buildRet));

    }

    /**
     * 下载文件
     *
     * @param resourceId 资源标识
     * @param directoryPath 文件路径，/百应AI设计方案-智能体集成.docx
     * @param response 响应流
     */
    public void download(Long resourceId, String directoryPath, HttpServletResponse response) {

        // 获取知识库信息
        SsResource ssResource = ssResourceService.findById(resourceId);

        // 提取参数
        KbFileDownload kbFileDownload = new KbFileDownload();
        kbFileDownload.setKnCode(ssResource.getResourceCode());
        kbFileDownload.setFilePath(directoryPath);

        String fileName = this.getLastSplitName(directoryPath);
        // 下载文件
        try (InputStream inputStream = feignPythonBuildService.fileDownload(kbFileDownload)) {
            // 设置ContentType，响应内容为二进制数据流，编码为utf-8，此处设定的编码是文件内容的编码
            response.setContentType(MediaType.APPLICATION_OCTET_STREAM_VALUE);
            // 以（Content-Disposition: attachment; filename="filename.jpg"）格式设定默认文件名，设定utf编码，此处的编码是文件名的编码，使能正确显示中文文件名
            String contentDisposition = "attachment;filename=" + URLEncoder.encode(fileName, StandardCharsets.UTF_8);
            response.setHeader("Content-Disposition", contentDisposition);
            IOUtils.copy(inputStream, response.getOutputStream());
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 删除文件
     *
     * @param removeFileDto 删除文件信息
     */
    public void removeFile(RemoveFileDto removeFileDto) {

        SsResource ssResource = ssResourceService.findById(removeFileDto.getResourceId());

        // 删除构建
        KbFileDelete kbFileDelete = new KbFileDelete();
        kbFileDelete.setKnCode(ssResource.getResourceCode());
        kbFileDelete.setFilePath(removeFileDto.getDirectoryPath());
        logger.info("删除文件入参:{}", JSON.toJSONString(kbFileDelete));
        PythonBuildResponse<Void> removeResponse = feignPythonBuildService.deleteKnowledgeItem(kbFileDelete);
        logger.info("删除文件返回:{}", JSON.toJSONString(removeResponse));

    }

    /**
     * 创建知识库目录
     *
     * @param folder 知识库
     */
    public KbDirectoryCreate createFolder(Folder folder) {

        Long resourceId = folder.getResourceId();
        String directoryName = folder.getDirectoryName();

        // 查询知识库
        SsResource ssResource = ssResourceService.findById(resourceId);

        KbDirectoryCreate kbDirectoryCreate = new KbDirectoryCreate();
        kbDirectoryCreate.setKnCode(ssResource.getResourceCode());

        String directoryPath = folder.getDirectoryPath();
        if (StringUtil.isNotEmpty(directoryPath)) {
            kbDirectoryCreate.setDirectoryPath(directoryPath.concat("/").concat(directoryName));
        }
        else {
            kbDirectoryCreate.setDirectoryPath("/".concat(directoryName));
        }
        kbDirectoryCreate.setDirectoryDescription(folder.getDirectoryDescription());

        PythonBuildResponse<Void> ret = feignPythonBuildService.createDirectory(kbDirectoryCreate);
        logger.info("创建目录:{}", JsonUtil.toJSONString(ret));

        return kbDirectoryCreate;
    }

    /**
     * 重命名知识库
     *
     * @param folder 目录
     */
    public KbDirectoryUpdate renameFolder(Folder folder) {

        SsResource ssResource = ssResourceService.findById(folder.getResourceId());

        KbDirectoryUpdate kbDirectoryUpdate = new KbDirectoryUpdate();
        kbDirectoryUpdate.setKnCode(ssResource.getResourceCode());
        kbDirectoryUpdate.setDirectoryPath(folder.getDirectoryPath());
        kbDirectoryUpdate.setDirectoryName(folder.getDirectoryName());

        PythonBuildResponse<Void> ret = feignPythonBuildService.updateDirectory(kbDirectoryUpdate);
        logger.info("修改目录:{}", JsonUtil.toJSONString(ret));

        return kbDirectoryUpdate;
    }

    /**
     * 删除目录
     *
     * @param folderDelete 删除目录参数
     */
    public void deleteFolder(FolderDelete folderDelete) {

        SsResource ssResource = ssResourceService.findById(folderDelete.getResourceId());

        KbDirectoryDelete kbDirectoryDelete = new KbDirectoryDelete();
        kbDirectoryDelete.setKnCode(ssResource.getResourceCode());
        kbDirectoryDelete.setDirectoryPath(folderDelete.getDirectoryPath());

        PythonBuildResponse<Void> ret = feignPythonBuildService.deleteDirectory(kbDirectoryDelete);
        logger.info("删除目录:{}", JsonUtil.toJSONString(ret));

    }

    /**
     * 查询文件等级
     *
     * @param dirAndFileQo 查询入参
     * @return List
     */
    public List<DirAndFileVo> queryDirAndFileByLevel(DirAndFileQo dirAndFileQo) {

        SsResource ssResource = ssResourceService.findById(dirAndFileQo.getResourceId());

        KbListDir kbListDir = new KbListDir();
        kbListDir.setKnCode(ssResource.getResourceCode());
        String listDirectoryPath = dirAndFileQo.getDirectoryPath();
        if (StringUtil.isEmpty(listDirectoryPath)) {
            listDirectoryPath = "/";
        }
        kbListDir.setDirectoryPath(listDirectoryPath);
        PythonBuildResponse<Data> response = feignPythonBuildService.listDir(kbListDir);
        Data resultObject = response.getResultObject();

        List<DirAndFileVo> resultList = new ArrayList<>();
        for (DirOrFile dirOrFile : resultObject.getData()) {
            DirAndFileVo dirAndFileVo = new DirAndFileVo();
            String type = dirOrFile.getType();
            String name = dirOrFile.getName();
            dirAndFileVo.setType(type);
            if ("file".equalsIgnoreCase(type)) {
                dirAndFileVo.setFileName(name);
            }
            dirAndFileVo.setName(this.getLastSplitName(name));
            dirAndFileVo.setDirectoryPath(name);
            resultList.add(dirAndFileVo);
        }

        return resultList;
    }

    /**
     * 获取最后一级作为文件名
     *
     * @param directoryPath 文件路径
     * @return String
     */
    private String getLastSplitName(String directoryPath) {
        if (directoryPath != null && directoryPath.contains("/")) {
            String[] splitStr = directoryPath.split("/");
            return splitStr[splitStr.length - 1];
        }
        else {
            return directoryPath;
        }
    }

    /**
     * 知识库JSON导入（新增或更新）。
     *
     * @param ownerType 资源归属类型：enterprise-企业，personal-个人
     * @param file 上传的JSON文件
     * @return resourceId
     */
    @Transactional(rollbackFor = Exception.class)
    public Long importDatasetJson(String ownerType, Long catalogId, MultipartFile file) {

        // 校验上传文件
        String rawJson = parseAndValidateFile(file);

        // 校验json文件参数
        DatasetImportDto dto = parseAndValidateDto(rawJson, ownerType);
        dto.setCatalogId(catalogId);

        SsResource existing = ssResourceService.findByIdOrCode(null, dto.getResourceCode());
        if (existing == null) {
            return createDatasetFromImport(dto, rawJson, ownerType);
        }
        else {
            ResourceImportOwnerTypeValidator.validate(existing, ownerType, dto.getResourceCode(),
                dto.getResourceName(), dto.getResourceBizType());
            validateDatasetImportUpdatePermission(existing, dto.getResourceCode());
            return updateDatasetFromImport(existing, dto, rawJson, ownerType);
        }
    }

    // ==================== 导入：参数校验 ====================

    private String parseAndValidateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.file.notempty"));
        }
        try {
            return new String(file.getBytes(), StandardCharsets.UTF_8);
        }
        catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.file.read.failed"));
        }
    }

    /**
     * 解析并校验导入 JSON。 当前导入接口不再接收 catalogMain，而是改为由前端传 ownerType 控制资源归属。
     */
    private DatasetImportDto parseAndValidateDto(String rawJson, String ownerType) {

        if (StringUtil.isEmpty(ownerType)) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.owner.type.notempty"));
        }

        if (!OWNER_TYPE.contains(ownerType)) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.owner.type.invalid"));
        }

        DatasetImportDto dto = JSON.parseObject(rawJson, DatasetImportDto.class);
        if (dto == null) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.json.parse.failed"));
        }

        if (StringUtil.isEmpty(dto.getSystemCode())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.system.code.notempty"));
        }

        if (!SystemCode.isValid(dto.getSystemCode())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.system.code.invalid"));
        }

        if (StringUtil.isEmpty(dto.getResourceCode())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.resource.code.notempty"));
        }
        validateResourceCodeCanMapToAgentId(dto.getResourceCode());

        if (StringUtil.isEmpty(dto.getResourceName())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.resource.name.notempty"));

        }

        // if (StringUtil.isEmpty(dto.getResourceDesc())) {
        // throw new IllegalArgumentException("resourceDesc不能为空");
        // }

        if (StringUtil.isEmpty(dto.getResourceBizType())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.resource.biz.type.notempty"));
        }

        if (StringUtil.isEmpty(dto.getDomainName())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.domain.name.notempty"));
        }

        if (StringUtil.isEmpty(dto.getDomainURL())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.domain.url.notempty"));
        }
        return dto;
    }

    private Long createDatasetFromImport(DatasetImportDto datasetImportDto, String rawJson, String ownerType) {

        // 参数提取
        String resourceName = datasetImportDto.getResourceName();
        String resourceDesc = datasetImportDto.getResourceDesc();
        String resourceBizType = datasetImportDto.getResourceBizType();
        String resourceCode = datasetImportDto.getResourceCode();

        /**
         * SsResource ssResource = ssResourceService.createResource(resourceBizType, resourceCode, resourceName,
         * resourceDesc, ResourceStatus.LIST.getNum(), ownerType, datasetImportDto.getSystemCode(),
         * datasetImportDto.getVersion(), datasetImportDto.getCatalogId());
         */

        SsResource myResource = new SsResource();
        myResource.setResourceBizType(resourceBizType);
        myResource.setResourceCode(resourceCode);
        myResource.setResourceName(resourceName);
        myResource.setResourceDesc(resourceDesc);
        myResource.setResourceStatus(ResourceStatus.LIST.getNum());
        myResource.setOwnerType(ownerType);
        myResource.setSystemCode(datasetImportDto.getSystemCode());
        myResource.setResourceVersionId(datasetImportDto.getVersion());
        myResource.setCatalogId(datasetImportDto.getCatalogId());

        fillKnowledgeResourceImplInfo(myResource);

        myResource = ssResourceService.createResource(myResource);
        authApplicationService.ensureCreatorDefaultPrivileges(myResource);

        // 保存扩展表
        SsResExtDoc extDoc = this.buildNewExtDoc(datasetImportDto, rawJson, myResource.getResourceId());
        ssResExtDocService.save(extDoc);

        // 导入成功后，把最终 target_content JSON 同步到开放资源目录。
        resourceArtifactStorageService.syncResourceJsonByBizType(extDoc.getTargetContent(),
            datasetImportDto.getResourceBizType(), myResource.getResourceId());
        ssResourceArtifactService.upsertStandardJsonArtifact(myResource.getResourceId(),
            datasetImportDto.getResourceBizType(), "dataset-import-create");
        logImportedDatasetArtifactLocation(datasetImportDto.getResourceBizType(), myResource.getResourceId());

        // 第三方资源注册，给下游openclaw调用
        logger.info("知识库JSON导入完成，准备注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}",
            datasetImportDto.getResourceBizType(), myResource.getResourceId(), datasetImportDto.getResourceCode());
        resourceDiscoveryRegistrationService.registerAfterCommit(datasetImportDto.getResourceBizType(),
            myResource.getResourceId(), datasetImportDto.getResourceCode(), extDoc.getTargetContent());

        return myResource.getResourceId();
    }

    // ==================== 导入：更新 ====================

    private Long updateDatasetFromImport(SsResource existing, DatasetImportDto dto, String rawJson, String ownerType) {
        Long resourceId = existing.getResourceId();
        SsResExtDoc oldExtDoc = ssResExtDocService.findById(resourceId);
        String oldTargetContent = oldExtDoc == null ? null : oldExtDoc.getTargetContent();

        // update的动作，待复用杜老板统一的update方法
        existing.setResourceName(dto.getResourceName());
        existing.setResourceDesc(dto.getResourceDesc());
        existing.setResourceBizType(dto.getResourceBizType());
        existing.setResourceVersionId(dto.getVersion());
        existing.setOwnerType(StringUtils.trimToEmpty(ownerType));
        existing.setCatalogId(dto.getCatalogId());
        fillKnowledgeResourceImplInfo(existing);

        existing.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        existing.setUpdateTime(new Date());
        ssResourceService.updateResourceEntity(existing);

        SsResExtDoc extDoc = saveOrUpdateExtDoc(dto, rawJson, resourceId);
        resourceArtifactStorageService.syncResourceJsonByBizType(extDoc.getTargetContent(), dto.getResourceBizType(),
            resourceId);
        ssResourceArtifactService.upsertStandardJsonArtifact(resourceId, dto.getResourceBizType(),
            "dataset-import-update");
        logImportedDatasetArtifactLocation(dto.getResourceBizType(), resourceId);

        logger.info("知识库JSON导入完成，准备重注册资源服务, resourceBizType={}, resourceId={}, resourceCode={}",
            dto.getResourceBizType(), resourceId, dto.getResourceCode());
        resourceDiscoveryRegistrationService.reregisterAfterCommit(dto.getResourceBizType(), resourceId,
            dto.getResourceCode(), oldTargetContent, extDoc.getTargetContent());

        return resourceId;
    }

    // ==================== 导入：扩展表 ====================

    private SsResExtDoc buildNewExtDoc(DatasetImportDto dto, String rawJson, Long resourceId) {
        SsResExtDoc extDoc = new SsResExtDoc();
        extDoc.setResourceId(resourceId);
        fillExtDoc(extDoc, dto, rawJson, resourceId);
        return extDoc;
    }

    private SsResExtDoc saveOrUpdateExtDoc(DatasetImportDto dto, String rawJson, Long resourceId) {
        SsResExtDoc extDoc = ssResExtDocService.findById(resourceId);
        if (extDoc == null) {
            extDoc = new SsResExtDoc();
            extDoc.setResourceId(resourceId);
            fillExtDoc(extDoc, dto, rawJson, resourceId);
            ssResExtDocService.save(extDoc);
        }
        else {
            fillExtDoc(extDoc, dto, rawJson, resourceId);
            ssResExtDocService.update(extDoc);
        }
        return extDoc;
    }

    /**
     * 导入完成后打印资源 JSON 的最终落点，便于联调时确认开放资源目录中的产物路径。
     */
    private void logImportedDatasetArtifactLocation(String resourceBizType, Long resourceId) {
        String dirName = resourceArtifactPathResolver.resolveResourceDirectory(resourceBizType);
        String fileName = resourceArtifactPathResolver.buildResourceJsonFileName(resourceBizType, resourceId);
        if (StringUtils.equalsIgnoreCase(StringUtils.trimToEmpty(storageType), "minio")) {
            logger.info("知识库JSON导入同步完成, storageType={}, resourceId={}, resourceBucket={}, resourceObjectKey={}",
                storageType, resourceId, resourceArtifactPathResolver.resolveMinioBucketName(),
                resourceArtifactPathResolver.buildMinioResourceObjectKey(dirName, fileName));
            return;
        }
        logger.info("知识库JSON导入同步完成, storageType={}, resourceId={}, resourcePath={}", storageType, resourceId,
            dirName + "/" + fileName);
    }

    private void fillExtDoc(SsResExtDoc extDoc, DatasetImportDto dto, String rawJson, Long resourceId) {
        extDoc.setType(dto.getResourceType());
        extDoc.setResourceCatalogSub(dto.getResourceCatalogSub());
        extDoc.setSourceContent(rawJson);
        extDoc.setResourceAgentId(Long.valueOf(dto.getResourceCode()));
        extDoc.setTargetContent(buildTargetContent(rawJson, resourceId));
    }

    private void validateResourceCodeCanMapToAgentId(String resourceCode) {
        try {
            Long.valueOf(resourceCode);
        }
        catch (NumberFormatException e) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.import.resource.code.numeric.required"));
        }
    }

    private String buildTargetContent(String rawJson, Long resourceId) {
        JSONObject original = JSON.parseObject(rawJson, Feature.OrderedField);
        return resourceTargetJsonBuilder.buildWithResourceIdFirst(original, resourceId,
            resourceRuntimeInfoResolver.resolveKnowledge(), false);
    }

    /**
     * 文件状态查询
     *
     * @param resourceId 资源标识
     * @param directoryPath 文件路径
     * @return ProcessStatus
     */
    public ProcessStatus fileBuildStatus(Long resourceId, String directoryPath) {

        SsResource ssResource = ssResourceService.findById(resourceId);
        if (ssResource == null) {
            return new ProcessStatus();
        }

        FileBuildStatus fileBuildStatus = new FileBuildStatus();
        fileBuildStatus.setKnCode(ssResource.getResourceCode());
        fileBuildStatus.setFilePath(directoryPath);
        PythonBuildResponse<ProcessStatus> ret = feignPythonBuildService.fileBuildStatus(fileBuildStatus);
        return ret.getResultObject();

    }

}
