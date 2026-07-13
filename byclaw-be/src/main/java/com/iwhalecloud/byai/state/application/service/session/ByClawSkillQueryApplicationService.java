package com.iwhalecloud.byai.state.application.service.session;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;

/**
 * 用户工作空间 skill 查询应用服务。
 *
 * @author qin.guoquan
 * @date 2026-04-28 18:45:00
 */
@Service
public class ByClawSkillQueryApplicationService {

    @Autowired
    private UserFS userFS;

    @Autowired
    private ByClawSkillPathResolver skillPathResolver;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 个人技能（资源中心已资源化技能）查询服务，用于右侧个人技能 tab 的去重排除集。
     * 通过 {@link Lazy} 避免 state ↔ manager 之间潜在的启动期循环依赖。
     */
    @Lazy
    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;

    /**
     * 个人技能排除集查询的单页上限。个人技能数量有限，单页足以覆盖全量。
     */
    private static final int PERSONAL_SKILL_EXCLUDE_PAGE_SIZE = 1000;

    /**
     * 查询指定用户在其工作空间下的 skill 列表。
     * 1. resourceId 有值时查询数字员工路径 /.openclaw/workspace-baiying-agent-{resourceId}/skills/；
     * 2. resourceId 为空时查询超级助手路径 /.openclaw/workspace/skills/；
     * 3. 仅识别 skills/{skillName}/SKILL.md，子目录中的 SKILL.md 不作为独立技能；
     * 4. keyword 只按一层 skillFileName 目录名匹配；5. 若桶或目录不存在，返回空列表。
     */
    public List<ByClawSkillDto> qrySkillListByUserCode(String userCode, Long resourceId, String keyword) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }

        String normalizedKeyword = StringUtils.trimToEmpty(keyword).toLowerCase(Locale.ROOT);

        String skillRootPrefix = skillPathResolver.resolveSkillRootPrefix(userCode, resourceId);
        Map<String, SkillDocInfo> skillDocMap = new LinkedHashMap<>();
        collectSkillDocs(skillDocMap,
            safeObjectKeys(ByClawUserWorkspacePaths.withUserContext(userCode, () -> userFS.list(skillRootPrefix, null))),
            skillRootPrefix);

        return skillDocMap.entrySet().stream().filter(entry -> matchKeyword(entry.getValue().skillName, normalizedKeyword))
            .map(entry -> buildSkillDto(userCode, entry.getValue().skillName, entry.getValue(), null))
            .sorted(Comparator.comparing(ByClawSkillDto::getSkillName)).collect(Collectors.toList());
    }

    /**
     * 查询当前数字员工 workspace 中存在、但尚未通过资源关系表绑定的目录技能。
     */
    public List<ByClawSkillDto> qryWorkspaceUnboundSkillList(String userCode, Long resourceId, String keyword) {
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }
        Set<String> boundSkillKeys = queryBoundSkillKeys(resourceId);
        return qrySkillListByUserCode(userCode, resourceId, keyword).stream()
            .filter(skill -> !boundSkillKeys.contains(normalizeKey(skill.getSkillName())))
            .peek(skill -> {
                skill.setDisplaySourceType(ByClawSkillDto.DISPLAY_SOURCE_TYPE_USER_DEVELOPED);
                skill.setResourceBacked(false);
            })
            .collect(Collectors.toList());
    }

    /**
     * 兼容旧接口命名，内部已切换为“用户开发”口径。
     */
    public List<ByClawSkillDto> qryLobsterInstalledSkillList(String userCode, Long resourceId, String keyword) {
        return qryWorkspaceUnboundSkillList(userCode, resourceId, keyword);
    }

    /**
     * 查询工作空间下、尚未进入当前用户“个人技能”资源列表的目录技能。
     *
     * 与 {@link #qryWorkspaceUnboundSkillList} 的区别：排除口径是“用户个人 tab 已展示的已资源化技能”
     * （走 listResourceAuth(ownerType=personal) 的真实数据源），而非“绑定到当前数字员工关系表”。
     * 这样右侧个人技能 tab 把工作空间技能与已资源化个人技能合并时不会重复。
     */
    public List<ByClawSkillDto> qryWorkspacePersonalUnboundSkillList(String userCode, Long resourceId, String keyword) {
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }
        Set<String> personalSkillKeys = queryPersonalResourcedSkillKeys();
        return qrySkillListByUserCode(userCode, resourceId, keyword).stream()
            .filter(skill -> !personalSkillKeys.contains(normalizeKey(skill.getSkillName())))
            .peek(skill -> {
                skill.setDisplaySourceType(ByClawSkillDto.DISPLAY_SOURCE_TYPE_USER_DEVELOPED);
                skill.setResourceBacked(false);
            })
            .collect(Collectors.toList());
    }

    /**
     * 取当前用户个人 tab 下已资源化 SKILL 技能的去重 key（resourceCode / resourceName 经归一化）。
     */
    private Set<String> queryPersonalResourcedSkillKeys() {
        ResourceUseAuthQo qo = new ResourceUseAuthQo();
        qo.setOwnerType(OwnerType.PERSONAL);
        qo.setResourceBizTypeList(Collections.singletonList(ResourceBizTypeEnum.SKILL.name()));
        qo.setPageNum(1);
        qo.setPageSize(PERSONAL_SKILL_EXCLUDE_PAGE_SIZE);
        PageInfo<ResourceAuthVo> page = resourceAuthApplicationService.listResourceAuth(qo);
        Set<String> keys = new HashSet<>();
        if (page == null || page.getList() == null) {
            return keys;
        }
        page.getList().forEach(vo -> {
            addBoundKey(keys, vo.getResourceCode());
            addBoundKey(keys, vo.getResourceName());
        });
        return keys;
    }

    public ByClawSkillDto getWorkspaceSkillDetail(String userCode, Long resourceId, String skillPath) {
        SkillDocInfo skillDocInfo = resolveSkillDoc(userCode, resourceId, skillPath);
        return buildSkillDto(userCode, skillDocInfo.skillName, skillDocInfo,
            ByClawSkillDto.DISPLAY_SOURCE_TYPE_USER_DEVELOPED);
    }

    private List<String> safeObjectKeys(List<String> objectKeys) {
        return objectKeys == null ? Collections.emptyList() : objectKeys;
    }

    private void collectSkillDocs(Map<String, SkillDocInfo> skillDocMap, List<String> objectKeys,
        String skillRootPrefix) {
        objectKeys.stream().filter(StringUtils::isNotBlank)
            .forEach(objectKey -> collectSkillDoc(skillDocMap, objectKey, skillRootPrefix));
    }

    private void collectSkillDoc(Map<String, SkillDocInfo> skillDocMap, String objectKey, String skillRootPrefix) {
        if (!StringUtils.startsWith(objectKey, skillRootPrefix)) {
            return;
        }
        String relativePath = objectKey.substring(skillRootPrefix.length());
        String[] segments = StringUtils.split(relativePath, '/');
        // 只识别技能根目录下的 SKILL.md，避免把子目录里的 SKILL.md 展示成额外技能。
        if (segments == null || segments.length != 2
            || !StringUtils.equals(segments[segments.length - 1], ByClawUserWorkspacePaths.SKILL_DOC_FILE_NAME)) {
            return;
        }
        String skillRelativeDir = StringUtils.substringBeforeLast(relativePath, "/");
        String skillName = segments[segments.length - 2];
        if (StringUtils.isBlank(skillName) || StringUtils.isBlank(skillRelativeDir)) {
            return;
        }
        String skillPath = StringUtils.removeEnd(skillRootPrefix, "/") + "/" + skillRelativeDir;
        skillDocMap.putIfAbsent(skillPath, new SkillDocInfo(skillName, skillPath, objectKey));
    }

    /**
     * keyword 仅按 skills/{skillFileName}/SKILL.md 中的 skillFileName 目录名做模糊匹配， 不按 SKILL.md 文件名或完整对象路径匹配。
     */
    private boolean matchKeyword(String skillName, String normalizedKeyword) {
        if (StringUtils.isBlank(normalizedKeyword)) {
            return true;
        }
        return StringUtils.defaultString(skillName).toLowerCase(Locale.ROOT).contains(normalizedKeyword);
    }

    private ByClawSkillDto buildSkillDto(String userCode, String skillName, SkillDocInfo skillDocInfo,
        String displaySourceType) {
        ByClawSkillDto dto = new ByClawSkillDto(null, skillName, skillDocInfo.skillPath, skillDocInfo.skillDocObjectKey,
            readSkillDescription(userCode, skillDocInfo.skillDocObjectKey), displaySourceType, false);
        dto.setUseStartTime(readSkillUseStartTime(userCode, skillDocInfo.skillDocObjectKey));
        return dto;
    }

    private SkillDocInfo resolveSkillDoc(String userCode, Long resourceId, String skillPath) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        String skillRootPrefix = skillPathResolver.resolveSkillRootPrefix(userCode, resourceId);
        String normalizedSkillPath = normalizeSkillPath(skillRootPrefix, skillPath);
        List<String> objectKeys = safeObjectKeys(ByClawUserWorkspacePaths.withUserContext(userCode,
            () -> userFS.list(normalizedSkillPath + "/", null)));
        Map<String, SkillDocInfo> skillDocMap = new LinkedHashMap<>();
        collectSkillDocs(skillDocMap, objectKeys, skillRootPrefix);
        return skillDocMap.values().stream()
            .filter(info -> StringUtils.equals(info.skillPath, normalizedSkillPath))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException(I18nUtil.get("byclaw.skill.delete.notfound")));
    }

    private String normalizeSkillPath(String skillRootPrefix, String skillPath) {
        String normalized = StringUtils.trimToEmpty(skillPath).replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        normalized = StringUtils.removeEnd(normalized, "/");
        if (!normalized.startsWith(skillRootPrefix) || containsParentPathSegment(normalized)) {
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

    private Set<String> queryBoundSkillKeys(Long resourceId) {
        List<SsResourceRelDetail> relDetails = ssResourceRelDetailService.findByResourceId(resourceId);
        if (relDetails == null || relDetails.isEmpty()) {
            return Collections.emptySet();
        }
        List<Long> relResourceIds = relDetails.stream()
            .map(SsResourceRelDetail::getRelResourceId)
            .filter(id -> id != null)
            .distinct()
            .collect(Collectors.toList());
        List<SsResource> resources = ssResourceService.findByIdList(relResourceIds);
        if (resources == null || resources.isEmpty()) {
            return Collections.emptySet();
        }
        Set<String> boundKeys = new HashSet<>();
        resources.stream()
            .filter(resource -> ResourceBizTypeEnum.SKILL.name().equals(resource.getResourceBizType()))
            .forEach(resource -> {
                addBoundKey(boundKeys, resource.getResourceCode());
                addBoundKey(boundKeys, resource.getResourceName());
            });
        return boundKeys;
    }

    private void addBoundKey(Set<String> boundKeys, String value) {
        String key = normalizeKey(value);
        if (StringUtils.isNotBlank(key)) {
            boundKeys.add(key);
        }
    }

    private String normalizeKey(String value) {
        return StringUtils.trimToEmpty(value).toLowerCase(Locale.ROOT);
    }

    private String readSkillDescription(String userCode, String skillDocObjectKey) {
        if (StringUtils.isBlank(skillDocObjectKey)) {
            return null;
        }
        try (InputStream inputStream = ByClawUserWorkspacePaths.withUserContext(userCode,
            () -> userFS.read(skillDocObjectKey))) {
            if (inputStream == null) {
                return null;
            }
            return ByClawSkillDocParser.extractDescription(new String(inputStream.readAllBytes(), StandardCharsets.UTF_8));
        }
        catch (Exception e) {
            return null;
        }
    }

    private String readSkillUseStartTime(String userCode, String skillDocObjectKey) {
        if (StringUtils.isBlank(skillDocObjectKey)) {
            return null;
        }
        try {
            FileMetadata metadata = ByClawUserWorkspacePaths.withUserContext(userCode,
                () -> userFS.metadata(skillDocObjectKey));
            return metadata == null ? null : metadata.getLastModified();
        }
        catch (Exception ignored) {
            return null;
        }
    }

    private static final class SkillDocInfo {
        private final String skillPath;

        private final String skillDocObjectKey;

        private final String skillName;

        private SkillDocInfo(String skillName, String skillPath, String skillDocObjectKey) {
            this.skillName = skillName;
            this.skillPath = skillPath;
            this.skillDocObjectKey = skillDocObjectKey;
        }
    }

}
