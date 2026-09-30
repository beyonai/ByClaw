package com.iwhalecloud.byai.state.application.service.session;

import com.alibaba.fastjson2.JSON;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceArtifactTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportItem;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportResult;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.resource.vo.SkillMarketplaceDigitalEmployeeVo;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.utils.SeekableInMemoryByteChannel;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

/**
 * 对话框 #技能 上传后的资源入库与数字员工绑定服务。
 *
 * @author qin.guoquan
 * @date 2026-06-18 19:38:38
 */
@Service
public class ByClawSkillResourceApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(ByClawSkillResourceApplicationService.class);

    public static final String SOURCE_TYPE_CHAT_UPLOAD = "CHAT_UPLOAD";

    public static final String SOURCE_TYPE_SKILL_MANAGE_IMPORT = "SKILL_MANAGE_IMPORT";

    public static final String SOURCE_TYPE_FILE_MANAGE_UPLOAD = "FILE_MANAGE_UPLOAD";

    public static final String SOURCE_TYPE_SKILL_MARKET_INSTALL = "SKILL_MARKET_INSTALL";

    public static final String SOURCE_TYPE_ENTERPRISE_COPY = "ENTERPRISE_COPY";

    public static final String SOURCE_TYPE_IMPORT_REVIEW = "SKILL_IMPORT_REVIEW";

    public static final String SOURCE_TYPE_WORKSPACE_CENTER_SYNC = "WORKSPACE_CENTER_SYNC";

    private static final String PACKAGE_CONTENT_TYPE = "application/zip";

    private static final Long DEFAULT_SKILL_CATALOG_ID = 10L;

    private static final Long DEFAULT_MANAGER_ORG_ID = -1L;

    private static final String SKILL_HUB_ORG_DIRECTORY = "skill/org-hub";

    private static final String EXTERNAL_RESOURCE_ROOT = "/byclaw/resource";

    private static final String SKILL_DOC_FILE_NAME = "SKILL.md";

    private static final String PUBLICATION_RESOURCE_MANIFEST = "references/resourceMate.json";

    // 严格读取依赖声明，不能把重复键、尾随内容或类型错误当作无依赖放行。
    private static final ObjectReader PUBLICATION_MANIFEST_READER = new ObjectMapper()
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readerFor(JsonNode.class);

    private static final String ZIP_ENTRY_NAME_PRIMARY_ENCODING = "GBK";

    private static final String ZIP_ENTRY_NAME_FALLBACK_ENCODING = StandardCharsets.UTF_8.name();

    private static final int THIRD_PARTY_DOWNLOAD_TIMEOUT_MILLIS = 15_000;

    private static final int THIRD_PARTY_SKILL_MAX_BYTES = 50 * 1024 * 1024;

    private static final int THIRD_PARTY_ERROR_RESPONSE_LOG_MAX_BYTES = 4096;

    private static final String ADMIN_VIP_USER_CODE = "adminvip";

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtSkillService ssResExtSkillService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceArtifactService ssResourceArtifactService;

    @Autowired
    private ResourceArtifactStorageService resourceArtifactStorageService;

    @Autowired
    private ByClawBuiltinSkillExportService builtinSkillExportService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private com.iwhalecloud.byai.manager.application.service.resource.SkillPublicationService skillPublicationService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private DigitalEmployeeRuntimeRefreshService digitalEmployeeRuntimeRefreshService;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private UserFS userFS;

    @Autowired
    private ByClawSkillPathResolver skillPathResolver;

    @org.springframework.context.annotation.Lazy
    @Autowired
    private ByClawSkillQueryApplicationService personalSkillQueryService;

    @Autowired
    private ByClawSkillUploadApplicationService byClawSkillUploadApplicationService;

    @Autowired
    private UserService userService;

    @Autowired
    private PlatformTransactionManager transactionManager;

    /**
     * 删除工作空间(用户开发)技能前，校验当前用户对目标数字员工是否有管理权限。
     * 与绑定技能卸载同一口径，必须在真正删除文件之前调用。
     *
     * @param digitalEmployeeResourceId 数字员工资源 ID；为空时回退当前用户默认数字员工
     */
    public void assertWorkspaceSkillManagePermission(Long digitalEmployeeResourceId) {
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        digitalEmployeeApplicationService.assertSkillUninstallPermission(resolvedDigitalEmployeeId);
    }

    /**
     * 技能超市安装时，查询当前用户可管理的数字员工。
     *
     * <p>必须复用资源管理权限的统一口径，避免列表中可选、安装时却被拒绝，或列表漏掉组织管理员、
     * 显式管理授权等可管理数字员工。</p>
     */
    public List<SkillMarketplaceDigitalEmployeeVo> listSkillMarketplaceManageableDigitalEmployees() {
        return ssResourceService.listActiveDigitalEmployees().stream()
            .filter(authApplicationService::hasResourceManagePermission)
            .map(resource -> {
                SkillMarketplaceDigitalEmployeeVo item = new SkillMarketplaceDigitalEmployeeVo();
                item.setDigId(resource.getResourceId());
                item.setDigName(resource.getResourceName());
                return item;
            })
            .collect(Collectors.toList());
    }

    /**
     * 对话框 #技能 与左侧技能栏共用的上传预检。
     * 在工作区文件落盘前校验数字员工和同自然键技能的管理权限，避免出现资源入库失败但目录已被覆盖。
     */
    public void validateChatUploadedSkillImportPermission(Long digitalEmployeeResourceId, List<MultipartFile> files) {
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);
        if (CollectionUtils.isEmpty(files)) {
            return;
        }
        for (MultipartFile file : files) {
            SkillPackageMetadata metadata = inspectSkillPackage(file);
            for (SsResource existing : findExistingSkillsByNaturalKey(metadata.skillCode())) {
                assertSkillManagePermission(existing);
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    public void registerChatUploadedSkills(String userCode, Long digitalEmployeeResourceId,
        List<MultipartFile> uploadFiles, List<ByClawSkillDto> uploadedSkills) {
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        if (CollectionUtils.isEmpty(uploadFiles) || CollectionUtils.isEmpty(uploadedSkills)) {
            return;
        }
        if (uploadFiles.size() != uploadedSkills.size()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.upload.failed"));
        }
        SsResource digitalEmployee = validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);
        Set<Long> affectedDigitalEmployeeIds = new LinkedHashSet<>();
        affectedDigitalEmployeeIds.add(resolvedDigitalEmployeeId);

        for (int i = 0; i < uploadedSkills.size(); i++) {
            MultipartFile uploadFile = uploadFiles.get(i);
            ByClawSkillDto uploadedSkill = uploadedSkills.get(i);
            SkillPackageMetadata metadata = inspectSkillPackage(uploadFile);
            List<SsResource> existingSkills = findExistingSkillsByNaturalKey(metadata.skillCode());
            boolean updated = CollectionUtils.isNotEmpty(existingSkills);
            for (SsResource existing : existingSkills) {
                assertSkillManagePermission(existing);
            }
            List<SsResource> resourcesToUpdate = updated ? existingSkills : Collections.singletonList(null);
            SsResource primarySkillResource = null;
            for (SsResource existing : resourcesToUpdate) {
                String oldVersion = existing == null ? null : findSkillExtVersion(existing.getResourceId());
                SsResource skillResource = saveOrUpdateSkillResource(metadata, OwnerType.PERSONAL,
                    DEFAULT_SKILL_CATALOG_ID, existing);
                boolean primarySkill = primarySkillResource == null;
                if (primarySkill) {
                    primarySkillResource = skillResource;
                    // 与原逻辑一致：只为本次导入的主资源补齐创建者默认权限。
                    authApplicationService.ensureCreatorDefaultPrivileges(skillResource);
                }
                SsResExtSkill extSkill = saveOrUpdateSkillExt(userCode, skillResource, uploadFile, metadata,
                    uploadedSkill.getSkillPath(), uploadedSkill.getSkillDocObjectKey(), SOURCE_TYPE_CHAT_UPLOAD);
                if (primarySkill) {
                    bindSkillToDigitalEmployee(resolvedDigitalEmployeeId, skillResource.getResourceId());
                }
                addBoundDigitalEmployeeIds(affectedDigitalEmployeeIds, skillResource.getResourceId());
                syncSkillTargetContent(userCode, skillResource, extSkill, true);
                logSkillImportOperation(userCode, digitalEmployee, updated, skillResource.getResourceId(), oldVersion,
                    extSkill.getVersion(), uploadedSkill.getSkillPath(), extSkill.getSkillUrl());
            }
        }

        rebuildAndScheduleSkillRuntimeRefresh(affectedDigitalEmployeeIds);
    }

    @Transactional(rollbackFor = Exception.class)
    public ObjectZipImportResult importSkillZips(MultipartFile[] files, Long catalogId, String ownerType) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        result.setTotal(files.length);
        // 每个 ZIP 独立提交，失败包不能留下资源/审核半成品，也不能回滚其他成功项。
        var transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        for (MultipartFile file : files) {
            try {
                SkillImportResult itemResult = transaction.execute(status -> importSkillZip(file, catalogId, ownerType,
                    SOURCE_TYPE_SKILL_MANAGE_IMPORT));
                ObjectZipImportItem item = buildSuccessItem(itemResult);
                result.getItems().add(item);
                if (item.isUpdated()) {
                    result.getUpdatedItems().add(item);
                }
                else {
                    result.getCreatedItems().add(item);
                }
            }
            catch (Exception e) {
                result.getItems().add(buildFailedItem(file, e));
            }
        }
        fillImportSummary(result);
        return result;
    }

    /** 从第三方技能超市下载、资源化并安装到指定数字员工。 */
    @Transactional(rollbackFor = Exception.class)
    public SkillImportResult installThirdPartySkill(Long digId, String downloadUrl) {
        Long resolvedDigId = resolveDigitalEmployeeId(digId);
        String resolvedUserCode = StringUtils.trimToEmpty(CurrentUserHolder.getCurrentUserCode());
        String resolvedDownloadUrl = StringUtils.trimToEmpty(downloadUrl);
        if (StringUtils.isBlank(resolvedUserCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        validateDigitalEmployeeSkillManagePermission(resolvedDigId, SOURCE_TYPE_SKILL_MARKET_INSTALL);

        byte[] packageBytes = downloadThirdPartySkillPackage(resolvedDownloadUrl);
        String filename = resolveThirdPartySkillFilename(resolvedDownloadUrl);
        MultipartFile file = new ByteArrayMultipartFile(filename, packageBytes, PACKAGE_CONTENT_TYPE);
        SkillPackageMetadata packageMetadata = inspectSkillPackage(file);
        String resourceCode = DigestUtils.sha256Hex(resolvedDownloadUrl);
        SkillPackageMetadata metadata = new SkillPackageMetadata(packageMetadata.skillName(), resourceCode,
            packageMetadata.skillDesc(), packageMetadata.originalFilename(), packageMetadata.size());
        SsResource existing = ssResourceService.findByImportIdentity(SystemCode.WHAGE_AGENT.getCode(),
            ResourceBizTypeEnum.SKILL.name(), resourceCode);
        boolean updated = existing != null;
        if (updated && Objects.equals(existing.getResourceStatus(), ResourceStatus.DELETE.getNum())) {
            // 注销终态不能通过第三方技能重复导入复活，保持资源中心的生命周期语义一致。
            throw new IllegalArgumentException(I18nUtil.get("resource.lifecycle.status.invalid"));
        }
        if (updated && !authApplicationService.hasResourceManagePermission(existing)) {
            throw new IllegalArgumentException(
                I18nUtil.get("byclaw.skill.import.no.manage.permission", existing.getResourceName()));
        }

        SsResource resource = saveOrUpdateSkillResource(metadata, OwnerType.PERSONAL, DEFAULT_SKILL_CATALOG_ID,
            existing, SystemCode.WHAGE_AGENT.getCode());
        if (!updated) {
            authApplicationService.ensureCreatorDefaultPrivileges(resource);
        }
        SsResExtSkill extSkill = saveOrUpdateSkillExt(resolvedUserCode, resource, packageBytes, metadata, null, null,
            SOURCE_TYPE_SKILL_MARKET_INSTALL, resolvedDownloadUrl);
        bindSkillToDigitalEmployee(resolvedDigId, resource.getResourceId());
        syncSkillTargetContent(resolvedUserCode, resource, extSkill, true);
        rebuildAndScheduleSkillRuntimeRefresh(new LinkedHashSet<>(Collections.singletonList(resolvedDigId)));
        return new SkillImportResult(resource, extSkill, updated);
    }

    public ObjectZipImportResult previewSkillZipImportConflicts(MultipartFile[] files, String ownerType) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        result.setTotal(files.length);
        for (MultipartFile file : files) {
            try {
                SkillPackageMetadata metadata = inspectSkillPackage(file);
                List<SsResource> existingSkills = findExistingSkillsByNaturalKey(metadata.skillCode());
                boolean needsReview = requiresImportReview(ownerType, existingSkills);
                if (needsReview) {
                    validateReviewedImportTargets(existingSkills);
                    assertNoPendingImport(metadata.skillCode());
                } else {
                    existingSkills.forEach(this::assertSkillManagePermission);
                }
                SsResource existing = existingSkills.isEmpty() ? null : existingSkills.get(0);
                if (existing != null) {
                    ObjectZipImportItem item = new ObjectZipImportItem();
                    item.setResourceId(String.valueOf(existing.getResourceId()));
                    item.setResourceCode(existing.getResourceCode());
                    item.setResourceName(existing.getResourceName());
                    item.setResourceDesc(existing.getResourceDesc());
                    item.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
                    item.setCatalogId(existing.getCatalogId());
                    item.setUpdated(true);
                    item.setSuccess(true);
                    item.setReviewRequired(needsReview);
                    item.setMessage(I18nUtil.get(needsReview ? "byclaw.skill.import.review.overwrite"
                        : "byclaw.skill.import.cover.confirm.item"));
                    result.getUpdatedItems().add(item);
                    result.getItems().add(item);
                }
            }
            catch (Exception e) {
                result.getItems().add(buildFailedItem(file, e));
            }
        }
        fillImportSummary(result);
        result.setUpdatedCount(result.getUpdatedItems().size());
        return result;
    }

    /** 个人目录资源化只创建本人技能，不安装、绑定或同步默认数字员工。 */
    @Transactional(rollbackFor = Exception.class)
    public SkillImportResult resourceizeMyDirectorySkill(String skillPath, boolean overwriteConfirmed) {
        Long sourceId = personalSkillQueryService.resolveMySkillSource(skillPath);
        return resourceizeWorkspaceSkill(CurrentUserHolder.getCurrentUserCode(), sourceId, skillPath,
            overwriteConfirmed, false);
    }

    public ObjectZipImportResult previewMyDirectorySkillConflicts(String skillPath) {
        Long sourceId = personalSkillQueryService.resolveMySkillSource(skillPath);
        return previewSkillConflicts(
            buildWorkspaceSkillPackage(CurrentUserHolder.getCurrentUserCode(), sourceId, skillPath), true);
    }

    public ObjectZipImportResult previewWorkspaceSkillShareConflicts(String userCode, Long digitalEmployeeResourceId,
        String skillPath) {
        WorkspaceSkillPackage skillPackage = buildWorkspaceSkillPackage(userCode,
            resolveDigitalEmployeeId(digitalEmployeeResourceId), skillPath);
        return previewSkillConflicts(skillPackage, false);
    }

    private ObjectZipImportResult previewSkillConflicts(WorkspaceSkillPackage skillPackage, boolean personalOnly) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.setTotal(1);
        SsResource existing = findExistingSkillByNaturalKey(skillPackage.metadata().skillCode());
        if (personalOnly) assertPersonalSkillOwner(existing);
        if (existing != null) {
            assertSkillManagePermission(existing);
            ObjectZipImportItem item = new ObjectZipImportItem();
            item.setResourceId(String.valueOf(existing.getResourceId()));
            item.setResourceCode(existing.getResourceCode());
            item.setResourceName(existing.getResourceName());
            item.setResourceDesc(existing.getResourceDesc());
            item.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
            item.setCatalogId(existing.getCatalogId());
            item.setUpdated(true);
            item.setSuccess(true);
            item.setMessage(I18nUtil.get("byclaw.skill.import.cover.confirm.item"));
            result.getUpdatedItems().add(item);
            result.getItems().add(item);
        }
        fillImportSummary(result);
        result.setUpdatedCount(result.getUpdatedItems().size());
        return result;
    }

    @Transactional(rollbackFor = Exception.class)
    public SkillImportResult resourceizeAndBindWorkspaceSkill(String userCode, Long digitalEmployeeResourceId,
        String skillPath, boolean overwriteConfirmed) {
        return resourceizeWorkspaceSkill(userCode, resolveDigitalEmployeeId(digitalEmployeeResourceId), skillPath,
            overwriteConfirmed, true);
    }

    private SkillImportResult resourceizeWorkspaceSkill(String userCode, Long resolvedDigitalEmployeeId,
        String skillPath, boolean overwriteConfirmed, boolean bindEmployee) {
        if (bindEmployee) validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);
        WorkspaceSkillPackage skillPackage = buildWorkspaceSkillPackage(userCode, resolvedDigitalEmployeeId, skillPath);
        SsResource existing = findExistingSkillByNaturalKey(skillPackage.metadata().skillCode());
        if (!bindEmployee) assertPersonalSkillOwner(existing);
        if (existing != null && !overwriteConfirmed) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.cover.confirm.item"));
        }
        if (existing != null) {
            assertSkillManagePermission(existing);
        }

        boolean updated = existing != null;
        SsResource skillResource = saveOrUpdateSkillResource(skillPackage.metadata(), OwnerType.PERSONAL,
            DEFAULT_SKILL_CATALOG_ID, existing);
        if (!updated) {
            authApplicationService.ensureCreatorDefaultPrivileges(skillResource);
        }
        SsResExtSkill extSkill = saveOrUpdateSkillExt(userCode, skillResource, skillPackage.bytes(),
            skillPackage.metadata(), skillPackage.skillPath(), skillPackage.skillDocObjectKey(),
            SOURCE_TYPE_SKILL_MANAGE_IMPORT);
        if (bindEmployee) bindSkillToDigitalEmployee(resolvedDigitalEmployeeId, skillResource.getResourceId());
        syncSkillTargetContent(userCode, skillResource, extSkill, true);
        if (bindEmployee) {
            digitalEmployeeApplicationService.rebuildAndSaveDigitalEmployeeRelSkills(resolvedDigitalEmployeeId);
            digitalEmployeeApplicationService.synOpenClawWorkSpace(resolvedDigitalEmployeeId);
        }
        return new SkillImportResult(skillResource, extSkill, updated);
    }

    /** 个人目录只能覆盖本人个人技能，不能借目录资源化覆盖可管理的他人或企业资源。 */
    private void assertPersonalSkillOwner(SsResource resource) {
        if (resource == null) return;
        boolean personalOwner = OwnerType.PERSONAL.equals(resource.getOwnerType())
            || "personal_default".equals(resource.getOwnerType());
        if (!personalOwner || !Objects.equals(resource.getCreateBy(), CurrentUserHolder.getCurrentUserId())) {
            throw new IllegalArgumentException(
                I18nUtil.get("byclaw.skill.import.no.manage.permission", resource.getResourceName()));
        }
    }

    /** 供目录同步及发布校验复用资源包读取；始终读取资源中心包，不读取工作空间引用。 */
    byte[] readCenterSkillPackage(SsResource resource) {
        SsResExtSkill ext = ssResExtSkillService.findById(resource.getResourceId());
        // 内置技能没有上传包，复用资源中心下载时的镜像导出，仍以真实 SKILL.md 比较。
        if (ext != null && StringUtils.equalsIgnoreCase(ext.getSkillType(), SsResExtSkillService.INNER_SKILL_TYPE)) {
            return builtinSkillExportService.exportPackage(CurrentUserHolder.getCurrentUserCode(), resource.getResourceCode());
        }
        if (ext == null || StringUtils.isBlank(ext.getSkillUrl())) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.center.package.missing"));
        }
        try (InputStream input = resourceArtifactStorageService.readWithinResourceRoot(
            stripResourcePrefix(ext.getSkillUrl()))) {
            if (input == null) throw new IOException("Missing skill package");
            return input.readAllBytes();
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.center.package.missing"), e);
        }
    }

    /** 使用技能包目录名定位员工工作空间，避免把资源展示名或隔离编码当作目录名。 */
    String readCenterSkillDirectoryName(byte[] packageBytes, String fallback) {
        return StringUtils.defaultIfBlank(lastPathSegment(parentDirOf(findSkillDoc(readZipEntries(packageBytes)).name())),
            fallback);
    }

    byte[] readCenterSkillDocument(byte[] packageBytes) {
        return findSkillDoc(readZipEntries(packageBytes)).content();
    }

    /** 更新只替换根 SKILL.md，保留资源中心包中其他文件及执行权限。 */
    byte[] replaceCenterSkillDocument(byte[] packageBytes, byte[] document) {
        List<ZipEntryInfo> entries = readZipEntries(packageBytes);
        String documentName = findSkillDoc(entries).name();
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream zip =
                new org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream(bytes)) {
            zip.setEncoding(StandardCharsets.UTF_8.name());
            for (ZipEntryInfo entry : entries) {
                ZipArchiveEntry target = new ZipArchiveEntry(entry.name());
                target.setUnixMode(entry.unixMode());
                zip.putArchiveEntry(target);
                zip.write(documentName.equals(entry.name()) ? document : entry.content());
                zip.closeArchiveEntry();
            }
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), e);
        }
    }

    /** 调用方提供事务；更新保留资源 ID、归属、目录及上下架状态。 */
    SkillImportResult saveWorkspaceSkillCenterPackage(byte[] bytes, String ownerType, String resourceCode,
        String skillName, SsResource existing) {
        return saveWorkspaceSkillCenterPackage(bytes, ownerType, resourceCode, skillName, existing, null);
    }

    /** 保存、绑定和关系快照在同一事务内完成，提交成功后沿用现有运行时刷新流程。 */
    SkillImportResult saveWorkspaceSkillCenterPackage(byte[] bytes, String ownerType, String resourceCode,
        String skillName, SsResource existing, Long employeeId) {
        SkillPackageMetadata inspected = inspectSkillPackage(
            new ByteArrayMultipartFile(skillName + ".zip", bytes, PACKAGE_CONTENT_TYPE));
        SkillPackageMetadata metadata = new SkillPackageMetadata(skillName, resourceCode, inspected.skillDesc(),
            skillName + ".zip", bytes.length);
        SsResource resource;
        if (existing == null) {
            resource = saveOrUpdateSkillResource(metadata, ownerType, DEFAULT_SKILL_CATALOG_ID, null);
            authApplicationService.ensureCreatorDefaultPrivileges(resource);
        } else {
            assertSkillManagePermission(existing);
            existing.setResourceDesc(metadata.skillDesc());
            resource = ssResourceService.updateResourceEntity(existing);
        }
        String userCode = resolveResourceOwnerUserCode(resource);
        SsResExtSkill ext = saveOrUpdateSkillExt(userCode, resource, bytes, metadata, null, null,
            SOURCE_TYPE_WORKSPACE_CENTER_SYNC);
        syncSkillTargetContent(userCode, resource, ext, true);
        Set<Long> affectedEmployees = new LinkedHashSet<>();
        if (employeeId != null) {
            bindSkillToDigitalEmployee(employeeId, resource.getResourceId());
            affectedEmployees.add(employeeId);
        }
        addBoundDigitalEmployeeIds(affectedEmployees, resource.getResourceId());
        rebuildAndScheduleSkillRuntimeRefresh(affectedEmployees);
        return new SkillImportResult(resource, ext, existing != null);
    }

    public ObjectZipImportResult buildSingleSkillImportResult(SkillImportResult itemResult) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.setTotal(1);
        ObjectZipImportItem item = buildSuccessItem(itemResult);
        result.getItems().add(item);
        if (item.isUpdated()) {
            result.getUpdatedItems().add(item);
        }
        else {
            result.getCreatedItems().add(item);
        }
        fillImportSummary(result);
        return result;
    }

    /**
     * 一次性复制个人技能快照。锁定源资源直到事务结束，重复请求复用已有副本；
     * 企业副本拥有独立资源 ID 和编码，文件沿用源引用；先进入审核中，通过后才上架。
     */
    @Transactional(rollbackFor = Exception.class)
    public EnterpriseSkillPublishResult publishSkillToEnterprise(Long sourceId) {
        if (sourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }
        SsResource source = ssResourceService.findByIdForUpdate(sourceId);
        if (!authApplicationService.canPublishSkillToEnterprise(source)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.enterprise.no.permission"));
        }

        // 注销副本不复活；为下一份快照使用新的编码。来源标记防止误认同名的手工导入资源。
        String baseCode = "enterprise-skill-" + sourceId;
        String targetCode = baseCode;
        for (int attempt = 1; ; attempt++) {
            List<SsResource> existing = findExistingSkillsByNaturalKey(targetCode, true);
            if (existing.isEmpty()) {
                break;
            }
            for (SsResource candidate : existing) {
                SsResExtSkill candidateExt = ssResExtSkillService.findById(candidate.getResourceId());
                if (!OwnerType.ENTERPRISE.equals(candidate.getOwnerType()) || candidateExt == null
                    || !String.valueOf(sourceId).equals(extractString(candidateExt.getTargetContent(),
                        "sourceResourceId"))) {
                    throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.enterprise.code.conflict"));
                }
                // 驳回后重新提交当前个人技能的快照，保留旧审核历史及被驳回副本。
                if (!Objects.equals(candidate.getResourceStatus(), ResourceStatus.DELETE.getNum())
                    && !Objects.equals(candidate.getResourceStatus(), ResourceStatus.AUDIT_REJECT.getNum())) {
                    return new EnterpriseSkillPublishResult(candidate, true, personalPublicationDependencies(sourceId));
                }
            }
            targetCode = baseCode + "-" + (attempt + 1);
        }

        // 已有快照直接复用；只有新建或驳回后重提才检查当前源包，避免源包变化阻断查看和幂等重试。
        validatePublicationResourceManifest(source);

        SsResExtSkill sourceExt = ssResExtSkillService.findById(sourceId);
        // 校验读取原包；副本仍只复制数据库记录及文件引用，不重打包或上传文件。
        // 复用公共命名规则，保留已存在的语言后缀，避免重复追加企业标记。
        String targetName = com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationNames
            .enterpriseName(source.getResourceName(), null);
        // 同时兼容历史未加企业后缀的名称。
        if (ssResourceService.existsEnterpriseSkillByName(targetName)
            || !Objects.equals(source.getResourceName(), targetName)
                && ssResourceService.existsEnterpriseSkillByName(source.getResourceName())) {
            // 重名时标明本次上架人；仅调整企业副本名称，不改变个人技能或已有副本。
            String publisherName = StringUtils.defaultIfBlank(CurrentUserHolder.getCurrentUserName(),
                CurrentUserHolder.getCurrentUserCode());
            String baseName = targetName.replaceFirst("\\s*\\((企业|Enterprise)\\)$", "");
            targetName = com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationNames
                .enterpriseName(baseName + "（" + publisherName + "）", targetName);
        }
        SkillPackageMetadata metadata = new SkillPackageMetadata(targetName, targetCode,
            source.getResourceDesc(), sourceExt == null ? null : sourceExt.getSkillOriginalFilename(),
            sourceExt == null || sourceExt.getSkillPackageSize() == null ? 0 : sourceExt.getSkillPackageSize());
        SsResource target = saveOrUpdateSkillResource(metadata, OwnerType.ENTERPRISE, source.getCatalogId(), null);
        target.setResourceStatus(ResourceStatus.AUDIT.getNum());
        target.setAvatar(source.getAvatar());
        target.setTags(source.getTags());
        target.setSample(source.getSample());
        ssResourceService.updateResourceEntity(target);

        SsResExtSkill targetExt = new SsResExtSkill();
        if (sourceExt != null) {
            org.springframework.beans.BeanUtils.copyProperties(sourceExt, targetExt);
        }
        else {
            targetExt.setSkillType(SsResExtSkillService.DEFAULT_SKILL_TYPE);
            targetExt.setVersion(SsResExtSkillService.DEFAULT_VERSION);
            targetExt.setSkillPackageFormat(SsResExtSkillService.DEFAULT_PACKAGE_FORMAT);
        }
        targetExt.setResourceId(target.getResourceId());
        targetExt.setSourceType(SOURCE_TYPE_ENTERPRISE_COPY);
        // 继承源文件地址、版本和已有文件状态，不创建新的 PENDING 同步流程。
        targetExt.setTargetContent(buildTargetContent(target, targetExt,
            sourceExt == null ? null : extractString(sourceExt.getTargetContent(), "skillPath"),
            sourceExt == null ? null : extractString(sourceExt.getTargetContent(), "skillDocObjectKey")));
        Map<String, Object> content = JSON.parseObject(targetExt.getTargetContent());
        content.put("sourceResourceId", String.valueOf(sourceId));
        content.put("sourceCreatorId", source.getCreateBy() == null ? null : String.valueOf(source.getCreateBy()));
        content.put("sourceVersion", sourceExt == null ? null : sourceExt.getVersion());
        content.put("sourcePackageUrl", sourceExt == null ? null : sourceExt.getSkillUrl());
        targetExt.setTargetContent(JSON.toJSONString(content));
        ssResExtSkillService.saveOrUpdate(targetExt);
        authApplicationService.ensureCreatorDefaultPrivileges(target);
        if (StringUtils.isNotBlank(targetExt.getSkillUrl())) {
            // 文件关联也是数据库记录，沿用原引用，不写入不存在的新 ZIP 或标准 JSON 路径。
            ssResourceArtifactService.upsertArtifact(target.getResourceId(), ResourceBizTypeEnum.SKILL.name(),
                ResourceArtifactTypeEnum.IMPORT_ZIP.name(), "minio", stripResourcePrefix(targetExt.getSkillUrl()),
                "enterprise-skill-file-reference");
        }
        copyEnterpriseSkillRelations(sourceId, target.getResourceId());
        skillPublicationService.submit(source, target);
        logger.info("Submitted enterprise skill resource copy: sourceId={}, targetId={}, operatorId={}",
            sourceId, target.getResourceId(), CurrentUserHolder.getCurrentUserId());
        return new EnterpriseSkillPublishResult(target, false, personalPublicationDependencies(sourceId));
    }

    /** 包内声明是发布依赖的判断依据；数据库安装关系不能代替 references/resourceMate.json。 */
    private void validatePublicationResourceManifest(SsResource source) {
        List<ZipEntryInfo> entries;
        String skillRoot;
        try {
            entries = readZipEntries(readCenterSkillPackage(source));
            skillRoot = parentDirOf(findSkillDoc(entries).name());
        } catch (Exception e) {
            // 无法读取整个包时不能推断为“没有声明文件”。
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.publication.package.unreadable"), e);
        }
        String manifestPath = (skillRoot.isEmpty() ? "" : skillRoot + "/") + PUBLICATION_RESOURCE_MANIFEST;
        List<ZipEntryInfo> manifests = entries.stream().filter(entry -> manifestPath.equals(entry.name())).toList();
        if (manifests.isEmpty()) return;
        if (manifests.size() != 1) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.publication.manifest.invalid"));
        }
        Map<Long, String> dependencies = parsePublicationResourceManifest(manifests.get(0).content());
        if (dependencies.isEmpty()) return;

        Map<Long, SsResource> resources = ssResourceService.findByIdList(dependencies.keySet()).stream()
            .collect(Collectors.toMap(SsResource::getResourceId, resource -> resource));
        List<String> failures = new ArrayList<>();
        for (Map.Entry<Long, String> dependency : dependencies.entrySet()) {
            Long id = dependency.getKey();
            SsResource resource = resources.get(id);
            // 此处只拦截实际查到的个人依赖；查不到、跨企业及其他归属不扩大阻断范围。
            if (resource == null || !(OwnerType.PERSONAL.equals(resource.getOwnerType())
                || "personal_default".equals(resource.getOwnerType()))) {
                continue;
            }
            String type = StringUtils.defaultIfBlank(resource.getResourceBizType(), "-");
            String key = type.startsWith("KG_") ? "byclaw.skill.publication.personal.knowledge"
                : Set.of("TOOL", "TOOLKIT", "MCP", "MCP_TOOL").contains(type)
                    ? "byclaw.skill.publication.personal.tool" : "byclaw.skill.publication.personal.resource";
            failures.add(I18nUtil.get(key, StringUtils.defaultIfBlank(resource.getResourceName(), "-"),
                id.toString(), StringUtils.defaultIfBlank(resource.getResourceCode(), "-"), type,
                resource.getOwnerType()));
        }
        if (!failures.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.publication.dependencies.blocked",
                String.join("; ", failures)));
        }
    }

    /** 缺失文件或空数组允许发布；存在文件时必须提供完整且类型明确的资源声明。 */
    private Map<Long, String> parsePublicationResourceManifest(byte[] content) {
        try {
            JsonNode manifest = PUBLICATION_MANIFEST_READER.readTree(content);
            if (manifest == null || !manifest.isObject() || !manifest.path("resources").isArray()) {
                throw new IllegalArgumentException("Expected resources array");
            }
            Map<Long, String> dependencies = new LinkedHashMap<>();
            for (JsonNode entry : manifest.get("resources")) {
                JsonNode idNode = entry.path("resourceId");
                JsonNode typeNode = entry.path("resourceType");
                if (!(idNode.isTextual() || idNode.isIntegralNumber()) || !typeNode.isTextual()
                    || !Set.of("TOOL", "KNOWLEDGE_BASE").contains(typeNode.textValue())) {
                    throw new IllegalArgumentException("Invalid resource declaration");
                }
                String idText = idNode.asText();
                if (!idText.matches("[0-9]+")) throw new IllegalArgumentException("Invalid resource ID");
                long id = Long.parseLong(idText);
                if (id <= 0) throw new IllegalArgumentException("Invalid resource ID");
                String previous = dependencies.putIfAbsent(id, typeNode.textValue());
                if (previous != null && !previous.equals(typeNode.textValue())) {
                    throw new IllegalArgumentException("Conflicting resource types");
                }
            }
            return dependencies;
        } catch (IOException | IllegalArgumentException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.publication.manifest.invalid"), e);
        }
    }

    /** 只检查有效的显式关联；企业资源不会被计入个人依赖提醒。 */
    private List<SsResourceRelDetail> publicationRelations(Long sourceId) {
        return ssResourceRelDetailService.list(
            new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getComAcctId, CurrentUserHolder.getEnterpriseId())
                .eq(SsResourceRelDetail::getRelStatus, 1)
                .and(q -> q.eq(SsResourceRelDetail::getResourceId, sourceId)
                    .or().eq(SsResourceRelDetail::getRelResourceId, sourceId)));
    }

    private List<PublicationDependency> personalPublicationDependencies(Long sourceId) {
        List<Long> ids = publicationRelations(sourceId).stream()
            .map(rel -> Objects.equals(sourceId, rel.getResourceId()) ? rel.getRelResourceId() : rel.getResourceId())
            .filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return List.of();
        return ssResourceService.findByIdList(ids).stream()
            .filter(item -> OwnerType.PERSONAL.equals(item.getOwnerType()) || "personal_default".equals(item.getOwnerType()))
            .filter(item -> !Objects.equals(item.getResourceStatus(), ResourceStatus.DELETE.getNum()))
            .filter(item -> "DIG_EMPLOYEE".equals(item.getResourceBizType())
                || StringUtils.startsWith(item.getResourceBizType(), "KG_")
                || List.of("TOOL", "TOOLKIT", "MCP", "AGENT").contains(item.getResourceBizType()))
            .map(item -> new PublicationDependency(String.valueOf(item.getResourceId()), item.getResourceName(),
                item.getResourceBizType())).toList();
    }

    /** 企业副本保留出向企业依赖，不能把个人员工的安装关系迁移到企业副本。 */
    private void copyEnterpriseSkillRelations(Long sourceId, Long targetId) {
        List<SsResourceRelDetail> relations = publicationRelations(sourceId).stream()
            .filter(rel -> Objects.equals(sourceId, rel.getResourceId())).toList();
        List<Long> ids = relations.stream().map(SsResourceRelDetail::getRelResourceId)
            .filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return;
        Set<Long> enterpriseIds = ssResourceService.findByIdList(ids).stream()
            .filter(item -> OwnerType.ENTERPRISE.equals(item.getOwnerType()))
            .filter(item -> !Objects.equals(item.getResourceStatus(), ResourceStatus.DELETE.getNum()))
            .map(SsResource::getResourceId).collect(Collectors.toSet());
        for (SsResourceRelDetail relation : relations) {
            if (!enterpriseIds.contains(relation.getRelResourceId())) continue;
            SsResourceRelDetail copy = new SsResourceRelDetail();
            org.springframework.beans.BeanUtils.copyProperties(relation, copy);
            copy.setResourceRelDetailId(sequenceService.nextVal());
            copy.setResourceId(targetId);
            copy.setCreateBy(CurrentUserHolder.getCurrentUserId());
            copy.setCreateTime(new java.util.Date());
            ssResourceRelDetailService.save(copy);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    public SkillImportResult importSkillZip(MultipartFile file, Long catalogId, String ownerType, String sourceType) {
        SkillPackageMetadata metadata = inspectSkillPackage(file);
        String resolvedOwnerType = resolveOwnerType(ownerType);
        Long resolvedCatalogId = catalogId == null ? DEFAULT_SKILL_CATALOG_ID : catalogId;
        ssResourceService.lockSkillImport(metadata.skillCode());
        List<SsResource> existingSkills = findExistingSkillsByNaturalKey(metadata.skillCode());
        // 依据实际目标归属判断，不能借 personal 参数覆盖企业技能来绕过审核。
        if (requiresImportReview(resolvedOwnerType, existingSkills)) {
            validateReviewedImportTargets(existingSkills);
            return submitSkillImport(file, metadata, resolvedCatalogId, existingSkills);
        }
        if (CollectionUtils.isEmpty(existingSkills)) {
            return importNewSkillZip(file, metadata, resolvedOwnerType, resolvedCatalogId, sourceType);
        }

        for (SsResource existing : existingSkills) {
            assertSkillManagePermission(existing);
        }

        SkillImportResult primaryResult = null;
        Set<Long> affectedDigitalEmployeeIds = new LinkedHashSet<>();
        for (SsResource existing : existingSkills) {
            SkillImportResult result = overwriteSkillZip(file, metadata, resolvedOwnerType, resolvedCatalogId,
                sourceType, existing, affectedDigitalEmployeeIds);
            if (primaryResult == null) {
                primaryResult = result;
            }
        }
        rebuildAndScheduleSkillRuntimeRefresh(affectedDigitalEmployeeIds);
        return primaryResult;
    }

    private boolean requiresImportReview(String ownerType, List<SsResource> existing) {
        return !skillPublicationService.canReview() && (OwnerType.ENTERPRISE.equals(ownerType)
            || existing.stream().anyMatch(resource -> OwnerType.ENTERPRISE.equals(resource.getOwnerType())));
    }

    private void validateReviewedImportTargets(List<SsResource> existing) {
        if (CurrentUserHolder.getEnterpriseId() == null || CurrentUserHolder.getCurrentUserId() == null) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.enterprise.no.permission"));
        }
        for (SsResource resource : existing) {
            // 保留已有覆盖管理权限，提交审核不等于获得修改他人技能的权限。
            assertSkillManagePermission(resource);
            if (!OwnerType.ENTERPRISE.equals(resource.getOwnerType())
                || !Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId())) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.enterprise.code.conflict"));
            }
        }
    }

    private String importReviewCode(String skillCode) {
        return "skill-import-review-" + DigestUtils.sha256Hex(CurrentUserHolder.getEnterpriseId() + ":"
            + CurrentUserHolder.getCurrentUserId() + ":" + skillCode);
    }

    private void assertNoPendingImport(String skillCode) {
        if (!findExistingSkillsByNaturalKey(importReviewCode(skillCode)).isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.review.pending"));
        }
    }

    /** 待审核包使用独立资源和不可变存储路径，不写运行 JSON，不改变线上版本或安装关系。 */
    private SkillImportResult submitSkillImport(MultipartFile file, SkillPackageMetadata metadata, Long catalogId,
        List<SsResource> existing) {
        assertNoPendingImport(metadata.skillCode());
        List<ImportReviewTarget> targets = existing.stream().map(resource -> {
            SsResource locked = ssResourceService.findByIdForUpdate(resource.getResourceId());
            if (locked == null) throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.review.stale"));
            validateReviewedImportTargets(List.of(locked));
            SsResExtSkill ext = ssResExtSkillService.findById(locked.getResourceId());
            return new ImportReviewTarget(locked.getResourceId(), locked.getResourceStatus(),
                ext == null ? null : ext.getVersion(), ext == null ? null : ext.getSkillPackageHash());
        }).toList();
        SkillPackageMetadata snapshotMetadata = new SkillPackageMetadata(metadata.skillName(),
            importReviewCode(metadata.skillCode()), metadata.skillDesc(), metadata.originalFilename(), metadata.size());
        SsResource snapshot = saveOrUpdateSkillResource(snapshotMetadata, OwnerType.ENTERPRISE, catalogId, null,
            SystemCode.BYAI.getCode(), ResourceStatus.AUDIT.getNum());
        authApplicationService.ensureCreatorDefaultPrivileges(snapshot);
        SsResExtSkill ext = saveOrUpdateSkillExt(CurrentUserHolder.getCurrentUserCode(), snapshot, file,
            snapshotMetadata, null, null, SOURCE_TYPE_IMPORT_REVIEW);
        Map<String, Object> content = JSON.parseObject(ext.getTargetContent());
        content.put("importResourceCode", metadata.skillCode());
        content.put("importTargets", targets);
        ext.setTargetContent(JSON.toJSONString(content));
        ssResExtSkillService.saveOrUpdate(ext);
        skillPublicationService.submit(null, snapshot);
        return new SkillImportResult(snapshot, ext, !targets.isEmpty());
    }

    /** 在审核事务内替换已审核内容；驳回只归档申请编码，允许申请人重新导入。 */
    public void applySkillImportReview(SsResource snapshot, boolean approve) {
        SsResExtSkill snapshotExt = ssResExtSkillService.findById(snapshot.getResourceId());
        if (snapshotExt == null || !SOURCE_TYPE_IMPORT_REVIEW.equals(snapshotExt.getSourceType())) return;
        if (!skillPublicationService.canReview()) {
            throw new IllegalArgumentException(I18nUtil.get("skill.publication.review.denied"));
        }
        var content = JSON.parseObject(snapshotExt.getTargetContent());
        String originalCode = content.getString("importResourceCode");
        if (StringUtils.isBlank(originalCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.review.stale"));
        }
        ssResourceService.lockSkillImport(originalCode);
        if (!approve) {
            snapshot.setResourceCode(snapshot.getResourceCode() + "-" + snapshot.getResourceId());
            return;
        }
        List<ImportReviewTarget> targets = content.getList("importTargets", ImportReviewTarget.class);
        if (targets == null) throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.review.stale"));
        List<SsResource> current = findExistingSkillsByNaturalKey(originalCode);
        Set<Long> expectedIds = targets.stream().map(ImportReviewTarget::resourceId).collect(Collectors.toSet());
        if (!expectedIds.equals(current.stream().map(SsResource::getResourceId).collect(Collectors.toSet()))) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.review.stale"));
        }
        List<SsResource> lockedTargets = new ArrayList<>();
        // 全量校验完成后才写入，任何一个目标变化都要求重新提交，避免旧申请覆盖新版本。
        for (ImportReviewTarget expected : targets) {
            SsResource target = ssResourceService.findByIdForUpdate(expected.resourceId());
            SsResExtSkill ext = ssResExtSkillService.findById(expected.resourceId());
            if (target == null || !OwnerType.ENTERPRISE.equals(target.getOwnerType())
                || !Objects.equals(snapshot.getComAcctId(), target.getComAcctId())
                || !originalCode.equals(target.getResourceCode())
                || !Objects.equals(expected.status(), target.getResourceStatus())
                || !Objects.equals(expected.version(), ext == null ? null : ext.getVersion())
                || !Objects.equals(expected.packageHash(), ext == null ? null : ext.getSkillPackageHash())) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.review.stale"));
            }
            lockedTargets.add(target);
        }
        if (targets.isEmpty()) {
            snapshot.setResourceCode(originalCode);
            snapshotExt.setSourceType(SOURCE_TYPE_SKILL_MANAGE_IMPORT);
            snapshotExt.setTargetContent(buildTargetContent(snapshot, snapshotExt, null, null));
            ssResExtSkillService.saveOrUpdate(snapshotExt);
            scheduleApprovedImportSync(snapshot);
            return;
        }
        Set<Long> affectedDigitalEmployeeIds = new LinkedHashSet<>();
        for (SsResource target : lockedTargets) {
            SsResExtSkill previous = ssResExtSkillService.findById(target.getResourceId());
            SsResExtSkill approved = new SsResExtSkill();
            org.springframework.beans.BeanUtils.copyProperties(snapshotExt, approved);
            approved.setResourceId(target.getResourceId());
            approved.setSourceType(previous != null && SOURCE_TYPE_CHAT_UPLOAD.equals(previous.getSourceType())
                ? SOURCE_TYPE_CHAT_UPLOAD : SOURCE_TYPE_SKILL_MANAGE_IMPORT);
            approved.setVersion(previous == null ? SsResExtSkillService.DEFAULT_VERSION
                : ssResExtSkillService.nextVersion(previous.getVersion()));
            // 保留个人发布副本的来源标记；文件仍引用隔离的审核包，不覆盖旧 ZIP。
            approved.setTargetContent(previous == null ? null : previous.getTargetContent());
            target.setResourceName(snapshot.getResourceName());
            target.setResourceDesc(snapshot.getResourceDesc());
            target.setCatalogId(snapshot.getCatalogId());
            target.setResourceStatus(ResourceStatus.ON_SHELF.getNum());
            target.setPublishTime(new Date());
            ssResourceService.updateResourceEntity(target);
            approved.setTargetContent(buildTargetContent(target, approved,
                previous == null ? null : extractString(previous.getTargetContent(), "skillPath"),
                previous == null ? null : extractString(previous.getTargetContent(), "skillDocObjectKey")));
            ssResExtSkillService.saveOrUpdate(approved);
            scheduleApprovedImportSync(target);
            addBoundDigitalEmployeeIds(affectedDigitalEmployeeIds, target.getResourceId());
        }
        // 覆盖审核快照保留用于审核历史，不作为第二份官方技能展示，也不能再次上架。
        snapshot.setResourceCode(snapshot.getResourceCode() + "-" + snapshot.getResourceId());
        snapshot.setResourceStatus(ResourceStatus.DELETE.getNum());
        rebuildAndScheduleSkillRuntimeRefresh(affectedDigitalEmployeeIds);
    }

    /** 数据库提交后才刷新文件及旧工作空间副本；回滚的审核绝不能向运行态发布内容。 */
    private void scheduleApprovedImportSync(SsResource resource) {
        Runnable sync = () -> {
            var transaction = new TransactionTemplate(transactionManager);
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            try {
                transaction.executeWithoutResult(status -> {
                    // 另一次更新可能先于本回调完成；锁定并重新读取最新状态，避免旧回调覆盖新运行产物。
                    ssResourceService.lockSkillImport(resource.getResourceCode());
                    SsResource latest = ssResourceService.findByIdForUpdate(resource.getResourceId());
                    SsResExtSkill ext = ssResExtSkillService.findById(resource.getResourceId());
                    if (latest == null || ext == null
                        || !Objects.equals(latest.getResourceStatus(), ResourceStatus.ON_SHELF.getNum())) return;
                    String userCode = resolveResourceOwnerUserCode(latest);
                    syncSkillTargetContent(userCode, latest, ext, true);
                    if (SOURCE_TYPE_CHAT_UPLOAD.equals(ext.getSourceType())) {
                        byte[] bytes = readCenterSkillPackage(latest);
                        var file = new ByteArrayMultipartFile(ext.getSkillOriginalFilename(), bytes, PACKAGE_CONTENT_TYPE);
                        syncLegacyWorkspaceCopy(userCode, inspectSkillPackage(file), file, ext.getSourceType(),
                            extractString(ext.getTargetContent(), "skillPath"),
                            findBoundDigitalEmployees(latest.getResourceId()));
                    }
                });
            } catch (RuntimeException exception) {
                logger.error("Approved skill import artifact refresh failed, resourceId={}", resource.getResourceId(), exception);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        sync.run();
                    }
                });
        } else {
            sync.run();
        }
    }

    public record ImportReviewTarget(Long resourceId, Integer status, String version, String packageHash) {
    }

    private SkillImportResult importNewSkillZip(MultipartFile file, SkillPackageMetadata metadata, String ownerType,
        Long catalogId, String sourceType) {
        SsResource resource = saveOrUpdateSkillResource(metadata, ownerType, catalogId, null);
        authApplicationService.ensureCreatorDefaultPrivileges(resource);
        String resourceOwnerUserCode = resolveResourceOwnerUserCode(resource);
        SsResExtSkill extSkill = saveOrUpdateSkillExt(resourceOwnerUserCode, resource, file, metadata, null, null,
            sourceType);
        syncSkillTargetContent(resourceOwnerUserCode, resource, extSkill, true);
        logSkillImportOperation(resourceOwnerUserCode, resolveCurrentUserDefaultDigitalEmployee(), false,
            resource.getResourceId(), null, extSkill.getVersion(), null, extSkill.getSkillUrl());
        return new SkillImportResult(resource, extSkill, false);
    }

    private SkillImportResult overwriteSkillZip(MultipartFile file, SkillPackageMetadata metadata, String ownerType,
        Long catalogId, String sourceType, SsResource existing, Set<Long> affectedDigitalEmployeeIds) {
        SsResExtSkill previousExtSkill = ssResExtSkillService.findById(existing.getResourceId());
        String oldVersion = previousExtSkill == null ? null : previousExtSkill.getVersion();
        String previousSourceType = previousExtSkill == null ? null : previousExtSkill.getSourceType();
        String previousSkillPath = previousExtSkill == null ? null
            : extractString(previousExtSkill.getTargetContent(), "skillPath");
        String previousSkillDocObjectKey = previousExtSkill == null ? null
            : extractString(previousExtSkill.getTargetContent(), "skillDocObjectKey");
        SsResource resource = saveOrUpdateSkillResource(metadata, ownerType, catalogId, existing);
        String resourceOwnerUserCode = resolveResourceOwnerUserCode(resource);
        boolean preserveLegacyWorkspaceMetadata = StringUtils.equals(SOURCE_TYPE_CHAT_UPLOAD, previousSourceType);
        SsResExtSkill extSkill = saveOrUpdateSkillExt(resourceOwnerUserCode, resource, file, metadata,
            preserveLegacyWorkspaceMetadata ? previousSkillPath : null,
            preserveLegacyWorkspaceMetadata ? previousSkillDocObjectKey : null,
            preserveLegacyWorkspaceMetadata ? previousSourceType : sourceType);
        syncSkillTargetContent(resourceOwnerUserCode, resource, extSkill, true);
        logSkillImportOperation(resourceOwnerUserCode, resolveCurrentUserDefaultDigitalEmployee(), true,
            resource.getResourceId(), oldVersion, extSkill.getVersion(),
            preserveLegacyWorkspaceMetadata ? previousSkillPath : null, extSkill.getSkillUrl());
        List<SsResource> boundDigitalEmployees = findBoundDigitalEmployees(resource.getResourceId());
        boundDigitalEmployees.stream().map(SsResource::getResourceId).filter(Objects::nonNull)
            .forEach(affectedDigitalEmployeeIds::add);
        syncLegacyWorkspaceCopy(resourceOwnerUserCode, metadata, file, previousSourceType, previousSkillPath,
            boundDigitalEmployees);
        return new SkillImportResult(resource, extSkill, true);
    }

    @Transactional(rollbackFor = Exception.class)
    public void registerFileManagedSkills(String userCode, Long digitalEmployeeResourceId, String directoryPath,
        List<MultipartFile> files) {
        if (CollectionUtils.isEmpty(files)) {
            return;
        }
        List<MultipartFile> zipFiles = files.stream().filter(this::isZipFile).collect(Collectors.toList());
        if (CollectionUtils.isEmpty(zipFiles)) {
            return;
        }
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);
        for (MultipartFile file : zipFiles) {
            SkillPackageMetadata metadata = inspectSkillPackage(file);
            SsResource skillResource = saveOrUpdateSkillResource(metadata, OwnerType.PERSONAL,
                DEFAULT_SKILL_CATALOG_ID);
            authApplicationService.ensureCreatorDefaultPrivileges(skillResource);
            String skillPath = normalizeUploadedFilePath(directoryPath, metadata.originalFilename());
            SsResExtSkill extSkill = saveOrUpdateSkillExt(userCode, skillResource, file, metadata, skillPath, null,
                SOURCE_TYPE_FILE_MANAGE_UPLOAD);
            bindSkillToDigitalEmployee(resolvedDigitalEmployeeId, skillResource.getResourceId());
            syncSkillTargetContent(userCode, skillResource, extSkill, true);
        }
        digitalEmployeeApplicationService.rebuildAndSaveDigitalEmployeeRelSkills(resolvedDigitalEmployeeId);
        digitalEmployeeApplicationService.synOpenClawWorkSpace(resolvedDigitalEmployeeId);
    }

    @Transactional(rollbackFor = Exception.class)
    public String refreshSkillBasicInfo(SsResource skillResource) {
        if (skillResource == null || skillResource.getResourceId() == null) {
            return null;
        }
        SsResExtSkill extSkill = ssResExtSkillService.findById(skillResource.getResourceId());
        if (extSkill == null) {
            return null;
        }
        extSkill.setVersion(ssResExtSkillService.nextVersion(extSkill.getVersion()));
        extSkill.setSyncStatus("SUCCESS");
        extSkill.setSyncError(null);
        extSkill.setLastSyncTime(LocalDateTime.now());
        extSkill.setTargetContent(buildTargetContent(skillResource, extSkill,
            extractString(extSkill.getTargetContent(), "skillPath"),
            extractString(extSkill.getTargetContent(), "skillDocObjectKey")));
        ssResExtSkillService.saveOrUpdate(extSkill);
        // 下架期间允许维护信息，但不能因编辑而重新发布运行产物。
        if (Objects.equals(skillResource.getResourceStatus(), ResourceStatus.ON_SHELF.getNum())) {
            syncSkillTargetContent(resolveResourceOwnerUserCode(skillResource), skillResource, extSkill, false);
        }
        return extSkill.getTargetContent();
    }

    @Transactional(rollbackFor = Exception.class)
    public void unlinkWorkspaceSkill(String userCode, Long digitalEmployeeResourceId, String skillPath,
        String skillName) {
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);
        String resolvedSkillName = StringUtils.defaultIfBlank(skillName, lastPathSegment(skillPath));
        SsResource skillResource = findExistingSkill(resolvedSkillName, OwnerType.PERSONAL);
        if (skillResource != null) {
            ssResourceRelDetailService.remove(new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getResourceId, resolvedDigitalEmployeeId)
                .eq(SsResourceRelDetail::getRelResourceId, skillResource.getResourceId()));
            digitalEmployeeApplicationService.rebuildAndSaveDigitalEmployeeRelSkills(resolvedDigitalEmployeeId);
        }
        // 目录已删除，即使历史技能没有资源记录也要通知运行态；提交后刷新，避免读到尚未解绑的关联。
        digitalEmployeeRuntimeRefreshService.scheduleDigitalEmployeeUpdateRefreshAfterCommit(
            resolvedDigitalEmployeeId, null);
    }

    private Long resolveDigitalEmployeeId(Long digitalEmployeeResourceId) {
        Long resolved = digitalEmployeeResourceId != null ? digitalEmployeeResourceId
            : CurrentUserHolder.getDefaultDigEmployeeId();
        if (resolved == null) {
            throw new IllegalArgumentException("数字员工资源ID不能为空");
        }
        return resolved;
    }

    /**
     * 技能绑定到数字员工前，统一校验当前用户对该数字员工是否有管理权限。
     *
     * <p>与 {@code DigitalEmployeeApplicationService.validateSkillInstallPermission} 同口径：仅有使用权限
     * （例如别人授权给我的个人助理）的用户不允许安装/绑定技能。此前工作空间、文件管理、对话上传这几条
     * 绑定链路缺少该校验，会出现“提示安装成功但技能并未真正生效/不展示”的问题。</p>
     */
    private SsResource validateDigitalEmployeeSkillManagePermission(Long digitalEmployeeResourceId) {
        return validateDigitalEmployeeSkillManagePermission(digitalEmployeeResourceId, null);
    }

    private SsResource validateDigitalEmployeeSkillManagePermission(Long digitalEmployeeResourceId,
        String operationSource) {
        SsResource digitalEmployee = digitalEmployeeResourceId == null ? null
            : ssResourceService.findById(digitalEmployeeResourceId);
        boolean detailedLog = StringUtils.equals(operationSource, SOURCE_TYPE_SKILL_MARKET_INSTALL);
        if (digitalEmployee == null) {
            if (detailedLog) {
                logger.warn(
                    "第三方技能安装数字员工权限校验失败，reason=RESOURCE_NOT_FOUND, requestedDigitalEmployeeId={}, "
                        + "currentUserId={}, currentUserCode={}, defaultDigitalEmployeeId={}, loginInfo={}",
                    digitalEmployeeResourceId, CurrentUserHolder.getCurrentUserId(),
                    CurrentUserHolder.getCurrentUserCode(), CurrentUserHolder.getDefaultDigEmployeeId(),
                    JSON.toJSONString(CurrentUserHolder.getLoginInfo()));
            }
            throw new IllegalArgumentException(I18nUtil.get("resource.not.found"));
        }
        boolean baseManagePermission = authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee);
        boolean managePermission = baseManagePermission;
        if (detailedLog) {
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            String currentUserCode = CurrentUserHolder.getCurrentUserCode();
            List<String> currentUserTypes = CurrentUserHolder.getUserTypes();
            boolean platformAdmin = currentUserTypes.stream()
                .anyMatch(type -> UserType.matchesAny(type, UserType.PLAT_MAN, UserType.PLAT_DEVOPS));
            boolean organizationAdminRole = currentUserTypes.stream().anyMatch(type -> UserType.matchesAny(type, UserType.ORG_MAN));
            boolean businessAdmin = currentUserTypes.stream().anyMatch(type -> UserType.matchesAny(type, UserType.BUSINESS_MAN));
            boolean superAdmin = ADMIN_VIP_USER_CODE.equalsIgnoreCase(currentUserCode);
            boolean creatorMatched = Objects.equals(currentUserId, digitalEmployee.getCreateBy());
            boolean defaultDigitalEmployeeMatched = Objects.equals(digitalEmployeeResourceId,
                CurrentUserHolder.getDefaultDigEmployeeId());
            boolean personalDefaultOwnerTypeMatched = StringUtils.equals(digitalEmployee.getOwnerType(),
                OwnerType.PERSONAL_DEFAULT);
            boolean defaultSuperAssistantCodeMatched = StringUtils.equals(digitalEmployee.getResourceCode(),
                StringUtils.defaultString(currentUserCode) + "_main");
            logger.info(
                "第三方技能安装数字员工权限校验详情，operationSource={}, requestedDigitalEmployeeId={}, "
                    + "currentUserId={}, currentUserCode={}, currentUserName={}, enterpriseId={}, assistantId={}, "
                    + "defaultDigitalEmployeeId={}, creatorMatched={}, personalDefaultOwnerTypeMatched={}, "
                    + "defaultDigitalEmployeeMatched={}, defaultSuperAssistantCodeMatched={}, "
                    + "baseManagePermission={}, platformAdmin={}, organizationAdminRole={}, businessAdmin={}, "
                    + "superAdmin={}, userTypes={}, managePermission={}, targetDigitalEmployee={}, loginInfo={}",
                operationSource, digitalEmployeeResourceId, currentUserId, currentUserCode,
                CurrentUserHolder.getCurrentUserName(), CurrentUserHolder.getEnterpriseId(),
                CurrentUserHolder.getAssistantId(), CurrentUserHolder.getDefaultDigEmployeeId(), creatorMatched,
                personalDefaultOwnerTypeMatched, defaultDigitalEmployeeMatched, defaultSuperAssistantCodeMatched,
                baseManagePermission, platformAdmin, organizationAdminRole, businessAdmin, superAdmin,
                currentUserTypes, managePermission, JSON.toJSONString(digitalEmployee),
                JSON.toJSONString(CurrentUserHolder.getLoginInfo()));
        }
        if (!managePermission) {
            throw new IllegalArgumentException(
                I18nUtil.get("digemployee.skill.install.no.manage.permission", digitalEmployee.getResourceName()));
        }
        return digitalEmployee;
    }

    private SsResource saveOrUpdateSkillResource(SkillPackageMetadata metadata, String ownerType, Long catalogId) {
        SsResource existing = findExistingSkillByNaturalKey(metadata.skillCode());
        return saveOrUpdateSkillResource(metadata, ownerType, catalogId, existing);
    }

    private SsResource saveOrUpdateSkillResource(SkillPackageMetadata metadata, String ownerType, Long catalogId,
        SsResource existing) {
        return saveOrUpdateSkillResource(metadata, ownerType, catalogId, existing, SystemCode.BYAI.getCode());
    }

    private SsResource saveOrUpdateSkillResource(SkillPackageMetadata metadata, String ownerType, Long catalogId,
        SsResource existing, String systemCode) {
        return saveOrUpdateSkillResource(metadata, ownerType, catalogId, existing, systemCode,
            ResourceStatus.ON_SHELF.getNum());
    }

    private SsResource saveOrUpdateSkillResource(SkillPackageMetadata metadata, String ownerType, Long catalogId,
        SsResource existing, String systemCode, Integer initialStatus) {
        if (existing == null) {
            SsResource resource = new SsResource();
            resource.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
            resource.setSystemCode(systemCode);
            resource.setResourceType("ATOM");
            resource.setResourceName(metadata.skillName());
            resource.setResourceCode(metadata.skillCode());
            resource.setResourceDesc(metadata.skillDesc());
            resource.setResourceVersionId("1.0");
            resource.setHostType("hosted");
            resource.setCatalogId(catalogId);
            resource.setManOrgId(DEFAULT_MANAGER_ORG_ID);
            resource.setResourceStatus(initialStatus);
            resource.setResourceDVerid(-1L);
            resource.setResourceRVerid(-1L);
            resource.setAuthStatus("passed");
            resource.setPublishPortal(1);
            resource.setParentResourceId(-1L);
            resource.setPublishType("publish");
            resource.setOwnerType(ownerType);
            resource.setImplType("SKILL");
            resource.setWorkerAgentType("NONE");
            return ssResourceService.saveResource(resource);
        }

        assertSkillManagePermission(existing);

        existing.setResourceName(metadata.skillName());
        existing.setResourceDesc(metadata.skillDesc());
        existing.setResourceStatus(ResourceStatus.ON_SHELF.getNum());
        existing.setResourceVersionId("1.0");
        existing.setHostType("hosted");
        existing.setCatalogId(catalogId);
        existing.setManOrgId(DEFAULT_MANAGER_ORG_ID);
        existing.setAuthStatus("passed");
        existing.setPublishPortal(1);
        existing.setPublishTime(new Date());
        existing.setSystemCode(systemCode);
        // 覆盖已有企业/个人技能时保留原归属，不能因左侧上传把企业技能改为个人技能。
        existing.setImplType("SKILL");
        existing.setWorkerAgentType("NONE");
        return ssResourceService.updateResourceEntity(existing);
    }

    protected byte[] downloadThirdPartySkillPackage(String downloadUrl) {
        long startNanos = System.nanoTime();
        String resolvedDownloadUrl = StringUtils.trimToEmpty(downloadUrl);
        HttpURLConnection connection = null;
        String stage = "VALIDATE_URL";
        int status = -1;
        String responseMessage = "";
        String contentType = "";
        long contentLength = -1L;
        String redirectLocation = "";
        int downloadedBytes = 0;
        String errorResponse = "";
        try {
            URI uri = URI.create(resolvedDownloadUrl);
            boolean supportedScheme = "http".equalsIgnoreCase(uri.getScheme())
                || "https".equalsIgnoreCase(uri.getScheme());
            if (!supportedScheme || StringUtils.isBlank(uri.getHost())) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.third.party.skill.url.invalid"));
            }
            stage = "OPEN_CONNECTION";
            connection = (HttpURLConnection)new URL(uri.toASCIIString()).openConnection();
            connection.setConnectTimeout(THIRD_PARTY_DOWNLOAD_TIMEOUT_MILLIS);
            connection.setReadTimeout(THIRD_PARTY_DOWNLOAD_TIMEOUT_MILLIS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            stage = "GET_HTTP_RESPONSE";
            status = connection.getResponseCode();
            responseMessage = StringUtils.defaultString(connection.getResponseMessage());
            contentType = StringUtils.defaultString(connection.getContentType());
            contentLength = connection.getContentLengthLong();
            redirectLocation = StringUtils.defaultString(connection.getHeaderField("Location"));
            if (status < 200 || status >= 300) {
                stage = "VALIDATE_HTTP_STATUS";
                errorResponse = readThirdPartyDownloadErrorResponseForLog(connection);
                throw new IllegalArgumentException(I18nUtil.get("byclaw.third.party.skill.download.failed"));
            }
            stage = "VALIDATE_CONTENT_LENGTH";
            if (contentLength > THIRD_PARTY_SKILL_MAX_BYTES) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.third.party.skill.package.too.large"));
            }
            stage = "READ_RESPONSE_BODY";
            try (InputStream input = connection.getInputStream();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    downloadedBytes += read;
                    if (downloadedBytes > THIRD_PARTY_SKILL_MAX_BYTES) {
                        stage = "VALIDATE_DOWNLOADED_SIZE";
                        throw new IllegalArgumentException(I18nUtil.get("byclaw.third.party.skill.package.too.large"));
                    }
                    output.write(buffer, 0, read);
                }
                if (downloadedBytes == 0) {
                    stage = "VALIDATE_RESPONSE_BODY";
                    throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
                }
                return output.toByteArray();
            }
        }
        catch (IllegalArgumentException e) {
            logThirdPartySkillDownloadFailure(resolvedDownloadUrl, stage, status, responseMessage, contentType,
                contentLength, redirectLocation, downloadedBytes, errorResponse, startNanos, e);
            throw e;
        }
        catch (Exception e) {
            logThirdPartySkillDownloadFailure(resolvedDownloadUrl, stage, status, responseMessage, contentType,
                contentLength, redirectLocation, downloadedBytes, errorResponse, startNanos, e);
            throw new IllegalArgumentException(I18nUtil.get("byclaw.third.party.skill.download.failed"), e);
        }
        finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readThirdPartyDownloadErrorResponseForLog(HttpURLConnection connection) {
        try (InputStream input = connection.getErrorStream()) {
            if (input == null) {
                return "";
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int remaining = THIRD_PARTY_ERROR_RESPONSE_LOG_MAX_BYTES;
            int read;
            while (remaining > 0 && (read = input.read(buffer, 0, Math.min(buffer.length, remaining))) != -1) {
                output.write(buffer, 0, read);
                remaining -= read;
            }
            String responseBody = output.toString(StandardCharsets.UTF_8);
            if (remaining == 0 && input.read() != -1) {
                responseBody += "...[truncated]";
            }
            return responseBody;
        }
        catch (Exception e) {
            return "[读取错误响应失败：" + e.getClass().getName() + ": "
                + StringUtils.defaultString(e.getMessage()) + "]";
        }
    }

    private void logThirdPartySkillDownloadFailure(String downloadUrl, String stage, int status,
        String responseMessage, String contentType, long contentLength, String redirectLocation,
        int downloadedBytes, String errorResponse, long startNanos, Exception exception) {
        logger.error(
            "第三方技能包下载失败，userCode={}, downloadUrl={}, stage={}, httpStatus={}, responseMessage={}, "
                + "contentType={}, contentLength={}, redirectLocation={}, downloadedBytes={}, errorResponse={}, "
                + "durationMs={}, exceptionType={}, reason={}",
            CurrentUserHolder.getCurrentUserCode(), downloadUrl, stage, status, responseMessage, contentType,
            contentLength, redirectLocation, downloadedBytes, errorResponse,
            (System.nanoTime() - startNanos) / 1_000_000L, exception.getClass().getName(),
            StringUtils.defaultString(exception.getMessage()), exception);
    }

    private String resolveThirdPartySkillFilename(String downloadUrl) {
        try {
            String filename = lastPathSegment(URI.create(downloadUrl).getPath());
            return StringUtils.endsWithIgnoreCase(filename, ".zip") ? filename : "market-skill.zip";
        }
        catch (Exception ignored) {
            return "market-skill.zip";
        }
    }

    /**
     * 未注销技能主资源的自然键是 {@code BYAI + SKILL + resourceCode}，不区分个人、企业归属。
     * 所有会写入技能主资源的入口都必须先走本方法，避免跨归属重复插入。
     */
    private SsResource findExistingSkillByNaturalKey(String skillCode) {
        List<SsResource> sameNaturalKeySkills = findExistingSkillsByNaturalKey(skillCode);
        if (CollectionUtils.isEmpty(sameNaturalKeySkills)) {
            return null;
        }
        Optional<SsResource> manageableSkill = sameNaturalKeySkills.stream()
            .filter(authApplicationService::hasResourceManagePermission).findFirst();
        if (manageableSkill.isPresent()) {
            return manageableSkill.get();
        }
        return sameNaturalKeySkills.stream().filter(this::isAdminVipInnerSkill).findFirst()
            .orElseThrow(() -> new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.no.manage.permission",
                sameNaturalKeySkills.get(0).getResourceName())));
    }

    private List<SsResource> findExistingSkillsByNaturalKey(String skillCode) {
        return findExistingSkillsByNaturalKey(skillCode, false);
    }

    private List<SsResource> findExistingSkillsByNaturalKey(String skillCode, boolean includeDeregistered) {
        if (StringUtils.isBlank(skillCode)) {
            return List.of();
        }
        List<SsResource> resources = ssResourceService.getResourceListByCode(List.of(skillCode));
        if (CollectionUtils.isEmpty(resources)) {
            return List.of();
        }
        return resources.stream()
            .filter(resource -> resource != null && StringUtils.equals(SystemCode.BYAI.getCode(),
                resource.getSystemCode()))
            .filter(resource -> ResourceBizTypeEnum.SKILL.name().equals(resource.getResourceBizType()))
            // 注销记录只保留历史，不再作为导入覆盖目标；企业发布快照仍需保留历史编码占位。
            .filter(resource -> includeDeregistered
                || !Objects.equals(resource.getResourceStatus(), ResourceStatus.DELETE.getNum()))
            .collect(Collectors.toList());
    }

    private SsResource findExistingSkill(String skillCode, String ownerType) {
        if (StringUtils.isBlank(skillCode)) {
            return null;
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        List<SsResource> resources = ssResourceService.getResourceListByCode(List.of(skillCode));
        if (CollectionUtils.isEmpty(resources)) {
            return null;
        }
        return resources.stream()
            .filter(item -> item != null && ResourceBizTypeEnum.SKILL.name().equals(item.getResourceBizType()))
            .filter(item -> StringUtils.equals(ownerType, item.getOwnerType()))
            .filter(item -> !OwnerType.PERSONAL.equals(ownerType) || Objects.equals(currentUserId, item.getCreateBy()))
            .findFirst()
            .orElse(null);
    }

    void assertSkillManagePermission(SsResource skillResource) {
        if (skillResource != null && Objects.equals(skillResource.getResourceStatus(), ResourceStatus.DELETE.getNum())) {
            throw new IllegalArgumentException(I18nUtil.get("resource.lifecycle.status.invalid"));
        }
        SsResExtSkill extSkill = skillResource == null || skillResource.getResourceId() == null ? null
            : ssResExtSkillService.findById(skillResource.getResourceId());
        if (isAdminVipInnerSkill(skillResource, extSkill)) {
            return;
        }
        if (extSkill != null && StringUtils.equalsIgnoreCase(extSkill.getSkillType(),
            SsResExtSkillService.INNER_SKILL_TYPE)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.inner.readonly"));
        }
        if (!authApplicationService.hasResourceManagePermission(skillResource)) {
            throw new IllegalArgumentException(
                I18nUtil.get("byclaw.skill.import.no.manage.permission", skillResource.getResourceName()));
        }
    }

    private boolean isAdminVipInnerSkill(SsResource skillResource) {
        SsResExtSkill extSkill = skillResource == null || skillResource.getResourceId() == null ? null
            : ssResExtSkillService.findById(skillResource.getResourceId());
        return isAdminVipInnerSkill(skillResource, extSkill);
    }

    private boolean isAdminVipInnerSkill(SsResource skillResource, SsResExtSkill extSkill) {
        return skillResource != null && extSkill != null
            && ADMIN_VIP_USER_CODE.equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode())
            && StringUtils.equalsIgnoreCase(extSkill.getSkillType(), SsResExtSkillService.INNER_SKILL_TYPE);
    }

    private String findSkillExtVersion(Long resourceId) {
        SsResExtSkill extSkill = resourceId == null ? null : ssResExtSkillService.findById(resourceId);
        return extSkill == null ? null : extSkill.getVersion();
    }

    private SsResource resolveCurrentUserDefaultDigitalEmployee() {
        Long digitalEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        if (digitalEmployeeId == null) {
            return null;
        }
        try {
            return ssResourceService.findById(digitalEmployeeId);
        }
        catch (Exception e) {
            // 日志补全失败不能影响技能导入主流程。
            logger.warn("技能操作日志未能获取数字员工信息, digitalEmployeeId={}", digitalEmployeeId, e);
            return null;
        }
    }

    private void logSkillImportOperation(String fallbackUserCode, SsResource digitalEmployee, boolean updated,
        Long skillId, String oldVersion, String newVersion, String skillPath, String fallbackSkillPath) {
        String userCode = StringUtils.defaultIfBlank(CurrentUserHolder.getCurrentUserCode(), fallbackUserCode);
        String userName = StringUtils.defaultIfBlank(CurrentUserHolder.getCurrentUserName(), userCode);
        Long digitalEmployeeId = digitalEmployee == null ? CurrentUserHolder.getDefaultDigEmployeeId()
            : digitalEmployee.getResourceId();
        String digitalEmployeeName = digitalEmployee == null ? "未设置"
            : StringUtils.defaultIfBlank(digitalEmployee.getResourceName(), "未命名");
        String operation = updated ? "技能覆盖" : "技能新增";
        logger.info("用户{}({})正在执行数字员工{}({})的技能操作，operation={}，skillId={}，o-version={}，n-version={}，skillPath={}",
            userName, userCode, digitalEmployeeName, digitalEmployeeId, operation, skillId,
            StringUtils.defaultString(oldVersion), StringUtils.defaultString(newVersion),
            StringUtils.defaultIfBlank(skillPath, fallbackSkillPath));
    }

    private List<SsResource> findBoundDigitalEmployees(Long skillResourceId) {
        if (skillResourceId == null) {
            return List.of();
        }
        List<SsResourceRelDetail> relations = ssResourceRelDetailService
            .list(new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getRelResourceId, skillResourceId));
        if (CollectionUtils.isEmpty(relations)) {
            return List.of();
        }
        List<Long> digitalEmployeeIds = relations.stream().map(SsResourceRelDetail::getResourceId)
            .filter(Objects::nonNull).distinct().collect(Collectors.toList());
        if (CollectionUtils.isEmpty(digitalEmployeeIds)) {
            return List.of();
        }
        List<SsResource> resources = ssResourceService.findByIdList(digitalEmployeeIds);
        if (CollectionUtils.isEmpty(resources)) {
            return List.of();
        }
        return resources.stream().filter(resource -> resource != null
            && ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(resource.getResourceBizType()))
            .collect(Collectors.toList());
    }

    private void addBoundDigitalEmployeeIds(Set<Long> affectedDigitalEmployeeIds, Long skillResourceId) {
        findBoundDigitalEmployees(skillResourceId).stream().map(SsResource::getResourceId).filter(Objects::nonNull)
            .forEach(affectedDigitalEmployeeIds::add);
    }

    /**
     * 关系快照属于技能导入事务的一部分，重建失败必须让原事务回滚；Redis/工作空间同步仅在提交成功后执行。
     */
    private void rebuildAndScheduleSkillRuntimeRefresh(Set<Long> affectedDigitalEmployeeIds) {
        if (CollectionUtils.isEmpty(affectedDigitalEmployeeIds)) {
            return;
        }
        affectedDigitalEmployeeIds.forEach(
            digitalEmployeeApplicationService::rebuildAndSaveDigitalEmployeeRelSkills);
        digitalEmployeeRuntimeRefreshService.scheduleSkillRuntimeRefreshAfterCommit(affectedDigitalEmployeeIds);
    }

    /**
     * 兼容旧的 #技能上传资源：这类资源曾在当前数字员工 workspace 留有副本。
     * 新版安装技能以 hub 为唯一来源；这里只同步原路径，避免历史副本继续覆盖新 hub 技能。
     */
    private void syncLegacyWorkspaceCopy(String ownerUserCode, SkillPackageMetadata metadata, MultipartFile file,
        String previousSourceType, String previousSkillPath, List<SsResource> boundDigitalEmployees) {
        if (!StringUtils.equals(SOURCE_TYPE_CHAT_UPLOAD, previousSourceType)
            || StringUtils.isAnyBlank(ownerUserCode, previousSkillPath)
            || CollectionUtils.isEmpty(boundDigitalEmployees)) {
            return;
        }
        String normalizedSkillPath = StringUtils.removeEnd(previousSkillPath.replace('\\', '/').replaceAll("/+", "/"),
            "/");
        for (SsResource digitalEmployee : boundDigitalEmployees) {
            String skillRootPrefix = skillPathResolver.resolveSkillRootPrefix(ownerUserCode,
                digitalEmployee.getResourceId());
            String expectedSkillPath = StringUtils.removeEnd(skillRootPrefix, "/") + "/" + metadata.skillName();
            if (!StringUtils.equals(normalizedSkillPath, expectedSkillPath)) {
                continue;
            }
            byte[] packageBytes = readPackageBytes(file);
            byClawSkillUploadApplicationService.uploadSkillZip(ownerUserCode, digitalEmployee.getResourceId(),
                new ByteArrayMultipartFile(metadata.originalFilename(), packageBytes, PACKAGE_CONTENT_TYPE));
            return;
        }
    }

    private SsResExtSkill saveOrUpdateSkillExt(String userCode, SsResource skillResource, MultipartFile uploadFile,
        SkillPackageMetadata metadata, String skillPath, String skillDocObjectKey, String sourceType) {
        return saveOrUpdateSkillExt(userCode, skillResource, readPackageBytes(uploadFile), metadata, skillPath,
            skillDocObjectKey, sourceType);
    }

    private SsResExtSkill saveOrUpdateSkillExt(String userCode, SsResource skillResource, byte[] packageBytes,
        SkillPackageMetadata metadata, String skillPath, String skillDocObjectKey, String sourceType) {
        return saveOrUpdateSkillExt(userCode, skillResource, packageBytes, metadata, skillPath, skillDocObjectKey,
            sourceType, null);
    }

    private SsResExtSkill saveOrUpdateSkillExt(String userCode, SsResource skillResource, byte[] packageBytes,
        SkillPackageMetadata metadata, String skillPath, String skillDocObjectKey, String sourceType,
        String sourceDownloadUrl) {
        SsResExtSkill existing = ssResExtSkillService.findById(skillResource.getResourceId());
        String packageFileName = metadata.originalFilename();
        String skillHubDirectory = buildSkillHubDirectory(skillResource.getOwnerType(), userCode);
        // 目录同步和审核包均按资源、内容隔离，事务回滚或审核驳回都不会覆盖线上 ZIP。
        if (SOURCE_TYPE_WORKSPACE_CENTER_SYNC.equals(sourceType) || SOURCE_TYPE_IMPORT_REVIEW.equals(sourceType)) {
            String directory = SOURCE_TYPE_IMPORT_REVIEW.equals(sourceType) ? "/import-review/" : "/directory-sync/";
            skillHubDirectory += directory + skillResource.getResourceId() + "/" + DigestUtils.sha256Hex(packageBytes);
        }
        // 企业副本及其后续更新均按资源隔离，避免同文件名覆盖另一份技能包。
        if (SOURCE_TYPE_ENTERPRISE_COPY.equals(sourceType)
            || (existing != null
                && StringUtils.isNotBlank(extractString(existing.getTargetContent(), "sourceResourceId")))) {
            skillHubDirectory += "/" + skillResource.getResourceId();
        }
        String skillUrl = normalizeResourceObjectKey(EXTERNAL_RESOURCE_ROOT + "/" + skillHubDirectory + "/"
            + packageFileName);
        resourceArtifactStorageService.uploadToSubdirectory(packageBytes, skillHubDirectory, packageFileName,
            PACKAGE_CONTENT_TYPE);

        SsResExtSkill extSkill = existing == null ? new SsResExtSkill() : existing;
        extSkill.setResourceId(skillResource.getResourceId());
        extSkill.setSkillType(SsResExtSkillService.DEFAULT_SKILL_TYPE);
        extSkill.setSourceType(StringUtils.defaultIfBlank(sourceType, SOURCE_TYPE_SKILL_MANAGE_IMPORT));
        extSkill.setVersion(existing == null ? SsResExtSkillService.DEFAULT_VERSION
            : ssResExtSkillService.nextVersion(existing.getVersion()));
        extSkill.setSkillUrl(skillUrl);
        extSkill.setSkillPackageFormat(SsResExtSkillService.DEFAULT_PACKAGE_FORMAT);
        extSkill.setSkillOriginalFilename(packageFileName);
        extSkill.setSkillPackageSize((long)packageBytes.length);
        extSkill.setSkillPackageHash(DigestUtils.sha256Hex(packageBytes));
        extSkill.setSyncStatus("SUCCESS");
        extSkill.setSyncError(null);
        extSkill.setLastSyncTime(LocalDateTime.now());
        extSkill.setTargetContent(buildTargetContent(skillResource, extSkill, skillPath, skillDocObjectKey,
            sourceDownloadUrl));
        ssResExtSkillService.saveOrUpdate(extSkill);
        return extSkill;
    }

    private WorkspaceSkillPackage buildWorkspaceSkillPackage(String userCode, Long digitalEmployeeResourceId,
        String skillPath) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        String normalizedSkillPath = normalizeWorkspaceSkillPath(userCode, digitalEmployeeResourceId, skillPath);
        List<String> objectKeys = ByClawUserWorkspacePaths.withUserContext(userCode,
            () -> userFS.list(normalizedSkillPath + "/", null));
        if (CollectionUtils.isEmpty(objectKeys)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.empty"));
        }

        String skillName = lastPathSegment(normalizedSkillPath);
        String skillDocObjectKey = objectKeys.stream()
            .filter(objectKey -> StringUtils.equalsIgnoreCase(lastPathSegment(objectKey), SKILL_DOC_FILE_NAME))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.missing.doc")));
        byte[] zipBytes = zipWorkspaceSkill(userCode, normalizedSkillPath, skillName, objectKeys);
        SkillPackageMetadata metadata = inspectSkillPackage(
            new ByteArrayMultipartFile(skillName + ".zip", zipBytes, PACKAGE_CONTENT_TYPE));
        return new WorkspaceSkillPackage(normalizedSkillPath, skillDocObjectKey, zipBytes, metadata);
    }

    private byte[] zipWorkspaceSkill(String userCode, String normalizedSkillPath, String skillName,
        List<String> objectKeys) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream();
            ZipOutputStream zipOutputStream = new ZipOutputStream(out)) {
            String prefix = normalizedSkillPath + "/";
            for (String objectKey : objectKeys) {
                if (StringUtils.isBlank(objectKey) || !StringUtils.startsWith(objectKey, prefix)) {
                    continue;
                }
                String relative = objectKey.substring(prefix.length());
                if (StringUtils.isBlank(relative)) {
                    continue;
                }
                zipOutputStream.putNextEntry(new ZipEntry(skillName + "/" + relative));
                try (InputStream inputStream = ByClawUserWorkspacePaths.withUserContext(userCode,
                    () -> userFS.read(objectKey))) {
                    if (inputStream != null) {
                        inputStream.transferTo(zipOutputStream);
                    }
                }
                zipOutputStream.closeEntry();
            }
            zipOutputStream.finish();
            return out.toByteArray();
        }
        catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), e);
        }
    }

    private String normalizeWorkspaceSkillPath(String userCode, Long digitalEmployeeResourceId, String skillPath) {
        String skillRootPrefix = skillPathResolver.resolveSkillRootPrefix(userCode, digitalEmployeeResourceId);
        String normalized = StringUtils.trimToEmpty(skillPath).replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        normalized = StringUtils.removeEnd(normalized, "/");
        if (!StringUtils.startsWith(normalized, skillRootPrefix) || containsParentPathSegment(normalized)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        String tail = normalized.substring(skillRootPrefix.length());
        if (StringUtils.isBlank(tail)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        return normalized;
    }

    private boolean containsParentPathSegment(String path) {
        for (String segment : StringUtils.split(StringUtils.defaultString(path), '/')) {
            if ("..".equals(segment)) {
                return true;
            }
        }
        return false;
    }

    private String buildSkillHubDirectory(String ownerType, String userCode) {
        if (OwnerType.ENTERPRISE.equals(ownerType)) {
            return SKILL_HUB_ORG_DIRECTORY;
        }
        return buildPersonalSkillHubDirectory(userCode);
    }

    private String buildPersonalSkillHubDirectory(String userCode) {
        String safeUserCode = StringUtils.defaultIfBlank(StringUtils.trimToEmpty(userCode),
            String.valueOf(CurrentUserHolder.getCurrentUserId()));
        return "skill/" + safeUserCode + "-hub";
    }

    private String normalizeResourceObjectKey(String objectKey) {
        if (StringUtils.isBlank(objectKey)) {
            return "";
        }
        String normalized = objectKey.trim().replace('\\', '/').replaceAll("/+", "/");
        String withoutLeadingSlash = StringUtils.removeStart(normalized, "/");
        if (StringUtils.startsWith(withoutLeadingSlash, "byclaw/resource/")) {
            return "/" + withoutLeadingSlash;
        }
        if (StringUtils.startsWith(withoutLeadingSlash, "resource/")) {
            return "/byclaw/" + withoutLeadingSlash;
        }
        if (StringUtils.startsWith(withoutLeadingSlash, "skill/")) {
            return EXTERNAL_RESOURCE_ROOT + "/" + withoutLeadingSlash;
        }
        return normalized.startsWith("/") ? normalized : "/" + normalized;
    }

    private String lastPathSegment(String filename) {
        if (StringUtils.isBlank(filename)) {
            return "";
        }
        String normalized = filename.replace('\\', '/');
        int slashIndex = normalized.lastIndexOf('/');
        return slashIndex >= 0 ? normalized.substring(slashIndex + 1) : normalized;
    }

    private byte[] readPackageBytes(MultipartFile uploadFile) {
        try {
            return uploadFile == null ? new byte[0] : uploadFile.getBytes();
        }
        catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), e);
        }
    }

    private void bindSkillToDigitalEmployee(Long digitalEmployeeResourceId, Long skillResourceId) {
        if (CollectionUtils.isNotEmpty(ssResourceRelDetailService.find(digitalEmployeeResourceId, skillResourceId))) {
            return;
        }
        Date now = new Date();
        SsResourceRelDetail relDetail = new SsResourceRelDetail();
        relDetail.setResourceRelDetailId(sequenceService.nextVal());
        relDetail.setResourceId(digitalEmployeeResourceId);
        relDetail.setRelResourceId(skillResourceId);
        relDetail.setCreateBy(CurrentUserHolder.getCurrentUserId());
        relDetail.setCreateTime(now);
        relDetail.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        relDetail.setUpdateTime(now);
        relDetail.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResourceRelDetailService.save(relDetail);
    }

    private void syncSkillTargetContent(String userCode, SsResource skillResource, SsResExtSkill extSkill,
        boolean packageChanged) {
        if (packageChanged) {
            ssResourceArtifactService.invalidateArtifactsByResourceId(skillResource.getResourceId());
        }
        syncSkillStandardJson(skillResource.getResourceId(), StringUtils.defaultString(extSkill.getTargetContent()));
        ssResourceArtifactService.upsertArtifact(skillResource.getResourceId(), ResourceBizTypeEnum.SKILL.name(),
            ResourceArtifactTypeEnum.IMPORT_ZIP.name(), "minio", stripResourcePrefix(extSkill.getSkillUrl()),
            "chat-upload-skill-package");
    }

    private void syncSkillStandardJson(Long resourceId, String targetContent) {
        if (resourceId == null) {
            return;
        }
        String fileName = buildSkillStandardJsonFileName(resourceId);
        resourceArtifactStorageService.uploadToSubdirectory(targetContent.getBytes(StandardCharsets.UTF_8), "skill",
            fileName, "application/json");
        ssResourceArtifactService.upsertArtifact(resourceId, ResourceBizTypeEnum.SKILL.name(),
            ResourceArtifactTypeEnum.STANDARD_JSON.name(), "minio", "skill/" + fileName, "chat-upload-skill-json");
    }

    private String buildSkillStandardJsonFileName(Long resourceId) {
        return ResourceBizTypeEnum.SKILL.name() + "_" + resourceId + ".json";
    }

    private String stripResourcePrefix(String objectKey) {
        String normalized = StringUtils.removeStart(StringUtils.defaultString(objectKey), "/");
        normalized = StringUtils.removeStart(normalized, "byclaw/resource/");
        return StringUtils.removeStart(normalized, "resource/");
    }

    private String buildTargetContent(SsResource skillResource, SsResExtSkill extSkill, String skillPath,
        String skillDocObjectKey) {
        return buildTargetContent(skillResource, extSkill, skillPath, skillDocObjectKey,
            extractString(extSkill.getTargetContent(), "sourceDownloadUrl"));
    }

    private String buildTargetContent(SsResource skillResource, SsResExtSkill extSkill, String skillPath,
        String skillDocObjectKey, String sourceDownloadUrl) {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("resourceId", skillResource.getResourceId());
        content.put("resourceCode", skillResource.getResourceCode());
        content.put("resourceName", skillResource.getResourceName());
        content.put("resourceDesc", skillResource.getResourceDesc());
        content.put("resourceBizType", skillResource.getResourceBizType());
        content.put("resourceType", skillResource.getResourceType());
        content.put("ownerType", skillResource.getOwnerType());
        content.put("resourceVersionId", skillResource.getResourceVersionId());
        content.put("hostType", skillResource.getHostType());
        content.put("sourceType", extSkill.getSourceType());
        content.put("skillType", extSkill.getSkillType());
        content.put("skillPath", skillPath);
        content.put("skillDocObjectKey", skillDocObjectKey);
        content.put("sourceDownloadUrl", sourceDownloadUrl);
        content.put("skillUrl", buildSkillDownloadUrl(skillResource.getResourceId()));
        content.put("version", extSkill.getVersion());
        content.put("skillPackageFormat", extSkill.getSkillPackageFormat());
        content.put("skillOriginalFilename", extSkill.getSkillOriginalFilename());
        content.put("skillPackageSize", extSkill.getSkillPackageSize());
        content.put("skillPackageHash", extSkill.getSkillPackageHash());
        content.put("syncStatus", extSkill.getSyncStatus());
        content.put("syncError", extSkill.getSyncError());
        content.put("lastSyncTime", extSkill.getLastSyncTime());
        // 更新企业副本仍保留来源追溯信息，重复发布不因更新元数据而失去幂等识别。
        for (String key : List.of("sourceResourceId", "sourceCreatorId", "sourceVersion", "sourcePackageUrl")) {
            String value = extractString(extSkill.getTargetContent(), key);
            if (value != null) {
                content.put(key, value);
            }
        }
        return JSON.toJSONString(content);
    }

    private String buildSkillDownloadUrl(Long skillId) {
        return skillId == null ? "" : "/byaiService/tool/downloadSkillZip?skillId=" + skillId;
    }

    public SkillPackageMetadata inspectSkillPackage(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        String filename = lastPathSegment(file.getOriginalFilename());
        if (!isZipFile(file)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.file.invalid"));
        }
        byte[] bytes = readPackageBytes(file);
        List<ZipEntryInfo> entries = readZipEntries(bytes);
        ZipEntryInfo skillDoc = findSkillDoc(entries);
        String skillBase = parentDirOf(skillDoc.name());
        String skillName = StringUtils.defaultIfBlank(lastPathSegment(skillBase), stripZipExtension(filename));
        String skillDesc = extractSkillDesc(skillDoc.content());
        return new SkillPackageMetadata(skillName, skillName, StringUtils.defaultIfBlank(skillDesc, "技能：" + skillName),
            filename, bytes.length);
    }

    private List<ZipEntryInfo> readZipEntries(byte[] bytes) {
        List<ZipEntryInfo> entries;
        try {
            entries = readZipEntries(bytes, ZIP_ENTRY_NAME_PRIMARY_ENCODING);
        }
        catch (IOException primaryException) {
            // ZipFile 会包装中央目录的解码异常；只对编码问题回退，损坏的 ZIP 仍直接报错。
            Throwable cause = primaryException;
            while (cause != null && !(cause instanceof CharacterCodingException)) {
                cause = cause.getCause();
            }
            if (cause == null) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), primaryException);
            }
            logger.debug("Skill 资源包 entry 名无法按 {} 解码，使用 {} 重试",
                ZIP_ENTRY_NAME_PRIMARY_ENCODING, ZIP_ENTRY_NAME_FALLBACK_ENCODING);
            try {
                entries = readZipEntries(bytes, ZIP_ENTRY_NAME_FALLBACK_ENCODING);
            }
            catch (IOException fallbackException) {
                fallbackException.addSuppressed(primaryException);
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), fallbackException);
            }
        }
        if (entries.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        return entries;
    }

    private List<ZipEntryInfo> readZipEntries(byte[] bytes, String encoding) throws IOException {
        List<ZipEntryInfo> entries = new ArrayList<>();
        // Unix 权限保存在 ZIP 中央目录中，流式读取本地文件头会导致发布副本丢失执行权限。
        try (SeekableInMemoryByteChannel channel = new SeekableInMemoryByteChannel(bytes);
            ZipFile zip = new ZipFile(channel, encoding)) {
            var zipEntries = zip.getEntriesInPhysicalOrder();
            while (zipEntries.hasMoreElements()) {
                ZipArchiveEntry entry = zipEntries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String normalized = normalizeZipEntryName(entry.getName());
                if (StringUtils.isBlank(normalized)) {
                    continue;
                }
                try (InputStream input = zip.getInputStream(entry)) {
                    entries.add(new ZipEntryInfo(normalized, input.readAllBytes(), entry.getUnixMode()));
                }
            }
        }
        return entries;
    }

    /**
     * 只校验当前 skill 根目录下的 SKILL.md，子目录中的 SKILL.md 可能是内嵌 skill，不参与唯一性校验。
     */
    private ZipEntryInfo findSkillDoc(List<ZipEntryInfo> entries) {
        List<ZipEntryInfo> rootDocs = new ArrayList<>();
        List<ZipEntryInfo> directSkillDirDocs = new ArrayList<>();
        for (ZipEntryInfo entry : entries) {
            String[] segments = splitPath(entry.name());
            if (segments.length == 1 && SKILL_DOC_FILE_NAME.equalsIgnoreCase(segments[0])) {
                rootDocs.add(entry);
            }
            else if (segments.length == 2 && SKILL_DOC_FILE_NAME.equalsIgnoreCase(segments[1])) {
                directSkillDirDocs.add(entry);
            }
        }
        if (!rootDocs.isEmpty()) {
            if (rootDocs.size() != 1) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.missing.doc"));
            }
            return rootDocs.get(0);
        }
        if (directSkillDirDocs.size() != 1) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.missing.doc"));
        }
        return directSkillDirDocs.get(0);
    }

    private String normalizeZipEntryName(String rawName) {
        if (StringUtils.isBlank(rawName)) {
            return null;
        }
        String normalized = rawName.replace('\\', '/').replaceAll("/+", "/");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        if (StringUtils.isBlank(normalized) || normalized.startsWith("__MACOSX/") || normalized.contains("../")) {
            return null;
        }
        if (StringUtils.endsWithIgnoreCase(normalized, "/.DS_Store")) {
            return null;
        }
        return normalized;
    }

    private String[] splitPath(String path) {
        return StringUtils.isBlank(path) ? new String[0] : path.split("/");
    }

    private String extractSkillDesc(byte[] skillDocContent) {
        String content = new String(skillDocContent == null ? new byte[0] : skillDocContent, StandardCharsets.UTF_8);
        return ByClawSkillDocParser.extractDescription(content);
    }

    private String parentDirOf(String path) {
        int slash = path == null ? -1 : path.lastIndexOf('/');
        return slash > 0 ? path.substring(0, slash) : "";
    }

    private boolean isZipFile(MultipartFile file) {
        return StringUtils.endsWithIgnoreCase(lastPathSegment(file == null ? null : file.getOriginalFilename()), ".zip");
    }

    private String stripZipExtension(String filename) {
        return StringUtils.endsWithIgnoreCase(filename, ".zip") ? filename.substring(0, filename.length() - 4)
            : filename;
    }

    private String resolveOwnerType(String ownerType) {
        return StringUtils.equals(ownerType, OwnerType.ENTERPRISE) ? OwnerType.ENTERPRISE : OwnerType.PERSONAL;
    }

    private String normalizeUploadedFilePath(String directoryPath, String fileName) {
        String dir = StringUtils.defaultIfBlank(directoryPath, "/").replace('\\', '/');
        if (!dir.endsWith("/")) {
            dir += "/";
        }
        return dir + fileName;
    }

    private String resolveResourceOwnerUserCode(SsResource resource) {
        if (resource != null && OwnerType.PERSONAL.equals(resource.getOwnerType()) && resource.getCreateBy() != null
            && userService != null) {
            Users creator = userService.findById(resource.getCreateBy());
            if (creator != null && StringUtils.isNotBlank(creator.getUserCode())) {
                return creator.getUserCode();
            }
        }
        return CurrentUserHolder.getCurrentUserCode();
    }

    private String extractString(String json, String key) {
        if (StringUtils.isBlank(json)) {
            return null;
        }
        try {
            return Optional.ofNullable(JSON.parseObject(json).getString(key)).orElse(null);
        }
        catch (Exception e) {
            return null;
        }
    }

    private ObjectZipImportItem buildSuccessItem(SkillImportResult result) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        item.setResourceId(String.valueOf(result.resource().getResourceId()));
        item.setResourceCode(result.resource().getResourceCode());
        item.setResourceName(result.resource().getResourceName());
        item.setResourceDesc(result.resource().getResourceDesc());
        item.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        item.setCatalogId(result.resource().getCatalogId());
        item.setUpdated(result.updated());
        item.setSuccess(true);
        boolean reviewRequired = Objects.equals(result.resource().getResourceStatus(), ResourceStatus.AUDIT.getNum());
        item.setReviewRequired(reviewRequired);
        if (reviewRequired) {
            item.setResourceCode(extractString(result.extSkill().getTargetContent(), "importResourceCode"));
        }
        item.setMessage(I18nUtil.get(reviewRequired ? "byclaw.skill.import.review.submitted"
            : result.updated() ? "byclaw.skill.import.cover.updated" : "resource.import.success"));
        return item;
    }

    private ObjectZipImportItem buildFailedItem(MultipartFile file, Exception e) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        String filename = file == null ? null : file.getOriginalFilename();
        item.setResourceCode(filename);
        item.setResourceName(filename);
        item.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        item.setSuccess(false);
        item.setMessage(e.getMessage());
        return item;
    }

    private void fillImportSummary(ObjectZipImportResult result) {
        List<ObjectZipImportItem> successItems = result.getItems().stream().filter(ObjectZipImportItem::isSuccess)
            .collect(Collectors.toList());
        result.setSuccess(successItems.size());
        result.setFailed(result.getItems().size() - successItems.size());
        result.setCreatedCount(result.getCreatedItems().size());
        result.setUpdatedCount(result.getUpdatedItems().size());
    }

    public record SkillImportResult(SsResource resource, SsResExtSkill extSkill, boolean updated) {
    }

    public record SkillPackageMetadata(String skillName, String skillCode, String skillDesc, String originalFilename,
        long size) {
    }

    public record PublicationDependency(String resourceId, String resourceName, String resourceBizType) {
    }

    public record EnterpriseSkillPublishResult(SsResource resource, boolean alreadyExists,
                                               List<PublicationDependency> personalDependencies) {
        public EnterpriseSkillPublishResult(SsResource resource, boolean alreadyExists) {
            this(resource, alreadyExists, List.of());
        }
    }

    private record ZipEntryInfo(String name, byte[] content, int unixMode) {
    }

    private record WorkspaceSkillPackage(String skillPath, String skillDocObjectKey, byte[] bytes,
        SkillPackageMetadata metadata) {
    }

    private record ByteArrayMultipartFile(String originalFilename, byte[] bytes, String contentType)
        implements MultipartFile {

        @Override
        public String getName() {
            return "file";
        }

        @Override
        public String getOriginalFilename() {
            return originalFilename;
        }

        @Override
        public String getContentType() {
            return contentType;
        }

        @Override
        public boolean isEmpty() {
            return bytes == null || bytes.length == 0;
        }

        @Override
        public long getSize() {
            return bytes == null ? 0 : bytes.length;
        }

        @Override
        public byte[] getBytes() {
            return bytes == null ? new byte[0] : bytes;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(getBytes());
        }

        @Override
        public void transferTo(java.io.File dest) throws IOException {
            java.nio.file.Files.write(dest.toPath(), getBytes());
        }
    }
}
