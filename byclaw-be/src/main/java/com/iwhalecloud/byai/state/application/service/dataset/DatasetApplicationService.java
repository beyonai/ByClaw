package com.iwhalecloud.byai.state.application.service.dataset;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

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
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbBuildResult;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbGlob;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryDelete;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbEntityDiscovery;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbEntityEnrich;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileMetadataGet;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileRead;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileToMarkdownIndex;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeFileSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeMetadataSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemReferences;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemsMove;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDelete;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.FileToMarkdownResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileReadResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileUpdateResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileMetadataResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemReferencesResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeEntityBatchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemsMoveResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBuildResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.ProcessStatus;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceTargetJsonBuilder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.util.DigEmployeeRedisKeys;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeReadFileRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeBuildResultRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileMetadataRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeEntityDiscoveryRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeEntityEnrichRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeGlobRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemReferencesRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemsMoveRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeMetadataSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeUploadConflictCheckRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeUploadConflictCheckResponse;

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

    /**
     * 知识库目录搜索递归深度保护，避免异常目录结构导致接口耗时失控。
     */
    private static final int KNOWLEDGE_DIR_SEARCH_MAX_DEPTH = 20;

    /**
     * 知识库目录搜索最多返回数量。左侧面板只用于定位文件，命中太多时应通过更精确关键字缩小范围。
     */
    private static final int KNOWLEDGE_DIR_SEARCH_MAX_RESULT_SIZE = 500;

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
     * 查询知识库前端页面能力开关。 只要 dataset.system 配有值，就表示知识库库级操作由外部知识库体系承接； 本系统仅开放知识库导入和库内目录/文件操作，屏蔽知识库库级新增、编辑、删除。
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
        } else {
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
     * @param userId   用户ID
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
     * @param knName        知识库名称
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

        assertPythonBuildSuccess(ret, "创建知识库");
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

            // 同步Redis
            String redisKey = DigEmployeeRedisKeys.resourceConfigJsonKey(resourceBizType, resourceId);
            RedisUtil.setString(redisKey, targetContent);
        } catch (Exception e) {
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
        validateDefaultPersonalDatasetDeletable(ssResource);
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
        PythonBuildResponse<Void> ret = feignPythonBuildService.deleteKnowledgeBase(knowledgeDel, resourceId);
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
        if (authApplicationService.hasResourceManagePermission(ssResource)) {
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
    }

    private void validateDefaultPersonalDatasetDeletable(SsResource ssResource) {
        if (ssResource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        // 默认个人知识库是个人空间底座资源，允许本人维护库内内容，但不允许注销整个知识库。
        if (OwnerType.PERSONAL_DEFAULT.equals(ssResource.getOwnerType())) {
            throw new IllegalArgumentException(I18nUtil.get("dataset.default.personal.delete.not.allowed"));
        }
    }

    private void validateDatasetReadablePermission(SsResource ssResource) {
        if (ssResource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        if (authApplicationService.hasResourceAccessPermission(ssResource)) {
            return;
        }
        throw new IllegalArgumentException(I18nUtil.get("user.permission.nopermission"));
    }

    private SsResource loadDatasetResource(Long resourceId) {
        SsResource ssResource = ssResourceService.findById(resourceId);
        if (ssResource == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.notfound"));
        }
        return ssResource;
    }

    /**
     * 第三方知识库模式下，知识库库级新增、编辑、注销均需走外部知识库体系。 dataset.system 非空即视为第三方知识库模式，个人/企业知识库都不允许在本系统做库级操作。
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
     * 命中同编码知识库并准备走更新时，校验当前操作用户是否具备该资源的管理权限。 无权限时直接阻断导入更新，避免通过导入覆盖他人资源。
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
        throw new IllegalArgumentException(
            I18nUtil.get("tool.resource.import.update.no.permission", resourceCode, resourceName));
    }

    /**
     * 按主键查询单条 ss_resource。
     *
     * @param resourceId 资源主键
     * @return 资源实体，未实现时返回 null
     */
    public DatasetDetailVo detail(Long resourceId) {
        validateDatasetReadablePermission(loadDatasetResource(resourceId));
        return ssResourceService.findDatasetDetailById(resourceId);
    }

    /***
     * 上传文件到知识库
     *
     * @param files 文件信息
     * @param resourceId 资源标识
     * @param directoryPath 文件目录路径
     * @param fileDescription 文件描述
     * @param processFrontMatter 是否解析 Markdown 文件中的 YAML front matter
     * @param overwrite 同路径同名文件存在时是否先删除旧文件再上传
     * @param skipIfDuplicate 同路径同名文件存在时是否跳过
     * @param headers 透传到 ByKC 的请求头
     * @throws IOException 异常信息
     */
    public UploadResult uploadFiles(MultipartFile[] files, Long resourceId, String directoryPath,
                                    String fileDescription, Boolean processFrontMatter, Boolean overwrite,
                                    boolean skipIfDuplicate, Map<String, String> headers) throws IOException {

        SsResource ssResource = loadDatasetResource(resourceId);
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, resourceId);

        UploadResult uploadResult = new UploadResult();
        uploadResult.setResourceId(resourceId);
        uploadResult.setResourceCode(ssResource.getResourceCode());
        uploadResult.setResourceName(ssResource.getResourceName());

        List<String> uploadFileNames = Arrays.stream(files).filter(file -> !isZipUpload(file))
            .map(MultipartFile::getOriginalFilename).toList();
        Set<String> existingFilePaths = Boolean.TRUE.equals(overwrite)
            ? new HashSet<>(findExistingKnowledgeFilePaths(ssResource, directoryPath, uploadFileNames))
            : new HashSet<>();

        for (MultipartFile multipartFile : files) {

            // 上传文件到知识库
            KbFileImport kbFileImport = new KbFileImport();
            kbFileImport.setKnCode(ssResource.getResourceCode());
            kbFileImport.setSkipIfDuplicate(skipIfDuplicate);

            boolean zipUpload = isZipUpload(multipartFile);
            String filePath = zipUpload ? normalizeKnowledgeDirectoryPath(directoryPath)
                : buildKnowledgeFilePath(directoryPath, multipartFile.getOriginalFilename());
            if (!zipUpload && existingFilePaths.contains(filePath)) {
                // QA 暂不支持原子覆盖，BE 只能在用户确认 overwrite=true 后先删旧文件再导入新文件。
                deleteKnowledgeFile(ssResource, filePath, "覆盖上传前删除知识库旧文件", forwardedHeaders);
            }
            kbFileImport.setFilePath(filePath);
            kbFileImport
                .setFileDescription(fileDescription != null ? fileDescription : multipartFile.getOriginalFilename());
            // 为空时不发送该表单字段，由 QA 按最新接口默认值 true 处理。
            kbFileImport.setProcessFrontMatter(processFrontMatter);
            kbFileImport.setMultipartFile(multipartFile);
            PythonBuildResponse<KbImportResult> importRet = feignPythonBuildService.importKnowledgeItem(kbFileImport,
                forwardedHeaders);
            logger.info("导入文件:{}", JSON.toJSONString(importRet));
            assertPythonBuildSuccess(importRet, "上传知识库文件");

            appendImportResult(uploadResult, importRet.getResultObject(), multipartFile, kbFileImport.getFilePath());
        }

        return uploadResult;
    }

    /**
     * 知识库文件上传前检查同路径同名冲突，供前端展示覆盖确认。
     *
     * @param request 检查请求
     * @return 冲突文件路径
     */
    public KnowledgeUploadConflictCheckResponse checkUploadFileConflicts(KnowledgeUploadConflictCheckRequest request) {
        if (request == null || request.getResourceId() == null) {
            throw new BaseException("知识库资源标识不能为空");
        }
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetManagePermission(ssResource);

        KnowledgeUploadConflictCheckResponse response = new KnowledgeUploadConflictCheckResponse();
        List<String> overwritePaths = findExistingKnowledgeFilePaths(ssResource, request.getDirectoryPath(),
            request.getFileNames());
        response.setOverwritePaths(overwritePaths);
        response.setConflict(!overwritePaths.isEmpty());
        return response;
    }

    private boolean isZipUpload(MultipartFile multipartFile) {
        return multipartFile != null && StringUtils.endsWithIgnoreCase(multipartFile.getOriginalFilename(), ".zip");
    }

    private void appendImportResult(UploadResult uploadResult, KbImportResult importResult, MultipartFile multipartFile,
                                    String fallbackPath) {
        if (importResult != null && importResult.getPostProcessErrors() != null) {
            uploadResult.getPostProcessErrors().addAll(importResult.getPostProcessErrors());
        }
        List<KbImportResult.Item> resultItems = importResult == null ? null : importResult.getData();
        if (resultItems == null || resultItems.isEmpty()) {
            UploadItem uploadItem = createUploadItem(fallbackPath, multipartFile.getOriginalFilename(), true, null);
            uploadResult.getUploadItems().add(uploadItem);
            incrementUploadSummary(uploadResult, true);
            return;
        }

        for (KbImportResult.Item resultItem : resultItems) {
            if (resultItem == null) {
                continue;
            }
            String filePath = StringUtils.defaultIfBlank(resultItem.getFilePath(), fallbackPath);
            boolean success = Boolean.TRUE.equals(resultItem.getSuccess());
            UploadItem uploadItem = createUploadItem(filePath, getLastSplitName(filePath), success,
                resultItem.getError());
            if (success) {
                uploadResult.getUploadItems().add(uploadItem);
            } else {
                uploadResult.getFailedItems().add(uploadItem);
            }
            incrementUploadSummary(uploadResult, success);
        }
    }

    private UploadItem createUploadItem(String filePath, String fileName, boolean success, String error) {
        UploadItem uploadItem = new UploadItem();
        uploadItem.setFileName(fileName);
        uploadItem.setFilePath(filePath);
        uploadItem.setSuccess(success);
        uploadItem.setError(error);
        return uploadItem;
    }

    private void incrementUploadSummary(UploadResult uploadResult, boolean success) {
        UploadResult.Summary summary = uploadResult.getSummary();
        summary.setTotal(summary.getTotal() + 1);
        if (success) {
            summary.setSucceeded(summary.getSucceeded() + 1);
        } else {
            summary.setFailed(summary.getFailed() + 1);
        }
    }

    /**
     * 知识构建
     *
     * @param datasetBuild 构建对象
     */
    public void build(DatasetBuild datasetBuild, Map<String, String> headers) {

        SsResource ssResource = loadDatasetResource(datasetBuild.getResourceId());
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, datasetBuild.getResourceId());

        // 构建知识文件
        KbFileToMarkdownIndex kbFileToMarkdownIndex = new KbFileToMarkdownIndex();
        kbFileToMarkdownIndex.setKnCode(ssResource.getResourceCode());
        kbFileToMarkdownIndex.setFilePath(datasetBuild.getDirectoryPath());

        logger.info("知识构建入参是:{}", JSON.toJSONString(kbFileToMarkdownIndex));
        PythonBuildResponse<Void> buildRet = feignPythonBuildService.fileToMarkdownIndex(kbFileToMarkdownIndex,
            forwardedHeaders);
        logger.info("构建结果是:{}", JSON.toJSONString(buildRet));
        assertPythonBuildSuccess(buildRet, "构建知识库文件");

    }

    /**
     * 原始文件同步转换为 Markdown 文件流，不落知识库、不触发构建。
     *
     * @param fileContent 原始文件
     * @return Markdown 文件流结果
     */
    public FileToMarkdownResult fileToMarkdown(MultipartFile fileContent) {
        return feignPythonBuildService.fileToMarkdown(fileContent);
    }

    /**
     * 下载文件
     *
     * @param resourceId    资源标识
     * @param directoryPath 文件路径，/百应AI设计方案-智能体集成.docx
     * @param response      响应流
     */
    public void download(Long resourceId, String directoryPath, HttpServletResponse response) {

        // 获取知识库信息
        SsResource ssResource = loadDatasetResource(resourceId);
        validateDatasetReadablePermission(ssResource);

        boolean directoryDownload = StringUtils.endsWith(StringUtils.trimToEmpty(directoryPath).replace('\\', '/'),
            "/");
        if (directoryDownload) {
            downloadKnowledgeDirectoryZip(ssResource, directoryPath, response);
            return;
        }

        // 提取参数
        KbFileDownload kbFileDownload = new KbFileDownload();
        kbFileDownload.setKnCode(ssResource.getResourceCode());
        kbFileDownload.setFilePath(normalizeKnowledgeFilePath(directoryPath));

        String fileName = this.getLastSplitName(kbFileDownload.getFilePath());
        // 下载文件
        try (InputStream inputStream = feignPythonBuildService.fileDownload(kbFileDownload, resourceId)) {
            // 设置ContentType，响应内容为二进制数据流，编码为utf-8，此处设定的编码是文件内容的编码
            response.setContentType(MediaType.APPLICATION_OCTET_STREAM_VALUE);
            // 以（Content-Disposition: attachment; filename="filename.jpg"）格式设定默认文件名，设定utf编码，此处的编码是文件名的编码，使能正确显示中文文件名
            String contentDisposition = "attachment;filename=" + URLEncoder.encode(fileName, StandardCharsets.UTF_8);
            response.setHeader("Content-Disposition", contentDisposition);
            IOUtils.copy(inputStream, response.getOutputStream());
        } catch (IOException e) {
            throw new BaseException("下载知识库文件失败：" + e.getMessage(), e);
        }
    }

    /**
     * 目录下载按 zip 包输出，和文件管理里的文件夹下载体验保持一致。
     */
    private void downloadKnowledgeDirectoryZip(SsResource ssResource, String directoryPath,
                                               HttpServletResponse response) {
        String normalizedDirectoryPath = normalizeKnowledgeDirectoryPath(directoryPath);
        String directoryName = getLastSplitName(normalizedDirectoryPath);
        String zipFileName = StringUtils.defaultIfBlank(directoryName,
            StringUtils.defaultIfBlank(ssResource.getResourceName(), "knowledge")) + ".zip";

        response.setContentType("application/zip");
        response.setHeader("Content-Disposition",
            "attachment;filename=" + URLEncoder.encode(zipFileName, StandardCharsets.UTF_8));

        try (
            ZipOutputStream zipOutputStream = new ZipOutputStream(response.getOutputStream(), StandardCharsets.UTF_8)) {
            addKnowledgeDirectoryToZip(ssResource.getResourceId(), ssResource.getResourceCode(),
                normalizedDirectoryPath, "", zipOutputStream);
        } catch (IOException e) {
            throw new BaseException("下载知识库目录失败：" + e.getMessage(), e);
        }
    }

    private void addKnowledgeDirectoryToZip(Long resourceId, String knCode, String directoryPath, String relativePrefix,
                                            ZipOutputStream zipOutputStream) throws IOException {
        List<DirAndFileVo> children = listKnowledgeDir(resourceId, knCode, directoryPath);
        for (DirAndFileVo child : children) {
            String entryName = sanitizeZipEntryName(child.getName());
            if (StringUtils.isBlank(entryName)) {
                continue;
            }
            if ("directory".equalsIgnoreCase(child.getType())) {
                String directoryEntryName = relativePrefix + entryName + "/";
                zipOutputStream.putNextEntry(new ZipEntry(directoryEntryName));
                zipOutputStream.closeEntry();
                addKnowledgeDirectoryToZip(resourceId, knCode, child.getDirectoryPath(), directoryEntryName,
                    zipOutputStream);
                continue;
            }

            String filePath = normalizeKnowledgeFilePath(child.getDirectoryPath());
            KbFileDownload kbFileDownload = new KbFileDownload();
            kbFileDownload.setKnCode(knCode);
            kbFileDownload.setFilePath(filePath);
            zipOutputStream
                .putNextEntry(new ZipEntry(relativePrefix + sanitizeZipEntryName(getLastSplitName(filePath))));
            try (InputStream inputStream = feignPythonBuildService.fileDownload(kbFileDownload, resourceId)) {
                IOUtils.copy(inputStream, zipOutputStream);
            }
            zipOutputStream.closeEntry();
        }
    }

    private String sanitizeZipEntryName(String name) {
        return StringUtils.trimToEmpty(name).replace('\\', '_').replace('/', '_');
    }

    /**
     * 删除文件
     *
     * @param removeFileDto 删除文件信息
     */
    public void removeFile(RemoveFileDto removeFileDto, Map<String, String> headers) {

        SsResource ssResource = loadDatasetResource(removeFileDto.getResourceId());
        validateDatasetManagePermission(ssResource);
        deleteKnowledgeFile(ssResource, removeFileDto.getDirectoryPath(), "删除知识库文件",
            forwardKnowledgeHeaders(headers, removeFileDto.getResourceId()));

    }

    /**
     * 更新已存在知识库文件。更新后不会自动触发 Markdown 转换、切片或向量化。
     */
    public KbFileUpdateResult updateKnowledgeFile(Long resourceId, String filePath, String fileDescription,
                                                  Boolean processFrontMatter, MultipartFile fileContent,
                                                  Map<String, String> headers) {
        SsResource ssResource = loadDatasetResource(resourceId);
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, resourceId);

        KbFileUpdate kbFileUpdate = new KbFileUpdate();
        kbFileUpdate.setKnCode(ssResource.getResourceCode());
        kbFileUpdate.setFilePath(normalizeKnowledgeFilePath(filePath));
        kbFileUpdate.setFileDescription(fileDescription);
        kbFileUpdate.setProcessFrontMatter(processFrontMatter);
        kbFileUpdate.setMultipartFile(fileContent);

        PythonBuildResponse<KbFileUpdateResult> response = feignPythonBuildService.updateKnowledgeItem(kbFileUpdate,
            forwardedHeaders);
        assertPythonBuildSuccess(response, "更新知识库文件");

        KbFileUpdateResult result = response.getResultObject();
        if (result == null) {
            return new KbFileUpdateResult();
        }
        if (result.getData() != null) {
            for (KbFileUpdateResult.Item item : result.getData()) {
                if (item != null) {
                    item.setResourceId(resourceId);
                }
            }
        }
        return result;
    }

    /**
     * 删除知识库文件。覆盖上传时复用该逻辑，保证手动删除和覆盖删除走同一套 QA 响应校验。
     */
    private void deleteKnowledgeFile(SsResource ssResource, String filePath, String operationName,
                                   Map<String, String> headers) {
        KbFileDelete kbFileDelete = new KbFileDelete();
        kbFileDelete.setKnCode(ssResource.getResourceCode());
        kbFileDelete.setFilePath(filePath);
        logger.info("删除文件入参:{}", JSON.toJSONString(kbFileDelete));
        PythonBuildResponse<Void> removeResponse = feignPythonBuildService.deleteKnowledgeItem(kbFileDelete,
            forwardKnowledgeHeaders(headers, ssResource.getResourceId()));
        logger.info("删除文件返回:{}", JSON.toJSONString(removeResponse));
        assertPythonBuildSuccess(removeResponse, operationName);

    }

    /**
     * 创建知识库目录
     *
     * @param folder 知识库
     */
    public KbDirectoryCreate createFolder(Folder folder, Map<String, String> headers) {

        Long resourceId = folder.getResourceId();
        String directoryName = folder.getDirectoryName();

        // 查询知识库
        SsResource ssResource = loadDatasetResource(resourceId);
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, resourceId);

        KbDirectoryCreate kbDirectoryCreate = new KbDirectoryCreate();
        kbDirectoryCreate.setKnCode(ssResource.getResourceCode());

        String directoryPath = folder.getDirectoryPath();
        kbDirectoryCreate.setDirectoryPath(buildKnowledgeFilePath(directoryPath, directoryName));
        kbDirectoryCreate.setDirectoryDescription(folder.getDirectoryDescription());

        PythonBuildResponse<Void> ret = feignPythonBuildService.createDirectory(kbDirectoryCreate, forwardedHeaders);
        logger.info("创建目录:{}", JsonUtil.toJSONString(ret));
        assertPythonBuildSuccess(ret, "创建知识库目录");

        return kbDirectoryCreate;
    }

    /**
     * 重命名知识库
     *
     * @param folder 目录
     */
    public KbDirectoryUpdate renameFolder(Folder folder, Map<String, String> headers) {

        SsResource ssResource = loadDatasetResource(folder.getResourceId());
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, folder.getResourceId());

        KbDirectoryUpdate kbDirectoryUpdate = new KbDirectoryUpdate();
        kbDirectoryUpdate.setKnCode(ssResource.getResourceCode());
        kbDirectoryUpdate.setDirectoryPath(folder.getDirectoryPath());
        kbDirectoryUpdate.setDirectoryName(folder.getDirectoryName());

        PythonBuildResponse<Void> ret = feignPythonBuildService.updateDirectory(kbDirectoryUpdate, forwardedHeaders);
        logger.info("修改目录:{}", JsonUtil.toJSONString(ret));
        assertPythonBuildSuccess(ret, "重命名知识库目录");

        return kbDirectoryUpdate;
    }

    /**
     * 删除目录
     *
     * @param folderDelete 删除目录参数
     */
    public void deleteFolder(FolderDelete folderDelete, Map<String, String> headers) {

        SsResource ssResource = loadDatasetResource(folderDelete.getResourceId());
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, folderDelete.getResourceId());

        KbDirectoryDelete kbDirectoryDelete = new KbDirectoryDelete();
        kbDirectoryDelete.setKnCode(ssResource.getResourceCode());
        kbDirectoryDelete.setDirectoryPath(folderDelete.getDirectoryPath());

        PythonBuildResponse<Void> ret = feignPythonBuildService.deleteDirectory(kbDirectoryDelete, forwardedHeaders);
        logger.info("删除目录:{}", JsonUtil.toJSONString(ret));
        assertPythonBuildSuccess(ret, "删除知识库目录");

    }

    /**
     * 批量移动知识库文件或目录。门户使用 resourceId，转发 QA 前转换为 knCode。
     */
    public KnowledgeItemsMoveResult moveKnowledgeItems(KnowledgeItemsMoveRequest request, Map<String, String> headers) {
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetManagePermission(ssResource);
        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, request.getResourceId());

        boolean hasTargetDirectory = StringUtils.isNotBlank(request.getTargetDirectoryPath());
        boolean hasTargetFile = StringUtils.isNotBlank(request.getTargetFilePath());
        if (hasTargetDirectory == hasTargetFile) {
            throw new BaseException("目标目录路径和目标文件路径必须且只能填写一个");
        }
        if (Boolean.TRUE.equals(request.getOverwrite())) {
            throw new BaseException("当前版本暂不支持覆盖已存在的目标路径");
        }

        KbKnowledgeItemsMove qaRequest = new KbKnowledgeItemsMove();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setSourcePath(new ArrayList<>(request.getSourcePath()));
        qaRequest.setTargetDirectoryPath(request.getTargetDirectoryPath());
        qaRequest.setTargetFilePath(request.getTargetFilePath());
        qaRequest.setOverwrite(Boolean.FALSE);

        PythonBuildResponse<KnowledgeItemsMoveResult> response = feignPythonBuildService.moveKnowledgeItems(qaRequest,
            forwardedHeaders);
        logger.info("移动知识库文件或目录:{}", JsonUtil.toJSONString(response));
        assertPythonBuildSuccess(response, "移动知识库文件或目录");
        return response.getResultObject() == null ? new KnowledgeItemsMoveResult() : response.getResultObject();
    }

    /**
     * 查询 Markdown 文件引用关系。门户使用 resourceId，转发 QA 前转换为 knCode。
     */
    public KnowledgeItemReferencesResult knowledgeItemReferences(KnowledgeItemReferencesRequest request) {
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetReadablePermission(ssResource);

        KbKnowledgeItemReferences qaRequest = new KbKnowledgeItemReferences();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setFilePath(normalizeKnowledgeFilePath(request.getFilePath()));
        qaRequest.setDirection(StringUtils.defaultIfBlank(request.getDirection(), "inbound"));

        PythonBuildResponse<KnowledgeItemReferencesResult> response = feignPythonBuildService
            .knowledgeItemReferences(qaRequest, request.getResourceId());
        assertPythonBuildSuccess(response, "查询知识库文件引用关系");
        return response.getResultObject() == null ? new KnowledgeItemReferencesResult() : response.getResultObject();
    }

    /**
     * 异步发现原始文档中的实体。门户使用 resourceId 校验知识库管理权限，转发 QA 时转换为 knCode。
     */
    public KnowledgeEntityBatchResult entityDiscovery(KnowledgeEntityDiscoveryRequest request, Map<String, String> headers) {
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetManagePermission(ssResource);

        KbEntityDiscovery qaRequest = new KbEntityDiscovery();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setFilePath(normalizeOptionalKnowledgeFilePath(request.getFilePath()));
        qaRequest.setMaxEntities(request.getMaxEntities() == null ? 12 : request.getMaxEntities());
        qaRequest.setForce(Boolean.TRUE.equals(request.getForce()));
        qaRequest.setExtraParams(
            request.getExtraParams() == null ? Collections.emptyMap() : request.getExtraParams());

        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, request.getResourceId());

        PythonBuildResponse<KnowledgeEntityBatchResult> response = feignPythonBuildService.entityDiscovery(qaRequest,
            forwardedHeaders);
        assertPythonBuildSuccess(response, "发起知识实体发现");
        return attachEntityBatchResourceId(response.getResultObject(), request.getResourceId());
    }

    /**
     * 异步补全 KnowledgeEntity 文档。门户使用 resourceId 校验知识库管理权限，转发 QA 时转换为 knCode。
     */
    public KnowledgeEntityBatchResult entityEnrich(KnowledgeEntityEnrichRequest request, Map<String, String> headers) {
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetManagePermission(ssResource);

        KbEntityEnrich qaRequest = new KbEntityEnrich();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setFilePath(normalizeOptionalKnowledgeFilePath(request.getFilePath()));
        qaRequest.setTopK(request.getTopK() == null ? 20 : request.getTopK());
        qaRequest.setForce(Boolean.TRUE.equals(request.getForce()));
        qaRequest.setExtraParams(
            request.getExtraParams() == null ? Collections.emptyMap() : request.getExtraParams());


        Map<String, String> forwardedHeaders = forwardKnowledgeHeaders(headers, request.getResourceId());

        PythonBuildResponse<KnowledgeEntityBatchResult> response = feignPythonBuildService.entityEnrich(qaRequest,
            forwardedHeaders);
        assertPythonBuildSuccess(response, "发起知识实体补全");
        return attachEntityBatchResourceId(response.getResultObject(), request.getResourceId());
    }

    /**
     * 按 QA glob 单层通配规则匹配知识库文件或目录。
     */
    public List<DirAndFileVo> globKnowledgeItems(KnowledgeGlobRequest request) {
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetReadablePermission(ssResource);

        KbGlob qaRequest = new KbGlob();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setPathRule(normalizeKnowledgeGlobRule(request.getPathRule()));

        PythonBuildResponse<Data> response = feignPythonBuildService.glob(qaRequest, request.getResourceId());
        assertPythonBuildSuccess(response, "按路径匹配知识库文件或目录");
        return mapKnowledgeDirItems(response.getResultObject(), request.getResourceId());
    }

    /**
     * 查询文件等级
     *
     * @param dirAndFileQo 查询入参
     * @return List
     */
    public List<DirAndFileVo> queryDirAndFileByLevel(DirAndFileQo dirAndFileQo) {

        String knCode = null;
        if (dirAndFileQo.getResourceId() != null) {
            SsResource ssResource = loadDatasetResource(dirAndFileQo.getResourceId());
            validateDatasetReadablePermission(ssResource);
            knCode = resolveKnowledgeCode(dirAndFileQo, ssResource);
        } else {
            // openApi接口查询不做校验
            knCode = dirAndFileQo.getResourceCode();
        }

        String listDirectoryPath = normalizeKnowledgeDirectoryPath(dirAndFileQo.getDirectoryPath());
        return listKnowledgeDir(dirAndFileQo.getResourceId(), knCode, listDirectoryPath);
    }

    /**
     * 按关键字递归搜索知识库目录和文件。 目录和文件可能存在同名、多层同名，返回结果必须携带完整 directoryPath，前端据此构建唯一树节点。
     */
    public List<DirAndFileVo> searchDirAndFile(DirAndFileQo dirAndFileQo) {
        SsResource ssResource = loadDatasetResource(dirAndFileQo.getResourceId());
        validateDatasetReadablePermission(ssResource);

        String keyword = StringUtils.trimToEmpty(dirAndFileQo.getKeyword());
        List<DirAndFileVo> resultList = new ArrayList<>();
        if (StringUtils.isBlank(keyword)) {
            return resultList;
        }

        String knCode = resolveKnowledgeCode(dirAndFileQo, ssResource);
        String rootDirectoryPath = normalizeKnowledgeDirectoryPath(dirAndFileQo.getDirectoryPath());
        searchKnowledgeDir(dirAndFileQo.getResourceId(), knCode, rootDirectoryPath, keyword.toLowerCase(), 0,
            resultList);
        return resultList;
    }

    private String resolveKnowledgeCode(DirAndFileQo dirAndFileQo, SsResource ssResource) {
        if (StringUtil.isNotEmpty(dirAndFileQo.getResourceCode())) {
            return dirAndFileQo.getResourceCode();
        }
        return ssResource.getResourceCode();
    }

    private void searchKnowledgeDir(Long resourceId, String knCode, String directoryPath, String keyword, int depth,
                                    List<DirAndFileVo> resultList) {
        if (depth > KNOWLEDGE_DIR_SEARCH_MAX_DEPTH || resultList.size() >= KNOWLEDGE_DIR_SEARCH_MAX_RESULT_SIZE) {
            return;
        }

        List<DirAndFileVo> currentLevelItems = listKnowledgeDir(resourceId, knCode, directoryPath);
        for (DirAndFileVo item : currentLevelItems) {
            if (resultList.size() >= KNOWLEDGE_DIR_SEARCH_MAX_RESULT_SIZE) {
                return;
            }
            String itemName = StringUtils.trimToEmpty(item.getName());
            if (StringUtils.containsIgnoreCase(itemName, keyword)) {
                resultList.add(item);
            }
            if ("directory".equalsIgnoreCase(item.getType())) {
                searchKnowledgeDir(resourceId, knCode, item.getDirectoryPath(), keyword, depth + 1, resultList);
            }
        }
    }

    private List<DirAndFileVo> listKnowledgeDir(Long resourceId, String knCode, String directoryPath) {
        KbListDir kbListDir = new KbListDir();
        kbListDir.setKnCode(knCode);
        kbListDir.setDirectoryPath(normalizeKnowledgeDirectoryPath(directoryPath));
        PythonBuildResponse<Data> response = feignPythonBuildService.listDir(kbListDir, resourceId);
        assertPythonBuildSuccess(response, "查询知识库目录");
        return mapKnowledgeDirItems(response.getResultObject(), resourceId);
    }

    private List<DirAndFileVo> mapKnowledgeDirItems(Data resultObject, Long resourceId) {
        List<DirAndFileVo> resultList = new ArrayList<>();
        if (resultObject == null || resultObject.getData() == null) {
            return resultList;
        }
        for (DirOrFile dirOrFile : resultObject.getData()) {
            if (dirOrFile == null) {
                continue;
            }
            DirAndFileVo dirAndFileVo = new DirAndFileVo();
            dirAndFileVo.setKnCode(dirOrFile.getKnCode());
            dirAndFileVo.setResourceId(resourceId);
            String type = dirOrFile.getType();
            String name = dirOrFile.getName();
            dirAndFileVo.setType(type);
            if ("file".equalsIgnoreCase(type)) {
                dirAndFileVo.setFileName(name);
            }
            dirAndFileVo.setName(this.getLastSplitName(name));
            dirAndFileVo.setDirectoryPath(name);
            dirAndFileVo.setSize(dirOrFile.getSize());
            resultList.add(dirAndFileVo);
        }

        return resultList;
    }

    /**
     * 查询指定目录下已存在的同名文件，返回完整文件路径。QA 的 import 暂不支持覆盖，所以覆盖上传前必须先找出旧文件。
     */
    private List<String> findExistingKnowledgeFilePaths(SsResource ssResource, String directoryPath,
                                                        List<String> fileNames) {
        if (fileNames == null || fileNames.isEmpty()) {
            return new ArrayList<>();
        }

        Set<String> targetFileNames = new HashSet<>();
        for (String fileName : fileNames) {
            String normalizedFileName = StringUtils.trimToEmpty(fileName).replace('\\', '/');
            if (StringUtils.isNotBlank(normalizedFileName) && !normalizedFileName.contains("/")) {
                targetFileNames.add(normalizedFileName);
            }
        }
        if (targetFileNames.isEmpty()) {
            return new ArrayList<>();
        }

        String normalizedDirectoryPath = normalizeKnowledgeDirectoryPath(directoryPath);
        KbListDir kbListDir = new KbListDir();
        kbListDir.setKnCode(ssResource.getResourceCode());
        kbListDir.setDirectoryPath(normalizedDirectoryPath);
        PythonBuildResponse<Data> response;
        try {
            response = feignPythonBuildService.listDir(kbListDir, ssResource.getResourceId());
        } catch (BaseException e) {
            if (isKnowledgeDirectoryNotFound(e)) {
                logger.info("检查知识库同名文件时目录不存在，按无冲突处理 directoryPath={}", normalizedDirectoryPath);
                return new ArrayList<>();
            }
            throw e;
        }
        if (isKnowledgeDirectoryNotFound(response)) {
            logger.info("检查知识库同名文件时目录不存在，按无冲突处理 directoryPath={}", normalizedDirectoryPath);
            return new ArrayList<>();
        }
        assertPythonBuildSuccess(response, "检查知识库同名文件");

        List<String> existingFilePaths = new ArrayList<>();
        Data resultObject = response.getResultObject();
        if (resultObject == null || resultObject.getData() == null) {
            return existingFilePaths;
        }
        for (DirOrFile dirOrFile : resultObject.getData()) {
            if (dirOrFile == null || !"file".equalsIgnoreCase(dirOrFile.getType())) {
                continue;
            }
            String existingName = getLastSplitName(dirOrFile.getName());
            String existingPath = StringUtils.contains(dirOrFile.getName(), "/")
                ? normalizeKnowledgeFilePath(dirOrFile.getName())
                : buildKnowledgeFilePath(directoryPath, existingName);
            if (targetFileNames.contains(existingName)) {
                existingFilePaths.add(existingPath);
            }
        }
        return existingFilePaths;
    }

    private boolean isKnowledgeDirectoryNotFound(PythonBuildResponse<?> response) {
        if (response == null || PythonBuildResponse.RESPONSE_SUCCESS
            .equalsIgnoreCase(StringUtils.trimToEmpty(response.getResultCode()))) {
            return false;
        }
        return isKnowledgeDirectoryNotFound(response.getResultMsg());
    }

    private boolean isKnowledgeDirectoryNotFound(Throwable throwable) {
        return throwable != null && isKnowledgeDirectoryNotFound(throwable.getMessage());
    }

    private boolean isKnowledgeDirectoryNotFound(String message) {
        String resultMsg = StringUtils.defaultString(message).toLowerCase();
        return resultMsg.contains("directory not found") || resultMsg.contains("目录不存在");
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
        } else {
            return directoryPath;
        }
    }

    /**
     * 知识库JSON导入（新增或更新）。
     *
     * @param ownerType 资源归属类型：enterprise-企业，personal-个人
     * @param file      上传的JSON文件
     * @return resourceId
     */
    @Transactional(rollbackFor = Exception.class)
    public Long importDatasetJson(String ownerType, Long catalogId, MultipartFile file) {

        // 校验上传文件
        String rawJson = parseAndValidateFile(file);

        // 校验json文件参数
        DatasetImportDto dto = parseAndValidateDto(rawJson, ownerType);
        dto.setCatalogId(catalogId);

        SsResource existing = ssResourceService.findByImportIdentity(dto.getSystemCode(), dto.getResourceBizType(),
            dto.getResourceCode());
        if (existing == null) {
            return createDatasetFromImport(dto, rawJson, ownerType);
        } else {
            ResourceImportOwnerTypeValidator.validate(existing, ownerType, dto.getResourceCode(), dto.getResourceName(),
                dto.getResourceBizType(), dto.getSystemCode());
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
        } catch (IOException e) {
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
        myResource.setResourceSourcePkId(datasetImportDto.getResourceSourcePkId());
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
        existing.setResourceSourcePkId(existing.getResourceSourcePkId());
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
        } else {
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
        } catch (NumberFormatException e) {
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
     * @param resourceId    资源标识
     * @param directoryPath 文件路径
     * @return ProcessStatus
     */
    public ProcessStatus fileBuildStatus(Long resourceId, String directoryPath) {

        SsResource ssResource = loadDatasetResource(resourceId);
        validateDatasetReadablePermission(ssResource);

        FileBuildStatus fileBuildStatus = new FileBuildStatus();
        fileBuildStatus.setKnCode(ssResource.getResourceCode());
        fileBuildStatus.setFilePath(directoryPath);
        PythonBuildResponse<ProcessStatus> ret = feignPythonBuildService.fileBuildStatus(fileBuildStatus, resourceId);
        assertPythonBuildSuccess(ret, "查询知识库文件构建状态");
        return ret.getResultObject();

    }

    /**
     * 读取知识库文件 Markdown 内容。对外使用 ByClaw resourceId，内部转为 QA knCode。
     */
    public KbFileReadResult readFile(KnowledgeReadFileRequest request) {
        if (request == null || request.getResourceId() == null) {
            throw new BaseException("知识库资源标识不能为空");
        }

        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetReadablePermission(ssResource);

        KbFileRead kbFileRead = new KbFileRead();
        kbFileRead.setKnCode(ssResource.getResourceCode());
        kbFileRead.setFilePath(normalizeKnowledgeFilePath(request.getFilePath()));
        kbFileRead.setStartLine(request.getStartLine());
        kbFileRead.setEndLine(request.getEndLine());

        PythonBuildResponse<KbFileReadResult> ret = feignPythonBuildService.readFile(kbFileRead,
            request.getResourceId());
        assertPythonBuildSuccess(ret, "读取知识库文件内容");

        KbFileReadResult result = ret.getResultObject();
        if (result != null) {
            result.setResourceId(request.getResourceId());
        }
        return result;
    }

    /**
     * 查询知识库文件完整构建结果。对外使用 resourceId，内部转为 QA knCode。
     */
    public KnowledgeBuildResult buildResult(KnowledgeBuildResultRequest request) {
        if (request == null || request.getResourceId() == null) {
            throw new BaseException("知识库资源标识不能为空");
        }

        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetReadablePermission(ssResource);

        KbBuildResult qaRequest = new KbBuildResult();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setFilePath(normalizeKnowledgeFilePath(request.getFilePath()));
        qaRequest.setChunkPage(request.getChunkPage() == null ? 1 : request.getChunkPage());
        qaRequest.setChunkPageSize(request.getChunkPageSize() == null ? 20 : request.getChunkPageSize());
        qaRequest.setIncludeMarkdown(request.getIncludeMarkdown() == null || request.getIncludeMarkdown());

        PythonBuildResponse<KnowledgeBuildResult> ret = feignPythonBuildService.buildResult(qaRequest,
            request.getResourceId());
        assertPythonBuildSuccess(ret, "查询知识库文件构建结果");

        KnowledgeBuildResult result = ret.getResultObject();
        if (result != null) {
            result.setResourceId(request.getResourceId());
        }
        return result;
    }

    /**
     * 查询知识库文件已入库的元数据。对外使用 ByClaw resourceId，内部转为 QA knCode。
     */
    public KbFileMetadataResult getKnowledgeFileMetadata(KnowledgeFileMetadataRequest request) {
        SsResource ssResource = loadDatasetResource(request.getResourceId());
        validateDatasetReadablePermission(ssResource);

        KbFileMetadataGet qaRequest = new KbFileMetadataGet();
        qaRequest.setKnCode(ssResource.getResourceCode());
        qaRequest.setFilePath(normalizeKnowledgeFilePath(request.getFilePath()));
        qaRequest.setMetadataFieldList(request.getMetadataFieldList());

        PythonBuildResponse<KbFileMetadataResult> response = feignPythonBuildService.getKnowledgeFileMetadata(qaRequest,
            request.getResourceId());
        assertPythonBuildSuccess(response, "查询知识库文件元数据");
        return response.getResultObject() == null ? new KbFileMetadataResult() : response.getResultObject();
    }

    /**
     * 执行知识库 chunk 检索。对外使用 ByClaw resourceIdList，内部转为 QA knCodeList。
     */
    public KnowledgeSearchResult searchKnowledgeItems(KnowledgeSearchRequest request) {
        if (request == null || request.getResourceIdList() == null || request.getResourceIdList().isEmpty()) {
            throw new BaseException("知识库资源标识列表不能为空");
        }

        List<String> knCodeList = new ArrayList<>();
        Map<String, Long> codeToResourceId = new HashMap<>();
        for (Long resourceId : request.getResourceIdList()) {
            if (resourceId == null) {
                throw new BaseException("知识库资源标识不能为空");
            }
            SsResource ssResource = loadDatasetResource(resourceId);
            validateDatasetReadablePermission(ssResource);
            knCodeList.add(ssResource.getResourceCode());
            codeToResourceId.put(ssResource.getResourceCode(), resourceId);
        }

        KbKnowledgeSearch kbKnowledgeSearch = new KbKnowledgeSearch();
        kbKnowledgeSearch.setQuery(request.getQuery());
        kbKnowledgeSearch.setKnCodeList(knCodeList);
        kbKnowledgeSearch.setTopK(request.getTopK());
        kbKnowledgeSearch.setWhere(request.getWhere());
        kbKnowledgeSearch.setMetadataFieldList(request.getMetadataFieldList());
        kbKnowledgeSearch.setFileTypeList(request.getFileTypeList());
        kbKnowledgeSearch.setSearchMode(request.getSearchMode());

        PythonBuildResponse<KnowledgeSearchResult> ret = feignPythonBuildService
            .searchKnowledgeItems(kbKnowledgeSearch);
        assertPythonBuildSuccess(ret, "检索知识库内容");

        KnowledgeSearchResult result = ret.getResultObject();
        if (result == null) {
            return new KnowledgeSearchResult();
        }
        if (result.getData() != null) {
            for (KnowledgeSearchItem item : result.getData()) {
                if (item == null) {
                    continue;
                }
                Long resourceId = codeToResourceId.get(item.getKnCode());
                if (resourceId != null) {
                    item.setResourceId(resourceId);
                }
            }
        }
        return result;
    }

    /**
     * 执行知识库 Agent DSL 文件级语义检索。门户使用 resourceIdList，内部转换为 QA knCodeList， 避免客户端绕过知识库访问权限直接传入 QA 知识库编码。
     */
    public KnowledgeFileSearchResult searchKnowledgeFiles(KnowledgeFileSearchRequest request) {
        if (request == null || request.getResourceIdList() == null || request.getResourceIdList().isEmpty()) {
            throw new BaseException("知识库资源标识列表不能为空");
        }

        List<String> knCodeList = new ArrayList<>();
        Map<String, Long> codeToResourceId = new HashMap<>();
        for (Long resourceId : request.getResourceIdList()) {
            if (resourceId == null) {
                throw new BaseException("知识库资源标识不能为空");
            }
            SsResource ssResource = loadDatasetResource(resourceId);
            validateDatasetReadablePermission(ssResource);
            knCodeList.add(ssResource.getResourceCode());
            codeToResourceId.put(ssResource.getResourceCode(), resourceId);
        }

        KbKnowledgeFileSearch kbKnowledgeFileSearch = new KbKnowledgeFileSearch();
        kbKnowledgeFileSearch.setQuery(request.getQuery());
        kbKnowledgeFileSearch.setKnCodeList(knCodeList);
        kbKnowledgeFileSearch.setWhere(request.getWhere());
        kbKnowledgeFileSearch.setSearchMode(request.getSearchMode());
        kbKnowledgeFileSearch.setMetadataFieldList(request.getMetadataFieldList());
        kbKnowledgeFileSearch.setTopK(request.getTopK());

        PythonBuildResponse<KnowledgeFileSearchResult> ret = feignPythonBuildService
            .searchKnowledgeFiles(kbKnowledgeFileSearch);
        assertPythonBuildSuccess(ret, "检索知识库文件");

        KnowledgeFileSearchResult result = ret.getResultObject();
        if (result == null) {
            return new KnowledgeFileSearchResult();
        }
        if (result.getData() != null) {
            for (KnowledgeFileSearchItem item : result.getData()) {
                if (item == null) {
                    continue;
                }
                Long resourceId = codeToResourceId.get(item.getKnCode());
                if (resourceId != null) {
                    item.setResourceId(resourceId);
                }
            }
        }
        return result;
    }

    /**
     * 执行 Agent DSL 纯元数据检索。门户校验 resourceIdList 的访问权限并转换为 QA knCodeList， 响应中保留 QA knCode，并补充回映后的 resourceId。
     */
    public KnowledgeMetadataSearchResult searchKnowledgeMetadata(KnowledgeMetadataSearchRequest request) {
        if (request == null || request.getResourceIdList() == null || request.getResourceIdList().isEmpty()) {
            throw new BaseException(I18nUtil.get("dataset.metadata.search.resource.id.list.notempty"));
        }

        List<String> knCodeList = new ArrayList<>();
        Map<String, Long> codeToResourceId = new HashMap<>();
        for (Long resourceId : request.getResourceIdList()) {
            if (resourceId == null) {
                throw new BaseException(I18nUtil.get("dataset.metadata.search.resource.id.notnull"));
            }
            SsResource ssResource = loadDatasetResource(resourceId);
            validateDatasetReadablePermission(ssResource);
            knCodeList.add(ssResource.getResourceCode());
            codeToResourceId.put(ssResource.getResourceCode(), resourceId);
        }

        KbKnowledgeMetadataSearch qaRequest = new KbKnowledgeMetadataSearch();
        qaRequest.setKnCodeList(knCodeList);
        qaRequest.setWhere(request.getWhere());
        qaRequest.setMetadataFieldList(request.getMetadataFieldList());
        qaRequest.setTopK(request.getTopK());
        qaRequest.setPageNum(request.getPageNum());
        qaRequest.setPageSize(request.getPageSize());

        PythonBuildResponse<KnowledgeMetadataSearchResult> ret = feignPythonBuildService
            .searchKnowledgeMetadata(qaRequest);
        assertPythonBuildSuccess(ret, I18nUtil.get("dataset.metadata.search.operation"));

        KnowledgeMetadataSearchResult result = ret.getResultObject();
        if (result == null) {
            return new KnowledgeMetadataSearchResult();
        }
        if (result.getData() != null) {
            for (KnowledgeMetadataSearchItem item : result.getData()) {
                if (item == null) {
                    continue;
                }
                Long resourceId = codeToResourceId.get(item.getKnCode());
                if (resourceId != null) {
                    item.setResourceId(resourceId);
                }
            }
        }
        return result;
    }

    /**
     * 面向 ByClaw-datacloud 的 QA 原始协议透传入口，不转换 knCode，也不改写 QA 响应信封。
     */
    public PythonBuildResponse<Object> searchKnowledgeMetadataByKnCode(KbKnowledgeMetadataSearch request) {
        return feignPythonBuildService.searchKnowledgeMetadataRaw(request);
    }

    /**
     * 统一知识库文件路径拼接，避免根目录 "/" 拼成 "//文件名"，从源头保证 BE 与 QA 的路径语义一致。
     */
    private String buildKnowledgeFilePath(String directoryPath, String fileName) {
        String normalizedDirectoryPath = normalizeKnowledgeDirectoryPath(directoryPath);
        String normalizedFileName = StringUtils.trimToEmpty(fileName).replace('\\', '/');
        if (StringUtils.isBlank(normalizedFileName) || normalizedFileName.contains("/")) {
            throw new BaseException("知识库文件名不合法");
        }
        return "/".equals(normalizedDirectoryPath) ? "/" + normalizedFileName
            : normalizedDirectoryPath + "/" + normalizedFileName;
    }

    /**
     * QA 返回的文件名按完整文件路径处理，统一补齐开头斜杠并压缩重复斜杠。
     */
    private String normalizeKnowledgeFilePath(String filePath) {
        String normalizedPath = StringUtils.trimToEmpty(filePath).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalizedPath)) {
            throw new BaseException("知识库文件路径不合法");
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        for (String pathPart : normalizedPath.split("/")) {
            if ("..".equals(pathPart)) {
                throw new BaseException("知识库文件路径不合法");
            }
        }
        return normalizedPath;
    }

    private String normalizeOptionalKnowledgeFilePath(String filePath) {
        return StringUtils.isBlank(filePath) ? null : normalizeKnowledgeFilePath(filePath);
    }

    private KnowledgeEntityBatchResult attachEntityBatchResourceId(KnowledgeEntityBatchResult result,
                                                                   Long resourceId) {
        KnowledgeEntityBatchResult resolved = result == null ? new KnowledgeEntityBatchResult() : result;
        resolved.setResourceId(resourceId);
        return resolved;
    }

    private String normalizeKnowledgeGlobRule(String pathRule) {
        String normalizedRule = normalizeKnowledgeFilePath(pathRule);
        if (normalizedRule.contains("**")) {
            throw new BaseException("知识库路径匹配暂不支持 ** 多层通配符");
        }
        return normalizedRule;
    }

    /**
     * 知识库目录路径统一为 "/" 或 "/a/b" 形式，不保留末尾斜杠，便于上传、查询、建目录使用同一套路径。
     */
    private String normalizeKnowledgeDirectoryPath(String directoryPath) {
        String normalizedPath = StringUtils.trimToEmpty(directoryPath).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalizedPath) || "/".equals(normalizedPath)) {
            return "/";
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        normalizedPath = StringUtils.removeEnd(normalizedPath, "/");
        for (String pathPart : normalizedPath.split("/")) {
            if ("..".equals(pathPart)) {
                throw new BaseException("知识库目录路径不合法");
            }
        }
        return normalizedPath;
    }

    /**
     * 合并门户透传请求头与知识库资源上下文，转发到 ByKC。
     * <p>
     * 调用方无透传头时可传 {@link Collections#emptyMap()}；本方法始终通过
     * {@code new HashMap<>(headers)} 拷贝入参，不会直接复用不可变 map，因此后续 {@code put} 安全。
     */
    private Map<String, String> forwardKnowledgeHeaders(Map<String, String> headers, Long resourceId) {
        Map<String, String> forwardedHeaders = headers == null ? new HashMap<>() : new HashMap<>(headers);
        if (resourceId != null) {
            forwardedHeaders.put(FeignPythonBuildService.RESOURCE_ID_HEADER, String.valueOf(resourceId));
        }
        return forwardedHeaders;
    }

    /**
     * QA 知识库接口业务失败时必须向前端抛错，避免出现“后端提示成功但文件没有落库/不可见”的假成功。
     */
    private void assertPythonBuildSuccess(PythonBuildResponse<?> response, String operationName) {
        if (response == null) {
            throw new BaseException(I18nUtil.get("dataset.pythonbuild.operation.response.empty", operationName));
        }
        if (PythonBuildResponse.RESPONSE_SUCCESS.equalsIgnoreCase(StringUtils.trimToEmpty(response.getResultCode()))) {
            return;
        }
        String resultMsg = StringUtils.defaultIfBlank(response.getResultMsg(), response.getResultCode());
        throw new BaseException(I18nUtil.get("dataset.pythonbuild.operation.failed", operationName, resultMsg));
    }

}
