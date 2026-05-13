package com.iwhalecloud.byai.state.application.service.session;

import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;

/**
 * 用户工作空间 skill 查询应用服务。
 *
 * @author qin.guoquan
 * @date 2026-04-28 18:45:00
 */
@Service
public class ByClawSkillQueryApplicationService {

    static final String SKILL_ROOT_PREFIX_TEMPLATE = "/.openclaw/workspace-baiying-agent-%s/skills/";
    static final String WORKSPACE_SKILL_ROOT_PREFIX = "/.openclaw/workspace/skills/";
    private static final String SKILL_DOC_FILE_NAME = "SKILL.md";

    @Autowired
    private UserFS userFS;

    /**
     * 查询指定用户在其工作空间下的 skill 列表。
     * 1. 只在 minio 模式下开放；
     * 2. 仅查询 resourceId 对应工作空间的 skills 根目录；
     * 3. 只识别 skills/{skillName}/SKILL.md，不递归采纳更深层级对象；
     * 4. keyword 只按一层 skillFileName 目录名匹配；
     * 5. 若桶或目录不存在，返回空列表。
     */
    public List<ByClawSkillDto> qrySkillListByUserCode(String userCode, Long resourceId, String keyword) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        if (resourceId == null) {
            throw new IllegalArgumentException(I18nUtil.get("resource.resourceid.notnull"));
        }

        String normalizedKeyword = StringUtils.trimToEmpty(keyword).toLowerCase(Locale.ROOT);

        String skillRootPrefix = buildSkillRootPrefix(resourceId);
        Map<String, SkillDocInfo> skillDocMap = new LinkedHashMap<>();
        collectSkillDocs(skillDocMap, safeObjectKeys(withUserContext(userCode, () -> userFS.list(skillRootPrefix, null))), skillRootPrefix);
        collectSkillDocs(skillDocMap, safeObjectKeys(withUserContext(userCode, () -> userFS.list(WORKSPACE_SKILL_ROOT_PREFIX, null))), WORKSPACE_SKILL_ROOT_PREFIX);

        return skillDocMap.entrySet().stream()
            .filter(entry -> matchKeyword(entry.getKey(), normalizedKeyword))
            .map(entry -> buildSkillDto(entry.getKey(), entry.getValue()))
            .sorted(Comparator.comparing(ByClawSkillDto::getSkillName))
            .collect(Collectors.toList());
    }

    private String buildSkillRootPrefix(Long resourceId) {
        return String.format(SKILL_ROOT_PREFIX_TEMPLATE, resourceId);
    }

    private List<String> safeObjectKeys(List<String> objectKeys) {
        return objectKeys == null ? Collections.emptyList() : objectKeys;
    }

    private void collectSkillDocs(Map<String, SkillDocInfo> skillDocMap, List<String> objectKeys, String skillRootPrefix) {
        objectKeys.stream()
            .filter(StringUtils::isNotBlank)
            .forEach(objectKey -> collectSkillDoc(skillDocMap, objectKey, skillRootPrefix));
    }

    private void collectSkillDoc(Map<String, SkillDocInfo> skillDocMap, String objectKey, String skillRootPrefix) {
        if (!StringUtils.startsWith(objectKey, skillRootPrefix)) {
            return;
        }
        String relativePath = objectKey.substring(skillRootPrefix.length());
        String[] segments = StringUtils.split(relativePath, '/');
        if (segments == null || segments.length != 2 || StringUtils.isBlank(segments[0])
            || !StringUtils.equals(segments[1], SKILL_DOC_FILE_NAME)) {
            return;
        }
        skillDocMap.putIfAbsent(segments[0], new SkillDocInfo(skillRootPrefix + segments[0], objectKey));
    }

    /**
     * keyword 仅按 skills/{skillFileName}/SKILL.md 中的 skillFileName 目录名做模糊匹配，
     * 不按 SKILL.md 文件名或完整对象路径匹配。
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

    private static <T> T withUserContext(String userCode, Callable<T> callable) {
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode.trim());
        CurrentUserHolder.setLoginInfo(loginInfo);
        try {
            return callable.call();
        }
        catch (RuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
        finally {
            restoreLoginInfo(originalLoginInfo);
        }
    }

    private static void restoreLoginInfo(LoginInfo originalLoginInfo) {
        if (originalLoginInfo == null) {
            CurrentUserHolder.clearLoginInfo();
            return;
        }
        CurrentUserHolder.setLoginInfo(originalLoginInfo);
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
