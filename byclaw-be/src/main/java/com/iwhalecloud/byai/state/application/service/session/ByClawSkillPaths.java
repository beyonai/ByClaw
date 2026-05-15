package com.iwhalecloud.byai.state.application.service.session;

import java.util.concurrent.Callable;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

/**
 * skill 路径与上下文切换的内部工具。
 * 同一份口径供 {@link ByClawSkillQueryApplicationService} 与 {@link ByClawSkillUploadApplicationService} 复用，
 * 避免常量与 LoginInfo 切换逻辑各写一遍导致 query / upload 路径漂移。
 */
final class ByClawSkillPaths {

    /** workspace 模式下 skill 根目录前缀，与 query 服务硬编码完全一致。 */
    static final String WORKSPACE_SKILL_ROOT_PREFIX = "/.openclaw/workspace/skills/";

    /** skill 元信息文件名；query 仅识别此文件作为 skill 的标志。 */
    static final String SKILL_DOC_FILE_NAME = "SKILL.md";

    private ByClawSkillPaths() {
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
