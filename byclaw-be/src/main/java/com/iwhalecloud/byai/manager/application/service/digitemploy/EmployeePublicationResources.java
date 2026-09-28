package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
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

/** Resolves the entire declared dependency list before a candidate can be submitted.
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 * */
@Service
@lombok.extern.slf4j.Slf4j
public class EmployeePublicationResources {
    private static final int MAX_SKILL_BYTES = 100 * 1024 * 1024;
    private final SsResourceService resources;
    private final SsResourceMapper resourceMapper;
    private final SsResExtSkillService skills;
    private final ResourceArtifactStorageService storage;
    private final SsResourceArtifactService artifacts;
    private final ByClawSkillResourceApplicationService skillRuntime;
    private final AuthApplicationService auth;
    private final PrivilegeGrantMapper grants;
    private final OrganizationService organizations;
    private final EnterpriseInfoService enterprise;
    private final DigitalEmployeePublicationMapper publications;
    private final SequenceService sequence;
    private final com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService config;

    public EmployeePublicationResources(SsResourceService resources, SsResourceMapper resourceMapper,
        SsResExtSkillService skills, ResourceArtifactStorageService storage, SsResourceArtifactService artifacts,
        ByClawSkillResourceApplicationService skillRuntime, AuthApplicationService auth,
        PrivilegeGrantMapper grants, OrganizationService organizations, EnterpriseInfoService enterprise,
        DigitalEmployeePublicationMapper publications, SequenceService sequence,
        com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService config) {
        this.resources = resources;
        this.resourceMapper = resourceMapper;
        this.skills = skills;
        this.storage = storage;
        this.artifacts = artifacts;
        this.skillRuntime = skillRuntime;
        this.auth = auth;
        this.grants = grants;
        this.organizations = organizations;
        this.enterprise = enterprise;
        this.publications = publications;
        this.sequence = sequence;
        this.config = config;
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
    }

    public List<Long> audienceRoots(Long tenantId) {
        // The current open-source identity system is deployment-scoped: login uses this enterprise ID.
        if (tenantId == null || !Objects.equals(tenantId, enterprise.getEnterpriseId())) {
            throw new BaseException("发布范围与当前部署企业不一致");
        }
        List<Long> roots = organizations.getTopOrgList();
        if (roots == null || roots.isEmpty()) throw new BaseException("企业尚未配置根组织，无法建立全员使用授权");
        return roots;
    }

    public List<Dependency> capture(DigitalEmployeeDTO employee, Long authorId, Long tenantId, Long requestId) {
        List<Dependency> result = new ArrayList<>();
        List<Long> roots = List.of();
        try {
            roots = audienceRoots(tenantId);
        } catch (BaseException error) {
            result.add(blocker("发布范围", error.getMessage()));
        }
        LinkedHashSet<Long> ids = new LinkedHashSet<>(employee.getRelIds() == null ? List.of() : employee.getRelIds());
        if (employee.getRelSkills() != null) {
            for (Object raw : employee.getRelSkills()) {
                try {
                    if (!(raw instanceof Map<?, ?> map)) throw new BaseException("请重新关联技能，补齐技能资源标识");
                    Object id = map.get("resourceId");
                    if (id == null) id = map.get("skillId");
                    if (id == null) throw new BaseException("技能缺少资源标识，请重新关联技能");
                    ids.add(Long.valueOf(String.valueOf(id)));
                } catch (BaseException | NumberFormatException error) {
                    Dependency unresolved = new Dependency();
                    unresolved.setLabel("技能配置");
                    unresolved.setResourceType("SKILL");
                    unresolved.setAction("REFERENCE_RESOURCE");
                    unresolved.setWarning(error instanceof BaseException ? error.getMessage() : "技能资源标识无效，此技能可能不可用");
                    result.add(unresolved);
                }
            }
        }
        if (employee.getRelTools() != null) {
            for (String code : employee.getRelTools()) {
                Dependency tool = new Dependency();
                tool.setAction("REFERENCE_TOOL");
                tool.setToolCode(code);
                tool.setLabel("*".equals(code) ? "全部工具" : code);
                try {
                    if ("*".equals(code) || builtInTools().contains(code)) {
                        tool.setAction("BUILTIN_TOOL");
                    } else {
                        List<SsResource> matches = publications.resourcesByCode(code, tenantId);
                        if (matches.size() == 1 && isTool(matches.getFirst())) {
                            ids.add(matches.getFirst().getResourceId());
                            continue;
                        }
                        tool.setWarning("当前无法唯一识别此工具或工具已下架，发布后可能无法调用");
                    }
                } catch (RuntimeException error) {
                    log.warn("检查发布工具失败，toolCode={}", code, error);
                    tool.setWarning("暂时无法检查此工具的可用性，发布后可能无法调用");
                }
                result.add(tool);
            }
        }
        ids.remove(null);
        if (ids.size() > 200) result.add(blocker("关联资源数量", "一次发布最多关联 200 个资源，请调整后提交"));
        for (Long id : ids) {
            SsResource resource = resources.findById(id);
            Dependency dependency = new Dependency();
            dependency.setResource(resource);
            dependency.setTargetId(id);
            dependency.setAction("REFERENCE_RESOURCE");
            if (resource == null || !"SKILL".equals(resource.getResourceBizType())
                || !"personal".equals(resource.getOwnerType()) || !Objects.equals(authorId, resource.getCreateBy())) {
                inspectReference(dependency, authorId, tenantId, roots);
                result.add(dependency);
                continue;
            }
            try {
                requireAvailable(resource, tenantId);
                if (!auth.hasResourceUsePermission(resource, authorId)) throw new BaseException("创建者已无资源使用权限");
                SsResExtSkill skill = skills.findById(id);
                if (skill == null || !"hub".equalsIgnoreCase(skill.getSkillType()) || StringUtils.isBlank(skill.getSkillUrl())) {
                    throw new BaseException("个人技能必须先上传为具有独立 ZIP 文件的技能资源");
                }
                String sourcePath = normalizePath(skill.getSkillUrl());
                byte[] bytes;
                try (InputStream input = storage.readWithinResourceRoot(sourcePath)) {
                    if (input == null) throw new BaseException("技能文件不存在");
                    bytes = input.readNBytes(MAX_SKILL_BYTES + 1);
                }
                if (bytes.length == 0 || bytes.length > MAX_SKILL_BYTES) throw new BaseException("技能文件为空或超过 100 MB");
                String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                String directory = "skill/official-publications/" + requestId + "/" + id;
                storage.uploadToSubdirectory(bytes, directory, hash + ".zip", "application/zip");
                SsResExtSkill snapshot = JSON.parseObject(JSON.toJSONString(skill), SsResExtSkill.class);
                snapshot.setSkillUrl(directory + "/" + hash + ".zip");
                snapshot.setSkillPackageHash(hash);
                snapshot.setSkillPackageSize((long) bytes.length);
                snapshot.setTargetContent(null);
                dependency.setSkill(snapshot);
                dependency.setTargetId(sequence.nextVal());
                dependency.setAction("COPY_SKILL");
            } catch (Exception error) {
                referenceInsteadOfCopy(dependency, error);
                inspectReference(dependency, authorId, tenantId, roots);
            }
            result.add(dependency);
        }
        employee.setRelIds(new ArrayList<>(ids));
        return result;
    }

    public void validate(List<Dependency> dependencies, Long authorId, Long tenantId) {
        List<Long> roots = audienceRoots(tenantId);
        for (Dependency dependency : dependencies) {
            if (dependency.getError() != null) throw new BaseException(dependency.getError());
            if ("COPY_SKILL".equals(dependency.getAction())) {
                try {
                    SsResource current = resources.findById(dependency.getResource().getResourceId());
                    requireAvailable(current, tenantId);
                    if (!auth.hasResourceUsePermission(current, authorId)) throw new BaseException("创建者已无关联资源使用权限");
                    if (!Objects.equals(current.getCreateBy(), authorId)) throw new BaseException("个人技能所有权已变更");
                    try (InputStream snapshot = openSnapshot(List.of(dependency), current.getResourceId())) {
                        if (snapshot == null) throw new BaseException("待发布技能快照文件不存在");
                        byte[] bytes = snapshot.readNBytes(MAX_SKILL_BYTES + 1);
                        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                        if (bytes.length == 0 || bytes.length > MAX_SKILL_BYTES || !hash.equals(dependency.getSkill().getSkillPackageHash())) throw new BaseException("技能快照已变更");
                    }
                } catch (Exception error) {
                    referenceInsteadOfCopy(dependency, error);
                    inspectReference(dependency, authorId, tenantId, roots);
                }
            } else if (dependency.getResource() != null || dependency.getTargetId() != null) {
                inspectReference(dependency, authorId, tenantId, roots);
            } else {
                inspectToolCode(dependency, tenantId);
            }
        }
    }

    public InputStream openSnapshot(List<Dependency> dependencies, Long resourceId) {
        Dependency dependency = dependencies.stream().filter(d -> d.getResource() != null
            && Objects.equals(d.getResource().getResourceId(), resourceId) && "COPY_SKILL".equals(d.getAction())).findFirst()
            .orElseThrow(() -> new BaseException("申请中不存在此技能快照"));
        return storage.readWithinResourceRoot(normalizePath(dependency.getSkill().getSkillUrl()));
    }

    public Map<Long, Long> materialize(List<Dependency> dependencies, Long tenantId) {
        Map<Long, Long> mapping = new LinkedHashMap<>();
        for (Dependency dependency : dependencies) {
            SsResource source = dependency.getResource();
            if ("UNAVAILABLE_RESOURCE".equals(dependency.getAction())) {
                mapping.put(dependency.getTargetId(), null);
                continue; // 员工可以发布，但不得把跨企业资源绑定到官方运行配置。
            }
            if (source == null) {
                // 已失效的资源保留原关联 ID；内置工具和配置提示没有资源 ID。
                if (dependency.getTargetId() != null) mapping.put(dependency.getTargetId(), dependency.getTargetId());
                continue;
            }
            mapping.put(source.getResourceId(), dependency.getTargetId());
            if (!"COPY_SKILL".equals(dependency.getAction())) continue;
            SsResource target = new SsResource();
            target.setResourceBizType("SKILL");
            target.setResourceType("ATOM");
            target.setSystemCode("BYAI");
            target.setResourceName(source.getResourceName());
            target.setResourceDesc(source.getResourceDesc());
            target.setAvatar(source.getAvatar());
            target.setTags(source.getTags());
            target.setCreateBy(source.getCreateBy());
            target.setComAcctId(tenantId);
            target.setResourceStatus(2);
            target.setResourceDVerid(1L);
            target.setResourceRVerid(0L);
            target.setResourceId(dependency.getTargetId());
            target.setResourceCode("official-skill-" + target.getResourceId());
            target.setOwnerType("enterprise");
            target.setPublicationSourceId(null);
            target.setPublicationRequestId(Long.valueOf(dependency.getSkill().getSkillUrl().split("/")[2]));
            target.setCreateTime(new Date());
            target.setUpdateTime(new Date());
            target.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            target.setManOrgId(audienceRoots(tenantId).getFirst());
            target.setManUserId(String.valueOf(target.getCreateBy()));
            resourceMapper.insert(target);
            SsResExtSkill skill = dependency.getSkill();
            skill.setResourceId(target.getResourceId());
            skill.setSourceType("OFFICIAL_EMPLOYEE_PUBLICATION");
            skill.setSyncStatus("SUCCESS");
            skill.setSyncError(null);
            skills.save(skill);
            skillRuntime.refreshSkillBasicInfo(target);
            artifacts.upsertArtifact(target.getResourceId(), "SKILL", "IMPORT_ZIP", "minio", skill.getSkillUrl(), "employee-publication");
            auth.ensureCreatorDefaultPrivileges(target);
            grantAudience(target, tenantId);
        }
        return mapping;
    }

    public void grantAudience(SsResource resource, Long tenantId) {
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

    private void requireAvailable(SsResource resource, Long tenantId) {
        if (resource == null || !Objects.equals(resource.getComAcctId(), tenantId) || !Objects.equals(resource.getResourceStatus(), 2)) {
            throw new BaseException("关联资源不存在、不属于当前企业或未上架");
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

    /** 依赖可用性与员工发布资格分离；保留引用和原权限，只提醒使用限制。 */
    private void inspectReference(Dependency dependency, Long authorId, Long tenantId, List<Long> roots) {
        dependency.setAction(isTool(dependency.getResource()) ? "REFERENCE_TOOL" : "REFERENCE_RESOURCE");
        dependency.setError(null);
        dependency.setWarning(null);
        dependency.setAvailabilityScope("尚未确认");
        dependency.setImpact("保留原关联，实际使用仍取决于资源授权、状态及运行环境");
        if (dependency.getResource() != null) dependency.setResourceType(dependency.getResource().getResourceBizType());
        Long id = dependency.getResource() == null ? dependency.getTargetId() : dependency.getResource().getResourceId();
        try {
            SsResource current = resources.findById(id);
            if (current != null && !Objects.equals(current.getComAcctId(), tenantId)) {
                dependency.setAction("UNAVAILABLE_RESOURCE");
                dependency.setResource(null);
                dependency.setTargetId(id);
                dependency.setWarning("资源不属于当前企业，官方副本不启用此关联；不影响员工发布");
                dependency.setAvailabilityScope("当前企业不可用");
                dependency.setImpact("官方副本不启用此关联，当前企业用户不能通过该副本使用它");
            } else if (current == null) {
                dependency.setWarning("资源不存在，发布后可能无法使用");
                dependency.setAvailabilityScope("当前不可用");
                dependency.setImpact("资源恢复前，用户无法使用此关联资源");
            } else if (!Objects.equals(current.getResourceStatus(), 2)) {
                dependency.setWarning("资源已下架或注销，当前不可用");
                dependency.setAvailabilityScope("当前不可用");
                dependency.setImpact("资源恢复前，用户无法使用此关联资源");
            } else if (!auth.hasResourceUsePermission(current, authorId)) {
                dependency.setWarning("创建者当前无此资源的使用权限；其他使用者能否使用取决于各自权限");
                dependency.setAvailabilityScope("原有授权用户（创建者当前无权）");
                dependency.setImpact("未获授权的用户无法使用此资源，发布员工不会新增授权");
            } else if (!"enterprise".equals(current.getOwnerType())) {
                dependency.setWarning("私有资源保留原有权限，未获授权的使用者无法使用");
                dependency.setAvailabilityScope("原有授权用户（私有资源）");
                dependency.setImpact("未获授权的其他用户无法使用此资源，原有授权继续生效");
            } else if (roots.isEmpty()) {
                dependency.setWarning("尚未确认企业全员的资源使用权限，部分使用者可能无法使用");
            } else {
                requirePublic(current, roots);
                dependency.setAvailabilityScope("当前企业全员");
                dependency.setImpact("企业用户可按现有授权使用，运行配置及服务状态仍需有效");
            }
        } catch (BaseException error) {
            dependency.setWarning("资源未确认对全员可用：" + error.getMessage());
            dependency.setAvailabilityScope("原有授权用户（未确认全员可用）");
            dependency.setImpact("未获授权或命中使用黑名单的用户无法使用此资源");
        } catch (RuntimeException error) {
            log.warn("检查发布资源失败，resourceId={}", id, error);
            dependency.setWarning("暂时无法检查此资源的可用性，发布后可能无法使用");
        }
        if (dependency.getSnapshotWarning() != null) {
            dependency.setWarning(dependency.getSnapshotWarning() + StringUtils.defaultString(dependency.getWarning()));
            dependency.setImpact("未生成独立技能副本，保留原技能关联。" + dependency.getImpact());
        }
    }

    public record Availability(String resourceType, String scope, String reason, String impact) { }

    /** 旧申请缺少范围字段时保守展示，确认预览会重新检查并补齐。 */
    static Availability describe(Dependency dependency) {
        String type = dependency.getResource() == null ? dependency.getResourceType() : dependency.getResource().getResourceBizType();
        if ("BUILTIN_TOOL".equals(dependency.getAction()) || "REFERENCE_TOOL".equals(dependency.getAction())) type = "TOOL";
        if ("COPY_SKILL".equals(dependency.getAction())) {
            return new Availability("SKILL", "当前企业全员（发布成功后）", "个人技能将生成独立副本", "使用独立技能副本，不依赖原技能的私有权限");
        }
        if ("BUILTIN_TOOL".equals(dependency.getAction())) {
            return new Availability("TOOL", "当前企业全员", "平台内置工具", "发布后全员可使用，仍需运行环境正常");
        }
        String scope = StringUtils.defaultIfBlank(dependency.getAvailabilityScope(), "尚未确认，沿用原授权范围");
        String reason = StringUtils.defaultIfBlank(dependency.getWarning(), StringUtils.defaultIfBlank(dependency.getError(), "保留原资源关联与权限"));
        String impact = StringUtils.defaultIfBlank(dependency.getImpact(), "未获授权或资源不可用时，用户无法使用此资源；不影响员工发布");
        return new Availability(StringUtils.defaultIfBlank(type, "UNKNOWN"), scope, reason, impact);
    }

    private void referenceInsteadOfCopy(Dependency dependency, Exception error) {
        dependency.setAction("REFERENCE_RESOURCE");
        dependency.setTargetId(dependency.getResource().getResourceId());
        dependency.setSkill(null);
        dependency.setError(null);
        String reason = error instanceof BaseException ? error.getMessage() : "技能文件读取或快照保存失败";
        dependency.setSnapshotWarning("未生成独立技能副本，改为保留原关联：" + reason + "。");
        log.warn("发布技能改为保留原关联，resourceId={}", dependency.getTargetId(), error);
    }

    private void inspectToolCode(Dependency dependency, Long tenantId) {
        if (!List.of("REFERENCE_TOOL", "BUILTIN_TOOL").contains(dependency.getAction())) return;
        try {
            if ("*".equals(dependency.getToolCode()) || builtInTools().contains(dependency.getToolCode())) {
                dependency.setAction("BUILTIN_TOOL");
                dependency.setWarning(null); // 平台内置工具（包括全部工具）面向全员开放。
            } else {
                dependency.setAction("REFERENCE_TOOL");
                dependency.setWarning("自定义工具保留原配置，可用性取决于使用者权限及运行环境");
                if (publications.resourcesByCode(dependency.getToolCode(), tenantId).isEmpty()) {
                    dependency.setWarning("当前无法识别此工具或工具已下架，发布后可能无法调用");
                }
            }
        } catch (RuntimeException error) {
            log.warn("检查发布工具失败，toolCode={}", dependency.getToolCode(), error);
            dependency.setWarning("暂时无法检查此工具的可用性，发布后可能无法调用");
        }
    }

    private void requirePublic(SsResource resource, List<Long> roots) {
        if (!isTool(resource) && !List.of("SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM").contains(resource.getResourceBizType())) {
            throw new BaseException("当前资源类型可能不受运行环境支持");
        }
        if (!"enterprise".equals(resource.getOwnerType())) throw new BaseException("私有资源未向全员开放");
        List<PrivilegeGrant> permissions = grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
            .eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
            .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
            .in(PrivilegeGrant::getGrantType, "AVAILABLE_USE", "FORCE_USE")
            .eq(PrivilegeGrant::getStatusCd, "A"));
        Date now = new Date();
        permissions = permissions.stream().filter(g -> (g.getEffDate() == null || !g.getEffDate().after(now))
            && (g.getExpDate() == null || g.getExpDate().after(now))).toList();
        if (permissions.stream().anyMatch(g -> "BLACK".equals(g.getGrantToType()))) {
            throw new BaseException("资源存在使用黑名单，部分使用者无法使用");
        }
        List<Long> sharedRoots = permissions.stream()
            .filter(g -> "RED".equals(g.getGrantToType()) && "ORG".equals(g.getGrantToObjType()))
            .map(PrivilegeGrant::getGrantToObjId).toList();
        if (!sharedRoots.containsAll(roots)) throw new BaseException("资源尚未向当前企业全员开放使用");
    }

    private String normalizePath(String path) {
        String value = path.replace('\\', '/').replaceFirst("^/?resource/", "");
        if (value.startsWith("/") || value.contains(":") || List.of(value.split("/")).contains("..")) {
            throw new BaseException("技能文件不是平台资源目录中的有效文件");
        }
        return value;
    }
}
