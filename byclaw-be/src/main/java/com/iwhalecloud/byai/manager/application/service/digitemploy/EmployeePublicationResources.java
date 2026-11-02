package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Date;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.ObjectProvider;

/** Resolves the entire declared dependency list before a candidate can be submitted.
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 * */
@Service
@lombok.extern.slf4j.Slf4j
public class EmployeePublicationResources {
    private static final int MAX_SKILL_BYTES = 100 * 1024 * 1024;
    private static final String TENANT_MISMATCH_REASON = "employee.publication.dependencyTenantMismatch";
    private final SsResourceService resources;
    private final SsResExtSkillService skills;
    private final ResourceArtifactStorageService storage;
    private final AuthApplicationService auth;
    private final PrivilegeGrantMapper grants;
    private final OrganizationService organizations;
    private final DigitalEmployeePublicationMapper publications;
    private final ObjectProvider<EmployeePublicationSkillBridge> skillBridge;
    private final com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService config;

    public EmployeePublicationResources(SsResourceService resources,
        SsResExtSkillService skills, ResourceArtifactStorageService storage, AuthApplicationService auth,
        PrivilegeGrantMapper grants, OrganizationService organizations,
        DigitalEmployeePublicationMapper publications,
        com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService config,
        ObjectProvider<EmployeePublicationSkillBridge> skillBridge) {
        this.resources = resources;
        this.skills = skills;
        this.storage = storage;
        this.auth = auth;
        this.grants = grants;
        this.organizations = organizations;
        this.publications = publications;
        this.config = config;
        this.skillBridge = skillBridge;
    }

    @Getter
    @Setter
    public static class Dependency {
        private SsResource resource;
        private SsResExtSkill skill;
        private Long targetId;
        private String action;
        private String error;
        private String warning;
        private String snapshotWarning;
        private String toolCode;
        private String label;
        private String resourceType;
        private String availabilityScope;
        private String impact;
        private Long requestId;
        private String copyName;
        private List<String> toolCodes = new ArrayList<>();
    }

    public List<Long> audienceRoots(Long tenantId) {
        // 发布归属沿用源员工，并与当前登录企业一致，不以企业信息表的最大 ID 推断归属。
        // 当前组织模型是部署级组织树；这里继续沿用既有根组织授权。
        if (tenantId == null || !Objects.equals(tenantId, CurrentUserHolder.getEnterpriseId())) {
            throw new BaseException("employee.publication.loginTenantMismatch");
        }
        List<Long> roots = organizations.getTopOrgList();
        if (roots == null || roots.isEmpty()) throw new BaseException("employee.publication.rootMissing");
        return roots;
    }

    public List<Dependency> capture(DigitalEmployeeDTO employee, Long authorId, Long tenantId, Long requestId) {
        List<Dependency> result = new ArrayList<>();
        List<Long> roots = List.of();
        try {
            roots = audienceRoots(tenantId);
        } catch (BaseException error) {
            result.add(blocker(I18nUtil.get("employee.publication.scope"), error.getMessage()));
        }
        LinkedHashSet<Long> ids = new LinkedHashSet<>(employee.getRelIds() == null ? List.of() : employee.getRelIds());
        if (employee.getRelSkills() != null) {
            for (Object raw : employee.getRelSkills()) {
                try {
                    if (!(raw instanceof Map<?, ?> map)) throw new BaseException("employee.publication.relinkSkill");
                    Object id = map.get("resourceId");
                    if (id == null) id = map.get("skillId");
                    if (id == null) throw new BaseException("employee.publication.skillIdMissing");
                    ids.add(Long.valueOf(String.valueOf(id)));
                } catch (BaseException | NumberFormatException error) {
                    Dependency unresolved = new Dependency();
                    unresolved.setLabel(I18nUtil.get("employee.publication.skillConfig"));
                    unresolved.setResourceType("SKILL");
                    unresolved.setAction("OMIT_RESOURCE");
                    unresolved.setWarning(error instanceof BaseException ? error.getMessage() : I18nUtil.get("employee.publication.skillIdInvalid"));
                    result.add(unresolved);
                }
            }
        }
        if (employee.getRelTools() != null) {
            for (String code : employee.getRelTools()) {
                Dependency tool = new Dependency();
                tool.setAction("OMIT_RESOURCE");
                tool.setToolCode(code);
                tool.setLabel("*".equals(code) ? I18nUtil.get("employee.publication.allTools") : code);
                tool.setResourceType("TOOL");
                try {
                    if ("*".equals(code) || builtInTools().contains(code)) {
                        tool.setAction("BUILTIN_TOOL");
                    } else {
                        List<SsResource> matches = publications.resourcesByCode(code, tenantId);
                        if (matches.size() == 1 && isTool(matches.getFirst())) {
                            ids.add(matches.getFirst().getResourceId());
                            tool.setResource(matches.getFirst());
                            tool.setTargetId(matches.getFirst().getResourceId());
                            tool.setToolCodes(List.of(code));
                            inspectReference(tool, authorId, tenantId, roots);
                        } else {
                            omit(tool, I18nUtil.get("employee.publication.toolUnresolved"));
                        }

                    }
                } catch (RuntimeException error) {
                    log.warn("检查发布工具失败，toolCode={}", code, error);
                    omit(tool, I18nUtil.get("employee.publication.toolCheckFailed"));
                }
                result.add(tool);
            }
        }
        ids.remove(null);
        if (ids.size() > 200) result.add(blocker(I18nUtil.get("employee.publication.resourceCount"), I18nUtil.get("employee.publication.tooManyResources")));
        for (Long id : ids) {
            if (result.stream().anyMatch(d -> d.getResource() != null && Objects.equals(id, d.getResource().getResourceId()))) continue;
            SsResource resource = resources.findById(id);
            Dependency dependency = new Dependency();
            dependency.setRequestId(requestId);
            dependency.setResource(resource);
            dependency.setTargetId(id);
            dependency.setAction("REFERENCE_RESOURCE");
            if (resource == null || !"SKILL".equals(resource.getResourceBizType())
                || !Objects.equals(tenantId, resource.getComAcctId())
                || !isPersonal(resource)) {
                inspectReference(dependency, authorId, tenantId, roots);
                result.add(dependency);
                continue;
            }
            try {
                if (skillBridge.getIfAvailable() == null) throw new BaseException("employee.publication.skillBridgeMissing");
                requireAvailable(resource, tenantId);
                if (!auth.hasResourceUsePermission(resource, authorId)) throw new BaseException("employee.publication.authorUseDenied");
                SsResExtSkill skill = skills.findById(id);
                if (skill == null || !"hub".equalsIgnoreCase(skill.getSkillType()) || StringUtils.isBlank(skill.getSkillUrl())) {
                    throw new BaseException("employee.publication.skillZipRequired");
                }
                String sourcePath = normalizePath(skill.getSkillUrl());
                byte[] bytes;
                try (InputStream input = storage.readWithinResourceRoot(sourcePath)) {
                    if (input == null) throw new BaseException("employee.publication.skillFileMissing");
                    bytes = input.readNBytes(MAX_SKILL_BYTES + 1);
                }
                if (bytes.length == 0 || bytes.length > MAX_SKILL_BYTES) throw new BaseException("employee.publication.skillSizeInvalid");
                String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                String directory = "skill/official-publications/" + requestId + "/" + id;
                storage.uploadToSubdirectory(bytes, directory, hash + ".zip", "application/zip");
                SsResExtSkill snapshot = JSON.parseObject(JSON.toJSONString(skill), SsResExtSkill.class);
                snapshot.setSkillUrl(directory + "/" + hash + ".zip");
                snapshot.setSkillPackageHash(hash);
                snapshot.setSkillPackageSize((long) bytes.length);
                snapshot.setTargetContent(null);
                dependency.setSkill(snapshot);
                dependency.setTargetId(id);
                dependency.setAction("COPY_SKILL");
                dependency.setCopyName(EmployeePublicationNames.enterpriseName(resource.getResourceName(), null));
                checkSkill(dependency, bytes, authorId, tenantId);
            } catch (Exception error) {
                omit(dependency, error instanceof BaseException ? error.getMessage() : I18nUtil.get("employee.publication.skillReadFailed"));
            }
            result.add(dependency);
        }
        employee.setRelIds(new ArrayList<>(ids));
        return result;
    }

    public void validate(List<Dependency> dependencies, Long authorId, Long tenantId) {
        List<Long> roots = audienceRoots(tenantId);
        for (Dependency dependency : dependencies) {
            if (dependency.getError() != null && dependency.getResource() == null && dependency.getTargetId() == null) {
                throw new BaseException(dependency.getError());
            }
            dependency.setError(null); // 升级前的个人资源阻塞记录按当前规则转成排除提醒。
            if ("COPY_SKILL".equals(dependency.getAction())) {
                try {
                    SsResource current = resources.findById(dependency.getResource().getResourceId());
                    requireAvailable(current, tenantId);
                    if (!auth.hasResourceUsePermission(current, authorId)) throw new BaseException("employee.publication.authorLinkedUseDenied");
                    if (!Objects.equals(current.getCreateBy(), dependency.getResource().getCreateBy())) throw new BaseException("employee.publication.skillOwnerChanged");
                    byte[] bytes = snapshotBytes(dependency);
                    checkSkill(dependency, bytes, authorId, tenantId);
                } catch (Exception error) {
                    omit(dependency, error instanceof BaseException ? error.getMessage() : I18nUtil.get("employee.publication.skillReadFailed"));
                }
            } else if ("OMIT_RESOURCE".equals(dependency.getAction()) && dependency.getSkill() != null) {
                // 保留已审核版本的排除结果；重新保存草稿才能重新捕获个人技能。
                omit(dependency, dependency.getWarning());
            } else if (dependency.getToolCode() != null && dependency.getResource() == null) {
                inspectToolCode(dependency, authorId, tenantId);
            } else {
                inspectReference(dependency, authorId, tenantId, roots);
            }
        }
    }

    private byte[] snapshotBytes(Dependency dependency) throws Exception {
        if (dependency.getSkill() == null || StringUtils.isBlank(dependency.getSkill().getSkillUrl())) {
            throw new BaseException("employee.publication.snapshotMissing");
        }
        try (InputStream input = storage.readWithinResourceRoot(normalizePath(dependency.getSkill().getSkillUrl()))) {
            if (input == null) throw new BaseException("employee.publication.snapshotFileMissing");
            byte[] bytes = input.readNBytes(MAX_SKILL_BYTES + 1);
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            if (bytes.length == 0 || bytes.length > MAX_SKILL_BYTES || !hash.equals(dependency.getSkill().getSkillPackageHash())) {
                throw new BaseException("employee.publication.snapshotChanged");
            }
            return bytes;
        }
    }

    private void checkSkill(Dependency dependency, byte[] bytes, Long authorId, Long tenantId) {
        EmployeePublicationSkillBridge bridge = skillBridge.getIfAvailable();
        if (bridge == null) {
            omit(dependency, I18nUtil.get("employee.publication.skillBridgeMissing"));
            return;
        }
        var checked = bridge.check(dependency.getResource(), dependency.getSkill(), bytes,
            context(dependency, tenantId, authorId));
        if (checked == null || !checked.copyAllowed()) {
            String reasons = checked == null || checked.issues() == null ? I18nUtil.get("employee.publication.dependenciesInvalid")
                : checked.issues().stream().map(EmployeePublicationSkillBridge.Issue::displayReason)
                    .collect(java.util.stream.Collectors.joining("；"));
            omit(dependency, StringUtils.defaultIfBlank(reasons, I18nUtil.get("employee.publication.dependenciesInvalid")));
        }
    }

    private EmployeePublicationSkillBridge.Context context(Dependency dependency, Long tenantId, Long authorId) {
        Long requestId = dependency.getRequestId();
        if (requestId == null && dependency.getSkill() != null) {
            String[] parts = normalizePath(dependency.getSkill().getSkillUrl()).split("/");
            if (parts.length > 2 && "official-publications".equals(parts[1])) requestId = Long.valueOf(parts[2]);
        }
        return new EmployeePublicationSkillBridge.Context(tenantId, authorId, requestId, dependency.getCopyName());
    }

    public InputStream openSnapshot(List<Dependency> dependencies, Long resourceId) {
        Dependency dependency = dependencies.stream().filter(d -> d.getResource() != null
            && Objects.equals(d.getResource().getResourceId(), resourceId) && "COPY_SKILL".equals(d.getAction())).findFirst()
            .orElseThrow(() -> new BaseException("employee.publication.snapshotNotInRequest"));
        return storage.readWithinResourceRoot(normalizePath(dependency.getSkill().getSkillUrl()));
    }

    public Map<Long, Long> materialize(List<Dependency> dependencies, Long tenantId, Long officialEmployeeId) {
        return materialize(dependencies, tenantId, officialEmployeeId, null);
    }

    public Map<Long, Long> materialize(List<Dependency> dependencies, Long tenantId, Long officialEmployeeId,
        List<Long> audience) {
        Map<Long, Long> mapping = new LinkedHashMap<>();
        for (Dependency dependency : dependencies) {
            SsResource source = dependency.getResource();
            Long sourceId = source == null ? dependency.getTargetId() : source.getResourceId();
            if (isOmitted(dependency)) {
                if (sourceId != null) mapping.put(sourceId, null);
                continue;
            }
            if (source == null) continue;
            if (!"COPY_SKILL".equals(dependency.getAction())) {
                mapping.put(sourceId, sourceId);
                continue;
            }
            try {
                EmployeePublicationSkillBridge bridge = skillBridge.getIfAvailable();
                if (bridge == null) throw new BaseException("employee.publication.skillServiceUnavailable");
                Long targetId = bridge.publish(source, dependency.getSkill(), snapshotBytes(dependency),
                    officialEmployeeId, context(dependency, tenantId, source.getCreateBy()));
                SsResource target = targetId == null ? null : resources.findById(targetId);
                requireAvailable(target, tenantId);
                if (Objects.equals(sourceId, targetId) || !"SKILL".equals(target.getResourceBizType())
                    || !"enterprise".equals(target.getOwnerType())) throw new BaseException("employee.publication.skillCopyInvalid");
                dependency.setTargetId(targetId);
                auth.ensureCreatorDefaultPrivileges(target);
                if (audience == null || audience.equals(List.of(-1L))) grantAudience(target, tenantId);
                else grantAudience(target, tenantId, audience);
                mapping.put(sourceId, targetId);
            } catch (Exception error) {
                // B 已开始写入时必须回滚，不能留下未完成的企业资源并声称发布成功。
                log.error("发布企业技能失败，officialEmployeeId={}, sourceSkillId={}", officialEmployeeId, sourceId, error);
                throw new BaseException(I18nUtil.get("employee.publication.skillCopyFailed", source.getResourceName()));
            }
        }
        return mapping;
    }

    /** 仅修改发布执行用 DTO；原员工和待发布草稿仍保留完整清单供用户对照。 */
    public void applyPublishedResources(DigitalEmployeeDTO snapshot, List<Dependency> dependencies, Map<Long, Long> mapping) {
        java.util.Set<Long> allowed = new LinkedHashSet<>();
        for (Dependency dependency : dependencies) {
            if (!isOmitted(dependency) && dependency.getResource() != null) allowed.add(dependency.getResource().getResourceId());
        }
        snapshot.setRelIds(allowed.stream()
            .map(id -> mapping.getOrDefault(id, id)).filter(Objects::nonNull).distinct().toList());
        java.util.Set<String> allowedCodes = new LinkedHashSet<>();
        for (Dependency dependency : dependencies) {
            if (isOmitted(dependency)) continue;
            if ("BUILTIN_TOOL".equals(dependency.getAction())) allowedCodes.add(dependency.getToolCode());
            if (dependency.getResource() != null && isTool(dependency.getResource())) {
                allowedCodes.add(dependency.getResource().getResourceCode());
                if (dependency.getToolCodes() != null) allowedCodes.addAll(dependency.getToolCodes());
            }
        }
        snapshot.setRelTools(snapshot.getRelTools().stream().filter(allowedCodes::contains).distinct().toList());
        snapshot.setRelResourceInfoList(snapshot.getRelResourceInfoList().stream()
            .filter(info -> snapshot.getRelIds().stream().anyMatch(id -> String.valueOf(id).equals(info.getRelId()))).toList());
        snapshot.setRelSkills(List.of());
        snapshot.setSkills("[]"); // 后续同步只根据企业副本的最终关系重建运行配置。
    }

    static boolean isOmitted(Dependency dependency) {
        return "OMIT_RESOURCE".equals(dependency.getAction()) || "UNAVAILABLE_RESOURCE".equals(dependency.getAction());
    }

    static boolean isPersonal(SsResource resource) {
        return resource != null && List.of("personal", "personal_default").contains(StringUtils.defaultString(resource.getOwnerType()));
    }

    public void grantAudience(SsResource resource, Long tenantId) {
        if (resource == null || tenantId == null || !Objects.equals(resource.getComAcctId(), tenantId)) {
            throw new BaseException("employee.publication.resourceTenantMismatch");
        }
        List<AuthDTO> subjects = audienceRoots(tenantId).stream().map(id -> {
            AuthDTO dto = new AuthDTO();
            dto.setGrantToObjType("ORG");
            dto.setGrantToObjId(id);
            dto.setGrantType("FORCE_USE");
            return dto;
        }).toList();
        AuthRedBlackDTO grant = new AuthRedBlackDTO();
        grant.setGrantObjId(resource.getResourceId());
        grant.setGrantObjType(resource.getResourceBizType());
        grant.setGrantType("FORCE_USE");
        grant.setRedList(subjects);
        auth.handleAuth(grant);
    }

    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.sys.service.SequenceService sequence;

    /** Add only the approved organization subjects; never replace unrelated manual grants. */
    public void grantAudience(SsResource resource, Long tenantId, List<Long> orgIds) {
        if (resource == null || !Objects.equals(resource.getComAcctId(), tenantId)
            || orgIds == null || orgIds.isEmpty() || orgIds.contains(-1L)) {
            throw new BaseException("组织发布授权范围无效");
        }
        // Visibility is scoped together with use permission, including copied skills.
        resource.setViewAuthControlled(true);
        resources.updateResourceEntity(resource);
        for (Long orgId : orgIds.stream().distinct().toList()) {
          for (String grantType : List.of("ALLOW_VIEW", "FORCE_USE")) {
            var match = new LambdaQueryWrapper<PrivilegeGrant>().eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
                .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType()).eq(PrivilegeGrant::getGrantType, grantType)
                .eq(PrivilegeGrant::getGrantToObjType, "ORG").eq(PrivilegeGrant::getGrantToObjId, orgId)
                .eq(PrivilegeGrant::getGrantToType, "RED").eq(PrivilegeGrant::getStatusCd, "A");
            if (grants.selectCount(match) > 0) continue;
            PrivilegeGrant grant = new PrivilegeGrant();
            grant.setPrivilegeGrantId(sequence.nextVal()); grant.setGrantObjId(resource.getResourceId());
            grant.setGrantObjType(resource.getResourceBizType()); grant.setGrantType(grantType);
            grant.setGrantToObjType("ORG"); grant.setGrantToObjId(orgId); grant.setGrantToType("RED");
            grant.setOperType("READ"); grant.setStatusCd("A"); grant.setEffDate(new Date());
            grant.setCreateDate(new Date()); grant.setCreateStaff(CurrentUserHolder.getCurrentUserId());
            grants.insert(grant);
          }
        }
    }

    private void requireAvailable(SsResource resource, Long tenantId) {
        if (resource == null || !Objects.equals(resource.getComAcctId(), tenantId) || !Objects.equals(resource.getResourceStatus(), 2)) {
            throw new BaseException("employee.publication.linkedResourceUnavailable");
        }
    }

    private List<String> builtInTools() {
        String configured = config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS");
        if (StringUtils.isBlank(configured)) return List.of();
        return JSON.parseArray(configured, com.alibaba.fastjson.JSONObject.class).stream()
            .filter(item -> !item.getBooleanValue("isWildcard"))
            .map(item -> item.getString("toolCode")).filter(Objects::nonNull).toList();
    }

    static Dependency blocker(String label, String error) {
        Dependency dependency = new Dependency();
        dependency.setLabel(label);
        dependency.setAction("BLOCKED");
        dependency.setError(error);
        return dependency;
    }

    static boolean isTool(SsResource resource) {
        return resource != null && resource.getResourceBizType() != null
            && List.of("TOOLKIT", "TOOL", "MCP", "AGENT").contains(resource.getResourceBizType());
    }

    /** 发布只排除不可携带的依赖，不改变原资源权限或阻止员工本身发布。 */
    private void inspectReference(Dependency dependency, Long authorId, Long tenantId, List<Long> roots) {
        String previousWarning = dependency.getWarning();
        dependency.setError(null);
        dependency.setWarning(null);
        Long id = dependency.getResource() == null ? dependency.getTargetId() : dependency.getResource().getResourceId();
        try {
            SsResource current = resources.findById(id);
            if (current == null) { omit(dependency, I18nUtil.get("employee.publication.resourceUnavailable")); return; }
            if (!Objects.equals(current.getComAcctId(), tenantId)) {
                dependency.setResource(null); dependency.setTargetId(id);
                setUnavailableDisplayMetadata(dependency, current);
                omit(dependency, I18nUtil.get("employee.publication.dependencyTenantMismatch")); return;
            }
            dependency.setResource(current);
            dependency.setTargetId(id);
            dependency.setResourceType(current.getResourceBizType());
            if (!Objects.equals(current.getResourceStatus(), 2)) { omit(dependency, I18nUtil.get("employee.publication.resourceInactive")); return; }
            if (isPersonal(current)) {
                omit(dependency, "SKILL".equals(current.getResourceBizType()) ? StringUtils.defaultIfBlank(previousWarning, I18nUtil.get("employee.publication.skillNotCopied")) : I18nUtil.get("employee.publication.personalResourceExcluded"));
                return;
            }
            if (!"enterprise".equals(current.getOwnerType())) { omit(dependency, I18nUtil.get("employee.publication.ownerUnconfirmed")); return; }
            dependency.setAction(isTool(current) ? "REFERENCE_TOOL" : "REFERENCE_RESOURCE");
            dependency.setAvailabilityScope(I18nUtil.get("employee.publication.originalUsers"));
            dependency.setImpact(I18nUtil.get("employee.publication.preservePermissions"));
            if (!auth.hasResourceUsePermission(current, authorId)) {
                dependency.setWarning(I18nUtil.get("employee.publication.authorNoAccess"));
                return;
            }
            try {
                requirePublic(current, roots);
                dependency.setAvailabilityScope(I18nUtil.get("employee.publication.allMembers"));
                dependency.setImpact(I18nUtil.get("employee.publication.enterpriseResourceImpact"));
            } catch (BaseException warning) { dependency.setWarning(warning.getMessage()); }
        } catch (RuntimeException error) {
            log.warn("检查发布资源失败，resourceId={}", id, error);
            omit(dependency, I18nUtil.get("employee.publication.availabilityUnknown"));
        }
    }

    /** 仅补充查看页面的名称和类型，不恢复被排除资源的执行对象或改变冻结的发布结果。 */
    public void refreshDisplayMetadata(List<Dependency> dependencies) {
        for (Dependency dependency : dependencies) {
            if (dependency.getResource() != null || dependency.getTargetId() == null || !isOmitted(dependency)) continue;
            try {
                setUnavailableDisplayMetadata(dependency, resources.findById(dependency.getTargetId()));
            } catch (RuntimeException error) {
                log.warn("读取发布资源展示信息失败，resourceId={}", dependency.getTargetId(), error);
                redactUnavailableDisplayMetadata(dependency);
            }
            if ("资源不属于当前企业".equals(dependency.getWarning())) dependency.setWarning(I18nUtil.get(TENANT_MISMATCH_REASON));
        }
    }

    private void setUnavailableDisplayMetadata(Dependency dependency, SsResource resource) {
        // 申请查看权限不等于关联资源详情权限；每次查看都按当前用户复核，避免沿用作者的权限。
        if (resource != null && CurrentUserHolder.getCurrentUserId() != null && auth.hasResourceAccessPermission(resource)) {
            dependency.setLabel(resource.getResourceName());
            dependency.setResourceType(resource.getResourceBizType());
        } else {
            redactUnavailableDisplayMetadata(dependency);
        }
    }

    private void redactUnavailableDisplayMetadata(Dependency dependency) {
        dependency.setLabel(I18nUtil.get("employee.publication.linkedResource", String.valueOf(dependency.getTargetId())));
        dependency.setResourceType(null);
    }

    private void omit(Dependency dependency, String reason) {
        dependency.setAction("OMIT_RESOURCE");
        dependency.setError(null);
        dependency.setWarning(StringUtils.defaultIfBlank(reason, I18nUtil.get("employee.publication.resourceExcluded")));
        dependency.setAvailabilityScope(I18nUtil.get("employee.publication.excludedScope"));
        dependency.setImpact(I18nUtil.get("employee.publication.excludedImpact"));
    }

    public record Availability(String resourceType, String scope, String reason, String impact) { }

    /** 旧申请缺少范围字段时保守展示，确认预览会重新检查并补齐。 */
    static Availability describe(Dependency dependency) {
        String type = dependency.getResource() == null ? dependency.getResourceType() : dependency.getResource().getResourceBizType();
        if ("BUILTIN_TOOL".equals(dependency.getAction()) || "REFERENCE_TOOL".equals(dependency.getAction())) type = "TOOL";
        if (isOmitted(dependency)) {
            return new Availability(StringUtils.defaultIfBlank(type, "UNKNOWN"), I18nUtil.get("employee.publication.excludedScope"),
                StringUtils.defaultIfBlank(dependency.getWarning(), I18nUtil.get("employee.publication.resourceExcluded")),
                I18nUtil.get("employee.publication.excludedImpact"));
        }
        if ("COPY_SKILL".equals(dependency.getAction())) {
            String name = StringUtils.defaultIfBlank(dependency.getCopyName(),
                EmployeePublicationNames.enterpriseName(dependency.getResource().getResourceName(), null));
            return new Availability("SKILL", I18nUtil.get("employee.publication.allMembersAfterPublish"), I18nUtil.get("employee.publication.independentSkillCopy"),
                I18nUtil.get("employee.publication.skillCopyImpact", name));
        }
        if ("BUILTIN_TOOL".equals(dependency.getAction())) {
            return new Availability("TOOL", I18nUtil.get("employee.publication.allMembers"), I18nUtil.get("employee.publication.builtinTool"), I18nUtil.get("employee.publication.builtinToolImpact"));
        }
        String scope = StringUtils.defaultIfBlank(dependency.getAvailabilityScope(), I18nUtil.get("employee.publication.scopeUnknown"));
        String reason = StringUtils.defaultIfBlank(dependency.getWarning(), StringUtils.defaultIfBlank(dependency.getError(), I18nUtil.get("employee.publication.preserveAssociation")));
        String impact = StringUtils.defaultIfBlank(dependency.getImpact(), I18nUtil.get("employee.publication.referenceImpact"));
        return new Availability(StringUtils.defaultIfBlank(type, "UNKNOWN"), scope, reason, impact);
    }

    private void inspectToolCode(Dependency dependency, Long authorId, Long tenantId) {
        try {
            if ("*".equals(dependency.getToolCode()) || builtInTools().contains(dependency.getToolCode())) {
                dependency.setAction("BUILTIN_TOOL"); dependency.setWarning(null); dependency.setError(null);
            } else {
                // 旧申请只保存了工具编码时也按资源表复验，不能绕过个人资源过滤。
                List<SsResource> matches = publications.resourcesByCode(dependency.getToolCode(), tenantId);
                if (matches.size() == 1 && isTool(matches.getFirst())) {
                    dependency.setResource(matches.getFirst());
                    dependency.setTargetId(matches.getFirst().getResourceId());
                    dependency.setToolCodes(List.of(dependency.getToolCode()));
                    inspectReference(dependency, authorId, tenantId, audienceRoots(tenantId));
                } else omit(dependency, I18nUtil.get("employee.publication.toolUnresolved"));
            }
        } catch (RuntimeException error) { omit(dependency, I18nUtil.get("employee.publication.toolCheckFailed")); }
    }

    private void requirePublic(SsResource resource, List<Long> roots) {
        if (!isTool(resource) && !List.of("SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM", "KG_CLOUD").contains(resource.getResourceBizType())) {
            throw new BaseException("employee.publication.typeUnsupported");
        }
        if (!"enterprise".equals(resource.getOwnerType())) throw new BaseException("employee.publication.privateNotShared");
        List<PrivilegeGrant> permissions = grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
            .eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
            .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
            .in(PrivilegeGrant::getGrantType, "AVAILABLE_USE", "FORCE_USE")
            .eq(PrivilegeGrant::getStatusCd, "A"));
        Date now = new Date();
        permissions = permissions.stream().filter(g -> (g.getEffDate() == null || !g.getEffDate().after(now))
            && (g.getExpDate() == null || g.getExpDate().after(now))).toList();
        if (permissions.stream().anyMatch(g -> "BLACK".equals(g.getGrantToType()))) {
            throw new BaseException("employee.publication.blacklisted");
        }
        List<Long> sharedRoots = permissions.stream()
            .filter(g -> "RED".equals(g.getGrantToType()) && "ORG".equals(g.getGrantToObjType()))
            .map(PrivilegeGrant::getGrantToObjId).toList();
        if (!sharedRoots.containsAll(roots)) throw new BaseException("employee.publication.notSharedWithAll");
    }

    private String normalizePath(String path) {
        // 资源中心保存 /byclaw/resource/...，存储门面接收相对 /resource 的路径。
        String value = StringUtils.trimToEmpty(path).replace('\\', '/').replaceFirst("^/?(?:byclaw/)?resource/", "");
        if (StringUtils.isBlank(value) || value.startsWith("/") || value.contains(":")
            || List.of(value.split("/")).contains("..")) {
            throw new BaseException("employee.publication.skillPathInvalid");
        }
        return value;
    }
}
