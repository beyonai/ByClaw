package com.iwhalecloud.byai.state.application.service.session;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
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
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.commons.compress.archivers.ArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveInputStream;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 对话框 #技能 上传后的资源入库与数字员工绑定服务。
 *
 * @author qin.guoquan
 * @date 2026-06-18 19:38:38
 */
@Service
public class ByClawSkillResourceApplicationService {

    public static final String SOURCE_TYPE_CHAT_UPLOAD = "CHAT_UPLOAD";

    public static final String SOURCE_TYPE_SKILL_MANAGE_IMPORT = "SKILL_MANAGE_IMPORT";

    public static final String SOURCE_TYPE_FILE_MANAGE_UPLOAD = "FILE_MANAGE_UPLOAD";

    private static final String PACKAGE_CONTENT_TYPE = "application/zip";

    private static final Long DEFAULT_SKILL_CATALOG_ID = 10L;

    private static final Long DEFAULT_MANAGER_ORG_ID = -1L;

    private static final String SKILL_HUB_ORG_DIRECTORY = "skill/org-hub";

    private static final String EXTERNAL_RESOURCE_ROOT = "/byclaw/resource";

    private static final String SKILL_DOC_FILE_NAME = "SKILL.md";

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
    private SequenceService sequenceService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private UserFS userFS;

    @Autowired
    private ByClawSkillPathResolver skillPathResolver;

    @Autowired
    private ByClawSkillUploadApplicationService byClawSkillUploadApplicationService;

    @Autowired
    private UserService userService;

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
            SsResource existing = findExistingSkillByNaturalKey(metadata.skillCode());
            if (existing != null) {
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
        validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);

        for (int i = 0; i < uploadedSkills.size(); i++) {
            MultipartFile uploadFile = uploadFiles.get(i);
            ByClawSkillDto uploadedSkill = uploadedSkills.get(i);
            SkillPackageMetadata metadata = inspectSkillPackage(uploadFile);
            SsResource skillResource = saveOrUpdateChatUploadedSkillResource(metadata,
                DEFAULT_SKILL_CATALOG_ID);
            authApplicationService.ensureCreatorDefaultPrivileges(skillResource);
            SsResExtSkill extSkill = saveOrUpdateSkillExt(userCode, skillResource, uploadFile, metadata,
                uploadedSkill.getSkillPath(), uploadedSkill.getSkillDocObjectKey(), SOURCE_TYPE_CHAT_UPLOAD);
            bindSkillToDigitalEmployee(resolvedDigitalEmployeeId, skillResource.getResourceId());
            syncSkillTargetContent(userCode, skillResource, extSkill, true);
        }

        digitalEmployeeApplicationService.rebuildAndSaveDigitalEmployeeRelSkills(resolvedDigitalEmployeeId);
        digitalEmployeeApplicationService.synOpenClawWorkSpace(resolvedDigitalEmployeeId);
    }

    @Transactional(rollbackFor = Exception.class)
    public ObjectZipImportResult importSkillZips(MultipartFile[] files, Long catalogId, String ownerType) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        result.setTotal(files.length);
        for (MultipartFile file : files) {
            try {
                SkillImportResult itemResult = importSkillZip(file, catalogId, ownerType,
                    SOURCE_TYPE_SKILL_MANAGE_IMPORT);
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

    public ObjectZipImportResult previewSkillZipImportConflicts(MultipartFile[] files, String ownerType) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        result.setTotal(files.length);
        for (MultipartFile file : files) {
            try {
                SkillPackageMetadata metadata = inspectSkillPackage(file);
                SsResource existing = findExistingSkillByNaturalKey(metadata.skillCode());
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
            }
            catch (Exception e) {
                result.getItems().add(buildFailedItem(file, e));
            }
        }
        fillImportSummary(result);
        result.setUpdatedCount(result.getUpdatedItems().size());
        return result;
    }

    public ObjectZipImportResult previewWorkspaceSkillShareConflicts(String userCode, Long digitalEmployeeResourceId,
        String skillPath) {
        WorkspaceSkillPackage skillPackage = buildWorkspaceSkillPackage(userCode,
            resolveDigitalEmployeeId(digitalEmployeeResourceId), skillPath);
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.setTotal(1);
        SsResource existing = findExistingSkillByNaturalKey(skillPackage.metadata().skillCode());
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
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        validateDigitalEmployeeSkillManagePermission(resolvedDigitalEmployeeId);
        WorkspaceSkillPackage skillPackage = buildWorkspaceSkillPackage(userCode, resolvedDigitalEmployeeId, skillPath);
        SsResource existing = findExistingSkillByNaturalKey(skillPackage.metadata().skillCode());
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
        bindSkillToDigitalEmployee(resolvedDigitalEmployeeId, skillResource.getResourceId());
        syncSkillTargetContent(userCode, skillResource, extSkill, true);
        digitalEmployeeApplicationService.rebuildAndSaveDigitalEmployeeRelSkills(resolvedDigitalEmployeeId);
        digitalEmployeeApplicationService.synOpenClawWorkSpace(resolvedDigitalEmployeeId);
        return new SkillImportResult(skillResource, extSkill, updated);
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

    @Transactional(rollbackFor = Exception.class)
    public SkillImportResult importSkillZip(MultipartFile file, Long catalogId, String ownerType, String sourceType) {
        SkillPackageMetadata metadata = inspectSkillPackage(file);
        String resolvedOwnerType = resolveOwnerType(ownerType);
        SsResource existing = findExistingSkillByNaturalKey(metadata.skillCode());
        boolean updated = existing != null;
        if (updated) {
            assertSkillManagePermission(existing);
        }
        String previousSourceType = updated ? findSkillExtSourceType(existing.getResourceId()) : null;
        String previousSkillPath = updated ? findSkillExtWorkspacePath(existing.getResourceId()) : null;
        String previousSkillDocObjectKey = updated ? findSkillExtTargetContentField(existing.getResourceId(),
            "skillDocObjectKey") : null;
        SsResource resource = saveOrUpdateSkillResource(metadata, resolvedOwnerType,
            catalogId == null ? DEFAULT_SKILL_CATALOG_ID : catalogId, existing);
        if (!updated) {
            authApplicationService.ensureCreatorDefaultPrivileges(resource);
        }
        String resourceOwnerUserCode = resolveResourceOwnerUserCode(resource);
        boolean preserveLegacyWorkspaceMetadata = StringUtils.equals(SOURCE_TYPE_CHAT_UPLOAD, previousSourceType);
        SsResExtSkill extSkill = saveOrUpdateSkillExt(resourceOwnerUserCode, resource, file, metadata,
            preserveLegacyWorkspaceMetadata ? previousSkillPath : null,
            preserveLegacyWorkspaceMetadata ? previousSkillDocObjectKey : null,
            preserveLegacyWorkspaceMetadata ? previousSourceType : sourceType);
        syncSkillTargetContent(resourceOwnerUserCode, resource, extSkill, true);
        if (updated) {
            List<SsResource> boundDigitalEmployees = findBoundDigitalEmployees(resource.getResourceId());
            syncLegacyWorkspaceCopy(resourceOwnerUserCode, metadata, file, previousSourceType, previousSkillPath,
                boundDigitalEmployees);
            refreshBoundDigitalEmployeeSkillRuntime(boundDigitalEmployees);
        }
        return new SkillImportResult(resource, extSkill, updated);
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
        syncSkillTargetContent(resolveResourceOwnerUserCode(skillResource), skillResource, extSkill, false);
        return extSkill.getTargetContent();
    }

    @Transactional(rollbackFor = Exception.class)
    public void unlinkWorkspaceSkill(String userCode, Long digitalEmployeeResourceId, String skillPath,
        String skillName) {
        Long resolvedDigitalEmployeeId = resolveDigitalEmployeeId(digitalEmployeeResourceId);
        String resolvedSkillName = StringUtils.defaultIfBlank(skillName, lastPathSegment(skillPath));
        SsResource skillResource = findExistingSkill(resolvedSkillName, OwnerType.PERSONAL);
        if (skillResource == null) {
            return;
        }
        ssResourceRelDetailService.remove(new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, resolvedDigitalEmployeeId)
            .eq(SsResourceRelDetail::getRelResourceId, skillResource.getResourceId()));
        digitalEmployeeApplicationService.rebuildAndSaveDigitalEmployeeRelSkills(resolvedDigitalEmployeeId);
        digitalEmployeeApplicationService.synOpenClawWorkSpace(resolvedDigitalEmployeeId);
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
    private void validateDigitalEmployeeSkillManagePermission(Long digitalEmployeeResourceId) {
        SsResource digitalEmployee = digitalEmployeeResourceId == null ? null
            : ssResourceService.findById(digitalEmployeeResourceId);
        if (digitalEmployee == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.not.found"));
        }
        if (!authApplicationService.hasResourceManagePermission(digitalEmployee)) {
            throw new IllegalArgumentException(
                I18nUtil.get("digemployee.skill.install.no.manage.permission", digitalEmployee.getResourceName()));
        }
    }

    private SsResource saveOrUpdateSkillResource(SkillPackageMetadata metadata, String ownerType, Long catalogId) {
        SsResource existing = findExistingSkillByNaturalKey(metadata.skillCode());
        return saveOrUpdateSkillResource(metadata, ownerType, catalogId, existing);
    }

    /**
     * 对话框/左侧栏上传的技能也需要遵循资源自然键的全局唯一规则。
     * 命中同编码个人或企业技能时，只有具备其管理权限才允许覆盖。
     */
    private SsResource saveOrUpdateChatUploadedSkillResource(SkillPackageMetadata metadata, Long catalogId) {
        SsResource existing = findExistingSkillByNaturalKey(metadata.skillCode());
        return saveOrUpdateSkillResource(metadata, OwnerType.PERSONAL, catalogId, existing);
    }

    private SsResource saveOrUpdateSkillResource(SkillPackageMetadata metadata, String ownerType, Long catalogId,
        SsResource existing) {
        if (existing == null) {
            SsResource resource = new SsResource();
            resource.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
            resource.setSystemCode(SystemCode.BYAI.getCode());
            resource.setResourceType("ATOM");
            resource.setResourceName(metadata.skillName());
            resource.setResourceCode(metadata.skillCode());
            resource.setResourceDesc(metadata.skillDesc());
            resource.setResourceVersionId("1.0");
            resource.setHostType("hosted");
            resource.setCatalogId(catalogId);
            resource.setManOrgId(DEFAULT_MANAGER_ORG_ID);
            resource.setResourceStatus(ResourceStatus.LIST.getNum());
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
        existing.setResourceStatus(ResourceStatus.LIST.getNum());
        existing.setResourceVersionId("1.0");
        existing.setHostType("hosted");
        existing.setCatalogId(catalogId);
        existing.setManOrgId(DEFAULT_MANAGER_ORG_ID);
        existing.setAuthStatus("passed");
        existing.setPublishPortal(1);
        existing.setPublishTime(new Date());
        // 覆盖已有企业/个人技能时保留原归属，不能因左侧上传把企业技能改为个人技能。
        existing.setImplType("SKILL");
        existing.setWorkerAgentType("NONE");
        return ssResourceService.updateResourceEntity(existing);
    }

    /**
     * 技能主资源的自然键是 {@code BYAI + SKILL + resourceCode}，不区分个人、企业归属。
     * 所有会写入技能主资源的入口都必须先走本方法，避免跨归属重复插入。
     */
    private SsResource findExistingSkillByNaturalKey(String skillCode) {
        if (StringUtils.isBlank(skillCode)) {
            return null;
        }
        List<SsResource> resources = ssResourceService.getResourceListByCode(List.of(skillCode));
        if (CollectionUtils.isEmpty(resources)) {
            return null;
        }
        List<SsResource> sameNaturalKeySkills = resources.stream()
            .filter(resource -> resource != null && StringUtils.equals(SystemCode.BYAI.getCode(),
                resource.getSystemCode()))
            .filter(resource -> ResourceBizTypeEnum.SKILL.name().equals(resource.getResourceBizType()))
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(sameNaturalKeySkills)) {
            return null;
        }
        return sameNaturalKeySkills.stream().filter(authApplicationService::hasResourceManagePermission).findFirst()
            .orElseThrow(() -> new IllegalArgumentException(I18nUtil.get("byclaw.skill.import.no.manage.permission",
                sameNaturalKeySkills.get(0).getResourceName())));
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

    private void assertSkillManagePermission(SsResource skillResource) {
        SsResExtSkill extSkill = skillResource == null || skillResource.getResourceId() == null ? null
            : ssResExtSkillService.findById(skillResource.getResourceId());
        if (extSkill != null && StringUtils.equalsIgnoreCase(extSkill.getSkillType(),
            SsResExtSkillService.INNER_SKILL_TYPE)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.inner.readonly"));
        }
        if (!authApplicationService.hasResourceManagePermission(skillResource)) {
            throw new IllegalArgumentException(
                I18nUtil.get("byclaw.skill.import.no.manage.permission", skillResource.getResourceName()));
        }
    }

    private String findSkillExtSourceType(Long resourceId) {
        SsResExtSkill extSkill = resourceId == null ? null : ssResExtSkillService.findById(resourceId);
        return extSkill == null ? null : extSkill.getSourceType();
    }

    private String findSkillExtWorkspacePath(Long resourceId) {
        return findSkillExtTargetContentField(resourceId, "skillPath");
    }

    private String findSkillExtTargetContentField(Long resourceId, String fieldName) {
        SsResExtSkill extSkill = resourceId == null ? null : ssResExtSkillService.findById(resourceId);
        return extSkill == null ? null : extractString(extSkill.getTargetContent(), fieldName);
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

    private void refreshBoundDigitalEmployeeSkillRuntime(List<SsResource> boundDigitalEmployees) {
        if (CollectionUtils.isEmpty(boundDigitalEmployees)) {
            return;
        }
        for (SsResource digitalEmployee : boundDigitalEmployees) {
            digitalEmployeeApplicationService.refreshInstalledSkillRuntime(digitalEmployee.getResourceId());
        }
    }

    private SsResExtSkill saveOrUpdateSkillExt(String userCode, SsResource skillResource, MultipartFile uploadFile,
        SkillPackageMetadata metadata, String skillPath, String skillDocObjectKey, String sourceType) {
        return saveOrUpdateSkillExt(userCode, skillResource, readPackageBytes(uploadFile), metadata, skillPath,
            skillDocObjectKey, sourceType);
    }

    private SsResExtSkill saveOrUpdateSkillExt(String userCode, SsResource skillResource, byte[] packageBytes,
        SkillPackageMetadata metadata, String skillPath, String skillDocObjectKey, String sourceType) {
        SsResExtSkill existing = ssResExtSkillService.findById(skillResource.getResourceId());
        String packageFileName = metadata.originalFilename();
        String skillHubDirectory = buildSkillHubDirectory(skillResource.getOwnerType(), userCode);
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
        extSkill.setTargetContent(buildTargetContent(skillResource, extSkill, skillPath, skillDocObjectKey));
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
        content.put("skillUrl", buildSkillDownloadUrl(skillResource.getResourceId()));
        content.put("version", extSkill.getVersion());
        content.put("skillPackageFormat", extSkill.getSkillPackageFormat());
        content.put("skillOriginalFilename", extSkill.getSkillOriginalFilename());
        content.put("skillPackageSize", extSkill.getSkillPackageSize());
        content.put("skillPackageHash", extSkill.getSkillPackageHash());
        content.put("syncStatus", extSkill.getSyncStatus());
        content.put("syncError", extSkill.getSyncError());
        content.put("lastSyncTime", extSkill.getLastSyncTime());
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
        List<ZipEntryInfo> entries = new ArrayList<>();
        try (ZipArchiveInputStream zin = new ZipArchiveInputStream(new ByteArrayInputStream(bytes), "GBK", true, true)) {
            ArchiveEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                String normalized = normalizeZipEntryName(entry.getName());
                if (StringUtils.isBlank(normalized)) {
                    continue;
                }
                entries.add(new ZipEntryInfo(normalized, zin.readAllBytes()));
            }
        }
        catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), e);
        }
        if (entries.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
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
        item.setMessage(I18nUtil.get(result.updated() ? "byclaw.skill.import.cover.updated"
            : "resource.import.success"));
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

    private record ZipEntryInfo(String name, byte[] content) {
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
