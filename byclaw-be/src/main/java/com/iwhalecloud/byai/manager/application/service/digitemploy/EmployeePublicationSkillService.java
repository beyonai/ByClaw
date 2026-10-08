package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.utils.SeekableInMemoryByteChannel;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 仅供数字员工发布使用的新 A/B 实现，不改变资源中心的独立技能发布流程。 */
@Service
@RequiredArgsConstructor
public class EmployeePublicationSkillService implements EmployeePublicationSkillBridge {
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;
    private final SsResourceService resources;
    private final SsResourceMapper mapper;
    private final SsResExtSkillService skills;
    private final SsResourceRelDetailService relations;
    private final ResourceArtifactStorageService storage;
    private final SsResourceArtifactService artifacts;
    private final ByClawSkillResourceApplicationService runtime;
    private final SequenceService sequence;

    @Override
    public CheckResult check(SsResource source, SsResExtSkill snapshot, byte[] bytes, Context context) {
        List<Issue> issues = new ArrayList<>();
        try {
            for (DeclaredResource declared : manifest(bytes)) {
                SsResource resource = resources.findById(declared.id());
                String name = resource == null || !Objects.equals(context.tenantId(), resource.getComAcctId())
                    ? String.valueOf(declared.id()) : resource.getResourceName();
                String reason = null;
                if (resource == null) reason = "依赖资源不存在";
                else if (!Objects.equals(context.tenantId(), resource.getComAcctId())) reason = "依赖资源不属于当前企业";
                else if (!matchesType(declared.type(), resource.getResourceBizType())) reason = "声明类型与实际资源类型不一致";
                else if (EmployeePublicationResources.isPersonal(resource)) reason = Issue.PERSONAL_RESOURCE_REASON;
                else if (!"enterprise".equals(resource.getOwnerType())) reason = "无法确认依赖资源的企业归属";
                else if (!Objects.equals(resource.getResourceStatus(), 2)) reason = "依赖资源已下架或失效";
                if (reason != null) issues.add(new Issue(String.valueOf(declared.id()), declared.type(), name, reason));
            }
        } catch (Exception error) {
            issues.add(new Issue("", "SKILL", source.getResourceName(), error instanceof BaseException
                ? error.getMessage() : "技能依赖文件无法读取，请检查 references/resourceMate.json"));
        }
        return new CheckResult(issues.isEmpty(), List.copyOf(issues));
    }

    record DeclaredResource(Long id, String type) { }

    /** 以 SKILL.md 定位唯一技能根目录；只读取该根目录内的依赖声明，不解压到本机。 */
    List<DeclaredResource> manifest(byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0 || bytes.length > 100 * 1024 * 1024) throw new BaseException("技能文件为空或过大");
        try (SeekableInMemoryByteChannel channel = new SeekableInMemoryByteChannel(bytes);
             ZipFile zip = new ZipFile(channel, StandardCharsets.UTF_8.name())) {
            List<String> roots = new ArrayList<>();
            Map<String, org.apache.commons.compress.archivers.zip.ZipArchiveEntry> entries = new LinkedHashMap<>();
            var iterator = zip.getEntries();
            while (iterator.hasMoreElements()) {
                if (entries.size() >= 10000) throw new BaseException("技能包文件数量过多");
                var entry = iterator.nextElement();
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("/") || name.contains(":") || List.of(name.split("/")).contains("..") || entry.isUnixSymlink()) {
                    throw new BaseException("技能包包含无效路径或符号链接");
                }
                if (entry.isDirectory()) continue;
                if (entries.putIfAbsent(name, entry) != null) throw new BaseException("技能包包含重复文件路径");
                if (name.equals("SKILL.md") || name.matches("[^/]+/SKILL\\.md")) {
                    roots.add(name.substring(0, name.length() - "SKILL.md".length()));
                }
            }
            if (roots.size() != 1) throw new BaseException("技能包需要唯一的 SKILL.md 根目录");
            var entry = entries.get(roots.getFirst() + "references/resourceMate.json");
            // 按发布约定，未提供依赖声明等同于无关联资源；存在声明时仍须完整解析并校验。
            if (entry == null) return List.of();
            byte[] content;
            try (InputStream input = zip.getInputStream(entry)) { content = input.readNBytes(MAX_MANIFEST_BYTES + 1); }
            if (content.length > MAX_MANIFEST_BYTES) throw new BaseException("技能依赖文件过大");
            String text = new String(content, StandardCharsets.UTF_8).replaceFirst("^\\uFEFF", "");
            JSONObject data = JSON.parseObject(text);
            if (data == null || !(data.get("resources") instanceof JSONArray rows)) throw new BaseException("技能依赖文件必须包含 resources 数组");
            if (rows.size() > 200) throw new BaseException("技能声明的依赖资源超过 200 项");
            Map<Long, DeclaredResource> result = new LinkedHashMap<>();
            for (Object raw : rows) {
                if (!(raw instanceof JSONObject row)) throw new BaseException("技能依赖条目格式不正确");
                String type = row.getString("resourceType");
                String value = row.getString("resourceId");
                if (!List.of("TOOL", "KNOWLEDGE_BASE").contains(StringUtils.defaultString(type))
                    || value == null || !value.matches("[1-9][0-9]*")) throw new BaseException("技能依赖的 resourceId 或 resourceType 无效");
                Long id = Long.valueOf(value);
                DeclaredResource previous = result.putIfAbsent(id, new DeclaredResource(id, type));
                if (previous != null && !previous.type().equals(type)) throw new BaseException("同一依赖资源声明了不同类型");
            }
            return List.copyOf(result.values());
        }
    }

    private boolean matchesType(String declared, String actual) {
        if (actual == null) return false;
        return "KNOWLEDGE_BASE".equals(declared) ? actual.startsWith("KG_")
            : List.of("TOOL", "TOOLKIT", "MCP", "AGENT").contains(actual);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY, rollbackFor = Exception.class)
    public Long publish(SsResource source, SsResExtSkill snapshot, byte[] bytes, Long officialEmployeeId, Context context) {
        if (!DigitalEmployeeGovernanceService.isAdministrator() || context.requestId() == null
            || !Objects.equals(context.tenantId(), CurrentUserHolder.getEnterpriseId())) throw new BaseException("无权执行技能发布");
        SsResource employee = resources.findById(officialEmployeeId);
        if (!DigitalEmployeeGovernanceService.isOfficialCopy(employee)
            || !Objects.equals(employee.getComAcctId(), context.tenantId())) throw new BaseException("企业员工不存在或不属于当前企业");
        if (!DigestUtils.sha256Hex(bytes).equals(snapshot.getSkillPackageHash())) throw new BaseException("待审核技能文件已变化");
        CheckResult checked = check(source, snapshot, bytes, context);
        if (!checked.copyAllowed()) throw new BaseException("技能依赖已变化，请重新确认发布清单");
        String code = "employee-skill-" + context.requestId() + "-" + source.getResourceId();
        SsResource target = mapper.selectOne(new LambdaQueryWrapper<SsResource>()
            .eq(SsResource::getComAcctId, context.tenantId()).eq(SsResource::getResourceCode, code));
        if (target != null) {
            SsResExtSkill existing = skills.findById(target.getResourceId());
            if (!"enterprise".equals(target.getOwnerType()) || !"SKILL".equals(target.getResourceBizType())
                || !Objects.equals(target.getPublicationRequestId(), context.requestId())
                || !Objects.equals(target.getResourceStatus(), 2) || existing == null
                || !Objects.equals(existing.getSkillPackageHash(), snapshot.getSkillPackageHash())) {
                throw new BaseException("企业技能副本已变化，不能覆盖");
            }
            relate(officialEmployeeId, target.getResourceId(), context, "DIG_EMPLOYEE_SKILL");
            return target.getResourceId();
        }
        target = new SsResource();
        target.setResourceId(sequence.nextVal()); target.setResourceCode(code);
        target.setResourceName(StringUtils.defaultIfBlank(context.copyName(),
            EmployeePublicationNames.enterpriseName(source.getResourceName(), null)));
        target.setResourceDesc(source.getResourceDesc());
        target.setResourceBizType("SKILL"); target.setResourceType("ATOM"); target.setSystemCode("BYAI");
        target.setOwnerType("enterprise"); target.setComAcctId(context.tenantId());
        target.setResourceStatus(2); target.setCreateBy(context.authorId()); target.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        target.setCreateTime(new Date()); target.setUpdateTime(new Date());
        target.setPublicationRequestId(context.requestId()); target.setResourceDVerid(1L); target.setResourceRVerid(0L);
        target.setAvatar(source.getAvatar()); target.setTags(source.getTags()); target.setCatalogId(source.getCatalogId());
        target.setManUserId(String.valueOf(context.authorId())); target.setManOrgId(employee.getManOrgId());
        String directory = "skill/org-hub/" + context.tenantId() + "/" + context.requestId() + "/" + source.getResourceId();
        String filename = snapshot.getSkillPackageHash() + ".zip";
        storage.uploadToSubdirectory(bytes, directory, filename, "application/zip");
        mapper.insert(target);
        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(target.getResourceId()); ext.setSkillType("hub");
        ext.setSkillUrl(directory + "/" + filename); ext.setVersion("v0.1");
        ext.setSkillOriginalFilename(snapshot.getSkillOriginalFilename()); ext.setSkillPackageFormat("zip");
        ext.setSkillPackageSize((long) bytes.length); ext.setSkillPackageHash(snapshot.getSkillPackageHash());
        ext.setSourceType("OFFICIAL_EMPLOYEE_PUBLICATION"); ext.setSyncStatus("SUCCESS");
        ext.setTargetContent(JSON.toJSONString(Map.of("sourceResourceId", String.valueOf(source.getResourceId()),
            "sourceCreatorId", String.valueOf(context.authorId()), "sourcePackageUrl", snapshot.getSkillUrl(),
            "sourceVersion", StringUtils.defaultString(snapshot.getVersion()))));
        skills.save(ext);
        if (StringUtils.isBlank(runtime.refreshSkillBasicInfo(target))) throw new BaseException("企业技能运行配置生成失败");
        artifacts.upsertArtifact(target.getResourceId(), "SKILL", "IMPORT_ZIP", "minio", ext.getSkillUrl(), "employee-publication");
        try {
            for (DeclaredResource dependency : manifest(bytes)) relate(target.getResourceId(), dependency.id(), context, "SKILL_RESOURCE");
        } catch (Exception error) { throw new BaseException("技能依赖关系创建失败"); }
        relate(officialEmployeeId, target.getResourceId(), context, "DIG_EMPLOYEE_SKILL");
        return target.getResourceId();
    }

    private void relate(Long from, Long to, Context context, String type) {
        if (relations.count(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, from).eq(SsResourceRelDetail::getRelResourceId, to)
            .eq(SsResourceRelDetail::getComAcctId, context.tenantId()).eq(SsResourceRelDetail::getRelStatus, 1)) > 0) return;
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(sequence.nextVal()); relation.setResourceId(from); relation.setRelResourceId(to);
        relation.setComAcctId(context.tenantId()); relation.setRelStatus(1); relation.setRelTypeName(type);
        relation.setCreateBy(CurrentUserHolder.getCurrentUserId()); relation.setCreateTime(new Date());
        relations.save(relation);
    }
}
