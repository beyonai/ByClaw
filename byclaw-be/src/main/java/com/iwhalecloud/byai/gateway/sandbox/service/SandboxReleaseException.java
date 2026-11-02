package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;

/**
 * 区分执行服务明确拒绝释放和网络异常导致的结果未知，不携带远程响应详情。
 * @author Codex
 * @since 2026-10-23
 */
public class SandboxReleaseException extends BdpRuntimeException {
    private final boolean outcomeUnknown;

    /** 创建可安全返回给管理入口的释放异常。 */
    public SandboxReleaseException(boolean outcomeUnknown) {
        super(I18nUtil.get(outcomeUnknown ? "sandbox.release.unknown" : "sandbox.release.failed"));
        this.outcomeUnknown = outcomeUnknown;
    }

    /** 超时、空响应等情况不能推断远端未执行。 */
    public boolean isOutcomeUnknown() {
        return outcomeUnknown;
    }
}
