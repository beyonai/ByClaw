package com.iwhalecloud.byai.state.application.service.session;

import java.util.concurrent.Callable;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

/**
 * byclaw 用户桶工作空间路径工具。
 *
 * UserFS 统一落在 bucket byclaw-{userCode} 的 /by 根目录下，本类只维护 /by 之后的业务路径。
 *
 * @author qin.guoquan
 * @date 2026-05-21
 */
final class ByClawUserWorkspacePaths {

    /** UserFS 对外 objectKey 的根前缀。 */
    static final String USER_FS_OBJECT_KEY_ROOT_PREFIX = "/by";

    /** 超级助手 skills 根目录前缀。 */
    static final String WORKSPACE_SKILL_ROOT_PREFIX = "/.openclaw/workspace/skills/";

    /** 数字员工 agent skills 根目录模板。 */
    static final String AGENT_SKILL_ROOT_PREFIX_TEMPLATE = "/.openclaw/workspace-baiying-agent-%s/skills/";

    /** 个人 agent tar.gz 根目录模板。 */
    static final String PERSONAL_AGENT_ARCHIVE_ROOT_PREFIX_TEMPLATE = "/.personal-agents/%s/";

    /** skill 元信息文件名；query 仅识别此文件作为 skill 的标志。 */
    static final String SKILL_DOC_FILE_NAME = "SKILL.md";

    private ByClawUserWorkspacePaths() {
    }

    static String buildAgentSkillRootPrefix(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException("resourceId must not be null");
        }
        return String.format(AGENT_SKILL_ROOT_PREFIX_TEMPLATE, resourceId);
    }

    static String resolveSkillRootPrefix(Long resourceId, String resourceCode) {
        if (resourceId == null || isSuperAssistantResourceCode(resourceCode)) {
            return WORKSPACE_SKILL_ROOT_PREFIX;
        }
        return buildAgentSkillRootPrefix(resourceId);
    }

    static String buildPersonalAgentArchiveRootPrefix(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException("resourceId must not be null");
        }
        return String.format(PERSONAL_AGENT_ARCHIVE_ROOT_PREFIX_TEMPLATE, resourceId);
    }

    static String buildPersonalAgentArchivePath(Long resourceId, String fileName) {
        return buildPersonalAgentArchiveRootPrefix(resourceId) + fileName;
    }

    static String toUserFsObjectKey(String workspacePath) {
        String normalized = workspacePath.startsWith("/") ? workspacePath : "/" + workspacePath;
        return USER_FS_OBJECT_KEY_ROOT_PREFIX + normalized;
    }

    static boolean isSuperAssistantResourceCode(String resourceCode) {
        return resourceCode != null && resourceCode.endsWith("_main");
    }

    /**
     * 临时把 {@link CurrentUserHolder} 切换为指定 userCode，执行回调后还原。
     * UserFS / 桶名解析全部依赖 LoginInfo.userCode，所以跨用户操作必须先切上下文。
     */
    static <T> T withUserContext(String userCode, Callable<T> callable) {
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
}
