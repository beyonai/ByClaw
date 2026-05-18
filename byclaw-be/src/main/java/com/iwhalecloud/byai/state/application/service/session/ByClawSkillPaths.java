package com.iwhalecloud.byai.state.application.service.session;

import java.util.concurrent.Callable;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

/**
 * skill 路径与上下文切换的内部工具。
 * 同一份口径供 {@link ByClawSkillQueryApplicationService} 与 {@link ByClawSkillUploadApplicationService} 复用，
 * 避免常量与 LoginInfo 切换逻辑各写一遍导致 query / upload 路径漂移。
 * @author qin.guoquan
 * @date 2026-05-15 18:37:18
 */
final class ByClawSkillPaths {

    /** 超级助手 skills 根目录前缀。 */
    static final String WORKSPACE_SKILL_ROOT_PREFIX = "/.openclaw/workspace/skills/";

    /** 数字员工 agent skills 根目录模板。 */
    static final String AGENT_SKILL_ROOT_PREFIX_TEMPLATE = "/.openclaw/workspace-baiying-agent-%s/skills/";

    /** skill 元信息文件名；query 仅识别此文件作为 skill 的标志。 */
    static final String SKILL_DOC_FILE_NAME = "SKILL.md";

    private ByClawSkillPaths() {
    }

    static String buildAgentSkillRootPrefix(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException("resourceId must not be null");
        }
        return String.format(AGENT_SKILL_ROOT_PREFIX_TEMPLATE, resourceId);
    }

    static String resolveSkillRootPrefix(Long resourceId) {
        return resourceId == null ? WORKSPACE_SKILL_ROOT_PREFIX : buildAgentSkillRootPrefix(resourceId);
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
