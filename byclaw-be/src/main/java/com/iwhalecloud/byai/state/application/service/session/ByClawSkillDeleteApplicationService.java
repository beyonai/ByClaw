package com.iwhalecloud.byai.state.application.service.session;

import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;

/**
 * 用户工作空间 skill 删除应用服务。
 *
 * 路径口径与 query / upload / download 保持一致：
 * - 数字员工：/.openclaw/workspace-baiying-agent-{resourceId}/skills/{skillName}
 * - 超级助手：/.openclaw/workspace/skills/{skillName}
 *
 * @author qin.guoquan
 * @date 2026-05-20
 */
@Service
public class ByClawSkillDeleteApplicationService {

    @Autowired
    private UserFS userFS;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 删除一个 skill 目录。
     *
     * @param userCode 目标用户编码
     * @param resourceId 数字员工资源ID；为空时按超级助手技能目录处理
     * @param skillPath 要删除的 skill 根目录路径
     * @return 删除结果，返回 skillName / skillPath 便于前端直接刷新本地列表
     */
    public ByClawSkillDto deleteSkill(String userCode, Long resourceId, String skillPath) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        String normalizedSkillPath = normalizeSkillPath(skillPath, resourceId);
        List<String> objectKeys = ByClawUserWorkspacePaths.withUserContext(userCode, () -> userFS.list(normalizedSkillPath + "/", null));
        if (objectKeys == null || objectKeys.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.delete.notfound"));
        }

        ByClawUserWorkspacePaths.withUserContext(userCode, () -> {
            userFS.init();
            userFS.delete(normalizedSkillPath + "/");
            return null;
        });
        return new ByClawSkillDto(extractSkillName(normalizedSkillPath), normalizedSkillPath, null);
    }

    private String normalizeSkillPath(String skillPath, Long resourceId) {
        if (StringUtils.isBlank(skillPath)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        String skillRootPrefix = resolveSkillRootPrefix(resourceId);
        String normalized = skillPath.replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (!normalized.startsWith(skillRootPrefix)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        for (String seg : normalized.split("/")) {
            if ("..".equals(seg)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
            }
        }
        String tail = normalized.substring(skillRootPrefix.length());
        if (StringUtils.isBlank(tail) || tail.contains("/")) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        return normalized;
    }

    private String resolveSkillRootPrefix(Long resourceId) {
        if (resourceId == null) {
            return ByClawUserWorkspacePaths.WORKSPACE_SKILL_ROOT_PREFIX;
        }
        SsResource resource = ssResourceService.findById(resourceId);
        String resourceCode = resource == null ? null : resource.getResourceCode();
        return ByClawUserWorkspacePaths.resolveSkillRootPrefix(resourceId, resourceCode);
    }

    private String extractSkillName(String normalizedSkillPath) {
        int slash = normalizedSkillPath.lastIndexOf('/');
        return slash >= 0 ? normalizedSkillPath.substring(slash + 1) : normalizedSkillPath;
    }
}
