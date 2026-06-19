package com.iwhalecloud.byai.state.application.service.session;

import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
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
    private SsResourceService ssResourceService;

    /**
     * 查询指定用户在其工作空间下的 skill 列表。
     * 1. resourceId 有值时查询数字员工路径 /.openclaw/workspace-baiying-agent-{resourceId}/skills/；
     * 2. resourceId 为空时查询超级助手路径 /.openclaw/workspace/skills/；
     * 3. 只识别 skills/{skillName}/SKILL.md，不递归采纳更深层级对象；
     * 4. keyword 只按一层 skillFileName 目录名匹配；5. 若桶或目录不存在，返回空列表。
     */
    public List<ByClawSkillDto> qrySkillListByUserCode(String userCode, Long resourceId, String keyword) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }

        String normalizedKeyword = StringUtils.trimToEmpty(keyword).toLowerCase(Locale.ROOT);

        String skillRootPrefix = resolveSkillRootPrefix(resourceId);
        Map<String, SkillDocInfo> skillDocMap = new LinkedHashMap<>();
        collectSkillDocs(skillDocMap,
            safeObjectKeys(ByClawUserWorkspacePaths.withUserContext(userCode, () -> userFS.list(skillRootPrefix, null))),
            skillRootPrefix);

        return skillDocMap.entrySet().stream().filter(entry -> matchKeyword(entry.getKey(), normalizedKeyword))
            .map(entry -> buildSkillDto(entry.getKey(), entry.getValue()))
            .sorted(Comparator.comparing(ByClawSkillDto::getSkillName)).collect(Collectors.toList());
    }

    private List<String> safeObjectKeys(List<String> objectKeys) {
        return objectKeys == null ? Collections.emptyList() : objectKeys;
    }

    private String resolveSkillRootPrefix(Long resourceId) {
        if (resourceId == null) {
            return ByClawUserWorkspacePaths.WORKSPACE_SKILL_ROOT_PREFIX;
        }
        SsResource resource = ssResourceService.findById(resourceId);
        String resourceCode = resource == null ? null : resource.getResourceCode();
        return ByClawUserWorkspacePaths.resolveSkillRootPrefix(resourceId, resourceCode);
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
        if (segments == null || segments.length != 2 || StringUtils.isBlank(segments[0])
            || !StringUtils.equals(segments[1], ByClawUserWorkspacePaths.SKILL_DOC_FILE_NAME)) {
            return;
        }
        skillDocMap.putIfAbsent(segments[0], new SkillDocInfo(skillRootPrefix + segments[0], objectKey));
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

    private ByClawSkillDto buildSkillDto(String skillName, SkillDocInfo skillDocInfo) {
        return new ByClawSkillDto(skillName, skillDocInfo.skillPath, skillDocInfo.skillDocObjectKey);
    }

    private static final class SkillDocInfo {
        private final String skillPath;

        private final String skillDocObjectKey;

        private SkillDocInfo(String skillPath, String skillDocObjectKey) {
            this.skillPath = skillPath;
            this.skillDocObjectKey = skillDocObjectKey;
        }
    }


}
