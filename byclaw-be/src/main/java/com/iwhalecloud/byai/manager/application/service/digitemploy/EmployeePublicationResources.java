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
        List<Long> roots = audienceRoots(tenantId);
        LinkedHashSet<Long> ids = new LinkedHashSet<>(employee.getRelIds() == null ? List.of() : employee.getRelIds());
        if (employee.getRelSkills() != null) {
            for (Object raw : employee.getRelSkills()) {
                if (!(raw instanceof Map<?, ?> map)) throw new BaseException("请先保存员工技能配置，补齐技能资源标识");
                Object id = map.get("resourceId");
                if (id == null) id = map.get("skillId");
                if (id == null) throw new BaseException("技能缺少资源标识，请先重新关联技能");
                ids.add(Long.valueOf(String.valueOf(id)));
            }
        }
        if (employee.getRelTools() != null) {
            for (String code : employee.getRelTools()) {
                if ("*".equals(code)) throw new BaseException("发布前请将全部工具替换为明确的内置工具或企业公共工具");
                if (builtInTools().contains(code)) continue;
                List<SsResource> matches = publications.resourcesByCode(code, tenantId);
                if (matches.size() != 1) throw new BaseException("工具编码无法唯一解析为可发布资源：" + code);
                ids.add(matches.getFirst().getResourceId());
            }
        }
        ids.remove(null);
        if (ids.size() > 200) throw new BaseException("一次发布最多关联 200 个资源");
        List<Dependency> result = new ArrayList<>();
        for (Long id : ids) {
            SsResource resource = resources.findById(id);
            Dependency dependency = new Dependency();
            dependency.setResource(resource);
            dependency.setTargetId(id);
            dependency.setAction("REUSE");
            try {
                requireAvailable(resource, tenantId);
                if (!auth.hasResourceUsePermission(resource, authorId)) throw new BaseException("创建者已无资源使用权限");
                if ("SKILL".equals(resource.getResourceBizType()) && "personal".equals(resource.getOwnerType())
                    && Objects.equals(authorId, resource.getCreateBy())) {
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
                } else {
                    requirePublic(resource, roots);
                }
            } catch (Exception error) {
                dependency.setAction("BLOCKED");
                dependency.setError("资源 " + id + "（" + (resource == null ? "不存在" : resource.getResourceName()) + "）：" + (error instanceof BaseException ? error.getMessage() : "资源读取或快照保存失败，请联系管理员检查服务日志"));
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
            SsResource current = resources.findById(dependency.getResource().getResourceId());
            requireAvailable(current, tenantId);
            if (!auth.hasResourceUsePermission(current, authorId)) throw new BaseException("创建者已无关联资源使用权限");
            if ("COPY_SKILL".equals(dependency.getAction())) {
                if (!Objects.equals(current.getCreateBy(), authorId)) throw new BaseException("个人技能所有权已变更");
                try (InputStream snapshot = openSnapshot(List.of(dependency), current.getResourceId())) {
                    if (snapshot == null) throw new BaseException("待发布技能快照文件不存在");
                    byte[] bytes = snapshot.readNBytes(MAX_SKILL_BYTES + 1);
                    String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                    if (bytes.length > MAX_SKILL_BYTES || !hash.equals(dependency.getSkill().getSkillPackageHash())) throw new BaseException("技能快照已变更，请重新发起申请");
                } catch (BaseException error) { throw error; }
                catch (Exception error) { throw new BaseException("技能快照不可读取，请重新发起申请"); }
            } else {
                requirePublic(current, roots);
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

    private void requirePublic(SsResource resource, List<Long> roots) {
        if (!List.of("SKILL", "TOOLKIT", "TOOL", "MCP", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM").contains(resource.getResourceBizType())) {
            throw new BaseException("当前发布不支持此类关联资源，请移除后重试");
        }
        if (!"enterprise".equals(resource.getOwnerType())) throw new BaseException("私有资源请先完成官方化或替换为企业公共资源");
        List<PrivilegeGrant> permissions = grants.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
            .eq(PrivilegeGrant::getGrantObjId, resource.getResourceId())
            .eq(PrivilegeGrant::getGrantObjType, resource.getResourceBizType())
            .in(PrivilegeGrant::getGrantType, "AVAILABLE_USE", "FORCE_USE")
            .eq(PrivilegeGrant::getStatusCd, "A"));
        Date now = new Date();
        permissions = permissions.stream().filter(g -> (g.getEffDate() == null || !g.getEffDate().after(now))
            && (g.getExpDate() == null || g.getExpDate().after(now))).toList();
        if (permissions.stream().anyMatch(g -> "BLACK".equals(g.getGrantToType()))) {
            throw new BaseException("资源存在使用黑名单，不能作为全员共享依赖");
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
